// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { draftKey, loadDraft, saveDraft } from '../src/lib/drafts.js';
import { setStorageUser } from '../src/lib/account-storage.js';
import { Workbook } from '../src/core/workbook.js';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
let view;
let doc;
beforeEach(() => {
  vi.useFakeTimers();
  const data = new Map();
  vi.stubGlobal('localStorage', {
    get length() { return data.size; }, key: (i) => [...data.keys()][i] ?? null,
    getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key),
  });
  setStorageUser({ uuid: 'alice' });
  vi.spyOn(P, 'listFiles').mockResolvedValue([]);
  document.body.replaceChildren();
});
afterEach(() => { view?.destroy(); doc?.destroy(); view = doc = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function unsavedDraft() {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, 'Work before first save');
  const key = draftKey(null, 'Unfinished plan');
  saveDraft(key, wb, 'Unfinished plan');
  return key;
}

it('offers unsaved spreadsheets on the home screen even while the cloud file list is unavailable', () => {
  const key = unsavedDraft();
  vi.spyOn(P, 'listFiles').mockImplementation(() => new Promise(() => {}));
  const recoverDraft = vi.fn();
  view = homeView({ recoverDraft });
  document.body.append(view.el);
  const recover = view.el.querySelector('[aria-label="Recover Unfinished plan"]');
  expect(recover).not.toBeNull();
  recover.click();
  expect(recoverDraft).toHaveBeenCalledWith(key);
  expect(loadDraft(key)).not.toBeNull();
});

it('recovers a never-saved draft as a dirty workbook under its original name', () => {
  const key = unsavedDraft();
  doc = Doc.fromDraft(key);
  expect(doc.name).toBe('Unfinished plan');
  expect(doc.path).toBeNull();
  expect(doc.wb.getValue(doc.wb.activeSheetId, 0, 0)).toBe('Work before first save');
  expect(doc.wb.dirty).toBe(true);
  expect(doc.status).toBe('unsaved');
  expect(doc.draftKey).toBe(key);
  expect(loadDraft(key)).not.toBeNull();
});

it('refuses to recover another account\'s draft or one that no longer exists', () => {
  const key = unsavedDraft();
  setStorageUser({ uuid: 'bob' });
  expect(() => Doc.fromDraft(key)).toThrow();
  expect(() => Doc.fromDraft(draftKey(null, 'Missing'))).toThrow();
  view = homeView({ recoverDraft: vi.fn() });
  expect(view.el.querySelector('[aria-label="Recover Unfinished plan"]')).toBeNull();
  expect(loadDraft(key)).not.toBeNull();
});
