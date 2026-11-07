import { describe, it, expect, beforeEach } from 'vitest';
import { validateBackup, parseBackup, restoreSummary, retireSharePages } from '../src/lib/backup.js';
import { store, DEFAULT_SETTINGS } from '../src/lib/store.js';
import { reminderNote } from '../src/lib/reminders.js';
import { copyItems } from '../src/lib/doc.js';

/* A stand-in for the parts of Puter the store touches, so the real
   importAll/exportAll pair can be exercised end to end. */
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
    write: async (path, data) => { files.set(path, data); return { path }; },
    delete: async (path, opts) => {
      files.delete(path);
      if (opts?.recursive) {
        for (const key of [...files.keys()]) if (key.startsWith(`${path}/`)) files.delete(key);
      }
    },
  },
};

const invoice = {
  id: 'd1',
  kind: 'invoice',
  number: 'INV-0001',
  clientId: 'c1',
  issueDate: '2025-12-01',
  dueDate: '2025-12-15',
  currency: 'USD',
  items: [{ id: 'l1', name: 'Design', qty: 1, rate: 800 }],
  taxRate: 0,
  discountType: 'none',
  discountValue: 0,
  notes: 'Thanks',
  status: 'sent',
  payments: [{ id: 'p1', number: 'RCT-0001', date: '2025-12-10', amount: 800, method: 'Card', note: '', createdAt: 1 }],
  createdAt: 1,
};

const quote = {
  id: 'd2',
  kind: 'quote',
  number: 'EST-0001',
  clientId: 'c1',
  issueDate: '2026-02-02',
  validUntil: '2026-03-04',
  currency: 'USD',
  items: [{ id: 'l2', name: 'Audit', qty: 1, rate: 500 }],
  taxRate: 0,
  discountType: 'none',
  discountValue: 0,
  notes: '',
  status: 'sent',
  payments: [],
  createdAt: 2,
};

const backup = () => structuredClone({
  app: 'invoicing',
  version: 1,
  settings: {
    ...DEFAULT_SETTINGS,
    business: { ...DEFAULT_SETTINGS.business, name: 'Aurora Studio', email: 'hi@example.com' },
    nextInvoice: 2,
    nextQuote: 2,
    nextReceipt: 2,
    onboarded: true,
  },
  clients: [{
    id: 'c1', name: 'Maya Chen', company: 'Northwind', email: '', phone: '', address: '',
    currency: 'EUR', paymentTermsDays: 30, taxRate: 0, notes: 'Net 30, wire only.',
    createdAt: 1,
  }],
  items: [{ id: 'i1', name: 'Design', rate: 800 }],
  recurring: [{
    id: 'r1', name: 'Retainer', clientId: 'c1', currency: 'USD',
    items: [{ id: 'l3', name: 'Maintenance', qty: 1, rate: 250 }],
    taxRate: 0, discountType: 'none', discountValue: 0, notes: '',
    freq: 'monthly', anchorDay: 1, nextDue: '2026-09-01', paused: false, createdAt: 1,
  }],
  docs: { 2025: [invoice], 2026: [quote] },
});

beforeEach(() => {
  kv.clear();
  files.clear();
});

describe('validateBackup', () => {
  it('accepts a backup this app produced', () => {
    const res = validateBackup(backup());
    expect(res.ok).toBe(true);
    expect(res.counts).toMatchObject({ docs: 2, clients: 1, recurring: 1, shared: 0, years: '2025–2026' });
  });

  it('fills in fields that a backup from an older build lacks', () => {
    const old = backup();
    delete old.settings.brandColor;
    delete old.settings.business.logo;
    delete old.items;
    const res = validateBackup(old);
    expect(res.ok).toBe(true);
    expect(res.data.settings.brandColor).toBe('');
    expect(res.data.settings.business.logo).toBe('');
    expect(res.data.items).toEqual([]);
  });

  it('strips share tokens and reports them for cleanup', () => {
    const data = backup();
    data.docs[2025][0].shareToken = 'abc123xyz789';
    const res = validateBackup(data);
    expect(res.tokens).toEqual(['abc123xyz789']);
    expect(res.counts.shared).toBe(1);
    expect(res.data.docs[2025][0].shareToken).toBeUndefined();
  });

  it('drops entries that are not documents', () => {
    const data = backup();
    data.docs[2025].push(null, { id: 'x' }, { id: 'y', kind: 'receipt' }, { kind: 'invoice' });
    data.clients.push({ name: 'no id' }, null);
    const res = validateBackup(data);
    expect(res.data.docs[2025]).toHaveLength(1);
    expect(res.data.clients).toHaveLength(1);
  });

  it('carries attachment metadata, dropping entries with no file to point at', () => {
    const data = backup();
    data.docs[2025][0].attachments = [
      { id: 'a1', name: 'timesheet.pdf', size: 120, path: 'invoicing-data/attachments/d1/a1-timesheet.pdf' },
      { id: 'a2', name: 'no path' },
      null,
    ];
    const res = validateBackup(data);
    expect(res.data.docs[2025][0].attachments).toHaveLength(1);
    expect(res.counts.attachments).toBe(1);
    expect(restoreSummary(res.counts)).toContain('1 attached file');
  });

  it('round-trips the trash, dropping junk among the deleted payments', () => {
    const data = backup();
    data.docs[2025][0].deletedAt = '2026-08-01T10:00:00.000Z';
    data.docs[2025][0].trashedPayments = [null, 'oops', { id: 'p9', amount: 40, deletedAt: '2026-08-01T10:00:00.000Z' }];
    data.clients[0].deletedAt = '2026-08-02T10:00:00.000Z';
    const res = validateBackup(data);
    const doc = res.data.docs[2025][0];
    expect(doc.deletedAt).toBe('2026-08-01T10:00:00.000Z');
    expect(doc.trashedPayments).toHaveLength(1);
    expect(res.data.clients[0].deletedAt).toBe('2026-08-02T10:00:00.000Z');
  });

  it('drops junk inside a saved item’s tax treatment', () => {
    const data = backup();
    data.items[0].unit = 'hours';
    data.items[0].taxes = [null, 'oops', { label: 'VAT', rate: 20 }];
    const res = validateBackup(data);
    // A saved item's treatment is copied straight onto a line in the editor,
    // so a junk entry here becomes a junk entry on a document.
    expect(res.data.items[0].taxes).toEqual([{ label: 'VAT', rate: 20 }]);
    expect(res.data.items[0].unit).toBe('hours');
  });

  it('drops junk entries inside a schedule’s own lists', () => {
    // A schedule's lines reach copyItems() at every boot, which throws on a
    // null — swallowed by the caller, so no schedule drafts anything and
    // nothing says why — and its taxes reach the editor, which blanks.
    const raw = backup();
    raw.recurring[0].items = [null, 'nope', { id: 'l3', name: 'Maintenance', qty: 1, rate: 250, taxes: [null, { label: 'VAT', rate: 20 }] }];
    raw.recurring[0].taxes = [null, 5, { label: 'GST', rate: 5 }];
    const res = validateBackup(raw);
    expect(res.ok).toBe(true);
    const rule = res.data.recurring[0];
    expect(rule.items).toEqual([{ id: 'l3', name: 'Maintenance', qty: 1, rate: 250, taxes: [{ label: 'VAT', rate: 20 }] }]);
    expect(rule.taxes).toEqual([{ label: 'GST', rate: 5 }]);
    // The lines are safe to copy, which is what boot does with them.
    expect(() => copyItems(rule.items)).not.toThrow();
  });

  it('gives a schedule with an unusable line list an empty one', () => {
    const raw = backup();
    raw.recurring[0].items = 'nope';
    const rule = validateBackup(raw).data.recurring[0];
    expect(rule.items).toEqual([]);
    expect(() => copyItems(rule.items)).not.toThrow();
  });

  it('drops junk entries inside a document’s own lists', () => {
    const data = backup();
    data.docs[2025][0].payments.push(null, 'oops', 7);
    data.docs[2025][0].items.push(null, []);
    data.docs[2025][0].items[0].taxes = [null, { label: 'VAT', rate: 20 }];
    data.docs[2025][0].taxes = ['bad', { label: 'VAT', rate: 20 }];
    data.docs[2025][0].reminders = [null, 'oops', { id: 'r1', date: '2025-12-05', stage: 'reminderDue', how: 'mail' }];
    const res = validateBackup(data);
    const doc = res.data.docs[2025][0];
    expect(doc.payments).toHaveLength(1);
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].taxes).toEqual([{ label: 'VAT', rate: 20 }]);
    expect(doc.taxes).toEqual([{ label: 'VAT', rate: 20 }]);
    // A junk reminder is what the document page and the dashboard's
    // "Needs attention" card both walk straight into.
    expect(doc.reminders).toHaveLength(1);
    expect(() => reminderNote(doc, '2026-01-01')).not.toThrow();
  });

  it('repairs a reminders list that is not a list, and leaves a missing one missing', () => {
    const data = backup();
    data.docs[2025][0].reminders = 'nope';
    const res = validateBackup(data);
    expect(res.data.docs[2025][0].reminders).toEqual([]);
    expect('reminders' in res.data.docs[2026][0]).toBe(false);
  });

  it('drops junk out of the delivered-email log, which the document page draws', () => {
    const data = backup();
    data.docs[2025][0].emails = [null, 'oops', { id: 'e1', date: '2025-12-05', to: ['a@x.example'] }];
    const res = validateBackup(data);
    expect(res.data.docs[2025][0].emails).toHaveLength(1);
  });

  it('drops a delivered-email entry that names nobody, which the page would join', () => {
    const data = backup();
    data.docs[2025][0].emails = [
      { id: 'e1', date: '2025-12-05', to: 'a@x.example' },  // a string, not a list
      { id: 'e2', date: '2025-12-06', to: [] },
      { id: 'e3', date: '2025-12-07', to: ['b@x.example'] },
    ];
    const res = validateBackup(data);
    expect(res.data.docs[2025][0].emails.map((e) => e.id)).toEqual(['e3']);
  });

  it('repairs an emails log that is not a list, and leaves a missing one missing', () => {
    const data = backup();
    data.docs[2025][0].emails = 'nope';
    const res = validateBackup(data);
    expect(res.data.docs[2025][0].emails).toEqual([]);
    expect('emails' in res.data.docs[2026][0]).toBe(false);
  });

  it('keeps an explicit empty taxes list and a missing one distinct', () => {
    const data = backup();
    data.docs[2025][0].taxes = [];
    const res = validateBackup(data);
    expect(res.data.docs[2025][0].taxes).toEqual([]);
    expect('taxes' in res.data.docs[2026][0]).toBe(false);
  });

  it('repairs documents missing their arrays', () => {
    const data = backup();
    delete data.docs[2026][0].items;
    delete data.docs[2026][0].payments;
    const res = validateBackup(data);
    expect(res.data.docs[2026][0].items).toEqual([]);
    expect(res.data.docs[2026][0].payments).toEqual([]);
  });

  it('rejects a document without a usable issue date', () => {
    const data = backup();
    delete data.docs[2026][0].issueDate;
    const res = validateBackup(data);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/issue date/);
    expect(res.error).toContain('EST-0001');
  });

  it('rejects foreign, damaged, and future files', () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup([]).ok).toBe(false);
    expect(validateBackup({ app: 'accountant', version: 1 }).error).toMatch(/not an Invoicing backup/);
    expect(validateBackup({ app: 'invoicing' }).error).toMatch(/version/);
    expect(validateBackup({ app: 'invoicing', version: 99, settings: {} }).error).toMatch(/newer version/);
    expect(validateBackup({ app: 'invoicing', version: 1 }).error).toMatch(/no settings/);
    expect(validateBackup({ app: 'invoicing', version: 1, settings: {}, docs: [] }).ok).toBe(false);
    expect(validateBackup({ app: 'invoicing', version: 1, settings: {}, clients: 'nope' }).ok).toBe(false);
    expect(validateBackup({ app: 'invoicing', version: 1, settings: {}, docs: { later: [] } }).error)
      .toMatch(/unexpected year/);
    expect(validateBackup({ app: 'invoicing', version: 1, settings: {}, docs: { 2026: {} } }).ok).toBe(false);
  });

  it('accepts a backup of an empty account', () => {
    const res = validateBackup({ app: 'invoicing', version: 1, settings: {} });
    expect(res.ok).toBe(true);
    expect(res.counts).toMatchObject({ docs: 0, clients: 0, years: '' });
  });
});

  it('drops an attachment record whose path is not in the document’s own folder', () => {
    // The path is what Remove and the trash purge delete. A record naming a
    // year file, or another app's file, was adopted verbatim — and deleted
    // on the user's behalf thirty days after the document went to the trash.
    const data = backup();
    data.docs[2025][0].attachments = [
      { id: 'a1', name: 'timesheet.pdf', size: 120, path: 'invoicing-data/attachments/d1/a1-timesheet.pdf' },
      { id: 'a2', name: 'x', size: 1, path: 'invoicing-data/docs-2025.json' },
      { id: 'a3', name: 'x', size: 1, path: 'some-other-app/precious.json' },
      { id: 'a4', name: 'x', size: 1, path: 'invoicing-data/attachments/d1/../docs-2025.json' },
      { id: 'a5', name: 'x', size: 1, path: 'invoicing-data/attachments/d1/..' },
      { id: 'a6', name: 'x', size: 1, path: 'invoicing-data/attachments/other-doc/a6-x' },
    ];
    const res = validateBackup(data);
    expect(res.ok).toBe(true);
    expect(res.data.docs[2025][0].attachments.map((a) => a.id)).toEqual(['a1']);
  });

  it('drops junk from the default taxes, which three views map over at render', () => {
    const data = backup();
    data.settings.taxes = [null, 'nope', { label: 'VAT', rate: 20 }, 5];
    const res = validateBackup(data);
    expect(res.ok).toBe(true);
    expect(res.data.settings.taxes).toEqual([{ label: 'VAT', rate: 20 }]);
    const notAList = backup();
    notAList.settings.taxes = 'VAT';
    expect(validateBackup(notAList).data.settings.taxes).toEqual([]);
  });

describe('parseBackup', () => {
  it('reports unreadable files without inspecting them further', () => {
    expect(parseBackup('{oops').error).toMatch(/not valid JSON/);
    expect(parseBackup('').ok).toBe(false);
  });

  it('parses the text of a real export', () => {
    expect(parseBackup(JSON.stringify(backup())).ok).toBe(true);
  });
});

describe('restoreSummary', () => {
  it('reads as a sentence in singular and plural', () => {
    expect(restoreSummary({ docs: 1, clients: 1, recurring: 0, years: '2026' }))
      .toBe('1 document and 1 client from 2026');
    expect(restoreSummary({ docs: 12, clients: 3, recurring: 2, years: '2024–2026' }))
      .toBe('12 documents, 3 clients and 2 schedules from 2024–2026');
    expect(restoreSummary({ docs: 0, clients: 0, recurring: 0, years: '' }))
      .toBe('0 documents and 0 clients');
  });
});

describe('export → restore round trip', () => {
  it('puts every part of a backup back exactly as it was', async () => {
    const original = backup();
    const res = validateBackup(structuredClone(original));
    await store.importAll(res.data);
    expect(store.exportAll()).toEqual(original);
  });

  it('survives a second round trip through the store', async () => {
    await store.importAll(validateBackup(backup()).data);
    const exported = store.exportAll();
    const again = validateBackup(structuredClone(exported));
    expect(again.ok).toBe(true);
    await store.importAll(again.data);
    expect(store.exportAll()).toEqual(exported);
  });

  it('lands on disk where the next session reads it', async () => {
    await store.importAll(validateBackup(backup()).data);
    expect(JSON.parse(files.get('invoicing-data/docs-2025.json')).map((d) => d.number)).toEqual(['INV-0001']);
    expect(JSON.parse(kv.get('invc:years:v1'))).toEqual(['2026', '2025']);
    expect(JSON.parse(kv.get('invc:clients:v1'))).toHaveLength(1);
    // Per-client billing defaults have to survive the round trip.
    expect(JSON.parse(kv.get('invc:clients:v1'))[0]).toMatchObject({
      currency: 'EUR', paymentTermsDays: 30, taxRate: 0, notes: 'Net 30, wire only.',
    });
    expect(JSON.parse(kv.get('invc:settings:v1')).business.name).toBe('Aurora Studio');
    // A reload re-reads those indexes.
    await store.init();
    expect(store.docs().map((d) => d.number)).toEqual(['EST-0001', 'INV-0001']);
    expect(store.settings.business.name).toBe('Aurora Studio');
  });

  it('removes year files the restored dataset no longer covers', async () => {
    await store.importAll(validateBackup(backup()).data);
    expect(files.has('invoicing-data/docs-2025.json')).toBe(true);
    const thinner = backup();
    delete thinner.docs[2025];
    await store.importAll(validateBackup(thinner).data);
    expect(files.has('invoicing-data/docs-2025.json')).toBe(false);
    expect(store.docs().map((d) => d.number)).toEqual(['EST-0001']);
  });
});

describe('retireSharePages', () => {
  it('counts attachment deletion failures while still removing the pages', async () => {
    const tokens = ['abc123xyz789', 'def123xyz789'];
    for (const token of tokens) {
      files.set(`invoicing-data/public/${token}.html`, 'page');
      files.set(`invoicing-data/public/${token}/a1.pdf`, 'pdf');
    }
    const remove = puter.fs.delete;
    puter.fs.delete = async (path, options) => {
      if (path === `invoicing-data/public/${tokens[0]}`) throw new Error('deletion denied');
      return remove(path, options);
    };
    try {
      expect(await retireSharePages({ docs: () => [] }, tokens)).toBe(1);
      for (const token of tokens) expect(files.has(`invoicing-data/public/${token}.html`)).toBe(false);
      expect(files.has(`invoicing-data/public/${tokens[1]}/a1.pdf`)).toBe(false);
    } finally {
      puter.fs.delete = remove;
    }
  });

  it('takes a page and the files published beside it offline', async () => {
    // Un-sharing removes both; a restore has to do the same, or an
    // attachment stays downloadable at a URL somebody kept.
    const token = 'abc123xyz789';
    files.set(`invoicing-data/public/${token}.html`, '<html></html>');
    files.set(`invoicing-data/public/${token}/a1-timesheet.pdf`, 'pdf');
    files.set('invoicing-data/public/index.html', '<html></html>');

    const failed = await retireSharePages(store, [token]);
    expect(failed).toBe(0);
    expect(files.has(`invoicing-data/public/${token}.html`)).toBe(false);
    expect(files.has(`invoicing-data/public/${token}/a1-timesheet.pdf`)).toBe(false);
    // The site's own index is not a share page.
    expect(files.has('invoicing-data/public/index.html')).toBe(true);
  });

  it('ignores anything that is not a token', async () => {
    expect(await retireSharePages(store, ['../../etc/passwd', ''])).toBe(0);
  });
});
