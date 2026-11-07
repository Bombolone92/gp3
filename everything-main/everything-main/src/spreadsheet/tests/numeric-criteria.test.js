import fs from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook, cellFromInput } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { criteriaMatcher, toNumber } from '../src/core/formula/functions.js';
import { setLocale } from '../src/core/format.js';

const fixture = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/reference-${name}.json`, import.meta.url)));
const boundaries = fixture('numeric-text-boundaries');
const operators = fixture('numeric-criteria-operators');
const aggregates = fixture('numeric-criteria-aggregates');
afterEach(() => setLocale('en-US'));

function matrix(kind) {
  const w = new Workbook(), id = w.activeSheetId, checks = [];
  const rows = kind === 'boundaries' ? boundaries : kind === 'operators' ? operators.rows : aggregates;
  if (kind === 'boundaries') w.setCells(id, [{ r: 0, c: 25, cell: { v: 1 } }, { r: 1, c: 25, cell: { v: 7 } }]);
  if (kind === 'aggregates') w.setCells(id, [{ r: 0, c: 96, cell: { v: 7 } }]);
  rows.forEach((row, r) => {
    w.setCells(id, [{ r, c: 0, cell: { v: kind === 'boundaries' ? row.text : row.value } }]);
    const formulas = row.formulas || operators.criteria.map(c => `COUNTIF(A${r + 1},"${c}")`);
    formulas.forEach((f, c) => {
      w.setInput(id, r, c + 1, '=' + f);
      checks.push({ r, c: c + 1, f, expected: (row.expected || row.results)[c] });
    });
  });
  return { w, checks };
}

// Native Excel for Mac saved all 2,208 results. The fixtures preserve exact
// strings (including control characters), cell types and error results.
it.each(['boundaries', 'operators', 'aggregates'])('matches native Excel %s results through native-only XLSX saves', async kind => {
  let { w, checks } = matrix(kind);
  for (let pass = 0; pass < 2; pass++) {
    for (const { r, c, f, expected } of checks) expect(w.getValue(w.activeSheetId, r, c), `${kind}: ${f}`).toEqual(expected);
    if (pass) break;
    const z = X.CFB.read(new Uint8Array(await (await workbookToXlsx(w)).arrayBuffer()), { type: 'array' });
    const p = X.CFB.find(z, '/xl/workbook.xml');
    p.content = new TextEncoder().encode(new TextDecoder().decode(p.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); p.size = p.content.length;
    w = await workbookFromFile(X.CFB.write(z, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  }
});

it('updates criteria after edits and undo without conflating numeric and text comparison paths', () => {
  const w = new Workbook(), id = w.activeSheetId;
  w.setCells(id, [{ r: 0, c: 0, cell: { v: '١' } }, { r: 1, c: 0, cell: { v: '\u00a01\u00a0' } }]);
  ['=COUNTIF(A1:A2,1)', '=COUNTIF(A1:A2,"<>1")', '=COUNTIF(A1:A2,">=1")'].forEach((f, c) => w.setInput(id, 0, c + 1, f));
  const values = () => [1, 2, 3].map(c => w.getValue(id, 0, c));
  expect(values()).toEqual([1, 2, 0]);
  w.setInput(id, 0, 0, '1'); expect(values()).toEqual([1, 1, 1]);
  w.undo(); expect(values()).toEqual([1, 2, 0]);
  w.setCells(id, [{ r: 1, c: 0, cell: { v: '1' } }]); expect(values()).toEqual([2, 2, 0]);
});

it('keeps forgiving cell entry separate and invalidates numeric parsing when regional settings change', () => {
  expect(cellFromInput('\t1\t').v).toBe(1);
  expect(toNumber('\t1\t')).toEqual({ error: '#VALUE!' });
  expect(toNumber(' 1 ')).toBe(1);
  setLocale('en-US'); expect(criteriaMatcher(1234)('1.234')).toBe(false);
  setLocale('de-DE'); expect(criteriaMatcher(1234)('1.234')).toBe(true);
  expect(criteriaMatcher('=1.234')(1234)).toBe(true);
  setLocale('en-US'); expect(criteriaMatcher('=1.234')(1234)).toBe(false);
});
