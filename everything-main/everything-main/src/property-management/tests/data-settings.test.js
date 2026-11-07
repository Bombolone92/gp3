// @vitest-environment jsdom
/** Settings > Data: restore and delete act on the whole account, not just this device's copy. */
import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { restoreBackup, deleteEverything } from '../src/views/settings/data.js';

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
});

async function twoDevices() {
  const backend = createMemoryBackend({ collections: { tenants: [{ id: 'old', firstName: 'Old' }] } });
  const here = createStore({ backend, flushDelay: 0, timeoutMs: 0 });
  const other = createStore({ backend, flushDelay: 0, timeoutMs: 0 });
  await here.init();
  await other.init();
  other.put('tenants', { id: 'other-device', firstName: 'Added elsewhere' });
  await other.flush();
  app.demo = false;
  app.store = here;
  return { backend, here };
}

describe('data settings', () => {
  it('replacing everything with a backup also replaces records added on another device', async () => {
    const { backend, here } = await twoDevices();
    const backup = { format: 'property-management-backup', version: 1, collections: { tenants: [{ id: 'restored', firstName: 'R' }] } };
    expect(await restoreBackup(backup, 'replace')).toBe(true);
    await here.flush();
    expect(backend.peek('tenants').map((t) => t.id)).toEqual(['restored']);
  });

  it('deleting all data also deletes records added on another device', async () => {
    const { backend, here } = await twoDevices();
    expect(await deleteEverything()).toBe(true);
    await here.flush();
    expect(backend.peek('tenants')).toEqual([]);
  });

  it('refuses when the account cannot be reached', async () => {
    const { backend, here } = await twoDevices();
    backend.setFailing(true);
    expect(await deleteEverything()).toBe(false);
    expect(here.all('tenants').map((t) => t.id)).toEqual(['old']);
  });
});
