#!/usr/bin/env node
// Tuya / Smart Life MCP Connector — Cloud API with HMAC-SHA256 signing
// Transport: stdio JSON-RPC 2.0

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const TUYA_ACCESS_ID = process.env.TUYA_ACCESS_ID || null;
const TUYA_ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET || null;
const TUYA_REGION = process.env.TUYA_REGION || "us";

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "tuya.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS auth(key TEXT PRIMARY KEY, value_json TEXT, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS devices(device_id TEXT PRIMARY KEY, device_type TEXT, friendly_name TEXT, room TEXT, capabilities_json TEXT, last_seen TEXT);
  CREATE TABLE IF NOT EXISTS device_states(device_id TEXT PRIMARY KEY, state TEXT DEFAULT 'unknown', attributes_json TEXT DEFAULT '{}');
`);

function now() { return new Date().toISOString(); }
function writeResult(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); }
function writeError(id, message) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }) + "\n"); }

const REGION_URLS = {
  us: "https://openapi.tuyaus.com",
  eu: "https://openapi.tuyaeu.com",
  cn: "https://openapi.tuyacn.com",
  in: "https://openapi.tuyain.com",
};

// --- Auth helpers ---
function getAuth() {
  const row = db.prepare("SELECT value_json FROM auth WHERE key = 'tuya'").get();
  return row ? JSON.parse(row.value_json) : null;
}
function saveAuth(data) {
  db.prepare("INSERT OR REPLACE INTO auth(key, value_json, updated_at) VALUES('tuya', ?, ?)").run(JSON.stringify(data), now());
}

// --- HMAC-SHA256 request signing ---
function signRequest(method, pathUrl, body, accessToken) {
  const accessId = TUYA_ACCESS_ID;
  const secret = TUYA_ACCESS_SECRET;
  if (!accessId || !secret) throw new Error("TUYA_ACCESS_ID and TUYA_ACCESS_SECRET env vars required");

  const t = Date.now().toString();
  const contentHash = crypto.createHash("sha256").update(body || "").digest("hex");
  const stringToSign = [method.toUpperCase(), contentHash, "", pathUrl].join("\n");
  const signStr = accessId + (accessToken || "") + t + stringToSign;
  const sign = crypto.createHmac("sha256", secret).update(signStr).digest("hex").toUpperCase();

  return {
    client_id: accessId,
    sign,
    t,
    sign_method: "HMAC-SHA256",
    ...(accessToken ? { access_token: accessToken } : {})
  };
}

// --- Token management ---
async function getToken() {
  const base = REGION_URLS[TUYA_REGION] || REGION_URLS.us;
  const pathUrl = "/v1.0/token?grant_type=1";
  const headers = signRequest("GET", pathUrl, "", null);
  const res = await fetch(`${base}${pathUrl}`, { headers: { ...headers, "Content-Type": "application/json" } });
  const data = await res.json();
  if (!data.success) throw new Error(`Tuya token error: ${data.msg} (code: ${data.code})`);
  const tokens = {
    access_token: data.result.access_token,
    refresh_token: data.result.refresh_token,
    expires_at: Date.now() + (data.result.expire_time * 1000),
    uid: data.result.uid
  };
  saveAuth(tokens);
  return tokens;
}

async function refreshToken() {
  const auth = getAuth();
  if (!auth?.refresh_token) return await getToken();
  const base = REGION_URLS[TUYA_REGION] || REGION_URLS.us;
  const pathUrl = `/v1.0/token/${auth.refresh_token}`;
  const headers = signRequest("GET", pathUrl, "", null);
  const res = await fetch(`${base}${pathUrl}`, { headers: { ...headers, "Content-Type": "application/json" } });
  const data = await res.json();
  if (!data.success) return await getToken(); // Fallback to new token
  const tokens = {
    access_token: data.result.access_token,
    refresh_token: data.result.refresh_token,
    expires_at: Date.now() + (data.result.expire_time * 1000),
    uid: data.result.uid || auth.uid
  };
  saveAuth(tokens);
  return tokens;
}

async function ensureToken() {
  const auth = getAuth();
  if (auth?.access_token && auth.expires_at > Date.now() + 60000) return auth;
  return await refreshToken();
}

// --- Tuya API fetch ---
async function tuyaFetch(endpoint, options = {}) {
  const auth = await ensureToken();
  const base = REGION_URLS[TUYA_REGION] || REGION_URLS.us;
  const method = (options.method || "GET").toUpperCase();
  const body = options.body || "";
  const headers = signRequest(method, endpoint, body, auth.access_token);

  const res = await fetch(`${base}${endpoint}`, {
    method,
    headers: { ...headers, "Content-Type": "application/json" },
    ...(method !== "GET" && body ? { body } : {})
  });
  const data = await res.json();
  if (!data.success) throw new Error(`Tuya API error: ${data.msg} (code: ${data.code})`);
  return data.result;
}

// --- Category mapping ---
const CATEGORY_MAP = {
  dj: "Light", kg: "Switch", cz: "Plug", pc: "Power Strip",
  wk: "Thermostat", kt: "Air Conditioner", fs: "Fan",
  cl: "Curtain", mc: "Door Sensor", mcs: "Contact Sensor",
  pir: "Motion Sensor", wsdcg: "Temp/Humidity Sensor",
  ywbj: "Smoke Detector", rqbj: "Gas Detector", sp: "Camera",
  bh: "Smart Kettle", cwwsq: "Pet Feeder", szjqr: "Robot Vacuum"
};

// --- Cache devices ---
async function refreshDevices() {
  let allDevices = [];
  let hasMore = true;
  let lastId = null;

  // Try paginated device list
  try {
    const result = await tuyaFetch("/v1.0/iot-03/devices?page_no=1&page_size=100");
    if (result?.list) allDevices = result.list;
    else if (Array.isArray(result)) allDevices = result;
  } catch {
    // Fallback: try user device list
    const auth = getAuth();
    if (auth?.uid) {
      const result = await tuyaFetch(`/v1.0/users/${auth.uid}/devices`);
      allDevices = Array.isArray(result) ? result : [];
    }
  }

  const devices = [];
  for (const dev of allDevices) {
    const id = dev.id;
    const name = dev.name || dev.product_name || "Unknown Device";
    const category = dev.category || "";
    const typeName = CATEGORY_MAP[category] || category || "Unknown";
    const online = dev.online !== false;

    db.prepare("INSERT OR REPLACE INTO devices(device_id, device_type, friendly_name, room, capabilities_json, last_seen) VALUES(?,?,?,?,?,?)")
      .run(id, typeName, name, null, JSON.stringify([category]), now());
    db.prepare("INSERT OR REPLACE INTO device_states(device_id, state, attributes_json) VALUES(?,?,?)")
      .run(id, online ? "online" : "offline", JSON.stringify({ category, product_id: dev.product_id, ip: dev.ip || null }));

    devices.push({ id, name, type: typeName, category, online, product_id: dev.product_id });
  }
  return devices;
}

// --- Tool definitions ---
const TOOLS = [
  { name: "tuya.auth", description: "Connect to Tuya IoT Platform. Uses TUYA_ACCESS_ID and TUYA_ACCESS_SECRET env vars, or accepts them as arguments.",
    inputSchema: { type: "object", properties: {
      access_id: { type: "string", description: "Tuya Access ID (if not set via env var)" },
      access_secret: { type: "string", description: "Tuya Access Secret (if not set via env var)" },
      region: { type: "string", description: "Region: us, eu, cn, in (default: us)" }
    } } },
  { name: "tuya.callback", description: "Verify Tuya connection and list available devices" },
  { name: "tuya.devices", description: "List all Tuya/Smart Life devices (switches, lights, plugs, sensors, thermostats, cameras)",
    inputSchema: { type: "object", properties: { refresh: { type: "boolean", description: "Force refresh from cloud" } } } },
  { name: "tuya.state", description: "Get current state and status codes of a Tuya device",
    inputSchema: { type: "object", properties: { device_id: { type: "string" } }, required: ["device_id"] } },
  { name: "tuya.command", description: "Send a command to a Tuya device. Use tuya.device_functions to discover available commands.",
    inputSchema: { type: "object", properties: {
      device_id: { type: "string" },
      commands: { type: "array", description: "Array of { code, value } pairs, e.g. [{ code: 'switch_1', value: true }]",
        items: { type: "object", properties: { code: { type: "string" }, value: {} }, required: ["code", "value"] } }
    }, required: ["device_id", "commands"] } },
  { name: "tuya.device_functions", description: "Get available functions/commands for a Tuya device with value ranges",
    inputSchema: { type: "object", properties: { device_id: { type: "string" } }, required: ["device_id"] } },
  { name: "tuya.categories", description: "List known Tuya device categories and their types" },
  { name: "tuya.status", description: "Get Tuya platform connection status" }
];

async function callTool(name, args) {
  switch (name) {
    case "tuya.auth": {
      if (!TUYA_ACCESS_ID && !args.access_id) {
        return {
          error: "Tuya credentials not configured.",
          setup_instructions: [
            "1. Go to https://iot.tuya.com/ and create an account",
            "2. Create a Cloud Project (choose your data center region)",
            "3. Copy the Access ID and Access Secret",
            "4. Set TUYA_ACCESS_ID and TUYA_ACCESS_SECRET environment variables",
            "5. Set TUYA_REGION to your region (us, eu, cn, in)"
          ]
        };
      }
      try {
        const tokens = await getToken();
        console.error("[tuya] Authenticated successfully, uid:", tokens.uid);
        const devices = await refreshDevices();
        return { connected: true, region: TUYA_REGION, uid: tokens.uid, devices_found: devices.length, devices };
      } catch (e) {
        return { error: e.message, hint: "Check your Access ID and Secret. Make sure the region matches your Tuya IoT Platform project." };
      }
    }

    case "tuya.callback": {
      try {
        const auth = await ensureToken();
        const devices = await refreshDevices();
        return { connected: true, region: TUYA_REGION, uid: auth.uid, devices_found: devices.length, devices };
      } catch (e) {
        return { error: e.message };
      }
    }

    case "tuya.devices": {
      await ensureToken();
      if (args.refresh !== false) {
        const devices = await refreshDevices();
        return { count: devices.length, devices };
      }
      const rows = db.prepare("SELECT d.*, s.state, s.attributes_json FROM devices d LEFT JOIN device_states s ON d.device_id = s.device_id").all();
      return { count: rows.length, devices: rows.map(r => ({ id: r.device_id, type: r.device_type, name: r.friendly_name, state: r.state, ...JSON.parse(r.attributes_json || "{}") })) };
    }

    case "tuya.state": {
      if (!args.device_id) throw new Error("device_id required");
      const status = await tuyaFetch(`/v1.0/iot-03/devices/${args.device_id}/status`);
      // Also get device info
      let info = {};
      try { info = await tuyaFetch(`/v1.0/iot-03/devices/${args.device_id}`); } catch {}
      return {
        device_id: args.device_id,
        name: info.name || null,
        online: info.online !== false,
        category: info.category || null,
        status: Array.isArray(status) ? status : []
      };
    }

    case "tuya.command": {
      if (!args.device_id) throw new Error("device_id required");
      if (!args.commands || !Array.isArray(args.commands)) throw new Error("commands array required, e.g. [{ code: 'switch_1', value: true }]");
      const result = await tuyaFetch(`/v1.0/iot-03/devices/${args.device_id}/commands`, {
        method: "POST",
        body: JSON.stringify({ commands: args.commands })
      });
      return { success: true, device_id: args.device_id, result };
    }

    case "tuya.device_functions": {
      if (!args.device_id) throw new Error("device_id required");
      const fns = await tuyaFetch(`/v1.0/iot-03/devices/${args.device_id}/functions`);
      return {
        device_id: args.device_id,
        functions: (fns.functions || []).map(f => ({
          code: f.code,
          name: f.name,
          type: f.type,
          values: f.values ? JSON.parse(f.values) : null
        }))
      };
    }

    case "tuya.categories": {
      return Object.entries(CATEGORY_MAP).map(([code, name]) => ({ code, name }));
    }

    case "tuya.status": {
      const auth = getAuth();
      if (!auth?.access_token) return { connected: false, message: "Not connected. Use tuya.auth to connect." };
      const expired = auth.expires_at && Date.now() > auth.expires_at;
      return {
        connected: !expired,
        region: TUYA_REGION,
        uid: auth.uid,
        token_expires: auth.expires_at ? new Date(auth.expires_at).toISOString() : null,
        token_expired: expired
      };
    }

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
          serverInfo: { name: "tuya-mcp", version: "1.0.0" }
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
      console.error(`[tuya] Error in ${method}:`, err.message);
      if (id != null) writeError(id, err.message);
    }
  }
});

console.error("[tuya-mcp] Tuya / Smart Life connector started");
