import { describe, it, expect, vi, afterEach } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { createSearchIndex } from '../src/core/search.js';

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  return fn();
};

afterEach(() => vi.useRealTimers());

describe('sync engine', () => {
  it('sends a large import in batches small enough to finish before the request timeout', async () => {
    // Like Puter KV: writes go out 100 records to a request (20 ms each) and
    // deletions one by one (1 ms each). Anything over 150 ms times out.
    const backend = createMemoryBackend();
    const slow = (fn, ms) => async (name, list) => {
      await new Promise((r) => setTimeout(r, ms(list.length)));
      return fn(name, list);
    };
    backend.putRecords = slow(backend.putRecords.bind(backend), (n) => Math.ceil(n / 100) * 20);
    backend.deleteRecords = slow(backend.deleteRecords.bind(backend), (n) => n);
    const store = createStore({ backend, flushDelay: 0, timeoutMs: 150 });
    await store.init();
    const recs = store.bulkPut('activities', Array.from({ length: 2000 }, (_, i) => ({ description: `Entry ${i}` })));
    expect(await until(() => store.pendingCount() === 0, 8000)).toBe(true);
    expect(backend.peek('activities')).toHaveLength(2000);
    store.bulkRemove(
      'activities',
      recs.slice(0, 450).map((r) => r.id),
    );
    expect(await until(() => store.pendingCount() === 0, 8000)).toBe(true);
    expect(backend.peek('activities')).toHaveLength(1550);
  });

  it('bumps versions once per several hundred records written, not once per hundred', async () => {
    const backend = createMemoryBackend();
    let bumps = 0;
    const bump = backend.bumpVersions.bind(backend);
    backend.bumpVersions = (names) => (bumps++, bump(names));
    const store = createStore({ backend, flushDelay: 0 });
    await store.init();
    store.bulkPut('activities', Array.from({ length: 5000 }, (_, i) => ({ description: `Entry ${i}` })));
    expect(await until(() => store.pendingCount() === 0, 8000)).toBe(true);
    expect(backend.peek('activities')).toHaveLength(5000);
    expect(bumps).toBeLessThanOrEqual(10);
  });

  it('announces writes that landed even when another collection in the batch is rejected', async () => {
    const backend = createMemoryBackend();
    const put = backend.putRecords.bind(backend);
    let rejectTasks = false;
    backend.putRecords = async (name, list) => {
      if (rejectTasks && name === 'tasks') throw Object.assign(new Error('bad'), { status: 400 });
      return put(name, list);
    };
    const a = createStore({ backend, flushDelay: 0 });
    const b = createStore({ backend, flushDelay: 1e6 });
    await a.init();
    await b.init();
    const old = a.put('tasks', { name: 'Old task' });
    await a.flush();
    await b.sync();
    a.put('matters', { description: 'Estate plan' });
    a.put('tasks', { name: 'Rejected' });
    a.remove('tasks', old.id);
    rejectTasks = true;
    await a.flush();
    await until(() => a.pendingCount() === 0);
    await b.sync();
    expect(b.all('matters').map((m) => m.description)).toEqual(['Estate plan']);
    // Deleting a task is a separate request that was never refused.
    expect(backend.peek('tasks').map((t) => t.name)).toEqual([]);
    expect(b.all('tasks').map((t) => t.name)).toEqual([]);
  });

  it.each(['value_too_large', 'key_too_large', 'bad_request'])('drops a change Puter refuses with %s instead of retrying it forever', async (code) => {
    // Puter's KV rejects oversized values with a plain { message, code } and no HTTP status.
    const backend = createMemoryBackend();
    const put = backend.putRecords.bind(backend);
    backend.putRecords = async (name, list) => {
      if (name === 'notes') throw { message: 'Value size cannot be larger than 408576', code };
      return put(name, list);
    };
    const store = createStore({ backend, flushDelay: 0 });
    await store.init();
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.put('notes', { subject: 'x'.repeat(10) });
    store.put('tasks', { name: 'Call the court' });
    await store.flush();
    await until(() => store.pendingCount() === 0, 500);
    warn.mockRestore();
    expect(store.state.online).toBe(true);
    expect(store.pendingCount()).toBe(0);
    expect(store.state.error).toBeTruthy();
    expect(backend.peek('tasks').map((t) => t.name)).toEqual(['Call the court']);
  });

  it('clears "Some changes not saved" once a later change is saved', async () => {
    const backend = createMemoryBackend();
    const put = backend.putRecords.bind(backend);
    backend.putRecords = async (name, list) => {
      if (name === 'notes') throw { message: 'Value size cannot be larger than 408576', code: 'value_too_large' };
      return put(name, list);
    };
    const store = createStore({ backend, flushDelay: 0 });
    await store.init();
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.put('notes', { subject: 'x' });
    await store.flush();
    await until(() => store.pendingCount() === 0, 500);
    warn.mockRestore();
    expect(store.state.error).toBeTruthy();
    store.put('tasks', { name: 'Call the court' });
    await store.flush();
    await until(() => store.pendingCount() === 0, 500);
    expect(store.state.error).toBeNull();
  });

  it('sends waiting changes as soon as the connection is back, not after the retry delay', async () => {
    vi.useFakeTimers();
    const backend = createMemoryBackend();
    const store = createStore({ backend, flushDelay: 0 });
    await store.init();
    backend.setFailing(true);
    store.put('notes', { subject: 'Written offline' });
    // Fails at once, then again after 2, 4, 8 and 16 seconds: next retry in 32.
    await vi.advanceTimersByTimeAsync(30 + 2000 + 4000 + 8000 + 16000);
    expect(store.state.online).toBe(false);
    backend.setFailing(false);
    await store.sync(); // the browser's online event, or the tab regaining focus
    await vi.advanceTimersByTimeAsync(10);
    expect(backend.peek('notes')).toHaveLength(1);
    expect(store.pendingCount()).toBe(0);
    // The next hiccup starts over at the shortest delay.
    backend.setFailing(true);
    store.put('notes', { subject: 'Second' });
    await vi.advanceTimersByTimeAsync(10);
    backend.setFailing(false);
    await vi.advanceTimersByTimeAsync(2010);
    expect(backend.peek('notes')).toHaveLength(2);
  });

  it('shows the app as online again after a failed sync once the connection returns', async () => {
    vi.useFakeTimers();
    const backend = createMemoryBackend();
    const store = createStore({ backend, flushDelay: 0 });
    await store.init();
    backend.setFailing(true);
    await store.sync();
    expect(store.state.online).toBe(false);
    backend.setFailing(false);
    await vi.advanceTimersByTimeAsync(2010);
    expect(store.state.online).toBe(true);
  });

  it('records in the offline snapshot right away that queued changes reached the server', async () => {
    vi.useFakeTimers();
    let saved = null;
    const cache = { load: async () => saved, save: async (snap) => void (saved = structuredClone(snap)) };
    const backend = createMemoryBackend();
    const put = backend.putRecords.bind(backend);
    backend.putRecords = async (name, list) => {
      await new Promise((r) => setTimeout(r, 700));
      return put(name, list);
    };
    const a = createStore({ backend, cache, flushDelay: 0 });
    await a.init();
    const t = a.put('tasks', { name: 'Mine' });
    await vi.advanceTimersByTimeAsync(750);
    expect(a.pendingCount()).toBe(0); // no unsaved changes, so closing the tab does not warn
    const atClose = saved;
    backend.putRecords = put;
    // Later, a colleague edits the same task.
    const b = createStore({ backend, flushDelay: 0 });
    await b.init();
    b.patch('tasks', t.id, { name: 'Theirs' });
    await b.flush();
    // Reopening the first tab must not send its old copy again.
    const reopened = createStore({ backend, cache: { load: async () => atClose, save: async () => {} }, flushDelay: 0 });
    await reopened.init();
    await vi.advanceTimersByTimeAsync(100);
    expect(backend.peek('tasks')[0].name).toBe('Theirs');
    expect(reopened.get('tasks', t.id).name).toBe('Theirs');
  });

  it('forgets the offline copy of the firm on sign out', async () => {
    vi.useFakeTimers();
    let saved = null;
    const cache = { load: async () => saved, save: async (snap) => void (saved = structuredClone(snap)), clear: async () => void (saved = null) };
    const backend = createMemoryBackend();
    const store = createStore({ backend, cache, flushDelay: 0 });
    await store.init();
    backend.setFailing(true);
    store.put('contacts', { type: 'person', firstName: 'Confidential' });
    await vi.advanceTimersByTimeAsync(700);
    expect(saved.collections.contacts).toHaveLength(1);
    await store.clearCache();
    expect(saved).toBeNull();
    // Later retries and changes must not write it back.
    store.put('contacts', { type: 'person', firstName: 'Another' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(saved).toBeNull();
  });

  it('keeps a colleague’s settings change when saving settings on a device that has not synced yet', async () => {
    const backend = createMemoryBackend();
    const a = createStore({ backend, flushDelay: 0 });
    const b = createStore({ backend, flushDelay: 0 });
    await a.init();
    await b.init();
    a.saveSettings({ billing: { termsDays: 15 } });
    await a.flush();
    b.saveSettings({ firm: { name: 'Hartley Law' } });
    await b.flush();
    await until(() => !b.state.syncing && b.pendingCount() === 0);
    await a.sync();
    for (const s of [a.state.settings, b.state.settings, await backend.loadSettings()]) {
      expect(s.billing.termsDays).toBe(15);
      expect(s.firm.name).toBe('Hartley Law');
    }
  });

  it('keeps unsent settings changes from the offline copy when a colleague changed settings meanwhile', async () => {
    let saved = null;
    const cache = { load: async () => saved, save: async (snap) => void (saved = structuredClone(snap)) };
    const backend = createMemoryBackend();
    const a = createStore({ backend, cache, flushDelay: 1e6 });
    await a.init();
    a.saveSettings({ billing: { termsDays: 15 } });
    await new Promise((r) => setTimeout(r, 700)); // snapshot saved with the unsent change
    const b = createStore({ backend, flushDelay: 0 });
    await b.init();
    b.saveSettings({ firm: { name: 'Hartley Law' } });
    await b.flush();
    const reopened = createStore({ backend, cache, flushDelay: 0 });
    await reopened.init();
    await until(() => !reopened.state.syncing && reopened.pendingCount() === 0);
    const s = await backend.loadSettings();
    expect(s.billing.termsDays).toBe(15);
    expect(s.firm.name).toBe('Hartley Law');
  });
});

describe('global search', () => {
  it('finds matters and bills by their client’s current name after the contact is renamed', async () => {
    const store = createStore({ backend: createMemoryBackend(), flushDelay: 1e6 });
    await store.init();
    const c = store.put('contacts', { type: 'person', firstName: 'Amara', lastName: 'Lopez' });
    const m = store.put('matters', { description: 'Estate plan', clientId: c.id, displayNumber: '00001-Lopez' });
    store.put('bills', { number: 7, matterId: m.id, clientId: c.id });
    const search = createSearchIndex(store);
    const total = (q, label) => search(q).find((g) => g.label === label)?.total || 0;
    expect(total('Amara', 'Matters')).toBe(1);
    store.patch('contacts', c.id, { firstName: 'Amelia' });
    expect(total('Amelia', 'Matters')).toBe(1);
    expect(total('Amelia', 'Bills')).toBe(1);
    expect(total('Amara', 'Matters')).toBe(0);
    store.patch('matters', m.id, { displayNumber: '00002-Lopez' });
    expect(total('00002', 'Bills')).toBe(1);
  });
});
