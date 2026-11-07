import { expect, it } from 'vitest';
import { workbookFromFile, workbookToOds, workbookToXlsx } from '../src/core/io.js';
import { writeXlsxValidations } from '../src/core/xlsx-validation.js';
import * as X from '../src/vendor/xlsx.mjs';

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet"';

/** A flat .ods as LibreOffice writes a sheet with two validated columns: every row names both rules. */
function twoColumns(rows, { gapAt = -1 } = {}) {
  let body = '';
  for (let r = 0; r < rows; r++) {
    const first = r === gapAt ? '<table:table-cell office:value-type="float" office:value="0"><text:p>0</text:p></table:table-cell>'
      : `<table:table-cell table:content-validation-name="v1" office:value-type="float" office:value="${r}"><text:p>${r}</text:p></table:table-cell>`;
    body += `<table:table-row>${first}<table:table-cell table:content-validation-name="v2" office:value-type="string"><text:p>x${r}</text:p></table:table-cell></table:table-row>`;
  }
  return new TextEncoder().encode(`<?xml version="1.0"?><office:document ${NS}><office:body><office:spreadsheet><table:content-validations>`
    + '<table:content-validation table:name="v1" table:condition="of:cell-content-is-in-list(&quot;1&quot;;&quot;2&quot;)" table:allow-empty-cell="true" table:base-cell-address="$Data.$A$1"/>'
    + '<table:content-validation table:name="v2" table:condition="of:cell-content-is-in-list(&quot;Yes&quot;;&quot;No&quot;)" table:allow-empty-cell="true" table:base-cell-address="$Data.$B$1"/>'
    + `</table:content-validations><table:table table:name="Data"><table:table-column table:number-columns-repeated="2"/>${body}</table:table></office:spreadsheet></office:body></office:document>`);
}

// A validated column arrives one cell per row, and with two validated columns the rows
// interleave the two names. Each cell used to extend only the rule collected just before
// it, which was always the other column's, so every cell became a rule of its own.
it('imports two validated columns of an .ods as one rule per column', async () => {
  const wb = await workbookFromFile(twoColumns(6), 'two.fods');
  const id = wb.activeSheetId;
  expect(wb.activeSheet.validations.map((v) => v.range)).toEqual([
    { r1: 0, c1: 0, r2: 5, c2: 0 },
    { r1: 0, c1: 1, r2: 5, c2: 1 },
  ]);
  expect(wb.validationAt(id, 5, 0)).toMatchObject({ type: 'list', source: ['1', '2'] });
  expect(wb.validationAt(id, 3, 1)).toMatchObject({ type: 'list', source: ['Yes', 'No'] });
  // The plain export, without the settings block, reads back the same two rules.
  const again = await workbookFromFile(await workbookToOds(wb, { settings: false }), 'again.ods');
  expect(again.activeSheet.validations.map((v) => v.range)).toEqual(wb.activeSheet.validations.map((v) => v.range));
});

it('starts a new rule where a validated column has a gap', async () => {
  const wb = await workbookFromFile(twoColumns(6, { gapAt: 2 }), 'gap.fods');
  expect(wb.activeSheet.validations.map((v) => v.range)).toEqual([
    { r1: 0, c1: 0, r2: 1, c2: 0 },
    { r1: 0, c1: 1, r2: 5, c2: 1 },
    { r1: 3, c1: 0, r2: 5, c2: 0 },
  ]);
  expect(wb.validationAt(wb.activeSheetId, 2, 0)).toBeNull();
});

const io = { escape: (s) => s, attribute: (s) => s };
const stacked = (n) => Array.from({ length: n }, (_, i) => ({ type: 'number', min: 1, max: 9, range: { r1: i, c1: 0, r2: i, c2: 0 } }));

it('cuts a rule only by the later rules that overlap it, keeping the pieces in file order', () => {
  const xml = writeXlsxValidations([
    { type: 'number', min: 1, range: { r1: 0, c1: 0, r2: 9, c2: 2 } },
    { type: 'number', min: 5, range: { r1: 20, c1: 0, r2: 20, c2: 0 } },
    { type: 'number', min: 2, range: { r1: 1, c1: 1, r2: 2, c2: 1 } },
    { type: 'number', min: 3, range: { r1: 0, c1: 5, r2: 1048575, c2: 5 } },
  ], io);
  const refs = [...xml.matchAll(/sqref="([^"]+)"/g)].map((m) => m[1]);
  expect(refs).toEqual(['A1:C1', 'A4:C10', 'A2:A3', 'C2:C3', 'A21', 'B2:B3', 'F1:F1048576']);
});

// Every rule used to be cut by every later rule, whether or not the two touched, so the
// writer grew with the square of the rule count: 4,000 rules stacked in a column, as an
// .ods with a rule on each row gives, took seconds on each save.
it('writes thousands of stacked rules in about the time of their count, not its square', { timeout: 60000 }, () => {
  const time = (n) => { const start = performance.now(); const xml = writeXlsxValidations(stacked(n), io); return { ms: performance.now() - start, count: (xml.match(/<dataValidation /g) || []).length }; };
  time(1500);
  const small = time(1500), large = time(12000);
  expect(small.count).toBe(1500);
  expect(large.count).toBe(12000);
  // Eight times the rules: eight times the work when linear, sixty-four when quadratic.
  expect(large.ms).toBeLessThan(small.ms * 24 + 250);
});

it('saves a book of thousands of imported rules to .xlsx promptly', { timeout: 60000 }, async () => {
  const wb = await workbookFromFile(twoColumns(3000), 'big.fods');
  expect(wb.activeSheet.validations).toHaveLength(2);
  const start = performance.now();
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  expect(performance.now() - start).toBeLessThan(5000);
  const back = X.read(bytes, { type: 'array' });
  expect(back.SheetNames[0]).toBe('Data');
});
