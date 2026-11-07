import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const attrs = values => Object.entries(values).map(([key, value]) => ` table:${key}="${xml(value)}"`).join('');
const condition = (operator, value = '', extra = {}, items = []) => `<table:filter-condition${attrs({ 'field-number': 0, operator, value, ...extra })}>${items.map(value => `<table:filter-set-item table:value="${xml(value)}"/>`).join('')}</table:filter-condition>`;
function fixture(rows, predicate, { format = 'fods', ref, name = 'Data', before = false, rangeAttrs = {} } = {}) {
  const book = X.utils.book_new(), sheet = X.utils.aoa_to_sheet(rows);
  X.utils.book_append_sheet(book, sheet, name);
  const zip = format === 'ods' ? X.CFB.read(new Uint8Array(X.write(book, { type: 'array', bookType: 'ods' })), { type: 'array' }) : null;
  let content = zip ? new TextDecoder().decode(X.CFB.find(zip, 'content.xml').content) : X.write(book, { type: 'string', bookType: 'fods' });
  const definition = `<table:database-ranges><table:database-range${attrs({ name: 'NativeFilter', 'target-range-address': `$'${name.replaceAll("'", "''")}'.${ref || `$A$1:.$${X.utils.encode_col(rows[0].length - 1)}$${rows.length}`}`, 'contains-header': 'true', 'display-filter-buttons': 'true', ...rangeAttrs })}><table:filter>${predicate}</table:filter></table:database-range></table:database-ranges>`;
  content = before ? content.replace('<office:spreadsheet>', () => '<office:spreadsheet>' + definition) : content.replace('</office:spreadsheet>', () => definition + '</office:spreadsheet>');
  let bytes = new TextEncoder().encode(content);
  if (format === 'ods') {
    X.CFB.utils.cfb_add(zip, 'content.xml', bytes);
    bytes = X.CFB.write(zip, { type: 'array', fileType: 'zip' });
  }
  return workbookFromFile(bytes, `native.${format}`);
}
const hidden = wb => [...wb.activeSheet.filterHidden];
it.each(['fods', 'ods'])('imports native numeric conditions from %s and evaluates edits', async format => {
  const wb = await fixture([['Amount'], [3], [9]], condition('>', 5, { 'data-type': 'number' }), { format });
  expect(hidden(wb)).toEqual([1]);
  wb.setInput(wb.activeSheetId, 1, 0, '12'); wb.reapplyFilter(wb.activeSheetId);
  expect(hidden(wb)).toEqual([]);
  wb.setInput(wb.activeSheetId, 2, 0, '2'); wb.reapplyFilter(wb.activeSheetId);
  expect(hidden(wb)).toEqual([2]);
});
it.each([
  ['=', [1, 3, 4, 5]], ['!=', [2, 4, 5]], ['>', [1, 2, 4, 5]],
  ['>=', [1, 4, 5]], ['<', [2, 3, 4, 5]], ['<=', [3, 4, 5]],
])('uses typed numeric %s comparisons', async (op, expected) => {
  const wb = await fixture([['Value'], [3], [5], [9], ['9'], [true]], condition(op, 5, { 'data-type': 'number' }));
  expect(hidden(wb)).toEqual(expected);
});
it.each([
  ['=', 'a*?', {}, [3, 4]], ['!=', 'a*?', {}, [1, 2]],
  ['=', 'a*?', { 'case-sensitive': 'true' }, [1, 3, 4]],
  ['!=', 'a*?', { 'case-sensitive': '1' }, [2]],
  ['contains', '*?', {}, [3, 4]], ['!contains', '*?', {}, [1, 2]],
  ['begins', 'A*', {}, [3, 4]], ['!begins', 'A*', {}, [1, 2]],
  ['ends', '*?', {}, [3, 4]], ['!ends', '*?', {}, [1, 2]],
  ['contains', 'A', { 'case-sensitive': 'true' }, [2, 3, 4]],
])('imports literal text %s %s with %j', async (op, value, extra, expected) => {
  const wb = await fixture([['Text'], ['A*?'], ['a*?'], ['abc'], ['xx']], condition(op, value, extra));
  expect(hidden(wb)).toEqual(expected);
});
it.each([['<', [2, 3]], ['<=', [3]], ['>', [1, 2]], ['>=', [1]]])('imports case-insensitive text %s comparisons', async (op, expected) => {
  const wb = await fixture([['Text'], ['apple'], ['Banana'], ['pear']], condition(op, 'banana'));
  expect(hidden(wb)).toEqual(expected);
});
it.each([['false', [4]], ['true', [2, 4]]])('imports value sets with case-sensitive=%s, entities and literal wildcards', async (sensitive, expected) => {
  const wb = await fixture([['Text'], ['A*?'], ['a*?'], ['& "quoted" ~'], ['abc']], condition('>', 999, { 'data-type': 'number', 'case-sensitive': sensitive }, ['A*?', '& "quoted" ~']));
  expect(hidden(wb)).toEqual(expected);
});
it.each([['empty', [2, 4]], ['!empty', [1, 3]]])('imports %s conditions without confusing zero with blanks', async (op, expected) => {
  const wb = await fixture([['Value'], [null], [0], [{ t: 's', f: '""', v: '' }], ['x']], condition(op));
  expect(hidden(wb)).toEqual(expected);
});
it('combines nested AND/OR conditions across fields relative to an offset range', async () => {
  const predicate = `<table:filter-or><table:filter-and>${condition('>', 5, { 'field-number': 1, 'data-type': 'number' })}${condition('=', 'yes', { 'field-number': 2 })}</table:filter-and>${condition('=', 'Keep')}</table:filter-or>`;
  const wb = await fixture([['outside'], [], [null, 'Label', 'Amount', 'Flag'], [null, 'Keep', 1, 'no'], [null, 'Other', 9, 'YES'], [null, 'Other', 4, 'yes'], [null, 'Other', 10, 'no']], predicate, { ref: '$B$3:.$D$7', name: "Plan's.data" });
  expect(wb.activeSheet.filter.range).toEqual({ r1: 2, c1: 1, r2: 6, c2: 3 }); expect(hidden(wb)).toEqual([5, 6]);
  expect(wb.activeSheet.filter.criteria[1].formula).toContain('$C4');
  wb.setInput(wb.activeSheetId, 5, 2, '6'); wb.reapplyFilter(wb.activeSheetId); expect(hidden(wb)).toEqual([6]);
});
it('resolves definitions appearing before sheet content', async () => {
  const wb = await fixture([['Value'], [3], [9]], condition('>', 5, { 'data-type': 'number' }), { before: true });
  expect(hidden(wb)).toEqual([1]);
});
it('preserves live conditions when copying sheets, undoing and reopening XLSX', async () => {
  let wb = await fixture([['Value'], [3], [9]], condition('>', 5, { 'data-type': 'number' }));
  const id = wb.activeSheetId, copy = wb.duplicateSheet(id);
  expect([...copy.filterHidden]).toEqual([1]);
  wb.setInput(copy.id, 1, 0, '10'); wb.reapplyFilter(copy.id); expect([...copy.filterHidden]).toEqual([]);
  wb.undo(); wb.reapplyFilter(copy.id); expect([...wb.sheet(copy.id).filterHidden]).toEqual([1]);
  wb.redo(); wb.reapplyFilter(copy.id); expect([...wb.sheet(copy.id).filterHidden]).toEqual([]);
  expect([...wb.sheet(id).filterHidden]).toEqual([1]);
  wb = await workbookFromFile(await workbookToXlsx(wb), 'native.xlsx');
  expect([...wb.sheets[0].filterHidden]).toEqual([1]); expect([...wb.sheets[1].filterHidden]).toEqual([]);
});
it.each([
  condition('match', 'a.*'), condition('=', 'x', { 'field-number': -1 }),
  condition('=', 'x', { 'field-number': 3 }), condition('>', 'oops', { 'data-type': 'number' }),
])('does not apply incomplete compound filters: %s', async unsupported => {
  const wb = await fixture([['Value'], [3], [9]], `<table:filter-and>${condition('>', 5, { 'data-type': 'number' })}${unsupported}</table:filter-and>`);
  expect(wb.activeSheet.filter.criteria).toEqual({}); expect(hidden(wb)).toEqual([]);
});
