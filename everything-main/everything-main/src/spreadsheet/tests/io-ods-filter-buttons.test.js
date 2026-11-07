import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds, workbookToXlsx } from '../src/core/io.js';
function fixture({ buttons, filtered = false, format = 'fods', extra = '' } = {}) {
  const book = X.utils.book_new(), sheet = X.utils.aoa_to_sheet([['Value', 'Other'], [3, 5], [9, 10], [6, 11]]);
  sheet['!autofilter'] = { ref: 'A1:A4' }; X.utils.book_append_sheet(book, sheet, 'Data');
  const zip = format === 'ods' ? X.CFB.read(new Uint8Array(X.write(book, { type: 'array', bookType: 'ods' })), { type: 'array' }) : null;
  let xml = zip ? new TextDecoder().decode(X.CFB.find(zip, 'content.xml').content) : X.write(book, { type: 'string', bookType: 'fods' });
  xml = xml.replace(' table:display-filter-buttons="true"', () => buttons == null ? '' : ` table:display-filter-buttons="${buttons}"`);
  if (filtered) xml = xml.replace(/(<table:database-range\b[^>]*?)\/>/, (_, tag) => `${tag}><table:filter><table:filter-condition table:field-number="0" table:data-type="number" table:operator="&gt;" table:value="5"/></table:filter></table:database-range>`);
  xml = xml.replace('</table:database-ranges>', () => extra + '</table:database-ranges>');
  let bytes = new TextEncoder().encode(xml);
  if (zip) { X.CFB.utils.cfb_add(zip, 'content.xml', bytes); bytes = X.CFB.write(zip, { type: 'array', fileType: 'zip' }); }
  return workbookFromFile(bytes, `native.${format}`);
}
it.each(['ods', 'fods'].flatMap(format => [undefined, 'false', '0'].map(buttons => ({ format, buttons }))))('does not create a filter for an ordinary database range: %j', async opts => {
  const wb = await fixture(opts); expect(wb.activeSheet.filter).toBeNull(); expect([...wb.activeSheet.filterHidden]).toEqual([]);
  expect(wb.getValue(wb.activeSheetId, 2, 0)).toBe(9);
});
it.each(['true', '1'])('retains explicitly enabled filter buttons: %s', async buttons => {
  const wb = await fixture({ buttons });
  expect(wb.activeSheet.filter).toEqual({ range: { r1: 0, c1: 0, r2: 3, c2: 0 }, criteria: {} });
});
it.each([undefined, 'false', '0'])('retains active conditions with buttons=%s', async buttons => {
  const wb = await fixture({ buttons, filtered: true });
  expect(wb.activeSheet.filter.showButtons).toBe(false); expect([...wb.activeSheet.filterHidden]).toEqual([1]);
  wb.setInput(wb.activeSheetId, 1, 0, '12'); wb.reapplyFilter(wb.activeSheetId); expect([...wb.activeSheet.filterHidden]).toEqual([]);
});
it('does not let an ordinary database range replace an active filter', async () => {
  const extra = '<table:database-range table:name="Ordinary" table:target-range-address="$Data.$B$1:.$B$4"/>';
  const wb = await fixture({ buttons: 'true', filtered: true, extra });
  expect(wb.activeSheet.filter.range.c1).toBe(0); expect([...wb.activeSheet.filterHidden]).toEqual([1]);
});
it('preserves hidden buttons through copies, serialization, criteria edits, and undo', async () => {
  let wb = await fixture({ filtered: true });
  wb = new Workbook(wb.toJSON());
  const copy = wb.duplicateSheet(wb.activeSheetId); expect(copy.filter.showButtons).toBe(false); expect([...copy.filterHidden]).toEqual([1]);
  wb.setFilterCriteria(copy.id, 0, { op: 'gt', value: 8 }); expect(copy.filter.showButtons).toBe(false); expect([...copy.filterHidden]).toEqual([1, 3]);
  wb.undo(); expect(wb.sheet(copy.id).filter.showButtons).toBe(false); expect([...wb.sheet(copy.id).filterHidden]).toEqual([1]);
  wb.redo(); expect(wb.sheet(copy.id).filter.showButtons).toBe(false);
  const destination = new Workbook(); destination.importSheets(wb); expect(destination.sheets[1].filter.showButtons).toBe(false);
  destination.replaceSheetWith(destination.activeSheetId, wb, wb.activeSheetId); expect(destination.activeSheet.filter.showButtons).toBe(false);
});
it.each([
  ['insert rows', (wb, id) => wb.insertRows(id, 0)], ['delete rows', (wb, id) => wb.deleteRows(id, 1)],
  ['insert columns', (wb, id) => wb.insertCols(id, 0)], ['delete columns', (wb, id) => wb.deleteCols(id, 1)],
  ['move rows', (wb, id) => wb.moveRows(id, 0, 4, 7)], ['move columns', (wb, id) => wb.moveCols(id, 0, 1, 4)],
  ['insert cells', (wb, id) => wb.insertCells(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'down')],
  ['delete cells', (wb, id) => wb.deleteCells(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, 'up')],
])('preserves button visibility after %s and undo/redo', async (_, action) => {
  const wb = await fixture({ filtered: true }), id = wb.activeSheetId; wb.clearHistory();
  action(wb, id); expect(wb.activeSheet.filter.showButtons).toBe(false);
  wb.undo(); expect(wb.activeSheet.filter.showButtons).toBe(false); expect([...wb.activeSheet.filterHidden]).toEqual([1]);
  wb.redo(); expect(wb.activeSheet.filter.showButtons).toBe(false);
});
it.each([[workbookToOds, 'ods'], [workbookToXlsx, 'xlsx']])('preserves button visibility through %s export', async (exporter, ext) => {
  let wb = await fixture({ filtered: true });
  for (let i = 0; i < 2; i++) {
    const bytes = new Uint8Array(await (await exporter(wb)).arrayBuffer());
    if (ext === 'ods') {
      const zip = X.CFB.read(bytes, { type: 'array' }), xml = new TextDecoder().decode(X.CFB.find(zip, 'content.xml').content);
      expect(xml).toContain('table:display-filter-buttons="false"');
    }
    wb = await workbookFromFile(bytes, `saved.${ext}`); expect(wb.activeSheet.filter.showButtons).toBe(false); expect([...wb.activeSheet.filterHidden]).toEqual([1]);
  }
});
it('retains hidden button state after clearing criteria and saving, and lets a new filter show buttons', async () => {
  let wb = await fixture({ filtered: true }); wb.setFilterCriteria(wb.activeSheetId, 0, null);
  wb = await workbookFromFile(await workbookToOds(wb), 'cleared.ods');
  expect(wb.activeSheet.filter.showButtons).toBe(false); expect(wb.activeSheet.filter.criteria).toEqual({});
  wb.setFilterRange(wb.activeSheetId, { r1: 0, c1: 0, r2: 3, c2: 0 }); expect(wb.activeSheet.filter.showButtons).not.toBe(false);
});
it('preserves hidden buttons when resizing a table and undoing the resize', async () => {
  const wb = await fixture({ filtered: true }), id = wb.activeSheetId;
  wb.addTable(id, { r1: 0, c1: 0, r2: 3, c2: 0 }, { name: 'Items' });
  wb.activeSheet.filter.showButtons = false;
  wb.setFilterCriteria(id, 0, { op: 'gt', value: 5 }); wb.clearHistory();
  expect(wb.resizeTable(id, wb.activeSheet.tables[0].id, { r1: 0, c1: 0, r2: 4, c2: 0 })).toBe(true);
  expect(wb.activeSheet.filter.showButtons).toBe(false);
  wb.undo(); expect(wb.activeSheet.filter.showButtons).toBe(false); expect([...wb.activeSheet.filterHidden]).toEqual([1]);
  wb.redo(); expect(wb.activeSheet.filter.showButtons).toBe(false);
});
