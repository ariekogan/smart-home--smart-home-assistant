var __create = Object.create;
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// rn-src/index.tsx
var index_exports = {};
__export(index_exports, {
  HomeLayoutPanel: () => home_layout_panel_default,
  WhatsAppSetup: () => whatsapp_setup_default
});
module.exports = __toCommonJS(index_exports);

// plugins/home-layout-panel/index.tsx
var import_react = __toESM(require("react"));
var import_react_native = require("react-native");

// plugin-sdk/index.ts
var import_plugin_sdk = require("@adas/plugin-sdk");

// plugins/home-layout-panel/index.tsx
var DOMAIN_ICONS = {
  light: "\u{1F4A1}",
  switch: "\u{1F50C}",
  climate: "\u{1F321}\uFE0F",
  lock: "\u{1F512}",
  cover: "\u{1F6AA}",
  media_player: "\u{1F4FA}",
  sensor: "\u{1F4CA}",
  fan: "\u{1F32C}\uFE0F",
  vacuum: "\u{1F9F9}",
  camera: "\u{1F4F7}"
};
function getDomain(eid) {
  return eid.split(".")[0];
}
function getIcon(eid) {
  return DOMAIN_ICONS[getDomain(eid)] || "\u2B55";
}
function isOn(eid, state) {
  const d = getDomain(eid);
  if (d === "lock") return state === "locked";
  if (d === "cover") return state === "open";
  if (d === "sensor" || d === "binary_sensor") return state !== "unavailable";
  return state !== "off" && state !== "unknown" && state !== "unavailable";
}
function stateLabel(eid, state) {
  const d = getDomain(eid);
  if (d === "lock") return state === "locked" ? "Locked" : "Unlocked";
  if (d === "cover") return state === "closed" ? "Closed" : "Open";
  if (d === "sensor") return state || "--";
  if (state === "on") return "On";
  if (state === "off") return "Off";
  return state ? state.charAt(0).toUpperCase() + state.slice(1) : "Unknown";
}
function isQuickControl(eid) {
  return ["light", "switch", "media_player", "fan", "climate"].includes(getDomain(eid));
}
function isClimate(eid) {
  const d = getDomain(eid);
  return d === "sensor" && (eid.includes("temperature") || eid.includes("humidity"));
}
function isSecurity(eid) {
  const d = getDomain(eid);
  return d === "lock" || d === "cover";
}
var home_layout_panel_default = import_plugin_sdk.PluginSDK.register("home-layout-panel", {
  type: "ui",
  version: "1.0.0",
  capabilities: { haptics: true },
  Component({ bridge, native, theme }) {
    var _a;
    const api = (0, import_plugin_sdk.useApi)(bridge);
    const [rooms, setRooms] = (0, import_react.useState)([]);
    const [states, setStates] = (0, import_react.useState)({});
    const [loading, setLoading] = (0, import_react.useState)(true);
    const [refreshing, setRefreshing] = (0, import_react.useState)(false);
    const [error, setError] = (0, import_react.useState)(null);
    const [expandedRooms, setExpandedRooms] = (0, import_react.useState)(/* @__PURE__ */ new Set([0, 1]));
    const [providers, setProviders] = (0, import_react.useState)({ HA: true });
    const c = theme.colors;
    const loadData = (0, import_react.useCallback)((isRefresh = false) => __async(null, null, function* () {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const roomData = yield api.call("rooms.list", {});
        const roomList = roomData.rooms || [];
        setRooms(roomList);
        const entityIds = roomList.flatMap((r) => (r.devices || []).map((d) => d.entity_id));
        const stateResults = yield Promise.all(
          entityIds.map(
            (eid) => api.call("entity.state", { entity_id: eid }).then((s3) => [eid, { state: s3.state || "unknown", attrs: s3.attributes || {} }]).catch(() => [eid, { state: "unknown", attrs: {} }])
          )
        );
        const stateMap = {};
        for (const [eid, s3] of stateResults) stateMap[eid] = s3;
        setStates(stateMap);
        const prov = { HA: true };
        try {
          const hue = yield api.call("hue.status", {});
          prov.Hue = (hue == null ? void 0 : hue.connected) === true;
        } catch (e) {
          prov.Hue = false;
        }
        try {
          const tuya = yield api.call("tuya.status", {});
          prov.Tuya = (tuya == null ? void 0 : tuya.connected) === true;
        } catch (e) {
          prov.Tuya = false;
        }
        try {
          const goog = yield api.call("google.status", {});
          prov.Nest = (goog == null ? void 0 : goog.connected) === true;
        } catch (e) {
          prov.Nest = false;
        }
        setProviders(prov);
        setError(null);
      } catch (err) {
        setError(err.message || "Failed to load");
        native.haptics.error();
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    }), [api, native]);
    (0, import_react.useEffect)(() => {
      loadData();
    }, []);
    const toggleDevice = (0, import_react.useCallback)((eid) => __async(null, null, function* () {
      var _a2;
      const domain = getDomain(eid);
      if (!["light", "switch", "fan", "media_player", "climate"].includes(domain)) return;
      native.haptics.selection();
      const currentState = (_a2 = states[eid]) == null ? void 0 : _a2.state;
      const turnOn = !isOn(eid, currentState);
      const newState = turnOn ? "on" : "off";
      setStates((prev) => __spreadProps(__spreadValues({}, prev), { [eid]: __spreadProps(__spreadValues({}, prev[eid]), { state: newState }) }));
      try {
        yield api.call("services.call", {
          domain,
          service: turnOn ? "turn_on" : "turn_off",
          entity_id: eid
        });
        try {
          const fresh = yield api.call("entity.state", { entity_id: eid });
          setStates((prev) => __spreadProps(__spreadValues({}, prev), { [eid]: { state: fresh.state || newState, attrs: fresh.attributes || {} } }));
        } catch (e) {
        }
      } catch (e) {
        setStates((prev) => __spreadProps(__spreadValues({}, prev), { [eid]: __spreadProps(__spreadValues({}, prev[eid]), { state: currentState || "unknown" }) }));
        native.haptics.error();
      }
    }), [api, states, native]);
    const toggleRoom = (idx) => {
      setExpandedRooms((prev) => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        return next;
      });
    };
    const quickDevices = rooms.flatMap(
      (r) => (r.devices || []).filter((d) => isQuickControl(d.entity_id)).map((d) => __spreadProps(__spreadValues({}, d), { room: r.name, provider: "HA" }))
    ).slice(0, 8);
    const climateDevices = rooms.flatMap(
      (r) => (r.devices || []).filter((d) => isClimate(d.entity_id)).map((d) => __spreadProps(__spreadValues({}, d), { room: r.name }))
    );
    const securityDevices = rooms.flatMap(
      (r) => (r.devices || []).filter((d) => isSecurity(d.entity_id)).map((d) => __spreadProps(__spreadValues({}, d), { room: r.name }))
    );
    const onCount = Object.entries(states).filter(([eid, s3]) => isOn(eid, s3.state) && !eid.startsWith("sensor.")).length;
    if (loading) {
      return /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: [s.center, { backgroundColor: c.bg }] }, /* @__PURE__ */ import_react.default.createElement(import_react_native.ActivityIndicator, { size: "large", color: c.accent }), /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: [s.loadingText, { color: c.textMuted }] }, "Loading home..."));
    }
    if (error && rooms.length === 0) {
      return /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: [s.center, { backgroundColor: c.bg }] }, /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: { color: c.error, fontSize: 16 } }, "\u26A0 ", error), /* @__PURE__ */ import_react.default.createElement(import_react_native.Pressable, { style: [s.retryBtn, { borderColor: c.accent }], onPress: () => loadData() }, /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: { color: c.accent } }, "Retry")));
    }
    return /* @__PURE__ */ import_react.default.createElement(
      import_react_native.ScrollView,
      {
        style: { flex: 1, backgroundColor: c.bg },
        refreshControl: /* @__PURE__ */ import_react.default.createElement(import_react_native.RefreshControl, { refreshing, onRefresh: () => loadData(true), tintColor: c.accent })
      },
      /* @__PURE__ */ import_react.default.createElement(import_react_native.ScrollView, { horizontal: true, showsHorizontalScrollIndicator: false, style: s.statusBar, contentContainerStyle: s.statusBarContent }, /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: [s.chip, { backgroundColor: c.surface }] }, /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: { color: c.text } }, "\u{1F4A1} ", /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: { fontWeight: "700" } }, onCount), " ", /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: { color: c.textMuted } }, "on"))), climateDevices.find((d) => d.entity_id.includes("temperature")) && /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: [s.chip, { backgroundColor: c.surface }] }, /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: { color: c.text } }, "\u{1F321}\uFE0F ", /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: { fontWeight: "700" } }, ((_a = states[climateDevices.find((d) => d.entity_id.includes("temperature")).entity_id]) == null ? void 0 : _a.state) || "--", "\xB0"))), securityDevices.filter((d) => d.entity_id.startsWith("lock.")).length > 0 && /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: [s.chip, { backgroundColor: c.surface }] }, /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: { color: c.text } }, securityDevices.filter((d) => d.entity_id.startsWith("lock.")).every((d) => {
        var _a2;
        return ((_a2 = states[d.entity_id]) == null ? void 0 : _a2.state) === "locked";
      }) ? "\u{1F512} Locked" : "\u{1F513} Unlocked"))),
      quickDevices.length > 0 && /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: s.section }, /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: [s.sectionTitle, { color: c.textMuted }] }, "QUICK CONTROLS"), /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: s.controlsGrid }, quickDevices.map((dev) => {
        var _a2;
        const st = ((_a2 = states[dev.entity_id]) == null ? void 0 : _a2.state) || dev.state || "unknown";
        const on = isOn(dev.entity_id, st);
        return /* @__PURE__ */ import_react.default.createElement(
          import_react_native.Pressable,
          {
            key: dev.entity_id,
            style: [s.tile, { backgroundColor: on ? "#1c2a1f" : c.surface, borderColor: on ? "#22c55e40" : c.border }],
            onPress: () => toggleDevice(dev.entity_id)
          },
          /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: s.tileTop }, /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: s.tileIcon }, getIcon(dev.entity_id)), /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: [s.toggle, on && s.toggleOn] }, /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: [s.toggleKnob, on && s.toggleKnobOn] }))),
          /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: [s.tileName, { color: c.text }], numberOfLines: 1 }, dev.name || dev.entity_id),
          /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: [s.tileState, { color: c.textMuted }] }, stateLabel(dev.entity_id, st))
        );
      }))),
      rooms.length > 0 && /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: s.section }, /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: [s.sectionTitle, { color: c.textMuted }] }, "ROOMS"), rooms.map((room, i) => {
        const devices = room.devices || [];
        const roomOnCount = devices.filter((d) => {
          var _a2;
          return isOn(d.entity_id, (_a2 = states[d.entity_id]) == null ? void 0 : _a2.state);
        }).length;
        const expanded = expandedRooms.has(i);
        return /* @__PURE__ */ import_react.default.createElement(import_react_native.Pressable, { key: room.name, style: [s.roomCard, { backgroundColor: c.surface, borderColor: c.border }], onPress: () => toggleRoom(i) }, /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: s.roomHeader }, /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: [s.roomName, { color: c.text }] }, room.name), /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: [s.roomBadge, roomOnCount > 0 ? { backgroundColor: "#22c55e20", color: "#22c55e" } : { backgroundColor: c.border, color: c.textMuted }] }, roomOnCount > 0 ? `${roomOnCount} on` : `${devices.length} devices`), /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: [s.chevron, { color: c.textMuted }, expanded && s.chevronExpanded] }, "\u25B6")), expanded && devices.map((dev) => {
          var _a2;
          const st = ((_a2 = states[dev.entity_id]) == null ? void 0 : _a2.state) || "unknown";
          const on = isOn(dev.entity_id, st);
          return /* @__PURE__ */ import_react.default.createElement(import_react_native.Pressable, { key: dev.entity_id, style: [s.deviceRow, { borderTopColor: c.border }], onPress: () => toggleDevice(dev.entity_id) }, /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: [s.dot, { backgroundColor: on ? "#22c55e" : c.textMuted }] }), /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: [s.deviceName, { color: c.text }], numberOfLines: 1 }, dev.name || dev.entity_id), /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: [s.deviceState, { color: c.textMuted }] }, stateLabel(dev.entity_id, st)));
        }));
      })),
      climateDevices.length > 0 && /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: s.section }, /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: [s.sectionTitle, { color: c.textMuted }] }, "CLIMATE"), /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: s.climateGrid }, climateDevices.map((dev) => {
        var _a2;
        const val = ((_a2 = states[dev.entity_id]) == null ? void 0 : _a2.state) || dev.state || "--";
        const isTemp = dev.entity_id.includes("temperature");
        return /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { key: dev.entity_id, style: [s.climateCard, { backgroundColor: c.surface, borderColor: c.border }] }, /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: [s.climateLabel, { color: c.textMuted }] }, dev.room), /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: [s.climateValue, { color: c.text }] }, val, /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: s.climateUnit }, isTemp ? "\xB0C" : "%")), /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: [s.climateSub, { color: c.textMuted }] }, dev.name));
      }))),
      securityDevices.length > 0 && /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: s.section }, /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: [s.sectionTitle, { color: c.textMuted }] }, "SECURITY"), securityDevices.map((dev) => {
        var _a2;
        const st = ((_a2 = states[dev.entity_id]) == null ? void 0 : _a2.state) || "unknown";
        const safe = dev.entity_id.startsWith("lock.") && st === "locked" || dev.entity_id.startsWith("cover.") && st === "closed";
        return /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { key: dev.entity_id, style: [s.securityRow, { backgroundColor: c.surface, borderColor: c.border }] }, /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: s.securityIcon }, dev.entity_id.startsWith("lock.") ? "\u{1F512}" : "\u{1F6AA}"), /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: { flex: 1 } }, /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: [s.securityName, { color: c.text }] }, dev.name || dev.entity_id), /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: { fontSize: 12, color: safe ? c.success : "#f59e0b" } }, stateLabel(dev.entity_id, st))));
      })),
      /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: [s.section, { paddingBottom: 32 }] }, /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: [s.sectionTitle, { color: c.textMuted }] }, "PROVIDERS"), /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: s.providerRow }, Object.entries(providers).map(([name, connected]) => /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { key: name, style: [s.providerChip, { backgroundColor: c.surface, borderColor: c.border }] }, /* @__PURE__ */ import_react.default.createElement(import_react_native.View, { style: [s.providerDot, { backgroundColor: connected ? "#22c55e" : c.textMuted }] }), /* @__PURE__ */ import_react.default.createElement(import_react_native.Text, { style: { color: c.text, fontSize: 12 } }, name)))))
    );
  }
});
var s = import_react_native.StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { marginTop: 8, fontSize: 14 },
  retryBtn: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  statusBar: { paddingVertical: 12 },
  statusBarContent: { paddingHorizontal: 16, gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  section: { paddingHorizontal: 16, marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: "600", letterSpacing: 0.5, paddingVertical: 12 },
  controlsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "48%", borderRadius: 14, padding: 14, borderWidth: 1, gap: 8, minHeight: 80 },
  tileTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tileIcon: { fontSize: 22 },
  toggle: { width: 36, height: 20, borderRadius: 10, backgroundColor: "#3f3f46", justifyContent: "center", paddingHorizontal: 2 },
  toggleOn: { backgroundColor: "#22c55e" },
  toggleKnob: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff" },
  toggleKnobOn: { alignSelf: "flex-end" },
  tileName: { fontSize: 13, fontWeight: "500" },
  tileState: { fontSize: 11 },
  roomCard: { borderRadius: 14, borderWidth: 1, marginBottom: 10, overflow: "hidden" },
  roomHeader: { flexDirection: "row", alignItems: "center", padding: 14 },
  roomName: { flex: 1, fontSize: 15, fontWeight: "600" },
  roomBadge: { fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, marginRight: 8, overflow: "hidden" },
  chevron: { fontSize: 12 },
  chevronExpanded: { transform: [{ rotate: "90deg" }] },
  deviceRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, minHeight: 44 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  deviceName: { flex: 1, fontSize: 13 },
  deviceState: { fontSize: 12 },
  climateGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  climateCard: { width: "48%", borderRadius: 14, padding: 14, borderWidth: 1 },
  climateLabel: { fontSize: 11, marginBottom: 4 },
  climateValue: { fontSize: 22, fontWeight: "700" },
  climateUnit: { fontSize: 13, fontWeight: "400" },
  climateSub: { fontSize: 11, marginTop: 4 },
  securityRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, padding: 14, borderWidth: 1, marginBottom: 10 },
  securityIcon: { fontSize: 20 },
  securityName: { fontSize: 14, fontWeight: "500" },
  providerRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  providerChip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1 },
  providerDot: { width: 6, height: 6, borderRadius: 3 }
});

// plugins/whatsapp-setup/index.tsx
var import_react2 = __toESM(require("react"));
var import_react_native2 = require("react-native");
var whatsapp_setup_default = import_plugin_sdk.PluginSDK.register("whatsapp-setup", {
  type: "ui",
  version: "1.0.0",
  capabilities: { haptics: true },
  Component({ bridge, native, theme }) {
    const api = (0, import_plugin_sdk.useApi)(bridge);
    const c = theme.colors;
    const [step, setStep] = (0, import_react2.useState)("status");
    const [loading, setLoading] = (0, import_react2.useState)(true);
    const [saving, setSaving] = (0, import_react2.useState)(false);
    const [testing, setTesting] = (0, import_react2.useState)(false);
    const [status, setStatus] = (0, import_react2.useState)({ connected: false });
    const [error, setError] = (0, import_react2.useState)(null);
    const [success, setSuccess] = (0, import_react2.useState)(null);
    const [phoneNumberId, setPhoneNumberId] = (0, import_react2.useState)("");
    const [accessToken, setAccessToken] = (0, import_react2.useState)("");
    const [businessId, setBusinessId] = (0, import_react2.useState)("");
    const [testPhone, setTestPhone] = (0, import_react2.useState)("");
    const checkStatus = (0, import_react2.useCallback)(() => __async(null, null, function* () {
      setLoading(true);
      setError(null);
      try {
        const res = yield api.call("whatsapp.status", {});
        setStatus(res);
        if (res.connected) {
          setStep("done");
          setPhoneNumberId(res.phone_number_id || "");
          setBusinessId(res.business_id || "");
        } else {
          setStep("credentials");
        }
      } catch (e) {
        setStep("credentials");
      } finally {
        setLoading(false);
      }
    }), [api]);
    (0, import_react2.useEffect)(() => {
      checkStatus();
    }, []);
    const saveCredentials = (0, import_react2.useCallback)(() => __async(null, null, function* () {
      if (!phoneNumberId.trim() || !accessToken.trim()) {
        setError("Phone Number ID and Access Token are required");
        native.haptics.error();
        return;
      }
      setSaving(true);
      setError(null);
      try {
        const res = yield api.call("whatsapp.auth", {
          phone_number_id: phoneNumberId.trim(),
          access_token: accessToken.trim(),
          business_id: businessId.trim() || void 0
        });
        if (res.connected) {
          native.haptics.selection();
          setStatus(res);
          setStep("verify");
          setSuccess("Credentials saved! Send a test message to verify.");
        } else {
          setError(res.error || "Failed to connect");
          native.haptics.error();
        }
      } catch (err) {
        setError(err.message || "Failed to save credentials");
        native.haptics.error();
      } finally {
        setSaving(false);
      }
    }), [api, phoneNumberId, accessToken, businessId, native]);
    const sendTest = (0, import_react2.useCallback)(() => __async(null, null, function* () {
      if (!testPhone.trim()) {
        setError("Enter a phone number to send a test message");
        native.haptics.error();
        return;
      }
      setTesting(true);
      setError(null);
      setSuccess(null);
      try {
        const res = yield api.call("whatsapp.test", {
          to: testPhone.trim()
        });
        if (res.sent) {
          native.haptics.selection();
          setSuccess("Test message sent! Check your WhatsApp.");
          setStep("done");
        } else {
          setError(res.error || "Failed to send test message");
          native.haptics.error();
        }
      } catch (err) {
        setError(err.message || "Failed to send test message");
        native.haptics.error();
      } finally {
        setTesting(false);
      }
    }), [api, testPhone, native]);
    const disconnect = (0, import_react2.useCallback)(() => __async(null, null, function* () {
      try {
        yield api.call("whatsapp.disconnect", {});
        native.haptics.selection();
        setStatus({ connected: false });
        setStep("credentials");
        setAccessToken("");
        setSuccess(null);
      } catch (err) {
        setError(err.message || "Failed to disconnect");
        native.haptics.error();
      }
    }), [api, native]);
    if (loading) {
      return /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: [s2.center, { backgroundColor: c.bg }] }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.ActivityIndicator, { size: "large", color: c.accent }), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.loadingText, { color: c.textMuted }] }, "Checking WhatsApp status..."));
    }
    return /* @__PURE__ */ import_react2.default.createElement(import_react_native2.ScrollView, { style: { flex: 1, backgroundColor: c.bg }, contentContainerStyle: s2.container }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: s2.header }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: s2.headerIcon }, "\u{1F4AC}"), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.headerTitle, { color: c.text }] }, "WhatsApp Setup"), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.headerSub, { color: c.textMuted }] }, "Connect WhatsApp Business API to receive smart home alerts and control devices via chat.")), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: [s2.statusCard, { backgroundColor: c.surface, borderColor: c.border }] }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: [s2.statusDot, { backgroundColor: status.connected ? "#22c55e" : c.textMuted }] }), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: { flex: 1 } }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.statusLabel, { color: c.text }] }, status.connected ? "Connected" : "Not Connected"), status.connected && status.display_phone && /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.statusDetail, { color: c.textMuted }] }, status.display_phone), status.connected && status.business_name && /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.statusDetail, { color: c.textMuted }] }, status.business_name)), status.connected && /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Pressable, { style: [s2.smallBtn, { borderColor: c.error }], onPress: disconnect }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: { color: c.error, fontSize: 12 } }, "Disconnect"))), error && /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: [s2.banner, { backgroundColor: "#ef444420", borderColor: "#ef4444" }] }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: { color: "#ef4444", fontSize: 13 } }, "\u26A0 ", error)), success && /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: [s2.banner, { backgroundColor: "#22c55e20", borderColor: "#22c55e" }] }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: { color: "#22c55e", fontSize: 13 } }, "\u2713 ", success)), (step === "credentials" || step === "verify") && /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: [s2.card, { backgroundColor: c.surface, borderColor: c.border }] }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.cardTitle, { color: c.text }] }, step === "credentials" ? "1. Enter Credentials" : "\u2713 Credentials Saved"), step === "credentials" && /* @__PURE__ */ import_react2.default.createElement(import_react2.default.Fragment, null, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.helpText, { color: c.textMuted }] }, "Get these from Meta Business Suite \u2192 WhatsApp \u2192 API Setup"), /* @__PURE__ */ import_react2.default.createElement(
      import_react_native2.Pressable,
      {
        style: [s2.linkBtn, { borderColor: c.accent }],
        onPress: () => import_react_native2.Linking.openURL("https://business.facebook.com/latest/whatsapp_manager/phone_numbers/")
      },
      /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: { color: c.accent, fontSize: 13 } }, "Open Meta Business Suite \u2192")
    ), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.inputLabel, { color: c.textMuted }] }, "Phone Number ID *"), /* @__PURE__ */ import_react2.default.createElement(
      import_react_native2.TextInput,
      {
        style: [s2.input, { color: c.text, borderColor: c.border, backgroundColor: c.bg }],
        value: phoneNumberId,
        onChangeText: setPhoneNumberId,
        placeholder: "e.g. 100234567890",
        placeholderTextColor: c.textMuted,
        autoCapitalize: "none",
        keyboardType: "number-pad"
      }
    ), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.inputLabel, { color: c.textMuted }] }, "Permanent Access Token *"), /* @__PURE__ */ import_react2.default.createElement(
      import_react_native2.TextInput,
      {
        style: [s2.input, { color: c.text, borderColor: c.border, backgroundColor: c.bg }],
        value: accessToken,
        onChangeText: setAccessToken,
        placeholder: "EAAx...",
        placeholderTextColor: c.textMuted,
        autoCapitalize: "none",
        secureTextEntry: true
      }
    ), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.inputLabel, { color: c.textMuted }] }, "Business Account ID (optional)"), /* @__PURE__ */ import_react2.default.createElement(
      import_react_native2.TextInput,
      {
        style: [s2.input, { color: c.text, borderColor: c.border, backgroundColor: c.bg }],
        value: businessId,
        onChangeText: setBusinessId,
        placeholder: "e.g. 102345678901234",
        placeholderTextColor: c.textMuted,
        autoCapitalize: "none",
        keyboardType: "number-pad"
      }
    ), /* @__PURE__ */ import_react2.default.createElement(
      import_react_native2.Pressable,
      {
        style: [s2.primaryBtn, { backgroundColor: c.accent, opacity: saving ? 0.6 : 1 }],
        onPress: saveCredentials,
        disabled: saving
      },
      saving ? /* @__PURE__ */ import_react2.default.createElement(import_react_native2.ActivityIndicator, { size: "small", color: "#fff" }) : /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: s2.primaryBtnText }, "Save & Connect")
    ))), (step === "verify" || step === "done") && /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: [s2.card, { backgroundColor: c.surface, borderColor: c.border }] }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.cardTitle, { color: c.text }] }, step === "done" ? "\u2713 Verified" : "2. Send Test Message"), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.helpText, { color: c.textMuted }] }, step === "done" ? "WhatsApp is connected and ready. You'll receive smart home alerts here." : "Enter your phone number (with country code) to receive a test message."), step === "verify" && /* @__PURE__ */ import_react2.default.createElement(import_react2.default.Fragment, null, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.inputLabel, { color: c.textMuted }] }, "Your Phone Number"), /* @__PURE__  */ import_react2.default.createElement(
      import_react_native2.TextInput,
      {
        style: [s2.input, { color: c.text, borderColor: c.border, backgroundColor: c.bg }],
        value: testPhone,
        onChangeText: setTestPhone,
        placeholder: "+1234567890",
        placeholderTextColor: c.textMuted,
        autoCapitalize: "none",
        keyboardType: "phone-pad"
      }
    ), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: s2.btnRow }, /* @__PURE__ */ import_react2.default.createElement(
      import_react_native2.Pressable,
      {
        style: [s2.primaryBtn, { backgroundColor: c.accent, flex: 1, opacity: testing ? 0.6 : 1 }],
        onPress: sendTest,
        disabled: testing
      },
      testing ? /* @__PURE__ */ import_react2.default.createElement(import_react_native2.ActivityIndicator, { size: "small", color: "#fff" }) : /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: s2.primaryBtnText }, "Send Test")
    ), /* @__PURE__ */ import_react2.default.createElement(
      import_react_native2.Pressable,
      {
        style: [s2.secondaryBtn, { borderColor: c.border }],
        onPress: () => {
          setStep("done");
          setSuccess("Setup complete!");
        }
      },
      /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: { color: c.textMuted, fontSize: 14 } }, "Skip")
    ))), step === "done" && /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: s2.featureList }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: s2.featureRow }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: s2.featureIcon }, "\u{1F514}"), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.featureText, { color: c.text }] }, "Security alerts (doors, locks)")), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: s2.featureRow }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: s2.featureIcon }, "\u{1F321}\uFE0F"), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.featureText, { color: c.text }] }, "Climate notifications")), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: s2.featureRow }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: s2.featureIcon }, "\u{1F4A1}"), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.featureText, { color: c.text }] }, "Device control via chat")), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: s2.featureRow }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: s2.featureIcon }, "\u{1F4CA}"), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.featureText, { color: c.text }] }, "Daily status summaries")))), step === "credentials" && /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: [s2.card, { backgroundColor: c.surface, borderColor: c.border }] }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.cardTitle, { color: c.text }] }, "Setup Guide"), [
      { n: "1", t: "Create a Meta Business account at business.facebook.com" },
      { n: "2", t: "Go to WhatsApp Manager \u2192 API Setup" },
      { n: "3", t: "Copy your Phone Number ID from the dashboard" },
      { n: "4", t: "Generate a Permanent Access Token (System User \u2192 Generate Token \u2192 whatsapp_business_messaging)" },
      { n: "5", t: "Paste both values above and tap Save & Connect" }
    ].map(({ n, t }) => /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { key: n, style: s2.guideRow }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: [s2.guideNum, { backgroundColor: c.accent }] }, /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: s2.guideNumText }, n)), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.Text, { style: [s2.guideText, { color: c.textMuted }] }, t)))), /* @__PURE__ */ import_react2.default.createElement(import_react_native2.View, { style: { height: 32 } }));
  }
});
var s2 = import_react_native2.StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { marginTop: 8, fontSize: 14 },
  container: { padding: 16 },
  header: { alignItems: "center", marginBottom: 20 },
  headerIcon: { fontSize: 40, marginBottom: 8 },
  headerTitle: { fontSize: 22, fontWeight: "700", marginBottom: 4 },
  headerSub: { fontSize: 13, textAlign: "center", lineHeight: 18 },
  statusCard: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 16, gap: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontSize: 15, fontWeight: "600" },
  statusDetail: { fontSize: 12, marginTop: 2 },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  banner: { padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 16 },
  cardTitle: { fontSize: 16, fontWeight: "600", marginBottom: 8 },
  helpText: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  linkBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignSelf: "flex-start", marginBottom: 16 },
  inputLabel: { fontSize: 12, fontWeight: "600", letterSpacing: 0.3, marginBottom: 6, marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 12 },
  primaryBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  secondaryBtn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, alignItems: "center", borderWidth: 1 },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  featureList: { marginTop: 8, gap: 10 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  featureIcon: { fontSize: 18 },
  featureText: { fontSize: 14 },
  guideRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
  guideNum: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  guideNumText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  guideText: { flex: 1, fontSize: 13, lineHeight: 18 }
});
