import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile } from '../src/core/io.js';

// Excel writes any validation whose formula reaches another worksheet into the x14
// extension list, where the formula and the target sit in child elements rather than
// in the text and the sqref attribute of the main-namespace element.
const X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const XM = 'http://schemas.microsoft.com/office/excel/2006/main';
const ext = (rules) => `<extLst><ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}" xmlns:x14="${X14}"><x14:dataValidations xmlns:xm="${XM}" count="${rules.length}">${rules.join('')}</x14:dataValidations></ext></extLst>`;
const x14 = (attrs, first, second, sqref) => `<x14:dataValidation ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}>`
  + `<x14:formula1><xm:f>${first}</xm:f></x14:formula1>${second == null ? '' : `<x14:formula2><xm:f>${second}</xm:f></x14:formula2>`}<xm:sqref>${sqref}</xm:sqref></x14:dataValidation>`;

async function open(tail) {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([[1, 'b', 'c']]), 'Data');
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([['red', 1], ['green'], ['blue']]), 'Lists');
  const zip = X.CFB.read(new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const entry = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  entry.content = new TextEncoder().encode(new TextDecoder().decode(entry.content).replace('</worksheet>', () => `${tail}</worksheet>`));
  entry.size = entry.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'x14.xlsx');
}

it('imports the validations Excel stores in the x14 extension list beside the main ones', async () => {
  const main = '<dataValidations count="1"><dataValidation type="list" sqref="B1" showErrorMessage="1"><formula1>"x,y"</formula1></dataValidation></dataValidations>';
  const wb = await open(main + ext([
    x14({ type: 'list', allowBlank: '1', showErrorMessage: '1' }, 'Lists!$A$1:$A$3', null, 'A1:A5'),
    x14({ type: 'whole', operator: 'between', showErrorMessage: '1', error: 'one to ten' }, 'Lists!$B$1', '10', 'C1:C3'),
  ]));
  const id = wb.sheetByName('Data').id;
  const rules = wb.sheet(id).validations;
  expect(rules).toHaveLength(3);
  expect(rules[0]).toMatchObject({ type: 'list', source: ['x', 'y'], range: { r1: 0, c1: 1, r2: 0, c2: 1 } });
  expect(rules[1]).toMatchObject({ type: 'list', range: { r1: 0, c1: 0, r2: 4, c2: 0 }, allowBlank: true });
  expect(wb.listOptionsFor(id, rules[1])).toEqual(['red', 'green', 'blue']);
  expect(wb.validateValue(id, 2, 0, 'green').ok).toBe(true);
  expect(wb.validateValue(id, 2, 0, 'pink').ok).toBe(false);
  expect(rules[2]).toMatchObject({ type: 'formula', range: { r1: 0, c1: 2, r2: 2, c2: 2 }, message: 'one to ten' });
  expect(wb.validateValue(id, 1, 2, 5).ok).toBe(true);
  expect(wb.validateValue(id, 1, 2, 11).ok).toBe(false);
  expect(wb.validateValue(id, 1, 2, 5.5).ok).toBe(false);
});

it('reads an x14 rule with several targets and entity-escaped formula text', async () => {
  const wb = await open(ext([x14({ type: 'custom', showErrorMessage: '1' }, 'AND(A1&gt;0,Lists!$B$1&lt;2)', null, 'A1 A3:A4')]));
  const id = wb.sheetByName('Data').id;
  expect(wb.sheet(id).validations.map((r) => r.range)).toEqual([
    { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 2, c1: 0, r2: 3, c2: 0 },
  ]);
  expect(wb.validateValue(id, 0, 0, 3).ok).toBe(true);
  expect(wb.validateValue(id, 0, 0, -3).ok).toBe(false);
  expect(wb.validateValue(id, 3, 0, 3).ok).toBe(true);
});
it('retains hidden input messages and their titles from an x14 rule', async () => {
  const wb = await open(ext([x14({ type: 'list', showInputMessage: '0', promptTitle: 'Pick &amp; choose', prompt: 'Stored message' }, 'Lists!$A$1:$A$3', null, 'A1:A3')]));
  expect(wb.validationAt(wb.activeSheetId, 0, 0)).toMatchObject({ promptTitle: 'Pick & choose', prompt: 'Stored message', showInputMessage: false });
  expect(wb.validateValue(wb.activeSheetId, 0, 0, 'pink').ok).toBe(false);
});

it('ignores x14 lookalikes in another namespace and rules without a target', async () => {
  const foreign = ext([x14({ type: 'custom' }, 'A1>0', null, 'A1')]).replace(`xmlns:x14="${X14}"`, 'xmlns:x14="urn:other"');
  expect((await open(foreign)).sheets[0].validations).toEqual([]);
  const noTarget = ext(['<x14:dataValidation type="custom"><x14:formula1><xm:f>A1&gt;0</xm:f></x14:formula1></x14:dataValidation>']);
  expect((await open(noTarget)).sheets[0].validations).toEqual([]);
});

it('keeps the first effective rule within x14 and across the native and extended lists', async () => {
  // Desktop Excel keeps FIRST within the extension and MAIN across both lists.
  const extended = ext([
    x14({ type: 'custom', showInputMessage: '1', prompt: 'FIRST' }, 'A1&gt;0', null, 'A1:A3'),
    x14({ type: 'custom', showInputMessage: '1', prompt: 'SECOND' }, 'A2&lt;0', null, 'A2:A4'),
  ]);
  let wb = await open(extended);
  expect(wb.validationAt(wb.activeSheetId, 1, 0).prompt).toBe('FIRST');
  expect(wb.validationAt(wb.activeSheetId, 3, 0).prompt).toBe('SECOND');
  expect(wb.validateValue(wb.activeSheetId, 3, 0, -2).ok).toBe(true);
  const main = '<dataValidations count="1"><dataValidation type="custom" sqref="A2" showInputMessage="1" prompt="MAIN"><formula1>A2=5</formula1></dataValidation></dataValidations>';
  wb = await open(main + extended);
  expect(wb.validationAt(wb.activeSheetId, 1, 0).prompt).toBe('MAIN');
  expect(wb.validateValue(wb.activeSheetId, 1, 0, 5).ok).toBe(true);
  expect(wb.validateValue(wb.activeSheetId, 1, 0, 6).ok).toBe(false);
});
