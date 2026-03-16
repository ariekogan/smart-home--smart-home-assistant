#!/usr/bin/env node
// Google Home MCP Connector — Smart Device Management (SDM) API
// Transport: stdio JSON-RPC 2.0

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const GOOGLE_PROJECT_ID = process.env.GOOGLE_PROJECT_ID || null;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || null;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "https://app.ateam-ai.com/oauth/callback";

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "google-home.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS auth(key TEXT PRIMARY KEY, value_json TEXT, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS devices(device_id TEXT PRIMARY KEY, device_type TEXT, friendly_name TEXT, room TEXT, capabilities_json TEXT, last_seen TEXT);
  CREATE TABLE IF NOT EXISTS device_states(device_id TEXT PRIMARY KEY, state TEXT DEFAULT 'unknown', attributes_json TEXT DEFAULT '{}');
`);

function now() { return new Date().toISOString(); }
function writeResult(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); }
function writeError(id, message) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }) + "\n"); }

// --- Auth helpers ---
function getAuth() {
  const row = db.prepare("SELECT value_json FROM auth WHERE key = 'google'").get();
  return row ? JSON.parse(row.value_json) : null;
}
function saveAuth(data) {
  db.prepare("INSERT OR REPLACE INTO auth(key, value_json, updated_at) VALUES('google', ?, ?)").run(JSON.stringify(data), now());
}

// --- Token refresh ---
async function refreshTokenIfNeeded() {
  const auth = getAuth();
  if (!auth?.refresh_token) throw new Error("Google Home not connected. Use google.auth first.");
  if (auth.expires_at && Date.now() < auth.expires_at - 60000) return auth;

  console.error("[google] Refreshing access token...");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: auth.refresh_token,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`Google token refresh failed: ${data.error_description || data.error}`);
  const updated = {
    ...auth,
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in * 1000),
    ...(data.refresh_token ? { refresh_token: data.refresh_token } : {})
  };
  saveAuth(updated);
  return updated;
}

// --- SDM API fetch ---
const SDM_BASE = "https://smartdevicemanagement.googleapis.com/v1";

async function sdmFetch(endpoint, options = {}) {
  const auth = await refreshTokenIfNeeded();
  const res = await fetch(`${SDM_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${auth.access_token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Google SDM ${res.status}: ${txt}`);
  }
  return res.json();
}

// --- Rate limiting (5 QPM per device) ---
const rateLimits = new Map(); // deviceId -> { count, resetTime }
function checkRateLimit(deviceId) {
  const now = Date.now();
  let limit = rateLimits.get(deviceId);
  if (!limit || now > limit.resetTime) {
    limit = { count: 0, resetTime: now + 60000 };
    rateLimits.set(deviceId, limit);
  }
  if (limit.count >= 5) {
    const waitSec = Math.ceil((limit.resetTime - now) / 1000);
    throw new Error(`Rate limited: max 5 commands/minute per device. Try again in ${waitSec}s.`);
  }
  limit.count++;
}

// --- Device type mapping ---
const TYPE_MAP = {
  "sdm.devices.types.THERMOSTAT": { type: "thermostat", caps: ["set_temperature", "set_mode", "set_fan", "get_eco"] },
  "sdm.devices.types.CAMERA": { type: "camera", caps: ["get_stream"] },
  "sdm.devices.types.DOORBELL": { type: "doorbell", caps: ["get_stream"] },
  "sdm.devices.types.DISPLAY": { type: "display", caps: ["read_state"] },
};

// --- Trait extraction ---
function extractTraitValues(traits) {
  const attrs = {};
  for (const [key, val] of Object.entries(traits || {})) {
    const shortKey = key.replace("sdm.devices.traits.", "");
    if (shortKey === "Temperature") attrs.ambient_temperature_c = val.ambientTemperatureCelsius;
    else if (shortKey === "ThermostatTemperatureSetpoint") {
      attrs.heat_setpoint_c = val.heatCelsius;
      attrs.cool_setpoint_c = val.coolCelsius;
    }
    else if (shortKey === "ThermostatMode") attrs.thermostat_mode = val.mode;
    else if (shortKey === "ThermostatEco") { attrs.eco_mode = val.mode; attrs.eco_heat_c = val.heatCelsius; attrs.eco_cool_c = val.coolCelsius; }
    else if (shortKey === "ThermostatHvac") attrs.hvac_status = val.status;
    else if (shortKey === "Humidity") attrs.humidity_percent = val.ambientHumidityPercent;
    else if (shortKey === "Connectivity") attrs.connectivity = val.status;
    else if (shortKey === "Fan") { attrs.fan_mode = val.timerMode; attrs.fan_timeout = val.timerTimeout; }
    else if (shortKey === "Info") attrs.custom_name = val.customName;
    else attrs[shortKey] = val;
  }
  return attrs;
}

// --- Cache devices ---
async function refreshDevices() {
  const projectPath = `/enterprises/${GOOGLE_PROJECT_ID}`;
  const result = await sdmFetch(`${projectPath}/devices`);
  const devices = [];

  for (const dev of result.devices || []) {
    const id = dev.name; // full resource name
    const shortId = id.split("/").pop();
    const typeInfo = TYPE_MAP[dev.type] || { type: "unknown", caps: [] };
    const attrs = extractTraitValues(dev.traits);
    const name = attrs.custom_name || typeInfo.type;

    // Get room from parent relations
    let room = null;
    for (const rel of dev.parentRelations || []) {
      if (rel.displayName) room = rel.displayName;
    }

    db.prepare("INSERT OR REPLACE INTO devices(device_id, device_type, friendly_name, room, capabilities_json, last_seen) VALUES(?,?,?,?,?,?)")
      .run(shortId, typeInfo.type, name, room, JSON.stringify(typeInfo.caps), now());
    db.prepare("INSERT OR REPLACE INTO device_states(device_id, state, attributes_json) VALUES(?,?,?)")
      .run(shortId, attrs.connectivity || "unknown", JSON.stringify(attrs));

    devices.push({ id: shortId, full_id: id, type: typeInfo.type, name, room, connectivity: attrs.connectivity, ...attrs });
  }
  return devices;
}

// --- Tool definitions ---
const TOOLS = [
  { name: "google.auth", description: "Start Google Home authorization — returns OAuth URL for user to visit and authorize access to Nest devices" },
  { name: "google.callback", description: "Complete Google Home authorization with the code from the OAuth redirect",
    inputSchema: { type: "object", properties: { code: { type: "string", description: "Authorization code from OAuth redirect URL" } }, required: ["code"] } },
  { name: "google.devices", description: "List all Google Home / Nest devices (thermostats, cameras, doorbells)",
    inputSchema: { type: "object", properties: { refresh: { type: "boolean", description: "Force refresh from cloud" } } } },
  { name: "google.state", description: "Get current state of a Google Home device (temperature, mode, connectivity)",
    inputSchema: { type: "object", properties: { device_id: { type: "string" } }, required: ["device_id"] } },
  { name: "google.command", description: "Send a command to a Google Home device. Commands: SetHeat, SetCool, SetRange, SetMode, SetFanTimer, SetEcoMode",
    inputSchema: { type: "object", properties: {
      device_id: { type: "string" },
      command: { type: "string", description: "Command: SetHeat, SetCool, SetRange, SetMode, SetFanTimer, SetEcoMode" },
      params: { type: "object", description: "Command params, e.g. { heatCelsius: 22 } for SetHeat, { mode: 'HEAT' } for SetMode" }
    }, required: ["device_id", "command"] } },
  { name: "google.structures", description: "List Google Home structures (homes) and rooms" },
  { name: "google.status", description: "Get Google Home integration connection status" },
  { name: "ui.listPlugins", description: "List available UI plugins for this connector" },
  { name: "ui.getPlugin", description: "Get UI plugin details by ID",
    inputSchema: { type: "object", properties: { plugin_id: { type: "string" } }, required: ["plugin_id"] } }
];

// --- Command mapping ---
const COMMAND_MAP = {
  SetHeat: "sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat",
  SetCool: "sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool",
  SetRange: "sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange",
  SetMode: "sdm.devices.commands.ThermostatMode.SetMode",
  SetFanTimer: "sdm.devices.commands.Fan.SetTimer",
  SetEcoMode: "sdm.devices.commands.ThermostatEco.SetMode",
};

async function callTool(name, args) {
  switch (name) {
    case "google.auth": {
      if (!GOOGLE_CLIENT_ID || !GOOGLE_PROJECT_ID) {
        return {
          error: "Google Home not configured.",
          setup_instructions: [
            "1. Go to https://console.nest.google.com/device-access and pay the $5 access fee",
            "2. Create a project and note the Project ID",
            "3. Go to https://console.cloud.google.com/apis/credentials and create an OAuth 2.0 Client",
            "4. Enable the Smart Device Management API",
            "5. Set environment variables: GOOGLE_PROJECT_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET"
          ]
        };
      }
      const authUrl = `https://nestservices.google.com/partnerconnections/${GOOGLE_PROJECT_ID}/auth?` +
        new URLSearchParams({
          response_type: "code",
          client_id: GOOGLE_CLIENT_ID,
          redirect_uri: GOOGLE_REDIRECT_URI,
          scope: "https://www.googleapis.com/auth/sdm.service",
          access_type: "offline",
          prompt: "consent"
        });
      return {
        auth_url: authUrl,
        next_step: "Visit the URL, authorize access, then copy the 'code' parameter from the redirect URL and use google.callback"
      };
    }

    case "google.callback": {
      if (!args.code) throw new Error("Authorization code required");
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: args.code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: GOOGLE_REDIRECT_URI
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(`OAuth error: ${data.error_description || data.error}`);
      const tokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in * 1000)
      };
      saveAuth(tokens);
      console.error("[google] OAuth completed successfully");
      const devices = await refreshDevices();
      return { connected: true, devices_found: devices.length, devices };
    }

    case "google.devices": {
      if (args.refresh !== false) {
        const devices = await refreshDevices();
        return { count: devices.length, devices };
      }
      const rows = db.prepare("SELECT d.*, s.state, s.attributes_json FROM devices d LEFT JOIN device_states s ON d.device_id = s.device_id").all();
      return { count: rows.length, devices: rows.map(r => ({ id: r.device_id, type: r.device_type, name: r.friendly_name, room: r.room, state: r.state, ...JSON.parse(r.attributes_json || "{}") })) };
    }

    case "google.state": {
      if (!args.device_id) throw new Error("device_id required");
      const projectPath = `/enterprises/${GOOGLE_PROJECT_ID}`;
      const fullId = args.device_id.includes("/") ? args.device_id : `${projectPath}/devices/${args.device_id}`;
      const dev = await sdmFetch(`/${fullId.replace(/^\//, "")}`);
      const attrs = extractTraitValues(dev.traits);
      const typeInfo = TYPE_MAP[dev.type] || { type: "unknown" };
      return { device_id: args.device_id, type: typeInfo.type, name: attrs.custom_name, ...attrs };
    }

    case "google.command": {
      if (!args.device_id) throw new Error("device_id required");
      if (!args.command) throw new Error("command required");
      checkRateLimit(args.device_id);

      const sdmCommand = COMMAND_MAP[args.command];
      if (!sdmCommand) throw new Error(`Unknown command: ${args.command}. Available: ${Object.keys(COMMAND_MAP).join(", ")}`);

      const projectPath = `/enterprises/${GOOGLE_PROJECT_ID}`;
      const fullId = args.device_id.includes("/") ? args.device_id : `${projectPath}/devices/${args.device_id}`;
      const result = await sdmFetch(`/${fullId.replace(/^\//, "")}:executeCommand`, {
        method: "POST",
        body: JSON.stringify({ command: sdmCommand, params: args.params || {} })
      });
      return { success: true, device_id: args.device_id, command: args.command, result };
    }

    case "google.structures": {
      const projectPath = `/enterprises/${GOOGLE_PROJECT_ID}`;
      const result = await sdmFetch(`${projectPath}/structures`);
      const structures = [];
      for (const s of result.structures || []) {
        const id = s.name.split("/").pop();
        const rooms = [];
        try {
          const roomsRes = await sdmFetch(`${s.name}/rooms`);
          for (const r of roomsRes.rooms || []) {
            rooms.push({ id: r.name.split("/").pop(), name: r.traits?.["sdm.structures.traits.RoomInfo"]?.customName || "Unknown" });
          }
        } catch {}
        structures.push({ id, name: s.traits?.["sdm.structures.traits.Info"]?.customName || "Home", rooms });
      }
      return structures;
    }

    case "google.status": {
      const auth = getAuth();
      if (!auth?.access_token) return { connected: false, message: "Not connected. Use google.auth to authorize.", project_id: GOOGLE_PROJECT_ID || "not set" };
      const expired = auth.expires_at && Date.now() > auth.expires_at;
      return {
        connected: !expired && !!auth.refresh_token,
        has_refresh_token: !!auth.refresh_token,
        token_expires: auth.expires_at ? new Date(auth.expires_at).toISOString() : null,
        project_id: GOOGLE_PROJECT_ID
      };
    }

    case "ui.listPlugins": return { plugins: [] };
    case "ui.getPlugin": return { error: "No UI plugins available in this connector" };

    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// --- JSON-RPC stdio loop ---
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const { id, method, params } = msg;
    try {
      if (method === "initialize") {
        writeResult(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "google-home-mcp", version: "1.0.0" }
        });
        continue;
      }
      if (method === "notifications/initialized") continue;
      if (method === "tools/list") {
        writeResult(id, { tools: TOOLS });
        continue;
      }
      if (method === "tools/call") {
        const result = await callTool(params.name, params.arguments || {});
        writeResult(id, { content: [{ type: "text", text: JSON.stringify(result) }] });
        continue;
      }
      writeError(id, `Unsupported method: ${method}`);
    } catch (err) {
      console.error(`[google] Error in ${method}:`, err.message);
      if (id != null) writeError(id, err.message);
    }
  }
});

console.error("[google-home-mcp] Google Home / Nest connector started");
