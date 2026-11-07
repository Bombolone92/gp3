import { beforeEach, describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { Store, StaleWriteError, CorruptDataError } from '../src/lib/store.js';
import { getKV } from '../src/lib/kv.js';
import { sharesOutstanding, fullyDiluted } from '../src/lib/captable.js';
import { puterBackend, deferred } from './helpers/puter-kv.js';

// Real Store + real conditional KV, with only the remote SDK replaced.
describe('concurrent saves through the complete persistence layer', () => {
  let backend;
  beforeEach(() => {
    backend = puterBackend();
    backend.install();
  });
  const reload = async () => { const s = new Store(); await s.init(); return s; };
  const key = (s, field) => `captable:${s.activeCompanyId}:${field}:v1`;

  async function fixture() {
    const a = await reload();
    const holder = await a.addStakeholder({ name: 'Founder', kind: 'founder' });
    const cls = await a.addClass({ name: 'Common', kind: 'common', authorized: 10_000 });
    const cert = await a.addSecurity({ kind: 'shares', stakeholderId: holder.id,
      classId: cls.id, quantity: 100, date: '2025-01-01', pricePerShare: 1 });
    const b = await reload();
    return { a, b, holder, cls, cert };
  }

  it('reproduces the original simultaneous stakeholder additions without a lost successful save', async () => {
    const a = await reload();
    const b = await reload();
    const results = await Promise.allSettled([
      a.addStakeholder({ name: 'From A' }), b.addStakeholder({ name: 'From B' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason).toBeInstanceOf(StaleWriteError);
    const winner = results[0].status === 'fulfilled' ? a : b;
    const loser = winner === a ? b : a;
    expect(winner.isStale).toBe(false);
    expect(loser.isStale).toBe(true);
    expect(loser.unsaved).toBe(false);
    expect((await reload()).stakeholders).toEqual(winner.stakeholders);
    // Reloading the losing session permits its next intentional edit.
    await loser.init();
    await loser.addStakeholder({ name: 'After reloading' });
    expect((await reload()).stakeholders).toHaveLength(2);
  });

  it('does not roll back another session that committed identical bytes', async () => {
    const { a, b, holder } = await fixture();
    const results = await Promise.allSettled([
      a.updateStakeholder(holder.id, { name: 'Same name' }),
      b.updateStakeholder(holder.id, { name: 'Same name' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await reload()).stakeholder(holder.id).name).toBe('Same name');
  });

  it('protects independent JavaScript processes sharing only the remote backend', async () => {
    await reload();
    const workers = [];
    const release = deferred();
    let uploading = 0;
    const session = () => {
      const worker = new Worker(new URL('./helpers/store-worker.js', import.meta.url));
      workers.push(worker);
      const ready = deferred();
      const result = deferred();
      const sdk = backend.client();
      worker.on('message', async (message) => {
        if (message.type === 'ready') ready.resolve();
        if (message.type === 'result' || message.type === 'failed') result.resolve(message);
        if (message.type !== 'kv') return;
        try {
          // Both sessions must have read the same predecessor before either
          // is allowed to publish. No global lock or shared module state.
          if (message.method === 'set' && message.args[0].includes(':stakeholders:v1:revision:')
            && message.args[0].endsWith(':value')) {
            if (++uploading === 2) release.resolve();
            await release.promise;
          }
          const value = await sdk[message.method](...message.args);
          worker.postMessage({ type: 'reply', request: message.request, value });
        } catch (err) {
          worker.postMessage({ type: 'reply', request: message.request, error: err.message });
        }
      });
      return { worker, ready: ready.promise, result: result.promise };
    };
    try {
      const a = session();
      const b = session();
      await Promise.all([a.ready, b.ready]);
      a.worker.postMessage({ type: 'save', name: 'Process A' });
      b.worker.postMessage({ type: 'save', name: 'Process B' });
      const results = await Promise.all([a.result, b.result]);
      expect(results.filter((r) => r.success)).toHaveLength(1);
      expect(results.find((r) => !r.success)).toMatchObject({ error: 'StaleWriteError', stale: true });
      expect((await reload()).stakeholders.map((h) => h.name)).toEqual([results.find((r) => r.success).name]);
    } finally {
      release.resolve();
      await Promise.all(workers.map((worker) => worker.terminate()));
    }
  });

  it('rolls back the other fields of an import while retaining the competing successful edit', async () => {
    const { a, b, holder } = await fixture();
    const started = deferred();
    const release = deferred();
    const add = puter.kv.add;
    let pause = true;
    puter.kv.add = async (k, v) => {
      if (k.startsWith(key(a, 'stakeholders')) && pause) {
        pause = false;
        started.resolve();
        await release.promise;
      }
      return add(k, v);
    };
    const imported = a.importRecords({
      stakeholders: [{ name: 'New hire' }],
      securities: [{ kind: 'option', stakeholderName: 'New hire', quantity: 10, grantDate: '2025-01-01' }],
    });
    const failed = expect(imported).rejects.toBeInstanceOf(StaleWriteError);
    await started.promise;
    await b.updateStakeholder(holder.id, { name: 'Confirmed winner' });
    release.resolve();
    await failed;
    const saved = await reload();
    expect(saved.stakeholders).toHaveLength(1);
    expect(saved.stakeholder(holder.id).name).toBe('Confirmed winner');
    expect(saved.securities).toHaveLength(1);
    expect(saved.recoveredHolders).toEqual([]);
    expect(a.unsaved).toBe(false);
  });

  it('merges simultaneous activity without marking either session stale', async () => {
    const { a, b } = await fixture();
    a.logActivity('From A');
    b.logActivity('From B');
    // A queued write waits for the best-effort log preceding it.
    await Promise.all([a.updateSettings({}), b.updateSettings({})]);
    expect(a.isStale || b.isStale).toBe(false);
    expect((await reload()).activity.map((entry) => entry.text).sort()).toEqual(['From A', 'From B']);
  });

  it('keeps distinct collections independently writable', async () => {
    const { a, b } = await fixture();
    await Promise.all([a.addStakeholder({ name: 'Investor' }), b.addClass({ name: 'Preferred', kind: 'preferred' })]);
    const saved = await reload();
    expect(saved.stakeholders).toHaveLength(2);
    expect(saved.classes).toHaveLength(2);
  });

  /* Two sessions, an unused class, and one of them about to issue into it.
     The issuance checks the stored classes before it applies and publishes
     the securities some round trips later; the delete checks the stored
     securities and publishes the classes. Each publication is conditional
     only on its own key, so paused between check and publish, either side
     used to land over the other's - both saves reporting success, neither
     session told, and the certificate dropped on the next load for want of
     its class. */
  async function unusedClass() {
    const a = await reload();
    const holder = await a.addStakeholder({ name: 'Founder', kind: 'founder' });
    const cls = await a.addClass({ name: 'Series Seed', kind: 'preferred' });
    const b = await reload();
    const issue = () => a.addSecurity({ kind: 'shares', stakeholderId: holder.id,
      classId: cls.id, quantity: 1_000_000, pricePerShare: 1, date: '2025-01-01' });
    /* Pause a session as it uploads the payload of a revision of one field -
       after every check it makes, before its append can be published. */
    const pauseUpload = (field) => {
      const paused = deferred();
      const release = deferred();
      const set = puter.kv.set;
      let once = true;
      puter.kv.set = async (k, v) => {
        if (once && k.startsWith(`${key(a, field)}:revision:`) && k.endsWith(':value')) {
          once = false;
          paused.resolve();
          await release.promise;
        }
        return set(k, v);
      };
      return { paused: paused.promise, release: () => release.resolve() };
    };
    return { a, b, cls, issue, pauseUpload };
  }

  it('refuses an issuance whose class was deleted between its check and its save', async () => {
    const { a, b, cls, issue, pauseUpload } = await unusedClass();
    const { paused, release } = pauseUpload('securities');
    const issuing = issue();
    await paused;
    await b.deleteClass(cls.id);
    release();
    await expect(issuing).rejects.toBeInstanceOf(StaleWriteError);
    expect(a.isStale).toBe(true);
    expect(b.isStale).toBe(false);
    // Undone in memory and in storage alike, with nothing left owed.
    expect(a.securities).toEqual([]);
    expect(a.unsaved).toBe(false);
    const saved = await reload();
    expect(saved.classes.map((c) => c.id)).not.toContain(cls.id);
    expect(saved.securities).toEqual([]);
    expect(saved.recoveredHolders).toEqual([]);
  });

  it('refuses a class delete that an issuance into the class overtook', async () => {
    const { a, b, cls, issue, pauseUpload } = await unusedClass();
    const { paused, release } = pauseUpload('classes');
    const deleting = b.deleteClass(cls.id);
    await paused;
    const cert = await issue();
    release();
    await expect(deleting).rejects.toBeInstanceOf(StaleWriteError);
    expect(b.isStale).toBe(true);
    expect(a.isStale).toBe(false);
    expect(b.classes.map((c) => c.id)).toContain(cls.id);
    expect(b.unsaved).toBe(false);
    const saved = await reload();
    expect(saved.classes.map((c) => c.id)).toContain(cls.id);
    expect(saved.security(cert.id)).toMatchObject({ classId: cls.id, quantity: 1_000_000 });
  });

  it('retains last-writer-wins theme and onboarding choices under overlap', async () => {
    const a = await reload();
    const b = await reload();
    await Promise.all([
      a.updateSettings({ theme: 'light', onboarded: true }),
      b.updateSettings({ theme: 'dark', onboarded: true }),
    ]);
    const saved = await reload();
    expect(['light', 'dark']).toContain(saved.settings.theme);
    expect(saved.settings.onboarded).toBe(true);
    expect(a.isStale || b.isStale).toBe(false);
  });

  it('does not overwrite the winning edit when a large collection finishes uploading late', async () => {
    const { a, b, holder } = await fixture();
    const large = Array.from({ length: 4000 }, (_, i) => ({
      id: `holder-${i}`, name: `Holder ${i} ${'x'.repeat(90)}`, kind: 'employee',
    }));
    await a.importAll({ ...a.exportAll(), stakeholders: [...a.stakeholders, ...large] });
    await b.init();
    const started = deferred();
    const release = deferred();
    const set = puter.kv.set;
    let pause = true;
    puter.kv.set = async (k, v) => {
      if (k.startsWith(key(a, 'stakeholders')) && k.includes(':part1') && pause) {
        pause = false;
        started.resolve();
        await release.promise;
      }
      return set(k, v);
    };
    const slow = a.updateStakeholder(holder.id, { name: 'Slow' });
    const failed = expect(slow).rejects.toBeInstanceOf(StaleWriteError);
    await started.promise;
    await b.updateStakeholder(holder.id, { name: 'Winner' });
    release.resolve();
    await failed;
    const saved = await reload();
    expect(saved.stakeholder(holder.id).name).toBe('Winner');
    expect(saved.stakeholders).toHaveLength(4001);
    const marker = JSON.parse(await getKV(key(a, 'stakeholders')));
    const parts = [...backend.values.keys()].filter((k) => k.startsWith(`${key(a, 'stakeholders')}:generation:`));
    expect(parts).toHaveLength(marker.__parts);
    expect(parts.every((k) => k.includes(`:generation:${marker.generation}:`))).toBe(true);
  });

  it('keeps all theme saves and activity additions successful during a burst of sessions', async () => {
    await reload();
    const sessions = await Promise.all(Array.from({ length: 12 }, reload));
    await Promise.all(sessions.map((s, i) => s.updateSettings({ theme: i % 2 ? 'dark' : 'light' })));
    for (const [i, s] of sessions.entries()) s.logActivity(`Session ${i}`);
    await Promise.all(sessions.map((s) => s.updateSettings({})));
    expect(sessions.every((s) => !s.isStale)).toBe(true);
    expect((await reload()).activity).toHaveLength(12);
  });

  it.each([false, true])('restores all collections after a failed multi-key commit (append landed=%s)', async (landed) => {
    const { a, holder } = await fixture();
    const before = JSON.stringify(a.exportAll().securities);
    const add = puter.kv.add;
    let fail = true;
    puter.kv.add = async (k, v) => {
      if (k.startsWith(key(a, 'securities')) && fail) {
        fail = false;
        if (landed) await add(k, v);
        throw new Error('lost connection');
      }
      return add(k, v);
    };
    await expect(a.deleteStakeholder(holder.id)).rejects.toThrow('lost connection');
    const saved = await reload();
    expect(saved.stakeholders).toHaveLength(1);
    expect(JSON.stringify(saved.securities)).toBe(before);
    expect(a.unsaved || a.isStale).toBe(false);
  });

  it('retries an owed rollback after the connection returns', async () => {
    const { a, holder } = await fixture();
    const add = puter.kv.add;
    let offline = false;
    puter.kv.add = async (k, v) => {
      if (offline) throw new Error('offline');
      const result = await add(k, v);
      if (k.startsWith(key(a, 'securities'))) {
        offline = true;
        throw new Error('lost acknowledgement');
      }
      return result;
    };
    await expect(a.deleteStakeholder(holder.id)).rejects.toThrow();
    expect(a.unsaved).toBe(true);
    puter.kv.add = add;
    expect(await a.retryUnsaved()).toBe(true);
    const saved = await reload();
    expect(saved.stakeholders).toHaveLength(1);
    expect(sharesOutstanding(saved.securities)).toBe(100);
  });

  it('round-trips exercises, transfers, splits, backups and restore points', async () => {
    const { a, holder, cls, cert } = await fixture();
    await a.resizePool({ size: 100, date: '2025-01-01' });
    const grant = await a.addSecurity({ kind: 'option', stakeholderId: holder.id,
      quantity: 40, strike: 1, grantDate: '2025-01-01', vestingMonths: 0 });
    await a.exerciseOption(grant.id, { quantity: 10, date: '2025-02-01', classId: cls.id });
    await a.transferShares(cert.id, { quantity: 25, date: '2025-03-01', to: { newHolder: { name: 'Buyer' } } });
    const fd = fullyDiluted(a.securities, a.company.poolAuthorized);
    await a.recordSplit({ num: 2, den: 1, date: '2025-04-01' });
    const saved = await reload();
    expect(sharesOutstanding(saved.securities)).toBe(220);
    expect(fullyDiluted(saved.securities, saved.company.poolAuthorized)).toBe(fd * 2);
    const backup = JSON.parse(JSON.stringify(saved.exportAll()));
    await saved.wipeAll();
    await saved.restoreFromPoint(saved.restorePoints[0].id);
    expect((await reload()).securities).toEqual(backup.securities);
    await saved.createCompany('Other');
    await saved.importAll(backup);
    const imported = await reload();
    expect(imported.securities).toEqual(backup.securities);
    await imported.deleteCompany(a.activeCompanyId);
    expect((await reload()).companies).toHaveLength(1);
    expect(await getKV(key(a, 'securities'))).toBeNull();
  });

  it('loads an existing v1 account without migrating or dropping its records', async () => {
    const initial = { id: 'legacy', label: 'Existing company', createdAt: 1 };
    backend.values.set('captable:companies:v1', JSON.stringify({ activeId: initial.id, companies: [initial] }));
    backend.values.set('captable:legacy:stakeholders:v1', '[{"id":"holder","name":"Existing holder","kind":"founder"}]');
    const a = await reload();
    const b = await reload();
    const results = await Promise.allSettled([a.addStakeholder({ name: 'A' }), b.addStakeholder({ name: 'B' })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const saved = await reload();
    expect(saved.stakeholder('holder').name).toBe('Existing holder');
    expect(saved.stakeholders).toHaveLength(2);
  });

  it('reports damaged revision data as corruption on startup', async () => {
    const { a } = await fixture();
    const head = JSON.parse(backend.values.get(key(a, 'securities')));
    backend.values.delete(`${key(a, 'securities')}:revision:${head.__captableRevision}:value`);
    await expect(reload()).rejects.toBeInstanceOf(CorruptDataError);
  });
});
