import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { resolveLook, type CategoryLook } from '@money-plant/categoriser';
import { ICON_SET } from '@/lib/icon-set';
import { scheme } from '@/lib/theme';

export type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface CategoryStyle {
  icon: IconName;
  /** The icon and progress bar colour. */
  color: string;
  /** The tile behind the icon. */
  tint: string;
}

/** [dark colour, dark tint, light colour, light tint]. */
type Colours = readonly [string, string, string, string];

/**
 * One colour set per standard root key, used on Home, in Activity, Budgets
 * and the pickers. The icon comes from @money-plant/categoriser's resolveLook:
 * the user's pick, a word in the name, the key, or the parent (CAT-1).
 */
const STYLES: Record<string, Colours> = {
  'food.groceries': ['#7CC98A', '#1C3322', '#2F7D3E', '#E3F3E6'],
  'housing.rent': ['#A98BF0', '#2A2140', '#6A4FC2', '#EEE9FB'],
  food: ['#F0A35E', '#3A2A17', '#B4621B', '#FDF1E3'],
  groceries: ['#7CC98A', '#1C3322', '#2F7D3E', '#E3F3E6'],
  housing: ['#A98BF0', '#2A2140', '#6A4FC2', '#EEE9FB'],
  rent: ['#A98BF0', '#2A2140', '#6A4FC2', '#EEE9FB'],
  transport: ['#6EA8FE', '#172A45', '#2563C9', '#E4EEFD'],
  shopping: ['#E98AC2', '#3B1E31', '#B03C82', '#FBE8F3'],
  bills: ['#E8C55A', '#3A3117', '#8F6D07', '#FBF3DA'],
  health: ['#4FC7C0', '#123433', '#11807A', '#DFF4F2'],
  entertainment: ['#F27C7C', '#3D1C1C', '#B83636', '#FCE6E6'],
  travel: ['#5FB3F0', '#14304A', '#1C6FA8', '#E1F0FB'],
  family: ['#F5B38A', '#3D2A1E', '#B0622F', '#FCEDE3'],
  education: ['#8FA8F5', '#1D2647', '#3D59B8', '#E7ECFC'],
  personal_care: ['#E3A1D8', '#3A2236', '#9C4A90', '#F8EAF5'],
  loans: ['#C9A27A', '#33281C', '#87603A', '#F4ECE3'],
  investments: ['#3DBE8B', '#16382A', '#0B7A55', '#DDEFE6'],
  insurance: ['#8CC1B5', '#1B302C', '#3E7A6C', '#E5F2EF'],
  fees: ['#B3B9B5', '#262B28', '#5C625E', '#EEF0ED'],
  taxes: ['#B3B9B5', '#262B28', '#5C625E', '#EEF0ED'],
  cash: ['#9CCB6E', '#24331A', '#4F7F23', '#EAF4E1'],
  income: ['#3DBE8B', '#16382A', '#0B7A55', '#DDEFE6'],
};
const OTHER: Colours = ['#9AA39E', '#222826', '#5C625E', '#EEF0ED'];

/** A category, or just its standard key where nothing more is known. */
export type CategoryLike = CategoryLook | string | null | undefined;

const lookOf = (category: CategoryLike): CategoryLook =>
  category && typeof category === 'object' ? category : { key: category ?? null, name: '', icon: null };

export function categoryStyle(category: CategoryLike): CategoryStyle {
  const { icon, colorKey } = resolveLook(lookOf(category), ICON_SET);
  const [darkColor, darkTint, lightColor, lightTint] = (colorKey && STYLES[colorKey]) || OTHER;
  return { icon: icon as IconName, color: scheme === 'dark' ? darkColor : lightColor, tint: scheme === 'dark' ? darkTint : lightTint };
}
