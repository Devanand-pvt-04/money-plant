import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Dimensions, Keyboard, ScrollView, TextInput, View, type HostInstance, type KeyboardEvent, type ScrollViewInstance, type ScrollViewProps } from 'react-native';
import { useNavigation } from 'expo-router';

/** Space between a focused field and the top of the keyboard. */
const MARGIN = 24;

type KeyboardState = { height: number; top: number };

const CLOSED: KeyboardState = { height: 0, top: Number.POSITIVE_INFINITY };

function stateFrom(event: KeyboardEvent): KeyboardState {
  const { height, screenY } = event.endCoordinates;
  return { height, top: screenY > 0 ? screenY : Dimensions.get('screen').height - height };
}

/**
 * The open keyboard's height and where its top edge is, in window coordinates.
 * Android draws the app edge to edge, so the window no longer shrinks for the
 * keyboard: screens make room for it themselves.
 */
export function useKeyboard(): KeyboardState {
  const [state, setState] = useState<KeyboardState>(CLOSED);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => setState(stateFrom(event)));
    const hide = Keyboard.addListener('keyboardDidHide', () => setState(CLOSED));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return state;
}

/**
 * The scroll view for any screen with text fields. While the keyboard is open
 * it adds room below the content and scrolls the focused field into view, so
 * a field is never typed into blind.
 */
export const FormScroll = forwardRef<ScrollViewInstance, ScrollViewProps>(function FormScroll(props, forwardedRef) {
  const { onScroll, onTouchEnd, children, ...rest } = props;
  const ref = useRef<ScrollViewInstance>(null);
  useImperativeHandle(forwardedRef, () => ref.current as ScrollViewInstance);
  const offset = useRef(0);
  const keyboard = useKeyboard();
  const navigation = useNavigation();
  const keyboardTop = useRef(keyboard.top);
  keyboardTop.current = keyboard.top;

  const reveal = useCallback(() => {
    const input = TextInput.State.currentlyFocusedInput() as HostInstance | null;
    // Screens further back in the stack stay mounted; only the one in front scrolls.
    if (!input || !Number.isFinite(keyboardTop.current) || !navigation.isFocused()) return;
    input.measureInWindow((_x, y, _width, height) => {
      const hidden = y + height + MARGIN - keyboardTop.current;
      if (hidden > 0) ref.current?.scrollTo({ y: offset.current + hidden, animated: true });
    });
  }, [navigation]);

  // After the padding below has rendered, so there is room to scroll into.
  useEffect(() => {
    if (keyboard.height > 0) requestAnimationFrame(reveal);
  }, [keyboard.height, keyboard.top, reveal]);

  return (
    <ScrollView
      ref={ref}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={32}
      {...rest}
      onScroll={(event) => {
        offset.current = event.nativeEvent.contentOffset.y;
        onScroll?.(event);
      }}
      // Tapping another field while the keyboard stays open.
      onTouchEnd={(event) => {
        if (keyboard.height > 0) setTimeout(reveal, 150);
        onTouchEnd?.(event);
      }}
    >
      {children}
      {keyboard.height > 0 && <View style={{ height: keyboard.height }} />}
    </ScrollView>
  );
});

/**
 * For screens laid out to fill the window instead of scrolling: an empty
 * block as tall as the keyboard, placed last so everything above moves up.
 */
export function KeyboardGap() {
  const { height } = useKeyboard();
  return height > 0 ? <View style={{ height }} /> : null;
}
