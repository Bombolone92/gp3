/**
 * Sample dataset for "explore with sample data": three months of business
 * expenses, two reports at different stages, and a card statement with a mix
 * of matched and open lines. Shaped exactly like an export so importAll()
 * installs and wipes it through the normal path.
 */

import { uid } from './util.js';
import { toISO, monthKey } from './dates.js';
import { EXPORT_VERSION, DEFAULT_CATEGORIES } from './store.js';

const MERCHANTS = {
  meals: [['Blue Fern Cafe', 14.6], ['Nori Kitchen', 38.2], ['Corner Deli', 11.9], ['The Grain House', 52.4]],
  travel: [['Skyline Air', 412], ['Northline Rail', 86.5]],
  lodging: [['Harbor View Hotel', 289]],
  transport: [['City Cabs', 23.4], ['Metro Rideshare', 17.8], ['Airport Express', 32]],
  office: [['Paper & Pen Supply', 46.3], ['PrintWorks', 22.5]],
  software: [['Cloudnote Pro', 12], ['Designly', 29]],
  entertainment: [['Riverside Bistro', 148.7]],
  other: [['Postal Service', 9.4]],
};

function pick(list, i) { return list[i % list.length]; }

export function sampleDataset(store, { now = new Date() } = {}) {
  const cur = store.settings.baseCurrency;
  const categories = store.categories.length ? store.categories : DEFAULT_CATEGORIES;
  const catId = (key) => categories.find((c) => c.id === key)?.id || categories[0].id;
  const thisMonth = monthKey(now);
  const lastMonth = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const twoBack = monthKey(new Date(now.getFullYear(), now.getMonth() - 2, 1));

  const reports = [
    {
      id: uid(), title: `Client visit, ${label(twoBack)}`, notes: 'Two-day trip for the kickoff workshop.', status: 'reimbursed',
      submittedAt: ts(twoBack, 26), approvedAt: ts(twoBack, 28), reimbursedAt: ts(lastMonth, 4), createdAt: ts(twoBack, 20), updatedAt: ts(lastMonth, 4),
    },
    {
      id: uid(), title: `${label(lastMonth)} expenses`, notes: '', status: 'submitted',
      submittedAt: ts(thisMonth, 2), approvedAt: null, reimbursedAt: null, createdAt: ts(lastMonth, 30), updatedAt: ts(thisMonth, 2),
    },
    {
      id: uid(), title: `${label(thisMonth)} expenses`, notes: '', status: 'draft',
      submittedAt: null, approvedAt: null, reimbursedAt: null, createdAt: ts(thisMonth, 1), updatedAt: ts(thisMonth, 1),
    },
  ];

  const expenses = { [twoBack]: [], [lastMonth]: [], [thisMonth]: [] };
  const statements = [];
  const batchId = uid();
  let n = 0;

  const add = (key, day, catKey, { reportIdx = null, method = 'Card', reconcile = false, note = '' } = {}) => {
    const [y, m] = key.split('-').map(Number);
    const daysIn = new Date(y, m, 0).getDate();
    const d = Math.min(day, daysIn);
    if (key === thisMonth && d > now.getDate()) return null;
    const [merchant, amount] = pick(MERCHANTS[catKey], n++);
    const date = toISO(new Date(y, m - 1, d));
    const created = new Date(y, m - 1, d, 13).getTime();
    const exp = {
      id: uid(), date, merchant, amount, currency: cur, categoryId: catId(catKey), paymentMethod: method,
      notes: note, items: [], tax: null, receiptPath: null, receiptMime: null, receiptName: null,
      ocr: null, reportId: reportIdx === null ? null : reports[reportIdx].id,
      reconciled: false, reconciledAt: null, statementLineId: null, createdAt: created, updatedAt: created,
    };
    if (reconcile && method === 'Card') {
      const line = {
        id: uid(), batchId, source: 'Company card statement', date: toISO(new Date(y, m - 1, Math.min(d + 1, daysIn))),
        description: `${merchant.toUpperCase()} ${['NYC', 'SFO', 'AUS', 'CHI'][n % 4]}`, amount, currency: cur,
        matchedExpenseId: exp.id, importedAt: ts(thisMonth, 3),
      };
      exp.reconciled = true;
      exp.reconciledAt = line.importedAt;
      exp.statementLineId = line.id;
      statements.push(line);
    }
    expenses[key].push(exp);
    return exp;
  };

  // Two months back: a finished trip, everything reimbursed and reconciled.
  add(twoBack, 8, 'travel', { reportIdx: 0, reconcile: true });
  add(twoBack, 9, 'transport', { reportIdx: 0, reconcile: true });
  add(twoBack, 9, 'lodging', { reportIdx: 0, reconcile: true, note: 'One night, workshop venue rate' });
  add(twoBack, 9, 'meals', { reportIdx: 0, method: 'Cash' });
  add(twoBack, 10, 'entertainment', { reportIdx: 0, reconcile: true, note: 'Dinner with the client team, 4 guests' });
  add(twoBack, 10, 'transport', { reportIdx: 0, reconcile: true });
  add(twoBack, 15, 'software', { reportIdx: 0, reconcile: true });

  // Last month: submitted, partly reconciled.
  add(lastMonth, 2, 'meals', { reportIdx: 1, reconcile: true });
  add(lastMonth, 5, 'office', { reportIdx: 1, reconcile: true });
  add(lastMonth, 11, 'software', { reportIdx: 1, reconcile: true });
  add(lastMonth, 14, 'meals', { reportIdx: 1 });
  add(lastMonth, 19, 'transport', { reportIdx: 1, reconcile: true });
  add(lastMonth, 22, 'meals', { reportIdx: 1, method: 'Cash' });
  add(lastMonth, 27, 'other', { reportIdx: 1 });

  // This month: a draft report plus loose expenses waiting to be filed.
  add(thisMonth, 1, 'software', { reportIdx: 2, reconcile: true });
  add(thisMonth, 3, 'meals', { reportIdx: 2 });
  add(thisMonth, 6, 'office', { reportIdx: 2 });
  add(thisMonth, 9, 'transport');
  add(thisMonth, 12, 'meals');
  add(thisMonth, 16, 'meals', { method: 'Mobile payment' });
  add(thisMonth, 20, 'transport');
  add(thisMonth, 24, 'entertainment', { note: 'Lunch with a prospect' });

  // Open statement lines: one that matches an unreconciled expense exactly,
  // one that is a day off with a slightly different amount, one with no
  // expense at all (a card charge nobody filed yet).
  const loose = expenses[thisMonth].filter((e) => !e.reconciled);
  if (loose[0]) {
    statements.push({ id: uid(), batchId, source: 'Company card statement', date: loose[0].date, description: `${loose[0].merchant.toUpperCase()} POS`, amount: loose[0].amount, currency: cur, matchedExpenseId: null, importedAt: ts(thisMonth, 3) });
  }
  if (loose[1]) {
    const [y, m, d] = loose[1].date.split('-').map(Number);
    statements.push({ id: uid(), batchId, source: 'Company card statement', date: toISO(new Date(y, m - 1, d + 1)), description: `${loose[1].merchant.toUpperCase()} #4471`, amount: loose[1].amount, currency: cur, matchedExpenseId: null, importedAt: ts(thisMonth, 3) });
  }
  statements.push({ id: uid(), batchId, source: 'Company card statement', date: toISO(new Date(now.getFullYear(), now.getMonth(), Math.max(1, now.getDate() - 2))), description: 'PARKING GARAGE 22', amount: 18, currency: cur, matchedExpenseId: null, importedAt: ts(thisMonth, 3) });

  // Month files are newest-first, like the store writes them.
  for (const key of Object.keys(expenses)) expenses[key].sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    app: 'expenses',
    version: EXPORT_VERSION,
    settings: { ...store.settings, sampleData: true, onboarded: true },
    categories,
    reports,
    expenses,
    statements,
  };

  function ts(key, day) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, Math.min(day, 28), 9).getTime();
  }
  function label(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
}

/** One-tap exit from sample mode: everything gone, onboarding reopens. */
export async function wipeSampleData(store) {
  await store.wipeAll({ keepSettings: { sampleData: false, onboarded: false } });
}

/**
 * Draw a plausible receipt for a sample expense so the viewer has something
 * to show. Canvas only; returns null where canvas is unavailable (tests).
 */
export function renderSampleReceipt(expense, categoryName = '') {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 900;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#1c1c1a';
  ctx.textAlign = 'center';
  ctx.font = '600 34px ui-monospace, Menlo, monospace';
  ctx.fillText(expense.merchant.toUpperCase(), 320, 110);
  ctx.font = '22px ui-monospace, Menlo, monospace';
  ctx.fillStyle = '#5a5955';
  ctx.fillText('118 Market Street', 320, 150);
  ctx.fillText(expense.date, 320, 184);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1c1c1a';
  const lines = [[categoryName || 'Purchase', expense.amount * 0.91], ['Tax', expense.amount * 0.09]];
  let y = 280;
  ctx.font = '24px ui-monospace, Menlo, monospace';
  for (const [name, amt] of lines) {
    ctx.fillText(name, 80, y);
    ctx.textAlign = 'right';
    ctx.fillText(amt.toFixed(2), 560, y);
    ctx.textAlign = 'left';
    y += 44;
  }
  ctx.fillRect(80, y, 480, 2);
  y += 52;
  ctx.font = '600 30px ui-monospace, Menlo, monospace';
  ctx.fillText('TOTAL', 80, y);
  ctx.textAlign = 'right';
  ctx.fillText(`${expense.currency} ${expense.amount.toFixed(2)}`, 560, y);
  ctx.textAlign = 'center';
  ctx.font = '20px ui-monospace, Menlo, monospace';
  ctx.fillStyle = '#5a5955';
  ctx.fillText(`${expense.paymentMethod || 'Card'} ending 4471`, 320, y + 70);
  ctx.fillText('Thank you for your visit', 320, y + 130);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}
