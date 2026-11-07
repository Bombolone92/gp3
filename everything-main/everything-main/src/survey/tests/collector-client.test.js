import { describe, it, expect, vi } from 'vitest';
import { createCollectorClient, workerNameCandidates, labelOf, WORKER_CFG_KEY } from '../src/data/collector-client.js';
import { createLocalKv } from '../src/data/local-kv.js';
import { instantiateWorker } from '../src/data/local-worker.js';
import { buildWorkerSource, stripExports, WORKER_VERSION } from '../src/data/worker-source.js';

/** A fake Puter: fs.write keeps files, workers.create deploys the written
 *  source, and the returned fetch reaches deployed workers by URL. */
function fakePuter({ taken = [] } = {}) {
  const files = new Map();
  const deployed = new Map();
  const workerKv = createLocalKv();
  const fs = {
    write: vi.fn(async (path, content) => {
      files.set(path, content);
      for (const w of deployed.values()) if (w.path === path) w.instance = instantiateWorker(content, { kv: workerKv });
    }),
  };
  const workers = {
    create: vi.fn(async (name, path) => {
      if (taken.includes(name)) throw new Error('name taken');
      const url = `https://${name}.puter.work`;
      deployed.set(url, { name, path, instance: instantiateWorker(files.get(path), { kv: workerKv }) });
      return { url };
    }),
    get: vi.fn(async (name) => {
      for (const w of deployed.values()) if (w.name === name) return { file_path: w.path };
      return undefined;
    }),
    delete: vi.fn(async () => true),
  };
  const fetchFn = async (url, init) => {
    const u = new URL(url);
    const w = deployed.get(u.origin);
    if (!w) throw new TypeError('network');
    return w.instance.handle(url, init);
  };
  return { files, deployed, fs, workers, fetchFn, workerKv };
}

describe('worker source', () => {
  it('strips export keywords and fills placeholders', () => {
    expect(stripExports('export const A = 1;\nexport function f() {}\nexport async function g() {}')).toBe(
      'const A = 1;\nfunction f() {}\nasync function g() {}',
    );
    const src = buildWorkerSource('hash123');
    expect(src).toContain("const ADMIN_SECRET_HASH = 'hash123'");
    expect(src).toContain(`const WORKER_VERSION = '${WORKER_VERSION}'`);
    expect(src).not.toMatch(/^export /m);
    expect(src).toContain('function validateResponse');
  });
});

describe('worker names', () => {
  it('prefers the username, then suffixed, then random', () => {
    const names = workerNameCandidates('Ada.Lovelace');
    expect(names[0]).toBe('sv-ada-lovelace');
    expect(names[1]).toMatch(/^sv-ada-lovelace-[0-9a-f]{4}$/);
    expect(names[2]).toMatch(/^sv-x[0-9a-f]{10}$/);
    expect(workerNameCandidates('')).toHaveLength(1);
    expect(labelOf('sv-ada')).toBe('ada');
  });
});

describe('collector client', () => {
  function setup(opts) {
    const p = fakePuter(opts);
    const kv = createLocalKv();
    const client = createCollectorClient({
      kv,
      fs: p.fs,
      workers: p.workers,
      getUser: async () => ({ username: 'ada' }),
      fetchFn: p.fetchFn,
      verifyDelayMs: 1,
    });
    return { p, kv, client };
  }

  it('deploys once, saves its config, and verifies the live version', async () => {
    const { p, kv, client } = setup();
    const [a, b] = await Promise.all([client.ensureWorker(), client.ensureWorker()]);
    expect(a).toBe(b);
    expect(p.workers.create).toHaveBeenCalledTimes(1);
    const cfg = await kv.get(WORKER_CFG_KEY);
    expect(cfg).toMatchObject({ name: 'sv-ada', label: 'ada', url: 'https://sv-ada.puter.work', version: WORKER_VERSION });
    expect(cfg.secret).toMatch(/^[0-9a-f]{64}$/);
    // Only the hash is in the deployed source.
    expect(cfg.path).toMatch(/^collector-worker-[0-9a-f]{12}\.js$/);
    expect(p.files.get(cfg.path)).toContain('ADMIN_SECRET_HASH');
    expect(p.files.get(cfg.path)).not.toContain(cfg.secret);
  });

  it('leaves the worker another tab deployed meanwhile working', async () => {
    const { p, kv, client: a } = setup();
    // Tab B read the config just before tab A saved it.
    let first = true;
    const kvB = { ...kv, get: async (k) => (first && k === WORKER_CFG_KEY ? ((first = false), null) : kv.get(k)), set: kv.set };
    const b = createCollectorClient({ kv: kvB, fs: p.fs, workers: p.workers, getUser: async () => ({ username: 'ada' }), fetchFn: p.fetchFn, verifyDelayMs: 1 });
    const cfgA = await a.ensureWorker();
    const cfgB = await b.ensureWorker();
    expect(cfgB.name).toBe(cfgA.name);
    expect(p.workers.create).toHaveBeenCalledTimes(1);
    const survey = { id: 'stest000001', title: 'T', pages: [{ id: 'p1', questions: [] }], options: {}, theme: {} };
    await expect(a.publish(survey)).resolves.toBeTruthy();
    await expect(b.publish(survey)).resolves.toBeTruthy();
  });

  it('removes the source of a deploy that failed', async () => {
    const { p, client } = setup({ taken: ['sv-ada', 'sv-ada-0000', 'sv-ada-1111', 'sv-ada-2222'] });
    p.fs.delete = vi.fn(async (path) => p.files.delete(path));
    p.workers.create.mockImplementation(async () => {
      throw new Error('Please verify your email');
    });
    await expect(client.ensureWorker()).rejects.toMatchObject({ code: 'email_unverified' });
    expect([...p.files.keys()].filter((f) => f.startsWith('collector-worker'))).toEqual([]);
  });

  it('falls back to another name when the first is taken', async () => {
    const { client } = setup({ taken: ['sv-ada'] });
    const cfg = await client.ensureWorker();
    expect(cfg.name).toMatch(/^sv-ada-[0-9a-f]{4}$/);
  });

  it('reuses a deployed worker after a reload', async () => {
    const { p, kv, client } = setup();
    await client.ensureWorker();
    const again = createCollectorClient({ kv, fs: p.fs, workers: p.workers, fetchFn: p.fetchFn, verifyDelayMs: 1 });
    await again.ensureWorker();
    expect(p.workers.create).toHaveBeenCalledTimes(1);
  });

  it('upgrades an older worker in place', async () => {
    const { p, kv, client } = setup();
    await client.ensureWorker();
    const cfg = await kv.get(WORKER_CFG_KEY);
    await kv.set(WORKER_CFG_KEY, { ...cfg, version: '0' });
    const fresh = createCollectorClient({ kv, fs: p.fs, workers: p.workers, fetchFn: p.fetchFn, verifyDelayMs: 1 });
    await fresh.ensureWorker();
    expect(p.workers.create).toHaveBeenCalledTimes(1);
    expect(p.fs.write).toHaveBeenCalledTimes(2);
    expect((await kv.get(WORKER_CFG_KEY)).version).toBe(WORKER_VERSION);
  });

  it('publishes, collects and reads responses end to end', async () => {
    const { p, client } = setup();
    const survey = {
      id: 'stest000001',
      title: 'T',
      pages: [{ id: 'p1', questions: [{ id: 'q1', type: 'nps', title: 'Recommend?', required: true }] }],
      options: {},
      theme: {},
    };
    await client.publish(survey);
    await client.saveCollector({ id: 'col0000001', sid: survey.id, status: 'open' });
    const res = await p.fetchFn('https://sv-ada.puter.work/api/c/col0000001/responses', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ answers: { q1: 9 } }),
    });
    expect(res.status).toBe(200);
    const page = await client.responsesPage(survey.id);
    expect(page.items[0].value.answers).toEqual({ q1: 9 });
    expect((await client.stats()).surveys[survey.id]).toBe(1);
  });

  it('turns HTTP errors into WorkerErrors with the code', async () => {
    const { client } = setup();
    await expect(client.publish({ id: 'x' })).rejects.toMatchObject({ status: 400, code: 'bad_request' });
  });
});

describe('local demo backend', () => {
  it('deploys, upgrades and serves the collector in the page', async () => {
    const { createLocalBackend } = await import('../src/data/backend.js');
    const store = new Map();
    const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
    const backend = createLocalBackend(storage);
    const make = () =>
      createCollectorClient({ kv: backend.kv, fs: backend.fs, workers: backend.workers, getUser: backend.auth.getUser, fetchFn: backend.fetchWorker, verifyDelayMs: 1 });
    const client = make();
    const survey = { id: 'stest000001', title: 'T', pages: [{ id: 'p1', questions: [] }], options: {}, theme: {} };
    await client.publish(survey);
    // An older version upgrades in place, in the file the worker runs.
    const cfg = await backend.kv.get(WORKER_CFG_KEY);
    await backend.kv.set(WORKER_CFG_KEY, { ...cfg, version: '0' });
    await make().publish(survey);
    expect((await backend.kv.get(WORKER_CFG_KEY)).version).toBe(WORKER_VERSION);
  });
});


describe('local storage store', () => {
  /** localStorage with room for `limit` characters. */
  function smallStorage(limit) {
    const m = new Map();
    const used = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
    return {
      get length() {
        return m.size;
      },
      key: (i) => [...m.keys()][i] ?? null,
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem(k, v) {
        const before = m.get(k);
        m.set(k, String(v));
        if (used() > limit) {
          if (before == null) m.delete(k);
          else m.set(k, before);
          throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
        }
      },
      removeItem: (k) => m.delete(k),
    };
  }

  it('fails a write that does not fit, keeping the value before it', async () => {
    const kv = createLocalKv({ storage: smallStorage(200), namespace: 'n:' });
    await kv.set('a', { v: 1 });
    await expect(kv.set('a', { v: 'x'.repeat(300) })).rejects.toMatchObject({ code: 'storage_full' });
    await expect(kv.set('b', 'y'.repeat(300))).rejects.toMatchObject({ code: 'storage_full' });
    await expect(kv.update('a', { w: 'z'.repeat(300) })).rejects.toMatchObject({ code: 'storage_full' });
    expect(await kv.get('a')).toEqual({ v: 1 });
    expect(await kv.get('b')).toBeNull();
    expect(await kv.list('*')).toEqual(['a']);
  });
});
