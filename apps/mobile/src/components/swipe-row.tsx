import { useRef, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Swipeable, { SwipeDirection, type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Feather from '@expo/vector-icons/Feather';
import { colors, radius } from './ui';

/**
 * LED-6: swipe right to accept an entry, and optionally left for a second
 * action such as changing its category. The buttons inside stay for anyone
 * who doesn't swipe.
 */
export function SwipeRow(props: {
  children: ReactNode;
  acceptLabel: string;
  onAccept: () => void;
  otherLabel?: string;
  onOther?: () => void;
}) {
  const { onOther, otherLabel } = props;
  const ref = useRef<SwipeableMethods>(null);
  return (
    <Swipeable
      ref={ref}
      friction={1.5}
      leftThreshold={96}
      rightThreshold={96}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={() => (
        <View style={[styles.action, styles.accept]}>
          <Feather name="check" size={20} color={colors.onInk} />
          <Text style={styles.acceptText}>{props.acceptLabel}</Text>
        </View>
      )}
      renderRightActions={
        onOther
          ? () => (
              <View style={[styles.action, styles.other]}>
                <Text style={styles.otherText}>{otherLabel}</Text>
                <Feather name="tag" size={20} color={colors.text} />
              </View>
            )
          : undefined
      }
      onSwipeableOpen={(direction) => {
        // An accepted entry leaves the list; the other action opens a picker, so the row closes behind it.
        if (direction === SwipeDirection.RIGHT) return props.onAccept();
        ref.current?.close();
        onOther?.();
      }}
    >
      {props.children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, borderRadius: radius.lg },
  accept: { backgroundColor: colors.primary, justifyContent: 'flex-start' },
  acceptText: { fontSize: 15, fontWeight: '600', color: colors.onInk },
  other: { backgroundColor: colors.subtle, justifyContent: 'flex-end' },
  otherText: { fontSize: 15, fontWeight: '600', color: colors.text },
});
