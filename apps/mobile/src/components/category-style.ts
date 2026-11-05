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
 * and the pickers. Decision 0015: food orange, transport blue, shopping pink,
 * bills purple, home teal, income green, investments olive. The icon comes from @money-plant/categoriser's resolveLook:
 * the user's pick, a word in the name, the key, or the parent (CAT-1).
 */
const STYLES: Record<string, Colours> = {
  'food.groceries': ['#7CC98A', '#1C3322', '#2F7D3E', '#E3F3E6'],
  'housing.rent': ['#7CD3CB', '#14302E', '#0F6E68', '#DCF1EF'],
  food: ['#F4B57A', '#3A2A1A', '#94460A', '#FDEBD8'],
  groceries: ['#7CC98A', '#1C3322', '#2F7D3E', '#E3F3E6'],
  housing: ['#7CD3CB', '#14302E', '#0F6E68', '#DCF1EF'],
  rent: ['#7CD3CB', '#14302E', '#0F6E68', '#DCF1EF'],
  transport: ['#8EC1F2', '#1B2C3E', '#1D5A96', '#DCEBFB'],
  shopping: ['#F2A2C6', '#3A1F2C', '#962B5B', '#F9E0EC'],
  bills: ['#C3AEF2', '#2A2340', '#57389A', '#ECE3FA'],
  health: ['#F28FA0', '#3A1C22', '#A3324A', '#FBE3E8'],
  entertainment: ['#F27C7C', '#3D1C1C', '#B83636', '#FCE6E6'],
  travel: ['#5FB3F0', '#14304A', '#1C6FA8', '#E1F0FB'],
  family: ['#F5B38A', '#3D2A1E', '#B0622F', '#FCEDE3'],
  education: ['#8FA8F5', '#1D2647', '#3D59B8', '#E7ECFC'],
  personal_care: ['#E3A1D8', '#3A2236', '#9C4A90', '#F8EAF5'],
  loans: ['#C9A27A', '#33281C', '#87603A', '#F4ECE3'],
  investments: ['#C9D47A', '#2C3118', '#5E6B14', '#ECEFD9'],
  insurance: ['#8CC1B5', '#1B302C', '#3E7A6C', '#E5F2EF'],
  fees: ['#B3B9B5', '#262B28', '#5C625E', '#EEF0ED'],
  taxes: ['#B3B9B5', '#262B28', '#5C625E', '#EEF0ED'],
  cash: ['#9CCB6E', '#24331A', '#4F7F23', '#EAF4E1'],
  income: ['#8FD9B0', '#18352A', '#1D7148', '#DDF1E6'],
};
const OTHER: Colours = ['#9CA59F', '#262A28', '#5C625F', '#EBEEEB'];

/** A category, or just its standard key where nothing more is known. */
export type CategoryLike = CategoryLook | string | null | undefined;

const lookOf = (category: CategoryLike): CategoryLook =>
  category && typeof category === 'object' ? category : { key: category ?? null, name: '', icon: null };

export function categoryStyle(category: CategoryLike): CategoryStyle {
  const { icon, colorKey } = resolveLook(lookOf(category), ICON_SET);
  const [darkColor, darkTint, lightColor, lightTint] = (colorKey && STYLES[colorKey]) || OTHER;
  return { icon: icon as IconName, color: scheme === 'dark' ? darkColor : lightColor, tint: scheme === 'dark' ? darkTint : lightTint };
}
