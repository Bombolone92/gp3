import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

// Frozen panes travel in this app's sidecar; a file another program wrote has none, and its
// <pane state="frozen"> was ignored, so an Excel budget lost its frozen header on opening and
// the first autosave wrote the file back without it. The pane is read from the sheet's XML now.
const views = (pane) => `<sheetViews><sheetView workbookViewId="0">${pane}<selection pane="bottomRight" activeCell="B3" sqref="B3"/></sheetView></sheetViews>`;
const ROWS = '<row r="1"><c r="A1"><v>1</v></c></row>';

it('reads frozen rows and columns from another program\'s file, and keeps them through a save', async () => {
  const bytes = otherProgramsXlsx({
    sheetNames: ['Data', 'Split', 'Plain', 'Wide'],
    sheetXml: {
      Data: { head: `<dimension ref="A1"/>${views('<pane xSplit="1" ySplit="2" topLeftCell="B3" activePane="bottomRight" state="frozen"/>')}`, rows: ROWS },
      Split: { head: views('<pane xSplit="2400" ySplit="1200" topLeftCell="C4" activePane="bottomRight" state="split"/>'), rows: ROWS },
      Plain: { head: views(''), rows: ROWS },
      Wide: { head: views('<pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozenSplit"/>'), rows: ROWS },
    },
  });
  const wb = await workbookFromFile(bytes, 'budget.xlsx');
  const [data, split, plain, wide] = wb.sheets;
  expect([data.frozenRows, data.frozenCols]).toEqual([2, 1]);
  expect([split.frozenRows, split.frozenCols]).toEqual([0, 0]); // a split pane's splits are distances, not counts
  expect([plain.frozenRows, plain.frozenCols]).toEqual([0, 0]);
  expect([wide.frozenRows, wide.frozenCols]).toEqual([3, 0]);
  expect(wb.getValue(data.id, 0, 0)).toBe(1);
  const back = await workbookFromFile(await workbookToXlsx(wb), 'budget.xlsx');
  expect([back.sheets[0].frozenRows, back.sheets[0].frozenCols]).toEqual([2, 1]);
  expect([back.sheets[3].frozenRows, back.sheets[3].frozenCols]).toEqual([3, 0]);
});

it('uses a native pane edited after export instead of stale sidecar dimensions', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data' }] });
  wb.setInput(wb.activeSheetId, 0, 0, '1');
  wb.setFrozen(wb.activeSheetId, 3, 0);
  const saved = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  // Another editor changed the actual pane. Its dimensions and origin must agree;
  // the retained sidecar describes the previous layout and cannot override them.
  const { default: X } = await import('../src/vendor/xlsx.mjs').then((m) => ({ default: m }));
  const zip = X.CFB.read(saved, { type: 'array' });
  const sheet = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  const xml = new TextDecoder().decode(sheet.content).replace(/<sheetViews>[\s\S]*?<\/sheetViews>|(<sheetData)/, (m, open) => `${views('<pane xSplit="1" ySplit="1" state="frozen"/>')}${open || ''}`);
  sheet.content = new TextEncoder().encode(xml);
  sheet.size = sheet.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'mine.xlsx');
  expect([back.sheets[0].frozenRows, back.sheets[0].frozenCols]).toEqual([1, 1]);
  expect(back.sheets[0].viewOrigin).toEqual({ r: 1, c: 1 });
});
