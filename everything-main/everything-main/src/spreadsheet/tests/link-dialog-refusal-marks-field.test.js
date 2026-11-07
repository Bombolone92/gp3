// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as notifications from '../src/ui/toast.js';

// The link dialog refused a bad cell or range with a toast and an empty or unsafe address with a
// message that was not tied to the field, and its message sat inside the web-address field, hidden
// with it while a place on a sheet was chosen. Each refusal now marks its field invalid, describes
// it by the message, focuses it, and shows the message under whichever field is in view.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

let view;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function open() {
  const doc = new Doc({ name: 'Links', path: 'Spreadsheets/Links.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!A1');
  await vi.advanceTimersByTimeAsync(1);
  const toast = vi.spyOn(notifications, 'toast');
  view.el.querySelector('[aria-label="Insert link"]').click();
  const panel = document.querySelector('.modal-panel');
  const field = (label) => panel.querySelector(`[aria-label="${label}"]`);
  const submit = () => { document.activeElement?.blur?.(); panel.querySelector('form').requestSubmit(); };
  const alert = panel.querySelector('[role="alert"]');
  return { wb, id, toast, panel, field, submit, alert };
}

function expectRefusal({ panel, alert }, target, message) {
  expect(alert.hidden).toBe(false);
  expect(alert.closest('[hidden]')).toBeNull(); // in view, whichever field is shown
  expect(alert.textContent).toMatch(message);
  expect([...panel.querySelectorAll('[aria-invalid="true"]')]).toEqual([target]);
  expect(target.getAttribute('aria-describedby')).toBe(alert.id);
  expect(document.activeElement).toBe(target);
}

it('blames the Link field for an empty or unsafe address, and clears the mark once it is retyped', async () => {
  const dialog = await open();
  const { wb, id, toast, field, submit, alert } = dialog;
  submit();
  expectRefusal(dialog, field('Link'), /enter a link/i);
  field('Link').value = 'javascript:alert(1)';
  field('Link').dispatchEvent(new Event('input', { bubbles: true }));
  expect(alert.hidden).toBe(true);
  expect(field('Link').hasAttribute('aria-invalid')).toBe(false);
  submit();
  expectRefusal(dialog, field('Link'), /web address/i);
  expect(toast).not.toHaveBeenCalled();
  expect(wb.linkAt(id, 0, 0)).toBeNull();
});

it('blames the Cell or range field, in view, for a place that does not read, instead of a toast', async () => {
  const dialog = await open();
  const { wb, id, toast, field, submit } = dialog;
  field('Link to').value = `sheet:${id}`;
  field('Link to').dispatchEvent(new Event('change', { bubbles: true }));
  field('Cell or range').value = 'nowhere';
  submit();
  expectRefusal(dialog, field('Cell or range'), /cell or range like/i);
  expect(toast).not.toHaveBeenCalled();
  field('Cell or range').value = 'B2';
  field('Cell or range').dispatchEvent(new Event('input', { bubbles: true }));
  expect(dialog.alert.hidden).toBe(true);
  submit();
  expect(wb.linkAt(id, 0, 0)?.url).toBe('#Sheet1!B2');
});
