const NOISE =
  /\b(?:pvt|private|ltd|limited|llp|inc|the|co|india|in|upi|pos|ecom|payment|payments|www|com|online|technologies|technology|tech|services|retail)\b/g;

/**
 * Normalises a merchant label so the same merchant compares equal across
 * messages: "SWIGGY LIMITED", "Swiggy" and "swiggy pvt ltd" all become "swiggy".
 * The result is the key of rules, the merchant cache and the shared dictionary.
 */
export function normaliseMerchant(label: string): string {
  const cleaned = label
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || label.toLowerCase().trim();
}

export interface DictionaryEntry {
  /** Matched against the normalised label and the part of the UPI ID before @. */
  pattern: RegExp;
  key: string;
  name: string;
}

const entry = (pattern: RegExp, key: string, name: string): DictionaryEntry => ({ pattern, key, name });

/**
 * Built-in merchant dictionary for common Indian merchants. More specific
 * entries come first (Swiggy Instamart before Swiggy). The shared `merchants`
 * table on Supabase extends this with what the AI learns.
 */
export const BUILTIN_MERCHANTS: readonly DictionaryEntry[] = [
  entry(/\b(?:instamart|swiggy ?mart)\b/, 'food.groceries', 'Swiggy Instamart'),
  entry(/\bzepto\b/, 'food.groceries', 'Zepto'),
  entry(/\bblinkit|grofers\b/, 'food.groceries', 'Blinkit'),
  entry(/\bbig ?basket|bbnow\b/, 'food.groceries', 'BigBasket'),
  entry(/\bdmart|avenue supermarts\b/, 'food.groceries', 'DMart'),
  entry(/\b(?:reliance (?:fresh|smart|retail)|jiomart)\b/, 'food.groceries', 'Reliance Retail'),
  entry(/\bmore (?:retail|supermarket)\b/, 'food.groceries', 'More'),
  entry(/\bswiggy\b|\bbundl\b/, 'food.delivery', 'Swiggy'),
  entry(/\bzomato\b/, 'food.delivery', 'Zomato'),
  entry(/\b(?:dominos|domino s|jubilant foodworks)\b/, 'food.eating_out', "Domino's"),
  entry(/\b(?:mcdonald|hardcastle|westlife)\b/, 'food.eating_out', "McDonald's"),
  entry(/\b(?:starbucks|tata starbucks)\b/, 'food.eating_out', 'Starbucks'),
  entry(/\b(?:kfc|devyani)\b/, 'food.eating_out', 'KFC'),
  entry(/\bchaayos|chai point|third wave\b/, 'food.snacks', 'Cafe'),
  entry(/\buber ?eats\b/, 'food.delivery', 'Uber Eats'),
  entry(/\buber\b/, 'transport.cab', 'Uber'),
  entry(/\bola(?:cabs)?\b|\bani technologies\b/, 'transport.cab', 'Ola'),
  entry(/\brapido|roppen\b/, 'transport.cab', 'Rapido'),
  entry(/\bnamma yatri|blusmart\b/, 'transport.cab', 'Cab'),
  entry(/\b(?:irctc)\b/, 'transport.train', 'IRCTC'),
  entry(/\b(?:metro rail|dmrc|bmrcl|mmrcl|hmrl|cmrl)\b/, 'transport.bus', 'Metro'),
  entry(/\b(?:fastag|nhai|paytm fastag)\b/, 'transport.tolls', 'FASTag'),
  entry(/\b(?:indian oil|iocl|bharat petroleum|bpcl|hindustan petroleum|hpcl|shell|nayara|petrol|fuel)\b/, 'transport.fuel', 'Fuel'),
  entry(/\b(?:indigo|interglobe|air india|akasa|spicejet|vistara)\b/, 'travel.flights', 'Flight'),
  entry(/\b(?:makemytrip|goibibo|cleartrip|yatra|ixigo)\b/, 'travel', 'Travel booking'),
  entry(/\b(?:oyo|oravel|airbnb|taj hotels|marriott)\b/, 'travel.hotels', 'Hotel'),
  entry(/\b(?:amazon ?pay ?bill|amazon recharge)\b/, 'bills.recharge', 'Amazon recharge'),
  entry(/\b(?:amazon|amzn)\b/, 'shopping.online', 'Amazon'),
  entry(/\bflipkart\b/, 'shopping.online', 'Flipkart'),
  entry(/\bmyntra\b/, 'shopping.clothing', 'Myntra'),
  entry(/\b(?:ajio|trent|westside|zudio|max fashion|lifestyle|pantaloons|h m|uniqlo)\b/, 'shopping.clothing', 'Clothing'),
  entry(/\bmeesho\b/, 'shopping.online', 'Meesho'),
  entry(/\bnykaa\b/, 'personal_care', 'Nykaa'),
  entry(/\b(?:croma|reliance digital|vijay sales)\b/, 'shopping.electronics', 'Electronics'),
  entry(/\b(?:ikea|pepperfry|urban ladder)\b/, 'shopping.home', 'Home'),
  entry(/\b(?:urban ?company|urbanclap)\b/, 'housing.help', 'Urban Company'),
  entry(/\b(?:nobroker|nestaway|cred rent|rent)\b/, 'housing.rent', 'Rent'),
  entry(/\b(?:jio|reliance jio)\b/, 'bills.recharge', 'Jio'),
  entry(/\bairtel\b/, 'bills.recharge', 'Airtel'),
  entry(/\b(?:vodafone|vi|idea)\b/, 'bills.recharge', 'Vi'),
  entry(/\bbsnl\b/, 'bills.recharge', 'BSNL'),
  entry(/\b(?:act fibernet|hathway|excitel|tata play fiber|spectra)\b/, 'bills.broadband', 'Broadband'),
  entry(/\b(?:tata play|tata sky|dish tv|d2h|sun direct)\b/, 'bills.dth', 'DTH'),
  entry(/\b(?:bescom|tneb|tangedco|msedcl|mahadiscom|adani electricity|tata power|bses|cesc|electricity)\b/, 'bills.electricity', 'Electricity'),
  entry(/\b(?:indane|hp gas|bharatgas|mahanagar gas|igl|adani gas|gail gas)\b/, 'bills.gas', 'Gas'),
  entry(/\b(?:bwssb|water board|jal board)\b/, 'bills.water', 'Water'),
  entry(/\bnetflix\b/, 'entertainment.subscriptions', 'Netflix'),
  entry(/\bspotify\b/, 'entertainment.subscriptions', 'Spotify'),
  entry(/\b(?:hotstar|jiohotstar|jiocinema|sonyliv|zee5)\b/, 'entertainment.subscriptions', 'Streaming'),
  entry(/\b(?:youtube|google play|apple com bill|apple services|itunes)\b/, 'entertainment.subscriptions', 'Subscription'),
  entry(/\b(?:bookmyshow|bigtree|pvr|inox|cinepolis|district)\b/, 'entertainment.movies', 'Movies'),
  entry(/\b(?:apollo pharmacy|apollo|pharmeasy|netmeds|1mg|tata 1mg|medplus|pharmacy|chemist|medical)\b/, 'health.medicines', 'Pharmacy'),
  entry(/\b(?:practo|hospital|clinic|diagnostics|lal pathlabs|thyrocare)\b/, 'health.doctor', 'Doctor'),
  entry(/\b(?:cult ?fit|curefit|gym|fitness)\b/, 'health.fitness', 'Fitness'),
  entry(/\b(?:lic|life insurance|hdfc life|icici pru|sbi life|max life|star health|acko|digit insurance|policybazaar)\b/, 'insurance', 'Insurance'),
  entry(/\b(?:zerodha|groww|upstox|angel one|nextbillion)\b/, 'investments.stocks', 'Broker'),
  entry(/\b(?:bse star mf|nsdl mf|cams|kfintech|mutual fund|sip|indian clearing corp|iccl)\b/, 'investments.sip', 'SIP'),
  entry(/\b(?:emi|bajaj finance|home loan|loan)\b/, 'loans.emi', 'EMI'),
  entry(/\b(?:income tax|gst|tin nsdl|egov)\b/, 'taxes', 'Taxes'),
  entry(/\b(?:atm|cash withdrawal|nwd|cash wdl)\b/, 'cash', 'Cash withdrawal'),
  entry(/\b(?:udemy|coursera|byju|unacademy|school|college|university)\b/, 'education', 'Education'),
  entry(/\b(?:salary|sal for|payroll)\b/, 'income.salary', 'Salary'),
  entry(/\b(?:int pd|interest|int cr|sb int)\b/, 'income.interest', 'Interest'),
  entry(/\b(?:cashback|refund|reversal)\b/, 'income.refunds', 'Refund'),
];

export interface DictionaryMatch {
  key: string;
  name: string;
}

/** Looks a merchant up in the built-in dictionary by label, then by UPI ID. */
export function lookupBuiltin(label: string | null, vpa: string | null): DictionaryMatch | null {
  const candidates = [label ? normaliseMerchant(label) : null, vpa ? vpa.toLowerCase().split('@')[0]!.replace(/[^a-z0-9]+/g, ' ') : null];
  for (const text of candidates) {
    if (!text) continue;
    const found = BUILTIN_MERCHANTS.find((e) => e.pattern.test(text));
    if (found) return { key: found.key, name: found.name };
  }
  return null;
}
