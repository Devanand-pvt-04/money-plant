import { Platform } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

/**
 * The phone's own date picker, then its time picker when `withTime` is set.
 * Dismissing the time picker keeps the new date with the old time.
 * Android only for now; the web build uses date-picker.web.ts (decision 0039).
 */
export function openPicker(value: Date, withTime: boolean, onChange: (next: Date) => void, limits: { min?: Date; max?: Date }) {
  if (Platform.OS !== 'android') return;
  DateTimePickerAndroid.open({
    value,
    mode: 'date',
    minimumDate: limits.min,
    maximumDate: limits.max,
    onChange: (event, date) => {
      if (event.type !== 'set' || !date) return;
      const day = new Date(date.getFullYear(), date.getMonth(), date.getDate(), value.getHours(), value.getMinutes());
      if (!withTime) return onChange(day);
      DateTimePickerAndroid.open({
        value: day,
        mode: 'time',
        onChange: (timeEvent, time) => {
          if (timeEvent.type !== 'set' || !time) return onChange(day);
          onChange(new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.getHours(), time.getMinutes()));
        },
      });
    },
  });
}

