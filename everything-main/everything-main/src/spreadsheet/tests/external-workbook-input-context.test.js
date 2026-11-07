import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const linked = "'[1]Data'!$A$1";
const fixture = (f = `${linked}+$B$1`, cells = { '0,1': { v: 1 } }, names = []) => new Workbook({ names,
  externalWorkbooks: { version: 1, books: [{ target: '/Source.xlsx', sheets: [{ name: 'Data', cells: null }] }] },
  sheets: [{ name: 'Report', rows: 1000000, cells: { ...cells, '0,0': { f, externalResult: { formula: f, value: 41 } } } }] });

it.each([
  ['direct', '$B$1', { '0,1': { v: 1 } }, [0, 1, '2']],
  ['transitive', '$B$1', { '0,1': { f: 'C1*2' }, '0,2': { v: 1 } }, [0, 2, '3']],
  ['sparse range interior', 'SUM(B1:B9)', { '0,1': { v: 1 } }, [4, 1, '7']],
  ['whole column', 'SUM(B:B)', { '0,1': { v: 1 } }, [900000, 1, '7']],
  ['blank input', '$B$1', {}, [0, 1, '7']],
  ['INDIRECT', 'INDIRECT(B1)', { '0,1': { v: 'C1' }, '0,2': { v: 1 } }, [0, 2, '3']],
  ['OFFSET', 'OFFSET(B1,1,0)', { '1,1': { v: 1 } }, [1, 1, '3']],
  ['resized SUMIF input', 'SUMIF(B1:B3,1,C1)', { '2,1': { v: 1 }, '2,2': { v: 1 } }, [2, 2, '3']],
  ['resized AVERAGEIF input', 'AVERAGEIF(B1:B3,1,C1)', { '2,1': { v: 1 }, '2,2': { v: 1 } }, [2, 2, '3']],
  ['spill child', 'C2', { '0,2': { f: 'SEQUENCE(B1)' }, '0,1': { v: 2 } }, [0, 1, '1']],
  ['fixed array child', 'C2', { '0,2': { f: 'B1:B2*2', array: { rows: 2, cols: 1 } }, '1,1': { v: 1 } }, [1, 1, '3']],
])('invalidates %s inputs before their first read and restores them on undo', (_, tail, cells, edit) => {
  const wb = fixture(`${linked}+${tail}`, cells), id = wb.activeSheetId;
  // No getValue before the edit: provenance belongs to the loaded state.
  wb.setInput(id, ...edit);
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
  wb.undo(); expect(wb.getValue(id, 0, 0)).toBe(41);
  wb.redo(); expect(wb.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
});
it('follows local names, including caller-relative references', () => {
  for (const name of [{ name: 'Input', ref: 'Report!$B$1' }, { name: 'Input', ref: 'B1', relative: true }]) {
    const wb = fixture(`${linked}+Input`, { '0,1': { v: 1 } }, [name]), id = wb.activeSheetId;
    wb.setInput(id, 0, 1, '3'); expect(wb.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
    wb.undo(); expect(wb.getValue(id, 0, 0)).toBe(41);
  }
});
it('recalculates IFERROR instead of forcing an error or retaining the old answer', () => {
  const wb = fixture(`IFERROR(${linked},B1)`), id = wb.activeSheetId;
  wb.setInput(id, 0, 1, '3'); expect(wb.getValue(id, 0, 0)).toBe(3);
});
it('retains a saved answer across unrelated edits, formatting, and a local namespace rename', () => {
  const wb = fixture(), id = wb.activeSheetId;
  wb.setInput(id, 9, 9, '100');
  wb.applyStyle(id, { r1: 0, c1: 1, r2: 0, c2: 1 }, { bold: true });
  wb.renameSheet(id, 'Renamed');
  expect(wb.getValue(id, 0, 0)).toBe(41);
  wb.undo(); expect(wb.getValue(id, 0, 0)).toBe(41);
});
it('does not treat formatting an empty cell as a new input to an opaque reader', () => {
  const wb = fixture(`${linked}+INDIRECT(B1)`, { '0,1': { v: 'C1' }, '0,2': { v: 1 } }), id = wb.activeSheetId;
  wb.applyStyle(id, { r1: 9, c1: 9, r2: 9, c2: 9 }, { bold: true });
  expect(wb.getValue(id, 0, 0)).toBe(41);
});
it('compares local inputs in the clipboard destination, even at the same address and sheet name', () => {
  const src = fixture(), dest = fixture(), id = dest.activeSheetId;
  dest.setInput(id, 0, 1, '9');
  dest.pasteCells(id, src.copyCells(src.activeSheetId, [0], [0]), 0, 0, { r: 0, c: 0 });
  expect(dest.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
});
it('keeps a copied absolute formula valid when its inputs match', () => {
  const src = fixture(), dest = fixture(), id = dest.activeSheetId;
  dest.pasteCells(id, src.copyCells(src.activeSheetId, [0], [0]), 8, 3, { r: 0, c: 0 });
  expect(dest.getValue(id, 8, 3)).toBe(41);
});
it.each([false, true])('binds new saved metadata after the entire write batch (reversed=%s)', reverse => {
  const wb = new Workbook({ externalWorkbooks: fixture().externalWorkbooks, sheets: [{ name: 'Report' }] }), id = wb.activeSheetId;
  const f = `${linked}+$B$1`;
  const entries = [{ r: 0, c: 0, cell: { f, externalResult: { formula: f, value: 41 } } }, { r: 0, c: 1, cell: { v: 1 } }];
  wb.setCells(id, reverse ? entries.reverse() : entries);
  expect(wb.getValue(id, 0, 0)).toBe(41);
  wb.undo(); wb.redo(); expect(wb.getValue(id, 0, 0)).toBe(41);
  wb.setInput(id, 0, 1, '3'); expect(wb.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
});
it('walks cyclic input graphs without entering calculation recursively', () => {
  const wb = fixture(`${linked}+B1`, { '0,1': { f: 'C1' }, '0,2': { f: 'B1' } }), id = wb.activeSheetId;
  expect(wb.getValue(id, 0, 0)).toBe(41);
  wb.setInput(id, 0, 2, '3'); expect(wb.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
  wb.undo(); expect(wb.getValue(id, 0, 0)).toBe(41);
});
it('persists invalidation in JSON and native XLSX without the private metadata sheet', async () => {
  const wb = fixture(), id = wb.activeSheetId;
  wb.setInput(id, 0, 1, '2');
  expect(new Workbook(wb.toJSON()).getValue(id, 0, 0)).toEqual({ error: '#REF!' });
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  const restored = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
  expect(restored.getValue(restored.activeSheetId, 0, 0)).toEqual({ error: '#REF!' });
  expect(restored.activeSheet.cells.get('0,0').f).toContain('$B$1');
});
it('uses available supporting values after input changes', () => {
  const wb = fixture(), id = wb.activeSheetId;
  wb.setInput(id, 0, 1, '2');
  const json = wb.toJSON(); json.externalWorkbooks.books[0].sheets[0].cells = { '0,0': 40 };
  expect(new Workbook(json).getValue(id, 0, 0)).toBe(42);
});
it('rejects malformed input provenance', () => {
  const json = fixture().toJSON(); json.sheets[0].cells['0,0'].externalResult.context.inputs = 'invalid';
  const wb = new Workbook(json);
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toEqual({ error: '#REF!' });
});
it('tracks 3D local dependencies, including a changed interior sheet', () => {
  const json = fixture(`${linked}+SUM(First:Last!B1)`).toJSON();
  delete json.sheets[0].cells['0,0'].externalResult.context;
  json.sheets.push(...['First', 'Middle', 'Last'].map(name => ({ name, cells: { '0,1': { v: 1 } } })));
  const wb = new Workbook(json), id = wb.activeSheetId;
  wb.setInput(wb.sheetByName('Middle').id, 0, 1, '3');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
  wb.undo(); expect(wb.getValue(id, 0, 0)).toBe(41);
});
it('tracks supporting data used by a local formula beside an unavailable source', () => {
  const json = fixture(`${linked}+B1`, { '0,1': { f: "'[2]Data'!$A$1" } }).toJSON();
  delete json.sheets[0].cells['0,0'].externalResult.context;
  json.externalWorkbooks.books.push({ target: '/Other.xlsx', sheets: [{ name: 'Data', cells: { '0,0': 1 } }] });
  const wb = new Workbook(json), id = wb.activeSheetId;
  expect(wb.getValue(id, 0, 0)).toBe(41);
  const changed = wb.toJSON(); changed.externalWorkbooks.books[1].sheets[0].cells['0,0'] = 3;
  expect(new Workbook(changed).getValue(id, 0, 0)).toEqual({ error: '#REF!' });
});
it('does not invalidate a mixed-source result when an unrelated supporting cell changes', () => {
  const f = `${linked}+'[2]Data'!$A$1`, json = fixture(f).toJSON();
  delete json.sheets[0].cells['0,0'].externalResult.context;
  json.externalWorkbooks.books.push({ target: '/Other.xlsx', sheets: [{ name: 'Data', cells: { '0,0': 1 } }] });
  const wb = new Workbook(json), changed = wb.toJSON();
  changed.externalWorkbooks.books[1].sheets[0].cells['9,9'] = 7;
  expect(new Workbook(changed).getValue(wb.activeSheetId, 0, 0)).toBe(41);
});
it('invalidates row-sensitive aggregates when visibility changes', () => {
  const wb = fixture(`${linked}+SUBTOTAL(109,B1:B3)`, { '1,1': { v: 1 } }), id = wb.activeSheetId;
  wb.setHidden(id, 'row', [1], true);
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
  wb.undo(); expect(wb.getValue(id, 0, 0)).toBe(41);
});
it('captures the completed filtered state when loading saved results', () => {
  const json = fixture(`${linked}+SUBTOTAL(109,B2:B3)`, { '0,1': { v: 'Value' }, '1,1': { v: 1 }, '2,1': { v: 2 } }).toJSON();
  delete json.sheets[0].cells['0,0'].externalResult.context;
  json.sheets[0].filter = { range: { r1: 0, c1: 1, r2: 2, c2: 1 }, criteria: { 1: { values: ['1'] } } };
  delete json.sheets[0].filterHidden;
  const wb = new Workbook(json), id = wb.activeSheetId;
  expect([...wb.activeSheet.filterHidden]).toEqual([2]);
  expect(wb.getValue(id, 0, 0)).toBe(41);
  wb.setFilterCriteria(id, 1, { values: ['2'] });
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
});
it('follows a long sparse formula chain without recursive graph traversal', () => {
  const cells = { '2000,1': { v: 1 } };
  for (let r = 0; r < 2000; r++) cells[`${r},1`] = { f: `B${r + 2}+1` };
  const wb = fixture(`${linked}+B1`, cells), id = wb.activeSheetId;
  expect(wb.getValue(id, 0, 0)).toBe(41);
  wb.setInput(id, 2000, 1, '3'); expect(wb.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
});
it('follows a local structured reference rather than just its table definition', () => {
  const json = fixture(`${linked}+SUM(Amounts[Value])`, { '0,1': { v: 'Value' }, '1,1': { v: 1 } }).toJSON();
  delete json.sheets[0].cells['0,0'].externalResult.context;
  json.sheets[0].tables = [{ id: 'amounts', name: 'Amounts', range: { r1: 0, c1: 1, r2: 1, c2: 1 } }];
  const wb = new Workbook(json), id = wb.activeSheetId;
  expect(wb.getValue(id, 0, 0)).toBe(41);
  wb.setInput(id, 1, 1, '7'); expect(wb.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
});
it('preserves simple reference inputs when serializing a single sheet', () => {
  const source = fixture(), copy = source.sheetToWorkbook(source.activeSheetId);
  expect(copy.getValue(copy.activeSheetId, 0, 0)).toBe(41);
  copy.setInput(copy.activeSheetId, 0, 1, '9');
  expect(copy.getValue(copy.activeSheetId, 0, 0)).toEqual({ error: '#REF!' });
});
it('tracks metadata-dependent CELL inputs without treating CELL row as a metadata read', () => {
  const sensitive = fixture(`${linked}+CELL("width",B1)`), sid = sensitive.activeSheetId;
  sensitive.setColWidth(sid, 1, 200);
  expect(sensitive.getValue(sid, 0, 0)).not.toBe(41);
  const row = fixture(`${linked}+CELL("row",B1)`), rid = row.activeSheetId;
  row.setInput(rid, 9, 9, '100');
  expect(row.getValue(rid, 0, 0)).toBe(41);
});
it.each([{ v: 1 }, { f: 'C1+1' }])('preserves unchanged inputs converted into supporting caches (%j)', input => {
  const f = `${linked}+Local!B1`, json = fixture(f, {}).toJSON();
  delete json.sheets[0].cells['0,0'].externalResult.context;
  json.sheets.push({ name: 'Local', cells: { '0,1': input, '0,2': { v: 0 } } });
  const wb = new Workbook(json), copy = wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: '/Report.xlsx' });
  expect(copy.getValue(copy.activeSheetId, 0, 0)).toBe(41);
  wb.setInput(wb.sheetByName('Local').id, 0, 1, '9');
  const stale = wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: '/Report.xlsx' });
  expect(stale.getValue(stale.activeSheetId, 0, 0)).toEqual({ error: '#REF!' });
});
it('retains the caller checks of local formulas when copying inputs', () => {
  const json = fixture(`${linked}+B1`, { '0,1': { f: 'SHEETS()' } }).toJSON();
  delete json.sheets[0].cells['0,0'].externalResult.context;
  json.sheets.push({ name: 'Other' });
  const wb = new Workbook(json), copy = wb.sheetToWorkbook(wb.activeSheetId);
  expect(copy.getValue(copy.activeSheetId, 0, 0)).toEqual({ error: '#REF!' });
});
it('does not rebind a result that observes a copied reference identity', () => {
  const f = `${linked}&FORMULATEXT(Local!B1)`, json = fixture(f, {}).toJSON();
  delete json.sheets[0].cells['0,0'].externalResult.context;
  json.sheets.push({ name: 'Local', cells: { '0,1': { f: '1+1' } } });
  const wb = new Workbook(json), copy = wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: '/Report.xlsx' });
  expect(copy.getValue(copy.activeSheetId, 0, 0)).not.toBe(41);
});
it('exports the preserved result after converting a local input to a native supporting cache', async () => {
  const f = `${linked}+Local!B1`, json = fixture(f, {}).toJSON();
  delete json.sheets[0].cells['0,0'].externalResult.context;
  json.sheets.push({ name: 'Local', cells: { '0,1': { f: 'C1+1' }, '0,2': { v: 0 } } });
  const source = new Workbook(json);
  let wb = source.sheetToWorkbook(source.activeSheetId, { sourceWorkbook: '/Report.xlsx' });
  for (let cycle = 0; cycle < 2; cycle++) {
    const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
    const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
    X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(41);
    expect(wb.externalWorkbooks.books[1].sheets[0].cells['0,1']).toBe(1);
  }
});
