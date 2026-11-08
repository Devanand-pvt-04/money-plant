import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { CurrencyPicker, currencyLabel } from '@/components/currency-picker';
import { FormScroll } from '@/components/keyboard';
import { Button, ErrorText, Field, colors, radius } from '@/components/ui';
import { setHomeCurrency, useHomeCurrency } from '@/lib/home-currency';
import { getMe, updateMe, type Me } from '@/lib/me';

/** How friends see the user on shared IOUs (IOU-2), and the UPI ID in "pay me" links (IOU-5). */
export default function Profile() {
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState('');
  const [vpa, setVpa] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const home = useHomeCurrency();
  const [pickingCurrency, setPickingCurrency] = useState(false);

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
    <FormScroll contentContainerStyle={styles.container}>
      {me?.email && <Text style={styles.meta}>Signed in as {me.email}</Text>}
      <Field label="Your name" value={name} onChangeText={setName} placeholder="Deva" maxLength={80} />
      <Text style={styles.hint}>Friends see this on IOUs you share with them.</Text>
      <Field label="Your UPI ID" value={vpa} onChangeText={setVpa} placeholder="deva@okhdfcbank" autoCapitalize="none" />
      <Text style={styles.hint}>Goes into the reminders you send, so people can pay you back in one tap.</Text>
      <Text style={styles.label}>Home currency</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Home currency: ${currencyLabel(home)}`}
        onPress={() => setPickingCurrency(true)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <Text style={styles.rowText}>{currencyLabel(home)}</Text>
        <Feather name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      <Text style={styles.hint}>Totals, budgets and net worth show in this currency. Accounts in other currencies are converted at daily rates.</Text>
      {error && <ErrorText>{error}</ErrorText>}
      <CurrencyPicker
        visible={pickingCurrency}
        title="Home currency"
        selected={home}
        onClose={() => setPickingCurrency(false)}
        onPick={(code) => {
          setPickingCurrency(false);
          setHomeCurrency(code).catch((e) =>
            Alert.alert("Couldn't change it", e instanceof Error ? `${e.message}. Changing it needs the internet.` : String(e)),
          );
        }}
      />
      <View style={styles.actions}>
        <Button title="Save" onPress={save} loading={saving} />
      </View>
    </FormScroll>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48 },
  meta: { fontSize: 13, color: colors.muted, marginTop: 8 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  actions: { marginTop: 24, gap: 10 },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowText: { flex: 1, fontSize: 15, color: colors.text },
  pressed: { backgroundColor: colors.pressed },
});
