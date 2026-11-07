import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { FUNCTIONS, compareValues, criteriaMatcher } from '../src/core/formula/functions.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as XLSX from '../src/vendor/xlsx.mjs';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-comparison-spaces.json', import.meta.url)));
const separators = native.rows.filter(row => /\p{Zs}/u.test(row.value)).map(row => row.value[1]);
const range = values => ({ range: true, values: values.map(v => [v]) });
function controls() {
  const wb = new Workbook(), id = wb.activeSheetId;
  native.rows.forEach((row, i) => wb.setCells(id, [
    { r: i + 1, c: 1, cell: { v: row.value } }, { r: i + 1, c: 2, cell: { v: row.criterion } },
    ...row.results.map(({ formula }, c) => ({ r: i + 1, c: c + 3, cell: { f: formula } })),
  ]));
  return wb;
}
function check(wb) {
  native.rows.forEach((row, i) => row.results.forEach(({ formula, value }, c) => {
    expect(wb.getValue(wb.activeSheetId, i + 1, c + 3), `${row.code}: ${formula}`).toEqual(value);
  }));
}

describe('Excel space-separator comparison', () => {
  it('agrees with all 600 native Excel results, including distinct control characters and literal FIND/EXACT', () => check(controls()));

  it('preserves leading, repeated and trailing spaces and keeps the number of wildcard characters', () => {
    for (const space of separators) {
      expect(compareValues(`${space}MiXeD${space}Case${space}`, ' mixed case ')).toBe(0);
      expect(compareValues(`a${space}${space}b`, 'a b')).not.toBe(0);
      expect(compareValues(`a${space}`, 'a')).not.toBe(0);
      expect(criteriaMatcher('a ?')(`a${space}b`)).toBe(true);
      expect(criteriaMatcher(`a${space}~?`)('a ?')).toBe(true);
      expect(criteriaMatcher('a?b')(`a${space}${space}b`)).toBe(false);
      expect(criteriaMatcher('a??b')(`a${space}${space}b`)).toBe(true);
      expect(criteriaMatcher('a~* *')(`a*${space}more`)).toBe(true);
    }
    for (const text of ['a\tb', 'a\nb', 'a\rb', 'a\u2028b', 'a\u2029b', 'ab']) {
      expect(criteriaMatcher('a b')(text)).toBe(false);
    }
  });

  it('uses the same identity in scanned and indexed conditional aggregates', () => {
    const keys = range(separators.map(s => `Left${s}Right`));
    const amounts = range(separators.map((_, i) => i + 1));
    const n = separators.length, total = n * (n + 1) / 2;
    // The first COUNTIF scans; its second call builds the shared range index.
    for (let pass = 0; pass < 3; pass++) {
      expect(FUNCTIONS.COUNTIF.fn([keys, 'left right'])).toBe(n);
      expect(FUNCTIONS.COUNTIFS.fn([keys, 'LEFT\u2007RIGHT', amounts, '>1'])).toBe(n - 1);
      expect(FUNCTIONS.SUMIF.fn([keys, 'left\u3000right', amounts])).toBe(total);
      expect(FUNCTIONS.SUMIFS.fn([amounts, keys, 'left right'])).toBe(total);
      expect(FUNCTIONS.AVERAGEIF.fn([keys, 'left right', amounts])).toBe(total / n);
      expect(FUNCTIONS.AVERAGEIFS.fn([amounts, keys, 'left right'])).toBe(total / n);
      expect(FUNCTIONS.MINIFS.fn([amounts, keys, 'left right'])).toBe(1);
      expect(FUNCTIONS.MAXIFS.fn([amounts, keys, 'left right'])).toBe(n);
    }
  });

  it('uses the same identity in scanned/indexed, forward/reverse and wildcard lookups', () => {
    const keys = range(['a\u00a0b', 'other', 'a\u2007b']), returns = range([11, 22, 33]);
    for (let pass = 0; pass < 3; pass++) {
      expect(FUNCTIONS.MATCH.fn(['a b', keys, 0])).toBe(1);
      expect(FUNCTIONS.XMATCH.fn(['a b', keys, 0, -1])).toBe(3);
      expect(FUNCTIONS.XLOOKUP.fn(['a b', keys, returns])).toBe(11);
      expect(FUNCTIONS.XLOOKUP.fn(['a b', keys, returns, undefined, 0, -1])).toBe(33);
      expect(FUNCTIONS.XMATCH.fn(['a *', keys, 2])).toBe(1);
    }
  });

  it('preserves SEARCH character offsets beside emoji and length-changing lowercase letters', () => {
    for (const pattern of ['a b', 'a *']) {
      expect(FUNCTIONS.SEARCH.fn([pattern, '😀İa\u3000b'])).toBe(3);
      expect(FUNCTIONS.SEARCH.fn([pattern, '😀İa\u3000b', 4])).toEqual({ error: '#VALUE!' });
    }
    expect(FUNCTIONS.FIND.fn(['a b', 'a\u00a0b'])).toEqual({ error: '#VALUE!' });
    expect(FUNCTIONS.EXACT.fn(['a b', 'a\u00a0b'])).toBe(false);
    expect(FUNCTIONS.LOWER.fn(['A\u00a0B'])).toBe('a\u00a0b');
  });

  it('recalculates after edits and undo, including conditional-format expressions', () => {
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, [{ r: 0, c: 0, cell: { v: 'a\u2007b' } }]);
    wb.setInput(id, 0, 1, '=COUNTIF(A:A,"a b")+COUNTIF(A:A,"a b")');
    wb.addRule(id, { type: 'formula', range: { r1: 0, c1: 0, r2: 4, c2: 0 }, value: 'COUNTIF($A$1:$A$5,A1)>1', style: { bg: '#abcdef' } });
    expect(wb.getValue(id, 0, 1)).toBe(2);
    wb.setCells(id, [{ r: 1, c: 0, cell: { v: 'a b' } }]);
    expect(wb.getValue(id, 0, 1)).toBe(4);
    expect(wb.conditionalStyle(id, 0, 0, wb.getValue(id, 0, 0))?.bg).toBe('#abcdef');
    wb.undo();
    expect(wb.getValue(id, 0, 1)).toBe(2);
    expect(wb.conditionalStyle(id, 0, 0, wb.getValue(id, 0, 0))?.bg).toBeUndefined();
  });

  it('retains formulas and original space characters through private and native XLSX saves', async () => {
    const wb = controls(), bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
    check(await workbookFromFile(bytes, 'comparison.xlsx'));
    const zip = XLSX.CFB.read(bytes, { type: 'array' }), part = XLSX.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
    const reopened = await workbookFromFile(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
    check(reopened);
    native.rows.forEach((row, i) => expect(reopened.getValue(reopened.activeSheetId, i + 1, 1)).toBe(row.value));
  });
});
