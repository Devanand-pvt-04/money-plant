import { memo, useMemo } from 'react';
import { View } from 'react-native';
import qrcode from 'qrcode-generator';

/** Dark on light whatever the theme: scanners read charcoal on white best. */
const INK = '#1D1F1E';
const PAPER = '#FFFFFF';
/** The blank border scanners need around the code, in modules. */
const QUIET = 4;

/**
 * A QR code drawn with plain views, so it needs no native module (JS only,
 * ships by OTA). Each row's dark modules are merged into runs to keep the
 * number of views small.
 */
export const QrCode = memo(function QrCode({ value, size }: { value: string; size: number }) {
  const { count, runs } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const found: { row: number; col: number; length: number }[] = [];
    for (let row = 0; row < n; row++) {
      let start = -1;
      for (let col = 0; col <= n; col++) {
        const dark = col < n && qr.isDark(row, col);
        if (dark && start < 0) start = col;
        if (!dark && start >= 0) {
          found.push({ row, col: start, length: col - start });
          start = -1;
        }
      }
    }
    return { count: n, runs: found };
  }, [value]);
  const cell = size / (count + QUIET * 2);
  return (
    <View accessibilityRole="image" accessibilityLabel="UPI QR code" style={{ width: size, height: size, backgroundColor: PAPER }}>
      {runs.map((r) => (
        <View
          key={`${r.row}:${r.col}`}
          style={{
            position: 'absolute',
            top: (r.row + QUIET) * cell,
            left: (r.col + QUIET) * cell,
            width: r.length * cell + 0.5,
            height: cell + 0.5,
            backgroundColor: INK,
          }}
        />
      ))}
    </View>
  );
});
