import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installMockPuter } from './helpers/mock-puter.js';
import { Store, cleanQuickNotes, MAX_NOTE } from '../src/lib/store.js';
import { receiptDoc } from '../src/lib/receipt-doc.js';
import { lineItemsCsv } from '../src/lib/csv.js';
import { receiptMatches } from '../src/lib/receipt-search.js';
import { refundPlan, fullRefundPicks } from '../src/lib/refunds.js';

let mock;
let store;

beforeEach(async () => {
  mock = installMockPuter();
  store = new Store();
  await store.init();
});

afterEach(() => mock.uninstall());

const line = (over = {}) => ({
  productId: null, name: 'Flat white', unitPrice: 4.7, qty: 1,
  taxRate: 0, taxName: '', discount: null, ...over,
});

describe('a note on a line', () => {
  it('is snapshotted onto the receipt', async () => {
    const receipt = await store.completeSale({
      lines: [line({ note: '  decaf, extra hot  ' }), line({ name: 'Muffin' })],
      payment: { method: 'card' },
    });
    expect(receipt.lines[0].note).toBe('decaf, extra hot');
    expect('note' in receipt.lines[1]).toBe(false);
  });

  it('is capped rather than carried at any length', async () => {
    const receipt = await store.completeSale({
      lines: [line({ note: 'x'.repeat(500) })],
      payment: { method: 'card' },
    });
    expect(receipt.lines[0].note).toHaveLength(MAX_NOTE);
  });

  it('prints under its item, on the slip and the shared copy alike', async () => {
    const receipt = await store.completeSale({
      lines: [line({ note: 'no ice' })],
      payment: { method: 'card' },
    });
    const doc = receiptDoc(receipt, store.settings);
    expect(doc.items[0].subs.map((s) => s.kind)).toContain('note');
    expect(doc.items[0].subs.find((s) => s.kind === 'note').text).toBe('no ice');
  });

  it('comes back with the goods on a refund', async () => {
    const receipt = await store.completeSale({
      lines: [line({ note: 'decaf' })],
      payment: { method: 'card' },
    });
    const plan = refundPlan(receipt, fullRefundPicks(receipt));
    expect(plan.lines[0].note).toBe('decaf');
  });

  it('is a column in the line-items CSV', async () => {
    const receipt = await store.completeSale({
      lines: [line({ note: 'gift wrap' })],
      payment: { method: 'card' },
    });
    const csv = lineItemsCsv([receipt], store);
    const [head, row] = csv.trim().split('\r\n');
    const at = head.split(',').indexOf('Note');
    expect(at).toBeGreaterThan(-1);
    expect(row.split(',')[at]).toBe('gift wrap');
  });
});

describe('a note on a sale', () => {
  it('is stored, printed, and findable', async () => {
    const receipt = await store.completeSale({
      lines: [line()],
      note: '  for Sam  ',
      payment: { method: 'cash', tendered: 5 },
    });
    expect(receipt.note).toBe('for Sam');
    expect(receiptDoc(receipt, store.settings).note).toBe('for Sam');
    expect(receiptMatches(receipt, { text: 'sam' })).toBe(true);
  });

  it('finds a receipt by a note on one of its lines', async () => {
    const receipt = await store.completeSale({
      lines: [line(), line({ name: 'Muffin', note: 'warmed up' })],
      payment: { method: 'card' },
    });
    expect(receiptMatches(receipt, { text: 'warmed' })).toBe(true);
    expect(receiptMatches(receipt, { text: 'toasted' })).toBe(false);
  });
});

describe('cleanQuickNotes', () => {
  it('trims, dedupes case-insensitively, and caps the row', () => {
    expect(cleanQuickNotes([' to go ', 'To Go', '', null, 'no ice']))
      .toEqual(['to go', 'no ice']);
    expect(cleanQuickNotes(Array.from({ length: 20 }, (_, i) => `n${i}`))).toHaveLength(12);
    expect(cleanQuickNotes('nonsense')).toEqual([]);
    expect(cleanQuickNotes([{ toString: () => 'x'.repeat(99) }])[0]).toHaveLength(32);
  });

  it('is cleaned on the way in from a backup', async () => {
    await store.updateSettings({ quickNotes: ['to go'] });
    const data = await store.exportAll();
    data.settings.quickNotes = ['  gift  ', 'GIFT', ''];
    const fresh = new Store();
    await fresh.init();
    await fresh.importAll(data);
    expect(fresh.settings.quickNotes).toEqual(['gift']);
  });
});
