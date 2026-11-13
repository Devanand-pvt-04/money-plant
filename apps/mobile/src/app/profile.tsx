import { useEffect, useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { CurrencyPicker, currencyLabel } from '@/components/currency-picker';
import { FormScroll } from '@/components/keyboard';
import { Button, Chip, Chips, ErrorText, Field, radius, useColors, makeStyles } from '@/components/ui';
import type { IdentifierKind } from '@money-plant/matcher';
import { setHomeCurrency, useHomeCurrency } from '@/lib/home-currency';
import { addMyIdentifier, loadMyIdentifiers, removeMyIdentifier, setMyIdentifierShared, type MyIdentifier } from '@/lib/identity';
import { getMe, updateMe, type Me } from '@/lib/me';

const KINDS: { kind: IdentifierKind; label: string; placeholder: string }[] = [
  { kind: 'upi', label: 'UPI ID', placeholder: 'deva@ybl' },
  { kind: 'phone', label: 'Mobile', placeholder: '98765 43210' },
  { kind: 'bank_account', label: 'Bank account', placeholder: 'Last 4 digits, like 1234' },
  { kind: 'payee_name', label: 'Name on bank', placeholder: 'DEVANAND K' },
];

const KIND_LABEL: Record<IdentifierKind, string> = { upi: 'UPI ID', phone: 'Mobile', bank_account: 'Bank account', payee_name: 'Name your bank shows' };

function shown(id: MyIdentifier): string {
  if (id.kind === 'bank_account') return `${id.label ? `${id.label.toUpperCase()} ` : ''}••${id.value.slice(-4)}`;
  return id.kind === 'payee_name' ? id.value.toUpperCase() : id.value;
}

/** How friends see the user on shared IOUs (IOU-2), and the UPI ID in "pay me" links (IOU-5). */
export default function Profile() {
  const colors = useColors();
  const styles = useStyles();
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState('');
  const [vpa, setVpa] = useState('');
  const [mine, setMine] = useState<MyIdentifier[]>([]);
  const [kind, setKind] = useState<IdentifierKind>('upi');
  const [value, setValue] = useState('');
  const [bank, setBank] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const home = useHomeCurrency();
  const [pickingCurrency, setPickingCurrency] = useState(false);

  useEffect(() => {
    getMe().then((loaded) => {
      setMe(loaded);
      setName(loaded.name ?? '');
      setVpa(loaded.vpa ?? '');
      return loadMyIdentifiers(loaded.id).then(setMine);
    }).catch((e) => setError(`${e instanceof Error ? e.message : String(e)}. Your profile needs the internet.`));
  }, []);

  // Decision 0025: everything that identifies the user, which linked friends' phones use to recognise their payments.
  async function run(task: (userId: string) => Promise<void>) {
    if (!me) return;
    setError(null);
    try {
      await task(me.id);
      setMine(await loadMyIdentifiers(me.id));
    } catch (e) {
      setError(e instanceof Error ? `${e.message}. Changing your profile needs the internet.` : String(e));
    }
  }

  async function add() {
    setAdding(true);
    await run((userId) => addMyIdentifier(userId, kind, value, kind === 'bank_account' ? bank || null : null));
    setValue('');
    setBank('');
    setAdding(false);
  }

  async function save() {
    setSaving(true);
    try {
      await updateMe({ name, vpa });
      if (me && vpa.trim()) await addMyIdentifier(me.id, 'upi', vpa);
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

      <Text style={styles.label}>How payments from you look</Text>
      <Text style={styles.hint}>
        Your UPI IDs, mobile number, bank accounts and the names your banks print. Friends you're linked with get the ones you share, so
        their phones know a payment is from you whichever app or account you use. Your own phone uses all of them to spot transfers
        between your accounts. Bank accounts are shared as bank and last 4 digits only.
      </Text>
      <View style={styles.list}>
        {mine.map((id) => (
          <View key={id.id} style={styles.item}>
            <View style={styles.grow}>
              <Text style={styles.itemKind}>{KIND_LABEL[id.kind]}</Text>
              <Text style={styles.rowText}>{shown(id)}</Text>
            </View>
            <Text style={styles.itemKind}>{id.shared ? 'Friends see it' : 'Only you'}</Text>
            <Switch
              accessibilityLabel={`Share ${shown(id)} with friends`}
              value={id.shared}
              onValueChange={(on) => void run((userId) => setMyIdentifierShared(userId, id.id, on))}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${shown(id)}`}
              hitSlop={8}
              onPress={() => void run((userId) => removeMyIdentifier(userId, id.id))}
            >
              <Feather name="x" size={18} color={colors.muted} />
            </Pressable>
          </View>
        ))}
      </View>
      <Chips>
        {KINDS.map((k) => (
          <Chip key={k.kind} label={k.label} selected={kind === k.kind} onPress={() => setKind(k.kind)} />
        ))}
      </Chips>
      {kind === 'bank_account' && <Field label="Bank" value={bank} onChangeText={setBank} placeholder="HDFC" autoCapitalize="characters" />}
      <Field
        label={KINDS.find((k) => k.kind === kind)!.label}
        value={value}
        onChangeText={setValue}
        placeholder={KINDS.find((k) => k.kind === kind)!.placeholder}
        autoCapitalize={kind === 'payee_name' ? 'characters' : 'none'}
        keyboardType={kind === 'phone' || kind === 'bank_account' ? 'number-pad' : 'default'}
      />
      <View style={styles.actions}>
        <Button title="Add" variant="secondary" onPress={add} loading={adding} disabled={!value.trim() || !me} />
      </View>
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

const useStyles = makeStyles((colors) => ({
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
  list: { gap: 8, marginTop: 10, marginBottom: 6 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  grow: { flex: 1 },
  itemKind: { fontSize: 12, color: colors.muted },
}));
