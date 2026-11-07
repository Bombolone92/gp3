/**
 * The punch card: buy ten, get the eleventh.
 *
 * It is the cheapest retention tool a small shop has, and it is normally run
 * on cardboard - which the shop pays for, the customer loses, and nobody can
 * count. The pieces were already here: a customer directory, receipts that
 * know their customer, and per-customer history.
 *
 * Progress is *derived from those receipts*, never accrued in a ledger of its
 * own. That means there is nothing to drift out of step, and a refunded sale
 * takes its stamps back with it by simple arithmetic - a refund line carries a
 * negative quantity and a negative total, so it subtracts itself.
 *
 * Redemptions are read from receipts too: a sale that cashed a card in carries
 * `reward`, written by the store from its own cart math. So the two halves of
 * the sum come from the same immutable place.
 *
 * Two shapes cover nearly every small shop:
 *   stamps - buy N of a chosen product or category, the next one is free
 *   spend  - earn a percentage of each sale back, spendable past a threshold
 */

import { toCents, fromCents } from './totals.js';
import { round2, clamp } from './util.js';

export const LOYALTY_TYPES = ['stamps', 'spend'];

/** Bounds that keep a scheme describable in one sentence. */
const MAX_STAMPS = 50;
const MAX_PERCENT = 50;

/**
 * The scheme a shop has configured, normalized - or null when loyalty is off
 * or the settings don't describe a usable one (a stamps card with nothing
 * chosen to stamp, say). Every consumer can then simply check for null.
 *
 * `catalog` is optional and only checked for a stamps card: pass the store
 * and a card stamped by a product or category the catalog no longer holds
 * reads as not running, which is the truth about it. Nothing in a cart can
 * match a product that isn't there, so such a card can neither earn another
 * stamp nor spend the ones it has - and Settings went on describing it as a
 * working scheme. The stored setting is left alone, so an undone delete or a
 * restored backup brings the card straight back.
 */
export function loyaltyScheme(settings, catalog = null) {
  const raw = settings?.loyalty;
  if (!raw || !raw.enabled) return null;
  const type = LOYALTY_TYPES.includes(raw.type) ? raw.type : 'stamps';
  const rewardName = String(raw.rewardName || '').trim().slice(0, 40);

  if (type === 'stamps') {
    const scope = raw.categoryId ? 'category' : raw.productId ? 'product' : null;
    if (!scope) return null;
    if (catalog && !(scope === 'product'
      ? catalog.product?.(raw.productId)
      : catalog.category?.(raw.categoryId))) return null;
    const target = clamp(Math.round(Number(raw.stamps) || 0), 2, MAX_STAMPS);
    if (!target) return null;
    return {
      type,
      scope,
      productId: scope === 'product' ? raw.productId : null,
      categoryId: scope === 'category' ? raw.categoryId : null,
      target,
      rewardName: rewardName || 'a free one',
    };
  }

  const percent = clamp(round2(Number(raw.percent) || 0), 0.5, MAX_PERCENT);
  if (!percent) return null;
  return {
    type,
    percent,
    // Below this the reward is pennies and offering it is noise.
    threshold: Math.max(0, round2(Number(raw.threshold) || 0)),
    rewardName: rewardName || 'money off',
  };
}

/** How far back progress is counted. Stated in Settings, so it can't surprise. */
export const LOYALTY_MONTHS = 12;

/**
 * Whether a sold line earns stamps under this scheme.
 *
 * A line given away earns nothing - you don't get a stamp for the free
 * coffee - which is also what makes the arithmetic below closed: a redemption
 * removes its stamps and the free line adds none back.
 */
export function lineEarns(line, scheme, catalog) {
  if (!scheme || scheme.type !== 'stamps' || !line?.productId) return false;
  if (!line.total) return false;
  if (scheme.scope === 'product') return line.productId === scheme.productId;
  const product = catalog?.product?.(line.productId);
  return !!product && product.categoryId === scheme.categoryId;
}

/**
 * Progress for one customer, from their receipts.
 *
 * `sales` is that customer's history (voided sales are skipped here, refunds
 * are not - they net themselves out). Returns everything a chip, a receipt
 * line, and a customer page need:
 *
 *   { type, earned, target, ready, redeemed, redeemedValue, remaining }
 *
 * `earned` is stamps for a stamps card and money for a spend scheme; `ready`
 * says a reward can be taken now.
 */
export function loyaltyProgress(sales, scheme, catalog) {
  if (!scheme) return null;
  let redeemed = 0;
  let redeemedCents = 0;
  for (const sale of sales || []) {
    if (sale?.voidedAt || !sale.reward) continue;
    redeemed++;
    redeemedCents += toCents(sale.reward.value);
  }

  if (scheme.type === 'stamps') {
    let units = 0;
    for (const sale of sales || []) {
      if (sale?.voidedAt) continue;
      for (const line of sale.lines || []) {
        if (lineEarns(line, scheme, catalog)) units += Number(line.qty) || 0;
      }
    }
    // Cards already cashed in are spent stamps; what is left is the card in
    // the customer's hand right now.
    const earned = Math.max(0, Math.round((units - redeemed * scheme.target) * 1000) / 1000);
    const onCard = earned % scheme.target;
    return {
      type: 'stamps',
      earned,
      onCard,
      target: scheme.target,
      ready: earned >= scheme.target,
      remaining: Math.max(0, scheme.target - onCard),
      redeemed,
      redeemedValue: fromCents(redeemedCents),
      rewardName: scheme.rewardName,
    };
  }

  let netCents = 0;
  for (const sale of sales || []) {
    if (sale?.voidedAt) continue;
    // Net of tax: a shop gives back a share of its own takings, not the
    // state's. Refund lines are negative, so a return takes its share back.
    for (const line of sale.lines || []) {
      netCents += toCents(line.total) - toCents(line.tax);
    }
  }
  const accruedCents = Math.max(0, Math.round(netCents * scheme.percent / 100) - redeemedCents);
  return {
    type: 'spend',
    earned: fromCents(accruedCents),
    target: scheme.threshold,
    ready: accruedCents > 0 && accruedCents >= toCents(scheme.threshold),
    remaining: Math.max(0, fromCents(toCents(scheme.threshold) - accruedCents)),
    percent: scheme.percent,
    redeemed,
    redeemedValue: fromCents(redeemedCents),
    rewardName: scheme.rewardName,
  };
}

/**
 * '7 of 10 toward a free coffee' - the one line a chip, a receipt, and a
 * customer page all say. `money` formats in the receipt's own currency.
 */
export function progressText(progress, money = (n) => String(n)) {
  if (!progress) return '';
  if (progress.type === 'stamps') {
    // The shop names its own reward, and most of them name it with the
    // article already in it ("a free coffee"). Prefixing another one made
    // "A a free coffee is ready", so the name simply opens the sentence.
    if (progress.ready) return `${sentence(progress.rewardName)} is ready`;
    return `${progress.onCard} of ${progress.target} toward ${progress.rewardName}`;
  }
  // The money *is* the reward here, so naming it again would only repeat.
  if (progress.ready) return `${money(progress.earned)} ready to spend`;
  return `${money(progress.earned)} earned · ${money(progress.target)} unlocks ${progress.rewardName}`;
}

/** A phrase that has to open a sentence: first code point upper-cased. */
export function sentence(text) {
  const [first, ...rest] = [...String(text || '')];
  return first ? first.toUpperCase() + rest.join('') : '';
}

/**
 * The progress line as it is snapshotted onto a receipt: the figures, not the
 * sentence, so a reprint years later reads in today's words and today's
 * currency formatting - and so nothing depends on how it was phrased.
 */
export function progressSnapshot(progress) {
  if (!progress) return null;
  if (progress.type === 'stamps') {
    return {
      type: 'stamps',
      onCard: progress.onCard,
      target: progress.target,
      ready: progress.ready,
      rewardName: progress.rewardName,
    };
  }
  return {
    type: 'spend',
    earned: progress.earned,
    target: progress.target,
    ready: progress.ready,
    rewardName: progress.rewardName,
  };
}

/**
 * What a reward takes off this cart, and where.
 *
 * Stamps: one unit of the cheapest qualifying line - the shop gives away one
 * of the thing the card is for, and picking the cheapest is the reading a
 * customer can never dispute being short-changed by. (It is also what a paper
 * card does: the eleventh coffee, not the most expensive one in the round.)
 *
 * Spend: the accrued amount, capped at what the sale actually comes to.
 *
 * Returns null when this cart can't take the reward - which is the honest
 * answer for a full card and a basket with nothing the card is for in it.
 */
export function rewardForCart(lines, progress, scheme, catalog) {
  if (!progress?.ready || !scheme) return null;
  if (scheme.type === 'stamps') {
    let best = -1;
    let bestCents = Infinity;
    (lines || []).forEach((line, index) => {
      // The cart's own lines have no `total` yet; qualification here is about
      // the product, not about what has been discounted.
      if (!line.productId) return;
      const matchesScope = scheme.scope === 'product'
        ? line.productId === scheme.productId
        : catalog?.product?.(line.productId)?.categoryId === scheme.categoryId;
      if (!matchesScope) return;
      const cents = toCents(line.unitPrice);
      if (cents <= 0 || cents >= bestCents) return;
      bestCents = cents;
      best = index;
    });
    if (best < 0) return null;
    return {
      kind: 'stamps',
      lineIndex: best,
      // One unit free, as a fixed discount on that line: a line of three
      // keeps two chargeable, which is what "the next one is free" means.
      amount: fromCents(bestCents),
      name: scheme.rewardName,
    };
  }
  if (!(progress.earned > 0)) return null;
  return { kind: 'spend', amount: progress.earned, name: scheme.rewardName };
}
