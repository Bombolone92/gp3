import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml } from '../src/core/clipboard.js';

const look = (wb, r, c) => wb.conditionalStyle(wb.activeSheetId, r, c, wb.getValue(wb.activeSheetId, r, c));
function book(r, c, line) {
  const cells = {};
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) cells[`${r + i},${c + j}`] = {
    v: i === 0 ? `Field ${j}` : i === 3 ? 'Total' : i + j, s: { bold: null },
  };
  return new Workbook({ sheets: [{ cells,
    ...(line === 'column' ? { colStyles: { [c]: { bold: true }, [c + 1]: { bold: true } } }
      : { rowStyles: Object.fromEntries([0, 1, 2, 3].map(i => [r + i, { bold: true }])) }),
    tables: [{ name: 'Items', range: { r1: r, c1: c, r2: r + 3, c2: c + 1 }, totalsRow: true,
      style: 'custom', customStyle: { wholeTable: { bold: false }, headerRow: { bold: true }, totalRow: { bold: true } } }],
  }] });
}
async function saved(wb, native) {
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  if (!native) return workbookFromFile(bytes, 'saved.xlsx');
  const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
}

it.each([[0, 0, 'column'], [5, 3, 'row'], [11, 8, 'column']])('keeps table bold over cell resets of %s/%s/%s defaults, including native imports', async (r, c, line) => {
  const wb = book(r, c, line);
  for (const back of [wb, new Workbook(wb.toJSON()), await saved(wb, false), await saved(wb, true)]) {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      expect(back.styleAt(back.activeSheetId, r + i, c + j).bold).toBeFalsy();
      expect(look(back, r + i, c + j).bold).toBe(i === 0 || i === 3);
    }
    back.setInput(back.activeSheetId, r + 1, c, '43');
    expect(look(back, r, c).bold).toBe(true);
    back.undo();
    expect(look(back, r + 3, c).bold).toBe(true);
  }
});

it('retains concrete direct font choices and lets resets expose the differential font', () => {
  const wb = book(1, 2, 'column'), id = wb.activeSheetId, range = { r1: 1, c1: 2, r2: 1, c2: 2 };
  wb.activeSheet.tables[0].customStyle.headerRow.font = 'courier';
  wb.setCells(id, [{ r: 1, c: 2, cell: { v: 'Field 0', s: { bold: false, font: 'arial' } } }]);
  expect(look(wb, 1, 2)).toMatchObject({ bold: false, font: 'arial' });
  wb.applyStyle(id, range, { bold: null, font: null });
  expect(look(wb, 1, 2)).toMatchObject({ bold: true, font: 'courier' });
  wb.undo();
  expect(look(wb, 1, 2)).toMatchObject({ bold: false, font: 'arial' });
});

it('exports the displayed table weight to clipboard HTML while preserving cell resets internally', () => {
  const wb = book(3, 4, 'column'), id = wb.activeSheetId;
  const cell = wb.getCell(id, 3, 4), style = look(wb, 3, 4);
  const html = cellsToHtml([['Field 0']], [[cell]], [[style]]);
  expect(html).toContain('font-weight:bold');
  expect(cell.s.bold).toBeNull();
});
