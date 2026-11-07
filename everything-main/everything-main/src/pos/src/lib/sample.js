/**
 * Sample dataset for "Explore with sample data": a small café catalog and
 * ninety days of realistic sales, shaped exactly like an export so
 * store.importAll() installs it - and wipes it - through the normal,
 * already-hardened path. Receipts are built through computeCart, so every
 * stored total is exactly what the register would have produced.
 */

import { uid, round2 } from './util.js';
import { computeCart, changeDue } from './totals.js';
import { optionUnitPrice, optionsKey } from './options.js';
import { todayISO, monthKeyOf } from './dates.js';

/** Deterministic PRNG so the dataset is stable and testable. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleDataset(store) {
  const rand = mulberry32(20260804);
  const pick = (list) => list[Math.floor(rand() * list.length)];

  const catIds = { drinks: uid(), food: uid(), beans: uid(), merch: uid() };
  const categories = [
    { id: catIds.drinks, name: 'Drinks' },
    { id: catIds.food, name: 'Food' },
    { id: catIds.beans, name: 'Coffee beans' },
    { id: catIds.merch, name: 'Merch' },
  ];

  const taxIds = { sales: uid(), prepared: uid() };
  const taxes = [
    { id: taxIds.sales, name: 'Sales tax', rate: 7.75 },
    { id: taxIds.prepared, name: 'Prepared food', rate: 9.5 },
  ];

  // Cost sits beside price, as it does on the form: a café's drinks carry a
  // fat margin, its beans and merch a thin one. Chai tea deliberately has
  // none, so the honest "cost known for N% of sales" note has something to
  // say the moment Reports is opened.
  const P = (name, price, cost, categoryId, slot, extra = {}) => ({
    id: uid(), name, price, cost, categoryId, sku: '', taxId: null, slot,
    stock: null, createdAt: Date.now(), options: [], ...extra,
  });

  /* A café menu, so the options feature is visible from the first tap. */
  const group = (name, choices, { required = true, multi = false } = {}) => ({
    id: uid(), name, required, multi,
    choices: choices.map(([cName, delta]) => ({ id: uid(), name: cName, delta })),
  });
  const sizeMilk = () => [
    group('Size', [['Small', -0.4], ['Regular', 0], ['Large', 0.7]]),
    group('Milk', [['Whole', 0], ['Oat', 0.6], ['Almond', 0.6], ['Skim', 0]]),
    group('Extras', [['Extra shot', 0.75], ['Vanilla syrup', 0.5], ['Decaf', 0]], { required: false, multi: true }),
  ];
  const products = [
    P('Espresso', 3.2, 0.45, catIds.drinks, 1, { taxId: taxIds.prepared }),
    P('Americano', 3.8, 0.5, catIds.drinks, 1, { taxId: taxIds.prepared, options: sizeMilk() }),
    P('Latte', 4.6, 0.9, catIds.drinks, 1, { taxId: taxIds.prepared, options: sizeMilk() }),
    P('Cappuccino', 4.4, 0.85, catIds.drinks, 1, { taxId: taxIds.prepared, options: sizeMilk() }),
    P('Flat white', 4.7, 0.9, catIds.drinks, 1, { taxId: taxIds.prepared, options: sizeMilk() }),
    P('Cold brew', 4.9, 1, catIds.drinks, 2, { taxId: taxIds.prepared, options: sizeMilk() }),
    P('Chai tea', 3.4, null, catIds.drinks, 2, { taxId: taxIds.prepared }),
    P('Hot chocolate', 4.2, 0.8, catIds.drinks, 2, { taxId: taxIds.prepared }),
    P('Croissant', 3.6, 1.2, catIds.food, 4, { taxId: taxIds.prepared }),
    P('Blueberry muffin', 3.9, 1.3, catIds.food, 4, { taxId: taxIds.prepared }),
    P('Banana bread', 4.1, 1.35, catIds.food, 4, { taxId: taxIds.prepared }),
    P('Bagel & cream cheese', 5.2, 1.8, catIds.food, 4, { taxId: taxIds.prepared }),
    P('Granola bowl', 6.8, 2.4, catIds.food, 5, { taxId: taxIds.prepared }),
    P('Turkey sandwich', 8.9, 3.6, catIds.food, 5, { taxId: taxIds.prepared }),
    P('Caprese panini', 9.4, 3.8, catIds.food, 5, { taxId: taxIds.prepared }),
    P('Chocolate chip cookie', 2.8, 0.85, catIds.food, 4, { taxId: taxIds.prepared }),
    P('House blend 250g', 14, 8.2, catIds.beans, 7, { stock: 24, sku: 'BEAN-HB' }),
    P('Single origin 250g', 17.5, 10.5, catIds.beans, 7, { stock: 14, sku: 'BEAN-SO' }),
    P('Decaf 250g', 13, 7.9, catIds.beans, 7, { stock: 9, sku: 'BEAN-DC' }),
    P('Ceramic mug', 16, 7.5, catIds.merch, 6, { stock: 12, sku: 'MRCH-MUG' }),
    P('Travel tumbler', 24, 13, catIds.merch, 6, { stock: 6, sku: 'MRCH-TMB' }),
    P('Canvas tote', 18, 9.5, catIds.merch, 6, { stock: 3, sku: 'MRCH-TOTE' }),
  ];

  const discounts = [
    { id: uid(), name: 'Staff', type: 'percent', value: 20 },
    { id: uid(), name: 'Happy hour', type: 'percent', value: 10 },
    { id: uid(), name: 'Loyalty card', type: 'fixed', value: 2 },
  ];

  /* The regulars, so the customer directory has faces from the first tap. */
  const customers = [
    { name: 'Maya Lindqvist', phone: '555-0142', email: 'maya@example.com', note: 'Oat flat white, extra hot' },
    { name: 'Tom Okafor', phone: '555-0177', email: '', note: 'Beans subscription, every other week' },
    { name: 'Priya Raman', phone: '', email: 'priya@example.com', note: '' },
    { name: 'Sam Whitfield', phone: '555-0103', email: '', note: 'Tab on Fridays' },
    { name: 'Elena Duarte', phone: '', email: '', note: 'Book club, big orders on Thursdays' },
  ].map((c) => ({ id: uid(), createdAt: Date.now(), ...c }));

  /* One regular carries a balance, so store credit is visible from the first
     tap - a goodwill gesture, which is exactly how most credit starts. */
  const credit = [{
    id: uid(),
    at: Date.now() - 6 * 24 * 60 * 60 * 1000,
    customerId: customers[0].id,
    type: 'adjusted',
    amount: 8,
    currency: store.settings.currency,
    receiptId: null,
    receiptNumber: null,
    note: 'Goodwill — wrong order',
  }];

  const taxById = new Map(taxes.map((t) => [t.id, t]));
  const taxFor = (product) => {
    if (product.taxId === 'none') return null;
    return taxById.get(product.taxId) || taxById.get(taxIds.sales);
  };

  /**
   * How the sale was settled. Mostly one tender, occasionally split - "twenty
   * in cash, rest on card" - so the payments report and the receipt layout
   * both have something real to show.
   */
  const pickPayments = (total) => {
    const cashTender = (amount) => {
      const step = amount > 20 ? 10 : 5;
      const tendered = rand() < 0.4
        ? Math.round(amount * 100) / 100
        : Math.ceil(amount / step) * step;
      const change = changeDue(amount, tendered);
      return change > 0 ? { method: 'cash', amount, tendered, change } : { method: 'cash', amount, tendered };
    };

    // Splitting a trivial total isn't realistic; keep it to bigger baskets.
    if (total >= 12 && rand() < 0.06) {
      const cash = Math.max(5, Math.floor(total / 2 / 5) * 5);
      const rest = Math.round((total - cash) * 100) / 100;
      if (rest > 0) return [cashTender(cash), { method: 'card', amount: rest }];
    }
    const roll = rand();
    if (roll < 0.55) return [{ method: 'card', amount: total }];
    if (roll < 0.95) return [cashTender(total)];
    return [{ method: 'other', amount: total }];
  };

  /** What a customer asked for: required groups always, optional ones rarely. */
  const pickOptions = (product) => {
    const out = [];
    for (const g of product.options || []) {
      if (g.required) {
        const choice = pick(g.choices);
        out.push({ group: g.name, name: choice.name, delta: choice.delta });
      } else if (g.multi) {
        for (const choice of g.choices) {
          if (rand() < 0.08) out.push({ group: g.name, name: choice.name, delta: choice.delta });
        }
      }
    }
    return out;
  };

  /* ---- Ninety days of sales, chronological, sequential numbering ---- */
  const cur = store.settings.currency;
  const sales = {};
  let number = 1001;
  const today = new Date();

  for (let back = 89; back >= 0; back--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const iso = todayISO(day);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const count = (weekend ? 6 : 4) + Math.floor(rand() * (weekend ? 6 : 5));
    // Sales up to "now" only on the current day.
    const lastMinute = back === 0
      ? Math.max(8 * 60, today.getHours() * 60 + today.getMinutes())
      : 18 * 60;

    // Times first, sorted, so receipt numbers run chronologically within a day.
    const minutes = Array.from({ length: count },
      () => 7 * 60 + 30 + Math.floor(rand() * (lastMinute - 7 * 60 - 40)))
      .sort((a, b) => a - b);

    for (let s = 0; s < count; s++) {
      const minute = minutes[s];
      const lineCount = 1 + Math.floor(rand() * rand() * 4);
      // Keyed by product *and* option combination: a large oat latte is a
      // different line from a regular one, exactly as at the register.
      const chosen = new Map();
      for (let l = 0; l <= lineCount; l++) {
        // Drinks and food dominate; beans/merch are the occasional add-on.
        const pool = rand() < 0.82 ? products.slice(0, 16) : products.slice(16);
        const p = pick(pool);
        const options = pickOptions(p);
        const key = `${p.id}|${optionsKey(options)}`;
        const row = chosen.get(key) || { product: p, options, qty: 0 };
        row.qty++;
        chosen.set(key, row);
      }
      const lines = [...chosen.values()].map(({ product: p, options, qty }) => {
        const tax = taxFor(p);
        const line = {
          productId: p.id, name: p.name, unitPrice: optionUnitPrice(p.price, options), qty,
          taxRate: tax?.rate || 0, taxName: tax?.name || '', discount: null,
        };
        // Snapshotted at sale time, exactly as completeSale does it. Option
        // deltas move the price, never the cost.
        if (p.cost !== null && p.cost !== undefined) line.unitCost = p.cost;
        if (options.length) line.options = options;
        return line;
      });
      const orderDiscount = rand() < 0.11 ? pick(discounts) : null;
      const cart = computeCart(lines, { orderDiscount, pricesIncludeTax: false });

      const payments = pickPayments(cart.total);

      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(),
        Math.floor(minute / 60), minute % 60).getTime();
      // Regulars are a minority of sales, exactly like a real counter.
      const customer = rand() < 0.16 ? pick(customers) : null;

      const receipt = {
        id: uid(),
        number: number++,
        date: iso,
        at,
        currency: cur,
        pricesIncludeTax: false,
        ...(customer ? { customerId: customer.id, customerName: customer.name } : {}),
        lines: cart.lines.map((l) => {
          const line = {
            productId: l.productId, name: l.name, unitPrice: l.unitPrice, qty: l.qty,
            taxRate: l.taxRate, taxName: l.taxName, discount: l.discount,
            subtotal: l.subtotal, discountAmount: l.discountAmount, tax: l.tax, total: l.total,
          };
          if (l.unitCost !== null && l.unitCost !== undefined) line.unitCost = l.unitCost;
          if (l.options?.length) line.options = l.options;
          return line;
        }),
        orderDiscount: orderDiscount ? { type: orderDiscount.type, value: orderDiscount.value } : null,
        itemCount: cart.itemCount,
        subtotal: cart.subtotal,
        discountTotal: cart.discountTotal,
        taxTotal: cart.taxTotal,
        taxes: cart.taxes,
        total: cart.total,
        payments,
      };
      const key = monthKeyOf(iso);
      (sales[key] ||= []).push(receipt);
    }
  }

  /* ---- Two weeks of drawer days, so day closes have a history to browse ---- */
  const drawers = {};
  const allSales = Object.values(sales).flat();
  for (let back = 14; back >= 1; back--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const iso = todayISO(day);
    const daySales = allSales.filter((r) => r.date === iso);
    if (!daySales.length) continue;

    const cashTaken = round2(daySales.reduce((sum, r) => sum
      + r.payments.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0), 0));
    const float = 120;
    const at = (h, m) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();

    // The odd errand paid out of the till, as any counter has.
    const movements = [];
    if (rand() < 0.3) {
      movements.push({ id: uid(), at: at(11, 20), amount: -round2(6 + rand() * 20), reason: pick(['Milk run', 'Courier', 'Window cleaner', 'Pastry delivery']) });
    }
    if (rand() < 0.12) {
      movements.push({ id: uid(), at: at(15, 5), amount: round2(20 + Math.floor(rand() * 4) * 10), reason: 'Float top-up' });
    }
    const paidIn = round2(movements.filter((m) => m.amount > 0).reduce((a, m) => a + m.amount, 0));
    const paidOut = round2(-movements.filter((m) => m.amount < 0).reduce((a, m) => a + m.amount, 0));
    const expected = round2(float + cashTaken + paidIn - paidOut);
    // Most days balance; some are a coin or two out, as real counts are.
    const drift = rand() < 0.65 ? 0 : round2((rand() - 0.5) * 4);
    const counted = round2(Math.max(0, expected + drift));

    (drawers[monthKeyOf(iso)] ||= []).push({
      date: iso,
      openedAt: at(7, 30),
      float,
      movements,
      close: {
        at: at(19, 10),
        counted,
        expected,
        diff: round2(counted - expected),
        float,
        paidIn,
        paidOut,
        cashSales: cashTaken,
        cashRefunds: 0,
        salesCount: daySales.length,
        refundCount: 0,
        revenue: round2(daySales.reduce((a, r) => a + r.total, 0)),
        tax: round2(daySales.reduce((a, r) => a + r.taxTotal, 0)),
        discounts: round2(daySales.reduce((a, r) => a + r.discountTotal, 0)),
        byMethod: ['cash', 'card', 'other'].map((method) => {
          const tenders = daySales.flatMap((r) => r.payments.filter((p) => p.method === method));
          return { method, amount: round2(tenders.reduce((a, p) => a + p.amount, 0)), count: tenders.length };
        }).filter((m) => m.count),
        currency: cur,
      },
    });
  }
  for (const list of Object.values(drawers)) list.sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    app: 'point-of-sale',
    version: 1,
    drawers,
    settings: {
      ...store.settings,
      storeName: 'Corner Roast Café',
      address: '12 Market Lane',
      receiptFooter: 'Thanks, see you tomorrow',
      defaultTaxId: taxIds.sales,
      pricesIncludeTax: false,
      nextReceipt: number,
      sampleData: true,
      onboarded: true,
    },
    products,
    categories,
    taxes,
    discounts,
    customers,
    credit,
    sales,
  };
}

/** One-tap exit from sample mode: everything gone, defaults back, wizard reopens. */
export async function wipeSampleData(store) {
  // Named so the restore point says what it stood in front of - a wipe over
  // real sales is one of the failures snapshots exist for.
  await store.importAll({
    app: 'point-of-sale',
    version: 1,
    settings: {
      ...store.settings,
      storeName: '',
      address: '',
      receiptFooter: 'Thank you for your purchase',
      defaultTaxId: null,
      nextReceipt: 1001,
      sampleData: false,
      onboarded: false,
    },
    products: [],
    categories: [],
    taxes: [],
    discounts: [],
    customers: [],
    sales: {},
  }, { snapshotReason: 'wipe' });
}
