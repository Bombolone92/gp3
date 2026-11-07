// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { LOCALES, setLocale, formatValue } from '../src/core/format.js';
import { openFormatCellsDialog } from '../src/ui/formatcells.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeAll(() => {
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => { closeAllModals(); document.body.replaceChildren(); setLocale('en-US'); });

// Format cells listed fixed en-US date samples built once at module load, so under Deutsch it offered
// "Aug 27, 2026" and "August 27, 2026" on a cell that would show 27.08.2026 and 27. August 2026 — the
// number-format menu three pixels away already read the regional format (d879039). The samples are now
// built when the dialog opens, from the styles themselves.
const SAMPLE_DAY = 46261; // 2026-08-27, the day the number-format menu samples

function open(style = { fmt: 'date' }) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: SAMPLE_DAY, s: style } }]);
  const range = parseRange('A1');
  const modal = openFormatCellsDialog({
    wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), range: () => range,
    style: () => wb.getCell(id, 0, 0)?.s || {}, run: (cmd, arg) => wb.applyStyle(id, range, arg.patch),
    grid: { editing: false, focus() {}, commitEdit() {} },
  });
  const field = (label) => modal.panel.querySelector(`[aria-label="${label}"]`);
  const pick = (label, v) => { field(label).value = v; field(label).dispatchEvent(new Event('change')); };
  const apply = () => modal.panel.querySelector('form.fc-form').dispatchEvent(new Event('submit', { cancelable: true }));
  return { wb, id, modal, field, pick, apply };
}

it.each([['en-US'], ['de-DE'], ['ja-JP'], ['en-GB']])('labels each Date style with the date it produces under %s', (loc) => {
  setLocale(loc);
  const { field } = open();
  const options = [...field('Date style').options];
  expect(options.map((o) => o.value)).toEqual(['iso', 'medium', 'long']);
  for (const option of options) {
    expect(option.textContent, `${loc} ${option.value}`).toBe(formatValue(SAMPLE_DAY, { fmt: 'date', dateStyle: option.value }));
  }
});

it.each([['de-DE', '27.08.2026', '27. August 2026'], ['ja-JP', '2026/08/27', '2026年8月27日'], ['en-GB', '27 Aug 2026', '27 August 2026']])(
  'shows in %s the dates the cell then really gets', (loc, medium, long) => {
    setLocale(loc);
    const { wb, id, field, pick, apply } = open();
    expect([...field('Date style').options].map((o) => o.textContent)).toEqual(['2026-08-27', medium, long]);
    pick('Date style', 'medium');
    expect(field('Date style').selectedOptions[0].textContent).toBe(medium);
    // The preview and the cell agree with the option that was picked.
    expect(document.querySelector('.numfmt-preview').textContent).toBe(`Preview: ${medium}`);
    apply();
    expect(wb.getDisplay(id, 0, 0)).toBe(medium);
  });

it('follows a regional format changed between two openings', () => {
  const first = open();
  expect([...first.field('Date style').options].map((o) => o.textContent)).toContain('Aug 27, 2026');
  closeAllModals();
  setLocale('de-DE');
  const second = open();
  expect([...second.field('Date style').options].map((o) => o.textContent)).toContain('27.08.2026');
});

// French and 中文 write the medium and long styles identically, which would leave two rows reading the
// same and no way to see which is chosen.
it.each([['fr-FR', '27 août 2026'], ['zh-CN', '2026年8月27日']])('names the two styles %s writes alike', (loc, same) => {
  setLocale(loc);
  const { field } = open();
  expect([...field('Date style').options].map((o) => o.textContent))
    .toEqual(['2026-08-27', `${same} (written out)`, `${same} (written out in full)`]);
});

it('gives every regional format three date styles that can be told apart', () => {
  for (const [code] of LOCALES) {
    setLocale(code);
    const { field } = open();
    const labels = [...field('Date style').options].map((o) => o.textContent);
    expect(new Set(labels).size, code).toBe(3);
    // Each label still starts with the date that style produces.
    for (const option of [...field('Date style').options]) {
      expect(option.textContent.startsWith(formatValue(SAMPLE_DAY, { fmt: 'date', dateStyle: option.value })), `${code} ${option.value}`).toBe(true);
    }
    closeAllModals();
    document.body.replaceChildren();
  }
});

it('labels the Date style list the same way for a date-and-time cell', () => {
  setLocale('de-DE');
  const { field } = open({ fmt: 'datetime' });
  expect(field('Category').value).toBe('datetime');
  expect([...field('Date style').options].map((o) => o.textContent)).toEqual(['2026-08-27', '27.08.2026', '27. August 2026']);
});
