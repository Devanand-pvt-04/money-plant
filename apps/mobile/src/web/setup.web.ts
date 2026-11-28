import { Alert, Appearance, type AlertButton } from 'react-native';

// Web build (decision 0039): fills gaps in React Native's web version before
// the app loads. Imported first by index.ts.

/**
 * React Native's web Alert.alert does nothing, so confirmations ("Delete this
 * entry?") never answered. The browser's own dialogs stand in: one button (or
 * none) shows a notice, two ask OK or Cancel, where Cancel is the button styled
 * "cancel" (or the first). The app has no alert with three buttons.
 */
Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => {
  const text = message ? `${title}\n\n${message}` : title;
  const list = buttons ?? [];
  if (list.length < 2) {
    window.alert(text);
    list[0]?.onPress?.();
    return;
  }
  const cancel = list.find((b) => b.style === 'cancel') ?? list[0]!;
  const action = list.find((b) => b !== cancel)!;
  const label = action.text ? `\n\nOK: ${action.text}` : '';
  if (window.confirm(text + label)) action.onPress?.();
  else cancel.onPress?.();
};

// The app sets the scheme for native views; a browser follows the page's own colours.
if (typeof Appearance.setColorScheme !== 'function') {
  Appearance.setColorScheme = () => {};
}
