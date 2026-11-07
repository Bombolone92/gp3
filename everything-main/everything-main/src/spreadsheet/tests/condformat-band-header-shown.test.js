// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { templateById } from '../src/core/templates.js';
import { bandColor } from '../src/core/condformat.js';
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

// An alternating-colors rule with no header colour of its own paints its header in its first colour.
// The dialog fell back to the palette's default instead, so the Header swatch reported a colour the
// rule does not paint — #e0ecff over a #f7f7f5 header.
const panel = () => document.querySelector('.modal-panel');
const chosen = (label) => panel().querySelector(`[aria-label="${label}"] [aria-checked="true"]`).getAttribute('aria-label');
const pick = (label, hex) => [...panel().querySelectorAll(`[aria-label="${label}"] .swatch`)].find((b) => b.getAttribute('aria-label') === hex).click();
const check = (text) => [...panel().querySelectorAll('label')].find((l) => l.textContent.includes(text)).querySelector('input');
/** The fill the grid paints on the rule's header row, with the header turned on. */
const paintedHeader = (rule) => bandColor({ ...rule, header: true }, rule.range.r1, 0).bg;
const submit = () => { document.activeElement?.blur?.(); panel().querySelector('form').requestSubmit(); };
const grid = () => ({ focus: vi.fn(), setSelection: vi.fn() });
const anywhere = { r1: 0, c1: 0, r2: 0, c2: 0 };
const open = (wb, id) => openConditionalFormatting({ wb, sheetId: () => id, range: () => anywhere, grid: grid() });
const ready = (wb) => { wb.clearHistory(); wb.markClean(); };

/**
 * A banding rule naming no header colour of its own — the shape every document saved before the
 * templates began writing the key still holds, and the one `addRule` stores from any other caller.
 */
function implied() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['1', '2', '3'].forEach((v, r) => wb.setInput(id, r, 0, v));
  wb.addRule(id, { range: { r1: 0, c1: 0, r2: 2, c2: 0 }, type: 'bands', style: {}, header: false, color1: '#f7f7f5', color2: '#ffffff' });
  ready(wb);
  return { wb, id, rule: wb.sheet(id).rules[0] };
}

function schedule() {
  const wb = templateById('schedule').build();
  ready(wb);
  const sheet = wb.sheets.find((s) => (s.rules || []).length);
  return { wb, id: sheet.id, rule: sheet.rules[0] };
}

it('shows a rule with no header colour of its own the colour it actually paints', () => {
  const { wb, id, rule } = implied();
  expect(rule.headerColor).toBeUndefined();
  expect(rule.color1).toBe('#f7f7f5');
  open(wb, id);
  panel().querySelector('.names-main').click();
  // Tied to what the grid paints, so the two cannot drift apart again.
  expect(chosen('Header color')).toBe(paintedHeader(rule));
  expect(chosen('Header color')).toBe('#f7f7f5');
  expect(chosen('First color')).toBe('#f7f7f5');
});

it('shows the Weekly schedule band rule the colour it paints, whatever the template stores', () => {
  const { wb, id, rule } = schedule();
  open(wb, id);
  panel().querySelector('.names-main').click();
  expect(chosen('Header color')).toBe(paintedHeader(rule));
});

it('paints the header in the colour the swatch showed when the header row is turned on', () => {
  const { wb, id } = implied();
  open(wb, id);
  panel().querySelector('.names-main').click();
  const shown = chosen('Header color');
  check('First row is a header').click();
  submit();
  const saved = wb.sheet(id).rules[0];
  expect(saved.header).toBe(true);
  expect(bandColor(saved, saved.range.r1, 0).bg).toBe(shown);
});

it.each([['a rule with no header colour', implied], ['the Weekly schedule rule', schedule]])(
  'records no step when %s is saved with nothing changed', (_name, build) => {
    const { wb, id } = build();
    const before = JSON.stringify(wb.sheet(id).rules);
    open(wb, id);
    panel().querySelector('.names-main').click();
    submit();
    expect(JSON.stringify(wb.sheet(id).rules)).toBe(before);
    expect(wb.undoLabel()).toBeNull();
    expect(wb.dirty).toBe(false);
  });

it('keeps the header on the colour the swatch shows when only First color changes', () => {
  const { wb, id } = implied();
  open(wb, id);
  panel().querySelector('.names-main').click();
  pick('First color', '#e0ecff');
  expect(chosen('Header color')).toBe('#f7f7f5'); // untouched by the user, so untouched by the save
  submit();
  const saved = wb.sheet(id).rules[0];
  expect(saved.color1).toBe('#e0ecff');
  // The header no longer follows the band: the rule now carries the colour the swatch showed.
  expect(paintedHeader(saved)).toBe('#f7f7f5');
});

it('shows a header colour the rule does carry, and a rule with neither falls back to the default', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['1', '2', '3'].forEach((v, r) => wb.setInput(id, r, 0, v));
  const range = { r1: 0, c1: 0, r2: 2, c2: 0 };
  wb.addRule(id, { range, type: 'bands', style: {}, color1: '#fde8e8', color2: '#ffffff', headerColor: '#0b0b0b' });
  wb.addRule(id, { range, type: 'bands', style: {} });
  open(wb, id);
  const rows = [...panel().querySelectorAll('.names-main')];
  rows[0].click();
  expect(chosen('Header color')).toBe('#0b0b0b');
  rows[1].click();
  expect(chosen('Header color')).toBe('#e0ecff');
});
