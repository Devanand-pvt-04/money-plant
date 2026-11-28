// Custom entry: Expo Router plus the headless tasks Android starts, also when the app is closed:
// the native SMS receiver and notification listener (CAP-1, CAP-3) and home screen widgets (HOME-4).
// The web build (decision 0039) first fills gaps in React Native's web version and has no headless tasks.
import './src/web/setup';
import 'expo-router/entry';
import { AppRegistry, Platform } from 'react-native';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { CAPTURE_TASK_KEY, type CaptureTaskData } from './modules/sms-reader';
import { runCaptureTask } from './src/lib/capture';
import { refreshWidgets, widgetTaskHandler } from './src/widgets';

if (Platform.OS !== 'web') {
  AppRegistry.registerHeadlessTask(CAPTURE_TASK_KEY, () => async (data: CaptureTaskData) => {
    await runCaptureTask(data);
    // Decision 0036: a new SMS shows on the widgets without opening the app.
    await refreshWidgets();
  });
  registerWidgetTaskHandler(widgetTaskHandler);
}
