import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Linking,
} from 'react-native';
import { PluginSDK, useApi } from '../../plugin-sdk';
import type { PluginProps } from '../../plugin-sdk/types';

/* ── Types ── */
type Step = 'status' | 'credentials' | 'verify' | 'done';

interface WAStatus {
  connected: boolean;
  phone_number_id?: string;
  display_phone?: string;
  business_name?: string;
}

/* ── Safe haptics ── */
function haptic(native: any, type: 'selection' | 'error') {
  try { native?.haptics?.[type]?.(); } catch {}
}

/* ── Component ── */
export default PluginSDK.register('whatsapp-setup', {
  type: 'ui',
  version: '1.0.0',
  capabilities: { haptics: true },

  Component({ bridge, native, theme }: PluginProps) {
    const api = useApi(bridge);
    const c = theme.colors;

    const [step, setStep] = useState<Step>('status');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [status, setStatus] = useState<WAStatus>({ connected: false });
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Form fields
    const [phoneNumberId, setPhoneNumberId] = useState('');
    const [accessToken, setAccessToken] = useState('');
    const [businessId, setBusinessId] = useState('');
    const [testPhone, setTestPhone] = useState('');

    /* ── Check current status ── */
    const checkStatus = useCallback(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.call('whatsapp.status', {});
        setStatus(res);
        if (res.connected) {
          setStep('done');
          setPhoneNumberId(res.phone_number_id || '');
          setBusinessId(res.business_id || '');
        } else {
          setStep('credentials');
        }
      } catch {
        setStep('credentials');
      } finally {
        setLoading(false);
      }
    }, [api]);

    useEffect(() => { checkStatus(); }, []);

    /* ── Save credentials ── */
    const saveCredentials = useCallback(async () => {
      if (!phoneNumberId.trim() || !accessToken.trim()) {
        setError('Phone Number ID and Access Token are required');
        haptic(native, 'error');
        return;
      }
      setSaving(true);
      setError(null);
      try {
        const res = await api.call('whatsapp.auth', {
          phone_number_id: phoneNumberId.trim(),
          access_token: accessToken.trim(),
          business_id: businessId.trim() || undefined,
        });
        if (res.connected) {
          haptic(native, 'selection');
          setStatus(res);
          setStep('verify');
          setSuccess('Credentials saved! Send a test message to verify.');
        } else {
          setError(res.error || 'Failed to connect');
          haptic(native, 'error');
        }
      } catch (err: any) {
        setError(err.message || 'Failed to save credentials');
        haptic(native, 'error');
      } finally {
        setSaving(false);
      }
    }, [api, phoneNumberId, accessToken, businessId, native]);

    /* ── Send test message ── */
    const sendTest = useCallback(async () => {
      if (!testPhone.trim()) {
        setError('Enter a phone number to send a test message');
        haptic(native, 'error');
        return;
      }
      setTesting(true);
      setError(null);
      setSuccess(null);
      try {
        const res = await api.call('whatsapp.test', {
          to: testPhone.trim(),
        });
        if (res.sent) {
          haptic(native, 'selection');
          setSuccess('Test message sent! Check your WhatsApp.');
          setStep('done');
        } else {
          setError(res.error || 'Failed to send test message');
          haptic(native, 'error');
        }
      } catch (err: any) {
        setError(err.message || 'Failed to send test message');
        haptic(native, 'error');
      } finally {
        setTesting(false);
      }
    }, [api, testPhone, native]);

    /* ── Disconnect ── */
    const disconnect = useCallback(async () => {
      try {
        await api.call('whatsapp.disconnect', {});
        haptic(native, 'selection');
        setStatus({ connected: false });
        setStep('credentials');
        setAccessToken('');
        setSuccess(null);
      } catch (err: any) {
        setError(err.message || 'Failed to disconnect');
        haptic(native, 'error');
      }
    }, [api, native]);

    /* ── Loading state ── */
    if (loading) {
      return (
        <View style={[s.center, { backgroundColor: c.bg }]}>
          <ActivityIndicator size="large" color={c.accent} />
          <Text style={[s.loadingText, { color: c.textMuted }]}>Checking WhatsApp status...</Text>
        </View>
      );
    }

    /* ── Main render ── */
    return (
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={s.container}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerIcon}>💬</Text>
          <Text style={[s.headerTitle, { color: c.text }]}>WhatsApp Setup</Text>
          <Text style={[s.headerSub, { color: c.textMuted }]}>
            Connect WhatsApp Business API to receive smart home alerts and control devices via chat.
          </Text>
        </View>

        {/* Status indicator */}
        <View style={[s.statusCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={[s.statusDot, { backgroundColor: status.connected ? '#22c55e' : c.textMuted }]} />
          <View style={{ flex: 1 }}>
            <Text style={[s.statusLabel, { color: c.text }]}>
              {status.connected ? 'Connected' : 'Not Connected'}
            </Text>
            {status.connected && status.display_phone && (
              <Text style={[s.statusDetail, { color: c.textMuted }]}>{status.display_phone}</Text>
            )}
            {status.connected && status.business_name && (
              <Text style={[s.statusDetail, { color: c.textMuted }]}>{status.business_name}</Text>
            )}
          </View>
          {status.connected && (
            <Pressable style={[s.smallBtn, { borderColor: c.error }]} onPress={disconnect}>
              <Text style={{ color: c.error, fontSize: 12 }}>Disconnect</Text>
            </Pressable>
          )}
        </View>

        {/* Error / Success banners */}
        {error && (
          <View style={[s.banner, { backgroundColor: '#ef444420', borderColor: '#ef4444' }]}>
            <Text style={{ color: '#ef4444', fontSize: 13 }}>⚠ {error}</Text>
          </View>
        )}
        {success && (
          <View style={[s.banner, { backgroundColor: '#22c55e20', borderColor: '#22c55e' }]}>
            <Text style={{ color: '#22c55e', fontSize: 13 }}>✓ {success}</Text>
          </View>
        )}

        {/* Step: Credentials */}
        {(step === 'credentials' || step === 'verify') && (
          <View style={[s.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[s.cardTitle, { color: c.text }]}>
              {step === 'credentials' ? '1. Enter Credentials' : '✓ Credentials Saved'}
            </Text>

            {step === 'credentials' && (
              <>
                <Text style={[s.helpText, { color: c.textMuted }]}>
                  Get these from Meta Business Suite → WhatsApp → API Setup
                </Text>

                <Pressable
                  style={[s.linkBtn, { borderColor: c.accent }]}
                  onPress={() => Linking.openURL('https://business.facebook.com/latest/whatsapp_manager/phone_numbers/')}
                >
                  <Text style={{ color: c.accent, fontSize: 13 }}>Open Meta Business Suite →</Text>
                </Pressable>

                <Text style={[s.inputLabel, { color: c.textMuted }]}>Phone Number ID *</Text>
                <TextInput
                  style={[s.input, { color: c.text, borderColor: c.border, backgroundColor: c.bg }]}
                  value={phoneNumberId}
                  onChangeText={setPhoneNumberId}
                  placeholder="e.g. 100234567890"
                  placeholderTextColor={c.textMuted}
                  autoCapitalize="none"
                  keyboardType="number-pad"
                />

                <Text style={[s.inputLabel, { color: c.textMuted }]}>Permanent Access Token *</Text>
                <TextInput
                  style={[s.input, { color: c.text, borderColor: c.border, backgroundColor: c.bg }]}
                  value={accessToken}
                  onChangeText={setAccessToken}
                  placeholder="EAAx..."
                  placeholderTextColor={c.textMuted}
                  autoCapitalize="none"
                  secureTextEntry
                />

                <Text style={[s.inputLabel, { color: c.textMuted }]}>Business Account ID (optional)</Text>
                <TextInput
                  style={[s.input, { color: c.text, borderColor: c.border, backgroundColor: c.bg }]}
                  value={businessId}
                  onChangeText={setBusinessId}
                  placeholder="e.g. 102345678901234"
                  placeholderTextColor={c.textMuted}
                  autoCapitalize="none"
                  keyboardType="number-pad"
                />

                <Pressable
                  style={[s.primaryBtn, { backgroundColor: c.accent, opacity: saving ? 0.6 : 1 }]}
                  onPress={saveCredentials}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={s.primaryBtnText}>Save & Connect</Text>
                  )}
                </Pressable>
              </>
            )}
          </View>
        )}

        {/* Step: Verify */}
        {(step === 'verify' || step === 'done') && (
          <View style={[s.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[s.cardTitle, { color: c.text }]}>
              {step === 'done' ? '✓ Verified' : '2. Send Test Message'}
            </Text>

            <Text style={[s.helpText, { color: c.textMuted }]}>
              {step === 'done'
                ? 'WhatsApp is connected and ready. You\'ll receive smart home alerts here.'
                : 'Enter your phone number (with country code) to receive a test message.'}
            </Text>

            {step === 'verify' && (
              <>
                <Text style={[s.inputLabel, { color: c.textMuted }]}>Your Phone Number</Text>
                <TextInput
                  style={[s.input, { color: c.text, borderColor: c.border, backgroundColor: c.bg }]}
                  value={testPhone}
                  onChangeText={setTestPhone}
                  placeholder="+1234567890"
                  placeholderTextColor={c.textMuted}
                  autoCapitalize="none"
                  keyboardType="phone-pad"
                />

                <View style={s.btnRow}>
                  <Pressable
                    style={[s.primaryBtn, { backgroundColor: c.accent, flex: 1, opacity: testing ? 0.6 : 1 }]}
                    onPress={sendTest}
                    disabled={testing}
                  >
                    {testing ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={s.primaryBtnText}>Send Test</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={[s.secondaryBtn, { borderColor: c.border }]}
                    onPress={() => { setStep('done'); setSuccess('Setup complete!'); }}
                  >
                    <Text style={{ color: c.textMuted, fontSize: 14 }}>Skip</Text>
                  </Pressable>
                </View>
              </>
            )}

            {step === 'done' && (
              <View style={s.featureList}>
                <View style={s.featureRow}>
                  <Text style={s.featureIcon}>🔔</Text>
                  <Text style={[s.featureText, { color: c.text }]}>Security alerts (doors, locks)</Text>
                </View>
                <View style={s.featureRow}>
                  <Text style={s.featureIcon}>🌡️</Text>
                  <Text style={[s.featureText, { color: c.text }]}>Climate notifications</Text>
                </View>
                <View style={s.featureRow}>
                  <Text style={s.featureIcon}>💡</Text>
                  <Text style={[s.featureText, { color: c.text }]}>Device control via chat</Text>
                </View>
                <View style={s.featureRow}>
                  <Text style={s.featureIcon}>📊</Text>
                  <Text style={[s.featureText, { color: c.text }]}>Daily status summaries</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Setup guide */}
        {step === 'credentials' && (
          <View style={[s.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[s.cardTitle, { color: c.text }]}>Setup Guide</Text>
            {[
              { n: '1', t: 'Create a Meta Business account at business.facebook.com' },
              { n: '2', t: 'Go to WhatsApp Manager → API Setup' },
              { n: '3', t: 'Copy your Phone Number ID from the dashboard' },
              { n: '4', t: 'Generate a Permanent Access Token (System User → Generate Token → whatsapp_business_messaging)' },
              { n: '5', t: 'Paste both values above and tap Save & Connect' },
            ].map(({ n, t }) => (
              <View key={n} style={s.guideRow}>
                <View style={[s.guideNum, { backgroundColor: c.accent }]}>
                  <Text style={s.guideNumText}>{n}</Text>
                </View>
                <Text style={[s.guideText, { color: c.textMuted }]}>{t}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    );
  },
});

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { marginTop: 8, fontSize: 14 },
  container: { padding: 16 },
  header: { alignItems: 'center', marginBottom: 20 },
  headerIcon: { fontSize: 40, marginBottom: 8 },
  headerTitle: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  headerSub: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  statusCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 16, gap: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontSize: 15, fontWeight: '600' },
  statusDetail: { fontSize: 12, marginTop: 2 },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  banner: { padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 16 },
  cardTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  helpText: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  linkBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignSelf: 'flex-start', marginBottom: 16 },
  inputLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3, marginBottom: 6, marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 12 },
  primaryBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryBtn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center', borderWidth: 1 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  featureList: { marginTop: 8, gap: 10 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureIcon: { fontSize: 18 },
  featureText: { fontSize: 14 },
  guideRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  guideNum: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  guideNumText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  guideText: { flex: 1, fontSize: 13, lineHeight: 18 },
});