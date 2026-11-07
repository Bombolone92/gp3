// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '../src/lib/session.js';
import { Doc } from '../src/lib/doc.js';
import { loadDraft, listDrafts } from '../src/lib/drafts.js';
import { recentFiles, rememberRecent, forgetRecent } from '../src/lib/recent.js';

let user;
const docs = [];
beforeEach(() => {
  vi.useFakeTimers();
  const data = new Map();
  vi.stubGlobal('localStorage', {
    get length() { return data.size; }, key: (i) => [...data.keys()][i] ?? null,
    getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('puter', { auth: { isSignedIn: () => true, getUser: async () => user }, kv: { get: async () => null } });
});
afterEach(() => {
  for (const doc of docs.splice(0)) doc.destroy();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function signIn(uuid, username = uuid) {
  user = uuid ? { uuid, username } : null;
  await session.init();
}

function documentWithDraft(text) {
  const doc = new Doc({ path: 'Spreadsheets/Private.xlsx', name: 'Private' });
  docs.push(doc);
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, text);
  expect(doc.writeDraft()).toBe(true);
  return doc;
}

describe('account isolation for local document data', () => {
  it('does not show, overwrite, or forget another account\'s recent files', async () => {
    await signIn('alice');
    rememberRecent('/alice/Private.xlsx', 'Alice private file');
    await signIn('bob');
    expect(recentFiles()).toEqual([]);
    forgetRecent('/alice/Private.xlsx');
    rememberRecent('/bob/Work.xlsx', 'Bob work');
    await signIn('alice', 'alice-renamed');
    expect(recentFiles().map((file) => file.name)).toEqual(['Alice private file']);
    await signIn('bob');
    expect(recentFiles().map((file) => file.name)).toEqual(['Bob work']);
  });

  it('isolates drafts for identical relative paths and keeps existing documents in their original account', async () => {
    await signIn('alice');
    const alice = documentWithDraft('Alice secret');
    await signIn('bob');
    expect(listDrafts()).toEqual([]);
    const bob = documentWithDraft('Bob work');
    expect(bob.draftKey).not.toBe(alice.draftKey);
    alice.writeDraft(); // a delayed callback must retain its original storage owner
    expect(loadDraft(bob.draftKey).workbook.sheets[0].cells['0,0'].v).toBe('Bob work');
    await signIn('alice');
    expect(listDrafts().map((draft) => draft.key)).toEqual([alice.draftKey]);
    expect(loadDraft(alice.draftKey).workbook.sheets[0].cells['0,0'].v).toBe('Alice secret');
  });

  it('does not adopt legacy data with an unknown owner or reveal data when identity lookup fails', async () => {
    localStorage.setItem('spreadsheet:recent', JSON.stringify([{ path: '/old/Secret.xlsx', name: 'Secret' }]));
    const legacy = JSON.stringify({ name: 'Legacy', savedAt: Date.now(), workbook: {} });
    localStorage.setItem('spreadsheet:draft:Spreadsheets/Private.xlsx', legacy);
    await signIn('alice');
    expect(recentFiles()).toEqual([]);
    expect(listDrafts()).toEqual([]);
    documentWithDraft('Alice secret');
    rememberRecent('/alice/Secret.xlsx', 'Secret');
    await signIn(null);
    expect(recentFiles()).toEqual([]);
    expect(listDrafts()).toEqual([]);
    expect(localStorage.getItem('spreadsheet:draft:Spreadsheets/Private.xlsx')).toBe(legacy);
  });
});
