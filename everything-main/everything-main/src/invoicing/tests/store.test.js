import { describe, it, expect, beforeEach, vi } from 'vitest';
import { docStatus, dueDateFor } from '../src/lib/doc.js';

/* The store is a module singleton whose year cache survives init(); each
   test gets its own instance by resetting the module registry. */
const freshStore = async () => (await import('../src/lib/store.js')).store;
const storeModule = async () => import('../src/lib/store.js');

/* The same stand-in for Puter that backup.test.js uses. */
const kv = new Map();
const files = new Map();
globalThis.puter = {
  auth: { getUser: async () => ({ username: 'test' }) },
  kv: {
    get: async (k) => (kv.has(k) ? kv.get(k) : null),
    set: async (k, v) => { kv.set(k, v); return true; },
  },
  fs: {
    read: async (path) => {
      if (!files.has(path)) {
        const err = new Error('not found');
        err.code = 'subject_does_not_exist';
        throw err;
      }
      return { text: async () => files.get(path) };
    },
    write: async (path, data) => { writes.push(path); files.set(path, data); return { path }; },
    delete: async (path, opts) => {
      files.delete(path);
      if (opts?.recursive) {
        for (const key of [...files.keys()]) if (key.startsWith(`${path}/`)) files.delete(key);
      }
    },
  },
};
let writes = [];

const doc = (over = {}) => ({
  id: 'D1', kind: 'invoice', number: 'INV-0001', clientId: '', currency: 'USD',
  issueDate: '2025-12-31', dueDate: '2026-01-14',
  items: [{ id: 'l1', name: 'Design', qty: 1, rate: 100 }],
  taxRate: 0, discountType: 'none', discountValue: 0,
  status: 'sent', payments: [], createdAt: 1,
  ...over,
});

beforeEach(() => {
  vi.resetModules();
  kv.clear();
  files.clear();
  writes = [];
});

describe('a failed restore with writes still pending', () => {
  it('waits for every import write before restoring the previous dataset', async () => {
    const store = await freshStore();
    await store.init();
    await store.addClient({ name: 'Original client' });
    await store.saveDoc(doc());
    const original = structuredClone(store.exportAll());
    const imported = {
      ...original,
      clients: [{ id: 'imported', name: 'Imported client' }],
      settings: { ...original.settings, nextInvoice: 99 },
      docs: { 2026: [doc({ id: 'imported', issueDate: '2026-01-01' })] },
    };
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const set = puter.kv.set;
    let started = false;
    let settled = false;
    puter.kv.set = async (key, value) => {
      if (key === 'invc:clients:v1' && JSON.parse(value)[0]?.id === 'imported') {
        started = true;
        await pending;
      }
      if (key === 'invc:settings:v1' && JSON.parse(value).nextInvoice === 99) {
        throw new Error('settings write failed');
      }
      return set(key, value);
    };
    const restoring = store.importAll(imported).catch((error) => error)
      .finally(() => { settled = true; });
    try {
      await vi.waitFor(() => expect(started).toBe(true));
      const settledBeforeRelease = settled;
      release();
      expect((await restoring).message).toBe('settings write failed');
      expect(store.exportAll()).toEqual(original);
      await store.init();
      expect(store.exportAll()).toEqual(original);
      expect(settledBeforeRelease).toBe(false);
    } finally {
      release();
      await restoring;
      puter.kv.set = set;
    }
  });
});

describe('payments while receipt numbering is pending', () => {
  it('keeps both payments when two recordings overlap', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc());
    const payments = await Promise.all([
      store.addPayment('D1', { amount: 30 }),
      store.addPayment('D1', { amount: 40 }),
    ]);
    expect(store.doc('D1').payments).toEqual(payments);
    expect(new Set(payments.map((p) => p.number)).size).toBe(2);
    await store.init();
    expect(store.doc('D1').payments).toEqual(payments);
  });

  it('checks each overlapping refund against what is still refundable', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc({ payments: [{ id: 'paid', amount: 100 }] }));
    const refunds = await Promise.all([
      store.addPayment('D1', { amount: 70, refund: true }),
      store.addPayment('D1', { amount: 70, refund: true }),
    ]);
    expect(refunds.filter(Boolean)).toHaveLength(1);
    expect(store.doc('D1').payments.map((p) => p.amount)).toEqual([100, -70]);
  });

  it('continues recording after an earlier payment fails to save', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc());
    const write = puter.fs.write;
    let failed = false;
    puter.fs.write = async (path, body, options) => {
      if (!failed && JSON.parse(body)[0]?.payments?.length) {
        failed = true;
        throw new Error('payment write failed');
      }
      return write(path, body, options);
    };
    try {
      const [first, second] = await Promise.allSettled([
        store.addPayment('D1', { amount: 30 }),
        store.addPayment('D1', { amount: 40 }),
      ]);
      expect(first.status).toBe('rejected');
      expect(second.status).toBe('fulfilled');
      expect(store.doc('D1').payments).toEqual([second.value]);
      await store.init();
      expect(store.doc('D1').payments).toEqual([second.value]);
    } finally {
      puter.fs.write = write;
    }
  });

  it.each(['edit', 'delete'])('preserves a document %s during receipt numbering', async (action) => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc());
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const set = puter.kv.set;
    let started = false;
    puter.kv.set = async (key, value) => {
      if (key === 'invc:settings:v1') {
        started = true;
        await pending;
      }
      return set(key, value);
    };
    const recording = store.addPayment('D1', { amount: 30 });
    try {
      await vi.waitFor(() => expect(started).toBe(true));
      if (action === 'edit') await store.saveDoc({ ...store.doc('D1'), notes: 'Updated notes' });
      else await store.deleteDoc('D1');
      release();
      const payment = await recording;
      if (action === 'edit') {
        expect(store.doc('D1').notes).toBe('Updated notes');
        expect(store.doc('D1').payments).toEqual([payment]);
      } else {
        expect(payment).toBe(null);
        expect(store.doc('D1')).toBe(null);
        expect(store.trash().docs).toHaveLength(1);
      }
    } finally {
      release();
      await recording;
      puter.kv.set = set;
    }
  });
});

describe('a year file with junk in it', () => {
  it('drops the junk entries and keeps the documents', async () => {
    // The file is plain JSON in the user's own cloud. A null or a string in
    // it used to reach docs() as a document, and every list, report, and
    // total iterates that array.
    files.set('invoicing-data/docs-2026.json',
      JSON.stringify([null, 'nope', 42, [], { number: 'no id' }, doc({ issueDate: '2026-01-02' })]));
    kv.set('invc:years:v1', JSON.stringify(['2026']));

    const store = await freshStore();
    await store.init();

    expect(store.docs().map((d) => d.id)).toEqual(['D1']);
    expect(store.docs().every((d) => !!d && !!d.id)).toBe(true);
    // Saving something else rewrites the file without the junk.
    await store.saveDoc(doc({ id: 'D2', number: 'INV-0002', issueDate: '2026-02-02' }));
    expect(JSON.parse(files.get('invoicing-data/docs-2026.json')).map((d) => d.id)).toEqual(['D1', 'D2']);
  });
});

describe('loading heals a document stranded in two year files', () => {
  // A year-moving save writes the new year first; if the old year's write
  // then fails, disk holds the document twice. The next load must keep the
  // newest copy and repair the stale file, or every list and report counts
  // the money twice.
  it('keeps the newest copy and rewrites the stale year file', async () => {
    files.set('invoicing-data/docs-2025.json',
      JSON.stringify([doc({ issueDate: '2025-12-31', updatedAt: 100 })]));
    files.set('invoicing-data/docs-2026.json',
      JSON.stringify([doc({ issueDate: '2026-01-02', updatedAt: 200 })]));
    kv.set('invc:years:v1', JSON.stringify(['2025', '2026']));

    const store = await freshStore();
    await store.init();

    expect(store.docs().map((d) => `${d.id}@${d.issueDate}`)).toEqual(['D1@2026-01-02']);
    expect(JSON.parse(files.get('invoicing-data/docs-2025.json'))).toEqual([]);
    expect(JSON.parse(files.get('invoicing-data/docs-2026.json'))).toHaveLength(1);
  });

  it('trashes a document filed under a different year than its issue date', async () => {
    // A restored backup keys year files verbatim, so a document can sit in a
    // file its issue date does not name; deleting it must still find it —
    // and must flag it where it lies rather than moving it on the way out.
    files.set('invoicing-data/docs-2026.json',
      JSON.stringify([doc({ issueDate: '2025-12-31' })]));
    kv.set('invc:years:v1', JSON.stringify(['2026']));

    const store = await freshStore();
    await store.init();
    await store.deleteDoc('D1');

    expect(store.doc('D1')).toBe(null);
    expect(store.docs()).toEqual([]);
    const stored = JSON.parse(files.get('invoicing-data/docs-2026.json'));
    expect(stored).toHaveLength(1);
    expect(stored[0].deletedAt).toBeTruthy();
    expect(files.get('invoicing-data/docs-2025.json')).toBe(undefined);

    // Purging is what actually takes it out of the file.
    await store.purgeDoc('D1');
    expect(JSON.parse(files.get('invoicing-data/docs-2026.json'))).toEqual([]);
  });

  it('counts numbers up from a counter a backup stored as a string', async () => {
    // "7" + 1 is "71": one string counter in restored settings would corrupt
    // every number issued from then on.
    kv.set('invc:settings:v1', JSON.stringify({ invoicePrefix: 'INV-', nextInvoice: '7' }));

    const store = await freshStore();
    await store.init();

    expect(await store.reserveNumber('invoice')).toBe('INV-0007');
    expect(await store.reserveNumber('invoice')).toBe('INV-0008');
    expect(store.settings.nextInvoice).toBe(9);
  });

  it('leaves distinct documents alone', async () => {
    files.set('invoicing-data/docs-2025.json',
      JSON.stringify([doc({ id: 'A', updatedAt: 100 })]));
    files.set('invoicing-data/docs-2026.json',
      JSON.stringify([doc({ id: 'B', issueDate: '2026-01-02', updatedAt: 200 })]));
    kv.set('invc:years:v1', JSON.stringify(['2025', '2026']));

    const store = await freshStore();
    await store.init();

    expect(store.docs()).toHaveLength(2);
    // No repair was needed, so no year file was rewritten.
    expect(writes).toEqual([]);
    expect(JSON.parse(files.get('invoicing-data/docs-2025.json'))).toHaveLength(1);
  });
});

describe('yearly numbering', () => {
  it('counts each year separately and resolves {YYYY} when restart is on', async () => {
    kv.set('invc:settings:v1', JSON.stringify({
      invoicePrefix: 'INV-{YYYY}-',
      numberYearly: { invoice: true, quote: false, receipt: false },
    }));
    const store = await freshStore();
    await store.init();

    expect(await store.reserveNumber('invoice', '2026-01-05')).toBe('INV-2026-0001');
    expect(await store.reserveNumber('invoice', '2026-02-01')).toBe('INV-2026-0002');
    // A backdated document numbers into its own year without disturbing 2026.
    expect(await store.reserveNumber('invoice', '2025-11-30')).toBe('INV-2025-0001');
    expect(await store.reserveNumber('invoice', '2026-03-01')).toBe('INV-2026-0003');
    expect(store.settings.yearNext.invoice).toEqual({ 2026: 4, 2025: 2 });
    // The lifetime counter is untouched while the yearly regime runs.
    expect(store.settings.nextInvoice).toBe(1);
  });

  it('keeps one lifetime counter when restart is off, resolving {YYYY} all the same', async () => {
    kv.set('invc:settings:v1', JSON.stringify({ invoicePrefix: 'INV-{YYYY}-', nextInvoice: 41 }));
    const store = await freshStore();
    await store.init();

    expect(await store.reserveNumber('invoice', '2026-01-05')).toBe('INV-2026-0041');
    expect(await store.reserveNumber('invoice', '2025-06-05')).toBe('INV-2025-0042');
    expect(store.settings.nextInvoice).toBe(43);
  });

  it('peeks at the next number without reserving it', async () => {
    kv.set('invc:settings:v1', JSON.stringify({
      invoicePrefix: 'INV-{YYYY}-',
      numberYearly: { invoice: true },
    }));
    const store = await freshStore();
    await store.init();

    expect(store.peekNumber('invoice', '2026-04-01')).toBe('INV-2026-0001');
    expect(store.peekNumber('invoice', '2026-04-01')).toBe('INV-2026-0001');
    expect(store.settings.yearNext).toEqual({});
  });

  it('numbers receipts from the payment date through the same path', async () => {
    kv.set('invc:settings:v1', JSON.stringify({
      receiptPrefix: 'RCT-{YYYY}-',
      numberYearly: { receipt: true },
    }));
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc({ issueDate: '2026-01-10' }));

    const p = await store.addPayment('D1', { date: '2026-02-02', amount: 50, method: 'Card' });
    expect(p.number).toBe('RCT-2026-0001');
    expect(store.settings.yearNext.receipt).toEqual({ 2026: 2 });
  });
});

describe('duplicateDoc', () => {
  it('shares no mutable innards with its source', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc({
      issueDate: '2026-01-10',
      items: [{ id: 'l1', name: 'Design', qty: 1, rate: 100, taxes: [{ label: 'GST', rate: 5 }] }],
      taxes: [{ label: 'VAT', rate: 20 }],
      deposit: { type: 'percent', value: 25 },
    }));

    const src = store.doc('D1');
    const copy = await store.duplicateDoc('D1');
    expect(copy.items).toEqual(src.items);
    expect(copy.items[0]).not.toBe(src.items[0]);
    expect(copy.items[0].taxes).not.toBe(src.items[0].taxes);
    expect(copy.items[0].taxes[0]).not.toBe(src.items[0].taxes[0]);
    expect(copy.taxes[0]).not.toBe(src.taxes[0]);
    expect(copy.deposit).toEqual(src.deposit);
    expect(copy.deposit).not.toBe(src.deposit);

    // The proof of the pudding: editing the copy leaves the source alone.
    copy.deposit.value = 50;
    copy.items[0].rate = 999;
    copy.items[0].taxes[0].rate = 99;
    expect(store.doc('D1').deposit.value).toBe(25);
    expect(store.doc('D1').items[0].rate).toBe(100);
    expect(store.doc('D1').items[0].taxes[0].rate).toBe(5);
  });

  it('moves a duplicate’s payment plan along with its issue date', async () => {
    const store = await freshStore();
    await store.init();
    const today = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const back = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };
    const on = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
    await store.saveDoc(doc({
      issueDate: back(200),
      dueDate: back(186),
      schedule: [
        { id: 's1', label: 'On signing', dueDate: back(180), type: 'percent', value: 50 },
        { id: 's2', label: 'On delivery', dueDate: back(150), type: 'percent', value: 50 },
      ],
    }));
    const copy = await store.duplicateDoc('D1');
    // The plan keeps its shape — 20 and 50 days after the issue date — rather
    // than staying in the past and making a document dated today overdue.
    expect(copy.schedule.map((r) => r.dueDate)).toEqual([on(20), on(50)]);
    expect(dueDateFor(copy)).toBe(on(20));
    expect(docStatus({ ...copy, status: 'sent' }, iso(today))).not.toBe('overdue');
  });
});

describe('duplicateDoc leaves the source’s own history behind', () => {
  it('carries no attachment records into the copy', async () => {
    // The records point at files under the source document's folder: a copy
    // holding them shares one set of files with the original, and removing
    // one from the copy would delete the original's file.
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc({
      attachments: [{
        id: 'a1', name: 'timesheet.pdf', size: 10, type: 'application/pdf',
        path: 'invoicing-data/attachments/D1/a1-timesheet.pdf',
      }],
      shareAttachments: true,
    }));

    const copy = await store.duplicateDoc('D1');
    expect(copy.attachments).toBeUndefined();
    expect(copy.shareAttachments).toBeUndefined();
    // The source keeps its own.
    expect(store.doc('D1').attachments).toHaveLength(1);
  });

  it('starts a copy of a written-off invoice as a plain draft', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc({
      writeOff: { date: '2026-02-01', reason: 'client dissolved', at: 1 },
      trashedPayments: [{
        id: 'p1', number: 'RCT-0001', date: '2026-01-05', amount: 50,
        deletedAt: '2026-01-06T00:00:00.000Z',
      }],
    }));

    const copy = await store.duplicateDoc('D1');
    expect(copy.writeOff).toBeUndefined();
    expect(copy.trashedPayments).toBeUndefined();
    expect(copy.status).toBe('draft');
    // Nothing of the copy shows up in the trash, and the source is untouched.
    expect(store.trash().payments.map(({ doc: d }) => d.id)).toEqual(['D1']);
    expect(store.doc('D1').writeOff.reason).toBe('client dissolved');
  });

  it('does not claim the copy was delivered to the original\u2019s recipients', async () => {
    // The delivered-email log is evidence of a send this app watched happen.
    // A duplicate has never been emailed, so carrying it across would open a
    // fresh draft with a Delivered card naming addresses it never reached.
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc());
    await store.recordEmail('D1', { to: ['maya@northwind.example'], subject: 'Invoice INV-0001' });

    const copy = await store.duplicateDoc('D1');
    expect(copy.emails).toBeUndefined();
    expect(store.doc('D1').emails).toHaveLength(1);
  });
});

describe('convertQuote', () => {
  it('runs one conversion per quote, so a second press gets the first invoice', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc({ id: 'Q1', kind: 'quote', number: 'EST-0001', issueDate: '2026-01-05', status: 'accepted' }));
    // The page re-renders on every store change and reserveNumber emits
    // before its write lands, so two clicks reach the store before either
    // invoice is in memory.
    const [a, b] = await Promise.all([store.convertQuote('Q1'), store.convertQuote('Q1')]);
    expect(b.id).toBe(a.id);
    expect(store.docs().filter((d) => d.kind === 'invoice')).toHaveLength(1);
    expect(store.doc('Q1').invoiceId).toBe(a.id);
    expect(store.settings.nextInvoice).toBe(2);
  });

  it('finishes a half-done conversion instead of minting a second invoice', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc({
      id: 'Q1', kind: 'quote', number: 'EST-0001',
      issueDate: '2026-01-05', status: 'accepted',
    }));

    // The invoice write lands; linking the quote fails (a connection drop
    // between the two writes).
    const write = puter.fs.write;
    let n = 0;
    puter.fs.write = async (...args) => {
      n++;
      if (n === 2) throw new Error('connection dropped');
      return write(...args);
    };
    try {
      await expect(store.convertQuote('Q1')).rejects.toThrow();
    } finally {
      puter.fs.write = write;
    }
    const orphan = store.docs().find((d) => d.kind === 'invoice');
    expect(orphan.quoteId).toBe('Q1');
    expect(store.doc('Q1').invoiceId).toBeUndefined();

    // The retry links the quote to the invoice that already exists.
    const retry = await store.convertQuote('Q1');
    expect(retry.id).toBe(orphan.id);
    expect(store.doc('Q1').invoiceId).toBe(orphan.id);
    expect(store.docs().filter((d) => d.kind === 'invoice')).toHaveLength(1);
    // And no second number was reserved for it.
    expect(store.settings.nextInvoice).toBe(2);
  });
});

describe('processRecurringDue', () => {
  it('does not re-draft invoices an interrupted run already created', async () => {
    const { todayISO, addDays } = await import('../src/lib/dates.js');
    kv.set('invc:recurring:v1', JSON.stringify([{
      id: 'r1', name: 'Retainer', clientId: '', currency: 'USD',
      items: [{ id: 'l1', name: 'Maintenance', qty: 1, rate: 250 }],
      taxRate: 0, discountType: 'none', discountValue: 0, notes: '',
      freq: 'weekly', nextDue: addDays(todayISO(), -10), paused: false, createdAt: 1,
    }]));
    const store = await freshStore();
    await store.init();

    // The drafts save, then advancing the schedule fails (a connection
    // drop after the loop): the rule still points at the old nextDue.
    const set = puter.kv.set;
    puter.kv.set = async (k, v) => {
      if (k === 'invc:recurring:v1') throw new Error('connection dropped');
      return set(k, v);
    };
    try {
      await expect(store.processRecurringDue()).rejects.toThrow();
    } finally {
      puter.kv.set = set;
    }
    const drafted = store.docs().filter((d) => d.recurringId === 'r1');
    expect(drafted.length).toBeGreaterThan(0);

    // The retry finishes the bookkeeping without minting duplicates.
    const created = await store.processRecurringDue();
    expect(created).toBe(0);
    const after = store.docs().filter((d) => d.recurringId === 'r1');
    expect(after).toHaveLength(drafted.length);
    expect(new Set(after.map((d) => d.issueDate)).size).toBe(after.length);
    const rule = store.recurring.find((r) => r.id === 'r1');
    expect(rule.issued).toBe(after.length);
    expect(rule.nextDue > todayISO()).toBe(true);
  });
});

describe('a capped schedule moved back onto dates it has drafted', () => {
  it('drafts nothing and spends none of its remaining periods', async () => {
    const { todayISO, addDays, remainingOccurrences, ruleCompleted } = await import('../src/lib/dates.js');
    const first = addDays(todayISO(), -40);
    kv.set('invc:recurring:v1', JSON.stringify([{
      id: 'r1', name: 'Retainer', clientId: '', currency: 'USD',
      items: [{ id: 'l1', name: 'Retainer', qty: 1, rate: 100 }],
      taxRate: 0, discountType: 'none', discountValue: 0, notes: '',
      freq: 'monthly', anchorDay: 1, nextDue: first, paused: false,
      endMode: 'count', endCount: 6, issued: 0, createdAt: 1,
    }]));
    const store = await freshStore();
    await store.init();
    await store.processRecurringDue();
    const drafts = store.docs().filter((d) => d.recurringId === 'r1');
    expect(drafts.length).toBeGreaterThan(0);
    const rule = () => store.recurring.find((r) => r.id === 'r1');
    expect(rule().issued).toBe(drafts.length);

    // "Next invoice on" moved back to the first date, and the catch-up run
    // the editor triggers after a save.
    await store.saveRecurring({ ...rule(), nextDue: first });
    expect(await store.processRecurringDue()).toBe(0);
    expect(store.docs().filter((d) => d.recurringId === 'r1')).toHaveLength(drafts.length);
    expect(rule().issued).toBe(drafts.length);
    expect(remainingOccurrences(rule())).toBe(6 - drafts.length);
    expect(ruleCompleted(rule())).toBe(false);

    // A draft moved to the trash is drafted again by a rewind — and that one
    // counts: deleting a draft does not buy the schedule another period.
    await store.deleteDoc(drafts[0].id);
    await store.saveRecurring({ ...rule(), nextDue: first });
    expect(await store.processRecurringDue()).toBe(1);
    expect(rule().issued).toBe(drafts.length + 1);
  });
});

describe('a recurring run that the user acts under', () => {
  it('honours a pause, an edit, and a delete made while it is drafting', async () => {
    const { todayISO, addMonthsClamped } = await import('../src/lib/dates.js');
    // The 1st two months back: due then, last month and this month, on any day.
    const first = addMonthsClamped(todayISO(), -2, 1);
    const rule = (id) => ({
      id, name: id, clientId: '', currency: 'USD',
      items: [{ id: 'l1', name: 'Retainer', qty: 1, rate: 100 }],
      taxRate: 0, discountType: 'none', discountValue: 0, notes: '',
      freq: 'monthly', anchorDay: 1, nextDue: first, paused: false,
      endMode: 'never', issued: 0, createdAt: 1,
    });
    kv.set('invc:recurring:v1', JSON.stringify([rule('A'), rule('B'), rule('C')]));
    const store = await freshStore();
    await store.init();

    // Hold the first draft's year write so the run is in flight while the
    // user pauses B, deletes C, and edits A — each from the Recurring page,
    // which boot's un-awaited catch-up leaves fully usable.
    let release;
    let held = new Promise((resolve) => { release = resolve; });
    const write = puter.fs.write;
    puter.fs.write = async (path, data) => {
      const gate = held;
      held = null;
      if (gate) await gate;
      return write(path, data);
    };
    try {
      const run = store.processRecurringDue();
      await new Promise((resolve) => setTimeout(resolve, 5));
      await store.saveRecurring({ ...store.recurring.find((r) => r.id === 'B'), paused: true });
      await store.deleteRecurring('C');
      await store.saveRecurring({
        ...store.recurring.find((r) => r.id === 'A'),
        name: 'A renamed',
        items: [{ id: 'l1', name: 'Retainer', qty: 1, rate: 250 }],
      });
      release();
      const created = await run;
      expect(created).toBe(3);
    } finally {
      puter.fs.write = write;
    }

    const drafts = (id) => store.docs().filter((d) => d.recurringId === id);
    // B was paused before its turn: nothing drafted, and it stays paused.
    expect(drafts('B')).toHaveLength(0);
    expect(store.recurring.find((r) => r.id === 'B').paused).toBe(true);
    // C was deleted before its turn: nothing drafted, and it stays in the trash.
    expect(drafts('C')).toHaveLength(0);
    expect(store.recurring.some((r) => r.id === 'C')).toBe(false);
    expect(store.trash().recurring.some((r) => r.id === 'C')).toBe(true);
    // A was edited while its own drafts were being written: the edit stays,
    // and the bookkeeping still advanced it.
    const a = store.recurring.find((r) => r.id === 'A');
    expect(drafts('A')).toHaveLength(3);
    expect(a.name).toBe('A renamed');
    expect(a.items[0].rate).toBe(250);
    expect(a.issued).toBe(3);
    expect(a.nextDue > todayISO()).toBe(true);
  });

  it('stops at a pause that lands between two of one rule\'s drafts and resumes from there', async () => {
    const { todayISO, addDays } = await import('../src/lib/dates.js');
    kv.set('invc:recurring:v1', JSON.stringify([{
      id: 'r1', name: 'Retainer', clientId: '', currency: 'USD',
      items: [{ id: 'l1', name: 'Maintenance', qty: 1, rate: 250 }],
      taxRate: 0, discountType: 'none', discountValue: 0, notes: '',
      freq: 'weekly', nextDue: addDays(todayISO(), -20), paused: false, createdAt: 1,
    }]));
    const store = await freshStore();
    await store.init();
    const { dates } = (await import('../src/lib/dates.js')).dueOccurrences(store.recurring[0], todayISO());
    expect(dates.length).toBeGreaterThan(1);

    // Pause the moment the first draft has landed.
    const write = puter.fs.write;
    let paused = false;
    puter.fs.write = async (path, data) => {
      const out = await write(path, data);
      if (!paused && path.startsWith('invoicing-data/docs-')) {
        paused = true;
        await store.saveRecurring({ ...store.recurring[0], paused: true });
      }
      return out;
    };
    try {
      expect(await store.processRecurringDue()).toBe(1);
    } finally {
      puter.fs.write = write;
    }
    const rule = store.recurring[0];
    expect(rule.paused).toBe(true);
    expect(rule.issued).toBe(1);
    // The next date it did not reach is where it resumes.
    expect(rule.nextDue).toBe(dates[1]);
    await store.saveRecurring({ ...rule, paused: false });
    expect(await store.processRecurringDue()).toBe(dates.length - 1);
    const drafts = store.docs().filter((d) => d.recurringId === 'r1');
    expect(new Set(drafts.map((d) => d.issueDate)).size).toBe(dates.length);
    expect(store.recurring[0].issued).toBe(dates.length);
  });
});

describe('two recurring runs at once', () => {
  it('draft each period once between them', async () => {
    const { todayISO, addDays } = await import('../src/lib/dates.js');
    kv.set('invc:recurring:v1', JSON.stringify([{
      id: 'r1', name: 'Retainer', clientId: '', currency: 'USD',
      items: [{ id: 'l1', name: 'Maintenance', qty: 1, rate: 250 }],
      taxRate: 0, discountType: 'none', discountValue: 0, notes: '',
      freq: 'monthly', anchorDay: 1, nextDue: addDays(todayISO(), -3), paused: false, createdAt: 1,
    }]));
    const store = await freshStore();
    await store.init();

    // Boot's run is not awaited; Resume (or saving a schedule dated today)
    // starts another while it is still in the air. Both used to pass the
    // "already drafted?" check for the same date and mint two drafts.
    const [a, b] = await Promise.all([store.processRecurringDue(), store.processRecurringDue()]);
    const drafts = store.docs().filter((d) => d.recurringId === 'r1');
    expect(a + b).toBe(drafts.length);
    expect(new Set(drafts.map((d) => d.issueDate)).size).toBe(drafts.length);
    expect(new Set(drafts.map((d) => d.number)).size).toBe(drafts.length);
    const rule = store.recurring.find((r) => r.id === 'r1');
    expect(rule.issued).toBe(drafts.length);
    expect(rule.nextDue > todayISO()).toBe(true);
  });
});

describe('dangling quote links', () => {
  it('unlinks a quote whose invoice no longer exists on load', async () => {
    files.set('invoicing-data/docs-2026.json', JSON.stringify([
      doc({ id: 'Q1', kind: 'quote', number: 'EST-0001', status: 'accepted', invoiceId: 'GONE' }),
      doc({ id: 'Q2', kind: 'quote', number: 'EST-0002', status: 'accepted', invoiceId: 'I2' }),
      doc({ id: 'I2', number: 'INV-0002', quoteId: 'Q2' }),
    ]));
    kv.set('invc:years:v1', JSON.stringify(['2026']));
    const store = await freshStore();
    await store.init();
    expect(store.doc('Q1').invoiceId).toBeUndefined();
    // A link whose invoice is alive is left alone, and the repair landed.
    expect(store.doc('Q2').invoiceId).toBe('I2');
    const onDisk = JSON.parse(files.get('invoicing-data/docs-2026.json'));
    expect(onDisk.find((d) => d.id === 'Q1').invoiceId).toBeUndefined();
    expect(onDisk.find((d) => d.id === 'Q2').invoiceId).toBe('I2');
  });

  it('completes a conversion whose second write was lost, on load', async () => {
    // The invoice landed and points back at the quote; the write telling the
    // quote failed, so it read "accepted" and offered to convert again.
    files.set('invoicing-data/docs-2026.json', JSON.stringify([
      doc({ id: 'Q1', kind: 'quote', number: 'EST-0001', status: 'accepted' }),
      doc({ id: 'I1', number: 'INV-0001', quoteId: 'Q1' }),
      // Two invoices claiming one quote is a mess the heal must not guess at.
      doc({ id: 'Q2', kind: 'quote', number: 'EST-0002', status: 'accepted' }),
      doc({ id: 'I2', number: 'INV-0002', quoteId: 'Q2' }),
      doc({ id: 'I3', number: 'INV-0003', quoteId: 'Q2' }),
      // A trashed invoice does not count as the link.
      doc({ id: 'Q3', kind: 'quote', number: 'EST-0003', status: 'accepted' }),
      doc({ id: 'I4', number: 'INV-0004', quoteId: 'Q3', deletedAt: new Date().toISOString() }),
    ]));
    kv.set('invc:years:v1', JSON.stringify(['2026']));
    const store = await freshStore();
    await store.init();
    expect(store.doc('Q1').invoiceId).toBe('I1');
    expect(store.doc('Q2').invoiceId).toBeUndefined();
    expect(store.doc('Q3').invoiceId).toBeUndefined();
    const onDisk = JSON.parse(files.get('invoicing-data/docs-2026.json'));
    expect(onDisk.find((d) => d.id === 'Q1').invoiceId).toBe('I1');
    // Converting again does not mint a second invoice.
    const again = await store.convertQuote('Q1');
    expect(again).toBeNull();
  });

  it('unlinks a quote whose invoice is in the trash, as the delete meant to', async () => {
    // The invoice was deleted (it sits in the trash) but the follow-up write
    // that unlinks its quote was lost. The trashed copy still counted as
    // present, so the quote read "invoiced" — with no invoice to open —
    // until the purge thirty days later.
    files.set('invoicing-data/docs-2026.json', JSON.stringify([
      doc({ id: 'Q1', kind: 'quote', number: 'EST-0001', status: 'accepted', invoiceId: 'I1' }),
      doc({ id: 'I1', number: 'INV-0001', quoteId: 'Q1', deletedAt: new Date().toISOString() }),
    ]));
    kv.set('invc:years:v1', JSON.stringify(['2026']));
    const store = await freshStore();
    await store.init();
    expect(store.doc('Q1').invoiceId).toBeUndefined();
    expect(docStatus(store.doc('Q1'))).toBe('accepted');
    // Restoring the invoice re-links it, exactly as it does after a delete.
    await store.restoreDoc('I1');
    expect(store.doc('Q1').invoiceId).toBe('I1');
  });

  it('lets a quote convert again when a lost unlink write stranded it', async () => {
    files.set('invoicing-data/docs-2026.json', JSON.stringify([
      doc({ id: 'Q1', kind: 'quote', number: 'EST-0001', status: 'accepted', invoiceId: 'I1' }),
      doc({ id: 'I1', number: 'INV-0001', quoteId: 'Q1' }),
    ]));
    kv.set('invc:years:v1', JSON.stringify(['2026']));
    kv.set('invc:settings:v1', JSON.stringify({ nextInvoice: 2 }));
    const store = await freshStore();
    await store.init();

    // Deleting the invoice persists, but the quote's unlink write is lost.
    const write = puter.fs.write;
    let n = 0;
    puter.fs.write = async (...args) => {
      n++;
      if (n === 2) throw new Error('connection dropped');
      return write(...args);
    };
    try {
      await store.deleteDoc('I1');
    } finally {
      puter.fs.write = write;
    }
    expect(store.doc('I1')).toBeFalsy();
    expect(store.doc('Q1').invoiceId).toBe('I1');   // the stranded link

    // The dangling link no longer counts as converted.
    const again = await store.convertQuote('Q1');
    expect(again).not.toBeNull();
    expect(store.doc('Q1').invoiceId).toBe(again.id);
    expect(store.doc('Q1').status).toBe('accepted');
  });
});

describe('a lost year-file delete', () => {
  it('cannot resurrect wiped documents through a later save', async () => {
    files.set('invoicing-data/docs-2026.json',
      JSON.stringify([doc({ id: 'OLD', number: 'INV-0001', issueDate: '2026-01-05' })]));
    kv.set('invc:years:v1', JSON.stringify(['2026']));
    const store = await freshStore();
    await store.init();

    // The wipe replaces the dataset, but the stale file's delete is lost.
    const del = puter.fs.delete;
    puter.fs.delete = async () => { throw new Error('offline'); };
    try {
      await store.importAll({ settings: { currency: 'USD' }, clients: [], items: [], recurring: [], docs: {} });
    } finally {
      puter.fs.delete = del;
    }
    expect(store.docs()).toHaveLength(0);
    expect(files.has('invoicing-data/docs-2026.json')).toBe(true);

    // The first save into that year starts it fresh instead of adopting
    // (and re-indexing) the orphaned file's contents.
    await store.saveDoc(doc({ id: 'NEW', number: 'INV-0100', issueDate: '2026-03-01' }));
    expect(store.docs().map((d) => d.id)).toEqual(['NEW']);
    expect(JSON.parse(files.get('invoicing-data/docs-2026.json')).map((d) => d.id)).toEqual(['NEW']);
  });
});

describe('the year index under concurrent saves', () => {
  const reload = async () => {
    const store = await freshStore();
    await store.init();
    return store;
  };

  it('names both years when two saves into two new years race their index writes', async () => {
    const store = await freshStore();
    await store.init();
    // The first index write is slow; the second lands first and used to win
    // with the shorter list, leaving the first year's file unindexed.
    const set = puter.kv.set;
    let slowed = false;
    puter.kv.set = async (k, v) => {
      if (k === 'invc:years:v1' && !slowed) {
        slowed = true;
        await new Promise((r) => setTimeout(r, 30));
      }
      return set(k, v);
    };
    try {
      await Promise.all([
        store.saveDoc(doc({ id: 'A', issueDate: '2027-01-05' })),
        store.saveDoc(doc({ id: 'B', issueDate: '2028-01-05' })),
      ]);
    } finally {
      puter.kv.set = set;
    }
    expect(JSON.parse(kv.get('invc:years:v1')).sort()).toEqual(['2027', '2028']);
    vi.resetModules();
    const again = await reload();
    expect(again.docs().map((d) => d.id).sort()).toEqual(['A', 'B']);
  });

  it('fails a save that joined a failing index write, rather than leaving its file unindexed', async () => {
    const store = await freshStore();
    await store.init();
    const set = puter.kv.set;
    puter.kv.set = async (k, v) => {
      if (k === 'invc:years:v1') throw new Error('kv down');
      return set(k, v);
    };
    const outcomes = [];
    try {
      await Promise.all([
        store.saveDoc(doc({ id: 'A', issueDate: '2027-01-05' })).then(() => outcomes.push('A ok'), () => outcomes.push('A failed')),
        store.saveDoc(doc({ id: 'B', issueDate: '2027-02-05' })).then(() => outcomes.push('B ok'), () => outcomes.push('B failed')),
      ]);
    } finally {
      puter.kv.set = set;
    }
    expect(outcomes.sort()).toEqual(['A failed', 'B failed']);
    expect(store.docs()).toEqual([]);
    expect(store.years).toEqual([]);
    expect(files.has('invoicing-data/docs-2027.json')).toBe(false);
    // And the index works again once the store does.
    await store.saveDoc(doc({ id: 'C', issueDate: '2027-03-05' }));
    expect(JSON.parse(kv.get('invc:years:v1'))).toEqual(['2027']);
  });
});

describe('a failed restore', () => {
  it('puts the overwritten year files back so the old indexes never see mixed data', async () => {
    files.set('invoicing-data/docs-2026.json',
      JSON.stringify([doc({ id: 'W', number: 'INV-W', issueDate: '2026-02-01' })]));
    files.set('invoicing-data/docs-2025.json',
      JSON.stringify([doc({ id: 'X', number: 'INV-X', issueDate: '2025-07-01' })]));
    kv.set('invc:years:v1', JSON.stringify(['2026', '2025']));
    const store = await freshStore();
    await store.init();

    // The backup covers both years; the second year's write dies mid-restore,
    // after the first has already replaced a current file.
    const write = puter.fs.write;
    let calls = 0;
    puter.fs.write = async (path, data) => {
      if (++calls === 2) throw new Error('offline');
      return write(path, data);
    };
    let threw = null;
    try {
      await store.importAll({
        settings: { currency: 'USD' },
        clients: [],
        items: [],
        recurring: [],
        docs: {
          2026: [doc({ id: 'Z', number: 'INV-Z', issueDate: '2026-03-03' })],
          2025: [doc({ id: 'Y', number: 'INV-Y', issueDate: '2025-05-05' })],
        },
      }).catch((e) => { threw = e; });
    } finally {
      puter.fs.write = write;
    }
    expect(threw).toBeInstanceOf(Error);

    // Disk again matches what the untouched KV indexes describe — the old
    // dataset — instead of mixing one backup year into it.
    expect(JSON.parse(files.get('invoicing-data/docs-2026.json')).map((d) => d.id)).toEqual(['W']);
    expect(JSON.parse(files.get('invoicing-data/docs-2025.json')).map((d) => d.id)).toEqual(['X']);
    expect(JSON.parse(kv.get('invc:years:v1'))).toEqual(['2026', '2025']);
    expect(store.docs().map((d) => d.id).sort()).toEqual(['W', 'X']);
  });
});

describe('overlapping document saves', () => {
  it('a failed write does not erase a concurrent save that succeeded', async () => {
    kv.set('invc:years:v1', JSON.stringify(['2026']));
    files.set('invoicing-data/docs-2026.json', JSON.stringify([]));
    const store = await freshStore();
    await store.init();

    // Save A's queued year write fails; save B's, queued behind it in the
    // same year, succeeds — B resolves and the UI reports it saved.
    const write = puter.fs.write;
    let failures = 1;
    puter.fs.write = async (path, data) => {
      if (failures-- > 0) throw new Error('offline');
      return write(path, data);
    };
    try {
      const a = store.saveDoc(doc({ id: 'A', number: 'INV-A', issueDate: '2026-05-01' })).catch(() => 'failed');
      const b = store.saveDoc(doc({ id: 'B', number: 'INV-B', issueDate: '2026-05-02' }));
      expect(await a).toBe('failed');
      await b;
    } finally {
      puter.fs.write = write;
    }

    // A's rollback may undo only its own change, and the next write into
    // the year must persist B — not a pre-A snapshot that never held it.
    expect(store.doc('A')).toBe(null);
    expect(store.doc('B')).not.toBe(null);
    await store.saveDoc(doc({ id: 'C', number: 'INV-C', issueDate: '2026-05-03' }));
    const disk = JSON.parse(files.get('invoicing-data/docs-2026.json')).map((d) => d.id).sort();
    expect(disk).toEqual(['B', 'C']);
  });

  it('brings disk back to what the user sees after a failed write beside a successful one', async () => {
    kv.set('invc:years:v1', JSON.stringify(['2026']));
    files.set('invoicing-data/docs-2026.json', JSON.stringify([]));
    const store = await freshStore();
    await store.init();

    // B's body was captured while A was still in memory, so B's successful
    // write carried A to disk after A had been reported as not saved — and a
    // reload would have resurrected A. The store must follow up with a
    // rewrite of the year as it stands.
    const write = puter.fs.write;
    let failures = 1;
    puter.fs.write = async (path, data) => {
      if (failures-- > 0) throw new Error('offline');
      return write(path, data);
    };
    try {
      const a = store.saveDoc(doc({ id: 'A', number: 'INV-A', issueDate: '2026-05-01' })).catch(() => 'failed');
      const b = store.saveDoc(doc({ id: 'B', number: 'INV-B', issueDate: '2026-05-02' }));
      expect(await a).toBe('failed');
      await b;
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      puter.fs.write = write;
    }
    expect(JSON.parse(files.get('invoicing-data/docs-2026.json')).map((d) => d.id)).toEqual(['B']);
  });
});

describe('concurrent settings writes', () => {
  const SETTINGS = 'invc:settings:v1';

  it('a failed write does not revert a counter a later call bumped', async () => {
    kv.set(SETTINGS, JSON.stringify({ nextInvoice: 7 }));
    const store = await freshStore();
    await store.init();

    const set = puter.kv.set;
    let fail;
    let calls = 0;
    puter.kv.set = (k, v) => {
      if (k !== SETTINGS) return set(k, v);
      calls++;
      if (calls === 1) return new Promise((_, rej) => { fail = () => rej(new Error('offline')); });
      return set(k, v);
    };
    try {
      const a = store.updateSettings({ defaultNotes: 'hello' }).catch((e) => e);
      const b = store.updateSettings({ nextInvoice: 8 });
      await new Promise((r) => setTimeout(r));   // let the queued write start
      fail();
      expect(await a).toBeInstanceOf(Error);
      await b;
    } finally {
      puter.kv.set = set;
    }
    // The bump a concurrent flow persisted must survive the rollback.
    expect(store.settings.nextInvoice).toBe(8);
    expect(JSON.parse(kv.get(SETTINGS)).nextInvoice).toBe(8);
  });

  it('keeps in-flight writes ordered so the newest counter wins on disk', async () => {
    kv.set(SETTINGS, JSON.stringify({ nextInvoice: 1 }));
    const store = await freshStore();
    await store.init();

    const set = puter.kv.set;
    let release;
    let calls = 0;
    puter.kv.set = (k, v) => {
      if (k !== SETTINGS) return set(k, v);
      calls++;
      if (calls === 1) return new Promise((res) => { release = () => res(set(k, v)); });
      return set(k, v);
    };
    try {
      const a = store.updateSettings({ nextInvoice: 5 });
      const b = store.updateSettings({ nextInvoice: 6 });
      await new Promise((r) => setTimeout(r));   // let the first write start
      release();
      await Promise.all([a, b]);
    } finally {
      puter.kv.set = set;
    }
    expect(JSON.parse(kv.get(SETTINGS)).nextInvoice).toBe(6);
  });
});

describe('the saved-items list', () => {
  it('learns a line\'s rate and unit, and corrects them on the next save', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc({ items: [{ id: 'l1', name: 'Studio time', qty: 2, rate: 85, unit: 'hours' }] }));
    expect(store.items).toMatchObject([{ name: 'Studio time', rate: 85, unit: 'hours' }]);

    await store.saveDoc(doc({ id: 'D2', number: 'INV-0002', items: [{ id: 'l1', name: 'Studio time', qty: 1, rate: 95, unit: 'days' }] }));
    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({ rate: 95, unit: 'days' });
  });

  it('leaves a corrected rate alone when a save does not touch the lines', async () => {
    // Every write on a document runs through saveDoc — a payment recorded, an
    // invoice marked sent, a page published. Re-teaching from an untouched old
    // document rolled the rate back to whatever that document carried.
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc({ items: [{ id: 'l1', name: 'Studio time', qty: 2, rate: 85 }] }));
    await store.saveItem({ id: store.items[0].id, name: 'Studio time', rate: 120 });

    await store.addPayment('D1', { date: '2026-01-05', amount: 50 });
    expect(store.items[0]).toMatchObject({ name: 'Studio time', rate: 120 });

    await store.setDocStatus('D1', 'sent');
    expect(store.items[0]).toMatchObject({ rate: 120 });

    // An edit that really does move the rate still teaches it.
    await store.saveDoc({ ...store.doc('D1'), items: [{ id: 'l1', name: 'Studio time', qty: 2, rate: 95 }] });
    expect(store.items[0]).toMatchObject({ rate: 95 });
  });

  it('never empties a unit that was set by hand', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveItem({ name: 'Studio time', rate: 85, unit: 'hours' });
    await store.saveDoc(doc({ items: [{ id: 'l1', name: 'Studio time', qty: 2, rate: 90 }] }));
    expect(store.items[0]).toMatchObject({ rate: 90, unit: 'hours' });
  });

  it('stores an item with its tax treatment and reads it back after a reload', async () => {
    const store = await freshStore();
    await store.init();
    const saved = await store.saveItem({
      name: '  Disbursement  ', rate: '40.5', unit: ' each ', taxes: [{ label: 'VAT', rate: '20' }, { label: 'Junk', rate: 0 }],
    });
    expect(saved).toMatchObject({ name: 'Disbursement', rate: 40.5, unit: 'each', taxes: [{ label: 'VAT', rate: 20 }] });

    vi.resetModules();
    const again = await freshStore();
    await again.init();
    expect(again.items).toMatchObject([{ name: 'Disbursement', rate: 40.5, unit: 'each' }]);
  });

  it('edits an item in place and refuses a nameless one', async () => {
    const store = await freshStore();
    await store.init();
    const saved = await store.saveItem({ name: 'Design', rate: 100 });
    await store.saveItem({ id: saved.id, name: 'Design', rate: 120, unit: 'hours' });
    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({ id: saved.id, rate: 120, unit: 'hours' });
    expect(await store.saveItem({ name: '   ', rate: 5 })).toBe(null);
    expect(store.items).toHaveLength(1);
  });

  it('keeps one entry per description, in place, when an edit collides', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveItem({ name: 'Design', rate: 100 });
    const b = await store.saveItem({ name: 'Dev', rate: 90 });
    await store.saveItem({ id: b.id, name: 'design', rate: 150 });
    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({ id: b.id, name: 'design', rate: 150 });
  });

  it('deletes one', async () => {
    const store = await freshStore();
    await store.init();
    const saved = await store.saveItem({ name: 'Design', rate: 100 });
    await store.deleteItem(saved.id);
    expect(store.items).toEqual([]);
    expect(JSON.parse(kv.get('invc:items:v1'))).toEqual([]);
  });
});

describe('a save that must not teach the price list', () => {
  it('leaves the saved items exactly as they were', async () => {
    kv.set('invc:items:v1', JSON.stringify([{ id: 'i1', name: 'Consulting hour', rate: 150 }]));
    const store = await freshStore();
    await store.init();
    // A CSV import's rows: one line each, named for the invoice or copied
    // from a description column, priced at the invoice's total.
    for (let n = 1; n <= 120; n++) {
      await store.saveDoc(doc({
        id: `IMP${n}`, number: `INV-${n}`, issueDate: '2026-02-02',
        items: [{ id: 'l', name: n === 1 ? 'Consulting hour' : `Opening balance INV-${n}`, qty: 1, rate: 1200 }],
      }), { learn: false });
    }
    expect(store.items).toEqual([{ id: 'i1', name: 'Consulting hour', rate: 150 }]);
    // An ordinary save still teaches.
    await store.saveDoc(doc({ id: 'N1', issueDate: '2026-03-03', items: [{ id: 'l', name: 'New thing', qty: 1, rate: 5 }] }));
    expect(store.items.map((i) => i.name)).toEqual(['Consulting hour', 'New thing']);
  });
});

describe('writing off an invoice', () => {
  it('stores the date and reason, and clears them again', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc());
    const written = await store.setWriteOff('D1', { date: '2026-02-02', reason: '  client dissolved  ' });
    expect(written).toMatchObject({ date: '2026-02-02', reason: 'client dissolved' });
    expect(store.doc('D1').writeOff).toMatchObject({ date: '2026-02-02' });
    // On disk too, so a reload reads the same invoice.
    expect(JSON.parse(files.get('invoicing-data/docs-2025.json'))[0].writeOff.reason).toBe('client dissolved');

    await store.clearWriteOff('D1');
    expect('writeOff' in store.doc('D1')).toBe(false);
    expect('writeOff' in JSON.parse(files.get('invoicing-data/docs-2025.json'))[0]).toBe(false);
  });

  it('dates it today when no date is given, and never writes off a quote', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc({ id: 'Q1', kind: 'quote', number: 'EST-0001' }));
    expect(await store.setWriteOff('Q1', {})).toBe(null);
    await store.saveDoc(doc());
    const written = await store.setWriteOff('D1');
    expect(written.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('the trash', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('keeps a deleted document out of every list but not out of the file', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc());
    await store.deleteDoc('D1');

    expect(store.docs()).toEqual([]);
    expect(store.doc('D1')).toBe(null);
    expect(store.receipts()).toEqual([]);
    expect(store.trash().docs.map((d) => d.id)).toEqual(['D1']);
    expect(store.trashCount()).toBe(1);
  });

  it('restores a document with its number and payments intact', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc());
    await store.addPayment('D1', { date: '2026-01-05', amount: 40 });
    await store.deleteDoc('D1');
    const back = await store.restoreDoc('D1');

    expect(back.number).toBe('INV-0001');
    expect(store.doc('D1').payments).toHaveLength(1);
    expect(store.trashCount()).toBe(0);
    // A number issued is never reused, restored or not: the receipt counter
    // moved when the payment was recorded and never moves back.
    expect(store.doc('D1').payments[0].number).toBe('RCT-0001');
    expect(store.peekNumber('receipt')).toBe('RCT-0002');
  });

  it('takes a payment off its document and puts it back', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc());
    const p = await store.addPayment('D1', { date: '2026-01-05', amount: 40 });
    await store.deletePayment('D1', p.id);

    expect(store.doc('D1').payments).toEqual([]);
    expect(store.receipts()).toEqual([]);
    expect(store.trash().payments.map((x) => x.payment.id)).toEqual([p.id]);

    await store.restorePayment('D1', p.id);
    expect(store.doc('D1').payments.map((x) => x.number)).toEqual([p.number]);
    expect(store.doc('D1').trashedPayments).toEqual([]);
    expect(store.trashCount()).toBe(0);
  });

  it('hides a deleted client from documents until it is restored', async () => {
    const store = await freshStore();
    await store.init();
    const c = await store.addClient({ name: 'Maya' });
    await store.deleteClient(c.id);

    expect(store.clients).toEqual([]);
    expect(store.client(c.id)).toBe(null);
    expect(store.trash().clients.map((x) => x.id)).toEqual([c.id]);

    await store.restoreClient(c.id);
    expect(store.client(c.id).name).toBe('Maya');
    // And the trashed state was on disk, not only in memory.
    expect(JSON.parse(kv.get('invc:clients:v1'))[0].deletedAt).toBe(undefined);
  });

  it('stops a deleted schedule from drafting anything', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveRecurring({
      id: 'R1', clientId: '', currency: 'USD', items: [{ name: 'Retainer', qty: 1, rate: 100 }],
      freq: 'monthly', anchorDay: 1, nextDue: '2020-01-01', paused: false,
    });
    await store.deleteRecurring('R1');
    expect(store.recurring).toEqual([]);
    expect(await store.processRecurringDue()).toBe(0);
    expect(store.trash().recurring.map((r) => r.id)).toEqual(['R1']);

    await store.restoreRecurring('R1');
    expect(store.recurring).toHaveLength(1);
  });

  it('purges what has sat past its thirty days, and keeps the rest', async () => {
    const old = new Date(Date.now() - 31 * DAY).toISOString();
    const fresh = new Date(Date.now() - 2 * DAY).toISOString();
    files.set('invoicing-data/docs-2025.json', JSON.stringify([
      doc({ id: 'OLD', deletedAt: old }),
      doc({ id: 'NEW', deletedAt: fresh }),
      doc({ id: 'LIVE', trashedPayments: [{ id: 'p1', amount: 5, deletedAt: old }, { id: 'p2', amount: 5, deletedAt: fresh }] }),
    ]));
    kv.set('invc:years:v1', JSON.stringify(['2025']));
    kv.set('invc:clients:v1', JSON.stringify([{ id: 'c1', name: 'Gone', deletedAt: old }, { id: 'c2', name: 'Waiting', deletedAt: fresh }]));
    kv.set('invc:recurring:v1', JSON.stringify([{ id: 'r1', deletedAt: old }, { id: 'r2' }]));

    const store = await freshStore();
    await store.init();

    const ids = JSON.parse(files.get('invoicing-data/docs-2025.json')).map((d) => d.id);
    expect(ids).toEqual(['NEW', 'LIVE']);
    expect(store.trash().payments.map((x) => x.payment.id)).toEqual(['p2']);
    expect(store.trash().clients.map((c) => c.id)).toEqual(['c2']);
    expect(store.trash().recurring).toEqual([]);
    expect(store.recurring.map((r) => r.id)).toEqual(['r2']);
  });

  it('empties on request, and a backup still carries the trash', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc());
    const c = await store.addClient({ name: 'Maya' });
    await store.deleteDoc('D1');
    await store.deleteClient(c.id);

    const exported = store.exportAll();
    expect(exported.docs['2025'][0].deletedAt).toBeTruthy();
    expect(exported.clients[0].deletedAt).toBeTruthy();

    await store.emptyTrash();
    expect(store.trashCount()).toBe(0);
    expect(JSON.parse(files.get('invoicing-data/docs-2025.json'))).toEqual([]);
    expect(JSON.parse(kv.get('invc:clients:v1'))).toEqual([]);
  });

  it('empties with one write per container, and rolls back only what did not land', async () => {
    const store = await freshStore();
    await store.init();
    for (let i = 1; i <= 5; i++) await store.saveDoc(doc({ id: `D${i}`, number: `INV-000${i}` }));
    await store.saveDoc(doc({ id: 'D6', number: 'INV-0006', issueDate: '2026-02-01' }));
    const keep = await store.saveDoc(doc({ id: 'K1', number: 'INV-0100' }));
    const p = await store.addPayment('K1', { date: '2025-06-02', amount: 10, method: 'Cash', note: '' });
    await store.deletePayment('K1', p.id);
    const a = await store.addClient({ name: 'A' });
    const b = await store.addClient({ name: 'B' });
    for (const id of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']) await store.deleteDoc(id);
    await store.deleteClient(a.id);
    await store.deleteClient(b.id);
    expect(store.trash().docs).toHaveLength(6);
    expect(store.trash().payments).toHaveLength(1);

    writes = [];
    const set = puter.kv.set;
    let clientWrites = 0;
    puter.kv.set = async (k, v) => { if (k === 'invc:clients:v1') clientWrites++; return set(k, v); };
    try {
      await store.emptyTrash();
    } finally {
      puter.kv.set = set;
    }
    expect(store.trashCount()).toBe(0);
    expect(writes.filter((path) => path.includes('docs-2025'))).toHaveLength(1);
    expect(writes.filter((path) => path.includes('docs-2026'))).toHaveLength(1);
    expect(clientWrites).toBe(1);
    expect(store.doc('K1').trashedPayments).toEqual([]);
    expect(keep.id).toBe('K1');

    // A year that cannot be written comes back into the trash; the one that
    // was written stays purged.
    await store.saveDoc(doc({ id: 'E1', number: 'INV-0201' }));
    await store.saveDoc(doc({ id: 'E2', number: 'INV-0202', issueDate: '2026-03-01' }));
    await store.deleteDoc('E1');
    await store.deleteDoc('E2');
    const write = puter.fs.write;
    puter.fs.write = async (path, data) => {
      if (path.includes('docs-2026')) throw new Error('year write failed');
      return write(path, data);
    };
    try {
      await expect(store.emptyTrash()).rejects.toThrow('year write failed');
    } finally {
      puter.fs.write = write;
    }
    expect(store.trash().docs.map((d) => d.id)).toEqual(['E2']);
  });

  it('unlinks the estimate a trashed invoice came from, and links it back', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc({ id: 'Q1', kind: 'quote', number: 'EST-0001', status: 'accepted', invoiceId: 'I1' }));
    await store.saveDoc(doc({ id: 'I1', number: 'INV-0001', quoteId: 'Q1' }));

    await store.deleteDoc('I1');
    expect(store.doc('Q1').invoiceId).toBe(undefined);

    await store.restoreDoc('I1');
    expect(store.doc('Q1').invoiceId).toBe('I1');
  });
});

describe('attachments', () => {
  const file = (name, size = 10, type = 'application/pdf') => ({
    name, size, type, text: async () => 'x',
  });

  it('sanitises the name it builds a path out of', async () => {
    const { safeFileName, attachmentPath } = await storeModule();
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('a/b/report 2026.pdf')).toBe('report 2026.pdf');
    expect(safeFileName('')).toBe('file');
    expect(attachmentPath('d1', 'a1', '../evil.png')).toBe('invoicing-data/attachments/d1/a1-evil.png');
    // Ids from a hand-edited backup cannot escape the folder either.
    expect(attachmentPath('../x', '../y', 'n.txt')).toBe('invoicing-data/attachments/x/y-n.txt');
  });

  it('writes the file and records it on the document', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc());
    const entry = await store.attachFile('D1', file('timesheet.pdf', 1234));

    expect(entry).toMatchObject({ name: 'timesheet.pdf', size: 1234, type: 'application/pdf' });
    expect(files.has(entry.path)).toBe(true);
    expect(store.doc('D1').attachments).toHaveLength(1);
  });

  it('keeps the file when a later save of the document has taken the record along', async () => {
    // attachFile's year write is still in the air when a second save of the
    // same document (an email recorded) is queued behind it. Both fail: the
    // first may not roll back (the second owns the document now) and the
    // second's rollback restores the first's version, entry included — so
    // deleting the file on the first failure left a record with no file.
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc());
    const write = puter.fs.write;
    let holdFirst = null;
    let n = 0;
    puter.fs.write = (path, data) => {
      if (!path.endsWith('.json')) return write(path, data);
      n++;
      if (n === 1) return new Promise((_, reject) => { holdFirst = reject; });
      return Promise.reject(new Error('offline'));
    };
    const tick = () => new Promise((r) => setTimeout(r, 0));
    try {
      const att = store.attachFile('D1', file('a.pdf'));
      att.catch(() => {});
      await tick(); await tick();
      expect(store.doc('D1').attachments).toHaveLength(1);
      const mail = store.recordEmail('D1', { to: ['x@y.example'] });
      mail.catch(() => {});
      await tick();
      holdFirst(new Error('offline'));
      const settled = await Promise.allSettled([att, mail]);
      expect(settled.map((s) => s.status)).toEqual(['rejected', 'rejected']);
      await tick();
    } finally {
      puter.fs.write = write;
    }
    const [entry] = store.doc('D1').attachments || [];
    expect(entry).toBeTruthy();
    expect(files.has(entry.path)).toBe(true);
  });

  it('takes the file back out when the record cannot be written', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc());
    const write = puter.fs.write;
    let n = 0;
    puter.fs.write = async (...args) => {
      n++;
      if (n === 2) throw new Error('connection dropped');
      return write(...args);
    };
    try {
      await expect(store.attachFile('D1', file('a.pdf'))).rejects.toThrow();
    } finally {
      puter.fs.write = write;
    }
    expect(store.doc('D1').attachments ?? []).toEqual([]);
    expect([...files.keys()].some((k) => k.includes('attachments'))).toBe(false);
  });

  it('refuses a file over the size cap and a document over the count cap', async () => {
    const { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } = await storeModule();
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc());
    await expect(store.attachFile('D1', file('huge.mov', MAX_ATTACHMENT_BYTES + 1))).rejects.toThrow(/larger than/);

    await store.saveDoc({
      ...store.doc('D1'),
      attachments: Array.from({ length: MAX_ATTACHMENTS }, (_, i) => ({ id: `a${i}`, name: `f${i}`, path: `p${i}` })),
    });
    await expect(store.attachFile('D1', file('one-more.pdf'))).rejects.toThrow(/already has/);
  });

  it('removes a file from the document and from the cloud', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc());
    const entry = await store.attachFile('D1', file('a.pdf'));
    await store.removeAttachment('D1', entry.id);

    expect(store.doc('D1').attachments).toEqual([]);
    expect(files.has(entry.path)).toBe(false);
  });

  it('keeps the files while a document is in the trash, and deletes them on purge', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc());
    const entry = await store.attachFile('D1', file('a.pdf'));

    await store.deleteDoc('D1');
    expect(files.has(entry.path)).toBe(true);
    await store.restoreDoc('D1');
    expect(store.doc('D1').attachments).toHaveLength(1);

    await store.deleteDoc('D1');
    await store.purgeDoc('D1');
    expect(files.has(entry.path)).toBe(false);
  });

  it('keeps the files when the purge cannot be recorded, so the document restores whole', async () => {
    const store = await freshStore();
    await store.init();
    await store.saveDoc(doc());
    const entry = await store.attachFile('D1', file('a.pdf'));
    await store.deleteDoc('D1');

    // The year file cannot be written: the purge rolls back into the trash.
    const write = puter.fs.write;
    puter.fs.write = async (path, data) => {
      if (path.includes('docs-')) throw new Error('year write failed');
      return write(path, data);
    };
    try {
      await expect(store.purgeDoc('D1')).rejects.toThrow('year write failed');
    } finally {
      puter.fs.write = write;
    }
    expect(store.trash().docs.map((d) => d.id)).toEqual(['D1']);
    // The record still lists the file, so the file has to still be there.
    expect(files.has(entry.path)).toBe(true);
    await store.restoreDoc('D1');
    expect(store.doc('D1').attachments).toHaveLength(1);
    expect(files.has(entry.path)).toBe(true);
  });
});

describe('an attachment record pointing outside its folder', () => {
  it('is never deleted or copied on the document’s behalf', async () => {
    const { ownsAttachmentPath } = await storeModule();
    expect(ownsAttachmentPath('D1', 'invoicing-data/attachments/D1/a1-timesheet.pdf')).toBe(true);
    expect(ownsAttachmentPath('D1', 'invoicing-data/docs-2025.json')).toBe(false);
    expect(ownsAttachmentPath('D1', 'invoicing-data/attachments/D1/..')).toBe(false);
    expect(ownsAttachmentPath('D1', 'invoicing-data/attachments/D1/x/../..')).toBe(false);
    expect(ownsAttachmentPath('D1', 'invoicing-data/attachments/D2/a1-x')).toBe(false);

    // A year file hand-edited (or restored from an older build) to carry
    // such a record: Remove drops the record and leaves the file alone.
    files.set('invoicing-data/docs-2025.json', JSON.stringify([doc({ id: 'X1', issueDate: '2025-02-02' })]));
    files.set('invoicing-data/docs-2026.json', JSON.stringify([doc({
      id: 'D1', issueDate: '2026-02-02',
      attachments: [{ id: 'a1', name: 'x', size: 1, path: 'invoicing-data/docs-2025.json' }],
    })]));
    kv.set('invc:years:v1', JSON.stringify(['2025', '2026']));
    const store = await freshStore();
    await store.init();
    await store.removeAttachment('D1', 'a1');
    expect(store.doc('D1').attachments).toEqual([]);
    expect(files.has('invoicing-data/docs-2025.json')).toBe(true);
    // And the purge, which runs with no action of the user's at all.
    await store.saveDoc({ ...store.doc('D1'), attachments: [{ id: 'a2', name: 'x', size: 1, path: 'invoicing-data/docs-2025.json' }] });
    await store.deleteDoc('D1');
    await store.purgeDoc('D1');
    expect(files.has('invoicing-data/docs-2025.json')).toBe(true);
  });
});

describe('the read-only offline state', () => {
  const snapshot = () => ({
    settings: { currency: 'EUR', business: { name: 'Aurora' } },
    clients: [{ id: 'c1', name: 'Maya' }],
    items: [],
    recurring: [{ id: 'r1', nextDue: '2020-01-01' }],
    docs: { 2026: [doc({ id: 'S1', issueDate: '2026-03-03' })] },
  });

  it('fills the store from a snapshot without touching the cloud', async () => {
    const store = await freshStore();
    store.loadOffline(snapshot(), { user: { username: 'demo' } });

    expect(store.readOnly).toBe(true);
    expect(store.docs().map((d) => d.id)).toEqual(['S1']);
    expect(store.client('c1').name).toBe('Maya');
    expect(store.settings.currency).toBe('EUR');
    expect(store.recurring).toHaveLength(1);
    // Nothing was written anywhere.
    expect(files.size).toBe(0);
    expect(kv.size).toBe(0);
  });

  it('refuses every write while it is showing that copy', async () => {
    const store = await freshStore();
    store.loadOffline(snapshot());
    const reason = /saved copy/;
    await expect(store.saveDoc(doc())).rejects.toThrow(reason);
    await expect(store.deleteDoc('S1')).rejects.toThrow(reason);
    await expect(store.updateSettings({ currency: 'USD' })).rejects.toThrow(reason);
    await expect(store.addClient({ name: 'New' })).rejects.toThrow(reason);
    await expect(store.deleteClient('c1')).rejects.toThrow(reason);
    await expect(store.addPayment('S1', { amount: 10 })).rejects.toThrow(reason);
    await expect(store.saveItem({ name: 'x', rate: 1 })).rejects.toThrow(reason);
    await expect(store.saveRecurring({ id: 'r1' })).rejects.toThrow(reason);
    await expect(store.attachFile('S1', { name: 'a.pdf', size: 1 })).rejects.toThrow(reason);
    // And the schedules it holds draft nothing behind the user's back.
    await expect(store.processRecurringDue()).rejects.toThrow(reason);
    expect(files.size).toBe(0);
  });

  it('writes again once it is back on the network', async () => {
    const store = await freshStore();
    store.loadOffline(snapshot());
    await store.reconnect();

    expect(store.readOnly).toBe(false);
    // init() read the (empty) cloud, so the snapshot's documents are gone.
    expect(store.docs()).toEqual([]);
    await store.saveDoc(doc());
    expect(store.doc('D1')).toBeTruthy();
  });

  it('shows the cloud’s documents after reconnecting, not the device copy’s', async () => {
    // The device copy and the cloud both have 2026, and the cloud has moved
    // on: another device changed D1 and added D2. Reconnecting used to keep
    // the cached year — the copy's — as the cloud's, and the next save wrote
    // that stale list over the cloud's file, taking D2 and D1's edit with it.
    kv.set('invc:years:v1', JSON.stringify(['2026']));
    files.set('invoicing-data/docs-2026.json', JSON.stringify([
      doc({ id: 'S1', issueDate: '2026-03-03', items: [{ id: 'l1', name: 'Design', qty: 1, rate: 500 }] }),
      doc({ id: 'D2', issueDate: '2026-04-04' }),
    ]));
    const store = await freshStore();
    store.loadOffline(snapshot());
    expect(store.doc('S1').items[0].rate).toBe(100);

    await store.reconnect();
    expect(store.docs().map((d) => d.id).sort()).toEqual(['D2', 'S1']);
    expect(store.doc('S1').items[0].rate).toBe(500);

    await store.saveDoc(doc({ id: 'D3', issueDate: '2026-05-05' }));
    const onDisk = JSON.parse(files.get('invoicing-data/docs-2026.json')).map((d) => d.id).sort();
    expect(onDisk).toEqual(['D2', 'D3', 'S1']);
  });

  it('stays read-only until the cloud has actually answered', async () => {
    const store = await freshStore();
    store.loadOffline(snapshot());
    const held = [];
    const get = puter.kv.get;
    puter.kv.get = (k) => new Promise((resolve) => { held.push(() => resolve(get(k))); });
    try {
      const pending = store.reconnect();
      await Promise.resolve();
      expect(store.readOnly).toBe(true);
      await expect(store.saveDoc(doc())).rejects.toThrow(/saved copy/);
      puter.kv.get = get;
      held.splice(0).forEach((go) => go());
      await pending;
    } finally {
      puter.kv.get = get;
    }
    expect(store.readOnly).toBe(false);
  });

  it('runs one reconnect at a time', async () => {
    const store = await freshStore();
    store.loadOffline(snapshot());
    const getUser = puter.auth.getUser;
    let calls = 0;
    puter.auth.getUser = async () => { calls += 1; return getUser(); };
    try {
      await Promise.all([store.reconnect(), store.reconnect()]);
    } finally {
      puter.auth.getUser = getUser;
    }
    expect(calls).toBe(1);
    expect(store.readOnly).toBe(false);
  });

  it('lets a load that answers after the device copy took over touch nothing', async () => {
    // boot() gives init() twenty seconds and then opens the device copy. The
    // timeout does not cancel the load: it used to land minutes later under
    // the offline banner — swapping in the cloud's settings and user, and
    // running the heal passes, which wrote the device copy's year lists to
    // the cloud, all while the store said it was read-only.
    kv.set('invc:years:v1', JSON.stringify(['2026']));
    kv.set('invc:settings:v1', JSON.stringify({ currency: 'GBP' }));
    files.set('invoicing-data/docs-2026.json', JSON.stringify([
      doc({ id: 'S1', issueDate: '2026-03-03', items: [{ id: 'l1', name: 'Design', qty: 1, rate: 500 }] }),
      doc({ id: 'D2', issueDate: '2026-04-04' }),
    ]));
    const store = await freshStore();
    let release;
    const read = puter.fs.read;
    puter.fs.read = (p) => new Promise((resolve) => { release = () => resolve(read(p)); });
    let outcome;
    try {
      const late = store.init().then((r) => { outcome = r; });
      await new Promise((r) => setTimeout(r, 0));
      // The timeout fired; the device copy takes over. It carries a trashed
      // document old enough for the purge pass to want to write it away.
      const snap = snapshot();
      snap.docs[2026].push(doc({ id: 'T1', issueDate: '2026-01-01', deletedAt: '2020-01-01T00:00:00.000Z' }));
      store.loadOffline(snap, { user: { username: 'offline' } });
      puter.fs.read = read;
      release();
      await late;
    } finally {
      puter.fs.read = read;
    }
    expect(outcome).toBe(false);
    expect(store.readOnly).toBe(true);
    expect(store.user).toEqual({ username: 'offline' });
    expect(store.settings.currency).toBe('EUR');
    expect(store.docs().map((d) => d.id)).toEqual(['S1']);
    expect(store.doc('S1').items[0].rate).toBe(100);
    expect(writes).toEqual([]);
    expect(JSON.parse(files.get('invoicing-data/docs-2026.json'))).toHaveLength(2);
  });

  it('stays read-only when reconnecting fails', async () => {
    const store = await freshStore();
    store.loadOffline(snapshot());
    const get = puter.kv.get;
    puter.kv.get = async () => { throw new Error('offline'); };
    try {
      await expect(store.reconnect()).rejects.toThrow();
    } finally {
      puter.kv.get = get;
    }
    expect(store.readOnly).toBe(true);
  });
});

describe('the record of emails actually delivered', () => {
  const load = async () => {
    files.set('invoicing-data/docs-2025.json', JSON.stringify([doc()]));
    kv.set('invc:years:v1', JSON.stringify(['2025']));
    const store = await freshStore();
    await store.init();
    return store;
  };

  it('notes who a document went to, and what rode along', async () => {
    const store = await load();
    const entry = await store.recordEmail('D1', {
      to: ['maya@northwind.example'], subject: 'Invoice INV-0001', attachments: 2,
    });
    expect(entry.to).toEqual(['maya@northwind.example']);
    expect(entry.attachments).toBe(2);
    expect(store.doc('D1').emails).toHaveLength(1);
  });

  it('appends, newest last, so the page can read the last send off the end', async () => {
    const store = await load();
    await store.recordEmail('D1', { to: ['a@x.example'] });
    await store.recordEmail('D1', { to: ['b@x.example'] });
    expect(store.doc('D1').emails.map((e) => e.to[0])).toEqual(['a@x.example', 'b@x.example']);
  });

  it('records nothing when nothing was delivered — this log is evidence', async () => {
    const store = await load();
    expect(await store.recordEmail('D1', { to: [] })).toBeNull();
    expect(await store.recordEmail('D1', { to: ['   '] })).toBeNull();
    expect(store.doc('D1').emails).toBeUndefined();
  });

  it('keeps an estimate’s sends too — a quote is emailed like anything else', async () => {
    files.set('invoicing-data/docs-2025.json', JSON.stringify([doc({ id: 'Q1', kind: 'quote', number: 'EST-0001' })]));
    kv.set('invc:years:v1', JSON.stringify(['2025']));
    const store = await freshStore();
    await store.init();
    expect(await store.recordEmail('Q1', { to: ['a@x.example'] })).toBeTruthy();
  });

  it('caps the log so a long dispute cannot grow the year file without bound', async () => {
    const store = await load();
    for (let i = 0; i < 55; i++) await store.recordEmail('D1', { to: [`a${i}@x.example`] });
    const log = store.doc('D1').emails;
    expect(log).toHaveLength(50);
    expect(log[log.length - 1].to[0]).toBe('a54@x.example');
  });
});
