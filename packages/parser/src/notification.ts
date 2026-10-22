import { parseRupees, type Paise } from '@money-plant/core';
import { cleanCounterparty, ignoreReason } from './extract';
import { UPI_APP_PACKAGES } from './senders';
import type { Direction } from './types';

export interface NotificationInput {
  packageName: string;
  title: string;
  text: string;
}

/** A payment seen in a UPI app notification. It has no account, so it only enriches an SMS entry (CAP-3). */
export interface ParsedNotification {
  app: string;
  direction: Direction;
  amount: Paise;
  counterparty: string | null;
}

const AMT = String.raw`(?:₹|Rs\.?\s*|INR\s*)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)`;
const NAME = String.raw`([^\n.!]+?)`;
const END = String.raw`(?=\s+(?:via|using|from your|on|successfully|is successful)\b|[.!]|\n|$)`;

const PATTERNS: readonly [Direction, RegExp][] = [
  // "Paid ₹450 to Swiggy", "You paid ₹450 to SWIGGY", "₹450 sent to Ravi Kumar"
  ['debit', new RegExp(String.raw`(?:paid|sent|payment of)\s+${AMT}\s+(?:to|at)\s+${NAME}${END}`, 'i')],
  ['debit', new RegExp(String.raw`${AMT}\s+(?:paid|sent)\s+(?:to|at)\s+${NAME}${END}`, 'i')],
  // "Received ₹2,000 from Ravi Kumar", "₹2,000 received from Ravi"
  ['credit', new RegExp(String.raw`received\s+${AMT}\s+from\s+${NAME}${END}`, 'i')],
  ['credit', new RegExp(String.raw`${AMT}\s+received\s+from\s+${NAME}${END}`, 'i')],
  // "Ravi Kumar paid you ₹2,000", "Ravi sent you ₹500"
  ['credit', new RegExp(String.raw`^${NAME}\s+(?:paid|sent)\s+you\s+${AMT}`, 'i')],
];

export function parseNotification(input: NotificationInput): ParsedNotification | null {
  const app = UPI_APP_PACKAGES[input.packageName];
  if (!app) return null;
  const text = `${input.title}\n${input.text}`.trim();
  if (ignoreReason(text)) return null;
  for (const [direction, pattern] of PATTERNS) {
    const match = pattern.exec(input.title) ?? pattern.exec(input.text) ?? pattern.exec(text);
    if (!match) continue;
    // The "X paid you" form has the name first.
    const nameFirst = pattern.source.startsWith('^');
    const amount = parseRupees(nameFirst ? match[2]! : match[1]!);
    if (amount === null || amount <= 0) continue;
    return {
      app,
      direction,
      amount,
      counterparty: cleanCounterparty(nameFirst ? match[1]! : match[2]!),
    };
  }
  return null;
}
