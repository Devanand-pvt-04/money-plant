import { Linking } from 'react-native';

/**
 * IOU-3: hands a upi://pay link to the user's own UPI app. Android shows its
 * app chooser when more than one is installed. Nothing here moves money: the
 * UPI app asks for the PIN and does the payment.
 */
export async function openUpiLink(uri: string): Promise<void> {
  try {
    await Linking.openURL(uri);
  } catch {
    throw new Error('No UPI app on this phone opened the link');
  }
}
