// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { openFormatCellsDialog } from '../src/ui/formatcells.js';
import { openCustomFormatDialog } from '../src/ui/numfmtdialog.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeAll(() => {
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => { closeAllModals(); document.body.replaceChildren(); });

function context(style) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1234.5');
  wb.applyStyle(id, parseRange('A1'), style);
  const runs = [];
  const ctx = {
    wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), range: () => parseRange('A1:A1'),
    style: () => wb.getCell(id, 0, 0)?.s || {}, run: (cmd, arg) => runs.push([cmd, arg]),
    grid: { editing: false, focus() {}, commitEdit() {} },
  };
  return { ctx, runs };
}
const type = (input, text) => { input.value = text; input.dispatchEvent(new Event('input')); };

describe('Format cells with a custom code', () => {
  function open() {
    const { ctx, runs } = context({ fmt: 'custom', code: '0.0' });
    const modal = openFormatCellsDialog(ctx);
    const input = modal.panel.querySelector('input[aria-label="Format code"]');
    const error = modal.panel.querySelector('.fc-panel .field-error');
    const apply = () => modal.panel.querySelector('form.fc-form').dispatchEvent(new Event('submit', { cancelable: true }));
    return { runs, input, error, apply, modal };
  }

  it.each(['"', '[', 'E+', '0;0;0;0;0', '0 days', '@;0', '0@', '0;0;0;yyyy', 'GeneralGeneral'])('refuses to apply the malformed code %s, saying why beside the field', (code) => {
    const { runs, input, error, apply } = open();
    type(input, code);
    apply();
    expect(runs).toEqual([]);
    expect(error.hidden).toBe(false);
    expect(error.textContent).not.toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
    expect(document.activeElement).toBe(input);
  });

  it('asks for a code rather than applying 0 when the field is left empty', () => {
    const { runs, input, error, apply } = open();
    type(input, '');
    apply();
    expect(runs).toEqual([]);
    expect(error.hidden).toBe(false);
    expect(error.textContent).toMatch(/enter a format code/i);
  });

  it('clears the message once the code changes, and applies a well-formed one', () => {
    const { runs, input, error, apply } = open();
    type(input, '"');
    apply();
    expect(error.hidden).toBe(false);
    type(input, '#,##0.00');
    expect(error.hidden).toBe(true);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    apply();
    expect(runs).toHaveLength(1);
    expect(runs[0][1].patch).toMatchObject({ fmt: 'custom', code: '#,##0.00' });
  });

  it('accepts numeric meridiem suffixes and rejects placeholders after them', () => {
    const { runs, input, error, apply, modal } = open();
    type(input, 'AM/PM0.00');
    apply();
    expect(error.hidden).toBe(false);
    type(input, '0.00AM/PM');
    expect(modal.panel.querySelector('.numfmt-preview').textContent).toBe('Preview: 1234.50PM');
    apply();
    expect(runs[0][1].patch).toMatchObject({ fmt: 'custom', code: '0.00AM/PM' });
  });

  it('shows the preview for a well-formed code and the problem for a malformed one', () => {
    const { input, modal } = open();
    const preview = modal.panel.querySelector('.numfmt-preview');
    type(input, '#,##0.00');
    expect(preview.textContent).toBe('Preview: 1,234.50');
    type(input, '"');
    expect(preview.textContent).toBe('Preview');
  });
});

describe('the Custom number format dialog', () => {
  function open() {
    const { ctx, runs } = context({});
    const modal = openCustomFormatDialog(ctx);
    const input = modal.panel.querySelector('input[aria-label="Format code"]');
    const error = modal.panel.querySelector('.field-error');
    const apply = () => modal.panel.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    return { runs, input, error, apply };
  }

  it('refuses a malformed code, says why, and applies once it is corrected', () => {
    const { runs, input, error, apply } = open();
    type(input, '[');
    apply();
    expect(runs).toEqual([]);
    expect(error.hidden).toBe(false);
    expect(error.textContent).toMatch(/bracket/i);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
    type(input, '[Red]0');
    expect(error.hidden).toBe(true);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    apply();
    expect(runs).toEqual([['fmt', { fmt: 'custom', code: '[Red]0', dec: null, dateStyle: null }]]);
  });
});
