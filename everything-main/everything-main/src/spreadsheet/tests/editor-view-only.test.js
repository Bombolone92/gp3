// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closeMenu } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as P from '../src/lib/puter.js';
import { toast } from '../src/ui/toast.js';

// A spreadsheet shared with the user only to view opened as if it could be edited: nothing said so until
// a save was refused, as "Not saved: Forbidden".

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, user: { username: 'me' }, username: 'me', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

let view;
let listShared;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  listShared = vi.fn();
  toast.mockClear();
  vi.stubGlobal('puter', { fs: { share() {}, getShares: async () => [], listShared } });
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  vi.spyOn(P, 'shareAccess').mockResolvedValue([]);
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeMenu(); closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const open = async (path, mode) => {
  listShared.mockResolvedValue({ items: mode ? [{ name: 'Team.xlsx', path, entryUid: 'u1', mode }] : [] });
  const doc = new Doc({ name: 'Team', path, uid: 'u1' });
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(5);
  return doc;
};

it('says View only on a spreadsheet shared with the user to view', async () => {
  const doc = await open('/ana/u1/Team.xlsx', 'read');
  expect(doc.viewOnly).toBe(true);
  expect(view.el.querySelector('.save-status').textContent).toBe('View only');
  expect(toast).toHaveBeenCalledWith(expect.stringContaining('not change it'), expect.anything());
});

it('says nothing of the kind on one shared to edit, or on the user’s own', async () => {
  let doc = await open('/ana/u1/Team.xlsx', 'write');
  expect(doc.viewOnly).toBe(false);
  expect(view.el.querySelector('.save-status').textContent).toBe('Saved');
  view.destroy();
  doc = await open('/me/Spreadsheets/Mine.xlsx', 'read');
  expect(listShared).toHaveBeenCalledOnce(); // for the first spreadsheet only
  expect(doc.viewOnly).toBe(false);
  expect(toast).not.toHaveBeenCalled();
});
