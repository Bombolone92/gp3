import { expect, it } from 'vitest';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { xlsxColumnPixels } from '../src/core/xlsx-styles.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

// Georgia's widest digit is 1257/2048 em: 9px at 11pt/96dpi. The reader's
// inferred 11px width stretched each 177px item column to 216px.
it('uses the Normal font for Georgia invoice columns, including the sheet default', async () => {
  const bytes = otherProgramsXlsx({
    sheetNames: ['Invoice'],
    sheetXml: { Invoice: {
      head: '<sheetFormatPr defaultColWidth="8.73828125" defaultRowHeight="14.25"/>'
        + '<cols><col min="1" max="1" width="2.62890625" customWidth="1"/>'
        + '<col min="2" max="3" width="19.62890625" customWidth="1"/>'
        + '<col min="4" max="6" width="17.62890625" customWidth="1"/>'
        + '<col min="7" max="7" width="2.62890625" customWidth="1"/></cols>',
      rows: '<row r="1"><c r="B1" t="inlineStr"><is><t>Invoice</t></is></c></row>'
        + '<row r="15"><c r="D15"><v>50</v></c><c r="E15"><v>14</v></c><c r="F15"><f>D15*E15</f><v>700</v></c></row>',
      tail: '<mergeCells count="1"><mergeCell ref="B1:D1"/></mergeCells>',
    } },
    patch: { '/xl/styles.xml': xml => xml.replace('<scheme val="minor"/>', '').replace('<sz val="12"/>', '<sz val="11"/>').replace('<name val="Calibri"/>', '<name val="Georgia"/>') },
  });
  let wb = await workbookFromFile(bytes, 'invoice.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.activeSheet;
    expect(sheet.defaultColWidth).toBe(79);
    expect(Array.from({ length: 8 }, (_, c) => wb.colWidth(sheet.id, c))).toEqual([24, 177, 177, 159, 159, 159, 24, 79]);
    expect(wb.getCell(sheet.id, 0, 1).s).toMatchObject({ font: 'georgia', size: 44 / 3 });
    expect(sheet.merges).toEqual([{ r1: 0, c1: 1, r2: 0, c2: 3 }]);
    expect(wb.getValue(sheet.id, 14, 5)).toBe(700);
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
});

it('truncates the half-digit correction as specified by OOXML', () => {
  // With a 10px maximum digit width, rounding 128/10 adds an unwanted pixel
  // at this exact 1/256-character boundary.
  expect(xlsxColumnPixels({ width: 10.94921875 }, { name: 'Arial', sz: 13.5 })).toBe(109);
  expect(xlsxColumnPixels({ width: 10.953125 }, { name: 'Arial', sz: 13.5 })).toBe(110);
});
