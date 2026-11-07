// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';
import { Doc } from '../src/lib/doc.js';
import { session } from '../src/lib/session.js';
import { listDrafts, loadDraft } from '../src/lib/drafts.js';
import { storageScope, isAccountScope } from '../src/lib/account-storage.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  installMockPuter();
});
afterEach(() => {
  session.state = 'unknown';
  session.user = null;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete globalThis.puter;
});

// Signed in, but the identity look-up failed at boot: local records went under a random
// throwaway scope, and every draft written in that session was unreachable after a reload.
it('keeps asking who is signed in after a failed look-up, then moves the records kept meanwhile into the account', async () => {
  let failures = 2;
  puter.auth.getUser = vi.fn(async () => { if (failures-- > 0) throw new Error('Network request failed'); return { username: 'nariman', uuid: 'u-7' }; });
  await session.init();
  expect(session.signedIn).toBe(true);
  expect(isAccountScope(storageScope())).toBe(false);

  const doc = new Doc({ name: 'Plan', path: 'Spreadsheets/Plan.xlsx' });
  // This test follows unsaved drafts across an identity retry. A completed autosave correctly
  // removes that draft; whether SheetJS has loaded yet must not decide the test's outcome.
  vi.spyOn(doc, 'save').mockResolvedValue(false);
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'typed before the account was known');
  expect(doc.writeDraft()).toBe(true);
  const throwaway = doc.draftKey;

  await vi.advanceTimersByTimeAsync(2_000); // the first retry fails too
  expect(isAccountScope(storageScope())).toBe(false);
  await vi.advanceTimersByTimeAsync(4_000); // the next, after a longer wait, succeeds
  expect(storageScope()).toBe('uuid:u-7');
  expect(session.user?.username).toBe('nariman');
  expect(loadDraft(throwaway)).toBeNull();
  expect(doc.draftKey).toContain(encodeURIComponent('uuid:u-7'));
  expect(loadDraft(doc.draftKey)?.workbook.sheets[0].cells['0,0'].v).toBe('typed before the account was known');
  expect(listDrafts().map((d) => d.path)).toEqual(['Spreadsheets/Plan.xlsx']);

  // Drafting carries on under the account, and the retries stop.
  doc.wb.setInput(doc.wb.activeSheetId, 1, 0, 'after');
  expect(doc.writeDraft()).toBe(true);
  expect(listDrafts()).toHaveLength(1);
  const asked = puter.auth.getUser.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(puter.auth.getUser.mock.calls.length).toBe(asked);
  doc.destroy();
});

it('stops asking once signed out, and gives up after a while', async () => {
  puter.auth.getUser = vi.fn(async () => { throw new Error('Network request failed'); });
  await session.init();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(puter.auth.getUser.mock.calls.length).toBeGreaterThan(1);
  const asked = puter.auth.getUser.mock.calls.length;
  puter.auth.isSignedIn = () => false;
  await session.refresh();
  expect(session.signedOut).toBe(true);
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(puter.auth.getUser.mock.calls.length).toBe(asked);

  puter.auth.isSignedIn = () => true;
  await session.refresh();
  const before = puter.auth.getUser.mock.calls.length;
  await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
  const attempts = puter.auth.getUser.mock.calls.length - before;
  expect(attempts).toBeGreaterThan(3);
  expect(attempts).toBeLessThan(20);
});
