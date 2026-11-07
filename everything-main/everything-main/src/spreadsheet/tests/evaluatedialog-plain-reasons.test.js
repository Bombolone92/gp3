// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openEvaluateDialog } from '../src/ui/evaluatedialog.js';
import { closeAllModals } from '../src/ui/modal.js';

// A formula the parser could not read was explained in the parser's own words: "Cannot read this formula:
// Unterminated string", or "Unexpected token", which say nothing to someone who typed =SUM("abc.
beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} })); document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeAllModals(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function reason(formula) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, formula);
  openEvaluateDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), grid: { focus() {} } });
  const text = document.querySelector('.modal-root:not(.closing) .field-error')?.textContent ?? null;
  closeAllModals();
  return text;
}

it('says why a formula cannot be read in plain words', () => {
  expect(reason('=SUM("abc')).toBe('Cannot read this formula: a quoted text has no closing quote');
  expect(reason('=1+')).toBe('Cannot read this formula: it ends before it is complete');
  expect(reason('=1+)')).toBe('Cannot read this formula: an operator, comma, or parenthesis is out of place');
  expect(reason('={1,2')).toBe('Cannot read this formula: a closing "}" is missing');
  expect(reason('=[x')).toBe('Cannot read this formula: a [ has no closing ]');
  expect(reason('=#FOO!')).toBe('Cannot read this formula: it names an error value that does not exist');
});
