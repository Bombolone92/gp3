// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { memoryStorage } from './helpers/memory-storage.js';

const SETTINGS_KEY = 'spreadsheet:settings:v1';
let session;
let getLocale;
let record; // the account's settings as the store holds them
let reachable;
let writes;

/** A fresh app instance (a reload): the modules start over, the browser's storage stays. */
async function load() {
  vi.resetModules();
  ({ session } = await import('../src/lib/session.js'));
  ({ getLocale } = await import('../src/core/format.js'));
  await session.init();
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  reachable = true;
  record = { theme: 'dark', locale: 'de-DE' };
  writes = [];
  vi.stubGlobal('puter', {
    auth: { isSignedIn: () => true, getUser: async () => ({ username: 'demo', uuid: 'u-1' }) },
    kv: {
      get: vi.fn(async () => { if (!reachable) throw new TypeError('Failed to fetch'); return record; }),
      set: vi.fn(async (key, value) => { if (!reachable) throw new TypeError('Failed to fetch'); record = value; writes.push(value); return true; }),
    },
  });
});
afterEach(() => { vi.unstubAllGlobals(); delete document.documentElement.dataset.theme; });

// A failed read of the account's settings at boot was taken for an empty record: the defaults replaced
// the theme and regional format (1,5 read as text for a de-DE user, dark flashed to light), and the next
// preference change wrote those defaults back over the record, erasing the other preferences for good.
it('keeps the settings last read when the record cannot be read at boot, and holds a change until it can be laid over the record', async () => {
  await load(); // online: the record is read and kept in this browser
  expect(session.settings).toMatchObject({ theme: 'dark', locale: 'de-DE' });
  expect(JSON.parse(localStorage.getItem(SETTINGS_KEY))).toMatchObject({ theme: 'dark', locale: 'de-DE' });
  expect(document.documentElement.dataset.theme).toBe('dark'); // as the pre-paint script leaves it on the next boot

  reachable = false;
  await load(); // offline
  expect(session.signedIn).toBe(true);
  expect(session.settings).toMatchObject({ theme: 'dark', locale: 'de-DE' });
  expect(getLocale()).toBe('de-DE');
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('spreadsheet:theme')).toBe('dark');

  // A choice made offline is kept in this browser, and nothing derived from defaults is written.
  await session.setTheme('light');
  expect(session.settings).toMatchObject({ theme: 'light', locale: 'de-DE' });
  expect(writes).toEqual([]);
  expect(JSON.parse(localStorage.getItem(SETTINGS_KEY))).toMatchObject({ theme: 'light', locale: 'de-DE' });

  // Once the store answers, the choices made meanwhile are laid over the record as it is.
  reachable = true;
  record = { theme: 'dark', locale: 'fr-FR' }; // changed on another device meanwhile
  await session.setLocale('en-GB');
  expect(writes).toEqual([{ theme: 'light', locale: 'en-GB' }]);
  expect(session.settings).toMatchObject({ theme: 'light', locale: 'en-GB' });
});

it('lays a change made once the store answers over the record as it is, not over the defaults', async () => {
  reachable = false;
  await load();
  reachable = true;
  await session.setTheme('light');
  expect(writes).toEqual([{ theme: 'light', locale: 'de-DE' }]);
  expect(session.settings).toMatchObject({ theme: 'light', locale: 'de-DE' });
  // Loaded now: the next change is written straight away.
  await session.setLocale('en-GB');
  expect(writes).toHaveLength(2);
  expect(writes[1]).toMatchObject({ theme: 'light', locale: 'en-GB' });
  expect(puter.kv.get).toHaveBeenCalledTimes(2);
});

it('still takes an account with no record for one with the defaults', async () => {
  record = null;
  await load();
  expect(session.settings).toEqual({ theme: 'system' });
  await session.setTheme('light');
  expect(writes).toEqual([{ theme: 'light' }]);
});
