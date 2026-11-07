import { describe, it, expect } from 'vitest';
import {
  parseNum, parseMultiple, stillTyping, NUM_MAX, tidy, monthsBetween, yearsBetween, accrualYears, daysBetween, addMonthsISO,
  round2, clamp, csvEscape, toCSV, uid,
} from '../src/lib/util.js';

describe('parseNum', () => {
  it('refuses a figure past what a record can hold', () => {
    // The store clamps at NUM_MAX, so a form that read past it saved a
    // different figure than the one typed, under a "saved" toast.
    expect(NUM_MAX).toBe(1e15);
    expect(parseNum('1,000,000,000,000,000')).toBe(1e15);
    expect(parseNum('10,000,000,000,000,000')).toBeNull();
    expect(parseNum('-10,000,000,000,000,000')).toBeNull();
    expect(parseNum(1e16)).toBeNull();
    // The CSV planner reads the figure to word its own refusal.
    expect(parseNum('10,000,000,000,000,000', { max: Infinity })).toBe(1e16);
  });

  it('parses plain and comma-grouped numbers', () => {
    expect(parseNum('1234')).toBe(1234);
    expect(parseNum('1,234,567')).toBe(1234567);
    expect(parseNum('0.0001')).toBe(0.0001);
    expect(parseNum(' 42 ')).toBe(42);
    expect(parseNum(7)).toBe(7);
    // The symbols the field labels invite: ($) and (%) fields.
    expect(parseNum('$5,000,000')).toBe(5000000);
    expect(parseNum('10%')).toBe(10);
    expect(parseNum('$0.85')).toBe(0.85);
    expect(parseNum('£850,000')).toBe(850000);
    expect(parseNum('€0.85')).toBe(0.85);
    expect(parseNum('¥1,000')).toBe(1000);
    expect(parseNum('.5')).toBe(0.5);
    expect(parseNum('-1,500')).toBe(-1500);
    // Groups before the last may be short: lakh grouping reads as written.
    expect(parseNum('12,34,567')).toBe(1234567);
  });

  it('refuses a comma that is not closing a group of thousands', () => {
    // Decimal-comma figures: reading past the comma made these 5, 25 and 250.
    expect(parseNum('0,5')).toBeNull();
    expect(parseNum('$0,25')).toBeNull();
    expect(parseNum('2,50')).toBeNull();
    expect(parseNum('1,0000')).toBeNull();
    expect(parseMultiple('1,5x')).toBeNull();
  });

  it('reads only plain decimal notation', () => {
    // Number() would read these as 16, 5, 1000 and 1 - none typed on purpose.
    expect(parseNum('0x10')).toBeNull();
    expect(parseNum('0b101')).toBeNull();
    expect(parseNum('1e3')).toBeNull();
    expect(parseNum('1.000,5')).toBeNull();
    expect(parseNum('Infinity')).toBeNull();
    expect(parseNum('1.5o')).toBeNull();
  });

  it('returns null for unusable input', () => {
    expect(parseNum('')).toBeNull();
    expect(parseNum('abc')).toBeNull();
    expect(parseNum(null)).toBeNull();
    expect(parseNum(undefined)).toBeNull();
    expect(parseNum(NaN)).toBeNull();
  });
});

describe('tidy', () => {
  it('shaves accumulated float noise off a price without touching a real figure', () => {
    expect(tidy(6.300000000000001)).toBe(6.3);
    // Twenty split pairs left the noise in the fifteenth digit.
    expect(tidy(0.850000000000001)).toBe(0.85);
    expect(tidy(0.0000999999999999999)).toBe(0.0001);
    expect(tidy(1234567.891)).toBe(1234567.891);
    expect(tidy(0.0001)).toBe(0.0001);
    expect(tidy(NaN)).toBeNaN();
  });

  it('shaves to fewer digits when asked, for a figure already short of a division', () => {
    // A third of $0.0001 at twelve digits, multiplied back by three.
    expect(tidy(0.0000999999999999)).toBe(0.0000999999999999);
    expect(tidy(0.0000999999999999, 10)).toBe(0.0001);
    expect(tidy(0.0900000000001, 10)).toBe(0.09);
    expect(tidy(1234567.891, 10)).toBe(1234567.891);
  });
});

describe('stillTyping', () => {
  it('reads a grouped figure mid-keystroke as not yet a mistake', () => {
    // On the way to "18,000": the group just opened, then partly typed.
    expect(stillTyping('18,')).toBe(true);
    expect(stillTyping('18,0')).toBe(true);
    expect(stillTyping('18,00')).toBe(true);
    expect(stillTyping('1,234,')).toBe(true);
    // A bare sign or point, and nothing at all.
    expect(stillTyping('-')).toBe(true);
    expect(stillTyping('.')).toBe(true);
    expect(stillTyping('')).toBe(true);
    // The symbols and spaces parseNum strips are ignored the same way.
    expect(stillTyping('$18,')).toBe(true);
    expect(stillTyping(' 18, ')).toBe(true);
  });

  it('does not excuse a figure that is simply not a number', () => {
    expect(stillTyping('60M')).toBe(false);
    expect(stillTyping('ten')).toBe(false);
    expect(stillTyping('1.000.000')).toBe(false);
    // A closed group is a finished figure, which parseNum reads or refuses.
    expect(stillTyping('18,000')).toBe(false);
    expect(stillTyping('1,0000')).toBe(false);
    // "0,5" is indistinguishable from "0,500" two keystrokes early, so it is
    // still typing here; parseNum refuses it once the field is read.
    expect(stillTyping('0,5')).toBe(true);
    expect(stillTyping(null)).toBe(true);
  });
});

describe('parseMultiple', () => {
  it('accepts the "x" the field label invites', () => {
    expect(parseMultiple('2x')).toBe(2);
    expect(parseMultiple('1.5X')).toBe(1.5);
    expect(parseMultiple('1.5 x')).toBe(1.5);
    expect(parseMultiple('1')).toBe(1);
    expect(parseMultiple(2)).toBe(2);
    expect(parseMultiple('0')).toBe(0);
  });

  it('still refuses what is not a number', () => {
    expect(parseMultiple('')).toBeNull();
    expect(parseMultiple('x')).toBeNull();
    expect(parseMultiple('two')).toBeNull();
    // Only a trailing x is the unit; an embedded one is a typo.
    expect(parseMultiple('1x5')).toBeNull();
  });
});

describe('monthsBetween', () => {
  it('counts whole months once the day of month is reached', () => {
    expect(monthsBetween('2024-01-15', '2024-02-14')).toBe(0);
    expect(monthsBetween('2024-01-15', '2024-02-15')).toBe(1);
    expect(monthsBetween('2024-01-15', '2025-01-15')).toBe(12);
  });

  it('crosses year boundaries', () => {
    expect(monthsBetween('2023-11-01', '2024-02-01')).toBe(3);
  });

  it('vests on the last day of months too short for the anchor day', () => {
    expect(monthsBetween('2024-01-31', '2024-02-28')).toBe(0);
    expect(monthsBetween('2024-01-31', '2024-02-29')).toBe(1); // leap year
    expect(monthsBetween('2023-01-31', '2023-02-28')).toBe(1);
    expect(monthsBetween('2024-01-31', '2024-03-30')).toBe(1);
    expect(monthsBetween('2024-01-31', '2024-03-31')).toBe(2);
    expect(monthsBetween('2024-05-31', '2024-06-30')).toBe(1);
  });

  it('never goes negative and tolerates bad input', () => {
    expect(monthsBetween('2025-01-01', '2024-01-01')).toBe(0);
    expect(monthsBetween('nonsense', '2024-01-01')).toBe(0);
  });
});

describe('yearsBetween', () => {
  it('measures fractional years', () => {
    expect(yearsBetween('2023-01-01', '2024-01-01')).toBeCloseTo(365 / 365.25, 10);
  });

  it('floors at zero for reversed ranges', () => {
    expect(yearsBetween('2025-01-01', '2024-01-01')).toBe(0);
  });

  it('counts whole days, so a clock change inside the period does not move it', () => {
    // A fortnight across the US spring-forward is 14 days, not 335 hours.
    expect(yearsBetween('2024-03-01', '2024-03-15')).toBeCloseTo(14 / 365.25, 12);
    expect(yearsBetween('2024-11-01', '2024-11-15')).toBeCloseTo(14 / 365.25, 12);
    expect(yearsBetween('2024-03-01', '2024-03-15')).toBe(yearsBetween('2024-07-01', '2024-07-15'));
  });
});

describe('accrualYears', () => {
  it('counts actual days over 365, so a year to the day is exactly one', () => {
    expect(accrualYears('2023-01-01', '2024-01-01')).toBe(1);
    // A leap year is a day more than a year of interest.
    expect(accrualYears('2024-01-01', '2025-01-01')).toBeCloseTo(366 / 365, 12);
  });

  it('floors at zero for reversed ranges', () => {
    expect(accrualYears('2025-01-01', '2024-01-01')).toBe(0);
  });
});

describe('addMonthsISO', () => {
  it('shifts by whole months', () => {
    expect(addMonthsISO('2024-01-15', 12)).toBe('2025-01-15');
    expect(addMonthsISO('2024-01-15', 120)).toBe('2034-01-15');
  });

  it('clamps to the target month’s last day', () => {
    expect(addMonthsISO('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonthsISO('2025-01-31', 1)).toBe('2025-02-28');
  });

  it('round-trips against monthsBetween', () => {
    const end = addMonthsISO('2024-01-31', 48);
    expect(monthsBetween('2024-01-31', end)).toBe(48);
  });

  it('returns empty for an unparseable date', () => {
    expect(addMonthsISO('', 12)).toBe('');
  });
});

describe('daysBetween', () => {
  it('counts whole days forward and backward', () => {
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30);
    expect(daysBetween('2026-03-01', '2026-03-01')).toBe(0);
    expect(daysBetween('2026-03-31', '2026-03-01')).toBe(-30);
  });

  it('is unaffected by the spring daylight-saving jump', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
  });

  it('returns 0 for unparseable dates', () => {
    expect(daysBetween('', '2026-01-01')).toBe(0);
  });
});

describe('round2 / clamp', () => {
  it('rounds money without float drift', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1.005)).toBe(1.01);
  });

  it('clamps into a range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('CSV', () => {
  it('escapes quotes, commas, and newlines per RFC 4180', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"');
  });

  it('joins rows with CRLF', () => {
    expect(toCSV([['a', 'b'], ['1', '2,3']])).toBe('a,b\r\n1,"2,3"');
  });

  it('neutralizes spreadsheet formula injection in string cells', () => {
    expect(csvEscape('=HYPERLINK("http://evil.example")')).toBe('"\'=HYPERLINK(""http://evil.example"")"');
    expect(csvEscape('+1+2')).toBe("'+1+2");
    expect(csvEscape('@cmd')).toBe("'@cmd");
    expect(csvEscape('-2+3')).toBe("'-2+3");
    // Numbers are data, not formulas - they pass through untouched.
    expect(csvEscape(-42)).toBe('-42');
    expect(csvEscape(1500)).toBe('1500');
  });
});

describe('uid', () => {
  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 500 }, uid));
    expect(ids.size).toBe(500);
  });
});
