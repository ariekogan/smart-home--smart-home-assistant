import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { PluginSDK, useApi } from '../../plugin-sdk';
import type { PluginProps } from '../../plugin-sdk/types';

/* ── Types ── */
interface Device {
  entity_id: string;
  name: string;
  state?: string;
  attrs?: Record<string, any>;
  room?: string;
  provider?: string;
  provider_id?: string;
}

interface Room {
  name: string;
  devices: Device[];
}

/* ── Helpers ── */
const DOMAIN_ICONS: Record<string, string> = {
  light: '💡', switch: '🔌', climate: '🌡️', lock: '🔒', cover: '🚪',
  media_player: '📺', sensor: '📊', fan: '🌬️', vacuum: '🧹', camera: '📷',
};

function getDomain(eid: string) { return eid.split('.')[0]; }
function getIcon(eid: string) { return DOMAIN_ICONS[getDomain(eid)] || '⭕'; }

function isOn(eid: string, state?: string): boolean {
  const d = getDomain(eid);
  if (d === 'lock') return state === 'locked';
  if (d === 'cover') return state === 'open';
  if (d === 'sensor' || d === 'binary_sensor') return state !== 'unavailable';
  return state !== 'off' && state !== 'unknown' && state !== 'unavailable';
}

function stateLabel(eid: string, state?: string): string {
  const d = getDomain(eid);
  if (d === 'lock') return state === 'locked' ? 'Locked' : 'Unlocked';
  if (d === 'cover') return state === 'closed' ? 'Closed' : 'Open';
  if (d === 'sensor') return state || '--';
  if (state === 'on') return 'On';
  if (state === 'off') return 'Off';
  return state ? state.charAt(0).toUpperCase() + state.slice(1) : 'Unknown';
}

function isQuickControl(eid: string) {
  return ['light', 'switch', 'media_player', 'fan', 'climate'].includes(getDomain(eid));
}

function isClimate(eid: string) {
  const d = getDomain(eid);
  return d === 'sensor' && (eid.includes('temperature') || eid.includes('humidity'));
}

function isSecurity(eid: string) {
  const d = getDomain(eid);
  return d === 'lock' || d === 'cover';
}

/* ── Safe haptics ── */
function haptic(native: any, type: 'selection' | 'error') {
  try { native?.haptics?.[type]?.(); } catch {}
}

/* ── Component ── */
export default PluginSDK.register('home-layout-panel', {
  type: 'ui',
  version: '1.0.0',
  capabilities: { haptics: true },

  Component({ bridge, native, theme }: PluginProps) {
    const api = useApi(bridge);
    const [rooms, setRooms] = useState<Room[]>([]);
    const [states, setStates] = useState<Record<string, { state: string; attrs: any }>>({});
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedRooms, setExpandedRooms] = useState<Set<number>>(new Set([0, 1]));
    const [providers, setProviders] = useState<Record<string, boolean>>({ HA: true });

    const c = theme.colors;

    /* ── Data loading ── */
    const loadData = useCallback(async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        // Fetch rooms from HA connector
        const roomData = await api.call('rooms.list', {});
        const roomList: Room[] = roomData.rooms || [];
        setRooms(roomList);

        // Fetch all device states in parallel
        const entityIds = roomList.flatMap(r => (r.devices || []).map(d => d.entity_id));
        const stateResults = await Promise.all(
          entityIds.map(eid =>
            api.call('entity.state', { entity_id: eid })
              .then(s => [eid, { state: s.state || 'unknown', attrs: s.attributes || {} }] as const)
              .catch(() => [eid, { state: 'unknown', attrs: {} }] as const)
          )
        );
        const stateMap: Record<string, { state: string; attrs: any }> = {};
        for (const [eid, s] of stateResults) stateMap[eid] = s;
        setStates(stateMap);

        // Try other providers (graceful)
        const prov: Record<string, boolean> = { HA: true };
        try {
          const hue = await api.call('hue.status', {});
          prov.Hue = hue?.connected === true;
        } catch { prov.Hue = false; }
        try {
          const tuya = await api.call('tuya.status', {});
          prov.Tuya = tuya?.connected === true;
        } catch { prov.Tuya = false; }
        try {
          const goog = await api.call('google.status', {});
          prov.Nest = goog?.connected === true;
        } catch { prov.Nest = false; }
        setProviders(prov);

        setError(null);
      } catch (err: any) {
        setError(err.message || 'Failed to load');
        haptic(native, 'error');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    }, [api, native]);

    useEffect(() => { loadData(); }, []);

    /* ── Toggle device ── */
    const toggleDevice = useCallback(async (eid: string) => {
      const domain = getDomain(eid);
      if (!['light', 'switch', 'fan', 'media_player', 'climate'].includes(domain)) return;

      haptic(native, 'selection');

      const currentState = states[eid]?.state;
      const turnOn = !isOn(eid, currentState);
      const newState = turnOn ? 'on' : 'off';

      // Optimistic update
      setStates(prev => ({ ...prev, [eid]: { ...prev[eid], state: newState } }));

      try {
        await api.call('services.call', {
          domain,
          service: turnOn ? 'turn_on' : 'turn_off',
          entity_id: eid,
        });
        // Re-fetch actual state
        try {
          const fresh = await api.call('entity.state', { entity_id: eid });
          setStates(prev => ({ ...prev, [eid]: { state: fresh.state || newState, attrs: fresh.attributes || {} } }));
        } catch {}
      } catch {
        // Revert
        setStates(prev => ({ ...prev, [eid]: { ...prev[eid], state: currentState || 'unknown' } }));
        haptic(native, 'error');
      }
    }, [api, states, native]);

    /* ── Toggle room expand ── */
    const toggleRoom = (idx: number) => {
      setExpandedRooms(prev => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        return next;
      });
    };

    /* ── Derived data ── */
    const quickDevices = rooms.flatMap(r =>
      (r.devices || []).filter(d => isQuickControl(d.entity_id)).map(d => ({ ...d, room: r.name, provider: 'HA' }))
    ).slice(0, 8);

    const climateDevices = rooms.flatMap(r =>
      (r.devices || []).filter(d => isClimate(d.entity_id)).map(d => ({ ...d, room: r.name }))
    );

    const securityDevices = rooms.flatMap(r =>
      (r.devices || []).filter(d => isSecurity(d.entity_id)).map(d => ({ ...d, room: r.name }))
    );

    const onCount = Object.entries(states).filter(([eid, s]) => isOn(eid, s.state) && !eid.startsWith('sensor.')).length;

    /* ── Loading state ── */
    if (loading) {
      return (
        <View style={[s.center, { backgroundColor: c.bg }]}>
          <ActivityIndicator size="large" color={c.accent} />
          <Text style={[s.loadingText, { color: c.textMuted }]}>Loading home...</Text>
        </View>
      );
    }

    /* ── Error state ── */
    if (error && rooms.length === 0) {
      return (
        <View style={[s.center, { backgroundColor: c.bg }]}>
          <Text style={{ color: c.error, fontSize: 16 }}>⚠ {error}</Text>
          <Pressable style={[s.retryBtn, { borderColor: c.accent }]} onPress={() => loadData()}>
            <Text style={{ color: c.accent }}>Retry</Text>
          </Pressable>
        </View>
      );
    }

    /* ── Main render ── */
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: c.bg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} tintColor={c.accent} />}
      >
        {/* Status chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.statusBar} contentContainerStyle={s.statusBarContent}>
          <View style={[s.chip, { backgroundColor: c.surface }]}>
            <Text style={{ color: c.text }}>💡 <Text style={{ fontWeight: '700' }}>{onCount}</Text> <Text style={{ color: c.textMuted }}>on</Text></Text>
          </View>
          {climateDevices.find(d => d.entity_id.includes('temperature')) && (
            <View style={[s.chip, { backgroundColor: c.surface }]}>
              <Text style={{ color: c.text }}>🌡️ <Text style={{ fontWeight: '700' }}>{states[climateDevices.find(d => d.entity_id.includes('temperature'))!.entity_id]?.state || '--'}°</Text></Text>
            </View>
          )}
          {securityDevices.filter(d => d.entity_id.startsWith('lock.')).length > 0 && (
            <View style={[s.chip, { backgroundColor: c.surface }]}>
              <Text style={{ color: c.text }}>
                {securityDevices.filter(d => d.entity_id.startsWith('lock.')).every(d => states[d.entity_id]?.state === 'locked') ? '🔒 Locked' : '🔓 Unlocked'}
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Quick Controls */}
        {quickDevices.length > 0 && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: c.textMuted }]}>QUICK CONTROLS</Text>
            <View style={s.controlsGrid}>
              {quickDevices.map(dev => {
                const st = states[dev.entity_id]?.state || dev.state || 'unknown';
                const on = isOn(dev.entity_id, st);
                return (
                  <Pressable
                    key={dev.entity_id}
                    style={[s.tile, { backgroundColor: on ? '#1c2a1f' : c.surface, borderColor: on ? '#22c55e40' : c.border }]}
                    onPress={() => toggleDevice(dev.entity_id)}
                  >
                    <View style={s.tileTop}>
                      <Text style={s.tileIcon}>{getIcon(dev.entity_id)}</Text>
                      <View style={[s.toggle, on && s.toggleOn]}>
                        <View style={[s.toggleKnob, on && s.toggleKnobOn]} />
                      </View>
                    </View>
                    <Text style={[s.tileName, { color: c.text }]} numberOfLines={1}>{dev.name || dev.entity_id}</Text>
                    <Text style={[s.tileState, { color: c.textMuted }]}>{stateLabel(dev.entity_id, st)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* Rooms */}
        {rooms.length > 0 && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: c.textMuted }]}>ROOMS</Text>
            {rooms.map((room, i) => {
              const devices = room.devices || [];
              const roomOnCount = devices.filter(d => isOn(d.entity_id, states[d.entity_id]?.state)).length;
              const expanded = expandedRooms.has(i);
              return (
                <Pressable key={room.name} style={[s.roomCard, { backgroundColor: c.surface, borderColor: c.border }]} onPress={() => toggleRoom(i)}>
                  <View style={s.roomHeader}>
                    <Text style={[s.roomName, { color: c.text }]}>{room.name}</Text>
                    <Text style={[s.roomBadge, roomOnCount > 0 ? { backgroundColor: '#22c55e20', color: '#22c55e' } : { backgroundColor: c.border, color: c.textMuted }]}>
                      {roomOnCount > 0 ? `${roomOnCount} on` : `${devices.length} devices`}
                    </Text>
                    <Text style={[s.chevron, { color: c.textMuted }, expanded && s.chevronExpanded]}>▶</Text>
                  </View>
                  {expanded && devices.map(dev => {
                    const st = states[dev.entity_id]?.state || 'unknown';
                    const on = isOn(dev.entity_id, st);
                    return (
                      <Pressable key={dev.entity_id} style={[s.deviceRow, { borderTopColor: c.border }]} onPress={() => toggleDevice(dev.entity_id)}>
                        <View style={[s.dot, { backgroundColor: on ? '#22c55e' : c.textMuted }]} />
                        <Text style={[s.deviceName, { color: c.text }]} numberOfLines={1}>{dev.name || dev.entity_id}</Text>
                        <Text style={[s.deviceState, { color: c.textMuted }]}>{stateLabel(dev.entity_id, st)}</Text>
                      </Pressable>
                    );
                  })}
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Climate */}
        {climateDevices.length > 0 && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: c.textMuted }]}>CLIMATE</Text>
            <View style={s.climateGrid}>
              {climateDevices.map(dev => {
                const val = states[dev.entity_id]?.state || dev.state || '--';
                const isTemp = dev.entity_id.includes('temperature');
                return (
                  <View key={dev.entity_id} style={[s.climateCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                    <Text style={[s.climateLabel, { color: c.textMuted }]}>{dev.room}</Text>
                    <Text style={[s.climateValue, { color: c.text }]}>{val}<Text style={s.climateUnit}>{isTemp ? '°C' : '%'}</Text></Text>
                    <Text style={[s.climateSub, { color: c.textMuted }]}>{dev.name}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Security */}
        {securityDevices.length > 0 && (
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: c.textMuted }]}>SECURITY</Text>
            {securityDevices.map(dev => {
              const st = states[dev.entity_id]?.state || 'unknown';
              const safe = (dev.entity_id.startsWith('lock.') && st === 'locked') || (dev.entity_id.startsWith('cover.') && st === 'closed');
              return (
                <View key={dev.entity_id} style={[s.securityRow, { backgroundColor: c.surface, borderColor: c.border }]}>
                  <Text style={s.securityIcon}>{dev.entity_id.startsWith('lock.') ? '🔒' : '🚪'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.securityName, { color: c.text }]}>{dev.name || dev.entity_id}</Text>
                    <Text style={{ fontSize: 12, color: safe ? c.success : '#f59e0b' }}>{stateLabel(dev.entity_id, st)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Providers */}
        <View style={[s.section, { paddingBottom: 32 }]}>
          <Text style={[s.sectionTitle, { color: c.textMuted }]}>PROVIDERS</Text>
          <View style={s.providerRow}>
            {Object.entries(providers).map(([name, connected]) => (
              <View key={name} style={[s.providerChip, { backgroundColor: c.surface, borderColor: c.border }]}>
                <View style={[s.providerDot, { backgroundColor: connected ? '#22c55e' : c.textMuted }]} />
                <Text style={{ color: c.text, fontSize: 12 }}>{name}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    );
  },
});

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { marginTop: 8, fontSize: 14 },
  retryBtn: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  statusBar: { paddingVertical: 12 },
  statusBarContent: { paddingHorizontal: 16, gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  section: { paddingHorizontal: 16, marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '600', letterSpacing: 0.5, paddingVertical: 12 },
  controlsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', borderRadius: 14, padding: 14, borderWidth: 1, gap: 8, minHeight: 80 },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tileIcon: { fontSize: 22 },
  toggle: { width: 36, height: 20, borderRadius: 10, backgroundColor: '#3f3f46', justifyContent: 'center', paddingHorizontal: 2 },
  toggleOn: { backgroundColor: '#22c55e' },
  toggleKnob: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff' },
  toggleKnobOn: { alignSelf: 'flex-end' },
  tileName: { fontSize: 13, fontWeight: '500' },
  tileState: { fontSize: 11 },
  roomCard: { borderRadius: 14, borderWidth: 1, marginBottom: 10, overflow: 'hidden' },
  roomHeader: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  roomName: { flex: 1, fontSize: 15, fontWeight: '600' },
  roomBadge: { fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, marginRight: 8, overflow: 'hidden' },
  chevron: { fontSize: 12 },
  chevronExpanded: { transform: [{ rotate: '90deg' }] },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, minHeight: 44 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  deviceName: { flex: 1, fontSize: 13 },
  deviceState: { fontSize: 12 },
  climateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  climateCard: { width: '48%', borderRadius: 14, padding: 14, borderWidth: 1 },
  climateLabel: { fontSize: 11, marginBottom: 4 },
  climateValue: { fontSize: 22, fontWeight: '700' },
  climateUnit: { fontSize: 13, fontWeight: '400' },
  climateSub: { fontSize: 11, marginTop: 4 },
  securityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 14, borderWidth: 1, marginBottom: 10 },
  securityIcon: { fontSize: 20 },
  securityName: { fontSize: 14, fontWeight: '500' },
  providerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  providerChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1 },
  providerDot: { width: 6, height: 6, borderRadius: 3 },
});