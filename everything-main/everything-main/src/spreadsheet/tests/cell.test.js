import { describe, it, expect } from 'vitest';
import { colName, colIndex, cellName, parseCellRef, parseRange, rangeName, rangeContains } from '../src/core/cell.js';

describe('column names', () => {
  it('converts indexes to letters and back', () => {
    expect(colName(0)).toBe('A');
    expect(colName(25)).toBe('Z');
    expect(colName(26)).toBe('AA');
    expect(colName(701)).toBe('ZZ');
    expect(colName(702)).toBe('AAA');
    for (const i of [0, 1, 25, 26, 27, 51, 52, 701, 702, 16383]) expect(colIndex(colName(i))).toBe(i);
  });

  it('rejects non-letters', () => {
    expect(colIndex('')).toBe(-1);
    expect(colIndex('A1')).toBe(-1);
  });
});

describe('references', () => {
  it('parses A1 with absolute markers', () => {
    expect(parseCellRef('B3')).toEqual({ r: 2, c: 1, absR: false, absC: false });
    expect(parseCellRef('$B$3')).toEqual({ r: 2, c: 1, absR: true, absC: true });
    expect(parseCellRef('b3')).toEqual({ r: 2, c: 1, absR: false, absC: false });
    expect(parseCellRef('B0')).toBeNull();
    expect(parseCellRef('3B')).toBeNull();
    expect(parseCellRef('')).toBeNull();
  });

  it('parses and normalizes ranges', () => {
    expect(parseRange('B3:A1')).toEqual({ r1: 0, c1: 0, r2: 2, c2: 1 });
    expect(parseRange('C7')).toEqual({ r1: 6, c1: 2, r2: 6, c2: 2 });
    expect(parseRange('A1:B2:C3')).toBeNull();
    expect(rangeName({ r1: 2, c1: 1, r2: 0, c2: 0 })).toBe('A1:B3');
    expect(rangeName({ r1: 0, c1: 0, r2: 0, c2: 0 })).toBe('A1');
    expect(cellName(0, 27)).toBe('AB1');
  });

  it('tests containment', () => {
    const range = parseRange('B2:D4');
    expect(rangeContains(range, 1, 1)).toBe(true);
    expect(rangeContains(range, 3, 3)).toBe(true);
    expect(rangeContains(range, 0, 1)).toBe(false);
    expect(rangeContains(range, 4, 1)).toBe(false);
  });
});
