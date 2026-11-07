import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

describe('RIGHT with a fractional count', () => {
  it('truncates the count before taking characters, so below one it is empty', () => {
    expect(calc('RIGHT("abc",0.5)')).toBe('');
    expect(calc('RIGHT("abc",0.9)')).toBe('');
    expect(calc('RIGHT("abc",1.9)')).toBe('c');
    expect(calc('RIGHT("abc",0)')).toBe('');
    expect(calc('LEFT("abc",0.5)')).toBe('');
  });
});

describe('SUBSTITUTE with an instance number', () => {
  it('counts non-overlapping instances, like the all-instances form does', () => {
    expect(calc('SUBSTITUTE("aaaa","aa","b",2)')).toBe('aab');
    expect(calc('SUBSTITUTE("aaa","aa","b",2)')).toBe('aaa');
    expect(calc('SUBSTITUTE("aaa","aa","b")')).toBe('ba');
    expect(calc('SUBSTITUTE("a-b-c","-","+",2)')).toBe('a-b+c');
    expect(calc('SUBSTITUTE("banana","an","AN",2)')).toBe('banANa');
  });
});

describe('DCOUNTA without a field', () => {
  it('counts the matching records, as DCOUNT does', () => {
    const data = { A1: 'Tree', B1: 'Height', A2: 'Apple', B2: '18', A3: 'Pear', B3: '12', A4: 'Cherry', B4: '13', D1: 'Height', D2: '>12' };
    expect(calc('DCOUNTA(A1:B4,,D1:D2)', data)).toBe(2);
    expect(calc('DCOUNT(A1:B4,,D1:D2)', data)).toBe(2);
    expect(calc('DCOUNTA(A1:B4,"Tree",D1:D2)', data)).toBe(2);
  });
});

describe('SWITCH on an empty cell', () => {
  it('treats the blank as 0, "" or FALSE, as the = operator does', () => {
    expect(calc('SWITCH(A1,0,"zero","d")')).toBe('zero');
    expect(calc('SWITCH(A1,"","empty","d")')).toBe('empty');
    expect(calc('SWITCH(A1,FALSE,"no","d")')).toBe('no');
    expect(calc('SWITCH(A1,1,"one","d")')).toBe('d');
    expect(calc('SWITCH(5,"5","text",5,"number")')).toBe('number');
    expect(calc('SWITCH("b","a",1,"B",2,3)')).toBe(2);
  });
});

describe('ERROR.TYPE', () => {
  it('numbers the newer errors', () => {
    expect(calc('ERROR.TYPE(1/0)')).toBe(2);
    expect(calc('ERROR.TYPE(NA())')).toBe(7);
    expect(calc('ERROR.TYPE(A1#)')).toBe(4);
    expect(calc('ERROR.TYPE(#SPILL!)')).toBe(9);
    expect(calc('ERROR.TYPE(#CALC!)')).toBe(14);
    expect(calc('ERROR.TYPE(#NULL!)')).toBe(1);
  });
});

describe('VLOOKUP and HLOOKUP answering from a column or row beyond the data', () => {
  it('give zero for a blank inside the reference and #REF! only outside it', () => {
    const data = { A1: 'a', B1: 1, A2: 'b', B2: 2, A3: 'c', B3: 3 };
    expect(calc('VLOOKUP("b",A1:AZ3,30,FALSE)', data)).toBe(0);
    expect(calc('VLOOKUP("b",A1:AZ3,53,FALSE)', data)).toEqual({ error: '#REF!' });
    expect(calc('HLOOKUP("a",A1:C2000,1500,FALSE)', data)).toBe(0);
    expect(calc('HLOOKUP("a",A1:C2000,2001,FALSE)', data)).toEqual({ error: '#REF!' });
    expect(calc('VLOOKUP("b",A1:B3,2,FALSE)', data)).toBe(2);
  });
});

describe('REPT with a fractional count', () => {
  it('truncates the count before checking the length', () => {
    expect(calc('LEN(REPT("ab",16383.6))')).toBe(32766);
    expect(calc('REPT("ab",2.9)')).toBe('abab');
    expect(calc('REPT("ab",16384)')).toEqual({ error: '#VALUE!' });
    expect(calc('REPT("ab",-0.5)')).toBe('');
  });
});

describe('TRUNC', () => {
  it('agrees with ROUNDDOWN on values that are not exact in binary', () => {
    expect(calc('TRUNC(4.35,2)')).toBe(4.35);
    expect(calc('TRUNC(0.57,2)')).toBe(0.57);
    expect(calc('TRUNC(-4.35,2)')).toBe(-4.35);
    expect(calc('TRUNC(0.3/0.1,0)')).toBe(3);
    expect(calc('TRUNC(8.9)')).toBe(8);
    expect(calc('TRUNC(-8.9)')).toBe(-8);
    expect(calc('TRUNC(1234.5678,-2)')).toBe(1200);
  });
});

describe('RANDBETWEEN with fractional bounds', () => {
  it('never draws below the lower bound', () => {
    for (let i = 0; i < 300; i++) {
      const v = calc('RANDBETWEEN(1.5,3)');
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(3);
      expect(Number.isInteger(v)).toBe(true);
    }
    expect(calc('RANDBETWEEN(1.5,1.7)')).toEqual({ error: '#NUM!' });
    expect(calc('RANDBETWEEN(2,2)')).toBe(2);
    expect(calc('RANDBETWEEN(-1.5,-1)')).toBe(-1);
  });
});

describe('holidays given as text', () => {
  it('are read as dates by NETWORKDAYS and WORKDAY', () => {
    expect(calc('NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,31),"2024-01-15")')).toBe(22);
    expect(calc('NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,31),DATE(2024,1,15))')).toBe(22);
    expect(calc('WORKDAY(DATE(2024,1,12),1,"2024-01-15")')).toBe(45307);
    expect(calc('NETWORKDAYS.INTL(DATE(2024,1,1),DATE(2024,1,31),1,"2024-01-15")')).toBe(22);
    expect(calc('NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,31),"not a date")')).toEqual({ error: '#VALUE!' });
  });
});

describe('PRODUCT of no numbers', () => {
  it('is 0 rather than 1', () => {
    expect(calc('PRODUCT(A1:A3)', { A1: 'x', A2: 'y' })).toBe(0);
    expect(calc('PRODUCT(A1:A3)', { A1: '2', A2: '3' })).toBe(6);
    expect(calc('PRODUCT(2,3,4)')).toBe(24);
  });
});

describe('YEARFRAC on an actual/actual basis inside one leap year', () => {
  it('divides by 366 for any span within the leap year', () => {
    expect(calc('YEARFRAC(DATE(2024,3,1),DATE(2024,12,31),1)')).toBeCloseTo(305 / 366, 12);
    expect(calc('YEARFRAC(DATE(2024,1,1),DATE(2024,2,28),1)')).toBeCloseTo(58 / 366, 12);
    expect(calc('YEARFRAC(DATE(2023,3,1),DATE(2023,12,31),1)')).toBeCloseTo(305 / 365, 12);
    // Into the next year: 366 only when the span includes a February 29.
    expect(calc('YEARFRAC(DATE(2023,6,1),DATE(2024,3,1),1)')).toBeCloseTo(274 / 366, 12);
    expect(calc('YEARFRAC(DATE(2024,6,1),DATE(2025,3,1),1)')).toBeCloseTo(273 / 365, 12);
  });
});

describe('the ~ escape in wildcard text', () => {
  it('distinguishes literal criteria from lookup/search escape syntax', () => {
    expect(calc('COUNTIF(A1:A2,"a~~b")', { A1: 'a~b', A2: 'ab' })).toBe(0);
    expect(calc('COUNTIF(A1:A2,"a~~b")', { A1: 'a~~b', A2: 'ab' })).toBe(1);
    expect(calc('SEARCH("a~~b","xa~b")')).toBe(2);
    expect(calc('MATCH("a~~b",A1:A2,0)', { A1: 'a~b', A2: 'ab' })).toBe(1);
    expect(calc('SEARCH("?~","xa~y")')).toBe(1); // trailing escape has no literal operand
    expect(calc('SEARCH("a~*","xa*y")')).toBe(2);
    expect(calc('COUNTIF(A1:A2,"a~?")', { A1: 'a?', A2: 'ab' })).toBe(1);
  });
});

describe('an empty cell as the criterion', () => {
  it('counts as 0 in COUNTIF, SUMIF, COUNTIFS, MAXIFS and AVERAGEIF', () => {
    const data = { A1: '0', A2: '1', A3: '2', C1: '10', C2: '20', C3: '30' };
    expect(calc('COUNTIF(A1:A3,B1)', data)).toBe(1);
    expect(calc('SUMIF(A1:A3,B1,C1:C3)', data)).toBe(10);
    expect(calc('COUNTIFS(A1:A3,B1)', data)).toBe(1);
    expect(calc('MAXIFS(C1:C3,A1:A3,B1)', data)).toBe(10);
    expect(calc('AVERAGEIF(A1:A3,B1,C1:C3)', data)).toBe(10);
    // The text criterion "" still means an empty cell.
    expect(calc('COUNTIF(A1:A4,"")', data)).toBe(1);
  });
});

describe('text functions given a drawable', () => {
  it('report #VALUE! instead of printing an object', () => {
    expect(calc('CONCAT(1,SPARKLINE({1,2}))')).toEqual({ error: '#VALUE!' });
    expect(calc('TEXTJOIN(",",TRUE,1,SPARKLINE({1,2}))')).toEqual({ error: '#VALUE!' });
    expect(calc('VALUETOTEXT(SPARKLINE({1,2}))')).toBe('#VALUE!');
    expect(calc('CONCAT(1,"a",TRUE)')).toBe('1aTRUE');
    expect(calc('TEXTJOIN("-",TRUE,"a","","b")')).toBe('a-b');
  });
});

describe('TEXT given text or a boolean', () => {
  it('formats numeric text as a number and prints booleans as words', () => {
    expect(calc('TEXT("123","0.00")')).toBe('123.00');
    expect(calc('TEXT("2026-01-05","yyyy")')).toBe('2026');
    expect(calc('TEXT(TRUE,"0")')).toBe('TRUE');
    expect(calc('TEXT("abc","0")')).toBe('abc');
    expect(calc('TEXT(1234.5,"#,##0.0")')).toBe('1,234.5');
  });
});

describe('REGEXREPLACE replacement text', () => {
  it('reads $0 as the whole match and leaves other dollar sequences literal, as Sheets does', () => {
    expect(calc('REGEXREPLACE("abc","b","[$0]")')).toBe('a[b]c');
    expect(calc('REGEXREPLACE("abc","(b)","<$1>")')).toBe('a<b>c');
    expect(calc('REGEXREPLACE("abc","b","$$")')).toBe('a$$c');
    expect(calc('REGEXREPLACE("abc","b","$&")')).toBe('a$&c');
    expect(calc('REGEXREPLACE("price 5","(\\d+)","$1.00")')).toBe('price 5.00');
  });
});

describe('regular expressions and characters outside the basic plane', () => {
  it('treat an emoji as one character', () => {
    expect(calc('REGEXEXTRACT("😀b",".")')).toBe('😀');
    expect(calc('LEN(REGEXREPLACE("a😀b",".","x"))')).toBe(3);
    expect(calc('REGEXMATCH("a😀b","^a.b$")')).toBe(true);
    // Patterns the unicode mode refuses still work.
    expect(calc('REGEXEXTRACT("a-b","\\-")')).toBe('-');
    expect(calc('REGEXMATCH("x","[")')).toEqual({ error: '#VALUE!' });
  });
});

describe('densities at the edge of their support', () => {
  it('preserve native endpoint values and error conventions', () => {
    expect(calc('GAMMA.DIST(0,0.5,1,FALSE)')).toEqual({ error: '#NUM!' });
    expect(calc('GAMMA.DIST(0,1,2,FALSE)')).toBe(0.5);
    expect(calc('GAMMA.DIST(0,3,1,FALSE)')).toBe(0);
    expect(calc('CHISQ.DIST(0,1,FALSE)')).toEqual({ error: '#NUM!' });
    expect(calc('CHISQ.DIST(0,2,FALSE)')).toBe(0.5);
    expect(calc('F.DIST(0,1,1,FALSE)')).toEqual({ error: '#NUM!' });
    expect(calc('F.DIST(0,2,5,FALSE)')).toBeCloseTo(1, 12);
    expect(calc('BETA.DIST(1,1,0.5,FALSE)')).toEqual({ error: '#NUM!' });
    expect(calc('BETA.DIST(0,1,1,FALSE)')).toEqual({ error: '#NUM!' });
    expect(calc('GAMMA.DIST(2,3,1,FALSE)')).toBeCloseTo(0.2706705665, 9);
  });
});

describe('MINVERSE on tiny or huge entries', () => {
  it('inverts them, judging singularity against the matrix scale', () => {
    expect(calc('INDEX(MINVERSE({0.0000000000001}),1,1)')).toBeCloseTo(1e13, 0);
    expect(calc('INDEX(MINVERSE({2e-13,0;0,4e-13}),2,2)')).toBeCloseTo(2.5e12, 0);
    expect(calc('INDEX(MINVERSE({2,1;1,1}),1,1)')).toBe(1);
    expect(calc('MINVERSE({1,2;2,4})')).toEqual({ error: '#NUM!' });
    expect(calc('MINVERSE({0,0;0,0})')).toEqual({ error: '#NUM!' });
  });
});

describe('CONVERT binary prefixes', () => {
  it('knows pebi, exbi, zebi and yobi', () => {
    expect(calc('CONVERT(1,"Pibyte","Tibyte")')).toBe(1024);
    expect(calc('CONVERT(1,"Eibyte","Pibyte")')).toBe(1024);
    expect(calc('CONVERT(1,"Yibyte","Zibyte")')).toBe(1024);
    expect(calc('CONVERT(1,"Gibyte","Mibyte")')).toBe(1024);
  });
});


describe('numeric text with commas', () => {
  // Every comma used to be stripped before parsing, so "1,2,3" was 123 and "12,34" was 1234.
  // Thousands separators group by three, as when the text is typed into a cell.
  it('reads grouped thousands and rejects commas placed anywhere else', () => {
    expect(calc('VALUE("1,234")')).toBe(1234);
    expect(calc('VALUE("1,234,567.89")')).toBe(1234567.89);
    expect(calc('VALUE("-1,234")')).toBe(-1234);
    expect(calc('VALUE("1,000%")')).toBe(10);
    expect(calc('"1,000"*2')).toBe(2000);
    expect(calc('VALUE("1,2,3")')).toEqual({ error: '#VALUE!' });
    expect(calc('VALUE("12,34")')).toEqual({ error: '#VALUE!' });
    expect(calc('SUM("1,5")')).toEqual({ error: '#VALUE!' });
    expect(calc('VALUE("1e3")')).toBe(1000);
    expect(calc('VALUE("$1,234")')).toBe(1234);
  });
});

describe('dates beyond the calendar', () => {
  // The calendar functions accepted any serial, so YEAR(3000000) answered 10113 and DATE(10000,1,1)
  // built a date no cell can show. The calendar ends on 31 December 9999 (serial 2958465).
  it('answer #NUM! past 31 December 9999 and before day 0, and still work at the edges', () => {
    expect(calc('YEAR(2958465)')).toBe(9999);
    expect(calc('DATE(9999,12,31)')).toBe(2958465);
    expect(calc('YEAR(2958466)')).toEqual({ error: '#NUM!' });
    expect(calc('MONTH(3000000)')).toEqual({ error: '#NUM!' });
    expect(calc('DATE(10000,1,1)')).toEqual({ error: '#NUM!' });
    expect(calc('EDATE(2958465,1)')).toEqual({ error: '#NUM!' });
    expect(calc('EOMONTH(2958465,0)')).toBe(2958465);
    expect(calc('WEEKDAY(-1)')).toEqual({ error: '#NUM!' });
    expect(calc('WEEKNUM(3000000)')).toEqual({ error: '#NUM!' });
    expect(calc('DATEDIF(1,3000000,"Y")')).toEqual({ error: '#NUM!' });
    expect(calc('NETWORKDAYS(-5,10)')).toEqual({ error: '#NUM!' });
    expect(calc('NETWORKDAYS(2958460,2958465)')).toBe(5); // Mon 26 to Fri 30 December 9999
    expect(calc('WORKDAY(2958464,5)')).toEqual({ error: '#NUM!' });
    expect(calc('EDATE(45000,1)')).toBe(45031);
  });
});

describe('regular expressions that could run for ever', () => {
  // A pattern like ^(a+)+$ takes exponential time on "aaaa…!" and cannot be interrupted; a
  // workbook with such a REGEXMATCH would hang the app on open. It is refused instead.
  it('refuse a repeated group that ends in a repeat, and keep ordinary nested groups', () => {
    expect(calc('REGEXMATCH("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!", "^(a+)+$")')).toEqual({ error: '#VALUE!' });
    expect(calc('REGEXMATCH("ab ab ab ab ab ab ab ab ab ab ab ab ab ab ab ab!", "^(\\w+\\s?)*$")')).toEqual({ error: '#VALUE!' });
    expect(calc('REGEXMATCH("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!", "^(a|aa+)+$")')).toEqual({ error: '#VALUE!' });
    expect(calc('REGEXMATCH("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!", "^(?:a*)*$")')).toEqual({ error: '#VALUE!' });
    expect(calc('REGEXMATCH("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!", "^((a+))+$")')).toEqual({ error: '#VALUE!' });
    expect(calc('REGEXEXTRACT("v1.2.3", "(?:\\d+\\.)+\\d+")')).toBe('1.2.3');
    expect(calc('REGEXMATCH("1.2.3", "^(\\d+\\.)+\\d+$")')).toBe(true);
    expect(calc('REGEXMATCH("hello big world", "^(\\w+ )+\\w+$")')).toBe(true);
    expect(calc('REGEXMATCH("aaa", "^(a+)$")')).toBe(true);
    expect(calc('REGEXREPLACE("a-b-c", "(\\w)-", "$1+")')).toBe('a+b+c');
    expect(calc('REGEXMATCH("abab", "^(?:ab?)+$")')).toBe(true);
    expect(calc('REGEXMATCH("x1", "^[a-z]+\\d{1,}$")')).toBe(true);
    expect(calc('REGEXMATCH("http://x", "^((?:https?|ftp)://)?x$")')).toBe(true);
  });
});

describe('XLOOKUP and XMATCH binary search modes', () => {
  // Search modes 2 and -2 scanned the range like modes 1 and -1; they now halve a sorted
  // range, with the same answers as the scan.
  const asc = { A1: 10, A2: 20, A3: 30, A4: 40, A5: 50, B1: 'a', B2: 'b', B3: 'c', B4: 'd', B5: 'e' };
  const desc = { A1: 50, A2: 40, A3: 30, A4: 20, A5: 10, B1: 'e', B2: 'd', B3: 'c', B4: 'b', B5: 'a' };
  it('find exact and neighbouring matches in ascending and descending ranges', () => {
    expect(calc('XLOOKUP(30,A1:A5,B1:B5,,0,2)', asc)).toBe('c');
    expect(calc('XLOOKUP(35,A1:A5,B1:B5,,-1,2)', asc)).toBe('c');
    expect(calc('XLOOKUP(35,A1:A5,B1:B5,,1,2)', asc)).toBe('d');
    expect(calc('XLOOKUP(5,A1:A5,B1:B5,,-1,2)', asc)).toEqual({ error: '#N/A' });
    expect(calc('XLOOKUP(55,A1:A5,B1:B5,"none",1,2)', asc)).toBe('none');
    expect(calc('XLOOKUP(50,A1:A5,B1:B5,,0,2)', asc)).toBe('e');
    expect(calc('XLOOKUP(10,A1:A5,B1:B5,,0,2)', asc)).toBe('a');
    expect(calc('XLOOKUP(35,A1:A5,B1:B5,,-1,-2)', desc)).toBe('c');
    expect(calc('XLOOKUP(35,A1:A5,B1:B5,,1,-2)', desc)).toBe('d');
    expect(calc('XLOOKUP(30,A1:A5,B1:B5,,0,-2)', desc)).toBe('c');
    expect(calc('XMATCH(20,A1:A5,0,-2)', desc)).toBe(4);
    expect(calc('XMATCH("C",B1:B5,0,2)', asc)).toBe(3);
    expect(calc('XMATCH(20,A1:A5,0,2)', asc)).toBe(2);
  });
  it('agree with the scanning modes on a longer sorted range', () => {
    const cells = {};
    for (let i = 0; i < 40; i++) cells[`A${i + 1}`] = i * 3; // 0, 3, 6, … 117
    for (let x = -2; x <= 120; x += 7) {
      for (const mode of [-1, 0, 1]) {
        expect(calc(`XMATCH(${x},A1:A40,${mode},2)`, cells)).toEqual(calc(`XMATCH(${x},A1:A40,${mode},1)`, cells));
      }
    }
  });
});

describe('error function precision', () => {
  // ERF, ERFC and the normal distribution used a seven-digit approximation; a spreadsheet's
  // statistics deserve the full fifteen.
  const near = (got, want) => expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(want)));
  it('match reference values to twelve digits or better', () => {
    near(calc('ERF(0.2)'), 0.2227025892104785);
    near(calc('ERF(0.5)'), 0.5204998778130465);
    near(calc('ERF(1)'), 0.8427007929497149);
    near(calc('ERF(1.5)'), 0.9661051464753108);
    near(calc('ERFC(2)'), 0.004677734981047266);
    near(calc('ERFC(2.5)'), 0.000406952017444959);
    near(calc('ERFC(3)'), 2.209049699858544e-5);
    near(calc('ERFC(4)'), 1.541725790028002e-8);
    near(calc('ERFC(-1)'), 1.8427007929497148);
    near(calc('ERF(0)'), 0);
    near(calc('NORM.S.DIST(1.96,TRUE)'), 0.9750021048517795);
    near(calc('NORM.S.DIST(-3,TRUE)'), 0.0013498980316301035);
    near(calc('NORM.S.INV(0.975)'), 1.959963984540054);
    near(calc('NORM.S.INV(0.001)'), -3.090232306167813);
    near(calc('NORM.DIST(12,10,2,TRUE)'), 0.8413447460685429);
  });
});

describe('complex number text', () => {
  // Parts were written through the General format, about ten significant digits; complex text keeps fifteen.
  it('keeps fifteen significant digits in each part', () => {
    expect(calc('IMSUM("1.23456789012345","1")')).toBe('2.23456789012345');
    expect(calc('COMPLEX(123456789.123456789,0)')).toBe('123456789.123456'); // literal truncates first
    expect(calc('COMPLEX(123456789+123456789/1e9,0)')).toBe('123456789.123457');
    expect(calc('IMDIV("1","3")')).toBe('0.333333333333333');
    expect(calc('COMPLEX(3,4)')).toBe('3+4i');
    expect(calc('COMPLEX(0,-1,"j")')).toBe('-j');
    expect(calc('COMPLEX(1E+21,1)')).toBe('1E+21+i');
    expect(calc('COMPLEX(0.00001,1)')).toBe('0.00001+i');
    expect(calc('IMSQRT("1+i")')).toBe('1.09868411346781+0.455089860562227i');
  });
});

describe('FREQUENCY', () => {
  const data = { A1: 1, A2: 2, A3: 3, A4: 4, A5: 5, A6: 6 };
  it('counts each interval, with a repeated edge taking nothing, as before the search by halving', () => {
    expect(calc('INDEX(FREQUENCY(A1:A6,B1:B2),1)', { ...data, B1: 2, B2: 4 })).toBe(2);
    expect(calc('INDEX(FREQUENCY(A1:A6,B1:B2),2)', { ...data, B1: 2, B2: 4 })).toBe(2);
    expect(calc('INDEX(FREQUENCY(A1:A6,B1:B2),3)', { ...data, B1: 2, B2: 4 })).toBe(2);
    expect(calc('INDEX(FREQUENCY(A1:A6,B1:B2),1)', { ...data, B1: 2, B2: 2 })).toBe(2);
    expect(calc('INDEX(FREQUENCY(A1:A6,B1:B2),2)', { ...data, B1: 2, B2: 2 })).toBe(0);
    expect(calc('INDEX(FREQUENCY(A1:A6,B1:B2),3)', { ...data, B1: 2, B2: 2 })).toBe(4);
    expect(calc('INDEX(FREQUENCY(A1:A6,B1:B1),1)', { ...data, B1: 0 })).toBe(0);
    expect(calc('INDEX(FREQUENCY(A1:A6,B1:B1),2)', { ...data, B1: 0 })).toBe(6);
  });
});

describe('RANK and PERCENTRANK arguments', () => {
  // A text order in RANK was silently read as descending, and a significance below one in
  // PERCENTRANK rounded the answer to nothing instead of complaining.
  const list = { A1: 1, A2: 2, A3: 3 };
  it('report a bad order or significance', () => {
    expect(calc('RANK(3,A1:A3,"x")', list)).toEqual({ error: '#VALUE!' });
    expect(calc('RANK.AVG(3,A1:A3,"x")', list)).toEqual({ error: '#VALUE!' });
    expect(calc('RANK(3,A1:A3)', list)).toBe(1);
    expect(calc('RANK(3,A1:A3,1)', list)).toBe(3);
    expect(calc('RANK(3,A1:A3,"1")', list)).toBe(3);
    expect(calc('PERCENTRANK(A1:A3,2,0)', list)).toEqual({ error: '#NUM!' });
    expect(calc('PERCENTRANK(A1:A3,2,0.5)', list)).toEqual({ error: '#NUM!' });
    expect(calc('PERCENTRANK(A1:A3,2,1.5)', list)).toBe(0.5);
    expect(calc('PERCENTRANK(A1:A3,2)', list)).toBe(0.5);
  });
});
