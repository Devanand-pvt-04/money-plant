import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { categoryStyle } from './category-style';
import { colors, radius } from './ui';

/**
 * A panel that slides up from the bottom over a dimmed screen. Tapping the
 * dimmed part or the back button closes it. `tall` fills most of the screen,
 * for lists that scroll.
 */
export function Sheet(props: { visible: boolean; onClose: () => void; title?: string; tall?: boolean; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={props.visible} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={props.onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.root}>
        <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={props.onClose} />
        <View style={[styles.sheet, props.tall && styles.tall, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          {props.title && <Text style={styles.title}>{props.title}</Text>}
          {props.children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A category's icon on its coloured tile. */
export function CategoryIcon({ categoryKey, size = 34 }: { categoryKey: string | null | undefined; size?: number }) {
  const style = categoryStyle(categoryKey);
  return (
    <View style={[styles.icon, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: style.tint }]}>
      <Feather name={style.icon} size={Math.round(size * 0.52)} color={style.color} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 12,
    maxHeight: '92%',
  },
  tall: { height: '88%' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.border },
  title: { fontSize: 19, fontWeight: '700', color: colors.text, marginHorizontal: 4 },
  icon: { alignItems: 'center', justifyContent: 'center' },
});
