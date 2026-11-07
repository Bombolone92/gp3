import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/lib/store.js';
import { getKV } from '../src/lib/kv.js';
import { puterBackend } from './helpers/puter-kv.js';

// Real Store + real conditional KV, with only the remote SDK replaced: what a
// failed or misdirected write leaves behind in the user's storage.
describe('storage left behind by failed and misdirected writes', () => {
  let backend;
  beforeEach(() => {
    backend = puterBackend();
    backend.install();
  });
  const reload = async () => { const s = new Store(); await s.init(); return s; };
  const key = (s, field) => `captable:${s.activeCompanyId}:${field}:v1`;
  const generations = (k) => new Set([...backend.values.keys()]
    .filter((x) => x.startsWith(`${k}:generation:`))
    .map((x) => x.match(/generation:([^:]+)/)[1]));

  async function chunked() {
    const a = await reload();
    const holder = await a.addStakeholder({ name: 'Founder', kind: 'founder' });
    const large = Array.from({ length: 4000 }, (_, i) => ({
      id: `holder-${i}`, name: `Holder ${i} ${'x'.repeat(90)}`, kind: 'employee',
    }));
    await a.importAll({ ...a.exportAll(), stakeholders: [holder, ...large] });
    const k = key(a, 'stakeholders');
    expect(JSON.parse(await getKV(k)).__parts).toBeGreaterThan(1);
    return { a, holder, k };
  }

  it.each([false, true])('drops the parts of a chunked save whose marker upload failed (landed=%s)', async (landed) => {
    const { a, holder, k } = await chunked();
    const before = generations(k);
    expect(before.size).toBe(1);
    const set = puter.kv.set;
    puter.kv.set = async (x, v) => {
      if (x.startsWith(`${k}:revision:`) && x.endsWith(':value')) {
        puter.kv.set = set;
        if (landed) await set(x, v);
        throw new Error('offline');
      }
      return set(x, v);
    };
    await expect(a.updateStakeholder(holder.id, { name: 'Renamed' })).rejects.toThrow('offline');
    // Nothing was appended: the key holds what it held, nothing is owed to
    // it, and the generation the failed write uploaded could never be read.
    expect(a.unsaved).toBe(false);
    expect(generations(k)).toEqual(before);
    expect(a.stakeholder(holder.id).name).toBe('Founder');
    expect((await reload()).stakeholder(holder.id).name).toBe('Founder');
  });

  it('keeps the generation of a chunked save whose append landed with its acknowledgement lost', async () => {
    const { a, holder, k } = await chunked();
    const add = puter.kv.add;
    puter.kv.add = async (...args) => {
      if (!args[0].startsWith(k)) return add(...args);
      puter.kv.add = add;
      await add(...args);
      throw new Error('lost acknowledgement');
    };
    await expect(a.updateStakeholder(holder.id, { name: 'Renamed' })).rejects.toThrow('lost acknowledgement');
    // The append landed, so the rollback is owed and rewrites the old value.
    await a.retryUnsaved();
    expect(a.unsaved).toBe(false);
    /* Three generations were written: the original, the one the lost
       acknowledgement published over it, and the rewrite. Only the live one
       may stay - the original was dead the moment the append landed, which
       the rewrite's own read of the key was the first to see. */
    const marker = JSON.parse(await getKV(k));
    expect(generations(k)).toEqual(new Set([marker.generation]));
    expect((await reload()).stakeholder(holder.id).name).toBe('Founder');
  });

  it('reaps the generation of an append that never landed once another value has won, without rewriting it', async () => {
    const { a, holder, k } = await chunked();
    const before = generations(k);
    const live = JSON.parse(await getKV(k)).generation;
    const add = puter.kv.add;
    puter.kv.add = async (...args) => { if (!args[0].startsWith(k)) return add(...args); puter.kv.add = add; throw new Error('connection dropped'); };
    await expect(a.updateStakeholder(holder.id, { name: 'Renamed' })).rejects.toThrow('connection dropped');
    /* Ambiguous to the writer, so the rollback is owed, and its own read of
       the key finds the value memory went back to already there, so nothing
       is rewritten. The uploaded generation stays for now: an unchanged head
       says the append has not landed, not that it never will. */
    expect(a.unsaved).toBe(false);
    expect(generations(k).size).toBe(before.size + 1);
    expect(JSON.parse(await getKV(k)).generation).toBe(live);
    expect((await reload()).stakeholder(holder.id).name).toBe('Founder');
    /* Once another value has won the key, whatever did not is dead: the
       next write's read of the key finds the winner current and takes the
       generation that never landed with the one it replaced. */
    await a.updateStakeholder(holder.id, { name: 'Again' });
    await a.updateStakeholder(holder.id, { name: 'Once more' });
    const marker = JSON.parse(await getKV(k));
    expect(generations(k)).toEqual(new Set([marker.generation]));
    expect((await reload()).stakeholder(holder.id).name).toBe('Once more');
  });

  it('survives an append the client gave up on that the server commits later', async () => {
    /* The classic lost acknowledgement, seen from the other side: add()
       rejects at the client and lands at the server moments later. Read in
       between, the key's unchanged head was taken as proof the append never
       landed and the new generation's parts were deleted - so the marker
       then landed pointing at parts that were gone, and the next load threw
       CorruptDataError over the whole account. */
    const { a, holder, k } = await chunked();
    const add = puter.kv.add;
    let landed;
    puter.kv.add = async (...args) => {
      if (!args[0].startsWith(k)) return add(...args);
      puter.kv.add = add;
      landed = new Promise((r) => setTimeout(() => add(...args).then(r), 30));
      throw new Error('request timed out');
    };
    await expect(a.updateStakeholder(holder.id, { name: 'Renamed' })).rejects.toThrow('request timed out');
    await a.retryUnsaved();
    expect(a.unsaved).toBe(false);
    await landed;
    const marker = JSON.parse(await getKV(k));
    expect(generations(k).has(marker.generation)).toBe(true);
    // Recovery fences the original revision: the timed-out append can no
    // longer resurrect a change the app reported as rolled back.
    expect((await reload()).stakeholder(holder.id).name).toBe('Founder');
    await a.updateStakeholder(holder.id, { name: 'After recovery' });
    expect((await reload()).stakeholder(holder.id).name).toBe('After recovery');
  });

  it('refuses a save into a company another tab deleted before any of its keys were written', async () => {
    /* No tombstone stands where the first save lands - a key never written
       is left alone by the delete - so the write used to succeed and leave
       live keys under a company the registry no longer names: gone on
       reload, the toast having said it was saved. The registry is asked on a
       key's first write instead. */
    const a = await reload();
    const doomed = a.activeCompanyId;
    const b = await reload();
    await b.createCompany('Other');
    await b.deleteCompany(doomed);
    await expect(a.addStakeholder({ name: 'Late', kind: 'founder' })).rejects.toThrow(/changed somewhere else/);
    expect(a.isStale).toBe(true);
    expect([...backend.values.keys()].filter((k) => k.startsWith(`captable:${doomed}:`) && k.endsWith(':value'))).toHaveLength(0);
  });

  it('keeps a company the registry must still name when deleting it fails after the switch', async () => {
    /* Deleting the company on screen switched to the survivor and dropped
       the company from the registry in one write. When the survivor's load
       then failed, and the connection refused the rewrite that put the
       pointer back, memory kept the company on screen under a stored
       registry that no longer named it: every later save landed on keys
       nothing would read again, and the next load opened the survivor with
       that data unreachable. The switch comes first now, and the company
       leaves the registry only once the survivor is loaded. */
    const a = await reload();
    const doomed = a.activeCompanyId;
    await a.updateCompany({ name: 'Doomed' });
    await a.addStakeholder({ name: 'Founder', kind: 'founder' });
    await a.createCompany('Survivor');
    await a.switchCompany(doomed);
    const kv = puter.kv;
    const live = { get: kv.get, set: kv.set, add: kv.add, del: kv.del };
    // The registry write lands; the connection dies right after it.
    let dead = false;
    kv.add = async (...args) => {
      const r = await live.add(...args);
      if (args[0].startsWith('captable:companies:v1:revision:')) dead = true;
      return r;
    };
    for (const m of ['get', 'set', 'del']) kv[m] = async (...args) => { if (dead) throw new Error(`offline ${m}`); return live[m](...args); };
    await expect(a.deleteCompany(doomed)).rejects.toThrow(/offline/);
    Object.assign(kv, live);
    // Memory still shows the company, and so does the stored registry.
    expect(a.activeCompanyId).toBe(doomed);
    expect(a.companies.map((c) => c.label)).toEqual(['Doomed', 'Survivor']);
    await a.addStakeholder({ name: 'Second', kind: 'employee' });
    const later = await reload();
    expect(later.companies.map((c) => c.label)).toEqual(['Doomed', 'Survivor']);
    // Read from storage: a switch by another session would write the registry under this one.
    expect(JSON.parse(await getKV(`captable:${doomed}:stakeholders:v1`)).map((h) => h.name)).toEqual(['Founder', 'Second']);
    // And the deletion still goes through once the connection is back.
    await a.deleteCompany(doomed);
    expect((await reload()).companies.map((c) => c.label)).toEqual(['Survivor']);
    expect([...backend.values.keys()].filter((k) => k.startsWith(`captable:${doomed}:`) && k.endsWith(':value'))).toHaveLength(0);
  });

  it('refuses the never-written and last-writer-wins keys of a deleted company too', async () => {
    const a = await reload();
    const doomed = a.activeCompanyId;
    await a.addStakeholder({ name: 'Founder', kind: 'founder' });
    const b = await reload();
    await b.createCompany('Other');
    await b.deleteCompany(doomed);
    // A collection this tab had never written, and a flag the stale guard does not hold.
    await expect(a.saveScenario({ name: 'Ghost', preMoney: 1e6, investment: 1e5 })).rejects.toThrow(/changed somewhere else/);
    await expect(a.updateSettings({ onboarded: true })).rejects.toThrow(/changed somewhere else/);
    expect([...backend.values.keys()].filter((k) => k.startsWith(`captable:${doomed}:`) && k.endsWith(':value'))).toHaveLength(0);
    // The account's own theme is not a company's, and still lands.
    await a.updateSettings({ theme: 'dark' });
    expect((await reload()).settings.theme).toBe('dark');
  });

  it('boots when the account-wide theme key holds a revision that cannot be read', async () => {
    /* The theme is read leniently - a damaged value is rebuilt from the
       default - but the default was then written back, and a write starts by
       reading the revision, which threw over the same damage and took the
       boot down with "check your connection" over a light-or-dark toggle. */
    const a = await reload();
    await a.addStakeholder({ name: 'Founder', kind: 'founder' });
    const theme = 'captable:settings:v1';
    const rev = JSON.parse(backend.values.get(theme)).__captableRevision;
    backend.values.delete(`${theme}:revision:${rev}:value`);
    const b = await reload();
    expect(b.settings.theme).toBe('system');
    expect(b.stakeholders.map((h) => h.name)).toEqual(['Founder']);
  });

  it.each([true, false])('drops an activity line whose company was deleted in another tab rather than recreating its key (log existed=%s)', async (logged) => {
    const a = await reload();
    const doomed = a.activeCompanyId;
    await a.addStakeholder({ name: 'Founder', kind: 'founder' });
    // With a log on file the deletion leaves a tombstone; without one, only the registry says the company is gone.
    if (logged) { a.logActivity('Founder added'); await new Promise((r) => setTimeout(r, 20)); }
    const b = await reload();
    expect(b.activeCompanyId).toBe(doomed);
    await a.createCompany('Other');
    await a.deleteCompany(doomed);
    const under = () => [...backend.values.keys()].filter((x) => x.startsWith(`captable:${doomed}:`) && x.endsWith(':value'));
    expect(under()).toHaveLength(0);
    b.logActivity('late line');
    await new Promise((r) => setTimeout(r, 50));
    expect(under()).toHaveLength(0);
    // The tab's data saves are refused, as they were.
    await expect(b.addStakeholder({ name: 'Late' })).rejects.toThrow(/changed somewhere else/);
    expect(b.isStale).toBe(true);
    const fresh = await reload();
    expect(fresh.companies.map((c) => c.label)).toEqual(['Other']);
  });

  it('does not refuse a wipe or import because another tab only logged activity', async () => {
    const a = await reload();
    await a.addStakeholder({ name: 'Founder', kind: 'founder' });
    const b = await reload();
    b.logActivity('a line about nothing in particular');
    await new Promise((r) => setTimeout(r, 30));
    await a.importAll({ ...a.exportAll(), activity: [{ id: 'x', at: 1, text: 'from the file', icon: 'activity' }] });
    expect(a.isStale).toBe(false);
    expect((await reload()).activity.map((l) => l.text)).toEqual(['from the file']);
    // A real change to the data in the other tab still refuses the replacement.
    const c = await reload();
    await b.init();
    await b.addStakeholder({ name: 'Second', kind: 'employee' });
    await expect(c.wipeAll()).rejects.toThrow(/changed somewhere else/);
    expect(c.isStale).toBe(true);
  });

  it('takes every unresolved generation of a deleted company with it', async () => {
    const { a, holder, k } = await chunked();
    const add = puter.kv.add;
    const get = puter.kv.get;
    puter.kv.add = async (...args) => {
      if (!args[0].startsWith(k)) return add(...args);
      puter.kv.add = add;
      // The connection stays down for the rollback's read too, so nothing resolves.
      puter.kv.get = async (x) => { if (x.startsWith(k)) { puter.kv.get = get; throw new Error('offline'); } return get(x); };
      throw new Error('connection dropped');
    };
    await expect(a.updateStakeholder(holder.id, { name: 'Renamed' })).rejects.toThrow('connection dropped');
    expect(a.unsaved).toBe(true);
    expect(generations(k).size).toBe(2);
    const doomed = a.activeCompanyId;
    await a.createCompany('Other');
    await a.deleteCompany(doomed);
    expect([...backend.values.keys()].filter((x) => x.startsWith(`${k}:generation:`))).toHaveLength(0);
    expect(a.unsaved).toBe(false);
  });
});
