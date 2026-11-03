import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { IconSet } from '@money-plant/categoriser';

/** Every icon in the Material Community Icons font the app ships (about 7,400). */
export const ICON_NAMES: readonly string[] = Object.keys(MaterialCommunityIcons.glyphMap).sort();

const names = new Set(ICON_NAMES);
const prefixed = new Map<string, string | null>();

/** The font's icons, for picking a category's icon from its name (CAT-1). */
export const ICON_SET: IconSet = {
  has: (name) => names.has(name),
  firstStartingWith(word) {
    if (!prefixed.has(word)) {
      const start = `${word}-`;
      let best: string | null = null;
      for (const name of ICON_NAMES) if (name.startsWith(start) && (best === null || name.length < best.length)) best = name;
      prefixed.set(word, best);
    }
    return prefixed.get(word) ?? null;
  },
};
