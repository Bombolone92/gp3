// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { openSortDialog } from '../src/ui/sortdialog.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const data = new Map();
  vi.stubGlobal('localStorage', { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// The CSS `background` shorthand also takes a url(), which fetches. These two dialogs set it straight
// from a colour string held in the workbook — and a colour read out of an imported file is not
// guaranteed to be a hex colour — so opening them could have fetched a remote image, as the toolbar's
// swatches already refuse to.
const panel = () => document.querySelector('.modal-panel');
const EVIL = 'url(https://evil.example/pixel.png)';
const styles = (nodes) => [...nodes].map((n) => n.getAttribute('style') || '').join(' | ');

it('paints a Sort range fill option only from a hex color, never from a url()', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['1', '2', '3'].forEach((v, r) => wb.setInput(id, r, 0, v));
  wb.applyStyle(id, parseRange('A2'), { bg: EVIL });
  wb.applyStyle(id, parseRange('A3'), { bg: '#ff0000' });
  openSortDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), grid: { focus() {} } }, parseRange('A1:A3'));
  const order = panel().querySelector('[aria-label="Order"]');
  const mode = panel().querySelector('[aria-label="Sort on"]');
  mode.value = 'color';
  mode.dispatchEvent(new Event('change'));
  order.value = 'colorTop';
  order.dispatchEvent(new Event('change'));
  const select = panel().querySelector('[aria-label="Fill color"]');
  expect(styles(select.options)).not.toMatch(/url\(/);
  // The hex colour still paints its option, and the select follows the choice.
  expect(styles(select.options)).toMatch(/rgb\(255, 0, 0\)|#ff0000/);
  select.value = EVIL;
  select.dispatchEvent(new Event('change'));
  expect(select.getAttribute('style') || '').not.toMatch(/url\(/);
  // The colour is still offered by name, so the rule it sorts by can be chosen.
  expect([...select.options].map((o) => o.value)).toContain(EVIL);
});

it('paints a Conditional formatting rule preview and its swatches only from hex colors', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['1', '2', '3'].forEach((v, r) => wb.setInput(id, r, 0, v));
  const range = parseRange('A1:A3');
  wb.addRule(id, { range, type: 'gt', value: 1, style: { bg: EVIL, color: EVIL } });
  wb.addRule(id, { range, type: 'scale', from: EVIL, mid: EVIL, to: EVIL, style: {} });
  wb.addRule(id, { range, type: 'databar', barColor: EVIL, style: {} });
  wb.addRule(id, { range, type: 'bands', color1: EVIL, color2: EVIL, headerColor: EVIL, style: {} });
  openConditionalFormatting({ wb, sheetId: () => id, range: () => range, grid: { focus() {} } });
  expect(styles(panel().querySelectorAll('.cf-preview'))).not.toMatch(/url\(/);
  // The rule's own colour joins the swatch palette when it is loaded into the form.
  const rows = [...panel().querySelectorAll('.names-main')];
  rows[0].click();
  expect(styles(panel().querySelectorAll('.swatch'))).not.toMatch(/url\(/);
  rows[3].click();
  expect(styles(panel().querySelectorAll('.swatch'))).not.toMatch(/url\(/);
});

it('still paints a rule preview and its swatches from the hex colors a rule does carry', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['1', '2', '3'].forEach((v, r) => wb.setInput(id, r, 0, v));
  const range = parseRange('A1:A3');
  wb.addRule(id, { range, type: 'gt', value: 1, style: { bg: '#123456' } });
  openConditionalFormatting({ wb, sheetId: () => id, range: () => range, grid: { focus() {} } });
  expect(panel().querySelector('.cf-preview').style.background).toBe('rgb(18, 52, 86)');
  panel().querySelector('.names-main').click();
  const chosen = panel().querySelector('[aria-label="Fill color"] [aria-checked="true"]');
  expect(chosen.getAttribute('aria-label')).toBe('#123456');
  expect(chosen.style.background).toBe('rgb(18, 52, 86)');
});
