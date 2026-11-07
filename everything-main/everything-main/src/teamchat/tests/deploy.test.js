/**
 * The app keeps an owner's worker on the build it ships, and only ever moves
 * it forward: the build id is a hash, so ordering comes from the build time.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { updateOwnWorker, resetBundleCache } from '../src/lib/deploy.js';

const worker = { url: 'https://teamchat-x.puter.work', path: '/me/teamchat-worker.js', name: 'teamchat-x' };
let writes;

function ship(banner) {
  globalThis.fetch = async () => new Response(`${banner}\nconsole.log(1);`, { status: 200 });
  globalThis.puter = {
    fs: { write: async (path) => { writes.push(path); return { path }; } },
    workers: { exec: async () => new Response(JSON.stringify({ ok: true, build: 'aaaaaaaaaaaa' }), { status: 200, headers: { 'Content-Type': 'application/json' } }) },
  };
}

beforeEach(() => {
  writes = [];
  resetBundleCache();
});

describe('updateOwnWorker', () => {
  it('leaves a worker alone that runs the shipped build', async () => {
    ship('/* teamchat-worker build=aaaaaaaaaaaa at=2000 */');
    expect(await updateOwnWorker(worker, 'aaaaaaaaaaaa', 2000)).toBeNull();
    expect(writes).toEqual([]);
  });

  it('brings an older worker up, including one from before builds were dated', async () => {
    ship('/* teamchat-worker build=aaaaaaaaaaaa at=2000 */');
    expect(await updateOwnWorker(worker, 'bbbbbbbbbbbb', 1000)).toBe('aaaaaaaaaaaa');
    expect(await updateOwnWorker(worker, 'bbbbbbbbbbbb', 0)).toBe('aaaaaaaaaaaa');
    expect(await updateOwnWorker(worker, 'bbbbbbbbbbbb')).toBe('aaaaaaaaaaaa');
    expect(writes).toHaveLength(3);
  });

  it('never puts an older build back over a newer worker (a device on a cached app)', async () => {
    ship('/* teamchat-worker build=aaaaaaaaaaaa at=2000 */');
    expect(await updateOwnWorker(worker, 'bbbbbbbbbbbb', 3000)).toBeNull();
    expect(writes).toEqual([]);
  });

  it('still updates from a bundle without a date (an app built before the stamp)', async () => {
    ship('/* teamchat-worker build=aaaaaaaaaaaa */');
    expect(await updateOwnWorker(worker, 'bbbbbbbbbbbb', 3000)).toBe('aaaaaaaaaaaa');
  });
});
