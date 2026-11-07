/**
 * Late-fee policy: disclosed on the invoice, applied by hand.
 *
 * Both halves are deliberate rather than automatic. The policy (a flat
 * amount or a percentage of the balance, per month) prints on every unpaid
 * invoice — in many places a fee is only enforceable if it was disclosed —
 * and "Add late fee" on an overdue invoice appends a clearly labelled line
 * item computed from it. Nothing accrues on its own: there is no server,
 * and a silently growing balance would fight the derive-don't-store status
 * design in lib/doc.js.
 */

import { round2 } from './util.js';
import { docTotals, fmtMoney } from './money.js';
import { overdueAmount } from './aging.js';
import { translator } from './i18n.js';

/**
 * The policy applying to one client's invoices, or null when there is none:
 * the client's own policy when they carry one (an explicit "no late fee" is
 * a real answer and wins), the global one otherwise.
 */
export function lateFeePolicy(settings, client = null) {
  const norm = (p) => {
    if (!p || typeof p !== 'object' || p.type === 'none') return null;
    const value = Number(p.value) || 0;
    if (value <= 0) return null;
    return { type: p.type === 'fixed' ? 'fixed' : 'percent', value };
  };
  if (client?.lateFee && typeof client.lateFee === 'object' && client.lateFee.type) {
    return norm(client.lateFee);
  }
  return norm(settings?.lateFee);
}

/**
 * The disclosure printed on the paper. `money` is injectable because the
 * PDF formats money through its own WinAnsi-safe formatter, and `tr` is the
 * document language's translator (English when not given).
 */
export function lateFeeText(policy, currency, money = fmtMoney, tr = translator('')) {
  if (!policy) return '';
  const amount = policy.type === 'fixed' ? money(policy.value, currency) : `${policy.value}%`;
  return tr('lateFeeSentence', { amount });
}

/**
 * What one application of the policy adds right now: a percentage of what
 * is late, or the flat amount. Given the date, "what is late" is the part of
 * the balance past due — on a payment plan the installment whose date has
 * passed, never the half not due until autumn, which a fee on the whole
 * balance quietly charged interest on. Without a date it is the whole open
 * balance, as it always was. Nothing late, nothing charged.
 */
export function lateFeeAmount(policy, doc, asOf = null) {
  if (!policy) return 0;
  const base = asOf ? overdueAmount(doc, asOf) : docTotals(doc).balance;
  if (base <= 0.005) return 0;
  return policy.type === 'fixed'
    ? round2(policy.value)
    : round2(base * policy.value / 100);
}

/** The line-item name a fee lands under; the paper is its own disclosure. */
export function lateFeeItemName(policy) {
  return policy?.type === 'percent' ? `Late fee (${policy.value}%)` : 'Late fee';
}

/**
 * The balance the document would show after one application of the policy
 * lands as a line item. Not simply balance + fee: a whole-document percent
 * discount prorates across every line including the new fee, so the true
 * delta can be smaller than the fee itself — anything quoting the post-fee
 * balance must quote this number, not its own arithmetic.
 */
export function balanceWithLateFee(doc, fee, name = 'Late fee') {
  return docTotals({
    ...doc,
    items: [...(doc?.items || []), { name, qty: 1, rate: fee, taxes: [] }],
  }).balance;
}
