import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

const read = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path).content);
function replace(zip, path, text) {
  const part = X.CFB.find(zip, path);
  part.content = new TextEncoder().encode(text); part.size = part.content.length;
}
function fixture(line, { message = `"left${line}right"`, array = false } = {}) {
  const formula = `Ledger[[#This Row],[Unit${line}cost]]*3`;
  const bytes = otherProgramsXlsx({ sheetNames: ['Data'], sheetXml: { Data: {
    rows: '<row r="1"><c r="A1" t="str"><v>Unit&#10;cost</v></c><c r="B1" t="str"><v>Amount</v></c><c r="C1" t="str"><v>Message</v></c></row>'
      + [3, 7].map((v, i) => `<row r="${i + 2}"><c r="A${i + 2}"><v>${v}</v></c><c r="B${i + 2}"><f>Ledger[[#This Row],[Unit&#10;cost]]*3</f></c><c r="C${i + 2}"><f>${message}</f></c></row>`).join(''),
    tail: '<tableParts count="1"><tablePart r:id="ledger"/></tableParts>',
  } } });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (path, xml) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(xml));
  add('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="ledger" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/ledger.xml"/></Relationships>');
  add('xl/tables/ledger.xml', `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Ledger" displayName="Ledger" ref="A1:C3" totalsRowCount="0"><tableColumns count="3"><tableColumn id="1" name="Unit&#10;cost"/><tableColumn id="2" name="Amount"><calculatedColumnFormula${array ? ' array="1"' : ''}>${formula}</calculatedColumnFormula></tableColumn><tableColumn id="3" name="Message"><calculatedColumnFormula>${message}</calculatedColumnFormula></tableColumn></tableColumns></table>`);
  replace(zip, '/[Content_Types].xml', read(zip, '/[Content_Types].xml').replace('</Types>', '<Override PartName="/xl/tables/ledger.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>'));
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
async function native(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  replace(zip, '/xl/workbook.xml', read(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return { xml: read(zip, '/xl/tables/table1.xml'), wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx') };
}

it.each(['\r\n', '\r', '\n', '&#10;', '&#xA;'])('normalizes XML line endings %j before reading calculated column formulas', async line => {
  let wb = await workbookFromFile(fixture(line), 'native.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const id = wb.activeSheetId, table = wb.activeSheet.tables[0];
    expect(table.calc[1]).toBe('Ledger[@[Unit\ncost]]*3');
    expect(table.calc[2]).toBe('"left\nright"');
    expect(wb.getValue(id, 1, 1)).toBe(9);
    expect(wb.getValue(id, 2, 1)).toBe(21);
    wb.addTableRow(id, table.id);
    wb.setInput(id, 3, 0, '11');
    expect(wb.getValue(id, 3, 1)).toBe(33);
    expect(wb.getValue(id, 3, 2)).toBe('left\nright');
    wb.undo(); wb.undo();
    expect(wb.activeSheet.tables[0].range.r2).toBe(2);
    const result = await native(wb);
    expect(result.xml).not.toContain('&#13;');
    wb = result.wb;
  }
});

it.each(['&#13;', '&#xD;', '&#13;\n'])('preserves explicit carriage return references %s in formula literals', async encoded => {
  let wb = await workbookFromFile(fixture('\r\n', { message: `"a${encoded}b"` }), 'explicit.xlsx');
  const expected = `"a\r${encoded.endsWith('\n') ? '\n' : ''}b"`;
  for (let pass = 0; pass < 2; pass++) {
    expect(wb.activeSheet.tables[0].calc[2]).toBe(expected);
    const result = await native(wb);
    expect(result.xml).toContain('&#13;');
    wb = result.wb;
  }
});

it('retains array-column semantics and decodes entities only once', async () => {
  const wb = await workbookFromFile(fixture('\r\n', { array: true, message: '"a&amp;#13;b"' }), 'array.xlsx');
  expect(wb.activeSheet.tables[0].calcArray[1]).toBe(true);
  expect(wb.activeSheet.tables[0].calc[1]).toBe('Ledger[@[Unit\ncost]]*3');
  expect(wb.activeSheet.tables[0].calc[2]).toBe('"a&#13;b"');
  const result = await native(wb);
  expect(result.wb.activeSheet.tables[0].calcArray[1]).toBe(true);
  expect(result.wb.activeSheet.tables[0].calc[2]).toBe('"a&#13;b"');
});
