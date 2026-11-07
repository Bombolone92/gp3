/**
 * The offline outbox: finished sales that haven't reached the cloud yet.
 *
 * A register is the one app that has to keep working when the network doesn't.
 * When a sale can't be written - the shop's Wi-Fi blinked with a customer
 * standing at the counter - the receipt is kept here and flushed later, so
 * checkout never stops and no sale is ever lost.
 *
 * localStorage, deliberately: it is synchronous (so a queued sale is durable
 * before the success screen paints), survives a reload, and needs no network.
 * The key is scoped to the signed-in account so two users of the same browser
 * can never inherit each other's sales.
 */

const PREFIX = 'pos:outbox:v1';

/** Far more than any plausible outage; a guard against unbounded growth. */
const MAX_ENTRIES = 500;

/**
 * Whether a failure looks like the network rather than a real rejection.
 *
 * Only transport-shaped failures are safe to queue: a genuine API error
 * (permission, quota, malformed path) would never succeed on retry and must
 * surface to the cashier instead of being swallowed into the outbox.
 */
export function isTransportError(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (!err) return false;
  // fetch() rejects with a TypeError when it can't reach the host at all.
  const name = String(err.name || '');
  if (name === 'TypeError' || name === 'NetworkError' || name === 'AbortError') return true;
  const message = String(err.message ?? err.error?.message ?? '');
  if (/failed to fetch|load failed|network ?error|networkerror|timed? ?out|offline|connection|unreachable|econn|socket hang|fetch failed/i.test(message)) return true;
  const code = String(err.code ?? err.error?.code ?? '');
  return /network|timeout|unavailable|econn|offline/i.test(code);
}

export class Outbox {
  /** @param {string} scope - account-scoped suffix for the storage key. */
  constructor(scope = 'anon') {
    this.key = `${PREFIX}:${scope}`;
    this.entries = this.#read();
  }

  #read() {
    try {
      const raw = localStorage.getItem(this.key);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((e) => e && e.monthKey && e.receipt?.id);
    } catch {
      return [];
    }
  }

  #write() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.entries));
      return true;
    } catch (err) {
      // A full or unavailable store must not pretend the sale is safe.
      console.error(err);
      return false;
    }
  }

  get count() {
    return this.entries.length;
  }

  has(id) {
    return this.entries.some((e) => e.receipt.id === id);
  }

  /** Receipts queued for a month, oldest first (the order they were rung up). */
  forMonth(monthKey) {
    return this.entries.filter((e) => e.monthKey === monthKey).map((e) => e.receipt);
  }

  /** Month keys with anything waiting, oldest month first. */
  months() {
    return [...new Set(this.entries.map((e) => e.monthKey))].sort();
  }

  /** All queued receipts, oldest first. */
  all() {
    return this.entries.map((e) => e.receipt);
  }

  /** The highest receipt number sitting in the queue, or 0. */
  maxNumber() {
    return this.entries.reduce((max, e) => Math.max(max, Number(e.receipt.number) || 0), 0);
  }

  /** Queue a receipt. Throws if it cannot be made durable. */
  add(receipt, monthKey) {
    if (this.entries.length >= MAX_ENTRIES) {
      throw new Error('Too many sales are waiting to sync.');
    }
    if (this.has(receipt.id)) return receipt;
    const previous = this.entries;
    this.entries = [...previous, { monthKey, queuedAt: Date.now(), receipt }];
    if (!this.#write()) {
      this.entries = previous;
      throw new Error('Couldn’t save the sale on this device.');
    }
    return receipt;
  }

  /** Drop the given receipt ids (they made it to the cloud). */
  remove(ids) {
    const gone = new Set(ids);
    if (!this.entries.some((e) => gone.has(e.receipt.id))) return;
    this.entries = this.entries.filter((e) => !gone.has(e.receipt.id));
    this.#write();
  }

  clear() {
    this.entries = [];
    try {
      localStorage.removeItem(this.key);
    } catch { /* nothing more we can do */ }
  }
}
