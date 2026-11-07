import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// SUMIF, COUNTIF, AVERAGEIF and the *IFS family read a number stored as text against a numeric
// criterion as the number it spells: a column imported from a CSV with a '5 in it
// counts towards COUNTIF(A1:A3,5). Ordered numeric criteria consider numbers only;
// <>5 also counts numeric text. MATCH, XLOOKUP and the = operator
// keep text and numbers apart.
const D = { A1: 5, A2: "'5", A3: 3, B1: 1, B2: 2, B3: 4 };

describe('conditional aggregates over numbers stored as text', () => {
  it('count a text "5" against the criterion 5, "5" or "=5"', () => {
    expect(calc('COUNTIF(A1:A3,5)', D)).toBe(2);
    expect(calc('COUNTIF(A1:A3,"5")', D)).toBe(2);
    expect(calc('COUNTIF(A1:A3,"=5")', D)).toBe(2);
    expect(calc('COUNTIF(A1:A3,C1)', { ...D, C1: 5 })).toBe(2);
    expect(calc('SUMIF(A1:A3,5,B1:B3)', D)).toBe(3);
    expect(calc('SUMIFS(B1:B3,A1:A3,5)', D)).toBe(3);
    expect(calc('AVERAGEIF(A1:A3,5,B1:B3)', D)).toBe(1.5);
    expect(calc('AVERAGEIFS(B1:B3,A1:A3,"=5")', D)).toBe(1.5);
    expect(calc('MAXIFS(B1:B3,A1:A3,5)', D)).toBe(2);
    expect(calc('MINIFS(B1:B3,A1:A3,5)', D)).toBe(1);
  });

  it('keeps native numeric equality, inequality and ordering distinct', () => {
    expect(calc('COUNTIFS(A1:A3,">4")', D)).toBe(1);
    expect(calc('COUNTIF(A1:A3,">=5")', D)).toBe(1);
    expect(calc('COUNTIF(A1:A3,"<5")', D)).toBe(1);
    expect(calc('COUNTIF(A1:A3,"<>5")', D)).toBe(2);
    expect(calc('SUMIFS(B1:B3,A1:A3,"<=5")', D)).toBe(5);
    expect(calc('MINIFS(B1:B3,A1:A3,">3")', D)).toBe(1);
  });

  it('read the text the way a cell would: grouped digits, percents, currency', () => {
    const T = { A1: "'1,000", A2: "'10%", A3: "'$5", A4: 'abc', A5: "'5x" };
    expect(calc('COUNTIF(A1:A5,1000)', T)).toBe(1);
    expect(calc('COUNTIF(A1:A5,0.1)', T)).toBe(1);
    expect(calc('COUNTIF(A1:A5,5)', T)).toBe(1);
    expect(calc('COUNTIF(A1:A5,">0")', T)).toBe(0);
    expect(calc('COUNTIF(A1:A5,"<>5")', T)).toBe(5);
  });

  it('leave text that is no number, blanks, booleans and wildcards as they were', () => {
    expect(calc('COUNTIF(A1:A3,">0")', { A1: 'abc', A2: '', A3: '=""' })).toBe(0);
    expect(calc('COUNTIF(A1:A3,0)', { A2: 'x' })).toBe(0); // a blank cell is not 0 to COUNTIF
    expect(calc('COUNTIF(A1:A2,TRUE)', { A1: "'TRUE", A2: '=TRUE' })).toBe(1); // text "TRUE" is not the boolean
    expect(calc('COUNTIF(A1:A2,"5*")', D)).toBe(1); // a wildcard pattern matches text alone
    expect(calc('COUNTIF(A1:A3,"abc")', { A1: 'abc', A2: 5 })).toBe(1);
  });

  it('do not loosen MATCH, XLOOKUP or the = operator', () => {
    const S = { A1: "'5", A2: 5, B1: 'text', B2: 'number' };
    expect(calc('MATCH(5,A1:A2,0)', S)).toBe(2);
    expect(calc('XLOOKUP(5,A1:A2,B1:B2)', S)).toBe('number');
    expect(calc('A1=5', S)).toBe(false);
    expect(calc('SUMPRODUCT(--(A1:A2=5))', S)).toBe(1);
  });
});
