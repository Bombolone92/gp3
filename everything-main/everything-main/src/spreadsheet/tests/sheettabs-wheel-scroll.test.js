// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createSheetTabs } from '../src/ui/sheettabs.js';

// The tab strip hides its scrollbar and, unlike the toolbar and menu bar, neither wraps for a mouse nor
// listened for the wheel, so overflowing tabs were out of a mouse's reach except by Shift+wheel or the
// arrow keys. A plain wheel over the strip now scrolls it sideways when the tabs overflow.
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

let tabs;
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { tabs?.destroy(); document.body.replaceChildren(); });

/** A strip of ten sheets whose tabs need `scrollWidth` pixels inside a `clientWidth` list. */
function setup(scrollWidth, clientWidth = 400) {
  const wb = new Workbook({ sheets: Array.from({ length: 10 }, (_, i) => ({ name: `Sheet${i + 1}` })) });
  tabs = createSheetTabs({ wb });
  document.body.append(tabs.el);
  const list = tabs.el.querySelector('.tab-list');
  Object.defineProperty(list, 'scrollWidth', { configurable: true, get: () => scrollWidth });
  Object.defineProperty(list, 'clientWidth', { configurable: true, get: () => clientWidth });
  list.scrollLeft = 0;
  return list;
}

const wheel = (list, init) => { const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init }); list.dispatchEvent(e); return e; };

describe('the wheel over the tab strip', () => {
  it('scrolls the tabs sideways when they overflow, and takes the event so the page does not scroll', () => {
    const list = setup(1200);
    expect(wheel(list, { deltaY: 60 }).defaultPrevented).toBe(true);
    expect(list.scrollLeft).toBe(60);
    wheel(list, { deltaY: -20 });
    expect(list.scrollLeft).toBe(40);
    // A wheel that reports lines or pages is scaled to pixels, as the grid scales it.
    wheel(list, { deltaY: 3, deltaMode: 1 });
    expect(list.scrollLeft).toBe(100);
    wheel(list, { deltaY: 1, deltaMode: 2 });
    expect(list.scrollLeft).toBe(500);
  });

  it('is left to the browser when the tabs fit, when it is already sideways, and with Ctrl or Cmd held', () => {
    let list = setup(300);
    expect(wheel(list, { deltaY: 60 }).defaultPrevented).toBe(false);
    expect(list.scrollLeft).toBe(0);
    document.body.replaceChildren();
    list = setup(1200);
    expect(wheel(list, { deltaX: 40, deltaY: 10 }).defaultPrevented).toBe(false);
    expect(wheel(list, { deltaY: 40, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel(list, { deltaY: 40, metaKey: true }).defaultPrevented).toBe(false);
    expect(wheel(list, { deltaY: 0 }).defaultPrevented).toBe(false);
    expect(list.scrollLeft).toBe(0);
  });
});
