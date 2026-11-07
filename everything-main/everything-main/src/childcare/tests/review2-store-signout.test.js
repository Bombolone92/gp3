/**
 * Second review: signing out forgets what this device kept for the person.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { createIdbCache } from '../src/core/cache.js';
import { tick } from './helpers.js';

function fileKeys() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('childcare-files');
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('blobs')) return resolve([]);
      const q = db.transaction('blobs').objectStore('blobs').getAllKeys();
      q.onsuccess = () => (db.close(), resolve(q.result));
      q.onerror = () => reject(q.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe('sign out', () => {
  it('removes the cached school data, unsent changes, files and profile picture of the person signing out', async () => {
    const snap = { v: 2, collections: { students: [{ id: 'k1', firstName: 'Ava', allergies: 'Peanuts' }] }, pending: { puts: [{ coll: 'students', id: 'k1' }], dels: [] } };
    await createIdbCache('user:u1').save(snap);
    await createIdbCache('user:u1:team:https://school-a.puter.work').save(snap);
    await createIdbCache('user:u2').save(snap);
    await createIdbCache('user:u10').save(snap);

    const { app } = await import('../src/app.js');
    const files = await import('../src/files.js');
    app.user = { username: 'director', uuid: 'u1' };
    await files.saveFile(new File(['a'], 'a.txt', { type: 'text/plain' }), { area: 'students', owner: 'k1' });
    app.user = { username: 'other', uuid: 'u2' };
    await files.saveFile(new File(['b'], 'b.txt', { type: 'text/plain' }), { area: 'students', owner: 'k9' });
    app.user = { username: 'director', uuid: 'u1' };
    await tick(20);

    const store = new Map([
      ['childcare.profilePicture', JSON.stringify({ user: 'director', url: 'data:image/png;base64,AA' })],
      ['childcare.workspaces:u1', JSON.stringify({ current: 'own', own: {}, joined: [] })],
    ]);
    globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    const puterSignOut = vi.fn();
    globalThis.puter = { auth: { signOut: puterSignOut } };
    try {
      const platform = await import('../src/platform.js');
      await platform.signOut('u1');
      expect(puterSignOut).toHaveBeenCalled();
      expect(await createIdbCache('user:u1').load()).toBeUndefined();
      expect(await createIdbCache('user:u1:team:https://school-a.puter.work').load()).toBeUndefined();
      expect(await createIdbCache('user:u2').load()).toBeTruthy();
      expect(await createIdbCache('user:u10').load()).toBeTruthy();
      const keys = await fileKeys();
      expect(keys.some((k) => k.startsWith('u1|'))).toBe(false);
      expect(keys.some((k) => k.startsWith('u2|'))).toBe(true);
      expect(platform.cachedProfilePicture('director')).toBeNull();
      expect(platform.cachedWorkspaces('u1')).toBeNull();
    } finally {
      delete globalThis.puter;
      delete globalThis.localStorage;
    }
  });
});
