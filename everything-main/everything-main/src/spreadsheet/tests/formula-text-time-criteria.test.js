import { afterEach, describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { setLocale } from '../src/core/format.js';
import { astToText } from '../src/core/formula/print.js';
import { parseFormula } from '../src/core/formula/parser.js';

afterEach(() => setLocale('en-US'));

function book(cells = {}) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (const [a1, text] of Object.entries(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(a1);
    wb.setInput(id, Number(m[2]) - 1, m[1].charCodeAt(0) - 65, text);
  }
  let r = 0;
  const calc = (formula) => { wb.setInput(id, r, 9, formula); return wb.getValue(id, r++, 9); };
  return { wb, id, calc };
}

describe('text positions count characters', () => {
  // LEN, LEFT, RIGHT and MID counted characters while FIND, SEARCH and REPLACE
  // counted UTF-16 units, so an emoji shifted every position after it by one
  // and REPLACE could cut a character in half.
  it('agrees between LEN, FIND, SEARCH, MID and REPLACE', () => {
    const { calc } = book();
    expect(calc('=LEN("😀-abc")')).toBe(5);
    expect(calc('=FIND("a","😀-abc")')).toBe(3);
    expect(calc('=SEARCH("B","😀-abc")')).toBe(4);
    expect(calc('=MID("😀-abc",FIND("a","😀-abc"),1)')).toBe('a');
    expect(calc('=LEFT("😀-abc",FIND("a","😀-abc")-1)')).toBe('😀-');
    expect(calc('=REPLACE("😀-abc",2,1,"X")')).toBe('😀Xabc');
    expect(calc('=FIND("c","abc😀c",4)')).toBe(5);
    expect(calc('=SEARCH("c*","abc😀c",4)')).toBe(5);
    expect(calc('=FIND("z","abc")')).toEqual({ error: '#VALUE!' });
    expect(calc('=FIND("a","abc",10)')).toEqual({ error: '#VALUE!' });
  });
});

describe('TRIM', () => {
  it('removes only spaces, leaving line breaks and non-breaking spaces to CLEAN and SUBSTITUTE', () => {
    const { calc } = book();
    expect(calc('=TRIM("a"&CHAR(10)&"b")')).toBe('a\nb');
    expect(calc('=LEN(TRIM(CHAR(160)&"a"))')).toBe(2);
    expect(calc('=TRIM("  a   b  ")')).toBe('a b');
  });
});

describe('numbers written as text', () => {
  it('coerces dates, times, currency and accounting negatives the way a cell reads them', () => {
    const { calc } = book({ A1: "'2024-01-15" });
    expect(calc('=VALUE("2024-01-15")')).toBe(45306);
    expect(calc('="2024-01-15"+0')).toBe(45306);
    expect(calc('="10:30"+0')).toBe(0.4375);
    expect(calc('=VALUE("$1,000")')).toBe(1000);
    expect(calc('=VALUE("(100)")')).toBe(-100);
    expect(calc('=A1+0')).toBe(45306);
    expect(calc('=VALUE("abc")')).toEqual({ error: '#VALUE!' });
    expect(calc('="TRUE"+0')).toEqual({ error: '#VALUE!' });
  });
});

describe('criteria with dates, percents and grouped numbers', () => {
  it('compares them as numbers', () => {
    const { calc } = book({ A1: '=DATE(2024,1,15)', A2: '=DATE(2024,2,1)', B1: '5', B2: '7', C1: '10%', C2: '0.1', D1: '1000' });
    expect(calc('=SUMIFS(B1:B2,A1:A2,">=2024-01-20")')).toBe(7);
    expect(calc('=COUNTIF(A1:A2,"1/15/2024")')).toBe(1);
    expect(calc('=COUNTIF(C1:C2,"10%")')).toBe(2);
    expect(calc('=COUNTIF(D1,"1,000")')).toBe(1);
    expect(calc('=COUNTIF(A1:A2,"<2024-02-01")')).toBe(1);
    expect(calc('=COUNTIF(A1:A2,"a*")')).toBe(0);
  });
});

describe('SUMIF and AVERAGEIF with a sum range of a different shape', () => {
  it('takes the sum range from its top-left cell in the shape of the criteria range', () => {
    const { calc } = book({ A1: '1', A2: '2', A3: '3', B1: '10', B2: '20', B3: '30' });
    expect(calc('=SUMIF(A1:A3,">0",B1)')).toBe(60);
    expect(calc('=SUMIF(A1:A3,">0",B1:B2)')).toBe(60);
    expect(calc('=SUMIF(A1:A3,">1",B1)')).toBe(50);
    expect(calc('=AVERAGEIF(A1:A3,">0",B1)')).toBe(20);
    expect(calc('=SUMIF(A1:A3,">0",B1:B3)')).toBe(60);
  });
});

describe('TIME', () => {
  it('truncates its parts and refuses a negative time', () => {
    const { calc } = book();
    expect(calc('=TIME(1.5,0,0)')).toBeCloseTo(1 / 24, 12);
    expect(calc('=TIME(0,0,90.9)')).toBeCloseTo(90 / 86400, 12);
    expect(calc('=TIME(-1,0,0)')).toEqual({ error: '#NUM!' });
    expect(calc('=TIME(25,0,0)')).toBeCloseTo(1 / 24, 12);
    expect(calc('=TIME(12,30,0)')).toBeCloseTo(0.520833333333333, 12);
  });
});

describe('WEEKDAY', () => {
  it('supports the 11 to 17 return types and truncates the type', () => {
    const { calc } = book();
    expect(calc('=WEEKDAY(DATE(2024,1,7),11)')).toBe(7); // a Sunday, Monday-first week
    expect(calc('=WEEKDAY(DATE(2024,1,7),17)')).toBe(1); // Sunday-first week
    expect(calc('=WEEKDAY(DATE(2024,1,7),12)')).toBe(6); // Tuesday-first week
    expect(calc('=WEEKDAY(DATE(2024,1,1),1.9)')).toBe(2);
    expect(calc('=WEEKDAY(DATE(2024,1,7),2)')).toBe(7);
    expect(calc('=WEEKDAY(DATE(2024,1,7),4)')).toEqual({ error: '#NUM!' });
  });
});

describe('printing a formula from its tree', () => {
  it('keeps the parentheses of a right-nested power', () => {
    expect(astToText(parseFormula('2^(3^2)'))).toBe('2^(3^2)');
    expect(astToText(parseFormula('(2^3)^2'))).toBe('2^3^2');
    expect(astToText(parseFormula('2-(3-1)'))).toBe('2-(3-1)');
  });
});
