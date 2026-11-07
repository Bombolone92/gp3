// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';
import { Doc } from '../src/lib/doc.js';
import { session } from '../src/lib/session.js';
import { listDrafts, loadDraft, draftKey } from '../src/lib/drafts.js';
import { storageScope } from '../src/lib/account-storage.js';

const guestKeys = () => localStorage.keys().filter((key) => key.includes(':account:guest:'));
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(async () => {
  globalThis.localStorage = memoryStorage();
  installMockPuter();
  puter._signedIn = false;
  puter.auth = {
    isSignedIn: () => puter._signedIn,
    signIn: async () => { puter._signedIn = true; },
    getUser: async () => (puter._signedIn ? { username: 'nariman', uuid: 'u-1' } : null),
  };
  await session.init();
  expect(storageScope()).toBe('guest');
});
afterEach(() => {
  session.state = 'unknown';
  session.user = null;
  delete globalThis.puter;
});

// Work done before signing in is kept in this browser under a guest scope.
// Signing in used to switch the scope and leave those drafts behind, where
// neither the home screen nor a reopened file could find them.
describe('guest drafts when the visitor signs in', () => {
  it('moves the draft into the account, then keeps drafting under it after the first save', async () => {
    const doc = Doc.blank();
    const id = doc.wb.activeSheetId;
    doc.wb.setInput(id, 0, 0, 'typed as a guest');
    expect(doc.writeDraft()).toBe(true);
    expect(guestKeys()).toHaveLength(1);

    expect(await session.signIn()).toBe(true);
    expect(guestKeys()).toEqual([]);
    expect(listDrafts().map((d) => d.name)).toEqual(['Untitled spreadsheet']);
    expect(doc.draftKey).toContain(encodeURIComponent('uuid:u-1'));

    expect(await doc.save()).toBe(true);
    expect(doc.path).toBe('Spreadsheets/Untitled spreadsheet.xlsx');
    expect(listDrafts()).toEqual([]);

    await settle();
    doc.wb.setInput(id, 0, 1, 'never reached the cloud');
    expect(doc.writeDraft()).toBe(true);
    // Exactly where a fresh Doc.fromPath(doc.path) would look for it.
    const offered = loadDraft(draftKey(doc.path));
    expect(offered).not.toBeNull();
    expect(offered.workbook.sheets[0].cells['0,1'].v).toBe('never reached the cloud');
    doc.destroy();
  });

  it('follows a recovered guest draft so it stays one record', async () => {
    const first = Doc.blank();
    first.wb.setInput(first.wb.activeSheetId, 0, 0, 'draft');
    first.writeDraft();
    const key = first.draftKey;
    first.destroy();

    const doc = Doc.fromDraft(key);
    expect(doc.draftKey).toBe(key);
    await session.signIn();
    expect(doc.draftKey).not.toContain('guest');
    doc.wb.setInput(doc.wb.activeSheetId, 0, 1, 'more');
    expect(doc.writeDraft()).toBe(true);
    expect(listDrafts()).toHaveLength(1);
    expect(guestKeys()).toEqual([]);
    doc.destroy();
  });

  it('keeps an account record that already exists over a guest one with the same key', async () => {
    localStorage.setItem('spreadsheet:recent:account:guest:', '[{"path":"a"}]');
    localStorage.setItem(`spreadsheet:recent:account:${encodeURIComponent('uuid:u-1')}:`, '[{"path":"b"}]');
    await session.signIn();
    expect(localStorage.getItem(`spreadsheet:recent:account:${encodeURIComponent('uuid:u-1')}:`)).toBe('[{"path":"b"}]');
    expect(guestKeys()).toEqual([]);
  });
});

describe('a sign-in whose identity lookup fails', () => {
  it('leaves the guest drafts where a later, resolved sign-in can adopt them', async () => {
    const doc = Doc.blank();
    doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'typed as a guest');
    expect(doc.writeDraft()).toBe(true);
    expect(guestKeys()).toHaveLength(1);
    const lookup = puter.auth.getUser;
    puter.auth.getUser = async () => null; // whoami failed
    expect(await session.signIn()).toBe(true);
    expect(storageScope()).toMatch(/^session:/);
    // Nothing moved into the throwaway scope, and the open document keeps drafting as a guest.
    expect(guestKeys()).toHaveLength(1);
    expect(doc.draftKey).toContain(':account:guest:');
    expect(localStorage.keys().filter((key) => key.includes('session%3A'))).toEqual([]);
    puter.auth.getUser = lookup;
    await session.refresh();
    expect(storageScope()).toBe('uuid:u-1');
    expect(guestKeys()).toEqual([]);
    expect(listDrafts().map((d) => d.name)).toEqual(['Untitled spreadsheet']);
    expect(doc.draftKey).toContain(encodeURIComponent('uuid:u-1'));
    doc.destroy();
  });
});
