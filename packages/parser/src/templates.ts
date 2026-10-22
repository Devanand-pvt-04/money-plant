import type { BankId, Direction, Instrument } from './types';

/**
 * Known message formats per bank. Named groups:
 *   amount (required), last (account or card digits), cp (counterparty),
 *   vpa, ref, bal (balance), limit (available credit limit).
 * Fields a template doesn't capture are filled in by the generic extractors.
 *
 * Banks change wording often. When a real message fails, add an anonymised copy
 * to fixtures/<bank>/ first, then adjust or add a template until it passes.
 */
export interface Template {
  id: string;
  bank: BankId;
  direction: Direction;
  /** `card` means "decide from balance or limit", as for the generic parser. */
  instrument: Instrument;
  pattern: RegExp;
}

const A = String.raw`(?<amount>[0-9][0-9,]*(?:\.[0-9]{1,2})?)`;
const CUR = String.raw`(?:Rs\.?|INR|₹)\s*`;
const BAL = String.raw`(?<bal>[0-9][0-9,]*(?:\.[0-9]{1,2})?)`;
const LIMIT = String.raw`(?<limit>[0-9][0-9,]*(?:\.[0-9]{1,2})?)`;
const MASK = String.raw`[xX*•.]*`;

const t = (id: string, bank: BankId, direction: Direction, instrument: Instrument, source: string): Template => ({
  id,
  bank,
  direction,
  instrument,
  pattern: new RegExp(source, 'is'),
});

export const TEMPLATES: readonly Template[] = [
  // HDFC Bank
  t('hdfc.upi_sent', 'hdfc', 'debit', 'account',
    String.raw`Sent ${CUR}${A}\s+From HDFC Bank A\/C ${MASK}(?<last>\d{3,4})\s+To (?<cp>[^\n]+?)\s+On [\d\/\-]+\s*Ref (?<ref>\d+)`),
  t('hdfc.upi_received', 'hdfc', 'credit', 'account',
    String.raw`Received ${CUR}${A}\s*in your HDFC Bank A\/c ${MASK}(?<last>\d{3,4})\s*from (?<cp>[^\n(]+?)\s*(?:\((?<vpa>[^)\s]+)\))?\s*on [\d\/\-]+\.?\s*UPI Ref(?: No\.?)?\s*(?<ref>\d+)`),
  t('hdfc.upi_credit_vpa', 'hdfc', 'credit', 'account',
    String.raw`${CUR}${A} credited to (?:your )?HDFC Bank A\/c ${MASK}(?<last>\d{3,4}) on [\d\/\-]+ by a\/c linked to VPA (?<vpa>\S+) \(UPI Ref No\.?\s*(?<ref>\d+)\)`),
  t('hdfc.card_spent', 'hdfc', 'debit', 'card',
    String.raw`Spent ${CUR}${A}\s+(?:On|From) HDFC Bank (?:Credit |Debit )?Card ${MASK}(?<last>\d{4})\s+At (?<cp>[^\n]+?)\s+On \S+`),
  t('hdfc.update_debit', 'hdfc', 'debit', 'account',
    String.raw`Update! ${CUR}${A} debited from HDFC Bank (?:A\/c )?${MASK}(?<last>\d{3,4}) on [^.]+?\.\s*Info:?\s*(?<cp>[^\n]+?)\.\s*Avl bal:?\s*${CUR}${BAL}`),
  t('hdfc.update_credit', 'hdfc', 'credit', 'account',
    String.raw`Update! ${CUR}${A} deposited in HDFC Bank A\/c ${MASK}(?<last>\d{3,4}) on [^.]+? for (?<cp>[^\n]+?)\.\s*Avl bal:?\s*${CUR}${BAL}`),
  t('hdfc.card_payment', 'hdfc', 'credit', 'credit_card',
    String.raw`Payment of ${CUR}${A} (?:has been )?received (?:on|towards|for) your HDFC Bank Credit Card (?:ending )?${MASK}(?<last>\d{4})`),

  // ICICI Bank
  t('icici.upi_debit', 'icici', 'debit', 'account',
    String.raw`ICICI Bank Acc(?:oun)?t ${MASK}(?<last>\d{3,4}) debited (?:for|with) ${CUR}${A} on [\w\-]+;\s*(?<cp>[^;\n]+?) credited\.\s*UPI:?\s*(?<ref>\d+)`),
  t('icici.upi_credit', 'icici', 'credit', 'account',
    String.raw`(?:ICICI Bank )?Acc(?:oun)?t ${MASK}(?<last>\d{3,4}) is credited with ${CUR}${A} on [\w\-]+ from (?<cp>[^\n]+?)\.\s*UPI:?\s*(?<ref>\d+)`),
  t('icici.card_spent', 'icici', 'debit', 'credit_card',
    String.raw`${CUR}${A} spent (?:using|on) ICICI Bank Card ${MASK}(?<last>\d{4}) on [\w\-]+ (?:on|at) (?<cp>[^\n]+?)\.\s*Avl Limit:?\s*${CUR}${LIMIT}`),
  t('icici.acct_credit', 'icici', 'credit', 'account',
    String.raw`ICICI Bank Account ${MASK}(?<last>\d{3,4}) (?:is )?credited:?\s*${CUR}${A} on [\w\-]+\.\s*Info:?\s*(?<cp>[^\n]+?)\.\s*Available Balance is ${CUR}${BAL}`),
  t('icici.acct_debit', 'icici', 'debit', 'account',
    String.raw`ICICI Bank Acc(?:oun)?t ${MASK}(?<last>\d{3,4}) (?:is )?debited (?:with|for) ${CUR}${A} on [\w\-]+\.?\s*(?:Info:?\s*(?<cp>[^\n]+?)\.)?\s*Available Balance is ${CUR}${BAL}`),
  t('icici.card_payment', 'icici', 'credit', 'credit_card',
    String.raw`(?:Payment|We have received payment) of ${CUR}${A} (?:on|towards|for) (?:your )?ICICI Bank Credit Card ${MASK}(?<last>\d{4})`),

  // SBI
  t('sbi.upi_debit', 'sbi', 'debit', 'account',
    String.raw`Dear UPI user A\/C ${MASK}(?<last>\d{3,4}) debited by ${A} on date \w+ trf to (?<cp>[^\n]+?) Refno (?<ref>\d+)`),
  t('sbi.upi_credit', 'sbi', 'credit', 'account',
    String.raw`Dear SBI (?:UPI )?User, your A\/c ${MASK}(?<last>\d{3,4})-credited by ${CUR}?${A} on \w+ transfer from (?<cp>[^\n]+?) Ref No (?<ref>\d+)`),
  t('sbi.acct_debit', 'sbi', 'debit', 'account',
    String.raw`Your A\/C ${MASK}(?<last>\d{3,4}) Debited ${CUR}${A} on [\d\/\-]+\s*-?\s*(?<cp>[^\n]+?)\.\s*Avl Bal(?:ance)? ${CUR}${BAL}`),
  t('sbi.acct_credit', 'sbi', 'credit', 'account',
    String.raw`Your a\/c no\. ${MASK}(?<last>\d{3,4}) is credited by ${CUR}${A} on [\d\-\/]+ by (?<cp>[^\n(]+?) \((?:IMPS|NEFT|UPI) Ref no\.? (?<ref>\w+)\)`),
  t('sbi.card_spent', 'sbi', 'debit', 'credit_card',
    String.raw`${CUR}${A} spent on your SBI Credit Card ending (?:with )?(?<last>\d{4}) at (?<cp>[^\n]+?) on [\d\/\-]+`),
  t('sbi.card_payment', 'sbi', 'credit', 'credit_card',
    String.raw`(?:We have received (?:a )?payment of|Payment of) ${CUR}${A} (?:has been received )?(?:towards|for|on) your SBI Credit Card ending (?:with )?(?<last>\d{4})`),

  // HSBC
  t('hsbc.card_spent', 'hsbc', 'debit', 'credit_card',
    String.raw`Thank you for using (?:your )?HSBC Credit Card ending (?:with )?(?<last>\d{4}) for ${CUR}${A} on .+? at (?<cp>[^\n]+?)\.\s*Your available limit is ${CUR}${LIMIT}`),
  t('hsbc.acct_debit', 'hsbc', 'debit', 'account',
    String.raw`${CUR}${A} (?:is )?debited from (?:your )?(?:HSBC )?A\/C ${MASK}(?<last>\d{3,4}) on \w+ (?:to|towards) (?:VPA )?(?<cp>[^\n,]+?),? (?:UPI )?Ref(?:erence)?(?: No\.?)? (?<ref>\w+)`),
  t('hsbc.acct_credit', 'hsbc', 'credit', 'account',
    String.raw`${CUR}${A} (?:is )?credited to (?:your )?(?:HSBC )?A\/C ${MASK}(?<last>\d{3,4}) on \w+ (?:from|by) (?:VPA )?(?<cp>[^\n,]+?),? (?:UPI )?Ref(?:erence)?(?: No\.?)? (?<ref>\w+)`),
];
