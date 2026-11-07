import { expect, it } from 'vitest';
import native from './fixtures/reference-numeric-comparison.json';
import { compareValues, compareStoredValues, FUNCTIONS } from '../src/core/formula/functions.js';
import { Workbook } from '../src/core/workbook.js';

const range = values => ({ range: true, values });
it.each(native.results)('compares $a and $b using the native operator and lookup contracts', q => {
  const relation = q.equal ? 0 : q.less ? -1 : 1;
  expect(compareValues(q.x, q.y)).toBe(relation);
  expect(compareValues(q.y, q.x)).toBe(q.reverseEqual ? 0 : q.reverseLess ? -1 : 1);
  const vector = range([[q.y], [q.x]]);
  // First use scans; repeated use exercises the shared exact-match index.
  for (let pass = 0; pass < 3; pass++) {
    expect(FUNCTIONS.MATCH.fn([q.x, vector, 0])).toBe(q.match);
    expect(FUNCTIONS.XMATCH.fn([q.x, vector, 0])).toBe(q.xmatch);
  }
  expect(FUNCTIONS.SORT.fn([vector]).values[0][0]).toBe(q.sortFirst);
});

it('keeps rounded comparisons transitive across decimal rounding boundaries', () => {
  const a = 1, b = 1 + 20 * 2 ** -52, c = 1 + 23 * 2 ** -52, d = 1 + 40 * 2 ** -52;
  expect(compareValues(a, b)).toBe(0);
  expect(compareValues(b, c)).toBe(-1);
  expect(compareValues(c, d)).toBe(0);
  expect(compareValues(a, d)).toBe(-1);
  expect(compareStoredValues(a, b)).toBe(-1);
});

it('handles zero, subnormal values and rounding past the largest finite double', () => {
  for (const [x, y, expected] of [[0, -0, 0], [0, Number.MIN_VALUE, -1], [Number.MIN_VALUE, 2 * Number.MIN_VALUE, -1],
    [Number.MAX_VALUE, Number.MAX_VALUE - 2 ** 971, 1], [Number.MAX_VALUE, Infinity, -1], [-Infinity, Infinity, -1], [Infinity, Infinity, 0]]) {
    expect(compareValues(x, y)).toBe(expected);
  }
});

it('preserves comparison semantics through formulas, criteria, ranking, sorting, editing and undo', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: 1 } }, { r: 1, c: 0, cell: { v: 1 + 20 * 2 ** -52 } }]);
  const expressions = ['A1=A2','A1<>A2','A1<A2','A1<=A2','A1>A2','A1>=A2','COUNTIF(A1:A2,A1)',
    'COUNTIF(A1:A2,">1")','SWITCH(A1,A2,7,8)','MATCH(A2,A1:A2,0)','XMATCH(A2,A1:A2,0)',
    'RANK.EQ(A2,A1:A2,1)','RANK.AVG(A1,A1:A2,1)','SUMIF(A1:A2,A1,{10;20})'];
  wb.setCells(id, expressions.map((f, r) => ({ r, c: 2, cell: { f } })));
  const read = () => expressions.map((_,r) => wb.getValue(id,r,2));
  const expected = [true,false,false,true,false,true,2,0,7,2,2,2,1,30];
  expect(read()).toEqual(expected);
  wb.setInput(id,1,0,'2');
  expect(read().slice(0,8)).toEqual([false,true,true,true,false,false,1,1]);
  wb.undo(); expect(read()).toEqual(expected);
});

it('uses stored order for approximate lookups, in scan, cached and binary paths', () => {
  const low = 1, high = 1 + 2 ** -52, higher = 1 + 2 ** -51;
  const ascending = range([[low], [high], [higher]]), descending = range([[higher], [high], [low]]);
  for (let pass = 0; pass < 3; pass++) {
    expect(FUNCTIONS.MATCH.fn([high, ascending, 1])).toBe(2);
    expect(FUNCTIONS.MATCH.fn([high, descending, -1])).toBe(2);
    for (const direction of [1, -1, 2]) {
      expect(FUNCTIONS.XMATCH.fn([high, ascending, -1, direction])).toBe(2);
      expect(FUNCTIONS.XMATCH.fn([high, ascending, 1, direction])).toBe(2);
    }
    expect(FUNCTIONS.XMATCH.fn([high, descending, 0, -2])).toBe(2);
    expect(FUNCTIONS.VLOOKUP.fn([high, ascending, 1, false])).toBe(high);
    expect(FUNCTIONS.HLOOKUP.fn([high, range([[low, high, higher]]), 1, false])).toBe(high);
  }
});

it('sorts worksheet rows by stored numbers even when their displayed values agree', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const values = [1 + 2 ** -51, 1, 1 + 2 ** -52];
  wb.setCells(id,values.flatMap((v,r)=>[{r,c:0,cell:{v}},{r,c:1,cell:{v:['high','low','middle'][r]}}]));
  wb.sortRange(id,{r1:0,c1:0,r2:2,c2:1},0,true);
  expect([0,1,2].map(r=>wb.getValue(id,r,1))).toEqual(['low','middle','high']);
  wb.undo();expect([0,1,2].map(r=>wb.getValue(id,r,0))).toEqual(values);
});
