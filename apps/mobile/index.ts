// Custom entry: Expo Router plus the headless task that the native SMS receiver
// and notification listener start, also when the app is closed (CAP-1, CAP-3).
import 'expo-router/entry';
import { AppRegistry } from 'react-native';
import { CAPTURE_TASK_KEY } from './modules/sms-reader';
import { runCaptureTask } from './src/lib/capture';

AppRegistry.registerHeadlessTask(CAPTURE_TASK_KEY, () => runCaptureTask);
