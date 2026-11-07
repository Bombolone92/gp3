import { describe, it, expect, beforeEach } from 'vitest';
import { Store, KV_KEYS, monthPath, STATEMENTS_PATH, REPORTS_PATH, RECEIPTS_DIR } from '../src/lib/store.js';
import { fakePuter, readJsonFile } from './helpers/fake-puter.js';

let sdk;
let store;

beforeEach(async () => {
  sdk = fakePuter();
  store = new Store(() => sdk);
  await store.init();
});

describe('init', () => {
  it('starts with defaults on an empty account', () => {
    expect(store.settings.baseCurrency).toBe('USD');
    expect(store.categories.length).toBeGreaterThan(3);
    expect(store.months).toEqual([]);
    expect(store.reports).toEqual([]);
    expect(store.user.username).toBe('tester');
  });
  it('reads stringified KV values written by older clients', async () => {
    sdk._kv.set(KV_KEYS.settings, JSON.stringify({ baseCurrency: 'EUR' }));
    const s2 = new Store(() => sdk);
    await s2.init();
    expect(s2.settings.baseCurrency).toBe('EUR');
  });
});

describe('expenses', () => {
  it('writes one file per month and keeps the month index in KV', async () => {
    const a = await store.addExpense({ merchant: 'Cafe', amount: '14.6', date: '2026-08-20' });
    const b = await store.addExpense({ merchant: 'Rail', amount: 86.5, date: '2026-07-02' });
    expect(a.amount).toBe(14.6);
    expect(store.months).toEqual(['2026-08', '2026-07']);
    expect(sdk._kv.get(KV_KEYS.months)).toEqual(['2026-08', '2026-07']);
    expect((await readJsonFile(sdk, monthPath('2026-08')))[0].id).toBe(a.id);
    expect((await readJsonFile(sdk, monthPath('2026-07')))[0].id).toBe(b.id);
  });
  it('never puts expenses in KV', async () => {
    await store.addExpense({ merchant: 'Cafe', amount: 1, date: '2026-08-20' });
    const kvKeys = sdk._calls.filter((c) => c.name === 'kv.set').map((c) => c.args[0]);
    expect(kvKeys.every((k) => Object.values(KV_KEYS).includes(k))).toBe(true);
    expect(kvKeys).not.toContain(expect.stringContaining('exp-2026'));
  });
  it('moves an expense between month files when its date changes', async () => {
    const a = await store.addExpense({ merchant: 'Cafe', amount: 1, date: '2026-08-20' });
    await store.updateExpense(a.id, { date: '2026-09-01' });
    expect(await readJsonFile(sdk, monthPath('2026-08'))).toEqual([]);
    expect((await readJsonFile(sdk, monthPath('2026-09')))[0]).toMatchObject({ id: a.id, date: '2026-09-01' });
    expect(store.months).toEqual(['2026-09', '2026-08']);
  });
  it('lists everything newest first and finds by id', async () => {
    await store.addExpense({ merchant: 'Old', amount: 1, date: '2026-06-01' });
    const n = await store.addExpense({ merchant: 'New', amount: 1, date: '2026-08-01' });
    const all = await store.loadAll();
    expect(all.map((e) => e.merchant)).toEqual(['New', 'Old']);
    expect(store.getExpense(n.id).merchant).toBe('New');
  });
  it('deletes the expense, its receipt file, and its statement match', async () => {
    const e = await store.addExpense({ merchant: 'Cafe', amount: 5, date: '2026-08-20' });
    const meta = await store.saveReceipt(e.id, new File(['img'], 'r.png', { type: 'image/png' }));
    await store.updateExpense(e.id, meta);
    const { added } = await store.addStatementLines([{ date: '2026-08-21', description: 'CAFE', amount: 5, currency: 'USD' }]);
    await store.matchLine(added[0].id, e.id);
    expect(sdk._files.has(meta.receiptPath)).toBe(true);
    await store.deleteExpense(e.id);
    expect(await store.loadAll()).toEqual([]);
    expect(sdk._files.has(meta.receiptPath)).toBe(false);
    expect((await store.loadStatements())[0].matchedExpenseId).toBeNull();
  });
});

describe('receipts', () => {
  it('stores the file under the receipts folder, keyed by expense id', async () => {
    const file = new File(['data'], 'photo.JPG', { type: 'image/jpeg' });
    const meta = await store.saveReceipt('abc', file);
    expect(meta.receiptPath).toBe(`${RECEIPTS_DIR}/abc.jpg`);
    expect(meta.receiptMime).toBe('image/jpeg');
    const write = sdk._calls.find((c) => c.name === 'fs.write' && c.args[0] === meta.receiptPath);
    expect(write.args[1]).toMatchObject({ createMissingParents: true });
    expect(await (await store.readReceipt(meta.receiptPath)).text()).toBe('data');
  });
});

describe('reports', () => {
  it('lives in a file, not KV, and moves through its lifecycle', async () => {
    const r = await store.createReport({ title: 'Trip' });
    expect(sdk._files.has(REPORTS_PATH)).toBe(true);
    expect([...sdk._kv.keys()]).not.toContain(expect.stringContaining('report'));
    await store.transitionReport(r.id, 'submitted');
    expect(store.report(r.id).status).toBe('submitted');
    await expect(store.transitionReport(r.id, 'reimbursed')).rejects.toThrow();
    await store.transitionReport(r.id, 'approved');
    await store.transitionReport(r.id, 'reimbursed');
    expect(store.report(r.id).reimbursedAt).toBeTruthy();
  });
  it('assigns expenses with one write per month and unassigns on delete', async () => {
    const a = await store.addExpense({ merchant: 'A', amount: 1, date: '2026-08-01' });
    const b = await store.addExpense({ merchant: 'B', amount: 1, date: '2026-08-02' });
    const c = await store.addExpense({ merchant: 'C', amount: 1, date: '2026-07-02' });
    const r = await store.createReport({ title: 'R' });
    const before = sdk._calls.filter((x) => x.name === 'fs.write').length;
    await store.setReport([a.id, b.id, c.id], r.id);
    const writes = sdk._calls.filter((x) => x.name === 'fs.write').length - before;
    expect(writes).toBe(2);
    expect(store.getExpense(a.id).reportId).toBe(r.id);
    await store.deleteReport(r.id);
    expect(store.reports).toEqual([]);
    expect(store.getExpense(a.id).reportId).toBeNull();
    expect(store.getExpense(c.id).reportId).toBeNull();
  });
});

describe('statements', () => {
  it('imports lines into a batch and matches them to expenses both ways', async () => {
    const e = await store.addExpense({ merchant: 'Cafe', amount: 14.6, date: '2026-08-20' });
    const { added, batchId } = await store.addStatementLines([{ date: '2026-08-21', description: 'CAFE', amount: 14.6 }, { date: '2026-08-22', description: 'OTHER', amount: 3 }], { source: 'Card' });
    expect(added).toHaveLength(2);
    expect(added[0].currency).toBe('USD');
    expect(sdk._files.has(STATEMENTS_PATH)).toBe(true);
    await store.matchLine(added[0].id, e.id);
    expect(store.getExpense(e.id)).toMatchObject({ reconciled: true, statementLineId: added[0].id });
    expect(store.statementLine(added[0].id).matchedExpenseId).toBe(e.id);
    await store.unmatchLine(added[0].id);
    expect(store.getExpense(e.id).reconciled).toBe(false);
    await store.matchLine(added[0].id, e.id);
    await store.deleteStatementBatch(batchId);
    expect(await store.loadStatements()).toEqual([]);
    expect(store.getExpense(e.id).reconciled).toBe(false);
  });
  it('re-matching a line to another expense frees the first', async () => {
    const a = await store.addExpense({ merchant: 'A', amount: 5, date: '2026-08-20' });
    const b = await store.addExpense({ merchant: 'B', amount: 5, date: '2026-08-20' });
    const { added } = await store.addStatementLines([{ date: '2026-08-20', description: 'X', amount: 5 }]);
    await store.matchLine(added[0].id, a.id);
    await store.matchLine(added[0].id, b.id);
    expect(store.getExpense(a.id).reconciled).toBe(false);
    expect(store.getExpense(b.id).reconciled).toBe(true);
  });
});

describe('export / import', () => {
  it('round-trips and removes month files that are not in the import', async () => {
    await store.addExpense({ merchant: 'A', amount: 1, date: '2026-08-01' });
    await store.addExpense({ merchant: 'Stale', amount: 1, date: '2026-05-01' });
    await store.createReport({ title: 'R' });
    const data = await store.exportAll();
    expect(data.app).toBe('expenses');
    delete data.expenses['2026-05'];
    await store.importAll(data);
    expect(store.months).toEqual(['2026-08']);
    expect(sdk._files.has(monthPath('2026-05'))).toBe(false);
    expect(store.reports).toHaveLength(1);
  });
  it('refuses foreign files', async () => {
    await expect(store.importAll({ app: 'other' })).rejects.toThrow(/not an expenses export/i);
  });
  it('wipeAll clears data and the receipts folder but keeps theme and currency', async () => {
    await store.updateSettings({ baseCurrency: 'EUR', theme: 'dark' });
    await store.addExpense({ merchant: 'A', amount: 1, date: '2026-08-01' });
    sdk._files.set(`${RECEIPTS_DIR}/x.png`, 'img');
    await store.wipeAll();
    expect(await store.loadAll()).toEqual([]);
    expect(sdk._files.has(`${RECEIPTS_DIR}/x.png`)).toBe(false);
    expect(store.settings).toMatchObject({ baseCurrency: 'EUR', theme: 'dark', sampleData: false });
  });
});

describe('write serialisation', () => {
  it('keeps rapid edits to the same month from clobbering each other', async () => {
    const a = await store.addExpense({ merchant: 'A', amount: 1, date: '2026-08-01' });
    const b = await store.addExpense({ merchant: 'B', amount: 1, date: '2026-08-02' });
    await Promise.all([store.updateExpense(a.id, { merchant: 'A2' }), store.updateExpense(b.id, { merchant: 'B2' })]);
    const list = await readJsonFile(sdk, monthPath('2026-08'));
    expect(list.map((e) => e.merchant).sort()).toEqual(['A2', 'B2']);
  });
});

describe('loading races', () => {
  it('a slow initial read never overwrites data imported while it was pending', async () => {
    const slow = fakePuter({ readDelay: 30 });
    const s = new Store(() => slow);
    await s.init();
    // Views start loading on an empty account; the user picks sample data before the reads return.
    const pending = Promise.all([s.loadStatements(), s.loadMonth('2026-08')]);
    await s.importAll({
      app: 'expenses', version: 1, settings: {}, categories: [], reports: [],
      expenses: { '2026-08': [{ id: 'x', date: '2026-08-01', merchant: 'A', amount: 1, currency: 'USD' }] },
      statements: [{ id: 'l1', batchId: 'b', source: 'Card', date: '2026-08-02', description: 'A', amount: 1, currency: 'USD', matchedExpenseId: null, importedAt: 1 }],
    });
    await pending;
    expect((await s.loadStatements())).toHaveLength(1);
    expect((await s.loadMonth('2026-08'))).toHaveLength(1);
  });
  it('shares one read between concurrent callers', async () => {
    const slow = fakePuter({ readDelay: 10 });
    const s = new Store(() => slow);
    await s.init();
    await Promise.all([s.loadStatements(), s.loadStatements(), s.loadMonth('2026-01'), s.loadMonth('2026-01')]);
    expect(slow._calls.filter((c) => c.name === 'fs.read' && c.args[0] === STATEMENTS_PATH)).toHaveLength(1);
    expect(slow._calls.filter((c) => c.name === 'fs.read' && c.args[0] === monthPath('2026-01'))).toHaveLength(1);
  });
});
