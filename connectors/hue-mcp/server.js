#!/usr/bin/env node
// Philips Hue MCP Connector — CLIP v2 API via local bridge
// Transport: stdio JSON-RPC 2.0

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Hue bridge uses self-signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const HUE_BRIDGE_IP = process.env.HUE_BRIDGE_IP || null;
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "hue.db"));
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
  const row = db.prepare("SELECT value_json FROM auth WHERE key = 'hue'").get();
  return row ? JSON.parse(row.value_json) : null;
}
function saveAuth(data) {
  db.prepare("INSERT OR REPLACE INTO auth(key, value_json, updated_at) VALUES('hue', ?, ?)").run(JSON.stringify(data), now());
}

// --- Hue CLIP v2 API ---
async function hueFetch(endpoint, options = {}) {
  const auth = getAuth();
  if (!auth || !auth.bridge_ip || !auth.username) throw new Error("Hue not connected. Use hue.auth to pair with your bridge first.");
  const url = `https://${auth.bridge_ip}/clip/v2${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "hue-application-key": auth.username,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Hue API ${res.status}: ${txt}`);
  }
  return res.json();
}

// --- Bridge discovery ---
async function discoverBridge() {
  if (HUE_BRIDGE_IP) return HUE_BRIDGE_IP;
  try {
    const res = await fetch("https://discovery.meethue.com/");
    const bridges = await res.json();
    if (bridges.length > 0) return bridges[0].internalipaddress;
  } catch (e) {
    console.error("[hue] Bridge discovery failed:", e.message);
  }
  return null;
}

// --- Pair with bridge (link button must be pressed) ---
async function pairBridge(bridgeIp) {
  const res = await fetch(`https://${bridgeIp}/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ devicetype: "smart-home-assistant#ateam", generateclientkey: true })
  });
  const data = await res.json();
  if (Array.isArray(data) && data[0]?.error) {
    return { error: data[0].error.description };
  }
  if (Array.isArray(data) && data[0]?.success) {
    return { username: data[0].success.username, clientkey: data[0].success.clientkey };
  }
  return { error: "Unexpected response from bridge" };
}

// --- Cache devices from bridge ---
async function refreshDevices() {
  const [lightsRes, roomsRes] = await Promise.all([
    hueFetch("/resource/light"),
    hueFetch("/resource/room")
  ]);

  const rooms = {};
  for (const r of roomsRes.data || []) {
    for (const child of r.children || []) {
      rooms[child.rid] = r.metadata?.name || "Unknown Room";
    }
  }

  // Get device info to map lights to rooms via device owner
  const devicesRes = await hueFetch("/resource/device");
  const deviceRooms = {};
  for (const dev of devicesRes.data || []) {
    const rid = dev.id;
    if (rooms[rid]) deviceRooms[rid] = rooms[rid];
    // Map services to the device's room
    for (const svc of dev.services || []) {
      deviceRooms[svc.rid] = rooms[rid] || null;
    }
  }

  const devices = [];
  for (const light of lightsRes.data || []) {
    const id = light.id;
    const name = light.metadata?.name || "Unknown Light";
    const room = deviceRooms[id] || deviceRooms[light.owner?.rid] || null;
    const caps = ["turn_on", "turn_off"];
    if (light.dimming) caps.push("brightness");
    if (light.color) caps.push("color");
    if (light.color_temperature) caps.push("color_temp");

    db.prepare("INSERT OR REPLACE INTO devices(device_id, device_type, friendly_name, room, capabilities_json, last_seen) VALUES(?,?,?,?,?,?)")
      .run(id, "light", name, room, JSON.stringify(caps), now());

    const state = light.on?.on ? "on" : "off";
    const attrs = {};
    if (light.dimming) attrs.brightness = Math.round(light.dimming.brightness);
    if (light.color_temperature?.mirek) attrs.color_temp_mirek = light.color_temperature.mirek;
    if (light.color?.xy) attrs.color_xy = light.color.xy;
    db.prepare("INSERT OR REPLACE INTO device_states(device_id, state, attributes_json) VALUES(?,?,?)")
      .run(id, state, JSON.stringify(attrs));

    devices.push({ id, type: "light", name, room, state, capabilities: caps, ...attrs });
  }
  return devices;
}

// --- Tool implementations ---
const TOOLS = [
  { name: "hue.auth", description: "Discover Hue Bridge and start pairing. User must press the link button on the bridge first.",
    inputSchema: { type: "object", properties: { bridge_ip: { type: "string", description: "Bridge IP (auto-discovered if omitted)" } } } },
  { name: "hue.callback", description: "Complete Hue Bridge pairing after the link button has been pressed" },
  { name: "hue.devices", description: "List all Hue lights with state, brightness, and room",
    inputSchema: { type: "object", properties: { refresh: { type: "boolean", description: "Force refresh from bridge" } } } },
  { name: "hue.state", description: "Get current state of a Hue light (on/off, brightness, color)",
    inputSchema: { type: "object", properties: { device_id: { type: "string" } }, required: ["device_id"] } },
  { name: "hue.command", description: "Control a Hue light: on, off, brightness (0-100), color_temp (mirek 153-500), color (xy)",
    inputSchema: { type: "object", properties: {
      device_id: { type: "string" },
      command: { type: "string", description: "on, off, brightness, color_temp, color" },
      params: { type: "object", description: "e.g. { brightness: 80 } or { mirek: 370 } or { xy: { x: 0.3, y: 0.3 } }" }
    }, required: ["device_id", "command"] } },
  { name: "hue.scenes", description: "List all Hue scenes" },
  { name: "hue.activate_scene", description: "Activate a Hue scene by ID",
    inputSchema: { type: "object", properties: { scene_id: { type: "string" } }, required: ["scene_id"] } },
  { name: "hue.rooms", description: "List all Hue rooms/zones and their lights" },
  { name: "hue.status", description: "Get Hue Bridge connection status and info" }
];

async function callTool(name, args) {
  switch (name) {
    case "hue.auth": {
      const ip = args.bridge_ip || await discoverBridge();
      if (!ip) return { error: "Could not discover Hue Bridge. Provide bridge_ip manually or ensure bridge is on the same network." };
      // Try pairing immediately (user may have already pressed the button)
      const result = await pairBridge(ip);
      if (result.username) {
        saveAuth({ bridge_ip: ip, username: result.username, clientkey: result.clientkey });
        console.error("[hue] Paired with bridge at " + ip);
        const devices = await refreshDevices();
        return { connected: true, bridge_ip: ip, devices_found: devices.length, devices };
      }
      return {
        bridge_ip: ip,
        action_required: "Press the link button on your Hue Bridge, then call hue.callback",
        note: "The large round button on top of the bridge. You have about 30 seconds after pressing it."
      };
    }

    case "hue.callback": {
      const auth = getAuth();
      const ip = auth?.bridge_ip || args.bridge_ip || await discoverBridge();
      if (!ip) return { error: "No bridge IP known. Run hue.auth first." };
      const result = await pairBridge(ip);
      if (result.error) return { error: result.error, hint: "Make sure you pressed the link button on the bridge and try again within 30 seconds." };
      saveAuth({ bridge_ip: ip, username: result.username, clientkey: result.clientkey });
      console.error("[hue] Paired with bridge at " + ip);
      const devices = await refreshDevices();
      return { connected: true, bridge_ip: ip, devices_found: devices.length, devices };
    }

    case "hue.devices": {
      const auth = getAuth();
      if (!auth) return { error: "Hue not connected. Use hue.auth first." };
      if (args.refresh !== false) {
        const devices = await refreshDevices();
        return { count: devices.length, devices };
      }
      const rows = db.prepare("SELECT d.*, s.state, s.attributes_json FROM devices d LEFT JOIN device_states s ON d.device_id = s.device_id").all();
      return { count: rows.length, devices: rows.map(r => ({ id: r.device_id, type: r.device_type, name: r.friendly_name, room: r.room, state: r.state, capabilities: JSON.parse(r.capabilities_json), ...JSON.parse(r.attributes_json || "{}") })) };
    }

    case "hue.state": {
      if (!args.device_id) throw new Error("device_id required");
      const res = await hueFetch(`/resource/light/${args.device_id}`);
      const light = res.data?.[0];
      if (!light) throw new Error(`Light ${args.device_id} not found`);
      return {
        id: light.id,
        name: light.metadata?.name,
        on: light.on?.on,
        brightness: light.dimming ? Math.round(light.dimming.brightness) : null,
        color_temp_mirek: light.color_temperature?.mirek || null,
        color_xy: light.color?.xy || null
      };
    }

    case "hue.command": {
      if (!args.device_id) throw new Error("device_id required");
      if (!args.command) throw new Error("command required");
      const payload = {};
      switch (args.command) {
        case "on": payload.on = { on: true }; break;
        case "off": payload.on = { on: false }; break;
        case "brightness": {
          const bri = args.params?.brightness ?? args.params?.value;
          if (bri == null) throw new Error("brightness value required in params (0-100)");
          payload.on = { on: true };
          payload.dimming = { brightness: Number(bri) };
          break;
        }
        case "color_temp": {
          const mirek = args.params?.mirek ?? args.params?.value;
          if (mirek == null) throw new Error("mirek value required in params (153=cool, 500=warm)");
          payload.on = { on: true };
          payload.color_temperature = { mirek: Number(mirek) };
          break;
        }
        case "color": {
          const xy = args.params?.xy || args.params;
          if (!xy?.x || !xy?.y) throw new Error("color xy values required in params ({ x: 0.3, y: 0.3 })");
          payload.on = { on: true };
          payload.color = { xy: { x: Number(xy.x), y: Number(xy.y) } };
          break;
        }
        default: throw new Error(`Unknown command: ${args.command}. Use: on, off, brightness, color_temp, color`);
      }
      await hueFetch(`/resource/light/${args.device_id}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      // Read back state
      return await callTool("hue.state", { device_id: args.device_id });
    }

    case "hue.scenes": {
      const res = await hueFetch("/resource/scene");
      return (res.data || []).map(s => ({
        id: s.id,
        name: s.metadata?.name,
        group: s.group?.rid,
        status: s.status?.active
      }));
    }

    case "hue.activate_scene": {
      if (!args.scene_id) throw new Error("scene_id required");
      await hueFetch(`/resource/scene/${args.scene_id}`, {
        method: "PUT",
        body: JSON.stringify({ recall: { action: "active" } })
      });
      return { activated: true, scene_id: args.scene_id };
    }

    case "hue.rooms": {
      const res = await hueFetch("/resource/room");
      const rooms = [];
      for (const r of res.data || []) {
        const lights = (r.children || []).filter(c => c.rtype === "device").map(c => c.rid);
        rooms.push({ id: r.id, name: r.metadata?.name, lights_count: lights.length, device_ids: lights });
      }
      return rooms;
    }

    case "hue.status": {
      const auth = getAuth();
      if (!auth) return { connected: false, message: "Not connected. Use hue.auth to pair with a Hue Bridge." };
      try {
        const res = await hueFetch("/resource/bridge");
        const bridge = res.data?.[0];
        return {
          connected: true,
          bridge_ip: auth.bridge_ip,
          bridge_id: bridge?.id,
          model: bridge?.product_data?.model_id,
          software_version: bridge?.product_data?.software_version
        };
      } catch (e) {
        return { connected: false, bridge_ip: auth.bridge_ip, error: e.message };
      }
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
          serverInfo: { name: "hue-mcp", version: "1.0.0" }
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
      console.error(`[hue] Error in ${method}:`, err.message);
      if (id != null) writeError(id, err.message);
    }
  }
});

console.error("[hue-mcp] Philips Hue connector started");
