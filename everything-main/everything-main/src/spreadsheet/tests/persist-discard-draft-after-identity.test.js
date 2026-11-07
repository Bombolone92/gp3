// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';
import { Doc } from '../src/lib/doc.js';
import { session } from '../src/lib/session.js';
import { listDrafts, loadDraft } from '../src/lib/drafts.js';
import { storageScope } from '../src/lib/account-storage.js';

// jsdom's Blob has no arrayBuffer(); reading a file back needs one.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(this); });
  };
}

// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => {
  globalThis.localStorage = memoryStorage();
  installMockPuter();
  // Signed in, but the look-up of who is signed in fails at boot: records go under a throwaway scope.
  puter.auth = { isSignedIn: () => true, signIn: async () => true, getUser: async () => puter._user };
  puter._user = null;
});
afterEach(() => { session.state = 'unknown'; session.user = null; vi.restoreAllMocks(); delete globalThis.puter; });

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const text = (draft) => draft?.workbook.sheets[0].cells['0,0'].v;

/** Budget.xlsx saved under the throwaway scope, with later edits drafted here that never reached Puter. */
async function fileWithDraft() {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'saved');
  await doc.rename('Budget');
  expect(await doc.save()).toBe(true);
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'offline edits');
  expect(doc.writeDraft()).toBe(true);
  doc.destroy();
  return doc.path;
}

// The account's identity, unknown at boot, resolves mid-session and every record this browser kept
// moves into the account — but the key of a draft already on offer stayed at the old, now empty
// address, so "Discard" cleared nothing and the next open offered the discarded draft again.
it('discards a draft offered before the account resolved, once and for good', async () => {
  await session.refresh();
  expect(storageScope()).toMatch(/^session:/);
  const path = await fileWithDraft();
  const doc = await Doc.fromPath(path);
  expect(text(doc.recoverable)).toBe('offline edits');

  puter._user = { username: 'nariman', uuid: 'u-1' };
  session._retryIdentity(0); // the look-up the session retries on its own, without the wait
  await settle();
  expect(storageScope()).toBe('uuid:u-1');
  expect(doc._recoverableKey).toBe(doc.draftKey);

  doc.discardDraft();
  expect(listDrafts()).toEqual([]);
  doc.destroy();
  const again = await Doc.fromPath(path);
  try { expect(again.recoverable).toBeNull(); } finally { again.destroy(); }
});

// The same move must not lose the edits of a draft the user keeps: restoring it still works, and the
// document goes on drafting under the account.
it('restores a draft offered before the account resolved, and drafts under the account after', async () => {
  await session.refresh();
  const path = await fileWithDraft();
  const doc = await Doc.fromPath(path);
  puter._user = { username: 'nariman', uuid: 'u-1' };
  session._retryIdentity(0);
  await settle();
  try {
    expect(doc.restoreDraft()).toBe(true);
    expect(doc.wb.getValue(doc.wb.activeSheetId, 0, 0)).toBe('offline edits');
    expect(doc.writeDraft()).toBe(true);
    expect(text(loadDraft(doc.draftKey))).toBe('offline edits');
    expect(listDrafts().map((d) => d.key)).toEqual([doc.draftKey]);
  } finally { doc.destroy(); }
});
