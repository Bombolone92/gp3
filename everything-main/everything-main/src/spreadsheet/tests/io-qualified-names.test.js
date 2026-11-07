import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

const cases = [
  ['Two', 'Rate', 'Two!Rate', "'Two'.$$'Rate'"],
  ['A1', 'Rate', 'A1!Rate', "'A1'.$$'Rate'"],
  ['Two Data', 'Rate', "'Two Data'!Rate", "'Two Data'.$$'Rate'"],
  ["O'Brien", 'Rate', "'O''Brien'!Rate", "'O''Brien'.$$'Rate'"],
  ['A.B', 'Tax.Rate', "'A.B'!Tax.Rate", "'A.B'.$$'Tax.Rate'"],
  ['A!B', '_xlfn.Rate', "'A!B'!_xlfn.Rate", "'A!B'.$$'_xlfn.Rate'"],
  ['一月', 'Rate', "'一月'!Rate", "'一月'.$$'Rate'"],
];
it.each(cases)('writes a qualified name on %s using native OpenFormula syntax', async (sheet, name, formula, native) => {
  let wb = new Workbook({ sheets: [{ name: 'One' }, { name: sheet }], names: [{ name, ref: '20', sheet }] });
  wb.setInput(wb.sheets[0].id, 0, 0, `=${formula}+LEN("${formula}")`);
  wb.defineName('Total', `${formula}+1`);
  wb.setInput(wb.sheets[0].id, 0, 1, '=Total');
  const bytes = new Uint8Array(await (await workbookToOds(wb)).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, 'content.xml').content);
  const escaped = native.replace(/&/g, '&amp;').replace(/'/g, '&apos;');
  expect(xml).toContain(`table:formula="of:=${escaped}+LEN(`);
  expect(xml).toContain(`table:expression="of:=${escaped}+1"`);
  wb = await workbookFromFile(bytes, 'qualified.ods');
  expect(wb.getValue(wb.sheets[0].id, 0, 0)).toBe(20 + formula.length);
  expect(wb.getValue(wb.sheets[0].id, 0, 1)).toBe(21);
});

it.each(['xlsx', 'ods'])('retains qualified calls, ranges and names through repeated %s saves and edits', async (format) => {
  let wb = new Workbook({ sheets: [{ name: 'One' }, { name: 'Two Data' }], names: [
    { name: 'Rate', ref: '20', sheet: 'Two Data' },
    { name: 'Calc', ref: 'LAMBDA(x,x+Rate)', sheet: 'Two Data' },
    { name: 'Values', ref: "'Two Data'!$A$1:$A$2", sheet: 'Two Data' },
    { name: 'Total', ref: "'Two Data'!Calc(SUM('Two Data'!Values))" },
  ] });
  wb.setInput(wb.sheets[1].id, 0, 0, '3'); wb.setInput(wb.sheets[1].id, 1, 0, '7');
  wb.setInput(wb.sheets[0].id, 0, 0, '=Total');
  for (let i = 0; i < 3; i++) {
    const write = format === 'xlsx' ? workbookToXlsx : workbookToOds;
    wb = await workbookFromFile(await write(wb), `qualified.${format}`);
    expect(wb.getValue(wb.sheets[0].id, 0, 0)).toBe(30);
  }
  wb.setInput(wb.sheets[1].id, 1, 0, '17'); expect(wb.getValue(wb.sheets[0].id, 0, 0)).toBe(40);
  wb.undo(); expect(wb.getValue(wb.sheets[0].id, 0, 0)).toBe(30);
});

it.each(["'Two Data'.Rate", "'Two Data'.$$Rate", "'Two Data'.$$'Rate'"])(
  'imports hand-written OpenFormula named expression %s', async (formula) => {
    const escaped = formula.replace(/'/g, '&apos;');
    const xml = `<?xml version="1.0"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
      xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"
      office:mimetype="application/vnd.oasis.opendocument.spreadsheet" office:version="1.2">
      <office:body><office:spreadsheet><table:table table:name="One"><table:table-row>
      <table:table-cell table:formula="of:=${escaped}" office:value-type="float" office:value="20"/>
      </table:table-row></table:table><table:table table:name="Two Data"><table:named-expressions>
      <table:named-expression table:name="Rate" table:expression="of:=20" table:base-cell-address="&apos;Two Data&apos;.A1"/>
      </table:named-expressions></table:table></office:spreadsheet></office:body></office:document>`;
    const wb = await workbookFromFile(new TextEncoder().encode(xml), 'external.fods');
    expect(wb.getCell(wb.sheets[0].id, 0, 0).f).toBe("'Two Data'!Rate");
    expect(wb.getValue(wb.sheets[0].id, 0, 0)).toBe(20);
  },
);
