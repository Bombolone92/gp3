/**
 * The general ledger, stored column-wise in typed arrays.
 *
 * Every report is a sum over postings filtered by date and account. Keeping
 * the postings sorted by date in flat Int32/Float64 arrays means a date range
 * is two binary searches and a tight loop with no allocation, and an account
 * register is a precomputed index list (compressed-row layout). Building the
 * whole ledger for 100,000 transactions takes a few tens of milliseconds and
 * happens at most once per change, lazily, when something asks for it.
 */
import { postings as postingsOf } from './txn.js';
import { dayNum } from './dates.js';

class Growable {
  constructor(Type, capacity = 1024) {
    this.Type = Type;
    this.data = new Type(capacity);
    this.length = 0;
  }
  push(v) {
    if (this.length === this.data.length) {
      const next = new this.Type(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
  done() {
    return this.data.subarray(0, this.length);
  }
}

export class Ledger {
  /**
   * @param {object[]} txns     every transaction (any order)
   * @param {object}   ctx      { role, item, taxRate, txn } lookups for postings()
   * @param {'accrual'|'cash'} basis
   * @param {string[]} accountIds  known account ids (others are appended)
   */
  constructor(txns, ctx, basis = 'accrual', accountIds = []) {
    this.basis = basis;
    this.accountIndex = new Map();
    this.accountIds = [];
    for (const id of accountIds) this._acct(id);
    this.contactIndex = new Map();
    this.contactIds = [];

    // Date, then entry order, so a register reads the way it was written.
    const sorted = txns.slice().sort((a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.createdAt || 0) - (b.createdAt || 0) || (a.id < b.id ? -1 : 1));
    this.txns = sorted;

    const n = Math.max(16, sorted.length * 3);
    const day = new Growable(Int32Array, n);
    const acct = new Growable(Int32Array, n);
    const amt = new Growable(Float64Array, n);
    const contact = new Growable(Int32Array, n);
    const txn = new Growable(Int32Array, n);
    this.memos = [];
    this.taxRates = [];

    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      const d = dayNum(t.date);
      for (const p of postingsOf(t, basis, ctx)) {
        if (!p.accountId || !p.amount) continue;
        day.push(d);
        acct.push(this._acct(p.accountId));
        amt.push(p.amount);
        contact.push(p.contactId ? this._contact(p.contactId) : -1);
        txn.push(i);
        this.memos.push(p.memo || '');
        this.taxRates.push(p.taxRateId || null);
      }
    }
    this.day = day.done();
    this.acct = acct.done();
    this.amt = amt.done();
    this.contact = contact.done();
    this.txn = txn.done();
    this.size = this.day.length;
    this._byAccount = null;
  }

  _acct(id) {
    let i = this.accountIndex.get(id);
    if (i === undefined) {
      i = this.accountIds.length;
      this.accountIndex.set(id, i);
      this.accountIds.push(id);
    }
    return i;
  }

  _contact(id) {
    let i = this.contactIndex.get(id);
    if (i === undefined) {
      i = this.contactIds.length;
      this.contactIndex.set(id, i);
      this.contactIds.push(id);
    }
    return i;
  }

  /** First posting index with day >= d. */
  lowerBound(d) {
    let lo = 0;
    let hi = this.size;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.day[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** [start, end) posting range for ISO dates (either may be null). */
  range(from, to) {
    const start = from ? this.lowerBound(dayNum(from)) : 0;
    const end = to ? this.lowerBound(dayNum(to) + 1) : this.size;
    return [start, Math.max(start, end)];
  }

  /** Per-account sums over a date range, as a Float64Array indexed like accountIds. */
  activity(from, to) {
    const out = new Float64Array(this.accountIds.length);
    const [s, e] = this.range(from, to);
    const acct = this.acct;
    const amt = this.amt;
    for (let i = s; i < e; i++) out[acct[i]] += amt[i];
    return out;
  }

  /** Per-account balances as of the end of `to` (null = everything). */
  balancesAsOf(to) {
    return this.activity(null, to);
  }

  /** Sum for one account (by id) over a range. */
  sumAccount(accountId, from, to) {
    const a = this.accountIndex.get(accountId);
    if (a === undefined) return 0;
    const idx = this.byAccount(a);
    let total = 0;
    const fromDay = from ? dayNum(from) : -Infinity;
    const toDay = to ? dayNum(to) : Infinity;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const d = this.day[i];
      if (d < fromDay) continue;
      if (d > toDay) break;
      total += this.amt[i];
    }
    return total;
  }

  /**
   * Posting indexes of one account, in date order. Built for every account at
   * once with a counting sort the first time any register is asked for.
   */
  byAccount(accountIdx) {
    if (!this._byAccount) {
      const nA = this.accountIds.length;
      const counts = new Int32Array(nA + 1);
      for (let i = 0; i < this.size; i++) counts[this.acct[i] + 1]++;
      for (let a = 0; a < nA; a++) counts[a + 1] += counts[a];
      const offsets = counts.slice();
      const idx = new Int32Array(this.size);
      const cursor = counts.slice(0, nA);
      for (let i = 0; i < this.size; i++) idx[cursor[this.acct[i]]++] = i;
      this._byAccount = { offsets, idx };
    }
    const { offsets, idx } = this._byAccount;
    if (accountIdx === undefined || accountIdx < 0 || accountIdx >= this.accountIds.length) return new Int32Array(0);
    return idx.subarray(offsets[accountIdx], offsets[accountIdx + 1]);
  }

  /**
   * Register rows for a set of account ids (an account and its sub-accounts),
   * with a running balance. One row per transaction: a transaction with two
   * lines to the same account appears once with the combined amount.
   */
  register(accountIds, { from = null, to = null } = {}) {
    const lists = [];
    for (const id of accountIds) {
      const a = this.accountIndex.get(id);
      if (a !== undefined) lists.push(this.byAccount(a));
    }
    let all;
    if (lists.length === 1) all = lists[0];
    else {
      let total = 0;
      for (const l of lists) total += l.length;
      all = new Int32Array(total);
      let o = 0;
      for (const l of lists) { all.set(l, o); o += l.length; }
      all.sort();
    }
    const fromDay = from ? dayNum(from) : -Infinity;
    const toDay = to ? dayNum(to) : Infinity;
    const rows = [];
    let running = 0;
    let opening = 0;
    let last = null;
    for (let k = 0; k < all.length; k++) {
      const i = all[k];
      const d = this.day[i];
      if (d > toDay) break;
      if (d < fromDay) { opening += this.amt[i]; running += this.amt[i]; continue; }
      running += this.amt[i];
      if (last && last.txnIdx === this.txn[i]) {
        last.amount += this.amt[i];
        last.balance = running;
        continue;
      }
      last = { postingIdx: i, txnIdx: this.txn[i], txn: this.txns[this.txn[i]], amount: this.amt[i], balance: running, memo: this.memos[i] };
      rows.push(last);
    }
    return { rows, opening, closing: running };
  }

  /** Postings in a date range, optionally for some accounts, as plain rows. */
  rows({ from = null, to = null, accounts = null } = {}) {
    const [s, e] = this.range(from, to);
    const want = accounts ? new Set([...accounts].map((id) => this.accountIndex.get(id)).filter((x) => x !== undefined)) : null;
    const out = [];
    for (let i = s; i < e; i++) {
      if (want && !want.has(this.acct[i])) continue;
      out.push(this.row(i));
    }
    return out;
  }

  row(i) {
    return {
      i,
      day: this.day[i],
      accountId: this.accountIds[this.acct[i]],
      amount: this.amt[i],
      contactId: this.contact[i] >= 0 ? this.contactIds[this.contact[i]] : null,
      txn: this.txns[this.txn[i]],
      memo: this.memos[i],
      taxRateId: this.taxRates[i],
    };
  }

  /**
   * Sum by contact over a range for accounts accepted by `accountFilter(idx)`.
   * Returns Map(contactId -> Map(accountId -> amount)).
   */
  byContact(from, to, accountFilter) {
    const [s, e] = this.range(from, to);
    const out = new Map();
    for (let i = s; i < e; i++) {
      const a = this.acct[i];
      if (accountFilter && !accountFilter(a)) continue;
      const c = this.contact[i];
      const cid = c >= 0 ? this.contactIds[c] : null;
      let m = out.get(cid);
      if (!m) { m = new Map(); out.set(cid, m); }
      const aid = this.accountIds[a];
      m.set(aid, (m.get(aid) || 0) + this.amt[i]);
    }
    return out;
  }

  /** Sanity check: every posting in the ledger sums to zero. */
  imbalance() {
    let total = 0;
    for (let i = 0; i < this.size; i++) total += this.amt[i];
    return total;
  }
}
