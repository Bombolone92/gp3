import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/lib/store.js';
import { AuditJournal, auditActionLabel, auditChanges, auditCSV, pruneProvenance } from '../src/lib/audit.js';
import { readKV, compareAndSetKV } from '../src/lib/kv.js';
import { fullyDiluted, dbAsOf, modelRound } from '../src/lib/captable.js';
import { puterBackend, deferred } from './helpers/puter-kv.js';

let backend;
beforeEach(() => { backend = puterBackend(); backend.install(); });
const reload = async () => { const s = new Store(); await s.init(); return s; };
async function fixture() {
  const s = await reload();
  const holder = await s.addStakeholder({ name: 'Founder', kind: 'founder' });
  const cls = await s.addClass({ name: 'Common', authorized: 1_000_000 });
  const sec = await s.addSecurity({ kind: 'shares', stakeholderId: holder.id, classId: cls.id,
    quantity: 10_000, pricePerShare: 1, date: '2024-01-01' });
  return { s, holder, cls, sec, journal: new AuditJournal(s.activeCompanyId) };
}
async function interrupted(s, fields, after) {
  const journal = new AuditJournal(s.activeCompanyId);
  const before = Object.fromEntries(fields.map((field) => [field, s[field]]));
  const writes = await Promise.all(fields.map(async (field) => {
    const key = `captable:${s.activeCompanyId}:${field}:v1`;
    return { field, key, before: before[field], expected: await readKV(key), revision: crypto.randomUUID() };
  }));
  const event = await journal.prepare({ before, after, operation: 'test-interruption', actor: { id: 'test', name: 'test' }, writes });
  return { journal, event, publish: (index) => compareAndSetKV(writes[index].key, writes[index].expected,
    JSON.stringify(after[writes[index].field]), { revision: writes[index].revision }) };
}

describe('permanent audit records', () => {
  it('retains more than 60 changes through reload and company switches, with bounded pages', async () => {
    const { s, holder } = await fixture();
    for (let i = 0; i < 75; i++) await s.updateStakeholder(holder.id, { name: `Founder ${i}` });
    const id = s.activeCompanyId;
    await s.createCompany('Other');
    expect((await s.exportAudit()).events).toHaveLength(0);
    await s.switchCompany(id);
    const fresh = await reload();
    backend.calls.length = 0;
    const first = await fresh.auditPage({ limit: 10 });
    expect(first.entries).toHaveLength(10);
    expect(first.cursor).toBeTruthy();
    expect(backend.calls.filter((c) => c.key.endsWith(':blob'))).toHaveLength(0);
    expect(backend.calls.filter((c) => /:part:\d+$/.test(c.key))).toHaveLength(0);
    const archive = await fresh.exportAudit();
    expect(archive.events).toHaveLength(79);
    expect(new Set(archive.events.map((e) => e.id)).size).toBe(79);
    expect(archive.events.every((e) => e.outcome.status === 'completed')).toBe(true);
    const last = archive.events[0];
    expect(last).toMatchObject({ version: 1, companyId: id, actor: { id: 'test', name: 'test' }, operation: 'updateStakeholder' });
    expect(last.changes[0]).toMatchObject({ before: { name: 'Founder 73' }, after: { name: 'Founder 74' } });
  });

  it('filters by record, holder, action, actor, recording date and transaction without dropping pagination', async () => {
    const { s, holder, sec } = await fixture();
    await s.updateSecurity(sec.id, { quantity: 12_000, auditReason: 'Correct the approved grant size' });
    const archive = await s.exportAudit(), latest = archive.events[0];
    expect(latest.explanation).toBe('Correct the approved grant size');
    expect(latest.effectiveDate).toBeNull();
    const date = latest.recordedAt.slice(0, 10);
    const page = await s.auditPage({ record: holder.id, operation: 'updateSecurity', actor: 'test', from: date, to: date, transaction: latest.id });
    expect(page.entries.map((e) => e.id)).toEqual([latest.id]);
    expect((await s.auditPage({ record: 'not-a-record' })).entries).toEqual([]);
    expect((await s.auditPage({ from: '9999-01-01' })).entries).toEqual([]);
    expect((await s.auditPage({ cursor: null })).entries).toEqual([]);
    const csv = auditCSV(archive);
    expect(csv).toContain('Correct the approved grant size');
    expect(csv).toContain('Transaction ID');
    expect(csv).toContain(latest.id);
    expect(s.security(sec.id)).not.toHaveProperty('auditReason');
  });

  it('keeps deleted records and undo as separate transactions', async () => {
    const { s, sec } = await fixture();
    const removed = await s.deleteSecurity(sec.id);
    await removed.undo();
    const events = (await s.exportAudit()).events;
    expect(events[0].operation).toBe('undo.deleteSecurity');
    expect(events[1].changes[0]).toMatchObject({ action: 'delete', before: { id: sec.id }, after: null });
    expect(events[0].changes[0]).toMatchObject({ action: 'create', before: null, after: { id: sec.id } });
  });

  it('groups a transfer and a split while preserving economic and historical calculations', async () => {
    const { s, holder, sec } = await fixture();
    const buyer = await s.addStakeholder({ name: 'Buyer' });
    const before = fullyDiluted(s.securities, s.company.poolAuthorized);
    await s.transferShares(sec.id, { date: '2025-01-01', quantity: 1_000, pricePerShare: 1, to: { stakeholderId: buyer.id } });
    const transfer = (await s.exportAudit()).events[0];
    expect(transfer.changes.filter((c) => c.field === 'securities').length).toBeGreaterThanOrEqual(3);
    expect(new Set(transfer.changes.flatMap((c) => c.holderIds))).toEqual(new Set([holder.id, buyer.id]));
    expect(fullyDiluted(s.securities, s.company.poolAuthorized)).toBe(before);
    const historical = dbAsOf(s.db, '2024-06-01');
    await s.recordSplit({ num: 2, den: 1, date: '2025-06-01' });
    const split = (await s.exportAudit()).events[0];
    expect(split.changes.some((c) => c.field === 'company')).toBe(true);
    expect(split.changes.some((c) => c.field === 'securities')).toBe(true);
    expect(fullyDiluted(dbAsOf(s.db, '2024-06-01').securities, 0)).toBe(fullyDiluted(historical.securities, 0));
  });

  it('records an exercise as one event containing its grant and certificate', async () => {
    const { s, holder, cls } = await fixture();
    const grant = await s.addSecurity({ kind: 'option', stakeholderId: holder.id, quantity: 100, strike: 1, date: '2024-01-01' });
    await s.exerciseOption(grant.id, { quantity: 10, date: '2025-01-01', classId: cls.id });
    const event = (await s.exportAudit()).events[0];
    expect(event.operation).toBe('exerciseOption');
    expect(event.changes).toHaveLength(2);
    expect(event.changes.some((c) => c.after?.fromOptionId === grant.id)).toBe(true);
    expect(event.effectiveDate).toBe('2025-01-01');
  });

  it('records attachment metadata under the document action without retaining file contents', async () => {
    const { s, sec } = await fixture();
    puter.fs = { write: async () => {}, delete: async () => {} };
    await s.attachToSecurity(sec.id, { name: 'agreement.pdf', size: 123 });
    const event = (await s.exportAudit()).events[0];
    expect(event.operation).toBe('attachDocument');
    expect(event.changes[0].after.attachments[0]).toMatchObject({ name: 'agreement.pdf', size: 123 });
    expect(event.changes[0].before.attachments || []).toHaveLength(0);
  });

  it('records a round close as one event across investors, certificates, conversions and pool changes', async () => {
    const { s, holder } = await fixture();
    const safe = await s.addSecurity({ kind: 'safe', stakeholderId: holder.id, principal: 100, date: '2024-01-01' });
    const count = (await s.exportAudit()).events.length;
    await s.closeRound({ date: '2025-01-15', newClass: { name: 'Series A', kind: 'preferred', authorized: 10_000 },
      investors: [{ newHolder: { name: 'Investor', kind: 'investor' }, quantity: 100, pricePerShare: 2 }],
      conversions: [{ securityId: safe.id, quantity: 100, pricePerShare: 1 }], poolAuthorized: 500 });
    const archive = await s.exportAudit();
    expect(archive.events).toHaveLength(count + 1);
    const event = archive.events[0];
    expect(event.operation).toBe('closeRound');
    expect(event.effectiveDate).toBe('2025-01-15');
    expect(new Set(event.changes.map((c) => c.field))).toEqual(new Set(['company', 'classes', 'stakeholders', 'securities']));
    expect(event.changes.find((c) => c.recordId === safe.id).after.convertedAt).toBe('2025-01-15');
  });

  it('retains history through wipes, backup replacement and restores', async () => {
    const { s, sec } = await fixture();
    const backup = s.exportAll(), ids = (await s.exportAudit()).events.map((e) => e.id);
    const model = modelRound(s.db, { preMoney: 100_000, investment: 20_000, asOf: '2025-01-01' });
    await s.wipeAll();
    expect(s.securities).toHaveLength(0);
    expect((await s.exportAudit()).events.map((e) => e.id)).toEqual(expect.arrayContaining(ids));
    const point = s.restorePoints[0];
    await s.restoreFromPoint(point.id);
    expect(s.security(sec.id)).toBeTruthy();
    expect((await s.exportAudit()).events[0].source).toBe('restore');
    await s.importAll(backup);
    expect(modelRound(s.db, { preMoney: 100_000, investment: 20_000, asOf: '2025-01-01' })).toEqual(model);
    expect((await s.exportAudit()).events.map((e) => e.id)).toEqual(expect.arrayContaining(ids));
  });

  it('stores a legacy baseline without inventing prior actors and excludes appearance changes', async () => {
    const s = await reload();
    await s.updateSettings({ theme: 'dark' });
    expect((await s.exportAudit()).events).toEqual([]);
    const key = `captable:${s.activeCompanyId}:stakeholders:v1`;
    await compareAndSetKV(key, await readKV(key), JSON.stringify([{ id: 'legacy', name: 'Original', kind: 'founder' }]));
    await s.init();
    await s.updateStakeholder('legacy', { name: 'Current' });
    const baseline = (await s.exportAudit()).events.at(-1);
    expect(baseline).toMatchObject({ operation: 'baseline', source: 'migration', effectiveDate: null });
    expect(baseline.explanation).toContain('unknown');
    expect(baseline.changes.find((c) => c.recordId === 'legacy').after.name).toBe('Original');
  });

  it('chunks large audit payloads and detects damaged retained history', async () => {
    const { s, journal } = await fixture();
    const archive = s.exportAll();
    archive.stakeholders = Array.from({ length: 2_000 }, (_, i) => ({ id: `holder-${i}`, name: 'A'.repeat(100), kind: 'founder' }));
    archive.securities = [];
    await s.importAll(archive);
    const latest = (await s.auditPage({ limit: 1 })).entries[0];
    const event = await s.auditDetail(latest.id);
    expect(event.changes.length).toBeGreaterThan(2_000);
    const manifest = JSON.parse(backend.values.get(journal.key(latest.id, 'blob')));
    expect(manifest.parts).toBeGreaterThan(1);
    backend.values.set(journal.key(latest.id, 'blob:part:0'), 'altered');
    await expect(s.auditDetail(latest.id)).rejects.toThrow(/integrity/);
  });

  it('removes retained audit payloads on explicit company deletion', async () => {
    const { s, journal } = await fixture();
    const doomed = s.activeCompanyId;
    await s.createCompany('Other');
    await s.deleteCompany(doomed);
    expect([...backend.values.keys()].filter((k) => k.startsWith(journal.prefix) && /:blob$|:part:\d+$|:node$|:value$/.test(k))).toEqual([]);
    await expect(journal.page()).rejects.toThrow(/deleted/);
  });

  it('keeps the before-state only until the transaction is decided', async () => {
    const { s, holder, journal } = await fixture();
    for (let i = 0; i < 40; i++) await s.addStakeholder({ name: `Holder ${i}`, kind: 'employee' });
    const size = () => [...backend.values].filter(([k]) => k.startsWith(journal.prefix))
      .reduce((total, [, v]) => total + JSON.stringify(v).length, 0);
    const before = size();
    await s.updateStakeholder(holder.id, { name: 'Renamed' });
    const latest = (await s.auditPage({ limit: 1 })).entries[0];
    // The permanent record carries the changed record, not a copy of every holder.
    expect(size() - before).toBeLessThan(JSON.stringify(s.stakeholders).length);
    expect(await s.auditDetail(latest.id)).not.toHaveProperty('writes');
    expect([...backend.values.keys()].filter((k) => k.startsWith(journal.key(latest.id, 'intent')))).toEqual([]);
    // An unfinished one keeps its intent, and a load still recovers from it.
    const staged = await interrupted(s, ['stakeholders'], { stakeholders: [] });
    expect(backend.values.has(staged.journal.key(staged.event.id, 'intent'))).toBe(true);
    const fresh = await reload();
    expect(fresh.stakeholders).toHaveLength(41);
    expect(await fresh.retryUnsaved()).toBe(true);
    expect(backend.values.has(staged.journal.key(staged.event.id, 'intent'))).toBe(false);
    expect((await staged.journal.decision(staged.event.id)).value.status).toBe('rejected');
    expect((await reload()).stakeholders).toHaveLength(41);
  });

  it('finishes a company deletion, and its file cleanup, when the audit purge hits a transient failure', async () => {
    const { s, sec, journal } = await fixture();
    const files = new Map();
    puter.fs = { write: async (path, file) => files.set(path, file), delete: async (path) => files.delete(path) };
    await s.attachToSecurity(sec.id, { name: 'agreement.pdf', size: 123 });
    expect(files.size).toBe(1);
    const doomed = s.activeCompanyId;
    await s.createCompany('Other');
    const get = puter.kv.get;
    let failed = false;
    puter.kv.get = async (key) => {
      if (!failed && key.startsWith(journal.prefix) && key.endsWith(':node')) { failed = true; throw new Error('network blip'); }
      return get(key);
    };
    await s.deleteCompany(doomed);
    puter.kv.get = get;
    expect(s.companies.some((c) => c.id === doomed)).toBe(false);
    expect(files.size).toBe(0);
    await expect(journal.page()).rejects.toThrow(/deleted/);
  });

  it('carries imported history as provenance without replacing this company’s native history', async () => {
    const { s, holder } = await fixture();
    const backup = await s.exportBackup();
    await s.createCompany('Destination');
    const destination = s.activeCompanyId;
    await s.importAll(backup);
    const event = (await s.exportAudit()).events[0];
    expect(event.companyId).toBe(destination);
    expect(event.sourceArchive).toEqual(backup.auditArchive);
    expect(event.sourceArchive.companyId).not.toBe(destination);
    expect(s.stakeholder(holder.id)).toBeTruthy();
    const again = await s.exportBackup();
    expect(again.auditArchive.events[0].sourceArchive).toEqual(backup.auditArchive);
    const before = s.exportAll();
    await expect(s.importAll({ ...backup, auditArchive: { app: 'unrecognized' } })).rejects.toThrow(/not supported/);
    expect(s.securities).toEqual(before.securities);
  });

  it('keeps a backup importable across repeated export and import round trips', async () => {
    const { s } = await fixture();
    for (let i = 0; i < 6; i++) await s.updateStakeholder(s.stakeholders[0].id, { name: `Founder ${i}` });
    const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
    let backup = await s.exportBackup();
    const first = bytes(backup), native = backup.auditArchive.events.length;
    const nested = (archive) => archive.events.filter((e) => e.sourceArchive).length;
    for (let cycle = 1; cycle <= 8; cycle++) {
      await s.importAll(JSON.parse(JSON.stringify(backup)), { label: 'restore' });
      backup = await s.exportBackup();
      /* Before this, every cycle embedded the whole previous archive inside
         the import event and the backup doubled each time: nine cycles took
         the sample company past the 20 MB an import accepts. */
      expect(nested(backup.auditArchive)).toBe(0);
      expect(bytes(backup)).toBeLessThan(first * 2);
      expect(() => Store.prepareImport(backup)).not.toThrow();
    }
    expect(backup.auditArchive.events).toHaveLength(native + 8);
    const event = backup.auditArchive.events[0];
    expect(event.operation).toBe('importAll');
    expect(event.sourceArchive).toBeUndefined();
    expect(event.explanation).toBe(`${native + 7} events of the file’s history were already recorded in this company and are not repeated here.`);
  });

  it('keeps another company’s history as provenance but never this company’s own, at any depth', async () => {
    const { s, holder } = await fixture();
    const source = s.activeCompanyId;
    const fromSource = await s.exportBackup();
    await s.createCompany('Copy');
    const copy = s.activeCompanyId;
    await s.importAll(fromSource);
    await s.updateStakeholder(holder.id, { name: 'Renamed in the copy' });
    // Back into the original: the copy's own events are new here, the original's are not.
    const fromCopy = await s.exportBackup();
    expect(fromCopy.auditArchive.events[1].sourceArchive.events.every((e) => e.companyId === source)).toBe(true);
    await s.switchCompany(source);
    await s.importAll(fromCopy);
    const event = (await s.exportAudit()).events[0];
    expect(event.sourceArchive.companyId).toBe(copy);
    expect(event.sourceArchive.events.map((e) => e.operation)).toEqual(['updateStakeholder', 'importAll', 'baseline']);
    expect(event.sourceArchive.events.every((e) => e.companyId === copy)).toBe(true);
    // The copy's import event came with the original's archive nested inside it: pruned to nothing.
    expect(event.sourceArchive.events[1].sourceArchive.events).toEqual([]);
    const own = fromCopy.auditArchive.events[1].sourceArchive.events.length;
    expect(event.explanation).toBe(`${own} events of the file’s history were already recorded in this company and are not repeated here.`);
    expect(s.stakeholder(holder.id).name).toBe('Renamed in the copy');
  });

  it('prunes repeated events in favour of the copy nearest the top', () => {
    const id = () => crypto.randomUUID();
    const a = { id: id(), companyId: 'A', operation: 'addStakeholder' };
    const b = { id: id(), companyId: 'A', operation: 'importAll', sourceArchive: { app: 'captable-audit', version: 1, companyId: 'B', events: [
      { id: id(), companyId: 'B', operation: 'baseline' },
      { ...a, operation: 'nested copy of a' },
      { id: id(), companyId: 'C', operation: 'ours already' },
    ] } };
    const archive = { app: 'captable-audit', version: 1, companyId: 'A', events: [b, a, { ...a }] };
    const { archive: pruned, dropped } = pruneProvenance(archive, 'C');
    expect(pruned.events.map((e) => e.operation)).toEqual(['importAll', 'addStakeholder']);
    expect(pruned.events[0].sourceArchive.events.map((e) => e.operation)).toEqual(['baseline']);
    expect(dropped).toBe(3);
    expect(pruneProvenance(null, 'C')).toEqual({ archive: null, dropped: 0 });
    expect(pruneProvenance({ app: 'other' }, 'C').archive).toEqual({ app: 'other' });
    expect(pruneProvenance(archive, 'A').archive.events).toEqual([]);
  });

  it('chunks an oversized record index without dropping searchable IDs', async () => {
    const { s, journal } = await fixture();
    const changes = Array.from({ length: 12_000 }, (_, i) => ({ field: 'securities', recordId: crypto.randomUUID(),
      action: 'create', holderIds: [], effectiveDate: null, before: null, after: { quantity: i } }));
    const event = { version: 1, id: crypto.randomUUID(), companyId: s.activeCompanyId, recordedAt: new Date().toISOString(),
      operation: 'large-import', actor: { id: 'test' }, source: 'csv', changes, writes: [] };
    await journal.append(event);
    expect(JSON.parse(backend.values.get(journal.key(event.id, 'node'))).parts).toBeGreaterThan(1);
    expect((await s.auditPage({ record: changes.at(-1).recordId })).entries.map((e) => e.id)).toEqual([event.id]);
    expect((await s.auditDetail(event.id)).changes).toHaveLength(12_000);
  });
});

describe('durable decisions and recovery', () => {
  it.each([0, 1, 2])('recovers an interrupted two-collection operation after %i publications', async (count) => {
    const { s, holder, journal } = await fixture();
    const staged = await interrupted(s, ['stakeholders', 'securities'], { stakeholders: [], securities: [] });
    for (let i = 0; i < count; i++) await staged.publish(i);
    const fresh = await reload();
    expect(fresh.stakeholder(holder.id).name).toBe('Founder');
    expect(fresh.securities).toHaveLength(1);
    expect(fresh.unsaved).toBe(true);
    expect(await fresh.retryUnsaved()).toBe(true);
    const again = await reload();
    expect(again.stakeholder(holder.id).name).toBe('Founder');
    expect(again.securities).toHaveLength(1);
    expect((await journal.decision(staged.event.id)).value.status).toBe(count ? 'compensated' : 'rejected');
    if (count === 0) await expect(staged.publish(0)).rejects.toThrow();
    else await staged.publish(0); // Idempotent receipt for its earlier publication.
    expect((await reload()).stakeholder(holder.id).name).toBe('Founder');
  });

  it('does not undo another transaction which published identical bytes', async () => {
    const { s, holder } = await fixture();
    const after = s.stakeholders.map((h) => ({ ...h, name: 'Identical' }));
    const staged = await interrupted(s, ['stakeholders'], { stakeholders: after });
    await s.updateStakeholder(holder.id, { name: 'Identical' });
    const fresh = await reload();
    await fresh.retryUnsaved();
    expect((await reload()).stakeholder(holder.id).name).toBe('Identical');
    expect((await staged.journal.decision(staged.event.id)).value.status).toBe('rejected');
  });

  it('preserves a committed operation when only index cleanup was interrupted', async () => {
    const { s, holder } = await fixture();
    const staged = await interrupted(s, ['stakeholders'], { stakeholders: s.stakeholders.map((h) => ({ ...h, name: 'Committed' })) });
    await staged.publish(0);
    await staged.journal.decide(staged.event.id, 'pending', 'completed');
    const fresh = await reload();
    expect(fresh.stakeholder(holder.id).name).toBe('Committed');
    expect((await staged.journal.head()).value.pending).toEqual([]);
    expect((await fresh.exportAudit()).events.filter((e) => e.id === staged.event.id)).toHaveLength(1);
  });

  it('refreshes an observing session and its views when an in-flight transaction completes', async () => {
    const { s, holder } = await fixture();
    const staged = await interrupted(s, ['stakeholders'], { stakeholders: s.stakeholders.map((h) => ({ ...h, name: 'Completed elsewhere' })) });
    const observer = await reload();
    expect(observer.stakeholder(holder.id).name).toBe('Founder');
    await staged.publish(0);
    await staged.journal.complete(staged.event);
    let renders = 0;
    observer.addEventListener('change', () => { renders++; });
    expect(await observer.retryUnsaved({ recoverPending: false })).toBe(true);
    expect(observer.stakeholder(holder.id).name).toBe('Completed elsewhere');
    expect(renders).toBeGreaterThan(0);
  });

  it('blocks business publication when audit intent persistence fails', async () => {
    const { s, holder } = await fixture();
    const set = puter.kv.set;
    puter.kv.set = async (key, value) => {
      if (/:audit:v1:.*:part:0$/.test(key)) throw new Error('audit storage offline');
      return set(key, value);
    };
    await expect(s.updateStakeholder(holder.id, { name: 'Lost' })).rejects.toThrow('audit storage offline');
    puter.kv.set = set;
    expect((await reload()).stakeholder(holder.id).name).toBe('Founder');
  });

  it('compensates business writes if a completed decision cannot be published', async () => {
    const { s, holder } = await fixture();
    const set = puter.kv.set;
    let fail = true;
    puter.kv.set = async (key, value) => {
      if (fail && /:decision:revision:.*:value$/.test(key) && JSON.parse(value).status === 'completed') {
        fail = false; throw new Error('decision offline');
      }
      return set(key, value);
    };
    await expect(s.updateStakeholder(holder.id, { name: 'Not committed' })).rejects.toThrow('decision offline');
    expect((await reload()).stakeholder(holder.id).name).toBe('Founder');
    expect((await s.exportAudit()).events[0].outcome.status).toBe('compensated');
  });

  it('preserves a file when the completed attachment transaction loses all acknowledgements', async () => {
    const { s, sec } = await fixture();
    const files = new Map();
    puter.fs = { write: async (path, file) => files.set(path, file), delete: async (path) => files.delete(path) };
    const add = puter.kv.add, get = puter.kv.get;
    let fail = true;
    puter.kv.add = async (key, values) => {
      const valueKey = key.replace(/:revision:[^:]+:next$/, `:revision:${values[0].__captableRevision}:value`);
      const payload = JSON.parse(backend.values.get(valueKey) || 'null');
      const result = await add(key, values);
      if (fail && key.includes(':decision:') && payload?.status === 'completed') {
        fail = false;
        puter.kv.get = async () => { throw new Error('offline'); };
        throw new Error('lost acknowledgement');
      }
      return result;
    };
    await expect(s.attachToSecurity(sec.id, { name: 'agreement.pdf', size: 123 })).rejects.toThrow('offline');
    expect(s.unsaved).toBe(true);
    expect(files.size).toBe(1);
    puter.kv.get = get;
    expect(await s.retryUnsaved()).toBe(true);
    const attachment = s.security(sec.id).attachments[0];
    expect(files.has(attachment.path)).toBe(true);
    expect((await s.exportAudit()).events[0].outcome.status).toBe('completed');
  });

  it('reads a coherent before-state while another tab is publishing, without cancelling it', async () => {
    const { s, holder } = await fixture();
    const started = deferred(), release = deferred(), add = puter.kv.add;
    let pause = true;
    puter.kv.add = async (key, values) => {
      if (pause && key.startsWith(`captable:${s.activeCompanyId}:securities:v1:`)) {
        pause = false; started.resolve(); await release.promise;
      }
      return add(key, values);
    };
    const saving = s.deleteStakeholder(holder.id);
    await started.promise;
    try {
      const fresh = await reload();
      expect(fresh.stakeholder(holder.id).name).toBe('Founder');
      expect(fresh.securities).toHaveLength(1);
    } finally { release.resolve(); }
    await saving;
    const final = await reload();
    expect(final.stakeholders).toHaveLength(0);
    expect(final.securities).toHaveLength(0);
    expect((await final.exportAudit()).events[0].outcome.status).toBe('completed');
  });

  it('does not let another writer validate a class deletion against an uncommitted security deletion', async () => {
    const { s, cls } = await fixture();
    const other = await reload();
    const staged = await interrupted(s, ['securities'], { securities: [] });
    await staged.publish(0);
    await expect(other.deleteClass(cls.id)).rejects.toThrow(/changed somewhere else/);
    const fresh = await reload();
    await fresh.retryUnsaved();
    expect((await reload()).shareClass(cls.id)).toBeTruthy();
    expect((await reload()).securities).toHaveLength(1);
  });

  it('can write a previously absent collection after fencing an interrupted first publication', async () => {
    const s = await reload();
    const staged = await interrupted(s, ['stakeholders'], { stakeholders: [{ id: 'x', name: 'Interrupted' }] });
    const fresh = await reload();
    await fresh.retryUnsaved();
    await fresh.addStakeholder({ name: 'After recovery' });
    expect((await reload()).stakeholders.map((h) => h.name)).toEqual(['After recovery']);
    await expect(staged.publish(0)).rejects.toThrow();
  });

  it('automatic retry leaves an active writer alone; explicit recovery can fence it', async () => {
    const { s, holder } = await fixture();
    const staged = await interrupted(s, ['stakeholders'], { stakeholders: [] });
    const fresh = await reload();
    // Shown with the banner, but nothing here is lost by closing the tab.
    expect(fresh.unsaved).toBe(true);
    expect(fresh.owesStorage).toBe(false);
    expect(await fresh.retryUnsaved({ recoverPending: false })).toBe(false);
    expect((await staged.journal.decision(staged.event.id)).value.status).toBe('pending');
    expect(await fresh.retryUnsaved()).toBe(true);
    await expect(staged.publish(0)).rejects.toThrow();
    expect((await reload()).stakeholder(holder.id)).toBeTruthy();
  });

  it('tells a saver whose in-flight transaction another tab recovered that the cap table changed elsewhere', async () => {
    const { s, holder } = await fixture();
    const started = deferred(), release = deferred(), add = puter.kv.add;
    let armed = true;
    puter.kv.add = async (key, values) => {
      const result = await add(key, values);
      // The business publication has landed; hold the save before it completes.
      if (armed && key.startsWith(`captable:${s.activeCompanyId}:stakeholders:v1:`)) { armed = false; started.resolve(); await release.promise; }
      return result;
    };
    const saving = s.updateStakeholder(holder.id, { name: 'Renamed' });
    await started.promise;
    const other = await reload();
    expect(other.stakeholder(holder.id).name).toBe('Founder');
    expect(await other.retryUnsaved()).toBe(true);
    release.resolve();
    await expect(saving).rejects.toThrow(/changed somewhere else/);
    expect(s.isStale).toBe(true);
    expect(s.stakeholder(holder.id).name).toBe('Founder');
    expect((await reload()).stakeholder(holder.id).name).toBe('Founder');
  });

  it('cleans a racing append when deleting a company’s audit index', async () => {
    const { s, journal } = await fixture();
    const head = await journal.head();
    await journal.purge();
    await expect(compareAndSetKV(journal.prefix, head.expected, JSON.stringify(head.value))).rejects.toThrow();
    const event = { version: 1, id: crypto.randomUUID(), companyId: s.activeCompanyId,
      operation: 'late', recordedAt: new Date().toISOString(), changes: [], writes: [] };
    await expect(journal.append(event)).rejects.toThrow(/deleted/);
    expect(backend.values.has(journal.key(event.id, 'blob'))).toBe(false);
  });
});

describe('audit action labels', () => {
  it('reads an operation name as a sentence', () => {
    expect(auditActionLabel('updateStakeholder')).toBe('Update stakeholder');
    expect(auditActionLabel('importCSV')).toBe('Import from CSV');
    expect(auditActionLabel('settleRSU')).toBe('Settle RSU');
    expect(auditActionLabel('undo.deleteSecurity')).toBe('Undo: delete security');
    expect(auditActionLabel('restoreFromPoint')).toBe('Restore from snapshot');
    expect(auditActionLabel('baseline')).toBe('Initial baseline');
  });
});

describe('audit change extraction', () => {
  it('distinguishes effective dates from the time an ordinary edit is recorded', () => {
    const before = { securities: [{ id: 'a', date: '2020-01-01', quantity: 100 }] };
    expect(auditChanges(before, { securities: [{ ...before.securities[0], quantity: 120 }] })[0].effectiveDate).toBeNull();
    expect(auditChanges(before, { securities: [{ ...before.securities[0], date: '2021-01-01' }] })[0].effectiveDate).toBe('2021-01-01');
    expect(auditChanges(before, { securities: [{ ...before.securities[0], exerciseBy: '2027-01-01' }] })[0].effectiveDate).toBeNull();
  });
});
