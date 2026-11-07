/**
 * Cost and profit.
 *
 * A product may carry a `cost` - what the shop pays for it. At the moment of
 * sale that figure is snapshotted onto the receipt line as `unitCost`, exactly
 * as the name, the price, and the tax rate already are, so a supplier's price
 * rise in June can never rewrite what March earned.
 *
 * Profit is measured against revenue *net of tax*: tax is the state's money,
 * never margin. That figure is `line.total - line.tax` in both price modes -
 * with tax added on top, `total` is taxable + tax; with tax inside the price,
 * `total` is the taxable amount and the tax sits within it.
 *
 * Cost is optional everywhere. A line with no cost recorded is "unknown", not
 * zero: it is counted apart so a partially costed catalog reports an honest
 * "cost known for 82% of sales" instead of a quietly overstated margin.
 * Refund lines carry negative quantities and amounts, so returns net
 * themselves out of both revenue and cost by simple addition.
 */

import { toCents, fromCents } from './totals.js';
import { round2 } from './util.js';

/** True when this line recorded what it cost. Zero is a cost; missing is not. */
export function hasLineCost(line) {
  const c = line?.unitCost;
  return c !== null && c !== undefined && Number.isFinite(Number(c));
}

/** A line's revenue with tax taken out - the base every margin is read against. */
export function lineNetCents(line) {
  return toCents(Number(line?.total) || 0) - toCents(Number(line?.tax) || 0);
}

/** What this line's goods cost, in cents, or null when that isn't recorded. */
export function lineCostCents(line) {
  if (!hasLineCost(line)) return null;
  // Rounded once, like computeCart's baseCents, so a measured line
  // (0.735 kg at $6.40/kg) lands on exact cents.
  return Math.round(toCents(line.unitCost) * (Number(line.qty) || 0));
}

/** A line's cost in dollars, or null when unknown. */
export function lineCost(line) {
  const cents = lineCostCents(line);
  return cents === null ? null : fromCents(cents);
}

/** A line's gross profit, or null when its cost was never recorded. */
export function lineProfit(line) {
  const cost = lineCostCents(line);
  return cost === null ? null : fromCents(lineNetCents(line) - cost);
}

/**
 * Gross profit for a set of receipts (voided ones excluded, refunds netted).
 *
 * `profit` and `margin` describe only the lines whose cost is known -
 * `coverage` says how much of the trade that is (by money, ignoring sign, so a
 * refund-heavy period can't distort the fraction). A shop that keeps no costs
 * gets `known: 0` and every consumer can simply say nothing.
 */
export function profitSummary(sales) {
  let netCents = 0;
  let knownNetCents = 0;
  let costCents = 0;
  let coveredAbs = 0;
  let totalAbs = 0;
  let knownLines = 0;
  let unknownLines = 0;

  for (const sale of sales || []) {
    if (sale?.voidedAt) continue;
    for (const line of sale.lines || []) {
      const net = lineNetCents(line);
      netCents += net;
      totalAbs += Math.abs(net);
      const cost = lineCostCents(line);
      if (cost === null) {
        unknownLines++;
        continue;
      }
      knownLines++;
      knownNetCents += net;
      costCents += cost;
      coveredAbs += Math.abs(net);
    }
  }

  const profitCents = knownNetCents - costCents;
  return {
    /** Revenue net of tax across every line, costed or not. */
    net: fromCents(netCents),
    /** Revenue net of tax on the lines that know their cost. */
    knownNet: fromCents(knownNetCents),
    cost: fromCents(costCents),
    profit: fromCents(profitCents),
    margin: knownNetCents !== 0 ? round2((profitCents / knownNetCents) * 100) : null,
    /** 0..1 of trade (by money) whose cost is recorded; 1 when all of it is. */
    coverage: totalAbs > 0 ? coveredAbs / totalAbs : 0,
    known: knownLines,
    unknown: unknownLines,
    /** True when at least one line carried a cost - nothing to show otherwise. */
    any: knownLines > 0,
  };
}

/** Margin percent of a price/cost pair, or null when either is missing. */
export function marginPercent(price, cost) {
  const p = toCents(price);
  if (!Number.isFinite(Number(cost)) || cost === null || cost === undefined || p <= 0) return null;
  return round2(((p - toCents(cost)) / p) * 100);
}

/**
 * What the tracked shelf is worth at cost - the figure an accountant asks for
 * at year end. Products with no cost, or no tracked count, are reported apart
 * rather than valued at zero.
 */
export function stockAtCost(products) {
  let cents = 0;
  let counted = 0;
  let unknown = 0;
  for (const p of products || []) {
    if (p?.stock === null || p?.stock === undefined) continue;
    if (!Number.isFinite(Number(p.cost)) || p.cost === null || p.cost === undefined) {
      unknown++;
      continue;
    }
    counted++;
    // Negative stock (an oversell) subtracts, which is what the shelf owes.
    cents += Math.round(toCents(p.cost) * (Number(p.stock) || 0));
  }
  return { value: fromCents(cents), counted, unknown };
}
