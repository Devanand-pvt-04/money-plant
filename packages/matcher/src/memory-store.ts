import type { Paise } from '@money-plant/core';
import { SYSTEM_ACCOUNT_NAMES } from './types';
import type {
  BalanceAnchor,
  BalanceRef,
  LedgerAccount,
  LedgerStore,
  LedgerTransaction,
  PendingNotification,
  SystemAccountKey,
} from './types';

/** In-memory LedgerStore for tests. Mirrors what the phone's SQLite store does. */
export class MemoryStore implements LedgerStore {
  accounts = new Map<string, LedgerAccount>();
  openings = new Map<string, Paise>();
  transactions = new Map<string, LedgerTransaction>();
  deleted = new Set<string>();
  anchors: BalanceAnchor[] = [];
  refs = new Map<string, BalanceRef>();
  pending = new Map<string, PendingNotification>();
  private nextSystemId = 0;

  async listAccounts() {
    return [...this.accounts.values()].map((a) => ({ ...a }));
  }
  async createAccount(account: LedgerAccount) {
    this.accounts.set(account.id, { ...account });
    this.openings.set(account.id, 0 as Paise);
  }
  async setAccountLast4(accountId: string, last4: string) {
    this.accounts.get(accountId)!.last4 = last4;
  }
  async systemAccount(key: SystemAccountKey) {
    const name = SYSTEM_ACCOUNT_NAMES[key];
    const existing = [...this.accounts.values()].find((a) => a.type === 'category' && a.name === name);
    if (existing) return existing;
    const account: LedgerAccount = { id: `system-${this.nextSystemId++}`, type: 'category', name, institution: null, last4: null };
    await this.createAccount(account);
    return account;
  }
  async hasFingerprint(fingerprint: string) {
    for (const tx of this.transactions.values()) {
      if (tx.sources.some((s) => s.fingerprint === fingerprint)) return true;
    }
    return [...this.pending.values()].some((n) => n.source.fingerprint === fingerprint);
  }
  async transactionsBetween(fromIso: string, toIso: string) {
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    return [...this.transactions.values()]
      .filter((tx) => !this.deleted.has(tx.id))
      .filter((tx) => Date.parse(tx.occurredAt) >= from && Date.parse(tx.occurredAt) <= to)
      .map((tx) => structuredClone(tx));
  }
  async saveTransaction(transaction: LedgerTransaction) {
    this.transactions.set(transaction.id, structuredClone(transaction));
  }
  async addAnchor(anchor: BalanceAnchor) {
    this.anchors.push(anchor);
  }
  async getBalanceRef(accountId: string) {
    return this.refs.get(accountId) ?? null;
  }
  async setBalanceRef(accountId: string, ref: BalanceRef) {
    this.refs.set(accountId, ref);
  }
  async sumPostings(accountId: string, upToIso: string) {
    const upTo = Date.parse(upToIso);
    let sum = 0;
    for (const tx of this.transactions.values()) {
      if (this.deleted.has(tx.id) || Date.parse(tx.occurredAt) > upTo) continue;
      for (const p of tx.postings) if (p.accountId === accountId) sum += p.amount;
    }
    return sum as Paise;
  }
  async setOpeningBalance(accountId: string, opening: Paise) {
    this.openings.set(accountId, opening);
  }
  async pendingNotifications(fromIso: string, toIso: string) {
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    return [...this.pending.values()].filter(
      (n) => Date.parse(n.source.receivedAt) >= from && Date.parse(n.source.receivedAt) <= to,
    );
  }
  async addPendingNotification(notification: PendingNotification) {
    this.pending.set(notification.id, notification);
  }
  async removePendingNotification(id: string) {
    this.pending.delete(id);
  }

  /** Opening balance plus every posting in a live transaction. */
  balance(accountId: string): number {
    let sum: number = this.openings.get(accountId) ?? 0;
    for (const tx of this.transactions.values()) {
      if (this.deleted.has(tx.id)) continue;
      for (const p of tx.postings) if (p.accountId === accountId) sum += p.amount;
    }
    return sum;
  }

  live(): LedgerTransaction[] {
    return [...this.transactions.values()].filter((tx) => !this.deleted.has(tx.id));
  }
}
