import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, Share, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { FormScroll } from '@/components/keyboard';
import { Button, Card, ErrorText, Field, Initial, SectionTitle, makeStyles } from '@/components/ui';
import {
  INVITE_LIMIT,
  inviteFriend,
  inviteMessage,
  listFriendLinks,
  listInvites,
  respondToLink,
  unlinkFriend,
  withdrawInvite,
  type FriendLink,
  type Invite,
} from '@/lib/friends';
import { getMe } from '@/lib/me';
import { markInvited } from '@/lib/setup';
import { supabase } from '@/lib/supabase';

/** ACC-8 and ACC-9: invite friends by email, answer friend requests, and see who you're linked with. */
export default function Friends() {
  const styles = useStyles();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [links, setLinks] = useState<FriendLink[]>([]);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [inv, lnk, session] = await Promise.all([listInvites(), listFriendLinks(), supabase.auth.getSession()]);
      setInvites(inv);
      setLinks(lnk);
      setAdmin(session.data.session?.user.app_metadata?.role === 'admin');
      setError(null);
    } catch (e) {
      setError(`Couldn't load your friends. This needs the internet. ${e instanceof Error ? e.message : ''}`.trim());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => setNote(null), [email]);

  async function share(to: string) {
    await Share.share({ message: inviteMessage(to, await getMe()) });
  }

  async function invite() {
    setSending(true);
    setError(null);
    const to = email.trim().toLowerCase();
    try {
      const result = await inviteFriend(to);
      setEmail('');
      void markInvited();
      if (result === 'invited') {
        await share(to);
        setNote(`Invited ${to}. They can sign in once they install the app.`);
      } else if (result === 'requested') {
        setNote(`${to} is already on Money Plant. They'll see your friend request.`);
      } else {
        setNote(`You and ${to} are already linked, or a request is waiting.`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  function act(work: () => Promise<void>) {
    work().then(load, (e) => Alert.alert("Couldn't do that", e instanceof Error ? e.message : String(e)));
  }

  function confirmUnlink(link: FriendLink) {
    Alert.alert(
      `Unlink ${link.name ?? link.email}?`,
      'New IOUs with them stop being shared. Your entries and the IOUs you already have stay as they are.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unlink', style: 'destructive', onPress: () => act(() => unlinkFriend(link.id)) },
      ],
    );
  }

  const waitingForYou = links.filter((l) => l.state === 'waiting_for_you');
  const friends = links.filter((l) => l.state === 'friends');
  const sent = links.filter((l) => l.state === 'waiting_for_them');
  const openInvites = invites.filter((i) => !i.usedAt);
  const left = Math.max(0, INVITE_LIMIT - invites.length);

  return (
    <FormScroll
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <Text style={styles.lead}>
        Money Plant is invite only. Invite a friend by the email they'll sign in with. If they're already on the app, they get a friend request instead.
      </Text>
      <Field
        label="Friend's email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="ravi@gmail.com"
      />
      <Text style={styles.hint}>
        {admin ? 'You can invite as many people as you like.' : `${left} of ${INVITE_LIMIT} invites left. Withdrawing an unused invite gives it back.`}
      </Text>
      {note && <Text style={styles.note}>{note}</Text>}
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Invite" onPress={invite} loading={sending} disabled={!email.trim() || (!admin && left === 0)} />
      </View>

      {waitingForYou.length > 0 && (
        <>
          <SectionTitle>Asking to link with you</SectionTitle>
          <Card>
            {waitingForYou.map((l, i) => (
              <View key={l.id} style={[styles.row, i > 0 && styles.divided]}>
                <Initial name={l.name ?? l.email} />
                <View style={styles.grow}>
                  <Text style={styles.name} numberOfLines={1}>{l.name ?? l.email}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{l.email}</Text>
                </View>
                <Pressable accessibilityRole="button" onPress={() => act(() => respondToLink(l.id, false))} style={styles.small}>
                  <Text style={styles.smallMuted}>Decline</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => act(() => respondToLink(l.id, true))} style={styles.small}>
                  <Text style={styles.smallText}>Accept</Text>
                </Pressable>
              </View>
            ))}
          </Card>
          <Text style={styles.hint}>Accepting adds them to your people, and IOUs with them are shared both ways.</Text>
        </>
      )}

      <SectionTitle>Friends on Money Plant</SectionTitle>
      {friends.length === 0 ? (
        <Text style={styles.meta}>{loading ? ' ' : 'No one yet. Friends you invite show here once they sign up.'}</Text>
      ) : (
        <Card>
          {friends.map((l, i) => (
            <Pressable
              key={l.id}
              accessibilityRole="button"
              onLongPress={() => confirmUnlink(l)}
              style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}
            >
              <Initial name={l.name ?? l.email} />
              <View style={styles.grow}>
                <Text style={styles.name} numberOfLines={1}>{l.name ?? l.email}</Text>
                <Text style={styles.meta} numberOfLines={1}>{[l.vpa, l.email].filter(Boolean).join(' · ')}</Text>
              </View>
            </Pressable>
          ))}
        </Card>
      )}
      {friends.length > 0 && <Text style={styles.hint}>Press and hold a friend to unlink.</Text>}

      {(openInvites.length > 0 || sent.length > 0) && (
        <>
          <SectionTitle>Waiting</SectionTitle>
          <Card>
            {openInvites.map((inv, i) => (
              <View key={inv.id} style={[styles.row, i > 0 && styles.divided]}>
                <View style={styles.grow}>
                  <Text style={styles.name} numberOfLines={1}>{inv.email}</Text>
                  <Text style={styles.meta}>Invited, not signed up yet</Text>
                </View>
                <Pressable accessibilityRole="button" onPress={() => act(() => withdrawInvite(inv.id))} style={styles.small}>
                  <Text style={styles.smallMuted}>Withdraw</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => void share(inv.email)} style={styles.small}>
                  <Text style={styles.smallText}>Share</Text>
                </Pressable>
              </View>
            ))}
            {sent.map((l, i) => (
              <View key={l.id} style={[styles.row, (openInvites.length > 0 || i > 0) && styles.divided]}>
                <View style={styles.grow}>
                  <Text style={styles.name} numberOfLines={1}>{l.email}</Text>
                  <Text style={styles.meta}>Friend request sent</Text>
                </View>
                <Pressable accessibilityRole="button" onPress={() => act(() => unlinkFriend(l.id))} style={styles.small}>
                  <Text style={styles.smallMuted}>Cancel</Text>
                </Pressable>
              </View>
            ))}
          </Card>
        </>
      )}
    </FormScroll>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 8 },
  lead: { fontSize: 14, color: colors.text, lineHeight: 20, marginTop: 8 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  note: { fontSize: 13, color: colors.primary, marginTop: 8, lineHeight: 18 },
  actions: { marginTop: 12, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 16, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  small: { minHeight: 48, minWidth: 48, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' },
  smallText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  smallMuted: { fontSize: 14, fontWeight: '600', color: colors.muted },
}));
