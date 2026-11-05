import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

export interface Series {
  /** One value per point; null leaves a gap. */
  values: readonly (number | null)[];
  color: string;
  thickness: number;
}

/**
 * A small line chart drawn with plain views (each segment a thin rotated bar),
 * so it needs no native chart library and ships over the air. All series
 * share one scale, from the lowest to the highest value.
 */
export function LineChart({ series, height, label }: { series: readonly Series[]; height: number; label: string }) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const count = Math.max(0, ...series.map((s) => s.values.length));
  const low = Math.min(...all);
  const high = Math.max(...all);
  const span = high - low || 1;
  const pad = 4;
  const x = (i: number) => (count <= 1 ? width / 2 : (i / (count - 1)) * width);
  const y = (v: number) => pad + (1 - (v - low) / span) * (height - pad * 2);
  return (
    <View style={{ height }} onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={label}>
      {width > 0 &&
        all.length > 0 &&
        series.map((s, si) =>
          s.values.map((v, i) => {
            const next = s.values[i + 1];
            if (v === null || next === null || next === undefined) return null;
            const x1 = x(i);
            const y1 = y(v);
            const x2 = x(i + 1);
            const y2 = y(next);
            const length = Math.hypot(x2 - x1, y2 - y1);
            const angle = Math.atan2(y2 - y1, x2 - x1);
            return (
              <View
                key={`${si}-${i}`}
                style={[
                  styles.segment,
                  {
                    left: (x1 + x2) / 2 - length / 2,
                    top: (y1 + y2) / 2 - s.thickness / 2,
                    width: length + s.thickness / 2,
                    height: s.thickness,
                    borderRadius: s.thickness / 2,
                    backgroundColor: s.color,
                    transform: [{ rotate: `${angle}rad` }],
                  },
                ]}
              />
            );
          }),
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { position: 'absolute' },
});
