import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { reportError } from '@/lib/errors';
import { Button, colors } from './ui';

/** Shown instead of a blank screen when a screen crashes. The error goes to the error log. */
export function ErrorScreen({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    reportError(error, 'screen', true);
  }, [error]);

  return (
    <View style={styles.container}>
      <Feather name="alert-triangle" size={32} color={colors.warning} />
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.hint}>This screen hit an error. It has been noted so it can be fixed. Your data is safe.</Text>
      <Text style={styles.detail} numberOfLines={3}>
        {error.message}
      </Text>
      <View style={styles.action}>
        <Button title="Try again" onPress={retry} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32, backgroundColor: colors.background },
  title: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 8 },
  hint: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  detail: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  action: { alignSelf: 'stretch', marginTop: 20 },
});
