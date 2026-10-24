import type Feather from '@expo/vector-icons/Feather';
import { scheme } from '@/lib/theme';

type IconName = React.ComponentProps<typeof Feather>['name'];

export interface CategoryStyle {
  icon: IconName;
  /** The icon and progress bar colour. */
  color: string;
  /** The tile behind the icon. */
  tint: string;
}

/** [icon, dark colour, dark tint, light colour, light tint]. */
type Entry = readonly [IconName, string, string, string, string];

/**
 * One icon and colour per category, used on Home, in Activity, Budgets and the
 * pickers. Looked up by the most specific standard key first, then its root,
 * so a sub-category the user made under Food looks like Food.
 */
const STYLES: Record<string, Entry> = {
  'food.groceries': ['shopping-cart', '#7CC98A', '#1C3322', '#2F7D3E', '#E3F3E6'],
  'housing.rent': ['home', '#A98BF0', '#2A2140', '#6A4FC2', '#EEE9FB'],
  food: ['coffee', '#F0A35E', '#3A2A17', '#B4621B', '#FDF1E3'],
  groceries: ['shopping-cart', '#7CC98A', '#1C3322', '#2F7D3E', '#E3F3E6'],
  housing: ['home', '#A98BF0', '#2A2140', '#6A4FC2', '#EEE9FB'],
  rent: ['home', '#A98BF0', '#2A2140', '#6A4FC2', '#EEE9FB'],
  transport: ['truck', '#6EA8FE', '#172A45', '#2563C9', '#E4EEFD'],
  shopping: ['shopping-bag', '#E98AC2', '#3B1E31', '#B03C82', '#FBE8F3'],
  bills: ['zap', '#E8C55A', '#3A3117', '#8F6D07', '#FBF3DA'],
  health: ['heart', '#4FC7C0', '#123433', '#11807A', '#DFF4F2'],
  entertainment: ['film', '#F27C7C', '#3D1C1C', '#B83636', '#FCE6E6'],
  travel: ['map-pin', '#5FB3F0', '#14304A', '#1C6FA8', '#E1F0FB'],
  family: ['gift', '#F5B38A', '#3D2A1E', '#B0622F', '#FCEDE3'],
  education: ['book-open', '#8FA8F5', '#1D2647', '#3D59B8', '#E7ECFC'],
  personal_care: ['smile', '#E3A1D8', '#3A2236', '#9C4A90', '#F8EAF5'],
  loans: ['percent', '#C9A27A', '#33281C', '#87603A', '#F4ECE3'],
  investments: ['trending-up', '#3DBE8B', '#16382A', '#0B7A55', '#DDEFE6'],
  insurance: ['shield', '#8CC1B5', '#1B302C', '#3E7A6C', '#E5F2EF'],
  fees: ['file-text', '#B3B9B5', '#262B28', '#5C625E', '#EEF0ED'],
  taxes: ['file-text', '#B3B9B5', '#262B28', '#5C625E', '#EEF0ED'],
  cash: ['dollar-sign', '#9CCB6E', '#24331A', '#4F7F23', '#EAF4E1'],
  income: ['arrow-down-left', '#3DBE8B', '#16382A', '#0B7A55', '#DDEFE6'],
};
const OTHER: Entry = ['tag', '#9AA39E', '#222826', '#5C625E', '#EEF0ED'];

export function categoryStyle(key: string | null | undefined): CategoryStyle {
  const entry = (key && (STYLES[key] ?? STYLES[key.split('.')[0]!])) || OTHER;
  const [icon, darkColor, darkTint, lightColor, lightTint] = entry;
  return scheme === 'dark' ? { icon, color: darkColor, tint: darkTint } : { icon, color: lightColor, tint: lightTint };
}
