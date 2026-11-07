import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const rule = (type, first = '', second = '', extra = {}) => `<dataValidation ${Object.entries({ type, sqref: 'A1:A3', showErrorMessage: '1', ...extra }).map(([k,v]) => `${k}="${escape(v)}"`).join(' ')}>${first === '' ? '' : `<formula1>${escape(first)}</formula1>`}${second === '' ? '' : `<formula2>${escape(second)}</formula2>`}</dataValidation>`;
async function open(rules, rows = [[0, 2], [0, 4], [0, 6]], options = {}) {
  const book = X.utils.book_new(); if (options.date1904) book.Workbook = { WBProps: { date1904: true } }; X.utils.book_append_sheet(book, X.utils.aoa_to_sheet(rows), 'Data');
  const zip = X.CFB.read(new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const entry = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  let xml = new TextDecoder().decode(entry.content);
  xml = xml.replace('</worksheet>', () => `<dataValidations count="1">${rules}</dataValidations></worksheet>`);
  if (options.transform) xml = options.transform(xml);
  entry.content = new TextEncoder().encode(xml); entry.size = entry.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
}
it.each([
  ['decimal', 'between', '2', '6', 4, 9], ['whole', 'between', '2', '6', 4, 4.5],
  ['decimal', 'notBetween', '2', '6', 9, 4], ['decimal', 'equal', '4', '', 4, 5],
  ['decimal', 'notEqual', '4', '', 5, 4], ['decimal', 'greaterThan', '4', '', 5, 4],
  ['decimal', 'lessThan', '4', '', 3, 4], ['decimal', 'greaterThanOrEqual', '4', '', 4, 3],
  ['decimal', 'lessThanOrEqual', '4', '', 4, 5], ['textLength', 'between', '2', '4', 'abc', 'abcde'],
  ['date', 'between', '40000', '50000', 45000, 60000], ['time', 'between', '.25', '.75', .5, .8],
])('imports %s %s rules and evaluates candidate input', async (type, operator, a, b, good, bad) => {
  const wb = await open(rule(type, a, b, { operator })), id = wb.activeSheetId;
  expect(wb.validationAt(id, 0, 0)).not.toBeNull();
  expect(wb.validateValue(id, 0, 0, good).ok).toBe(true); expect(wb.validateValue(id, 0, 0, bad).ok).toBe(false);
  if (type !== 'textLength') expect(wb.validateValue(id, 0, 0, 'abc').ok).toBe(false);
});
it('keeps relative formula bounds live for each candidate cell', async () => {
  const wb = await open(rule('whole', 'B1', 'B1+2')), id = wb.activeSheetId;
  expect(wb.validateValue(id, 0, 0, 3).ok).toBe(true); expect(wb.validateValue(id, 1, 0, 3).ok).toBe(false);
  wb.setInput(id, 1, 1, '2'); expect(wb.validateValue(id, 1, 0, 3).ok).toBe(true);
});
it('applies custom rules to multiple regions with rebased relative references', async () => {
  const wb = await open(rule('custom', 'A1>B1', '', { sqref: 'A1:A2 C3:C4' })), id = wb.activeSheetId;
  wb.setInput(id, 2, 3, '10'); expect(wb.validateValue(id, 2, 2, 5).ok).toBe(false); expect(wb.validateValue(id, 2, 2, 11).ok).toBe(true);
  expect(wb.validateValue(id, 0, 0, 3).ok).toBe(true); expect(wb.validateValue(id, 0, 0, 1).ok).toBe(false);
});
it('imports literal dropdown options, XML entities, and Unicode without Excel escape decoding', async () => {
  const wb = await open(rule('list', '"One,Two & 😀,_x0041_"')), id = wb.activeSheetId, v = wb.validationAt(id, 0, 0);
  expect(wb.listOptionsFor(id, v)).toEqual(['One', 'Two & 😀', '_x0041_']);
  expect(wb.validateValue(id, 0, 0, 'Other').ok).toBe(false);
});
it('uses the candidate row for relative dropdown sources', async () => {
  const wb = await open(rule('list', 'B1:B2')), id = wb.activeSheetId, v = wb.validationAt(id, 0, 0);
  expect(wb.listOptionsFor(id, v, { r: 0, c: 0 })).toEqual(['2', '4']);
  expect(wb.listOptionsFor(id, v, { r: 1, c: 0 })).toEqual(['4', '6']);
  expect(wb.validateValue(id, 1, 0, 2).ok).toBe(false); expect(wb.validateValue(id, 1, 0, 6).ok).toBe(true);
});
it('keeps absolute dropdown references fixed as the candidate moves', async () => {
  const wb = await open(rule('list', '$B$1:$B$2')), id = wb.activeSheetId;
  expect(wb.validateValue(id, 2, 0, 2).ok).toBe(true); expect(wb.validateValue(id, 2, 0, 6).ok).toBe(false);
});
it('preserves blank policy, rejection style and prompt messages', async () => {
  const wb = await open(rule('decimal', '2', '4', { allowBlank: '0', errorStyle: 'warning', showInputMessage: '1', prompt: 'Pick & choose 😀', error: 'Bad _x005F_x0041_' })), id = wb.activeSheetId;
  expect(wb.validationAt(id, 0, 0)).toMatchObject({ allowBlank: false, strict: false, prompt: 'Pick & choose 😀', message: 'Bad _x0041_' });
  expect(wb.validateValue(id, 0, 0, '').ok).toBe(false);
});
it.each(['stop','warning','information'])('preserves enabled and disabled %s alerts in native-only XLSX', async errorStyle => {
  for(const enabled of ['0','1']) {
    const wb=await open(rule('list','"One,Two"','',{errorStyle,showErrorMessage:enabled,errorTitle:'Pick & choose',error:'Use one of the options'}));
    const expected={errorStyle,showErrorMessage:enabled==='1',errorTitle:'Pick & choose',strict:enabled==='1'&&errorStyle==='stop'};
    expect(wb.activeSheet.validations[0]).toMatchObject(expected);
    const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'}),part=X.CFB.find(zip,'/xl/workbook.xml');
    part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
    const back=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'native.xlsx');
    expect(back.activeSheet.validations[0]).toMatchObject(expected);
    expect(back.validateValue(back.activeSheetId,0,0,'Other').ok).toBe(false);
  }
});
it('retains rule behavior when saved and reopened in XLSX', async () => {
  let wb = await open(rule('whole', '2', '6')); wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  expect(wb.validateValue(wb.activeSheetId, 1, 0, 4.5).ok).toBe(false); expect(wb.validateValue(wb.activeSheetId, 1, 0, 4).ok).toBe(true);
});
it('keeps large empty validation ranges sparse', async () => {
  const wb = await open(rule('whole', '0', '', { operator: 'greaterThan', sqref: 'A1:ZZ20000' }), []);
  expect(wb.activeSheet.validations).toHaveLength(1); expect(wb.activeSheet.cells.size).toBe(0);
  expect(wb.validateValue(wb.activeSheetId, 19999, 701, -1).ok).toBe(false);
});
it('ignores malformed target ranges without discarding valid rules or cells', async () => {
  const wb = await open(rule('whole', '2', '6', { sqref: 'A0' }) + rule('custom', 'A1>0'));
  expect(wb.activeSheet.validations).toHaveLength(1); expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(2);
});
it('normalizes literal date bounds from a 1904 workbook', async () => {
  const wb = await open(rule('date', '1', '3'), [[0]], { date1904: true }), id = wb.activeSheetId;
  expect(wb.validateValue(id, 0, 0, 1463).ok).toBe(true); expect(wb.validateValue(id, 0, 0, 1462).ok).toBe(false);
});
it('resolves worksheet namespace aliases', async () => {
  const wb = await open(rule('whole', '2', '6'), undefined, { transform: xml => xml.replace('<worksheet ', '<worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ').replace(/(<\/?)(worksheet|dataValidations|dataValidation|formula1|formula2)(?=[\s>])/g, '$1x:$2') });
  expect(wb.validateValue(wb.activeSheetId, 0, 0, 4.5).ok).toBe(false);
});
it('ignores foreign-namespace validation lookalikes', async () => {
  const wb = await open(rule('whole', '2', '6'), undefined, { transform: xml => xml.replace('<dataValidations ', '<dataValidations xmlns="urn:foreign" ') });
  expect(wb.activeSheet.validations).toEqual([]);
});
it('honors disabled alerts and input messages without disabling validity checks', async () => {
  const wb = await open(rule('whole', '2', '6', { showErrorMessage: '0', showInputMessage: '0', prompt: 'Do not display' }));
  expect(wb.validationAt(wb.activeSheetId, 0, 0)).toMatchObject({ strict: false, allowBlank: false });
  expect(wb.validationAt(wb.activeSheetId, 0, 0)).toMatchObject({ prompt: 'Do not display', showInputMessage: false });
  expect(wb.validateValue(wb.activeSheetId, 0, 0, '').ok).toBe(false);
  expect(wb.validateValue(wb.activeSheetId, 0, 0, 4.5).ok).toBe(false);
});
it.each(['0', '1'])('round-trips input titles and stored message bodies in public XLSX with visibility=%s', async flag => {
  const wb = await open(rule('list', '"Ready,Done"', '', { showInputMessage: flag, promptTitle: 'Status & _x005F_x0041_', prompt: 'Choose <carefully>', errorTitle: 'Check & choose' }));
  const expected = { promptTitle: 'Status & _x0041_', prompt: 'Choose <carefully>', errorTitle: 'Check & choose' };
  expect(wb.activeSheet.validations[0]).toMatchObject(expected);
  expect(wb.activeSheet.validations[0].showInputMessage !== false).toBe(flag === '1');
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'public.xlsx');
  expect(back.activeSheet.validations[0]).toMatchObject(expected);
  expect(back.activeSheet.validations[0].showInputMessage !== false).toBe(flag === '1');
  expect(back.validateValue(back.activeSheetId, 0, 0, 'Other').ok).toBe(false);
});
it('imports and saves a title-only input message', async () => {
  const wb = await open(rule('list', '"Ready,Done"', '', { showInputMessage: '1', promptTitle: 'Status' }));
  const back = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  expect(back.activeSheet.validations[0]).toMatchObject({ promptTitle: 'Status' });
  expect(back.activeSheet.validations[0].showInputMessage).not.toBe(false);
});
it('keeps comment-looking and escape-looking formula literals intact', async () => {
  const wb = await open(rule('custom', 'A1="_x0041_ & <!--text-->"'));
  expect(wb.validateValue(wb.activeSheetId, 0, 0, '_x0041_ & <!--text-->').ok).toBe(true);
  expect(wb.validateValue(wb.activeSheetId, 0, 0, 'Other').ok).toBe(false);
});
it('shares list value reads across candidates using the same absolute source', async () => {
  const wb = await open(rule('list', '$B$1:$B$3')), id = wb.activeSheetId;
  const original = wb._compute; let reads = 0;
  wb._compute = function(sheet, r, c) { if (c === 1) reads++; return original.call(this, sheet, r, c); };
  expect(wb.validateValue(id, 0, 0, 2).ok).toBe(true); const first = reads;
  expect(wb.validateValue(id, 1, 0, 4).ok).toBe(true); expect(wb.validateValue(id, 2, 0, 6).ok).toBe(true);
  expect(reads).toBe(first);
});

it('retains relative dropdown behavior through sheet duplication and XLSX reopening', async () => {
  let wb = await open(rule('list', 'B1:B2'));
  const copy = wb.duplicateSheet(wb.activeSheetId);
  expect(wb.validateValue(copy.id, 1, 0, 2).ok).toBe(false);
  expect(wb.validateValue(copy.id, 1, 0, 6).ok).toBe(true);
  wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  const saved = wb.sheetByName(copy.name);
  expect(wb.validateValue(saved.id, 1, 0, 2).ok).toBe(false);
  expect(wb.validateValue(saved.id, 1, 0, 6).ok).toBe(true);
});
it('keeps candidate-scoped structured list sources live after a column rename', async () => {
  const wb = await open(rule('list', '[@Amount]', '', { sqref: 'B5:B6' }), [[], [], [], ['Amount', 'Choice'], [3, 3], [9, 9]]), id = wb.activeSheetId;
  wb.addTable(id, { r1: 3, c1: 0, r2: 5, c2: 1 }, { name: 'Items' });
  expect(wb.validateValue(id, 4, 1, 3).ok).toBe(true);
  expect(wb.validateValue(id, 5, 1, 3).ok).toBe(false);
  wb.setInput(id, 3, 0, 'Price');
  expect(wb.validateValue(id, 4, 1, 3).ok).toBe(true);
  expect(wb.validateValue(id, 5, 1, 9).ok).toBe(true);
  wb.undo(); expect(wb.validateValue(id, 5, 1, 9).ok).toBe(true);
});
