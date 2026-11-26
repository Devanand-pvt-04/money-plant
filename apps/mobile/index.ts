// Custom entry: Expo Router plus the headless tasks Android starts, also when the app is closed:
// the native SMS receiver and notification listener (CAP-1, CAP-3) and home screen widgets (HOME-4).
import 'expo-router/entry';
import { AppRegistry } from 'react-native';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { CAPTURE_TASK_KEY, type CaptureTaskData } from './modules/sms-reader';
import { runCaptureTask } from './src/lib/capture';
import { refreshWidgets, widgetTaskHandler } from './src/widgets';

AppRegistry.registerHeadlessTask(CAPTURE_TASK_KEY, () => async (data: CaptureTaskData) => {
  await runCaptureTask(data);
  // Decision 0036: a new SMS shows on the widgets without opening the app.
  await refreshWidgets();
});
registerWidgetTaskHandler(widgetTaskHandler);
