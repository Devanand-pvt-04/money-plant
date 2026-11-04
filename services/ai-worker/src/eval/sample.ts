import { DEFAULT_CATEGORIES, lookupBuiltin, normaliseMerchant, shareableVpa } from '@money-plant/categoriser';
import { looksLikePerson } from '@money-plant/matcher';
import type { Dataset, LabelledMerchant } from './dataset';

type Channel = Parameters<typeof looksLikePerson>[0]['channel'];

/**
 * Made-up payees of the kind the dictionary misses: local shops, cryptic
 * payment-gateway names and business UPI IDs. Used when the user's own data
 * has too few merchants to test with (decision 0012). Expected keys are
 * standard categories; scoring is mostly at the parent level.
 */
const SAMPLE: readonly [label: string, vpa: string | null, channel: Channel, amountBand: string, timeOfDay: string, expected: string][] = [
  ['SRI VENKATESWARA TIFFIN CENTRE', 'paytmqr281005050101xyz@paytm', 'upi', 'under ₹100', 'morning', 'food'],
  ['ANNAPOORNA MESS', null, 'card', '₹100 to ₹500', 'afternoon', 'food'],
  ['HOTEL SAGAR RATNA', null, 'card', '₹500 to ₹2,000', 'evening', 'food'],
  ['BIRYANI BLUES PVT LTD', null, 'card', '₹500 to ₹2,000', 'night', 'food'],
  ['CHAI SUTTA BAR', 'chaisuttabar.62781@icici', 'upi', 'under ₹100', 'evening', 'food'],
  ['MEGHANA FOODS', null, 'card', '₹500 to ₹2,000', 'evening', 'food'],
  ['A2B ADYAR ANANDA BHAVAN', null, 'card', '₹100 to ₹500', 'afternoon', 'food'],
  ['NANDINI MILK PARLOUR', 'nandinimilk.blr@ybl', 'upi', 'under ₹100', 'morning', 'food.groceries'],
  ['SRI BALAJI PROVISION STORE', 'balajistores@okaxis', 'upi', '₹500 to ₹2,000', 'evening', 'food.groceries'],
  ['RATNADEEP SUPERMARKET', null, 'card', '₹2,000 to ₹10,000', 'evening', 'food.groceries'],
  ['SPENCERS RETAIL LTD', null, 'card', '₹500 to ₹2,000', 'evening', 'food.groceries'],
  ['FRESH VEGETABLES AND FRUITS', 'q123456789@ybl', 'upi', 'under ₹100', 'morning', 'food.groceries'],
  ['NATURES BASKET', null, 'card', '₹2,000 to ₹10,000', 'afternoon', 'food.groceries'],
  ['COUNTRY DELIGHT', 'countrydelight@icici', 'upi', '₹500 to ₹2,000', 'morning', 'food.groceries'],
  ['SURESH KIRANA STORES', 'sureshkirana@paytm', 'upi', '₹100 to ₹500', 'evening', 'food.groceries'],
  ['KSRTC', null, 'card', '₹100 to ₹500', 'morning', 'transport'],
  ['REDBUS', 'redbus@hdfcbank', 'upi', '₹500 to ₹2,000', 'night', 'transport'],
  ['ABHIBUS SERVICES', null, 'card', '₹500 to ₹2,000', 'evening', 'transport'],
  ['QUICK RIDE PVT LTD', 'quickride@axisbank', 'upi', '₹100 to ₹500', 'morning', 'transport'],
  ['YULU BIKES', 'yulu@icici', 'upi', 'under ₹100', 'morning', 'transport'],
  ['PARK PLUS', 'parkplus@yesbank', 'upi', 'under ₹100', 'afternoon', 'transport'],
  ['SRI SAI AUTO SERVICES', null, 'card', '₹2,000 to ₹10,000', 'afternoon', 'transport'],
  ['DECATHLON SPORTS INDIA', null, 'card', '₹2,000 to ₹10,000', 'afternoon', 'shopping'],
  ['BATA INDIA LTD', null, 'card', '₹2,000 to ₹10,000', 'evening', 'shopping'],
  ['FIRSTCRY', 'firstcry@icici', 'upi', '₹500 to ₹2,000', 'night', 'shopping'],
  ['LENSKART SOLUTIONS', null, 'card', '₹2,000 to ₹10,000', 'evening', 'shopping'],
  ['SRI GANESH ELECTRICALS AND HARDWARE', null, 'card', '₹500 to ₹2,000', 'afternoon', 'shopping'],
  ['CHUMBAK DESIGN', null, 'card', '₹500 to ₹2,000', 'evening', 'shopping'],
  ['RAZORPAY*DUKAAN', null, 'card', '₹500 to ₹2,000', 'night', 'shopping'],
  ['SHOPSY', 'shopsy@axisbank', 'upi', '₹100 to ₹500', 'night', 'shopping'],
  ['FABINDIA OVERSEAS', null, 'card', '₹2,000 to ₹10,000', 'afternoon', 'shopping'],
  ['BILLDESK*MSEB', null, 'card', '₹500 to ₹2,000', 'morning', 'bills'],
  ['PAYU*KERALA STATE ELEC', null, 'card', '₹500 to ₹2,000', 'morning', 'bills'],
  ['APSPDCL', 'apspdcl@ybl', 'upi', '₹500 to ₹2,000', 'afternoon', 'bills'],
  ['YOU BROADBAND', null, 'card', '₹500 to ₹2,000', 'morning', 'bills'],
  ['GOOGLE ONE', null, 'card', '₹100 to ₹500', 'night', 'bills'],
  ['MYGATE MAINTENANCE', 'mygate@hdfcbank', 'upi', '₹2,000 to ₹10,000', 'morning', 'housing'],
  ['NOBROKERHOOD SOCIETY', null, 'card', '₹2,000 to ₹10,000', 'morning', 'housing'],
  ['PRESTIGE APARTMENT OWNERS ASSOCIATION', null, 'neft', '₹2,000 to ₹10,000', 'morning', 'housing'],
  ['HOUSEJOY', 'housejoy@icici', 'upi', '₹500 to ₹2,000', 'afternoon', 'housing'],
  ['SHREE KRISHNA MEDICOS', null, 'card', '₹100 to ₹500', 'evening', 'health'],
  ['MANIPAL HEALTH ENTERPRISES', null, 'card', '₹2,000 to ₹10,000', 'morning', 'health'],
  ['DR LAL PATH LAB', null, 'card', '₹500 to ₹2,000', 'morning', 'health'],
  ['CLOVE DENTAL', null, 'card', '₹2,000 to ₹10,000', 'afternoon', 'health'],
  ['WELLNESS FOREVER', null, 'card', '₹100 to ₹500', 'night', 'health'],
  ['ANYTIME FITNESS', null, 'card', '₹2,000 to ₹10,000', 'morning', 'health'],
  ['PLAYO', 'playo@icici', 'upi', '₹100 to ₹500', 'evening', 'entertainment'],
  ['TIMEZONE ENTERTAINMENT', null, 'card', '₹500 to ₹2,000', 'evening', 'entertainment'],
  ['WONDERLA HOLIDAYS', null, 'card', '₹2,000 to ₹10,000', 'morning', 'entertainment'],
  ['STEAM PURCHASE', null, 'card', '₹500 to ₹2,000', 'night', 'entertainment'],
  ['PAYTM INSIDER', 'insider@paytm', 'upi', '₹500 to ₹2,000', 'night', 'entertainment'],
  ['KUKU FM', null, 'card', '₹100 to ₹500', 'night', 'entertainment'],
  ['ZOOMCAR INDIA', null, 'card', '₹2,000 to ₹10,000', 'morning', 'travel'],
  ['TREEBO HOTELS', null, 'card', '₹2,000 to ₹10,000', 'afternoon', 'travel'],
  ['FABHOTELS', null, 'card', '₹2,000 to ₹10,000', 'night', 'travel'],
  ['ZOSTEL', 'zostel@icici', 'upi', '₹500 to ₹2,000', 'afternoon', 'travel'],
  ['THOMAS COOK INDIA', null, 'card', 'over ₹50,000', 'afternoon', 'travel'],
  ['FERNS N PETALS', null, 'card', '₹500 to ₹2,000', 'evening', 'family'],
  ['IGP COM', null, 'card', '₹500 to ₹2,000', 'night', 'family'],
  ['GIVEINDIA DONATIONS', null, 'card', '₹500 to ₹2,000', 'night', 'family'],
  ['ISKCON TEMPLE', 'iskcon.blr@sbi', 'upi', '₹100 to ₹500', 'morning', 'family'],
  ['KUVERA', null, 'neft', '₹2,000 to ₹10,000', 'morning', 'investments'],
  ['PAYTM MONEY', 'paytmmoney@paytm', 'upi', '₹2,000 to ₹10,000', 'morning', 'investments'],
  ['SMALLCASE TECHNOLOGIES', null, 'card', '₹2,000 to ₹10,000', 'morning', 'investments'],
  ['DHAN', 'dhan@icici', 'upi', '₹2,000 to ₹10,000', 'afternoon', 'investments'],
  ['PHONEPE WALLET TOPUP', null, 'card', '₹500 to ₹2,000', 'afternoon', 'other'],
  ['INDIA POST', null, 'card', 'under ₹100', 'morning', 'other'],
  ['PASSPORT SEVA', null, 'card', '₹500 to ₹2,000', 'morning', 'other'],
];

/** The sample as an eval set, keeping only payees the app would actually send to the AI. */
export function sampleDataset(): Dataset {
  const merchants: LabelledMerchant[] = [];
  let people = 0;
  for (const [label, vpa, channel, amountBand, timeOfDay, expected] of SAMPLE) {
    if (looksLikePerson({ channel, counterparty: label, vpa })) {
      people++;
      continue;
    }
    merchants.push({
      item: { merchant: normaliseMerchant(label), label, vpa: shareableVpa(vpa), amountBand, timeOfDay, direction: 'debit' },
      expected,
      entries: 1,
      inDictionary: lookupBuiltin(label, vpa) !== null,
    });
  }
  return {
    categories: DEFAULT_CATEGORIES.map((c) => ({ key: c.key, name: c.name })),
    merchants,
    skipped: people > 0 ? { 'look like a person to the app, so never sent to the AI': people } : {},
  };
}
