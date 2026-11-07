import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { calc } from './helpers/calc.js';

const E = (code) => ({ error: code });

describe('HYPGEOM.DIST with fewer successes than the sample must hold', () => {
  // A population of 10 with 8 successes has 2 failures, so 5 draws hold at least 3 successes:
  // #NUM! is documented when sample_s < max(0, number_sample - number_pop + population_s).
  // The cumulative branch started its sum at the impossible count and answered a stray term.
  it('is #NUM!, cumulative or not', () => {
    expect(calc('HYPGEOM.DIST(0,5,8,10,TRUE)')).toEqual(E('#NUM!'));
    expect(calc('HYPGEOM.DIST(2,5,8,10,TRUE)')).toEqual(E('#NUM!'));
    expect(calc('HYPGEOM.DIST(1,4,3,5,TRUE)')).toEqual(E('#NUM!'));
    expect(calc('HYPGEOM.DIST(0,5,8,10,FALSE)')).toEqual(E('#NUM!'));
    expect(calc('HYPGEOMDIST(2,5,8,10)')).toEqual(E('#NUM!'));
  });

  it('still sums from the lowest possible count', () => {
    // 5 draws from 8 successes and 2 failures: P(X=3) = C(8,3)C(2,2)/C(10,5) = 56/252, P(X=4) = 140/252.
    expect(calc('HYPGEOM.DIST(3,5,8,10,TRUE)')).toBeCloseTo(56 / 252, 14);
    expect(calc('HYPGEOM.DIST(4,5,8,10,TRUE)')).toBeCloseTo(196 / 252, 14);
    expect(calc('HYPGEOM.DIST(5,5,8,10,TRUE)')).toBe(1);
    expect(calc('HYPGEOM.DIST(2,4,3,5,TRUE)')).toBeCloseTo(6 / 10, 14); // 4 draws, 3 successes, 2 failures: P(X=2) = 3*1/5
    expect(calc('HYPGEOM.DIST(1,4,8,20,TRUE)')).toBeCloseTo(0.4654, 4); // the documented example
  });
});

describe('IRR and XIRR on flows of any size', () => {
  // The solver stopped once |NPV| fell under an absolute 1E-9, which flows of a billionth
  // satisfy at any rate, so it handed the guess back. The tolerance now follows the size
  // of the flows, as RATE's does.
  it('find the rate of a two-flow schedule whatever its magnitude', () => {
    // -a + 1.2a / (1 + r) = 0 has the one root r = 0.2.
    expect(calc('IRR({-1E-9,1.2E-9},0.5)')).toBeCloseTo(0.2, 10);
    expect(calc('IRR({-1E-9,1.2E-9})')).toBeCloseTo(0.2, 10);
    expect(calc('IRR({-1E-6,1.2E-6})')).toBeCloseTo(0.2, 10);
    expect(calc('IRR({-1,1.2})')).toBeCloseTo(0.2, 10);
    expect(calc('IRR({-1E12,1.2E12})')).toBeCloseTo(0.2, 10);
    expect(calc('XIRR({-1E-9,1.2E-9},{DATE(2020,1,1),DATE(2020,12,31)},0.5)')).toBeCloseTo(0.2, 10); // 365 days: one year
    expect(calc('XIRR({-1E9,1.2E9},{DATE(2020,1,1),DATE(2020,12,31)})')).toBeCloseTo(0.2, 10);
  });

  it('give a scaled schedule the rate of its unscaled one', () => {
    const rate = calc('IRR({-1,0.3,0.3,0.3,0.3})');
    expect(rate).toBeCloseTo(0.0771385, 6);
    expect(calc('IRR({-1E-9,3E-10,3E-10,3E-10,3E-10})')).toBeCloseTo(rate, 12);
    expect(calc('IRR({-1E9,3E8,3E8,3E8,3E8})')).toBeCloseTo(rate, 12);
  });
});

describe('SPLIT with an emoji among its delimiters', () => {
  // The delimiter characters went into a character class without the u flag, which read an
  // emoji as its two surrogate halves: a different emoji sharing one half was cut in two.
  it('splits on the whole emoji only', () => {
    expect(calc('TEXTJOIN("|",FALSE,SPLIT("a😁b","😀"))')).toBe('a😁b');
    expect(calc('COLUMNS(SPLIT("a😁b","😀"))')).toBe(1);
    expect(calc('TEXTJOIN("|",FALSE,SPLIT("a😀b","😀",TRUE,FALSE))')).toBe('a|b');
    expect(calc('TEXTJOIN("|",FALSE,SPLIT("a😀b😁c","😀😁"))')).toBe('a|b|c');
    expect(calc('TEXTJOIN("|",FALSE,SPLIT("a😀b","😀",FALSE))')).toBe('a|b');
  });

  it('still takes the class metacharacters as plain delimiters', () => {
    expect(calc('TEXTJOIN("|",FALSE,SPLIT("a-b]c^d\\e","]-^\\"))')).toBe('a|b|c|d|e');
    expect(calc('TEXTJOIN("|",FALSE,SPLIT("a[b","["))')).toBe('a|b');
    expect(calc('TEXTJOIN("|",FALSE,SPLIT("1,2;3",",;"))')).toBe('1|2|3');
  });
});

describe('FIXED on a negative number that rounds to nothing', () => {
  // Rounding kept the sign as a negative zero, which the formatter printed: "-0.00".
  it('shows a plain zero', () => {
    expect(calc('FIXED(-0.001,2)')).toBe('0.00');
    expect(calc('FIXED(-0.4,0)')).toBe('0');
    expect(calc('FIXED(-49,-2)')).toBe('0');
    expect(calc('FIXED(-0.001,2,TRUE)')).toBe('0.00');
  });

  it('still keeps the sign of what rounds away from zero', () => {
    expect(calc('FIXED(-0.005,2)')).toBe('-0.01');
    expect(calc('FIXED(-0.5,0)')).toBe('-1');
    expect(calc('FIXED(-50,-2)')).toBe('-100');
    expect(calc('FIXED(-1234.567,1)')).toBe('-1,234.6');
  });
});

describe('FISHERINV far from zero', () => {
  // (e^2y - 1) / (e^2y + 1) overflowed to Infinity / Infinity for y past 355 while the
  // negative side reached -1: the inverse Fisher transformation is tanh, which is 1 there.
  it('is 1 on the positive side as it is -1 on the negative', () => {
    expect(calc('FISHERINV(355)')).toBe(1);
    expect(calc('FISHERINV(1000)')).toBe(1);
    expect(calc('FISHERINV(-355)')).toBe(-1);
    expect(calc('FISHERINV(-1000)')).toBe(-1);
    expect(calc('FISHERINV(0.972955)')).toBeCloseTo(0.75, 6); // the documented example
    expect(calc('FISHERINV(-0.972955)')).toBeCloseTo(-0.75, 6);
    expect(calc('FISHERINV(0)')).toBe(0);
    expect(calc('FISHERINV(FISHER(0.3))')).toBeCloseTo(0.3, 14);
  });
});

describe('ISREF of a reference union', () => {
  // A union carries its areas rather than one address, so ISREF read it as no reference
  // while AREAS counted its parts.
  it('is TRUE when every area is a reference', () => {
    expect(calc('ISREF((A1,B1))')).toBe(true);
    expect(calc('ISREF((A1:A3,C1:C3,E5))')).toBe(true);
    expect(calc('AREAS((A1,B1))')).toBe(2);
    expect(calc('ISREF(Sheet1:Sheet1!A1)')).toBe(true);
  });

  it('is still FALSE for values and arrays', () => {
    expect(calc('ISREF(A1)')).toBe(true);
    expect(calc('ISREF(1)')).toBe(false);
    expect(calc('ISREF("A1")')).toBe(false);
    expect(calc('ISREF({1,2})')).toBe(false);
    expect(calc('ISREF(A1:B2*1)')).toBe(false);
  });
});

describe('CONVERT with a binary prefix', () => {
  // ki, Mi, … Yi are the powers of 1024 that size information; on a metre or a gram they name no unit.
  it('accepts it on bits and bytes only', () => {
    expect(calc('CONVERT(1,"kim","m")')).toEqual(E('#N/A'));
    expect(calc('CONVERT(1,"Gig","g")')).toEqual(E('#N/A'));
    expect(calc('CONVERT(1,"Mis","s")')).toEqual(E('#N/A'));
    expect(calc('CONVERT(1,"kibyte","byte")')).toBe(1024);
    expect(calc('CONVERT(1,"Mibit","bit")')).toBe(1048576);
    expect(calc('CONVERT(1,"Gibyte","Mibyte")')).toBe(1024);
    expect(calc('CONVERT(1,"kbyte","byte")')).toBe(1000);
    expect(calc('CONVERT(1,"km","m")')).toBe(1000);
    expect(calc('CONVERT(1,"dam","m")')).toBe(10);
  });
});

describe('holidays given by reference to NETWORKDAYS and WORKDAY', () => {
  // A single cell arrived as its value, so text in it was converted and errored, while the same
  // text in a two-cell range was passed over. A reference of any size is a list of dates whose
  // cells holding no date are skipped; only text written into the formula itself is converted.
  const H = { A1: 'x', A2: '2008-10-02' }; // Wed 1 Oct 2008 is 39722
  it('skip a text cell whether the reference is one cell or many', () => {
    expect(calc('WORKDAY(DATE(2008,10,1),1,A1)', H)).toBe(39723);
    expect(calc('WORKDAY(DATE(2008,10,1),1,A1:A2)', H)).toBe(39724); // the 2nd is a holiday
    expect(calc('WORKDAY(DATE(2008,10,1),1,A2)', H)).toBe(39724);
    expect(calc('NETWORKDAYS(DATE(2008,10,1),DATE(2008,10,3),A1)', H)).toBe(3);
    expect(calc('NETWORKDAYS(DATE(2008,10,1),DATE(2008,10,3),A1:A2)', H)).toBe(2);
    expect(calc('NETWORKDAYS(DATE(2008,10,1),DATE(2008,10,3),A2)', H)).toBe(2);
    expect(calc('NETWORKDAYS.INTL(DATE(2008,10,1),DATE(2008,10,3),1,A1)', H)).toBe(3);
    expect(calc('NETWORKDAYS.INTL(DATE(2008,10,1),DATE(2008,10,3),1,A2)', H)).toBe(2);
    expect(calc('WORKDAY.INTL(DATE(2008,10,1),1,1,A1)', H)).toBe(39723);
    expect(calc('WORKDAY.INTL(DATE(2008,10,1),1,1,A2)', H)).toBe(39724);
  });

  it('still convert text written into the formula, and refuse text there that is no date', () => {
    expect(calc('WORKDAY(DATE(2008,10,1),1,"2008-10-02")')).toBe(39724);
    expect(calc('NETWORKDAYS(DATE(2008,10,1),DATE(2008,10,3),"2008-10-02")')).toBe(2);
    expect(calc('NETWORKDAYS(DATE(2008,10,1),DATE(2008,10,3),"x")')).toEqual(E('#VALUE!'));
  });

  it('still read the dates themselves from cells, and pass an error cell on', () => {
    const D = { A1: '2008-10-01', A2: '2008-10-03', A3: '=1/0' };
    expect(calc('WORKDAY(A1,1)', D)).toBe(39723);
    expect(calc('NETWORKDAYS(A1,A2)', D)).toBe(3);
    expect(calc('NETWORKDAYS(A1,A2,A3)', D)).toEqual(E('#DIV/0!'));
    expect(calc('WORKDAY(A3,1)', D)).toEqual(E('#DIV/0!'));
  });
});

describe('CELL with a reference to another sheet, or with no reference', () => {
  const book = () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const data = wb.addSheet('Data').id;
    const spaced = wb.addSheet('My Data').id;
    wb.setInput(data, 2, 1, '7');
    wb.setInput(spaced, 2, 1, 'x');
    return { wb, id };
  };
  const value = (wb, id, formula) => { wb.setInput(id, 0, 0, `=${formula}`); return wb.getValue(id, 0, 0); };

  it('names the other sheet in "address", quoted, and leaves its own sheet out', () => {
    // The sheet was dropped, so the address named a cell of the formula's own sheet.
    const { wb, id } = book();
    expect(value(wb, id, 'CELL("address",Data!B3)')).toBe("'Data'!$B$3");
    expect(value(wb, id, 'CELL("address",\'My Data\'!B3)')).toBe("'My Data'!$B$3");
    expect(value(wb, id, 'CELL("address",Sheet1!B3)')).toBe('$B$3');
    expect(value(wb, id, 'CELL("address",B3)')).toBe('$B$3');
    expect(value(wb, id, 'CELL("address",Data!B3:C4)')).toBe("'Data'!$B$3");
    expect(value(wb, id, 'CELL("contents",Data!B3)')).toBe(7);
    expect(value(wb, id, 'CELL("type",Data!B3)')).toBe('v');
    expect(value(wb, id, 'CELL("type",\'My Data\'!B3)')).toBe('l');
    expect(value(wb, id, 'CELL("row",Data!B3)')).toBe(3);
  });

  it('is #VALUE! when the second argument is no reference', () => {
    // A text like "B3" or an array silently stood for the formula's own cell.
    expect(calc('CELL("address","B3")')).toEqual(E('#VALUE!'));
    expect(calc('CELL("address",{1,2})')).toEqual(E('#VALUE!'));
    expect(calc('CELL("contents",5)')).toEqual(E('#VALUE!'));
  });

  it('has no cell to read for "contents" and "type" without a reference, and keeps its own address', () => {
    // Reading its own cell, still being calculated, made the formula a cycle.
    expect(calc('CELL("contents")')).toEqual(E('#VALUE!'));
    expect(calc('CELL("type")')).toEqual(E('#VALUE!'));
    expect(calc('CELL("address")')).toBe('$Z$100');
    expect(calc('CELL("row")')).toBe(100);
    expect(calc('CELL("col")')).toBe(26);
  });
});

describe('BINOM.DIST over a small number of trials', () => {
  // The mass came through logarithms, so BINOM.DIST(0,0,0.5,FALSE) was 1.0000000000000018 and
  // =1 was FALSE. Up to a thousand trials it is now the product C(n,k) p^k (1-p)^(n-k) itself,
  // and the cumulative form the sum of those, so the values a hand would get compare exactly.
  it('is exact where the arithmetic is', () => {
    expect(calc('BINOM.DIST(0,0,0.5,FALSE)')).toBe(1);
    expect(calc('BINOM.DIST(0,0,0.5,FALSE)=1')).toBe(true);
    expect(calc('BINOM.DIST(0,1,0.5,FALSE)')).toBe(0.5);
    expect(calc('BINOM.DIST(2,4,0.5,FALSE)')).toBe(0.375); // 6 / 16
    expect(calc('BINOM.DIST(3,3,0.5,FALSE)')).toBe(0.125);
    expect(calc('BINOM.DIST(6,10,0.5,FALSE)')).toBe(210 / 1024); // the documented example, 0.205078125
    expect(calc('BINOM.DIST(6,10,0.5,TRUE)')).toBe(848 / 1024); // 0.828125
    expect(calc('BINOM.DIST(1,2,0.5,TRUE)')).toBe(0.75);
    expect(calc('BINOM.DIST(2,2,0.5,TRUE)')).toBe(1);
    expect(calc('BINOM.DIST(1,3,0.25,FALSE)')).toBe(3 * 0.25 * 0.75 * 0.75);
    expect(calc('BINOM.DIST.RANGE(4,0.5,2)')).toBe(0.375);
    expect(calc('BINOM.INV(10,0.5,0.5)')).toBe(5);
  });

  it('agrees with the logarithmic form where the powers are extreme', () => {
    // C(1000,500) 0.76^500 0.24^500 is about 1E-70: the product form, by way of the powers, still holds it.
    const reference = calc('EXP(GAMMALN(1001)-2*GAMMALN(501)+500*LN(0.76)+500*LN(0.24))');
    expect(Math.abs(calc('BINOM.DIST(500,1000,0.76,FALSE)') / reference - 1)).toBeLessThan(1e-10);
    expect(calc('BINOM.DIST(0,1000,0.5,FALSE)')).toBe(0.5 ** 1000);
    expect(calc('BINOM.DIST(0,1000,0.5,TRUE)')).toBe(0.5 ** 1000);
    expect(calc('BINOM.DIST(999,1000,0.999,FALSE)')).toBeCloseTo(1000 * 0.999 ** 999 * 0.001, 14);
    expect(calc('BINOM.DIST(500000,1000000,0.5,FALSE)')).toBeCloseTo(0.000797884, 9); // the logarithmic form, unchanged
  });
});

describe('NEGBINOM.DIST at a probability of exactly 0 or 1', () => {
  // #NUM! is documented only for a probability below 0 or above 1. The mass of f failures before
  // the s-th success is C(f+s-1, f) p^s (1-p)^f: with p = 1 every trial succeeds, so the f = 0 mass
  // is 1 and every other 0, and the s-th success has come by any f; with p = 0 no success ever comes.
  it('follows the definition instead of refusing', () => {
    expect(calc('NEGBINOM.DIST(0,2,1,FALSE)')).toBe(1);
    expect(calc('NEGBINOM.DIST(3,2,1,FALSE)')).toBe(0);
    expect(calc('NEGBINOM.DIST(0,2,1,TRUE)')).toBe(1);
    expect(calc('NEGBINOM.DIST(3,2,1,TRUE)')).toBe(1);
    expect(calc('NEGBINOM.DIST(3,2,0,FALSE)')).toBe(0);
    expect(calc('NEGBINOM.DIST(3,2,0,TRUE)')).toBe(0);
    expect(calc('NEGBINOMDIST(0,1,1)')).toBe(1);
    expect(calc('NEGBINOM.DIST(3,2,1.5,FALSE)')).toEqual(E('#NUM!'));
    expect(calc('NEGBINOM.DIST(3,2,-0.5,FALSE)')).toEqual(E('#NUM!'));
    expect(calc('NEGBINOM.DIST(10,5,0.25,FALSE)')).toBeCloseTo(0.0550487, 6); // the documented example, unchanged
  });
});

describe('BASE of a number at or past 2^53', () => {
  // The number is documented as an integer from 0 up to but not including 2^53, past which a
  // double no longer holds every integer and the digits written would be those of a rounded number.
  it('is #NUM!, while the last exact integer converts and back', () => {
    expect(calc('BASE(2^53,2)')).toEqual(E('#NUM!'));
    expect(calc('BASE(2^53+2,2)')).toEqual(E('#NUM!'));
    expect(calc('BASE(1E16,36)')).toEqual(E('#NUM!'));
    expect(calc('BASE(2^53-1,2)')).toBe('1'.repeat(53));
    expect(calc('DECIMAL(BASE(2^53-1,36),36)=2^53-1')).toBe(true);
    expect(calc('BASE(255,16)')).toBe('FF');
    expect(calc('BASE(-1,2)')).toEqual(E('#NUM!'));
  });
});
