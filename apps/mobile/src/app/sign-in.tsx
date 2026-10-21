import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorText, Field, colors } from '@/components/ui';
import { supabase } from '@/lib/supabase';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedEmail = email.trim().toLowerCase();

  async function sendCode() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setCodeSent(true);
  }

  async function verifyCode() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({
      email: trimmedEmail,
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    // On success the session listener in the root layout switches to the app.
    if (error) setError(error.message);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <Text style={styles.title}>Money Plant</Text>
        <Text style={styles.subtitle}>
          {codeSent ? `Enter the code we emailed to ${trimmedEmail}.` : 'Sign in with your email. We will send you a code.'}
        </Text>

        {codeSent ? (
          <View>
            <Field
              label="Code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={8}
              autoFocus
            />
            <View style={styles.actions}>
              <Button title="Sign in" onPress={verifyCode} loading={busy} disabled={code.trim().length < 6} />
              <Button title="Use a different email" variant="secondary" onPress={() => { setCodeSent(false); setCode(''); setError(null); }} />
            </View>
          </View>
        ) : (
          <View>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              autoFocus
            />
            <View style={styles.actions}>
              <Button title="Send code" onPress={sendCode} loading={busy} disabled={!EMAIL_PATTERN.test(trimmedEmail)} />
            </View>
          </View>
        )}

        {error && <ErrorText>{error}</ErrorText>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 32, fontWeight: '700', color: colors.primary },
  subtitle: { fontSize: 16, color: colors.muted, marginTop: 8 },
  actions: { marginTop: 24, gap: 12 },
});
