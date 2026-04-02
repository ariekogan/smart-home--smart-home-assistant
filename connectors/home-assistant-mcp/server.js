#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

const HA_URL = process.env.HA_URL;
const HA_TOKEN = process.env.HA_TOKEN;
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const DB_PATH = path.join(DATA_DIR, "home.db");
const DEMO_MODE = !HA_URL;

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

// --- Multi-user actor isolation -------------------------------------------
// A-Team Core injects _adas_actor into every tool call's arguments.
// This connector uses raw JSON-RPC (not MCP SDK with zod), so _adas_actor
// is NOT stripped — it arrives safely in args.
function getActorId(args) {
  return args?._adas_actor || "default";
}

// --- Database schema (actor-scoped) ---------------------------------------
// All per-user tables use composite PRIMARY KEY (entity_id, actor_id)
// so multiple users can each have their own devices, rooms, states, etc.
db.exec(`
CREATE TABLE IF NOT EXISTS devices(
  entity_id TEXT NOT NULL,
  actor_id TEXT NOT NULL DEFAULT 'default',
  domain TEXT,
  friendly_name TEXT,
  capabilities_json TEXT,
  selected INTEGER DEFAULT 0,
  area_id TEXT,
  last_seen TEXT,
  PRIMARY KEY(entity_id, actor_id)
);
CREATE TABLE IF NOT EXISTS rooms(
  room_id TEXT NOT NULL,
  actor_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  PRIMARY KEY(room_id, actor_id)
);
CREATE TABLE IF NOT EXISTS room_devices(
  room_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor_id TEXT NOT NULL DEFAULT 'default',
  PRIMARY KEY(room_id, entity_id, actor_id)
);
CREATE TABLE IF NOT EXISTS aliases(
  alias TEXT NOT NULL,
  actor_id TEXT NOT NULL DEFAULT 'default',
  entity_id TEXT NOT NULL,
  PRIMARY KEY(alias, actor_id)
);
CREATE TABLE IF NOT EXISTS policies(
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL DEFAULT 'default',
  policy TEXT,
  PRIMARY KEY(entity_id, action, actor_id)
);
CREATE TABLE IF NOT EXISTS setup_state(
  key TEXT NOT NULL,
  actor_id TEXT NOT NULL DEFAULT 'default',
  value_json TEXT,
  PRIMARY KEY(key, actor_id)
);
CREATE TABLE IF NOT EXISTS test_runs(
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL DEFAULT 'default',
  entity_id TEXT,
  action TEXT,
  status TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS device_states(
  entity_id TEXT NOT NULL,
  actor_id TEXT NOT NULL DEFAULT 'default',
  state TEXT DEFAULT 'off',
  attributes_json TEXT DEFAULT '{}',
  PRIMARY KEY(entity_id, actor_id)
);
CREATE TABLE IF NOT EXISTS integrations(
  integration_id TEXT NOT NULL,
  actor_id TEXT NOT NULL DEFAULT 'default',
  type TEXT NOT NULL,
  status TEXT DEFAULT 'disconnected',
  credentials_json TEXT DEFAULT '{}',
  config_json TEXT DEFAULT '{}',
  updated_at TEXT,
  PRIMARY KEY(integration_id, actor_id)
);
`);

// Performance indexes
try { db.exec(`
CREATE INDEX IF NOT EXISTS idx_devices_actor ON devices(actor_id);
CREATE INDEX IF NOT EXISTS idx_rooms_actor ON rooms(actor_id);
CREATE INDEX IF NOT EXISTS idx_device_states_actor ON device_states(actor_id);
CREATE INDEX IF NOT EXISTS idx_integrations_actor ON integrations(actor_id);
CREATE INDEX IF NOT EXISTS idx_setup_state_actor ON setup_state(actor_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_actor ON test_runs(actor_id);
`); } catch {}

function now() { return new Date().toISOString(); }

// --- Demo data -----------------------------------------------------------
const DEMO_DEVICES = [
  { entity_id: "light.kitchen",           domain: "light",   friendly_name: "Kitchen Lights",        area_id: "kitchen",     state: "on",   attributes: { brightness: 200, color_temp: 370 } },
  { entity_id: "light.living_room",       domain: "light",   friendly_name: "Living Room Lights",    area_id: "living_room", state: "off",  attributes: { brightness: 0 } },
  { entity_id: "light.bedroom",           domain: "light",   friendly_name: "Bedroom Lights",        area_id: "bedroom",     state: "off",  attributes: { brightness: 0 } },
  { entity_id: "light.bathroom",          domain: "light",   friendly_name: "Bathroom Lights",       area_id: "bathroom",    state: "off",  attributes: { brightness: 0 } },
  { entity_id: "switch.tv",              domain: "switch",  friendly_name: "TV Plug",               area_id: "living_room", state: "on",   attributes: {} },
  { entity_id: "switch.coffee_machine",   domain: "switch",  friendly_name: "Coffee Machine",        area_id: "kitchen",     state: "off",  attributes: {} },
  { entity_id: "climate.living_room_ac",  domain: "climate", friendly_name: "Living Room AC",        area_id: "living_room", state: "cool", attributes: { current_temperature: 23, temperature: 22 } },
  { entity_id: "climate.bedroom_ac",      domain: "climate", friendly_name: "Bedroom AC",            area_id: "bedroom",     state: "off",  attributes: { current_temperature: 25, temperature: 24 } },
  { entity_id: "sensor.outdoor_temp",     domain: "sensor",  friendly_name: "Outdoor Temperature",   area_id: null,          state: "18.5", attributes: { unit_of_measurement: "°C" } },
  { entity_id: "sensor.kitchen_humidity", domain: "sensor",  friendly_name: "Kitchen Humidity",       area_id: "kitchen",     state: "55",   attributes: { unit_of_measurement: "%" } },
  { entity_id: "lock.front_door",         domain: "lock",    friendly_name: "Front Door Lock",       area_id: "entrance",    state: "locked", attributes: {} },
  { entity_id: "cover.garage_door",       domain: "cover",   friendly_name: "Garage Door",           area_id: "garage",      state: "closed", attributes: {} },
  { entity_id: "fan.bedroom_fan",         domain: "fan",     friendly_name: "Bedroom Ceiling Fan",   area_id: "bedroom",     state: "off",  attributes: { speed: 0 } },
  { entity_id: "switch.bosch_oven",      domain: "switch",  friendly_name: "Bosch Oven",            area_id: "kitchen",     state: "off",  attributes: { manufacturer: "Bosch", model: "HBG676ES6", program: "none", temperature: 0, target_temperature: 180, door: "closed" } },
  { entity_id: "sensor.bosch_oven_temp", domain: "sensor",  friendly_name: "Bosch Oven Temperature", area_id: "kitchen",    state: "0",    attributes: { unit_of_measurement: "°C", manufacturer: "Bosch" } },
];

const DEMO_ROOMS = [
  { room_id: "kitchen",     name: "Kitchen" },
  { room_id: "living_room", name: "Living Room" },
  { room_id: "bedroom",     name: "Bedroom" },
  { room_id: "bathroom",    name: "Bathroom" },
  { room_id: "entrance",    name: "Entrance" },
  { room_id: "garage",      name: "Garage" },
];

function seedDemoData(actorId) {
  const count = db.prepare("SELECT COUNT(*) as c FROM devices WHERE actor_id = ?").get(actorId).c;
  if (count > 0) return;

  const upsertDevice = db.prepare(`
    INSERT OR REPLACE INTO devices(entity_id, actor_id, domain, friendly_name, capabilities_json, selected, area_id, last_seen)
    VALUES(?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const upsertState = db.prepare(`
    INSERT OR REPLACE INTO device_states(entity_id, actor_id, state, attributes_json) VALUES(?, ?, ?, ?)
  `);
  const insertRoom = db.prepare("INSERT OR REPLACE INTO rooms(room_id, actor_id, name) VALUES(?, ?, ?)");
  const insertMap = db.prepare("INSERT OR IGNORE INTO room_devices(room_id, entity_id, actor_id) VALUES(?, ?, ?)");

  for (const d of DEMO_DEVICES) {
    upsertDevice.run(d.entity_id, actorId, d.domain, d.friendly_name, JSON.stringify(deriveCapabilities(d.entity_id)), d.area_id, now());
    upsertState.run(d.entity_id, actorId, d.state, JSON.stringify(d.attributes));
  }
  for (const r of DEMO_ROOMS) insertRoom.run(r.room_id, actorId, r.name);
  for (const d of DEMO_DEVICES) {
    if (d.area_id) insertMap.run(d.area_id, d.entity_id, actorId);
  }
  console.error("[demo] Seeded demo data for actor: " + actorId);
}

// --- HA fetch helper (live mode only) ------------------------------------
async function ha(pathUrl, options = {}) {
  if (!HA_URL || !HA_TOKEN) throw new Error("Missing HA_URL or HA_TOKEN");
  const res = await fetch(`${HA_URL}${pathUrl}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${HA_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Home Assistant error ${res.status}: ${txt}`);
  }
  const ctype = res.headers.get("content-type") || "";
  return ctype.includes("application/json") ? await res.json() : await res.text();
}

function deriveCapabilities(entityId) {
  const domain = String(entityId || "").split(".")[0];
  const caps = ["read_state"];
  if (domain === "light") caps.push("turn_on", "turn_off", "toggle");
  if (domain === "switch") caps.push("turn_on", "turn_off", "toggle");
  if (domain === "fan") caps.push("turn_on", "turn_off");
  if (domain === "climate") caps.push("turn_on", "turn_off", "set_temperature");
  if (domain === "lock") caps.push("lock", "unlock");
  if (domain === "cover") caps.push("open_cover", "close_cover");
  return [...new Set(caps)];
}

function writeResult(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function writeError(id, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }) + "\n");
}

// --- Demo-mode local state helpers (actor-scoped) ------------------------
function demoGetState(entityId, actorId) {
  const r = db.prepare(`
    SELECT d.entity_id, d.domain, d.friendly_name, d.area_id, ds.state, ds.attributes_json
    FROM devices d
    LEFT JOIN device_states ds ON ds.entity_id = d.entity_id AND ds.actor_id = d.actor_id
    WHERE d.entity_id = ? AND d.actor_id = ?
  `).get(entityId, actorId);
  if (!r) throw new Error(`Entity ${entityId} not found`);
  return {
    entity_id: r.entity_id,
    state: r.state || "unknown",
    attributes: {
      ...JSON.parse(r.attributes_json || "{}"),
      friendly_name: r.friendly_name,
      area_id: r.area_id,
    }
  };
}

function demoCallService(domain, service, entityId, serviceData, actorId) {
  const device = db.prepare("SELECT * FROM devices WHERE entity_id = ? AND actor_id = ?").get(entityId, actorId);
  if (!device) throw new Error(`Entity ${entityId} not found`);

  const stateRow = db.prepare("SELECT * FROM device_states WHERE entity_id = ? AND actor_id = ?").get(entityId, actorId);
  let currentState = stateRow?.state || "off";
  let attrs = JSON.parse(stateRow?.attributes_json || "{}");

  if (service === "turn_on") currentState = "on";
  else if (service === "turn_off") currentState = "off";
  else if (service === "toggle") currentState = currentState === "on" ? "off" : "on";
  else if (service === "lock") currentState = "locked";
  else if (service === "unlock") currentState = "unlocked";
  else if (service === "open_cover") currentState = "open";
  else if (service === "close_cover") currentState = "closed";
  else if (service === "set_temperature" && serviceData?.temperature != null) {
    attrs.temperature = serviceData.temperature;
    currentState = "cool";
  }

  if (service === "turn_on" && serviceData?.brightness != null) {
    attrs.brightness = serviceData.brightness;
  }

  if (entityId === "switch.bosch_oven") {
    if (service === "turn_on") {
      attrs.program = serviceData?.program || "conventional_heating";
      attrs.target_temperature = serviceData?.temperature || attrs.target_temperature || 180;
      attrs.temperature = attrs.target_temperature;
      db.prepare("INSERT OR REPLACE INTO device_states(entity_id, actor_id, state, attributes_json) VALUES(?, ?, ?, ?)")
        .run("sensor.bosch_oven_temp", actorId, String(attrs.target_temperature), JSON.stringify({ unit_of_measurement: "°C", manufacturer: "Bosch" }));
    } else if (service === "turn_off") {
      attrs.program = "none";
      attrs.temperature = 0;
      db.prepare("INSERT OR REPLACE INTO device_states(entity_id, actor_id, state, attributes_json) VALUES(?, ?, ?, ?)")
        .run("sensor.bosch_oven_temp", actorId, "0", JSON.stringify({ unit_of_measurement: "°C", manufacturer: "Bosch" }));
    }
  }

  db.prepare("INSERT OR REPLACE INTO device_states(entity_id, actor_id, state, attributes_json) VALUES(?, ?, ?, ?)")
    .run(entityId, actorId, currentState, JSON.stringify(attrs));

  return [{ entity_id: entityId, state: currentState, attributes: { ...attrs, friendly_name: device.friendly_name } }];
}

// --- Home Connect (Bosch/Siemens) cloud integration (actor-scoped) -------
const HC_CLIENT_ID = process.env.HC_CLIENT_ID || null;
const HC_CLIENT_SECRET = process.env.HC_CLIENT_SECRET || null;
const HC_REDIRECT_URI = process.env.HC_REDIRECT_URI || "https://app.ateam-ai.com/oauth/callback";
const HC_API_BASE = process.env.HC_USE_SIMULATOR === "1"
  ? "https://simulator.home-connect.com"
  : "https://api.home-connect.com";
const HC_AUTH_BASE = "https://api.home-connect.com";
const HC_SCOPES = "IdentifyAppliance Oven-Monitor Oven-Control Oven-Settings";

function getHCIntegration(actorId) {
  const row = db.prepare("SELECT * FROM integrations WHERE integration_id = 'home_connect' AND actor_id = ?").get(actorId);
  return row ? { ...row, credentials: JSON.parse(row.credentials_json || "{}"), config: JSON.parse(row.config_json || "{}") } : null;
}

function saveHCTokens(tokens, actorId) {
  db.prepare(`INSERT OR REPLACE INTO integrations(integration_id, actor_id, type, status, credentials_json, config_json, updated_at)
    VALUES('home_connect', ?, 'cloud_api', 'connected', ?, '{}', ?)`).run(actorId, JSON.stringify(tokens), now());
}

async function hcFetch(endpoint, actorId, options = {}) {
  const integration = getHCIntegration(actorId);
  if (!integration || integration.status !== "connected") throw new Error("Home Connect not connected. Use homeconnect.auth first.");
  let tokens = integration.credentials;

  if (tokens.expires_at && Date.now() > tokens.expires_at - 60000) {
    const refreshRes = await fetch(`${HC_AUTH_BASE}/security/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: HC_CLIENT_ID,
        client_secret: HC_CLIENT_SECRET || "",
        refresh_token: tokens.refresh_token,
      }),
    });
    if (!refreshRes.ok) throw new Error("Token refresh failed: " + await refreshRes.text());
    const newTokens = await refreshRes.json();
    tokens = { ...tokens, ...newTokens, expires_at: Date.now() + (newTokens.expires_in || 86400) * 1000 };
    saveHCTokens(tokens, actorId);
  }

  const res = await fetch(`${HC_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: "application/vnd.bsh.sdk.v1+json",
      "Content-Type": "application/vnd.bsh.sdk.v1+json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Home Connect API ${res.status}: ${txt}`);
  }
  if (res.status === 204) return {};
  return await res.json();
}

function registerHCAppliance(appliance, actorId) {
  const type = (appliance.type || "").toLowerCase();
  const domain = type === "oven" ? "oven" : type === "dishwasher" ? "dishwasher" : type === "washer" ? "washer" : "appliance";
  const entityId = `homeconnect.${domain}_${appliance.haId.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()}`;
  const caps = ["read_state"];
  if (type === "oven") caps.push("start_program", "stop_program", "set_temperature", "get_programs");

  db.prepare(`INSERT OR REPLACE INTO devices(entity_id, actor_id, domain, friendly_name, capabilities_json, selected, area_id, last_seen)
    VALUES(?, ?, ?, ?, ?, 1, ?, ?)`).run(entityId, actorId, domain, appliance.name || `${appliance.brand} ${appliance.type}`, JSON.stringify(caps), "kitchen", now());
  db.prepare("INSERT OR IGNORE INTO rooms(room_id, actor_id, name) VALUES(?, ?, ?)").run("kitchen", actorId, "Kitchen");
  db.prepare("INSERT OR IGNORE INTO room_devices(room_id, entity_id, actor_id) VALUES(?, ?, ?)").run("kitchen", entityId, actorId);
  db.prepare("INSERT OR REPLACE INTO setup_state(key, actor_id, value_json) VALUES(?, ?, ?)").run(
    `hc_mapping_${entityId}`, actorId, JSON.stringify({ haId: appliance.haId, brand: appliance.brand, type: appliance.type, vib: appliance.vib })
  );

  return { entity_id: entityId, name: appliance.name, brand: appliance.brand, type: appliance.type, haId: appliance.haId };
}

// --- LG TV integration (per-actor connection state) ----------------------
const LG_TV_IP = process.env.LG_TV_IP || null;
const LG_TV_MAC = process.env.LG_TV_MAC || null;
const TV_ENTITY_ID = "media_player.lg_tv";

// Per-actor Maps — each user gets their own TV connection
const tvClients = new Map();      // actorId -> lgtv2 client
const tvConnectedMap = new Map(); // actorId -> boolean
const tvReconnectingMap = new Map(); // actorId -> boolean

function getTVKeyFile(actorId) {
  return path.join(DATA_DIR, `lgtv_clientkey_${actorId}`);
}
function isTVConnected(actorId) { return tvConnectedMap.get(actorId) || false; }
function isTVReconnecting(actorId) { return tvReconnectingMap.get(actorId) || false; }

function tvRequest(uri, payload = {}, actorId) {
  return new Promise((resolve, reject) => {
    const client = tvClients.get(actorId);
    if (!client || !isTVConnected(actorId)) return reject(new Error("TV not connected"));
    client.request(uri, payload, (err, res) => {
      if (err) reject(err); else resolve(res);
    });
  });
}

function tvSubscribeOnce(uri, actorId) {
  return new Promise((resolve, reject) => {
    const client = tvClients.get(actorId);
    if (!client || !isTVConnected(actorId)) return reject(new Error("TV not connected"));
    const unsub = client.subscribe(uri, (err, res) => {
      if (unsub) try { unsub(); } catch {}
      if (err) reject(err); else resolve(res);
    });
    setTimeout(() => reject(new Error("TV subscribe timeout")), 5000);
  });
}

async function getTVState(actorId) {
  const connected = isTVConnected(actorId);
  // Get per-actor IP — from DB or env
  const ipRow = db.prepare("SELECT value_json FROM setup_state WHERE key = 'discovered_tv_ip' AND actor_id = ?").get(actorId);
  const actorIP = ipRow ? JSON.parse(ipRow.value_json).ip : LG_TV_IP;

  if (!connected) {
    return {
      entity_id: TV_ENTITY_ID,
      state: "off",
      attributes: { friendly_name: "LG TV", device_class: "tv", manufacturer: "LG", ip: actorIP || "unknown" }
    };
  }
  try {
    const [volume, app, inputs] = await Promise.allSettled([
      tvSubscribeOnce("ssap://audio/getVolume", actorId),
      tvSubscribeOnce("ssap://com.webos.applicationManager/getForegroundAppInfo", actorId),
      tvRequest("ssap://tv/getExternalInputList", {}, actorId),
    ]);
    const vol = volume.status === "fulfilled" ? volume.value : {};
    const fg = app.status === "fulfilled" ? app.value : {};
    const inp = inputs.status === "fulfilled" ? inputs.value : {};
    return {
      entity_id: TV_ENTITY_ID,
      state: "on",
      attributes: {
        friendly_name: db.prepare("SELECT friendly_name FROM devices WHERE entity_id = ? AND actor_id = ?").get(TV_ENTITY_ID, actorId)?.friendly_name || "LG TV",
        device_class: "tv",
        manufacturer: "LG",
        ip: actorIP,
        volume_level: vol.volume ?? null,
        is_muted: vol.muted ?? false,
        current_app: fg.appId || "unknown",
        source_list: (inp.devices || []).map(d => d.id),
        media_controls: ["play", "pause", "stop", "rewind", "fastForward"],
      }
    };
  } catch {
    return {
      entity_id: TV_ENTITY_ID,
      state: "on",
      attributes: { friendly_name: "LG TV", device_class: "tv", manufacturer: "LG", ip: actorIP }
    };
  }
}

async function callTVService(service, serviceData = {}, actorId) {
  const connected = isTVConnected(actorId);
  const ipRow = db.prepare("SELECT value_json FROM setup_state WHERE key = 'discovered_tv_ip' AND actor_id = ?").get(actorId);
  const actorIP = ipRow ? JSON.parse(ipRow.value_json).ip : LG_TV_IP;

  if (!connected && service !== "turn_on" && actorIP) {
    try { await connectTV(actorIP, actorId); } catch {
      throw new Error("TV is off or not reachable. Use turn_on first.");
    }
  }
  if (!isTVConnected(actorId) && service !== "turn_on") {
    throw new Error("TV is off or not connected. Use turn_on first.");
  }

  switch (service) {
    case "turn_on": {
      if (isTVConnected(actorId)) return [{ entity_id: TV_ENTITY_ID, state: "on" }];
      if (LG_TV_MAC) {
        const wol = (await import("wake_on_lan")).default;
        const subnet = actorIP ? actorIP.replace(/\.\d+$/, ".255") : "255.255.255.255";
        for (let i = 0; i < 3; i++) {
          await new Promise((resolve, reject) => {
            wol.wake(LG_TV_MAC, { address: subnet, num_packets: 3 }, (err) => err ? reject(err) : resolve());
          });
        }
        console.error("[lgtv] Wake-on-LAN sent to " + LG_TV_MAC + " via " + subnet);
        if (actorIP && !isTVConnected(actorId)) {
          await new Promise(r => setTimeout(r, 5000));
          try {
            await connectTV(actorIP, actorId);
            return [{ entity_id: TV_ENTITY_ID, state: "on", attributes: { friendly_name: "LG TV" } }];
          } catch (e) {
            console.error("[lgtv] Reconnect after WoL failed: " + e.message);
          }
        }
        return [{ entity_id: TV_ENTITY_ID, state: "waking_up", attributes: { friendly_name: "LG TV", note: "WoL sent, TV may take 10-15 seconds to boot" } }];
      }
      throw new Error("Cannot turn on TV without MAC address. Set LG_TV_MAC env variable.");
    }
    case "turn_off":
      await tvRequest("ssap://system/turnOff", {}, actorId);
      tvConnectedMap.set(actorId, false);
      return [{ entity_id: TV_ENTITY_ID, state: "off", attributes: { friendly_name: "LG TV" } }];
    case "volume_set":
      await tvRequest("ssap://audio/setVolume", { volume: serviceData.volume_level ?? serviceData.volume ?? 20 }, actorId);
      return [{ entity_id: TV_ENTITY_ID, state: "on", attributes: { friendly_name: "LG TV", volume_level: serviceData.volume_level ?? serviceData.volume } }];
    case "volume_up":
      await tvRequest("ssap://audio/volumeUp", {}, actorId);
      return [{ entity_id: TV_ENTITY_ID, state: "on", attributes: { friendly_name: "LG TV" } }];
    case "volume_down":
      await tvRequest("ssap://audio/volumeDown", {}, actorId);
      return [{ entity_id: TV_ENTITY_ID, state: "on", attributes: { friendly_name: "LG TV" } }];
    case "mute":
      await tvRequest("ssap://audio/setMute", { mute: serviceData.mute ?? true }, actorId);
      return [{ entity_id: TV_ENTITY_ID, state: "on", attributes: { friendly_name: "LG TV", is_muted: serviceData.mute ?? true } }];
    case "select_source":
      await tvRequest("ssap://tv/switchInput", { inputId: serviceData.source }, actorId);
      return [{ entity_id: TV_ENTITY_ID, state: "on", attributes: { friendly_name: "LG TV", source: serviceData.source } }];
    case "launch_app":
      await tvRequest("ssap://system.launcher/launch", { id: serviceData.app_id }, actorId);
      return [{ entity_id: TV_ENTITY_ID, state: "on", attributes: { friendly_name: "LG TV", current_app: serviceData.app_id } }];
    case "media_play":
      await tvRequest("ssap://media.controls/play", {}, actorId);
      return [{ entity_id: TV_ENTITY_ID, state: "on" }];
    case "media_pause":
      await tvRequest("ssap://media.controls/pause", {}, actorId);
      return [{ entity_id: TV_ENTITY_ID, state: "on" }];
    case "send_notification":
      await tvRequest("ssap://system.notifications/createToast", { message: serviceData.message || "Hello!" }, actorId);
      return [{ entity_id: TV_ENTITY_ID, state: "on" }];
    default:
      throw new Error(`Unknown TV service: ${service}`);
  }
}

async function detectTVModel(actorId) {
  try {
    const sys = await tvRequest("ssap://system/getSystemInfo", {}, actorId);
    const sw = await tvRequest("ssap://com.webos.service.update/getCurrentSWInformation", {}, actorId);
    return {
      model: sys?.modelName || "LG TV",
      serial: sys?.serialNumber || null,
      webos: sw?.product_name || null,
      mac: sw?.device_id || LG_TV_MAC || null,
      country: sw?.country || null,
    };
  } catch { return { model: "LG TV" }; }
}

function registerTVEntity(tvInfo = {}, actorId) {
  const model = tvInfo.model || "LG TV";
  const friendlyName = `LG ${model}`;
  const caps = ["read_state", "turn_on", "turn_off", "volume_set", "volume_up", "volume_down", "mute", "select_source", "launch_app", "media_play", "media_pause", "send_notification"];
  db.prepare(`INSERT OR REPLACE INTO devices(entity_id, actor_id, domain, friendly_name, capabilities_json, selected, area_id, last_seen)
    VALUES(?, ?, ?, ?, ?, 1, ?, ?)`).run(TV_ENTITY_ID, actorId, "media_player", friendlyName, JSON.stringify(caps), "living_room", now());
  db.prepare("INSERT OR IGNORE INTO rooms(room_id, actor_id, name) VALUES(?, ?, ?)").run("living_room", actorId, "Living Room");
  db.prepare("INSERT OR IGNORE INTO room_devices(room_id, entity_id, actor_id) VALUES(?, ?, ?)").run("living_room", TV_ENTITY_ID, actorId);
  console.error("[lgtv] Registered TV entity for actor: " + actorId);
}

async function connectTV(ip, actorId) {
  if (isTVReconnecting(actorId)) return;
  tvReconnectingMap.set(actorId, true);
  const lgtv2 = (await import("lgtv2")).default;

  return new Promise((resolve, reject) => {
    const client = lgtv2({
      url: `ws://${ip}:3000`,
      keyFile: getTVKeyFile(actorId),
      reconnect: false,
    });

    const timeout = setTimeout(() => {
      tvReconnectingMap.set(actorId, false);
      reject(new Error("TV connection timeout — is the TV on and on the same network?"));
    }, 20000);

    client.on("prompt", () => {
      console.error("[lgtv] >>> Accept the connection on your TV screen <<<");
    });

    client.on("connect", async () => {
      clearTimeout(timeout);
      tvClients.set(actorId, client);
      tvConnectedMap.set(actorId, true);
      tvReconnectingMap.set(actorId, false);
      const tvInfo = await detectTVModel(actorId);
      registerTVEntity(tvInfo, actorId);
      console.error("[lgtv] Connected to LG " + tvInfo.model + " at " + ip + " for actor: " + actorId);
      resolve({ connected: true, ip, entity_id: TV_ENTITY_ID, model: tvInfo.model, webos: tvInfo.webos, mac: tvInfo.mac });
    });

    client.on("close", () => {
      tvConnectedMap.set(actorId, false);
      console.error("[lgtv] TV disconnected for actor: " + actorId);
    });

    client.on("error", (err) => {
      console.error("[lgtv] Error for actor " + actorId + ": " + (err?.message || err));
    });
  });
}

// --- WhatsApp Business API integration (actor-scoped) --------------------
const WA_API_BASE = "https://graph.facebook.com/v21.0";

function getWAIntegration(actorId) {
  const row = db.prepare("SELECT * FROM integrations WHERE integration_id = 'whatsapp' AND actor_id = ?").get(actorId);
  return row ? { ...row, credentials: JSON.parse(row.credentials_json || "{}"), config: JSON.parse(row.config_json || "{}") } : null;
}

function saveWACredentials(creds, actorId) {
  db.prepare(`INSERT OR REPLACE INTO integrations(integration_id, actor_id, type, status, credentials_json, config_json, updated_at)
    VALUES('whatsapp', ?, 'cloud_api', 'connected', ?, '{}', ?)`).run(actorId, JSON.stringify(creds), now());
}

async function waFetch(endpoint, actorId, options = {}) {
  const integration = getWAIntegration(actorId);
  if (!integration || integration.status !== "connected") throw new Error("WhatsApp not connected. Use whatsapp.auth first.");
  const creds = integration.credentials;
  const res = await fetch(`${WA_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${creds.access_token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${JSON.stringify(body.error || body)}`);
  return body;
}

// --- Business logic (actor-scoped) ----------------------------------------
function configSummary(actorId) {
  const devices = db.prepare("SELECT * FROM devices WHERE actor_id = ? ORDER BY domain, friendly_name").all(actorId).map(r => ({
    entity_id: r.entity_id,
    domain: r.domain,
    friendly_name: r.friendly_name,
    capabilities: JSON.parse(r.capabilities_json || "[]"),
    selected: !!r.selected,
    area_id: r.area_id || null,
    last_seen: r.last_seen
  }));
  return { version: "0.4.0", devices, updated_at: now() };
}

function roomsList(actorId) {
  const rows = db.prepare(`
    SELECT r.room_id, r.name, rd.entity_id, d.friendly_name
    FROM rooms r
    LEFT JOIN room_devices rd ON rd.room_id = r.room_id AND rd.actor_id = r.actor_id
    LEFT JOIN devices d ON d.entity_id = rd.entity_id AND d.actor_id = r.actor_id
    WHERE r.actor_id = ?
    ORDER BY r.name, d.friendly_name
  `).all(actorId);
  const out = {};
  for (const row of rows) {
    if (!out[row.room_id]) out[row.room_id] = { room_id: row.room_id, name: row.name, devices: [] };
    if (row.entity_id) out[row.room_id].devices.push({
      entity_id: row.entity_id,
      name: row.friendly_name || row.entity_id
    });
  }
  return { rooms: Object.values(out) };
}

async function syncRooms(actorId) {
  if (DEMO_MODE) return roomsList(actorId);
  let areas = [], registryDevices = [], states = [];
  try {
    areas = await ha("/api/config/area_registry/list", { method: "POST", body: "{}" });
    registryDevices = await ha("/api/config/device_registry/list", { method: "POST", body: "{}" });
    states = await ha("/api/states");
  } catch {
    return roomsList(actorId);
  }

  db.prepare("DELETE FROM rooms WHERE actor_id = ?").run(actorId);
  db.prepare("DELETE FROM room_devices WHERE actor_id = ?").run(actorId);

  const insertRoom = db.prepare("INSERT INTO rooms(room_id, actor_id, name) VALUES(?, ?, ?)");
  const insertMap = db.prepare("INSERT OR IGNORE INTO room_devices(room_id, entity_id, actor_id) VALUES(?, ?, ?)");
  const upsertDevice = db.prepare(`
    INSERT OR REPLACE INTO devices(entity_id, actor_id, domain, friendly_name, capabilities_json, selected, area_id, last_seen)
    VALUES(?, ?, ?, ?, ?, COALESCE((SELECT selected FROM devices WHERE entity_id = ? AND actor_id = ?), 0), ?, ?)
  `);

  for (const area of areas) insertRoom.run(area.area_id, actorId, area.name);

  const byDeviceId = new Map();
  for (const d of registryDevices) byDeviceId.set(d.id, d);

  for (const s of states) {
    const attrs = s.attributes || {};
    const deviceId = attrs.device_id || null;
    const reg = deviceId ? byDeviceId.get(deviceId) : null;
    const areaId = reg?.area_id || attrs.area_id || null;
    upsertDevice.run(s.entity_id, actorId, String(s.entity_id || "").split(".")[0], attrs.friendly_name || s.entity_id, JSON.stringify(deriveCapabilities(s.entity_id)), s.entity_id, actorId, areaId, now());
    if (areaId) insertMap.run(areaId, s.entity_id, actorId);
  }
  return roomsList(actorId);
}

async function entitiesList(actorId) {
  if (DEMO_MODE) {
    seedDemoData(actorId);
    return configSummary(actorId).devices;
  }
  const states = await ha("/api/states");
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO devices(entity_id, actor_id, domain, friendly_name, capabilities_json, selected, area_id, last_seen)
    VALUES(?, ?, ?, ?, ?, COALESCE((SELECT selected FROM devices WHERE entity_id = ? AND actor_id = ?), 0), COALESCE((SELECT area_id FROM devices WHERE entity_id = ? AND actor_id = ?), NULL), ?)
  `);
  for (const s of states) {
    stmt.run(s.entity_id, actorId, String(s.entity_id || "").split(".")[0], s.attributes?.friendly_name || s.entity_id, JSON.stringify(deriveCapabilities(s.entity_id)), s.entity_id, actorId, s.entity_id, actorId, now());
  }
  return configSummary(actorId).devices;
}

async function callTool(name, args = {}) {
  const actorId = getActorId(args);

  switch (name) {
    case "entities.list": {
      const list = await entitiesList(actorId);
      const ipRow = db.prepare("SELECT value_json FROM setup_state WHERE key = 'discovered_tv_ip' AND actor_id = ?").get(actorId);
      const actorIP = ipRow ? JSON.parse(ipRow.value_json).ip : LG_TV_IP;
      if (actorIP) {
        const exists = list.some(d => d.entity_id === TV_ENTITY_ID);
        if (!exists) list.push({
          entity_id: TV_ENTITY_ID, domain: "media_player", friendly_name: "LG TV",
          capabilities: ["read_state", "turn_on", "turn_off", "volume_set", "volume_up", "volume_down", "mute", "select_source", "launch_app"],
          selected: true, area_id: "living_room", last_seen: now()
        });
      }
      return list;
    }
    case "entity.state": {
      const ipRow = db.prepare("SELECT value_json FROM setup_state WHERE key = 'discovered_tv_ip' AND actor_id = ?").get(actorId);
      const actorIP = ipRow ? JSON.parse(ipRow.value_json).ip : LG_TV_IP;
      if (args.entity_id === TV_ENTITY_ID && actorIP) return await getTVState(actorId);
      if (DEMO_MODE) return demoGetState(args.entity_id, actorId);
      return await ha(`/api/states/${encodeURIComponent(args.entity_id)}`);
    }
    case "services.call": {
      let result;
      if (args.entity_id === TV_ENTITY_ID || args.domain === "media_player") {
        result = await callTVService(args.service, args.service_data, actorId);
      } else if (DEMO_MODE) {
        result = demoCallService(args.domain, args.service, args.entity_id, args.service_data, actorId);
      } else {
        const body = { entity_id: args.entity_id, ...(args.service_data || {}) };
        result = await ha(`/api/services/${args.domain}/${args.service}`, { method: "POST", body: JSON.stringify(body) });
      }
      db.prepare("INSERT INTO test_runs(id, actor_id, entity_id, action, status, created_at) VALUES(?, ?, ?, ?, ?, ?)")
        .run(`test_${Date.now()}`, actorId, args.entity_id || TV_ENTITY_ID, `${args.domain}.${args.service}`, "ok", now());
      return result;
    }
    case "tv.discover": {
      const connected = isTVConnected(actorId);
      if (connected) return { connected: true, ip: LG_TV_IP, entity_id: TV_ENTITY_ID, state: await getTVState(actorId) };

      let discoveredIP = LG_TV_IP;
      if (!discoveredIP) {
        // Check if actor has a previously discovered IP
        const ipRow = db.prepare("SELECT value_json FROM setup_state WHERE key = 'discovered_tv_ip' AND actor_id = ?").get(actorId);
        if (ipRow) discoveredIP = JSON.parse(ipRow.value_json).ip;
      }
      if (!discoveredIP) {
        discoveredIP = await new Promise((resolve) => {
          import("node:dgram").then(({ default: dgram }) => {
            const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
            const MSG = Buffer.from(
              "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 3\r\nST: urn:lge-com:service:webos-second-screen:1\r\n\r\n"
            );
            let found = null;
            socket.on("message", (msg, rinfo) => {
              const txt = msg.toString();
              if (!found && (txt.includes("LG") || txt.includes("webos") || txt.includes("lge-com"))) {
                found = rinfo.address;
                socket.close();
                resolve(found);
              }
            });
            socket.bind(() => {
              socket.addMembership("239.255.255.250");
              socket.send(MSG, 1900, "239.255.255.250");
            });
            setTimeout(() => { try { socket.close(); } catch {} resolve(null); }, 5000);
          });
        });
        if (!discoveredIP) return { connected: false, error: "No LG TV found on network. Make sure your TV is on, 'LG Connect Apps' is enabled in TV settings, and you're on the same network. Or set LG_TV_IP manually." };
        db.prepare("INSERT OR REPLACE INTO setup_state(key, actor_id, value_json) VALUES(?, ?, ?)").run("discovered_tv_ip", actorId, JSON.stringify({ ip: discoveredIP, discovered_at: now() }));
        console.error("[lgtv] Auto-discovered TV at " + discoveredIP + " for actor: " + actorId);
      }
      try {
        return await connectTV(discoveredIP, actorId);
      } catch (e) {
        return { connected: false, error: e.message };
      }
    }
    case "tv.apps": {
      if (!isTVConnected(actorId)) return { error: "TV not connected" };
      const res = await tvRequest("ssap://com.webos.applicationManager/listLaunchPoints", {}, actorId);
      return { apps: (res.launchPoints || []).map(a => ({ id: a.id, title: a.title })) };
    }
    case "tv.inputs": {
      if (!isTVConnected(actorId)) return { error: "TV not connected" };
      const res = await tvRequest("ssap://tv/getExternalInputList", {}, actorId);
      return { inputs: (res.devices || []).map(d => ({ id: d.id, label: d.label, connected: d.connected })) };
    }

    case "discovery.supported": {
      const waIntegration = getWAIntegration(actorId);
      return {
        integrations: [
          { id: "home_connect", name: "Bosch / Siemens Home Connect", type: "cloud_api", status: getHCIntegration(actorId)?.status || "disconnected", devices: ["Ovens", "Dishwashers", "Washers", "Dryers", "Coffee Machines"], setup: "OAuth2 — user authorizes via Home Connect website, then provides the code back in chat", requires: "Home Connect account + app paired with appliance" },
          { id: "lgtv", name: "LG WebOS TV", type: "local_network", status: isTVConnected(actorId) ? "connected" : "disconnected", devices: ["LG Smart TVs (2014+)"], setup: "Local network — connector discovers TV via SSDP, user accepts pairing on TV screen", requires: "TV on same network, 'LG Connect Apps' enabled in TV settings" },
          { id: "homeassistant", name: "Home Assistant", type: "local_api", status: HA_URL ? "connected" : "disconnected", devices: ["All Home Assistant devices"], setup: "API token — user provides HA URL and long-lived access token", requires: "Home Assistant instance with API access" },
          { id: "hue", name: "Philips Hue", type: "local_network", status: "disconnected", devices: ["Lights", "Light Strips", "Smart Plugs", "Motion Sensors", "Switches"], setup: "Local bridge pairing — press the link button on your Hue Bridge, then run hue.auth", requires: "Philips Hue Bridge on same network" },
          { id: "tuya", name: "Tuya / Smart Life", type: "cloud_api", status: "disconnected", devices: ["Lights", "Switches", "Plugs", "Sensors", "Cameras", "Thermostats", "Robot Vacuums"], setup: "Cloud API — requires Tuya IoT Platform developer account with Access ID and Secret", requires: "Tuya IoT Platform account at iot.tuya.com" },
          { id: "google_home", name: "Google Home / Nest", type: "cloud_api", status: "disconnected", devices: ["Nest Thermostats", "Nest Cameras", "Nest Doorbells", "Nest Displays"], setup: "OAuth2 via Google Device Access — requires $5 registration fee", requires: "Google Device Access project + OAuth credentials" },
          { id: "whatsapp", name: "WhatsApp Business", type: "cloud_api", status: waIntegration?.status || "disconnected", devices: [], setup: "WhatsApp Business API — requires Meta Business account + permanent access token", requires: "Meta Business account at business.facebook.com" }
        ]
      };
    }
    case "discovery.status": {
      const integrations = db.prepare("SELECT * FROM integrations WHERE actor_id = ?").all(actorId).map(r => ({
        id: r.integration_id, type: r.type, status: r.status, updated_at: r.updated_at
      }));
      const ipRow = db.prepare("SELECT value_json FROM setup_state WHERE key = 'discovered_tv_ip' AND actor_id = ?").get(actorId);
      const actorIP = ipRow ? JSON.parse(ipRow.value_json).ip : LG_TV_IP;
      return {
        integrations,
        tv: { connected: isTVConnected(actorId), ip: actorIP },
        homeassistant: { connected: !!HA_URL, url: HA_URL || null },
        demo_mode: DEMO_MODE,
        actor_id: actorId,
        total_devices: db.prepare("SELECT COUNT(*) as c FROM devices WHERE actor_id = ?").get(actorId).c,
      };
    }

    case "homeconnect.auth": {
      if (!HC_CLIENT_ID) return { error: "Home Connect not configured. Set HC_CLIENT_ID and HC_CLIENT_SECRET environment variables. Register at https://developer.home-connect.com/" };
      const authUrl = `${HC_AUTH_BASE}/security/oauth/authorize?response_type=code&client_id=${encodeURIComponent(HC_CLIENT_ID)}&redirect_uri=${encodeURIComponent(HC_REDIRECT_URI)}&scope=${encodeURIComponent(HC_SCOPES)}&state=smartHome`;
      return { action: "Please open this URL in your browser and authorize the connection:", auth_url: authUrl, next_step: "After authorizing, copy the 'code' parameter from the redirect URL and provide it using homeconnect.callback.", note: "If you don't have a Home Connect account yet, download the Home Connect app and pair your appliance first." };
    }
    case "homeconnect.callback": {
      if (!args.code) return { error: "Provide the authorization code from the redirect URL" };
      if (!HC_CLIENT_ID) return { error: "HC_CLIENT_ID not configured" };
      const tokenRes = await fetch(`${HC_AUTH_BASE}/security/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: HC_CLIENT_ID, client_secret: HC_CLIENT_SECRET || "", code: args.code, redirect_uri: HC_REDIRECT_URI }),
      });
      if (!tokenRes.ok) return { error: `Authorization failed: ${await tokenRes.text()}` };
      const tokens = await tokenRes.json();
      tokens.expires_at = Date.now() + (tokens.expires_in || 86400) * 1000;
      saveHCTokens(tokens, actorId);
      try {
        const appliances = await hcFetch("/api/homeappliances", actorId);
        const registered = (appliances.data?.homeappliances || []).map(a => registerHCAppliance(a, actorId));
        return { connected: true, appliances: registered };
      } catch {
        return { connected: true, appliances: [], note: "Connected but couldn't fetch appliances yet. Try homeconnect.appliances." };
      }
    }
    case "homeconnect.appliances": {
      const data = await hcFetch("/api/homeappliances", actorId);
      const appliances = data.data?.homeappliances || [];
      return { appliances: appliances.map(a => registerHCAppliance(a, actorId)) };
    }
    case "homeconnect.status": {
      if (!args.ha_id) return { error: "Provide ha_id (appliance ID)" };
      const data = await hcFetch(`/api/homeappliances/${encodeURIComponent(args.ha_id)}/status`, actorId);
      return data.data || data;
    }
    case "homeconnect.programs": {
      if (!args.ha_id) return { error: "Provide ha_id (appliance ID)" };
      const data = await hcFetch(`/api/homeappliances/${encodeURIComponent(args.ha_id)}/programs/available`, actorId);
      return data.data || data;
    }
    case "homeconnect.start_program": {
      if (!args.ha_id || !args.program_key) return { error: "Provide ha_id and program_key" };
      const options = [];
      if (args.temperature) options.push({ key: "Cooking.Oven.Option.SetpointTemperature", value: args.temperature, unit: "°C" });
      if (args.duration) options.push({ key: "BSH.Common.Option.Duration", value: args.duration, unit: "seconds" });
      await hcFetch(`/api/homeappliances/${encodeURIComponent(args.ha_id)}/programs/active`, actorId, { method: "PUT", body: JSON.stringify({ data: { key: args.program_key, options } }) });
      return { started: true, program: args.program_key, temperature: args.temperature, duration: args.duration };
    }
    case "homeconnect.stop_program": {
      if (!args.ha_id) return { error: "Provide ha_id" };
      await hcFetch(`/api/homeappliances/${encodeURIComponent(args.ha_id)}/programs/active`, actorId, { method: "DELETE" });
      return { stopped: true };
    }

    case "whatsapp.auth": {
      if (!args.phone_number_id || !args.access_token) return { error: "Provide phone_number_id and access_token from Meta Business Suite" };
      try {
        const res = await fetch(`${WA_API_BASE}/${encodeURIComponent(args.phone_number_id)}`, { headers: { Authorization: `Bearer ${args.access_token}` } });
        const data = await res.json();
        if (!res.ok) return { connected: false, error: `Invalid credentials: ${JSON.stringify(data.error?.message || data)}` };
        const creds = { phone_number_id: args.phone_number_id, access_token: args.access_token, business_id: args.business_id || null, display_phone: data.display_phone_number || data.verified_name || args.phone_number_id, business_name: data.verified_name || null };
        saveWACredentials(creds, actorId);
        return { connected: true, phone_number_id: creds.phone_number_id, display_phone: creds.display_phone, business_name: creds.business_name };
      } catch (e) { return { connected: false, error: e.message }; }
    }
    case "whatsapp.status": {
      const wa = getWAIntegration(actorId);
      if (!wa || wa.status !== "connected") return { connected: false };
      const creds = wa.credentials;
      return { connected: true, phone_number_id: creds.phone_number_id, display_phone: creds.display_phone || null, business_name: creds.business_name || null };
    }
    case "whatsapp.send": {
      if (!args.to || !args.message) return { error: "Provide 'to' (phone) and 'message' (text)" };
      const wa = getWAIntegration(actorId);
      if (!wa || wa.status !== "connected") return { error: "WhatsApp not connected" };
      const creds = wa.credentials;
      try {
        const res = await fetch(`${WA_API_BASE}/${encodeURIComponent(creds.phone_number_id)}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${creds.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", to: args.to.replace(/[^0-9]/g, ""), type: "text", text: { body: args.message } }),
        });
        const data = await res.json();
        if (!res.ok) return { sent: false, error: data.error?.message || JSON.stringify(data) };
        return { sent: true, message_id: data.messages?.[0]?.id };
      } catch (e) { return { sent: false, error: e.message }; }
    }
    case "whatsapp.test": {
      if (!args.to) return { error: "Provide 'to' phone number (with country code, e.g. +1234567890)" };
      const wa = getWAIntegration(actorId);
      if (!wa || wa.status !== "connected") return { error: "WhatsApp not connected. Use whatsapp.auth first." };
      const creds = wa.credentials;
      try {
        const res = await fetch(`${WA_API_BASE}/${encodeURIComponent(creds.phone_number_id)}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${creds.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", to: args.to.replace(/[^0-9]/g, ""), type: "template", template: { name: "hello_world", language: { code: "en_US" } } }),
        });
        const data = await res.json();
        if (!res.ok) return { sent: false, error: data.error?.message || JSON.stringify(data) };
        return { sent: true, message_id: data.messages?.[0]?.id, to: args.to };
      } catch (e) { return { sent: false, error: e.message }; }
    }
    case "whatsapp.disconnect": {
      db.prepare("DELETE FROM integrations WHERE integration_id = 'whatsapp' AND actor_id = ?").run(actorId);
      return { disconnected: true };
    }

    case "config.get":
      return configSummary(actorId);
    case "config.save": {
      for (const device of (args.config?.devices || [])) {
        db.prepare("UPDATE devices SET selected = ? WHERE entity_id = ? AND actor_id = ?").run(device.selected ? 1 : 0, device.entity_id, actorId);
      }
      return { ok: true, ...configSummary(actorId) };
    }
    case "rooms.list":
      return roomsList(actorId);
    case "rooms.sync":
      return await syncRooms(actorId);
    case "ui.listPlugins":
      return { plugins: [
        { id: "mcp:home-assistant-mcp:home-layout-panel", name: "Home Layout Panel", version: "1.0.0", description: "Smart home dashboard with rooms, devices, quick controls, and multi-provider status", render: { mode: "adaptive", iframeUrl: "/ui/home-layout-panel/index.html", reactNative: { component: "HomeLayoutPanel" } } },
        { id: "mcp:home-assistant-mcp:whatsapp-setup", name: "WhatsApp Setup", version: "1.0.0", description: "Setup wizard for WhatsApp Business API", render: { mode: "adaptive", iframeUrl: "/ui/whatsapp-setup/index.html", reactNative: { component: "WhatsAppSetup" } } }
      ]};
    case "ui.getPlugin": {
      const pluginId = args.id || "home-layout-panel";
      const plugins = {
        "home-layout-panel": { id: "mcp:home-assistant-mcp:home-layout-panel", name: "Home Layout Panel", version: "1.0.0", description: "Smart home dashboard", render: { mode: "adaptive", iframeUrl: "/ui/home-layout-panel/index.html", reactNative: { component: "HomeLayoutPanel" } }, channels: ["command"], capabilities: { haptics: true, commands: [] } },
        "whatsapp-setup": { id: "mcp:home-assistant-mcp:whatsapp-setup", name: "WhatsApp Setup", version: "1.0.0", description: "WhatsApp Business API setup wizard", render: { mode: "adaptive", iframeUrl: "/ui/whatsapp-setup/index.html", reactNative: { component: "WhatsAppSetup" } }, channels: ["command"], capabilities: { haptics: false, commands: [] } }
      };
      const plugin = plugins[pluginId] || plugins["home-layout-panel"];
      return plugin;
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

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
          serverInfo: { name: "home-assistant-mcp", version: "0.5.0" }
        });
        continue;
      }
      if (method === "tools/list") {
        writeResult(id, { tools: [
          { name: "entities.list", description: "List all smart home devices for the current user" },
          { name: "entity.state", description: "Get current state of a device", inputSchema: { type: "object", properties: { entity_id: { type: "string" } }, required: ["entity_id"] } },
          { name: "services.call", description: "Call a service on a device (turn on/off, set temperature, etc.)", inputSchema: { type: "object", properties: { domain: { type: "string" }, service: { type: "string" }, entity_id: { type: "string" }, service_data: { type: "object" } }, required: ["domain", "service", "entity_id"] } },
          { name: "config.get", description: "Get the current device configuration for the current user" },
          { name: "config.save", description: "Update device configuration", inputSchema: { type: "object", properties: { config: { type: "object" } } } },
          { name: "rooms.list", description: "List all rooms and their devices for the current user" },
          { name: "rooms.sync", description: "Sync rooms and devices from Home Assistant" },
          { name: "discovery.supported", description: "List all supported device integrations and their connection status" },
          { name: "discovery.status", description: "Get current status of all connected integrations and device count" },
          { name: "homeconnect.auth", description: "Start Bosch/Siemens Home Connect authorization — returns URL for user to authorize" },
          { name: "homeconnect.callback", description: "Complete Home Connect authorization with the code from redirect", inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },
          { name: "homeconnect.appliances", description: "List all Home Connect appliances for the current user" },
          { name: "homeconnect.status", description: "Get real-time status of a Home Connect appliance", inputSchema: { type: "object", properties: { ha_id: { type: "string" } }, required: ["ha_id"] } },
          { name: "homeconnect.programs", description: "List available programs for a Home Connect oven", inputSchema: { type: "object", properties: { ha_id: { type: "string" } }, required: ["ha_id"] } },
          { name: "homeconnect.start_program", description: "Start an oven program with temperature and duration", inputSchema: { type: "object", properties: { ha_id: { type: "string" }, program_key: { type: "string" }, temperature: { type: "number" }, duration: { type: "number" } }, required: ["ha_id", "program_key"] } },
          { name: "homeconnect.stop_program", description: "Stop the currently running program", inputSchema: { type: "object", properties: { ha_id: { type: "string" } }, required: ["ha_id"] } },
          { name: "tv.discover", description: "Discover and connect to the LG TV on the local network (SSDP auto-discovery, per user)" },
          { name: "tv.apps", description: "List all apps installed on the LG TV" },
          { name: "tv.inputs", description: "List all HDMI/external inputs on the LG TV" },
          { name: "whatsapp.auth", description: "Connect WhatsApp Business API", inputSchema: { type: "object", properties: { phone_number_id: { type: "string" }, access_token: { type: "string" }, business_id: { type: "string" } }, required: ["phone_number_id", "access_token"] } },
          { name: "whatsapp.status", description: "Get WhatsApp Business connection status" },
          { name: "whatsapp.send", description: "Send a WhatsApp message", inputSchema: { type: "object", properties: { to: { type: "string" }, message: { type: "string" } }, required: ["to", "message"] } },
          { name: "whatsapp.test", description: "Send a test WhatsApp message using hello_world template", inputSchema: { type: "object", properties: { to: { type: "string" } }, required: ["to"] } },
          { name: "whatsapp.disconnect", description: "Disconnect WhatsApp Business API" },
          { name: "ui.listPlugins", description: "List available UI plugins" },
          { name: "ui.getPlugin", description: "Get a specific UI plugin", inputSchema: { type: "object", properties: { id: { type: "string" } } } }
        ]});
        continue;
      }
      if (method === "tools/call") {
        const result = await callTool(params.name, params.arguments || {});
        writeResult(id, { content: [{ type: "text", text: JSON.stringify(result) }] });
        continue;
      }
      writeError(id, `Unsupported method ${method}`);
    } catch (err) {
      writeError(id, err instanceof Error ? err.message : String(err));
    }
  }
});
