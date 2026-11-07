// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import { setLocale } from '../src/core/format.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { setLocale('en-US'); document.body.replaceChildren(); });

const flush = () => new Promise((r) => setTimeout(r, 5));

/** A General number in a column too narrow for it; the test canvas measures 7px a character. */
async function shown(text, width, locale) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, text);
  wb.setColWidth(id, 0, width);
  setLocale(locale);
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  await flush();
  const out = grid.el.querySelector('#gc-0-0').textContent;
  grid.destroy();
  return out;
}

describe('General numbers shortened to fit a narrow column', () => {
  it('drop decimals the same way in a comma-decimal locale as in a point one', async () => {
    expect(await shown('1234.5678', 60, 'en-US')).toBe('1234.57');
    expect(await shown('1234.5678', 60, 'de-DE')).toBe('1234,57');
  });

  it('write the scientific form with the regional decimal mark', async () => {
    expect(await shown('123456789012.5', 60, 'en-US')).toBe('1.2E+11');
    expect(await shown('123456789012.5', 60, 'de-DE')).toBe('1,2E+11');
  });
});
