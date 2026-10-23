import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, ErrorText, Field, colors } from '@/components/ui';
import { getMe, updateMe, type Me } from '@/lib/me';

/** How friends see the user on shared IOUs (IOU-2), and the UPI ID in "pay me" links (IOU-5). */
export default function Profile() {
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState('');
  const [vpa, setVpa] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMe().then((loaded) => {
      setMe(loaded);
      setName(loaded.name ?? '');
      setVpa(loaded.vpa ?? '');
    }, (e) => setError(String(e?.message ?? e)));
  }, []);

  async function save() {
    setSaving(true);
    try {
      await updateMe({ name, vpa });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? `${e.message}. Saving needs the internet.` : String(e));
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {me?.email && <Text style={styles.meta}>Signed in as {me.email}</Text>}
      <Field label="Your name" value={name} onChangeText={setName} placeholder="Deva" maxLength={80} />
      <Text style={styles.hint}>Friends see this on IOUs you share with them.</Text>
      <Field label="Your UPI ID" value={vpa} onChangeText={setVpa} placeholder="deva@okhdfcbank" autoCapitalize="none" />
      <Text style={styles.hint}>Goes into the reminders you send, so people can pay you back in one tap.</Text>
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Save" onPress={save} loading={saving} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48 },
  meta: { fontSize: 13, color: colors.muted, marginTop: 8 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  actions: { marginTop: 24, gap: 10 },
});
