/**
 * The cash drawer: opening float, cash in and out during the day, and the
 * end-of-day close that answers the only question a shopkeeper asks at
 * closing time - does the cash in the drawer match what should be there?
 *
 *   opening float
 * + cash taken       (the cash portion of every sale, splits included)
 * + cash tips        (kept in the drawer; moved to a jar = a paid-out entry)
 * − cash refunded    (the cash portion of every refund)
 * + paid in          (a float top-up, a till transfer)
 * − paid out         (the courier, milk for the machine)
 * = expected cash
 *
 * counted − expected = over / short.
 *
 * A movement's amount carries its direction: positive is money into the
 * drawer, negative is money out. Mistakes are corrected with an offsetting
 * entry rather than by editing history.
 */

import { round2 } from './util.js';
import { receiptPayments } from './payments.js';
import { isRefund } from './refunds.js';

/** Paid-in and paid-out magnitudes of a day's movements. */
export function movementTotals(movements) {
  let paidIn = 0;
  let paidOut = 0;
  for (const m of movements || []) {
    const amount = Number(m?.amount) || 0;
    if (amount > 0) paidIn += amount;
    else paidOut -= amount;
  }
  return { paidIn: round2(paidIn), paidOut: round2(paidOut) };
}

/**
 * Everything a Z-report needs for one day.
 *
 * `day` is the stored drawer record (or null if the day was never opened) and
 * `sales` is that day's receipts - the same list Reports works from, so the
 * two can never disagree.
 */
export function daySummary({ date, day = null, sales = [] }) {
  const live = sales.filter((s) => !s.voidedAt);
  const sold = live.filter((s) => !isRefund(s));
  const refunds = live.filter((s) => isRefund(s));

  const byMethod = new Map();
  const tipsByMethod = new Map();
  let cashSales = 0;
  let cashRefunds = 0;
  let cashTips = 0;
  let tipTotal = 0;
  for (const receipt of live) {
    for (const tender of receiptPayments(receipt)) {
      const row = byMethod.get(tender.method) || { method: tender.method, amount: 0, count: 0 };
      row.amount = round2(row.amount + (Number(tender.amount) || 0));
      row.count++;
      byMethod.set(tender.method, row);
      // Tips ride on the tender but are not takings: counted apart, so the
      // terminal batch (amount + tip) and revenue both still reconcile.
      const tip = Math.max(0, Number(tender.tip) || 0);
      if (tip > 0) {
        const tipRow = tipsByMethod.get(tender.method) || { method: tender.method, amount: 0, count: 0 };
        tipRow.amount = round2(tipRow.amount + tip);
        tipRow.count++;
        tipsByMethod.set(tender.method, tipRow);
        tipTotal = round2(tipTotal + tip);
        // A cash tip kept in the drawer raises expected cash; one moved to
        // the jar is recorded as a paid-out movement, like any cash leaving.
        if (tender.method === 'cash') cashTips = round2(cashTips + tip);
      }
      if (tender.method !== 'cash') continue;
      // A refund's tender amount is negative; its magnitude left the drawer.
      if (isRefund(receipt)) cashRefunds = round2(cashRefunds - (Number(tender.amount) || 0));
      else cashSales = round2(cashSales + (Number(tender.amount) || 0));
    }
  }

  const movements = day?.movements || [];
  const { paidIn, paidOut } = movementTotals(movements);
  const float = round2(Number(day?.float) || 0);

  return {
    date,
    opened: !!day,
    openedAt: day?.openedAt ?? null,
    closed: !!day?.close,
    close: day?.close ?? null,
    float,
    movements,
    paidIn,
    paidOut,
    cashSales,
    cashRefunds,
    cashTips,
    tipTotal,
    tips: [...tipsByMethod.values()],
    expected: round2(float + cashSales + cashTips - cashRefunds + paidIn - paidOut),
    salesCount: sold.length,
    refundCount: refunds.length,
    revenue: round2(live.reduce((a, s) => a + s.total, 0)),
    tax: round2(live.reduce((a, s) => a + s.taxTotal, 0)),
    discounts: round2(live.reduce((a, s) => a + s.discountTotal, 0)),
    byMethod: [...byMethod.values()],
  };
}

/** 'Over $2.00' / 'Short $1.35' / 'Balanced' - how a close came out. */
export function overShortLabel(diff, money) {
  const d = round2(Number(diff) || 0);
  if (!d) return 'Balanced';
  return d > 0 ? `Over ${money(d)}` : `Short ${money(-d)}`;
}
