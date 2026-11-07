/**
 * Statement reconciliation: pair imported card/bank lines with expenses.
 *
 * A candidate needs the same currency, an amount within tolerance, and a
 * date within a few days (card postings lag purchases). Among candidates,
 * closer dates and shared merchant words win. Each expense and each line is
 * used at most once; greedy by score, so the strongest pairs claim first.
 */

import { daysBetween } from './dates.js';
import { tokens } from './util.js';

export const DEFAULT_TOLERANCE = { days: 4, amount: 0.01, amountPct: 0 };

export function scoreMatch(line, expense, tol = DEFAULT_TOLERANCE) {
  if (!line || !expense) return null;
  if ((line.currency || 'USD') !== (expense.currency || 'USD')) return null;
  const diff = Math.abs(Number(line.amount) - Number(expense.amount));
  const allowed = Math.max(tol.amount, Math.abs(Number(expense.amount)) * (tol.amountPct || 0));
  if (diff > allowed + 1e-9) return null;
  const days = daysBetween(expense.date, line.date);
  if (!Number.isFinite(days)) return null;
  // Postings usually land on or after the purchase; allow a day of slack before.
  if (days < -1 || days > tol.days) return null;

  const reasons = [];
  let score = 50;
  if (diff < 0.005) { score += 30; reasons.push('Exact amount'); } else { score += 15; reasons.push('Amount within tolerance'); }
  const dayScore = Math.max(0, 15 - Math.abs(days) * 4);
  score += dayScore;
  reasons.push(days === 0 ? 'Same day' : `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} apart`);

  const lt = new Set(tokens(line.description));
  const et = tokens(expense.merchant);
  const shared = et.filter((t) => lt.has(t) || [...lt].some((l) => l.length > 3 && (l.startsWith(t) || t.startsWith(l))));
  if (et.length && shared.length) {
    score += Math.min(20, 10 + shared.length * 5);
    reasons.push('Merchant matches');
  }
  return { score: Math.min(100, Math.round(score)), reasons, days, diff };
}

/**
 * Suggest pairs for unmatched lines against unreconciled expenses.
 * Returns [{ lineId, expenseId, score, reasons }] sorted by score, each id
 * appearing at most once.
 */
export function suggestMatches(lines, expenses, tol = DEFAULT_TOLERANCE) {
  const candidates = [];
  const openLines = lines.filter((l) => !l.matchedExpenseId);
  const openExpenses = expenses.filter((e) => !e.reconciled);
  for (const line of openLines) {
    for (const exp of openExpenses) {
      const s = scoreMatch(line, exp, tol);
      if (s) candidates.push({ lineId: line.id, expenseId: exp.id, ...s });
    }
  }
  candidates.sort((a, b) => b.score - a.score || Math.abs(a.days) - Math.abs(b.days));
  const usedLines = new Set();
  const usedExpenses = new Set();
  const out = [];
  for (const c of candidates) {
    if (usedLines.has(c.lineId) || usedExpenses.has(c.expenseId)) continue;
    usedLines.add(c.lineId);
    usedExpenses.add(c.expenseId);
    out.push(c);
  }
  return out;
}

/** Counts for the reconciliation header. */
export function reconcileSummary(lines, expenses) {
  const matched = lines.filter((l) => l.matchedExpenseId).length;
  const unmatchedLines = lines.length - matched;
  const unreconciled = expenses.filter((e) => !e.reconciled).length;
  return { total: lines.length, matched, unmatchedLines, unreconciled };
}

/** Lines already in the store that look identical to an incoming one. */
export function isDuplicateLine(line, existing) {
  return existing.some((l) => l.date === line.date && Math.abs(l.amount - line.amount) < 0.005
    && (l.currency || 'USD') === (line.currency || 'USD') && tokens(l.description).join(' ') === tokens(line.description).join(' '));
}
