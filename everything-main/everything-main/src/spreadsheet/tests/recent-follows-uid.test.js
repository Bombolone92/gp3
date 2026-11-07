import { beforeEach, expect, it, vi } from 'vitest';
import { memoryStorage } from './helpers/memory-storage.js';

const drive = vi.hoisted(() => ({ files: new Map(), offline: false }));
vi.mock('../src/lib/puter.js', () => ({
  inAppFolder: (path) => /^Spreadsheets\/[^/]+$/.test(path) || /^\/nj\/AppData\/app\/Spreadsheets\/[^/]+$/.test(path),
  inTrash: (path) => /^\/[^/]+\/Trash(\/|$)/.test(path),
  statByUid: async (uid) => {
    if (drive.offline) throw new Error('offline');
    return drive.files.get(uid) || null;
  },
}));

const { rememberRecent, recentFiles, refreshRecent } = await import('../src/lib/recent.js');

let storage;
beforeEach(() => { storage = memoryStorage(); drive.files.clear(); drive.offline = false; });

// A file opened from elsewhere and then moved or renamed (on the desktop, or by another app)
// was remembered at its old address only: the entry opened nothing and was forgotten.
it('lists a remembered file where the drive keeps it now after a move or rename', async () => {
  rememberRecent({ path: '/nj/Desktop/report.xlsx', uid: 'u1' }, undefined, storage);
  drive.files.set('u1', { path: '/nj/Documents/Q3 report.xlsx', name: 'Q3 report.xlsx' });
  const list = await refreshRecent(storage);
  expect(list).toEqual([expect.objectContaining({ path: '/nj/Documents/Q3 report.xlsx', name: 'Q3 report.xlsx', uid: 'u1' })]);
  expect(recentFiles(storage)).toEqual(list);
});

it('drops a remembered file that was deleted, put in the trash, or moved into the app folder', async () => {
  rememberRecent({ path: '/nj/Desktop/a.xlsx', uid: 'gone' }, undefined, storage);
  rememberRecent({ path: '/nj/Desktop/b.xlsx', uid: 'trashed' }, undefined, storage);
  rememberRecent({ path: '/nj/Desktop/c.xlsx', uid: 'home' }, undefined, storage);
  rememberRecent({ path: '/nj/Desktop/d.xlsx', uid: 'kept' }, undefined, storage);
  drive.files.set('trashed', { path: '/nj/Trash/b.xlsx', name: 'b.xlsx' });
  drive.files.set('home', { path: '/nj/AppData/app/Spreadsheets/c.xlsx', name: 'c.xlsx' });
  drive.files.set('kept', { path: '/nj/Desktop/d.xlsx', name: 'd.xlsx' });
  expect((await refreshRecent(storage)).map((r) => r.path)).toEqual(['/nj/Desktop/d.xlsx']);
});

it('leaves records alone when the drive cannot be asked, and those kept before ids were', async () => {
  rememberRecent('/nj/Desktop/old.xlsx', 'old.xlsx', storage);
  rememberRecent({ path: '/nj/Desktop/new.xlsx', uid: 'u2' }, undefined, storage);
  drive.offline = true;
  const before = recentFiles(storage);
  expect(await refreshRecent(storage)).toEqual(before);
});

it('keeps one entry per file however many addresses it was opened at', () => {
  rememberRecent({ path: '/nj/Desktop/report.xlsx', uid: 'u1' }, undefined, storage);
  rememberRecent({ path: '/nj/Documents/report.xlsx', uid: 'u1' }, undefined, storage);
  expect(recentFiles(storage).map((r) => r.path)).toEqual(['/nj/Documents/report.xlsx']);
  // Moved into the app folder, it is on the home screen's own list and leaves this one.
  rememberRecent({ path: 'Spreadsheets/report.xlsx', uid: 'u1' }, undefined, storage);
  expect(recentFiles(storage)).toEqual([]);
});

it('keeps an entry added while the drive was being asked', async () => {
  rememberRecent({ path: '/nj/Desktop/a.xlsx', uid: 'u1' }, undefined, storage);
  drive.files.set('u1', { path: '/nj/Desktop/a2.xlsx', name: 'a2.xlsx' });
  const pending = refreshRecent(storage);
  rememberRecent({ path: '/nj/Desktop/b.xlsx', uid: 'u3' }, undefined, storage);
  await pending;
  expect(recentFiles(storage).map((r) => r.path)).toEqual(['/nj/Desktop/b.xlsx', '/nj/Desktop/a2.xlsx']);
});
