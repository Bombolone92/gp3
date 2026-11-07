// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createSheetTabs } from '../src/ui/sheettabs.js';

let tabs, resized;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { resized = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { tabs?.destroy(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function setup() {
  const wb = new Workbook({ sheets: Array.from({ length: 12 }, (_, i) => ({ name: `Sheet${i + 1}` })) });
  tabs = createSheetTabs({ wb });
  document.body.append(tabs.el);
  const list = tabs.el.querySelector('.tab-list');
  const strip = tabs.el.querySelector('.tab-strip');
  const nav = tabs.el.querySelector('.tab-navigation');
  const [left, right] = nav.querySelectorAll('button');
  let width = 400, content = 1000;
  Object.defineProperty(list, 'clientWidth', { get: () => width - (nav.hidden ? 0 : 58) });
  Object.defineProperty(list, 'scrollWidth', { get: () => Math.max(content, list.clientWidth) });
  Object.defineProperty(strip, 'scrollWidth', { get: () => content });
  Object.defineProperty(nav, 'offsetWidth', { get: () => nav.hidden ? 0 : 58 });
  resized();
  return { wb, list, nav, left, right, resize: (nextWidth, nextContent = content) => { width = nextWidth; content = nextContent; resized(); } };
}

it('shows navigation only when the tabs need it, including when its own space is reclaimed', () => {
  const { nav, resize } = setup();
  expect(nav.hidden).toBe(false);
  resize(1030); // Without the controls, 1000px of tabs fit. Keeping their width would falsely overflow.
  expect(nav.hidden).toBe(true);
  resize(400);
  expect(nav.hidden).toBe(false);
  resize(400, 300); // Sheets removed or renamed shorter.
  expect(nav.hidden).toBe(true);
});

it('browses tabs without switching sheets and exposes both scroll limits', () => {
  const { wb, list, left, right } = setup();
  const active = wb.activeSheetId;
  expect(left.getAttribute('aria-disabled')).toBe('true');
  expect(right.getAttribute('aria-disabled')).toBe('false');
  left.click();
  expect(list.scrollLeft).toBe(0);
  right.focus(); right.click();
  expect(list.scrollLeft).toBeGreaterThan(0);
  expect(wb.activeSheetId).toBe(active);
  expect(left.getAttribute('aria-disabled')).toBe('false');
  list.scrollLeft = list.scrollWidth - list.clientWidth;
  list.dispatchEvent(new Event('scroll'));
  expect(right.getAttribute('aria-disabled')).toBe('true');
  expect(document.activeElement).toBe(right);
  const end = list.scrollLeft;
  right.click();
  expect(list.scrollLeft).toBe(end);
  left.click();
  expect(list.scrollLeft).toBeLessThan(end);
});

it('moves keyboard focus to All sheets if a resize hides the focused navigation', () => {
  const { left, resize } = setup();
  left.focus();
  resize(1200);
  expect(document.activeElement).toBe(tabs.el.querySelector('.tab-all'));
});
