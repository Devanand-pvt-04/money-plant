/**
 * Category icons (CAT-1, decision 0013). Names are Material Community Icons
 * (Material Design Icons, Apache 2.0), the set @expo/vector-icons ships.
 * An icon the user picked wins; otherwise a word in the category's name picks
 * one, first from the keyword list below ("Car", "Petrol", "Gym"), then from
 * every icon's name and its other names ("Badminton", "Shuttlecock");
 * otherwise its standard key does; a sub-category with none looks like its parent.
 */
import ICON_ALIASES from './icon-aliases.json';

export interface CategoryLook {
  key: string | null;
  name: string;
  /** The icon the user picked, if any. */
  icon: string | null;
  parent?: CategoryLook | null;
}

export interface ResolvedLook {
  icon: string;
  /** The standard key whose colours the icon uses, or null for the neutral ones. */
  colorKey: string | null;
}

/** The icon for each standard key; a key's root covers its sub-keys. */
export const KEY_ICONS: Readonly<Record<string, string>> = {
  'food.groceries': 'cart',
  'housing.rent': 'home',
  food: 'silverware-fork-knife',
  groceries: 'cart',
  housing: 'home',
  rent: 'home',
  transport: 'bus',
  shopping: 'shopping',
  bills: 'flash',
  health: 'heart-pulse',
  entertainment: 'movie-open',
  travel: 'airplane',
  family: 'gift',
  education: 'school',
  personal_care: 'spa',
  loans: 'percent',
  investments: 'trending-up',
  insurance: 'shield-check',
  fees: 'file-document',
  taxes: 'file-document',
  cash: 'cash',
  income: 'arrow-bottom-left',
};

export const DEFAULT_ICON = 'tag';

/** [words, icon, the standard key whose colours fit]. Words match whole words, with a plural s. */
const WORDS: readonly (readonly [readonly string[], string, string])[] = [
  [['car', 'cars'], 'car', 'transport'],
  [['bike', 'scooter', 'motorbike', 'motorcycle'], 'motorbike', 'transport'],
  [['cycle', 'bicycle'], 'bicycle', 'transport'],
  [['shuttle', 'badminton'], 'badminton', 'health'],
  [['swim', 'swimming', 'pool'], 'swim', 'health'],
  [['massage'], 'spa', 'personal_care'],
  [['temple', 'pooja', 'puja', 'mandir'], 'temple-hindu', 'family'],
  [['fuel', 'petrol', 'diesel', 'gas', 'cng'], 'gas-station', 'transport'],
  [['parking', 'toll', 'fastag'], 'parking', 'transport'],
  [['service', 'servicing', 'repair', 'repairs', 'maintenance', 'mechanic'], 'car-wrench', 'transport'],
  [['cab', 'taxi', 'uber', 'ola', 'auto', 'rapido'], 'taxi', 'transport'],
  [['metro', 'train', 'rail', 'railway'], 'train', 'transport'],
  [['bus', 'commute', 'transport'], 'bus', 'transport'],
  [['flight', 'flights', 'airfare'], 'airplane', 'travel'],
  [['travel', 'trip', 'trips', 'holiday', 'vacation'], 'bag-suitcase', 'travel'],
  [['hotel', 'stay', 'hostel'], 'bed', 'travel'],
  [['breakfast', 'coffee', 'tea', 'cafe', 'snack', 'snacks'], 'coffee', 'food'],
  [['lunch', 'dinner', 'food', 'meal', 'meals', 'restaurant', 'eating', 'dining', 'swiggy', 'zomato'], 'silverware-fork-knife', 'food'],
  [['pizza', 'burger', 'takeaway'], 'pizza', 'food'],
  [['drink', 'drinks', 'bar', 'beer', 'alcohol', 'party', 'parties'], 'glass-cocktail', 'food'],
  [['grocery', 'groceries', 'vegetable', 'vegetables', 'fruit', 'fruits', 'milk', 'kirana'], 'cart', 'groceries'],
  [['rent', 'house', 'home', 'housing', 'flat', 'pg'], 'home', 'housing'],
  [['furniture', 'decor'], 'sofa', 'housing'],
  [['maid', 'cleaning', 'laundry', 'househelp'], 'broom', 'housing'],
  [['electricity', 'power', 'bill', 'bills', 'utilities', 'utility'], 'flash', 'bills'],
  [['water'], 'water', 'bills'],
  [['cylinder', 'lpg'], 'gas-cylinder', 'bills'],
  [['internet', 'broadband', 'wifi'], 'router-wireless', 'bills'],
  [['mobile', 'phone', 'recharge', 'postpaid', 'prepaid'], 'cellphone', 'bills'],
  [['subscription', 'subscriptions', 'ott', 'streaming', 'tv', 'dth'], 'television-classic', 'entertainment'],
  [['movie', 'movies', 'cinema', 'entertainment', 'show', 'shows'], 'movie-open', 'entertainment'],
  [['game', 'games', 'gaming'], 'gamepad-variant', 'entertainment'],
  [['music', 'concert', 'concerts'], 'music', 'entertainment'],
  [['event', 'events', 'ticket', 'tickets'], 'ticket', 'entertainment'],
  [['gym', 'fitness', 'workout', 'sport', 'sports', 'yoga'], 'dumbbell', 'health'],
  [['health', 'medical', 'doctor', 'hospital', 'clinic'], 'heart-pulse', 'health'],
  [['medicine', 'medicines', 'pharmacy', 'chemist'], 'pill', 'health'],
  [['dental', 'dentist', 'teeth'], 'tooth-outline', 'health'],
  [['shopping', 'shop', 'amazon', 'flipkart'], 'shopping', 'shopping'],
  [['clothes', 'clothing', 'apparel', 'fashion', 'shoes'], 'tshirt-crew', 'shopping'],
  [['electronics', 'gadget', 'gadgets', 'laptop', 'computer'], 'laptop', 'shopping'],
  [['gift', 'gifts', 'family', 'parents'], 'gift', 'family'],
  [['kid', 'kids', 'child', 'children', 'baby'], 'baby-carriage', 'family'],
  [['pet', 'pets', 'dog', 'cat'], 'paw', 'family'],
  [['donation', 'donations', 'charity'], 'hand-heart', 'family'],
  [['wedding', 'marriage'], 'ring', 'family'],
  [['education', 'school', 'college', 'tuition', 'fees', 'course', 'courses'], 'school', 'education'],
  [['book', 'books'], 'book-open-variant', 'education'],
  [['salon', 'haircut', 'hair', 'grooming', 'beauty', 'spa', 'personal'], 'spa', 'personal_care'],
  [['emi', 'loan', 'loans', 'interest'], 'percent', 'loans'],
  [['investment', 'investments', 'sip', 'mutual', 'stocks', 'shares'], 'trending-up', 'investments'],
  [['saving', 'savings', 'deposit', 'fd', 'rd'], 'piggy-bank', 'investments'],
  [['insurance', 'premium', 'policy'], 'shield-check', 'insurance'],
  [['tax', 'taxes', 'gst', 'tds'], 'file-document', 'taxes'],
  [['card', 'cards', 'charges', 'fee'], 'credit-card', 'fees'],
  [['cash', 'atm'], 'cash', 'cash'],
  [['salary', 'paycheck', 'bonus', 'stipend'], 'briefcase', 'income'],
  [['freelance', 'side', 'business'], 'laptop', 'income'],
  [['refund', 'refunds', 'cashback', 'reward', 'rewards'], 'cash-refund', 'income'],
  [['office', 'work'], 'briefcase', 'bills'],
  [['plant', 'plants', 'garden'], 'sprout', 'housing'],
];

const BY_WORD = new Map<string, readonly [string, string]>();
for (const [words, icon, colorKey] of WORDS) for (const word of words) if (!BY_WORD.has(word)) BY_WORD.set(word, [icon, colorKey]);

/** The icon a category's name suggests: the first word that matches, or null. */
export function iconForName(name: string): ResolvedLook | null {
  const words = name.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const word of words) {
    const hit = BY_WORD.get(word) ?? (word.endsWith('s') ? BY_WORD.get(word.slice(0, -1)) : undefined);
    if (hit) return { icon: hit[0], colorKey: hit[1] };
  }
  return null;
}

const rootOf = (key: string) => key.split('.')[0]!;
const keyIcon = (key: string | null) => (key ? (KEY_ICONS[key] ?? KEY_ICONS[rootOf(key)] ?? null) : null);
/** A key with its own colours: a standard key, not the "custom" placeholder for user-made categories. */
const colorKeyOf = (key: string | null) => (key ? (KEY_ICONS[key] ? key : KEY_ICONS[rootOf(key)] ? rootOf(key) : null) : null);

/** The names in the app's icon font, so the categoriser needn't bundle them a second time. */
export interface IconSet {
  has(name: string): boolean;
  /** The shortest icon name starting with `word-` ("guitar" → guitar-acoustic), if the app can look one up. */
  firstStartingWith?(word: string): string | null;
}

/** Other names for icons, from Material Design Icons' metadata (scripts/icon-aliases.py). */
const ALIASES: Readonly<Record<string, string>> = ICON_ALIASES;

/** Words that would match an icon but say nothing about the category. */
const STOP_WORDS = new Set(['and', 'the', 'for', 'with', 'from', 'other', 'others', 'misc', 'new', 'my', 'all', 'more', 'stuff', 'general', 'expense', 'expenses', 'spend', 'spends', 'spending', 'monthly', 'daily', 'weekly', 'yearly', 'one', 'two', 'plus', 'minus', 'set', 'off', 'on', 'help', 'account', 'details']);

/**
 * An icon whose name or other name is in the category's name: the whole name
 * ("table tennis" → table-tennis), then pairs of words, then single words, each
 * also without a plural s. Null when nothing matches.
 */
export function iconInSet(name: string, icons: IconSet): string | null {
  const words = name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  const tries: string[] = [];
  if (words.length > 1) tries.push(words.join('-'));
  for (let i = 0; i + 1 < words.length; i++) tries.push(`${words[i]}-${words[i + 1]}`);
  tries.push(...words);
  for (const t of tries) {
    for (const candidate of t.endsWith('s') ? [t, t.slice(0, -1)] : [t]) {
      if (icons.has(candidate)) return candidate;
      const alias = ALIASES[candidate];
      if (alias && icons.has(alias)) return alias;
    }
  }
  for (const w of words) {
    const prefixed = icons.firstStartingWith?.(w) ?? null;
    if (prefixed) return prefixed;
  }
  return null;
}

let aliasesByIcon: Map<string, string[]> | null = null;
function aliasesOf(icon: string): readonly string[] {
  if (!aliasesByIcon) {
    aliasesByIcon = new Map();
    for (const [alias, target] of Object.entries(ALIASES)) {
      const list = aliasesByIcon.get(target);
      if (list) list.push(alias);
      else aliasesByIcon.set(target, [alias]);
    }
  }
  return aliasesByIcon.get(icon) ?? [];
}

/**
 * Icons matching what the user typed, best first: the exact name, then names
 * starting with it, then names with a part starting with it, then other names,
 * then anything containing it. Every word typed must match.
 */
export function searchIcons(query: string, names: readonly string[], limit = 120): string[] {
  const words = query.toLowerCase().trim().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return [];
  const joined = words.join('-');
  const scoreOf = (name: string): number | null => {
    const parts = name.split('-');
    const scoreWord = (w: string): number | null => {
      if (parts.some((p) => p.startsWith(w))) return 2;
      if (aliasesOf(name).some((a) => a.split('-').some((p) => p.startsWith(w)))) return 3;
      if (w.length >= 3 && name.includes(w)) return 4;
      return null;
    };
    if (name === joined) return 0;
    if (name.startsWith(joined)) return 1;
    let worst = 0;
    for (const w of words) {
      const s = scoreWord(w);
      if (s === null) return null;
      worst = Math.max(worst, s);
    }
    return worst;
  };
  const hits: { name: string; score: number }[] = [];
  for (const name of names) {
    const score = scoreOf(name);
    if (score !== null) hits.push({ name, score });
  }
  hits.sort((a, b) => a.score - b.score || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return hits.slice(0, limit).map((h) => h.name);
}

/** The icon and colours for a category. Colours follow the standard key, or the name for a category the user made. */
export function resolveLook(look: CategoryLook, icons?: IconSet): ResolvedLook {
  const named = iconForName(look.name);
  const parent = look.parent ? resolveLook(look.parent, icons) : null;
  const colorKey = colorKeyOf(look.key) ?? parent?.colorKey ?? named?.colorKey ?? null;
  const fromSet = !look.icon && !named && icons ? iconInSet(look.name, icons) : null;
  const icon = look.icon ?? named?.icon ?? fromSet ?? keyIcon(look.key) ?? parent?.icon ?? DEFAULT_ICON;
  return { icon, colorKey };
}

/** Icons offered when the user picks one, grouped roughly by what they spend on. */
export const ICON_CHOICES: readonly string[] = [
  'silverware-fork-knife', 'coffee', 'pizza', 'glass-cocktail', 'cart', 'fruit-cherries',
  'home', 'sofa', 'broom', 'flash', 'water', 'gas-cylinder', 'router-wireless', 'cellphone',
  'car', 'motorbike', 'bicycle', 'gas-station', 'parking', 'car-wrench', 'taxi', 'bus', 'train', 'airplane', 'bag-suitcase', 'bed',
  'shopping', 'tshirt-crew', 'laptop', 'gift', 'ring', 'baby-carriage', 'paw', 'hand-heart',
  'heart-pulse', 'pill', 'tooth-outline', 'dumbbell', 'spa',
  'movie-open', 'television-classic', 'gamepad-variant', 'music', 'ticket',
  'school', 'book-open-variant', 'briefcase', 'percent', 'trending-up', 'piggy-bank', 'shield-check',
  'file-document', 'credit-card', 'cash', 'cash-refund', 'sprout', 'tag',
];
