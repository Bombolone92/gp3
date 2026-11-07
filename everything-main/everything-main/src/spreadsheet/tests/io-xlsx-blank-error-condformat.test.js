import fs from 'node:fs';
import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { readXlsxConditionalFormats } from '../src/core/xlsx-condformat.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { cellName } from '../src/core/cell.js';
import { xmlText } from '../src/core/xlsx-export-styles.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';
import * as X from '../src/vendor/xlsx.mjs';

const native = JSON.parse(fs.readFileSync('tests/fixtures/reference-blank-error-condformat.json', 'utf8'));
const paint = { bg: '#b6e6ad' };
const look = (wb, r, c) => wb.conditionalStyle(wb.activeSheetId, r, c, wb.getValue(wb.activeSheetId, r, c));
const ruleXml = (type, formula, sqref, extra = '') => `<conditionalFormatting sqref="${sqref}"><cfRule type="${type}" dxfId="0" priority="1" ${extra}>${formula == null ? '' : `<formula>${xmlText(formula)}</formula>`}</cfRule></conditionalFormatting>`;
const ordinaryFormula = (type, cell) => type === 'containsBlanks' ? `LEN(TRIM(${cell}))=0`
  : type === 'notContainsBlanks' ? `LEN(TRIM(${cell}))>0` : type === 'containsErrors' ? `ISERROR(${cell})` : `NOT(ISERROR(${cell}))`;
async function imported(xml) {
  return workbookFromFile(otherProgramsXlsx({
    sheetXml: { Data: { tail: xml } },
    patch: { '/xl/styles.xml': xml => xml.replace(/<dxfs[^>]*(?:\/>|>[\s\S]*?<\/dxfs>)/,
      '<dxfs count="1"><dxf><fill><patternFill><bgColor rgb="FFB6E6AD"/></patternFill></fill></dxf></dxfs>') },
  }), 'native.xlsx');
}
async function nativeOnly(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
}
function populate(wb) {
  wb.setCells(wb.activeSheetId, native.cases.flatMap(({ value }, i) => native.types.map((_, c) => ({
    r: i + 1, c, cell: value && typeof value === 'object' ? { ...value } : { v: value },
  }))));
}
async function ordinary() {
  const wb = await imported(native.types.map((type, c) => ruleXml(type, ordinaryFormula(type, cellName(1, c)), `${cellName(1, c)}:${cellName(native.cases.length, c)}`)).join(''));
  populate(wb);
  return wb;
}

it('evaluates blank/error predicates for blanks, ordinary/Unicode spaces, booleans, text and seven errors', async () => {
  let wb = await ordinary();
  for (let pass = 0; pass < 3; pass++) {
    expect(wb.activeSheet.rules).toHaveLength(4);
    for (const [i, { label, matches }] of native.cases.entries()) for (let c = 0; c < 4; c++) {
      expect(!!look(wb, i + 1, c)?.bg, `${pass}: ${label} ${native.types[c]}`).toBe(matches[c]);
    }
    if (pass < 2) wb = await nativeOnly(wb);
  }
});

it.each(native.formulaResults)('honors the saved predicate formula $formula and its native logical/error conversion', async ({ formula, matches }) => {
  const wb = await imported(native.types.map((type, c) => ruleXml(type, formula, `${cellName(1, c)}:${cellName(4, c)}`)).join(''));
  for (const current of [wb, await nativeOnly(wb)]) {
    expect(current.activeSheet.rules).toHaveLength(formula == null ? 0 : 4);
    for (let r = 1; r <= 4; r++) for (let c = 0; c < 4; c++) expect(!!look(current, r, c)?.bg).toBe(matches[c]);
  }
});

it.each(native.anchors)('anchors $type formulas at the bounding corner of unordered/disjoint $sqref', async ({ c, type, formula, sqref, paint: expected }) => {
  let wb = await imported(ruleXml(type, formula, sqref));
  wb.setCells(wb.activeSheetId, Array.from({ length: 10 }, (_, r) => Array.from({ length: 4 }, (_, dx) => ({ r, c: c + dx, cell: { v: (r * 3 + dx) % 5 } }))).flat());
  for (let pass = 0; pass < 2; pass++) {
    expect([[6, c + 1], [7, c + 1], [2, c + 3], [3, c + 3]].map(([r, col]) => !!look(wb, r, col)?.bg)).toEqual(expected);
    if (!pass) wb = await nativeOnly(wb);
  }
});

it('keeps custom mixed references, dependencies, priority and stop rules live through edits and undo', async () => {
  const xml = ruleXml('notContainsBlanks', '$B3>$A$1', 'D7:D8 F3:F4', 'stopIfTrue="1"')
    + ruleXml('containsErrors', 'TRUE', 'D7:D8 F3:F4').replace('priority="1"', 'priority="2"').replace('dxfId="0"', 'dxfId="1"');
  const rules = readXlsxConditionalFormats(xml, { dxfs: [paint, { color: '#123456' }] });
  const wb = new Workbook({ sheets: [{ name: 'Data', rules }] }), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '10'); wb.setInput(id, 6, 1, '12'); wb.setInput(id, 2, 1, '4');
  expect(look(wb, 6, 3)).toEqual(paint);
  expect(look(wb, 2, 5)).toEqual({ color: '#123456' });
  wb.setInput(id, 0, 0, '20');
  expect(look(wb, 6, 3)).toEqual({ color: '#123456' });
  wb.undo(); expect(look(wb, 6, 3)).toEqual(paint);
  wb.setInput(id, 6, 1, '=NA()'); expect(look(wb, 6, 3)).toEqual(paint);
  const back = await nativeOnly(wb);
  back.setInput(back.activeSheetId, 6, 1, '1');
  expect(look(back, 6, 3)).toEqual({ color: '#123456' });
});

it('updates every blank/error predicate after edits, undo, sheet duplication and external HTML copy', async () => {
  const wb = await ordinary(), id = wb.activeSheetId;
  const before = [0, 1, 2, 3].map(c => !!look(wb, 1, c));
  wb.setCells(id, [0, 1, 2, 3].map(c => ({ r: 1, c, cell: { f: 'NA()' } })));
  expect([0, 1, 2, 3].map(c => !!look(wb, 1, c))).toEqual([false, true, true, false]);
  wb.undo(); expect([0, 1, 2, 3].map(c => !!look(wb, 1, c))).toEqual(before);
  wb.redo();
  const copied = wb.duplicateSheet(id);
  wb.setInput(copied.id, 1, 2, 'ordinary text');
  expect(wb.conditionalStyle(copied.id, 1, 2, 'ordinary text')).toBeNull();
  expect(wb.conditionalStyle(id, 1, 2, wb.getValue(id, 1, 2))).toEqual(paint);
  const g = { r1: 1, c1: 0, r2: 1, c2: 3 }, cells = wb.copyRange(id, g);
  const html = cellsToHtml([['#N/A', '#N/A', '#N/A', '#N/A']], cells, [[0, 1, 2, 3].map(c => wb.conditionalStyle(id, 1, c, wb.getValue(id, 1, c)))], [[0, 1, 2, 3].map(c => wb.getValue(id, 1, c))])
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try {
    const parsed = cellsFromHtmlRows(parseHtmlClipboard(html).rows);
    expect(parsed.map(({ cell }) => !!cell.s?.bg)).toEqual([false, true, true, false]);
    expect(parsed.map(({ cell }) => cell.v)).toEqual(Array(4).fill({ error: '#N/A' }));
  } finally { vi.unstubAllGlobals(); }
});

it('does not invent a missing predicate formula or resolve an invalid differential style', () => {
  for (const type of native.types) {
    expect(readXlsxConditionalFormats(ruleXml(type, null, 'B3:B8'), { dxfs: [paint] })).toEqual([]);
    expect(readXlsxConditionalFormats(ruleXml(type, 'TRUE', 'B3:B8'), { dxfs: [] })).toEqual([]);
  }
});
