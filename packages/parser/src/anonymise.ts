/**
 * CAP-9: turns a bank SMS the app couldn't read into a sample that is safe to
 * share, following fixtures/README.md. The wording, spacing and punctuation
 * stay exactly as the bank wrote them, so the sample is still useful for a
 * new template; what could identify the person goes:
 *
 * - every run of 3 or more digits becomes 1234…, keeping commas and dots, so
 *   amounts, balances, account and card digits and references are replaced
 * - email addresses become user@example.com, and the part of a UPI ID before
 *   @ becomes ravi (the bank handle after @ stays: it tells which app paid)
 * - a capitalised name after words such as "from", "to", "by" or "Dear"
 *   becomes RAVI KUMAR (or Ravi Kumar)
 *
 * Dates and times stay, since parsers need their format and they say little
 * on their own. The result is a best effort: the user sees it, can edit it,
 * and shares it only by tapping Share.
 */

const DATE_OR_TIME = [
  /\b\d{1,2}[-/ ](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-/ ,]*\d{2,4}\b/gi,
  /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]m)?\b/gi,
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
const VPA = /[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,64}/g;

/** Words after which banks put a person's or shop's name, as written, Capitalised or in capitals. */
const LEADS = ['from', 'to', 'by', 'dear', 'mr', 'ms', 'mrs', 'towards', 'for', 'info'];
const NAME_LEAD = `\\b(${LEADS.flatMap((w) => [w, w[0]!.toUpperCase() + w.slice(1), w.toUpperCase()]).join('|')})(\\.?:?\\s+)`;

/** Capitalised words after a lead that are part of the bank's own wording, not a name. */
const NOT_NAMES = new Set(
  [
    'your', 'you', 'a/c', 'ac', 'acct', 'account', 'bank', 'icici', 'hdfc', 'sbi', 'hsbc', 'axis', 'kotak', 'slice',
    'upi', 'neft', 'imps', 'rtgs', 'atm', 'pos', 'card', 'credit', 'debit', 'customer', 'the', 'rs', 'rs.', 'inr', 'mandate',
    'autopay', 'avl', 'bal', 'balance', 'ref', 'refno', 'reference', 'xx', 'call', 'sms', 'block', 'savings', 'current',
  ],
);

// Kept text waits behind a private-use character, which has no digits for the digit pass to touch.
function placeholder(i: number): string {
  return `\u0000${String.fromCharCode(0xe000 + i)}\u0000`;
}

function replaceDigits(run: string): string {
  let n = 0;
  return run.replace(/\d/g, () => String(++n % 10));
}

function fakeName(original: string): string {
  const words = original.trim().split(/\s+/).length;
  const caps = original === original.toUpperCase();
  const name = words > 1 ? 'Ravi Kumar' : 'Ravi';
  return caps ? name.toUpperCase() : name;
}

export function anonymiseSms(body: string): string {
  const kept: string[] = [];
  const keep = (value: string) => {
    kept.push(value);
    return placeholder(kept.length - 1);
  };

  let text = body;
  for (const pattern of DATE_OR_TIME) text = text.replace(pattern, keep);
  text = text.replace(EMAIL, () => keep('user@example.com'));
  text = text.replace(VPA, (vpa) => {
    const at = vpa.indexOf('@');
    return keep(`ravi${vpa.slice(at)}`);
  });

  // A name is up to three capitalised words right after a lead word.
  text = text.replace(
    new RegExp(`${NAME_LEAD}([A-Z][A-Za-z.'-]*(?: +[A-Z][A-Za-z.'-]*){0,2})`, 'g'),
    (match, lead: string, gap: string, name: string) => {
      const words = name.split(/\s+/);
      const first = words[0]!.toLowerCase();
      if (NOT_NAMES.has(first) || /\d/.test(name)) return match;
      // Stop at the first word that is the bank's wording.
      const cut = words.findIndex((w) => NOT_NAMES.has(w.toLowerCase()));
      const nameWords = cut === -1 ? words : words.slice(0, cut);
      const rest = cut === -1 ? '' : name.slice(nameWords.join(' ').length);
      return `${lead}${gap}${keep(fakeName(nameWords.join(' ')))}${rest}`;
    },
  );

  text = text.replace(/\d[\d,.]*\d|\d/g, (run) => (run.replace(/\D/g, '').length >= 3 ? replaceDigits(run) : run));
  return text.replace(/\u0000([\ue000-\uf8ff])\u0000/g, (_, c: string) => kept[c.charCodeAt(0) - 0xe000]!);
}
