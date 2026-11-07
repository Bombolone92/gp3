import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

const parser = new (new JSDOM('').window.DOMParser)();
async function exported(wb) {
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' });
  const xml = path => parser.parseFromString(new TextDecoder().decode(X.CFB.find(zip, path).content), 'application/xml');
  const book = X.CFB.find(zip, '/xl/workbook.xml');
  book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  book.size = book.content.length;
  return { xml, external: () => workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx') };
}
function setup(r, c, totalsRow = false) {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [['Code', 'Amount'], ['007', 1234.5], ['008', 2345.6], ['009', 3456.7]].flatMap((row, i) => row.map((v, j) => ({ r: r + i, c: c + j,
    cell: { v, ...(i && j ? { s: { fmt: 'currency', dec: 2, group: true } } : {}) } }))));
  const table = wb.addTable(id, { r1: r, c1: c, r2: r + 3, c2: c + 1 }, { totalsRow });
  return { wb, id, table };
}

it.each([[0, 0, false], [3, 4, false], [2, 1, true]])('writes a table filter once, with relative columns and numeric criteria (%i,%i,%s)', async (r, c, totals) => {
  const { wb, id } = setup(r, c, totals);
  wb.setFilterCriteria(id, c + 1, { values: [wb.getDisplay(id, r + 1, c + 1)] });
  const file = await exported(wb), sheet = file.xml('/xl/worksheets/sheet1.xml'), table = file.xml('/xl/tables/table1.xml');
  expect(sheet.querySelector('autoFilter')).toBeNull();
  expect(file.xml('/xl/workbook.xml').querySelector('definedName[name="_xlnm._FilterDatabase"]')).toBeNull();
  expect(table.querySelectorAll('autoFilter')).toHaveLength(1);
  expect(table.querySelector('autoFilter').getAttribute('ref')).toBe(X.utils.encode_range({ s: { r, c }, e: { r: r + 3, c: c + 1 } }));
  expect(table.querySelector('filterColumn').getAttribute('colId')).toBe('1');
  expect(table.querySelector('filter').getAttribute('val')).toBe('1234.5');
  const back = await file.external();
  expect([...back.activeSheet.filterHidden]).toEqual([r + 2, r + 3]);
  expect(back.activeSheet.tables).toHaveLength(1);
  if (totals) expect(back.isRowHidden(back.activeSheetId, r + 4)).toBe(false);
  back.clearFilter(back.activeSheetId);
  expect(back.isRowHidden(back.activeSheetId, r + 2)).toBe(false);
});

it('preserves text filter semantics and conditional comparisons in table parts', async () => {
  const { wb, id } = setup(4, 2);
  wb.setFilterCriteria(id, 2, { op: 'eq', value: '007' });
  wb.setFilterCriteria(id, 3, { op: 'between', value: 1000, value2: 2000 });
  const file = await exported(wb), table = file.xml('/xl/tables/table1.xml');
  expect(table.querySelector('filterColumn[colId="0"] customFilter').getAttribute('val')).toBe('007');
  expect(table.querySelector('filterColumn[colId="1"] customFilters').getAttribute('and')).toBe('1');
  const back = await file.external();
  expect([...back.activeSheet.filterHidden]).toEqual([6, 7]);
  expect(back.activeSheet.filter.criteria[2]).toEqual({ op: 'eq', value: '007' });
});

it('keeps independent worksheet filters and scopes criteria only to the owning table', async () => {
  const { wb, id, table } = setup(0, 0);
  wb.setCells(id, [['Group'], ['A'], ['B']].map((row, i) => ({ r: i + 8, c: 3, cell: { v: row[0] } })));
  wb.setFilterRange(id, { r1: 8, c1: 3, r2: 10, c2: 3 });
  wb.setFilterCriteria(id, 3, { values: ['A'] });
  let file = await exported(wb);
  expect(file.xml('/xl/worksheets/sheet1.xml').querySelector('autoFilter').getAttribute('ref')).toBe('D9:D11');
  expect(file.xml('/xl/tables/table1.xml').querySelector('filterColumn')).toBeNull();
  expect((await file.external()).activeSheet.filter.range).toEqual({ r1: 8, c1: 3, r2: 10, c2: 3 });
  const second = wb.addTable(id, { r1: 8, c1: 3, r2: 10, c2: 3 });
  wb.setFilterCriteria(id, 3, { values: ['B'] });
  file = await exported(wb);
  expect(file.xml('/xl/worksheets/sheet1.xml').querySelector('autoFilter')).toBeNull();
  expect(file.xml('/xl/tables/table1.xml').querySelector('filterColumn')).toBeNull();
  expect(file.xml('/xl/tables/table2.xml').querySelector('filter').getAttribute('val')).toBe('B');
  expect(second).not.toBe(table);
});

it('retains the ODS database-range export and table-free XLSX filters', async () => {
  const { wb, id } = setup(0, 0);
  wb.setFilterCriteria(id, 0, { values: ['007'] });
  const ods = await workbookFromFile(new Uint8Array(await (await workbookToOds(wb)).arrayBuffer()), 'table.ods');
  expect(ods.activeSheet.filter.criteria[0]).toEqual({ values: ['007'] });
  const plain = new Workbook(wb.toJSON()); plain.activeSheet.tables = [];
  const file = await exported(plain);
  expect(file.xml('/xl/worksheets/sheet1.xml').querySelector('filter').getAttribute('val')).toBe('007');
  expect(file.xml('/xl/workbook.xml').querySelector('definedName[name="_xlnm._FilterDatabase"]')).not.toBeNull();
});
