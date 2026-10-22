/** Whether a category collects money going out or money coming in. */
export type CategoryFlow = 'expense' | 'income';

/**
 * A standard category. Each user's category accounts map to one of these keys
 * (`accounts.category_key`), so the shared merchant dictionary and the AI work
 * across users whose trees differ (CAT-5). Keys are "parent" or "parent.child".
 */
export interface StandardCategory {
  key: string;
  name: string;
  flow: CategoryFlow;
}

const expense = (key: string, name: string): StandardCategory => ({ key, name, flow: 'expense' });
const income = (key: string, name: string): StandardCategory => ({ key, name, flow: 'income' });

/** CAT-1: the default category set for India, two levels deep. Users can rename, move or delete any of them. */
export const STANDARD_CATEGORIES: readonly StandardCategory[] = [
  expense('housing', 'Housing'),
  expense('housing.rent', 'Rent'),
  expense('housing.maintenance', 'Maintenance'),
  expense('housing.help', 'House help'),
  expense('bills', 'Bills'),
  expense('bills.electricity', 'Electricity'),
  expense('bills.recharge', 'Mobile recharge'),
  expense('bills.broadband', 'Broadband'),
  expense('bills.gas', 'Gas'),
  expense('bills.water', 'Water'),
  expense('bills.dth', 'DTH and cable'),
  expense('food', 'Food'),
  expense('food.groceries', 'Groceries'),
  expense('food.delivery', 'Food delivery'),
  expense('food.eating_out', 'Eating out'),
  expense('food.lunch', 'Lunch'),
  expense('food.snacks', 'Snacks and chai'),
  expense('transport', 'Transport'),
  expense('transport.fuel', 'Fuel'),
  expense('transport.cab', 'Cab and auto'),
  expense('transport.bus', 'Bus and metro'),
  expense('transport.train', 'Train'),
  expense('transport.tolls', 'Parking and tolls'),
  expense('shopping', 'Shopping'),
  expense('shopping.online', 'Online shopping'),
  expense('shopping.clothing', 'Clothing'),
  expense('shopping.electronics', 'Electronics'),
  expense('shopping.home', 'Home'),
  expense('health', 'Health'),
  expense('health.medicines', 'Medicines'),
  expense('health.doctor', 'Doctor'),
  expense('health.fitness', 'Fitness'),
  expense('entertainment', 'Entertainment'),
  expense('entertainment.subscriptions', 'Subscriptions'),
  expense('entertainment.movies', 'Movies and events'),
  expense('travel', 'Travel'),
  expense('travel.flights', 'Flights'),
  expense('travel.hotels', 'Hotels'),
  expense('education', 'Education'),
  expense('personal_care', 'Personal care'),
  expense('family', 'Family and gifts'),
  expense('family.gifts', 'Gifts'),
  expense('family.support', 'Family support'),
  expense('family.donations', 'Donations'),
  expense('loans', 'Loans and EMI'),
  expense('loans.emi', 'EMI'),
  expense('loans.card_charges', 'Card interest and fees'),
  expense('investments', 'Investments'),
  expense('investments.sip', 'SIP'),
  expense('investments.stocks', 'Stocks'),
  expense('insurance', 'Insurance'),
  expense('fees', 'Bank charges and fees'),
  expense('taxes', 'Taxes'),
  expense('cash', 'Cash withdrawal'),
  expense('other', 'Other spending'),
  income('income', 'Income'),
  income('income.salary', 'Salary'),
  income('income.interest', 'Interest'),
  income('income.refunds', 'Refunds and cashback'),
  income('income.gifts', 'Gifts received'),
  income('income.investments', 'Investment returns'),
  income('income.other', 'Other income'),
];

const BY_KEY = new Map(STANDARD_CATEGORIES.map((category) => [category.key, category]));

export function standardCategory(key: string): StandardCategory | undefined {
  return BY_KEY.get(key);
}

/** "food.lunch" -> "food"; "food" -> null. */
export function parentKey(key: string): string | null {
  const dot = key.indexOf('.');
  return dot === -1 ? null : key.slice(0, dot);
}

/** Flow of a key, falling back to its parent's; unknown keys count as spending. */
export function flowOfKey(key: string | null): CategoryFlow {
  if (!key) return 'expense';
  return (BY_KEY.get(key) ?? BY_KEY.get(parentKey(key) ?? ''))?.flow ?? 'expense';
}

/** A user's category account, as the categoriser needs it. */
export interface UserCategory {
  id: string;
  name: string;
  parentId: string | null;
  key: string | null;
}

/**
 * Finds the user's category for a standard key: an exact match, else the
 * category mapped to the key's parent. Null when the user has neither, for
 * example after deleting the whole tree.
 */
export function categoryForKey(categories: readonly UserCategory[], key: string): UserCategory | null {
  const exact = categories.find((category) => category.key === key);
  if (exact) return exact;
  const parent = parentKey(key);
  return parent ? (categories.find((category) => category.key === parent) ?? null) : null;
}

/** "Food > Lunch", or "Food" for a top-level category. */
export function categoryPath(categories: readonly UserCategory[], id: string): string {
  const category = categories.find((c) => c.id === id);
  if (!category) return 'Unknown category';
  const parent = category.parentId ? categories.find((c) => c.id === category.parentId) : undefined;
  return parent ? `${parent.name} > ${category.name}` : category.name;
}
