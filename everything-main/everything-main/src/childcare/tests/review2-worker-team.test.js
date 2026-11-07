/**
 * Regression tests from the second adversarial review of src/team.js: worker
 * updates and turning staff and family access on.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { updateWorkerIfNeeded } from '../src/team.js';

const bundle = (build) => `// childcare-team-worker build=${build}\nconst BUILD = '${build}';`;

function stubNetwork({ workerBuild, appBuild }) {
  const writes = [];
  vi.stubGlobal('fetch', async (url) => {
    if (String(url).endsWith('/health')) return new Response(JSON.stringify({ ok: true, build: workerBuild }));
    return new Response(bundle(appBuild));
  });
  vi.stubGlobal('puter', { fs: { write: async (path, blob) => writes.push([path, await blob.text()]) } });
  return writes;
}

afterEach(() => vi.unstubAllGlobals());

describe('team: worker updates', () => {
  const own = { url: 'https://childcare-abc.puter.work', path: '/director/childcare-team-worker.js' };

  it('updates an older worker to the build shipped with the app', async () => {
    const writes = stubNetwork({ workerBuild: '2', appBuild: '3' });
    expect(await updateWorkerIfNeeded(own)).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toContain('build=3');
  });

  it('never downgrades a newer worker from a stale copy of the app (another device, or a cached bundle)', async () => {
    const writes = stubNetwork({ workerBuild: '10', appBuild: '9' });
    expect(await updateWorkerIfNeeded(own)).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe('team: turning access on', () => {
  it('stops before creating the school server while changes are still unsent (they would never reach it)', async () => {
    const { createStore } = await import('../src/core/store.js');
    const { createMemoryBackend } = await import('../src/core/backend.js');
    const { enableTeam } = await import('../src/team.js');
    const backend = createMemoryBackend();
    const store = createStore({ backend, flushDelay: 60000, timeoutMs: 0 });
    await store.init();
    backend.setFailing(true);
    store.put('students', { firstName: 'Ava' });
    const create = vi.fn(async () => ({ url: 'https://childcare-x.puter.work' }));
    vi.stubGlobal('fetch', async (url) => new Response(String(url).endsWith('/health') ? JSON.stringify({ ok: true, build: '3' }) : bundle('3')));
    vi.stubGlobal('puter', { fs: { write: async () => ({ path: '/d/childcare-team-worker.js' }) }, workers: { create }, kv: { list: async () => [] } });
    await expect(enableTeam({ store })).rejects.toThrow(/not saved yet/);
    expect(create).not.toHaveBeenCalled();
    expect(store.pendingCount()).toBe(1);
  });
});
