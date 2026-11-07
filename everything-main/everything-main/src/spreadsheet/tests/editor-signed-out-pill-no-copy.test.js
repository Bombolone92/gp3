// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { memoryStorage } from './helpers/memory-storage.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { session } from '../src/lib/session.js';
import { installMockPuter } from './helpers/mock-puter.js';

let view;
beforeEach(async () => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
  installMockPuter();
  puter.auth = { isSignedIn: () => false, signIn: vi.fn(async () => false), getUser: async () => null };
  await session.init();
  expect(session.signedOut).toBe(true);
});
afterEach(() => {
  view?.destroy();
  view = null;
  session.state = 'unknown';
  session.user = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete globalThis.puter;
  document.body.replaceChildren();
});

const pill = () => view.el.querySelector('.save-status');

// Signed out, the pill said "Sign in to save" whatever became of the local draft: a book too large for
// this browser to keep a copy of looked merely unsaved, though closing the tab would lose the edits
// (signed in, the same state said so; the leave dialog warned, but only on the way out).
it('says when this browser could not keep a copy of the edits while signed out, and stops once it can again', async () => {
  const doc = Doc.blank();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'unsaved');
  expect(doc.status).toBe('unsaved');
  expect(pill().textContent).toBe('Sign in to save');
  doc.draftKept = false;
  doc.dispatchEvent(new CustomEvent('draft', { detail: { kept: false } }));
  expect(pill().textContent).toBe('Sign in to save. This browser could not keep a copy');
  expect(pill().title).toContain('could not keep a copy');
  expect(pill().getAttribute('aria-label')).toContain('could not keep a copy');
  expect(pill().classList.contains('signed-out')).toBe(true);
  doc.draftKept = true;
  doc.dispatchEvent(new CustomEvent('draft', { detail: { kept: true } }));
  expect(pill().textContent).toBe('Sign in to save');
  expect(pill().title).not.toContain('could not keep');
});
