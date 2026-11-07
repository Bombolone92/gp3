import { describe, it, expect } from 'vitest';
import {
  parseCSV, autoMatch, headerRowIndex, toISODate, slashedDateOrder,
  STAKEHOLDER_FIELDS, SECURITY_FIELDS,
  buildStakeholderPlan, buildSecurityPlan,
  STAKEHOLDER_TEMPLATE, SECURITY_TEMPLATE,
} from '../src/lib/csvimport.js';
import { toCSV } from '../src/lib/util.js';

describe('parseCSV', () => {
  it('parses plain rows and trims blank lines', () => {
    expect(parseCSV('a,b,c\n1,2,3\n\n4,5,6\n')).toEqual([
      ['a', 'b', 'c'], ['1', '2', '3'], ['4', '5', '6'],
    ]);
  });

  it('handles quotes, embedded commas, newlines, and doubled quotes', () => {
    const text = 'name,note\r\n"Chen, Ada","She said ""hi""\nsecond line"\r\n';
    expect(parseCSV(text)).toEqual([
      ['name', 'note'],
      ['Chen, Ada', 'She said "hi"\nsecond line'],
    ]);
  });

  it.each(['\n', '\r\n', '\r'])(
    'rejects an unclosed quoted field instead of merging subsequent records (%j)', (newline) => {
      const text = ['Name,Email', '', '"Ada,ada@example.com', 'Grace,grace@example.com'].join(newline);
      expect(() => parseCSV(text)).toThrow(/unclosed quoted field.*line 3/i);
    });

  it('rejects a lone opening quote, even when it is the last character', () => {
    expect(() => parseCSV('Name,Email\n"')).toThrow(/unclosed quoted field.*line 2/i);
  });

  it('strips a UTF-8 BOM so the first header still matches', () => {
    expect(parseCSV('﻿Name,Email\nAda,a@b.c')[0]).toEqual(['Name', 'Email']);
  });

  it('reads semicolon- and tab-separated files by their header line', () => {
    /* Excel in most of Europe writes ";" CSVs; both used to load as one
       column per line. Whichever separator the header uses most wins, comma
       on a tie, and quoted cells still hold the other characters. */
    expect(parseCSV('Name;Email;Type\r\nAda Chen;ada@x.co;Founder\r\n"Chen, Bo";;Employee\n')).toEqual([
      ['Name', 'Email', 'Type'], ['Ada Chen', 'ada@x.co', 'Founder'], ['Chen, Bo', '', 'Employee'],
    ]);
    expect(parseCSV('Name\tEmail\tType\nAda Chen\tada@x.co\tFounder\n')).toEqual([
      ['Name', 'Email', 'Type'], ['Ada Chen', 'ada@x.co', 'Founder'],
    ]);
    // A comma file whose header mentions a semicolon stays a comma file.
    expect(parseCSV('Name,Email,Notes; extra\nAda,a@b.c,x\n')).toEqual([
      ['Name', 'Email', 'Notes; extra'], ['Ada', 'a@b.c', 'x'],
    ]);
    // A single-column file is still one column.
    expect(parseCSV('Name\nAda\n')).toEqual([['Name'], ['Ada']]);
  });

  it('round-trips its own templates through toCSV', () => {
    expect(parseCSV(toCSV(STAKEHOLDER_TEMPLATE))).toEqual(STAKEHOLDER_TEMPLATE);
    expect(parseCSV(toCSV(SECURITY_TEMPLATE))).toEqual(SECURITY_TEMPLATE);
  });

  it('stamps each row with its true source line across blank lines and quoted newlines', () => {
    const rows = parseCSV('a,b\n\n1,2\n"x\ny",3\n\n\n4,5\n');
    expect(rows.map((r) => r.line)).toEqual([1, 3, 4, 8]);
  });
});

describe('headerRowIndex', () => {
  it('skips a title in a single cell above the headings', () => {
    /* The app's own cap table export opens with a one-cell title; taken as
       the header it left every picker offering that title and nothing to
       map the three required fields onto. */
    const rows = parseCSV('Acme - capitalization as of 2026-09-08 - amounts in USD\n\nStakeholder,Type,Date\nAda,Shares,2024-01-01\n');
    expect(headerRowIndex(rows)).toBe(1);
    expect(rows[headerRowIndex(rows)]).toEqual(['Stakeholder', 'Type', 'Date']);
    expect(headerRowIndex(parseCSV('name,kind\nAda,founder\n'))).toBe(0);
    // A one-column file has a one-cell header.
    expect(headerRowIndex(parseCSV('name\nAda\nBob\n'))).toBe(0);
  });
});

describe('autoMatch and units in parentheses', () => {
  it('finds a field under a heading that carries its unit or currency', () => {
    const mapping = autoMatch(['Stakeholder', 'Type', 'Price per share (USD)', 'Vesting (months)', 'Cliff (months)', 'Discount (%)'], SECURITY_FIELDS);
    expect(mapping.price).toBe(2);
    expect(mapping.vestingMonths).toBe(3);
    expect(mapping.cliffMonths).toBe(4);
    expect(mapping.discount).toBe(5);
  });
});

describe('parseCSV row ceiling', () => {
  it('stops parsing once the data rows pass the ceiling', () => {
    /* Checked after the parse, a 10 MB file of one-letter lines - five
       million rows - took a gigabyte of memory before the refusal was said. */
    const text = ['name,kind', ...Array.from({ length: 12 }, (_, i) => `H${i},employee`)].join('\n');
    expect(parseCSV(text, { maxRows: 12 })).toHaveLength(13);
    expect(() => parseCSV(text, { maxRows: 11 }))
      .toThrow('That file has more than 11 rows. Import up to 11 at a time.');
    // Blank lines are not rows.
    expect(parseCSV(`${text}\n\n\n`, { maxRows: 12 })).toHaveLength(13);
  });
});

describe('negotiated term columns', () => {
  it('imports JSON term columns validated as the forms validate them, and refuses what they refuse', () => {
    const right = [{ id: 'r1', agreement: 'Side letter', start: '2025-01-01', basis: 'fixed', fraction: 0.1, financings: ['*'] }];
    const mfn = { agreement: 'MFN letter', start: '2025-02-01', scope: ['valuationCap'], eligibleKinds: ['safe'], elections: [] };
    const text = toCSV([
      ['Stakeholder', 'Type', 'Share class', 'Quantity', 'Price per share', 'Principal', 'Date', 'Pro-rata rights JSON', 'MFN JSON'],
      ['Ada', 'Shares', 'Common', '100', '1', '', '2025-01-01', JSON.stringify(right), ''],
      ['Ada', 'SAFE', '', '', '', '50000', '2025-02-01', '', JSON.stringify(mfn)],
      ['Ada', 'Shares', 'Common', '200', '1', '', '2025-01-01', '', JSON.stringify(mfn)],
      ['Ada', 'Shares', 'Common', '300', '1', '', '2025-01-01', JSON.stringify([{ ...right[0], basis: 'bespoke' }]), ''],
      ['Ada', 'Shares', 'Common', '400', '1', '', '2025-01-01', '{not json', ''],
      ['Ada', 'SAFE', '', '', '', '60000', '2025-02-01', '', JSON.stringify({ ...mfn, elections: [{ id: 'e1', sourceId: 'later', sourceDate: '2025-03-01', date: '2025-04-01', agreement: 'Notice', financings: ['*'], terms: { valuationCap: 1 } }] })],
    ]);
    const [headers, ...rows] = parseCSV(text);
    const plan = buildSecurityPlan(rows, autoMatch(headers, SECURITY_FIELDS), {
      classes: [{ name: 'Common' }], stakeholders: [{ name: 'Ada' }],
    });
    expect(plan.creates).toHaveLength(2);
    expect(plan.creates[0].proRata).toEqual(right);
    expect(plan.creates[0].mfn).toBeUndefined();
    expect(plan.creates[1].mfn).toEqual(mfn);
    expect(plan.errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/MFN terms require a SAFE or note/),
      expect.stringMatching(/unsupported convention/),
      expect.stringMatching(/Invalid financing terms/),
      expect.stringMatching(/MFN elections cannot be imported/),
    ]);
  });
});

describe('number cells', () => {
  it.each(['Shares', 'Option', 'RSU', 'Warrant'])('rejects fractional %s quantities', (kind) => {
    const [headers, ...rows] = parseCSV(
      'Stakeholder,Type,Share class,Quantity,Date\n'
      + `Ada,${kind},Common,10.5,2025-01-01`);
    const plan = buildSecurityPlan(rows, autoMatch(headers, SECURITY_FIELDS), {
      classes: [{ name: 'Common' }], stakeholders: [{ name: 'Ada' }],
    });
    expect(plan.creates).toEqual([]);
    expect(plan.errors).toHaveLength(1);
  });

  it.each(['Shares', 'Option', 'RSU'])('rejects fractional %s schedule months', (kind) => {
    const [headers, ...rows] = parseCSV(
      'Stakeholder,Type,Share class,Quantity,Vesting months,Cliff months,Date\n'
      + `Ada,${kind},Common,10,48.5,12,2025-01-01\n`
      + `Ada,${kind},Common,10,48,12.5,2025-01-01\n`
      + `Ada,${kind},Common,10,48,12,2025-01-01`);
    const plan = buildSecurityPlan(rows, autoMatch(headers, SECURITY_FIELDS), {
      classes: [{ name: 'Common' }], stakeholders: [{ name: 'Ada' }],
    });
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0]).toMatchObject({ quantity: 10, vestingMonths: 48, cliffMonths: 12 });
    expect(plan.errors.map((e) => e.line)).toEqual([2, 3]);
  });

  it('rejects hex, exponent and decimal-comma figures instead of importing them as counts', () => {
    const text = 'Stakeholder,Type,Share class,Quantity,Price per share,Date\n'
      + 'Ada,Shares,Common,0x10,0.001,2024-01-05\n'
      + 'Ada,Shares,Common,1e3,1,2024-01-06\n'
      + 'Ada,Shares,Common,"1.000,5",1,2024-01-07\n'
      + 'Ada,Shares,Common,"1,000",1,2024-01-08\n';
    const rows = parseCSV(text);
    const plan = buildSecurityPlan(rows.slice(1), autoMatch(rows[0], SECURITY_FIELDS), {
      classes: [{ name: 'Common' }], stakeholders: [{ name: 'Ada' }],
    });
    // Number() reads the first three as 16, 1000 and 1; only the last is a count.
    expect(plan.creates.map((c) => c.quantity)).toEqual([1000]);
    expect(plan.errors.map((e) => e.line)).toEqual([2, 3, 4]);
  });
});

describe('ambiguous holders', () => {
  it('refuses a row naming two people rather than picking one', () => {
    /* The stakeholder form allows two people the same name, and the
       securities file has only a name to go on. Resolved to whichever record
       came last, the shares landed on an arbitrary person - reordering the
       two stakeholders changed who got them - and the preview said nothing. */
    const text = 'Stakeholder,Type,Share class,Quantity,Price per share,Date\n'
      + 'Alex Kim,Shares,Common,100,1,2025-01-01\n'
      + 'Ada,Shares,Common,50,1,2025-01-01\n';
    const rows = parseCSV(text);
    const plan = buildSecurityPlan(rows.slice(1), autoMatch(rows[0], SECURITY_FIELDS), {
      classes: [{ name: 'Common' }],
      stakeholders: [
        { name: 'Alex Kim', email: 'alex.one@example.com' },
        { name: 'Alex Kim', email: 'alex.two@example.com' },
        { name: 'Ada' },
      ],
    });
    expect(plan.errors).toEqual([
      { line: 2, message: '2 stakeholders are named "Alex Kim" - rename one so this row names a single holder' },
    ]);
    // The unambiguous row is still importable.
    expect(plan.creates.map((c) => c.stakeholderName)).toEqual(['Ada']);
  });
});

describe('share rows and their money', () => {
  it('refuses a certificate whose money sits in the amount column with no price', () => {
    const text = 'Stakeholder,Type,Share class,Quantity,Amount,Date\n'
      + 'Nova Ventures,Preferred,Series Seed Preferred,1470588,"$1,250,000",2024-06-10\n';
    const rows = parseCSV(text);
    const plan = buildSecurityPlan(rows.slice(1), autoMatch(rows[0], SECURITY_FIELDS), {
      classes: [{ name: 'Series Seed Preferred' }], stakeholders: [{ name: 'Nova Ventures' }],
    });
    expect(plan.errors).toEqual([
      { line: 2, message: 'Shares take their price from the Price per share column, and this row has an amount but no price' },
    ]);
  });

  it('refuses figures past what a record can hold rather than clamping them', () => {
    const text = 'Stakeholder,Type,Share class,Quantity,Price per share,Date\n'
      + 'Ada,Shares,Common,99999999999999999999,1,2024-01-01\n'
      + 'Ada,Shares,Common,100,9999999999999999,2024-01-01\n';
    const rows = parseCSV(text);
    const plan = buildSecurityPlan(rows.slice(1), autoMatch(rows[0], SECURITY_FIELDS), {
      classes: [{ name: 'Common' }], stakeholders: [{ name: 'Ada' }],
    });
    expect(plan.errors.map((e) => e.message)).toEqual([
      'Quantity "99999999999999999999" is more than a share count can hold',
      'Price per share "9999999999999999" isn’t usable',
    ]);
  });

  it('offers a new class once whatever its spelling', () => {
    const text = 'Stakeholder,Type,Share class,Quantity,Price per share,Date\n'
      + 'Ada,Shares,Ordinary,100,1,2024-01-01\nAda,Shares,ordinary,100,1,2024-01-01\nAda,Shares,ORDINARY,100,1,2024-01-01\n';
    const rows = parseCSV(text);
    const plan = buildSecurityPlan(rows.slice(1), autoMatch(rows[0], SECURITY_FIELDS), {
      classes: [], stakeholders: [{ name: 'Ada' }],
    });
    expect(plan.errors).toEqual([]);
    expect(plan.newClasses).toEqual(['Ordinary']);
  });
});

describe('ambiguous share classes', () => {
  it('refuses a row naming two classes rather than picking one', () => {
    const text = 'Stakeholder,Type,Share class,Quantity,Price per share,Date\n'
      + 'Ada,Shares,Series A,100,1,2025-01-01\n'
      + 'Ada,Shares,Common,50,1,2025-01-01\n';
    const rows = parseCSV(text);
    const plan = buildSecurityPlan(rows.slice(1), autoMatch(rows[0], SECURITY_FIELDS), {
      classes: [
        { name: 'Series A', liquidationPreference: 1 },
        { name: 'Series A', liquidationPreference: 3 },
        { name: 'Common' },
      ],
      stakeholders: [{ name: 'Ada' }],
    });
    expect(plan.errors).toEqual([
      { line: 2, message: '2 share classes are named "Series A" - rename one so this row names a single class' },
    ]);
    expect(plan.creates.map((c) => c.className)).toEqual(['Common']);
    // A class the file names once and the table not at all is still an offer
    // to create, not an ambiguity.
    expect(plan.newClasses).toEqual([]);
  });
});

describe('autoMatch', () => {
  it('matches headers case- and punctuation-insensitively', () => {
    const m = autoMatch(['Full Name', 'E-mail', 'Role'], STAKEHOLDER_FIELDS);
    expect(m).toEqual({ name: 0, email: 1, kind: 2 });
  });

  it('matches every column of the templates it hands out', () => {
    const holders = autoMatch(STAKEHOLDER_TEMPLATE[0], STAKEHOLDER_FIELDS);
    for (const f of STAKEHOLDER_FIELDS) expect(holders[f.key]).not.toBeNull();
    const secs = autoMatch(SECURITY_TEMPLATE[0], SECURITY_FIELDS);
    for (const f of SECURITY_FIELDS) expect(secs[f.key]).not.toBeNull();
  });

  it('leaves unknown fields unmapped and never double-assigns a column', () => {
    const m = autoMatch(['Name', 'Notes'], STAKEHOLDER_FIELDS);
    expect(m.name).toBe(0);
    expect(m.email).toBeNull();
    const s = autoMatch(['Stakeholder', 'Name'], SECURITY_FIELDS);
    // 'Stakeholder' takes the holder slot; the literal 'Name' column stays free.
    expect(s.stakeholder).toBe(0);
  });
});

describe('toISODate', () => {
  it('passes ISO through, converts US dates, flags junk', () => {
    expect(toISODate('2026-03-01')).toBe('2026-03-01');
    expect(toISODate('3/1/2026')).toBe('2026-03-01');
    expect(toISODate('12-31-2026')).toBe('2026-12-31');
    expect(toISODate('')).toBe('');
    expect(toISODate('soon')).toBeNull();
  });

  it('rejects a day the month does not have', () => {
    // These parse to a real date by rolling forward, so they have to be
    // caught by checking the day back rather than by Invalid Date.
    expect(toISODate('2/30/2024')).toBeNull();
    expect(toISODate('4/31/2024')).toBeNull();
    expect(toISODate('2024-02-30')).toBeNull();
    expect(toISODate('13/1/2024')).toBeNull();
  });

  it('reads a file’s slashed dates day-first once one of them says so', () => {
    expect(slashedDateOrder(['12/31/2023', '5/6/2023'])).toBe('month');
    expect(slashedDateOrder(['31/12/2023', '5/6/2023', '2024-01-01'])).toBe('day');
    expect(slashedDateOrder(['31/12/2023', '12/31/2023'])).toBe('mixed');
    expect(toISODate('31/12/2023', 'day')).toBe('2023-12-31');
    expect(toISODate('5/6/2023', 'day')).toBe('2023-06-05');
    expect(toISODate('5/6/2023', 'month')).toBe('2023-05-06');
    expect(toISODate('5/6/2023', 'mixed')).toBeNull();
    expect(toISODate('2023-05-06', 'mixed')).toBe('2023-05-06');
    const text = 'Stakeholder,Type,Share class,Quantity,Price per share,Date\n'
      + 'Ada,Shares,Common,100,1,31/12/2023\n'
      + 'Ada,Shares,Common,50,1,05/06/2023\n';
    const rows = parseCSV(text);
    const plan = buildSecurityPlan(rows.slice(1), autoMatch(rows[0], SECURITY_FIELDS), {
      classes: [{ name: 'Common' }], stakeholders: [{ name: 'Ada' }],
    });
    expect(plan.errors).toEqual([]);
    expect(plan.creates.map((c) => c.date)).toEqual(['2023-12-31', '2023-06-05']);
    const mixed = parseCSV('Stakeholder,Type,Share class,Quantity,Price per share,Date\n'
      + 'Ada,Shares,Common,100,1,31/12/2023\nAda,Shares,Common,50,1,12/31/2023\n');
    const plan2 = buildSecurityPlan(mixed.slice(1), autoMatch(mixed[0], SECURITY_FIELDS), {
      classes: [{ name: 'Common' }], stakeholders: [{ name: 'Ada' }],
    });
    expect(plan2.errors.map((e) => e.message)).toEqual([
      'Ambiguous date "31/12/2023": this file mixes day-first and month-first dates (use YYYY-MM-DD)',
      'Ambiguous date "12/31/2023": this file mixes day-first and month-first dates (use YYYY-MM-DD)',
    ]);
    expect(toISODate('1/0/2024')).toBeNull();
    expect(toISODate('2024-13-01')).toBeNull();
  });

  it('follows the real leap-year rule', () => {
    expect(toISODate('2/29/2024')).toBe('2024-02-29');
    expect(toISODate('2000-02-29')).toBe('2000-02-29');
    expect(toISODate('2/29/2023')).toBeNull();
    // Divisible by 100 but not 400 - not a leap year.
    expect(toISODate('2100-02-29')).toBeNull();
  });
});

describe('buildStakeholderPlan', () => {
  const mapping = { name: 0, email: 1, kind: 2 };

  it('creates, skips duplicates, and flags unknown types', () => {
    const rows = [
      ['Ada Chen', 'ada@x.co', 'Founder'],
      ['Ada Chen', '', 'Founder'],
      ['Existing Person', '', 'Investor'],
      ['Bob', '', 'Martian'],
      ['', '', 'Employee'],
      ['Carol', '', ''],
    ];
    const plan = buildStakeholderPlan(rows, mapping, {
      stakeholders: [{ name: 'Existing Person' }],
    });
    expect(plan.creates.map((c) => c.name)).toEqual(['Ada Chen', 'Carol']);
    // A blank type defaults to employee; a nonsense one is an error.
    expect(plan.creates[1].kind).toBe('employee');
    expect(plan.skips.map((s) => s.name)).toEqual(['Ada Chen', 'Existing Person']);
    // The second Ada row repeats the first; the other name is on the cap table already.
    expect(plan.skips.map((s) => s.reason)).toEqual(['Earlier in this file', 'Already on the cap table']);
    expect(plan.errors).toHaveLength(2);
    // Bob's Martian type on file line 5, the missing name on line 6.
    expect(plan.errors.map((e) => e.line)).toEqual([5, 6]);
  });

  it('holds the email column to what the stakeholder form takes', () => {
    /* Written as it came, a column mapped one across put phone numbers and
       names into every holder's email. Blank stays fine: the field is optional. */
    const rows = [
      ['Ada Chen', 'ada@x.co', 'Founder'],
      ['Bob', 'Bob Smith', 'Employee'],
      ['Cy', '555-1234', 'Investor'],
      ['Dee', 'dee@acme', 'Employee'],
      ['Eve', '', 'Employee'],
      ['Fay', 'not an email@x.co', 'Employee'],
    ];
    const plan = buildStakeholderPlan(rows, mapping, { stakeholders: [] });
    expect(plan.creates.map((c) => [c.name, c.email])).toEqual([
      ['Ada Chen', 'ada@x.co'], ['Dee', 'dee@acme'], ['Eve', ''],
    ]);
    expect(plan.errors.map((e) => [e.line, e.message])).toEqual([
      [3, '"Bob Smith" isn’t an email address'],
      [4, '"555-1234" isn’t an email address'],
      [7, '"not an email@x.co" isn’t an email address'],
    ]);
  });

  it('refuses an email longer than the record keeps', () => {
    /* The sanitizer cuts an address to the form's 120 characters; what it
       kept of a longer one was no address, and nothing in the preview said so. */
    const long = `${'a'.repeat(130)}@example.com`;
    const plan = buildStakeholderPlan([['Zed Long', long, 'Investor']], mapping, { stakeholders: [] });
    expect(plan.creates).toEqual([]);
    expect(plan.errors.map((e) => e.message)).toEqual([
      `"${long}" is longer than the 120 characters an email address can have here`,
    ]);
  });

  it('trims a name again after cutting it, as the record does', () => {
    /* A cut landing just past a space left the plan holding a name one
       trailing space longer than the stored record: a second import of the
       file promised the holder again, and the securities file's rows for
       them found no holder. */
    const cell = `${'A'.repeat(119)} B`;
    const stored = 'A'.repeat(119);
    const first = buildStakeholderPlan([[cell, '', 'Founder']], mapping, { stakeholders: [] });
    expect(first.creates.map((c) => c.name)).toEqual([stored]);
    const again = buildStakeholderPlan([[cell, '', 'Founder']], mapping, { stakeholders: [{ name: stored }] });
    expect(again.creates).toEqual([]);
    expect(again.skips.map((s) => s.reason)).toEqual(['Already on the cap table']);
    const secRows = [[cell, 'Shares', `${'C'.repeat(79)} D`, '100', '1', '', '', '', '', '', '', '2024-01-01', '', '', '', '', '', '']];
    const secMapping = autoMatch(SECURITY_TEMPLATE[0], SECURITY_FIELDS);
    const secPlan = buildSecurityPlan(secRows, secMapping, { classes: [{ name: 'C'.repeat(79) }], stakeholders: [{ name: stored }] });
    expect(secPlan.errors).toEqual([]);
    expect(secPlan.creates[0]).toMatchObject({ stakeholderName: stored, className: 'C'.repeat(79) });
    expect(secPlan.newClasses).toEqual([]);
  });

  it('leaves a failed row\'s name free for a later valid row', () => {
    const rows = [
      ['Ada', 'ada@x.co', 'Martian'],
      ['Ada', 'ada@x.co', 'Employee'],
    ];
    const plan = buildStakeholderPlan(rows, mapping, { stakeholders: [] });
    expect(plan.creates.map((c) => c.name)).toEqual(['Ada']);
    expect(plan.skips).toEqual([]);
    expect(plan.errors.map((e) => e.line)).toEqual([2]);
  });

  it('reports error lines as they appear in the file, not the compacted row index', () => {
    const text = 'Name,Email,Type\nAda Chen,,Founder\n\nBob,,Martian\n';
    const plan = buildStakeholderPlan(parseCSV(text).slice(1), mapping, {});
    // "Bob" sits on file line 4; a blank-line-blind count would say 3.
    expect(plan.errors.map((e) => e.line)).toEqual([4]);
  });
});

describe('buildSecurityPlan', () => {
  const headers = SECURITY_TEMPLATE[0];
  const mapping = autoMatch(headers, SECURITY_FIELDS);
  const ctx = {
    classes: [{ name: 'Common Stock' }],
    stakeholders: [
      { name: 'Ada Chen' }, { name: 'Sam Rivera' }, { name: 'Priya Nair' }, { name: 'Nova Ventures' },
    ],
  };

  it('names only holders the stakeholder template creates', () => {
    /* The two templates are downloaded side by side and the wizard says to
       import holders first, so every name in the securities file has to be in
       the other one - or the app's own examples fail a row against each
       other on a first-time import. */
    const holderMap = autoMatch(STAKEHOLDER_TEMPLATE[0], STAKEHOLDER_FIELDS);
    const holders = buildStakeholderPlan(STAKEHOLDER_TEMPLATE.slice(1), holderMap, {});
    expect(holders.errors).toEqual([]);
    const plan = buildSecurityPlan(SECURITY_TEMPLATE.slice(1), mapping, {
      classes: [], stakeholders: holders.creates,
    });
    expect(plan.errors).toEqual([]);
    expect(plan.creates).toHaveLength(SECURITY_TEMPLATE.length - 1);
  });

  it('refuses columns a kind has no field for rather than dropping them', () => {
    /* A warrant carrying a vesting schedule imported as exercisable in full
       from day one, an option whose exercise price sat in the Price column
       imported with a strike of nothing, and an RSU carrying a strike is an
       option under the wrong type - each dropped without a word. */
    const row = (kind, cells) => {
      const r = ['Ada Chen', kind, 'Common Stock', '100', '', '', '', '', '', '', '', '2025-06-01', '', '', '', '', ''];
      for (const [i, v] of Object.entries(cells)) r[i] = v;
      return r;
    };
    // Template columns: 4 price, 5 strike, 6 principal, 12 vesting months, 13 cliff, 14 vesting start.
    const bad = buildSecurityPlan([
      row('Warrant', { 12: '48' }),
      row('SAFE', { 6: '1000', 13: '12' }),
      row('Note', { 6: '1000', 14: '2025-01-01' }),
      row('Option', { 4: '0.10' }),
      row('Warrant', { 4: '0.85' }),
      row('RSU', { 5: '0.10' }),
      // The share price in the strike column - and a strike beside a price.
      row('Shares', { 5: '0.50' }),
      row('Shares', { 4: '0.25', 5: '0.50' }),
    ], mapping, ctx);
    expect(bad.creates).toEqual([]);
    const shareStrike = 'Shares have no strike: put the issue price in the Price per share column and leave '
      + 'the strike column blank, or import the row as an option or a warrant';
    expect(bad.errors.map((e) => e.message)).toEqual([
      'A warrant has no vesting schedule: leave the vesting columns blank',
      'A SAFE has no vesting schedule: leave the vesting columns blank',
      'A note has no vesting schedule: leave the vesting columns blank',
      'Options take their exercise price from the Strike price column, and this row has a price but no strike',
      'A warrant takes its exercise price from the Strike price column, and this row has a price but no strike',
      'An RSU has no strike: leave the strike column blank, or import the row as an option',
      shareStrike,
      shareStrike,
    ]);
    // Zero is what a spreadsheet writes in a cell that does not apply, and a
    // price beside a strike is simply a price.
    const good = buildSecurityPlan([
      row('Warrant', { 5: '0.85', 12: '0', 13: '0' }),
      row('Option', { 4: '0.10', 5: '0.10' }),
      row('RSU', { 5: '0' }),
      row('SAFE', { 6: '1000', 12: '0' }),
      row('Shares', { 4: '0.25', 5: '0' }),
    ], mapping, ctx);
    expect(good.errors).toEqual([]);
    expect(good.creates).toHaveLength(5);
    expect(good.creates[4]).toMatchObject({ kind: 'shares', pricePerShare: 0.25 });
    expect(good.creates[1]).toMatchObject({ kind: 'option', strike: 0.1 });
  });

  it('refuses a deadline typed in the other kind’s column rather than dropping it', () => {
    /* A note whose maturity sat under Expires imported as a note that never
       matures, an option or warrant whose term sat under Maturity date as one
       that never expires, and a SAFE carrying a maturity or interest is a
       note under the wrong type. Each was dropped without a word. */
    const row = (kind, cells) => {
      const r = ['Ada Chen', kind, 'Common Stock', '100', '', '', '', '', '', '', '', '2025-06-01', '', '', '', '', '', ''];
      for (const [i, v] of Object.entries(cells)) r[i] = v;
      return r;
    };
    // Template columns: 5 strike, 6 principal, 9 interest, 15 expires, 16 maturity.
    const bad = buildSecurityPlan([
      row('Note', { 6: '150000', 15: '2027-08-01' }),
      row('Option', { 5: '0.10', 16: '2035-01-01' }),
      row('Warrant', { 5: '1', 16: '2030-01-01' }),
      row('SAFE', { 6: '250000', 16: '2027-01-01' }),
      row('SAFE', { 6: '250000', 9: '8' }),
      row('Shares', { 4: '0.25', 15: '2030-01-01' }),
      row('RSU', { 16: '2030-01-01' }),
    ], mapping, ctx);
    expect(bad.creates).toEqual([]);
    const safeMsg = 'A SAFE has no maturity date and accrues no interest: leave those columns blank, or import the row as a note';
    expect(bad.errors.map((e) => e.message)).toEqual([
      'A note matures rather than expires: put the date in the Maturity date column and leave Expires blank',
      'An option grant expires rather than matures: put the date in the Expires column and leave Maturity date blank',
      'A warrant expires rather than matures: put the date in the Expires column and leave Maturity date blank',
      safeMsg,
      safeMsg,
      'Shares have no expiration or maturity date: leave those columns blank',
      'An RSU award has no expiration or maturity date: leave those columns blank',
    ]);
    // Each deadline in its own column, and a zero interest rate on a SAFE, go through.
    const good = buildSecurityPlan([
      row('Note', { 6: '150000', 9: '8', 16: '2027-08-01' }),
      row('Option', { 5: '0.10', 15: '2035-01-01' }),
      row('SAFE', { 6: '250000', 9: '0' }),
    ], mapping, ctx);
    expect(good.errors).toEqual([]);
    expect(good.creates.map((c) => [c.kind, c.maturityDate || c.expires || null])).toEqual([
      ['note', '2027-08-01'], ['option', '2035-01-01'], ['safe', null],
    ]);
  });

  it('refuses a cliff that outlasts the vesting period, as the form does', () => {
    /* The import clamped "60" in the cliff column of a 48-month schedule to
       48 without a word, on the three kinds that vest; the form refuses the
       same figure because a grant cannot vest in full before its own cliff. */
    const rows = parseCSV([
      'Stakeholder,Type,Share class,Quantity,Price per share,Strike price,Date,Vesting months,Cliff months',
      'Ada Chen,Shares,Common Stock,1000,0.0001,,2026-01-01,48,60',
      'Sam Rivera,Option,,500,,0.1,2026-01-01,48,60',
      'Priya Nair,RSU,Common Stock,200,,,2026-01-01,24,36',
      // Within the schedule, and a cliff on a grant with no schedule at all,
      // both still go through.
      'Sam Rivera,Option,,500,,0.1,2026-01-01,48,48',
      'Priya Nair,RSU,Common Stock,200,,,2026-01-01,0,12',
    ].join('\n'));
    const plan = buildSecurityPlan(rows.slice(1), autoMatch(rows[0], SECURITY_FIELDS), ctx);
    expect(plan.errors.map((e) => [e.line, e.message])).toEqual([
      [2, 'Cliff of 60 months outlasts the 48-month vesting period'],
      [3, 'Cliff of 60 months outlasts the 48-month vesting period'],
      [4, 'Cliff of 36 months outlasts the 24-month vesting period'],
    ]);
    expect(plan.creates.map((c) => [c.kind, c.vestingMonths, c.cliffMonths])).toEqual([
      ['option', 48, 48], ['rsu', 0, 0],
    ]);
  });

  it('plans every template row cleanly', () => {
    const plan = buildSecurityPlan(SECURITY_TEMPLATE.slice(1), mapping, ctx);
    expect(plan.errors).toEqual([]);
    expect(plan.creates).toHaveLength(5);
    const [cert, grant, award, safe, note] = plan.creates;
    expect(cert).toMatchObject({ kind: 'shares', className: 'Common Stock', quantity: 4_000_000, pricePerShare: 0.0001 });
    expect(grant).toMatchObject({ kind: 'option', quantity: 120_000, strike: 0.09, vestingMonths: 48, cliffMonths: 12, expires: '2034-07-01' });
    expect(award).toMatchObject({
      kind: 'rsu', className: 'Common Stock', quantity: 20_000,
      grantDate: '2026-01-15', vestingMonths: 48, cliffMonths: 12,
    });
    // No strike and no expiry ever ride on an award.
    expect(award.strike).toBeUndefined();
    expect(award.expires).toBeUndefined();
    expect(safe).toMatchObject({ kind: 'safe', principal: 250_000, valuationCap: 8_000_000, discount: 20, safeType: 'post' });
    expect(note).toMatchObject({ kind: 'note', principal: 150_000, interestRate: 8, maturityDate: '2027-08-01' });
  });

  it('reads the SAFE cap type however the cell puts it, and fails one it cannot read', () => {
    /* Only a cell starting with "pre" counted as pre-money; "Standard
       pre-money SAFE" imported as post-money, and so did "MFN", with nothing
       in the preview to say the column had not been read. */
    const row = (type) => ['Nova Ventures', 'SAFE', '', '', '', '', '250000', '8000000', '20', '', type, '2025-11-05', '', '', '', '', '', ''];
    const plan = buildSecurityPlan([
      row(''), row('post'), row('Post-Money'), row('pre'), row('Pre-money'),
      row('Standard pre-money SAFE'), row('YC post money safe'), row('premoney'),
      row('MFN'), row('pre or post'), row('preferred'),
    ], mapping, ctx);
    expect(plan.creates.map((c) => c.safeType)).toEqual([
      'post', 'post', 'post', 'pre', 'pre', 'pre', 'post', 'pre',
    ]);
    expect(plan.errors.map((e) => e.message)).toEqual([
      'Unknown SAFE cap type "MFN" (use pre or post)',
      'Unknown SAFE cap type "pre or post" (use pre or post)',
      'Unknown SAFE cap type "preferred" (use pre or post)',
    ]);
  });

  it('refuses a principal past what a record can hold rather than clamping it', () => {
    // The cap and discount columns were already refused past 1e15; the
    // principal was accepted and then written down to 1e15 by the record.
    const row = (kind, principal) => ['Nova Ventures', kind, '', '', '', '', principal, '', '', kind === 'Note' ? '8' : '', kind === 'SAFE' ? 'post' : '', '2025-11-05', '', '', '', '', kind === 'Note' ? '2027-11-05' : '', ''];
    const plan = buildSecurityPlan([
      row('SAFE', '1000000000000000'), row('SAFE', '2000000000000000'), row('Note', '10000000000000000000'), row('Note', 'lots'),
    ], mapping, ctx);
    expect(plan.creates.map((c) => c.principal)).toEqual([1e15]);
    expect(plan.errors.map((e) => e.message)).toEqual([
      'Principal "2000000000000000" isn’t usable',
      'Principal "10000000000000000000" isn’t usable',
      'Principal "lots" isn’t usable',
    ]);
  });

  it('refuses a vesting period longer than a record keeps', () => {
    const rows = [
      ['Ada Chen', 'Option', '', '1000', '', '0.1', '', '', '', '', '', '2026-01-01', '600', '12', '', '', '', ''],
      ['Ada Chen', 'Option', '', '1000', '', '0.1', '', '', '', '', '', '2026-01-01', '601', '12', '', '', '', ''],
    ];
    const plan = buildSecurityPlan(rows, mapping, ctx);
    expect(plan.creates.map((c) => c.vestingMonths)).toEqual([600]);
    expect(plan.errors.map((e) => e.message)).toEqual(['Vesting months "601" isn’t usable']);
  });

  it('cuts a name to what the record keeps before comparing it', () => {
    /* A 125-character name is stored as its first 120 characters. Compared
       at full length, two spellings that differ only past the cut imported
       as two holders under one stored name, and a securities file naming the
       holder at full length found no record under it. */
    const long = 'A'.repeat(120);
    const stRows = [[`${long}-one`, 'a@b.c', 'Founder'], [`${long}-two`, 'c@d.e', 'Founder']];
    const stPlan = buildStakeholderPlan(stRows, { name: 0, email: 1, kind: 2 }, { stakeholders: [] });
    expect(stPlan.creates.map((c) => c.name)).toEqual([long]);
    expect(stPlan.skips).toHaveLength(1);
    const secRows = [[`${long}-three`, 'Shares', 'C'.repeat(85), '100', '1', '', '', '', '', '', '', '2024-01-01', '', '', '', '', '', '']];
    const secPlan = buildSecurityPlan(secRows, mapping, { classes: [{ name: 'C'.repeat(80) }], stakeholders: [{ name: long }] });
    expect(secPlan.errors).toEqual([]);
    expect(secPlan.creates[0]).toMatchObject({ stakeholderName: long, className: 'C'.repeat(80) });
    expect(secPlan.newClasses).toEqual([]);
  });

  it('needs a share class for an RSU award, since that is what settles', () => {
    const rows = [['Ada Chen', 'RSU', '', '1000', '', '', '', '', '', '', '', '2026-01-01', '48', '12', '', '', '']];
    const plan = buildSecurityPlan(rows, mapping, ctx);
    expect(plan.creates).toEqual([]);
    expect(plan.errors[0].message).toMatch(/RSU award needs a share class/);
  });

  it('counts the rows that repeat a security already on the cap table, and still creates them', () => {
    const rows = [
      ['Ada Chen', 'Shares', 'Common Stock', '1000', '1', '', '', '', '', '', '', '2024-01-01', '', '', '', '', '', ''],
      ['Ada Chen', 'Option', '', '500', '', '0.1', '', '', '', '', '', '2026-01-01', '48', '12', '', '', '', ''],
      ['Ada Chen', 'SAFE', '', '', '', '', '100000', '5000000', '', '', 'post', '2025-01-01', '', '', '', '', '', ''],
    ];
    const first = buildSecurityPlan(rows, mapping, ctx);
    expect(first.repeated).toBe(0);
    const onTable = [
      { kind: 'shares', stakeholderId: 'h1', classId: 'c1', quantity: 1000, date: '2024-01-01' },
      { kind: 'option', stakeholderId: 'h1', quantity: 500, grantDate: '2026-01-01' },
      { kind: 'safe', stakeholderId: 'h1', principal: 100000, date: '2025-01-01' },
    ];
    const again = buildSecurityPlan(rows, mapping, {
      classes: [{ id: 'c1', name: 'Common Stock' }],
      stakeholders: [{ id: 'h1', name: 'Ada Chen' }],
      securities: onTable,
    });
    expect(again.repeated).toBe(3);
    expect(again.creates).toHaveLength(3);
    // A different amount is a different security.
    const changed = buildSecurityPlan(rows, mapping, {
      classes: [{ id: 'c1', name: 'Common Stock' }],
      stakeholders: [{ id: 'h1', name: 'Ada Chen' }],
      securities: onTable.map((s) => ({ ...s, quantity: 7, principal: 7 })),
    });
    expect(changed.repeated).toBe(0);
  });

  it('reads "Restricted stock units" as the RSU type', () => {
    const rows = [['Ada Chen', 'Restricted stock units', 'Common Stock', '500', '', '', '', '', '', '', '', '2026-01-01', '24', '0', '', '', '']];
    const plan = buildSecurityPlan(rows, mapping, ctx);
    expect(plan.errors).toEqual([]);
    expect(plan.creates[0]).toMatchObject({ kind: 'rsu', quantity: 500, vestingMonths: 24 });
  });

  it('refuses a deadline that does not fall after the record it belongs to', () => {
    /* The security form refuses an expiration on or before the grant date and
       a maturity on or before the issue date; the import used to accept both,
       so a mistyped year wrote grants that read as expired and notes that read
       as matured the moment they landed. */
    const grant = (expires) => ['Ada Chen', 'Option', '', '1000', '', '0.05', '', '', '', '', '', '2025-01-01', '48', '12', '', expires, ''];
    const warrant = (expires) => ['Ada Chen', 'Warrant', 'Common Stock', '1000', '', '1', '', '', '', '', '', '2025-01-01', '', '', '', expires, ''];
    const note = (maturity) => ['Ada Chen', 'Note', '', '', '', '', '100000', '', '', '8', '', '2025-01-01', '', '', '', '', maturity];

    const bad = buildSecurityPlan(
      [grant('2024-01-01'), grant('2025-01-01'), warrant('2024-06-01'), note('2024-06-01')], mapping, ctx);
    expect(bad.creates).toEqual([]);
    expect(bad.errors.map((e) => e.message)).toEqual([
      'Expiration "2024-01-01" is not after the grant date 2025-01-01',
      'Expiration "2025-01-01" is not after the grant date 2025-01-01',
      'Expiration "2024-06-01" is not after the issue date 2025-01-01',
      'Maturity "2024-06-01" is not after the issue date 2025-01-01',
    ]);

    // A later deadline, and no deadline at all, both still import.
    const good = buildSecurityPlan(
      [grant('2035-01-01'), grant(''), warrant('2030-01-01'), note('2027-06-01')], mapping, ctx);
    expect(good.errors).toEqual([]);
    expect(good.creates).toHaveLength(4);
    expect(good.creates[1].expires).toBeUndefined();
  });

  it('requires a date on every security row', () => {
    /* An undated option grant never vests - months elapsed from no date read
       as none - and sat "active" for good, off the coming-up list and the
       needs-attention list alike. The forms date every security; so does this. */
    expect(SECURITY_FIELDS.find((f) => f.key === 'date').required).toBe(true);
    const rows = [
      ['Ada Chen', 'Shares', 'Common Stock', '100', '1', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['Sam Rivera', 'Option', '', '1000', '', '0.5', '', '', '', '', '', '', '48', '12', '', '', ''],
      ['Nova Ventures', 'SAFE', '', '', '', '', '100000', '', '', '', 'post', '', '', '', '', '', ''],
    ];
    const plan = buildSecurityPlan(rows, mapping, ctx);
    expect(plan.creates).toEqual([]);
    expect(plan.errors.map((e) => [e.line, e.message])).toEqual([
      [2, 'Missing the date it was issued, granted, or signed'],
      [3, 'Missing the date it was issued, granted, or signed'],
      [4, 'Missing the date it was issued, granted, or signed'],
    ]);
  });

  it('imports an independent vesting start on options and RSUs without changing the grant date', () => {
    const option = (start, months = '48') => ['Sam Rivera', 'Option', '', '1000', '', '0.5', '', '', '', '', '', '2025-06-01', months, '12', start, '', ''];
    const award = (start) => ['Sam Rivera', 'RSU', 'Common Stock', '1000', '', '', '', '', '', '', '', '2025-06-01', '48', '12', start, '', ''];
    const good = buildSecurityPlan([option('2025-01-01'), award('2025-01-01'), option(''), option('2025-06-01')], mapping, ctx);
    expect(good.errors).toEqual([]);
    expect(good.creates).toHaveLength(4);
    for (const c of good.creates.slice(0, 2)) expect(c).toMatchObject({ date: '2025-06-01', grantDate: '2025-06-01', vestingStart: '2025-01-01', vestingMonths: 48 });
    expect(good.creates[2].vestingStart).toBeUndefined();
    const bad = buildSecurityPlan([option('someday'), option('2025-01-01', '0')], mapping, ctx);
    expect(bad.creates).toEqual([]);
    expect(bad.errors.map((e) => e.message)).toEqual([
      'Unreadable vesting start "someday"',
      'A vesting start needs a vesting period: fill in the vesting months or leave the start blank',
    ]);
  });

  it('refuses a vesting start on a certificate with no vesting period', () => {
    /* The start column was read only once vesting months were given, so a
       founder row carrying a hire date and a blank vesting period imported a
       fully vested certificate, with nothing in the preview to say the start
       had been dropped. A start means nothing without a schedule. */
    const cert = (months, start) => ['Ada Chen', 'Shares', 'Common Stock', '100', '1', '', '', '', '', '', '', '2025-06-01', months, '', start, '', ''];
    const bad = buildSecurityPlan([cert('', '2025-01-01'), cert('0', '2025-01-01'), cert('', 'someday')], mapping, ctx);
    expect(bad.creates).toEqual([]);
    expect(bad.errors.map((e) => e.message)).toEqual([
      'A vesting start needs a vesting period: fill in the vesting months or leave the start blank',
      'A vesting start needs a vesting period: fill in the vesting months or leave the start blank',
      'Unreadable vesting start "someday"',
    ]);
    // No start and no period is an ordinary, fully vested certificate.
    const plain = buildSecurityPlan([cert('', '')], mapping, ctx);
    expect(plain.errors).toEqual([]);
    expect(plain.creates[0].vestingStart).toBeUndefined();
    expect(plain.creates[0].vestingMonths).toBeUndefined();
  });

  it('carries the 83(b) filing date on restricted stock, held to its window', () => {
    /* Without the column every reverse-vesting certificate a spreadsheet
       brought in from years back landed on the needs-attention list as "no
       83(b) election on file" the moment it was imported. */
    const cert = (months, filed, date = '2025-06-01') => ['Ada Chen', 'Shares', 'Common Stock', '100', '1', '', '', '', '', '', '', date, months, '', '', '', '', filed];
    const good = buildSecurityPlan([
      cert('48', '2025-06-20'),
      cert('48', '2025-06-01'),
      // The last day of the window, and the slash date a spreadsheet writes.
      cert('48', '2025-07-01'),
      cert('12', '6/15/2025'),
      // No election recorded is still an ordinary import.
      cert('48', ''),
    ], mapping, ctx);
    expect(good.errors).toEqual([]);
    expect(good.creates.map((c) => c.filed83b)).toEqual(['2025-06-20', '2025-06-01', '2025-07-01', '2025-06-15', undefined]);
    expect(good.creates[0]).toMatchObject({ vestingMonths: 48, vestingStart: '2025-06-01' });

    const bad = buildSecurityPlan([
      cert('48', '2025-05-31'),
      cert('48', '2025-07-02'),
      cert('', '2025-06-10'),
      cert('0', '2025-06-10'),
      cert('48', 'soon'),
    ], mapping, ctx);
    expect(bad.creates).toEqual([]);
    expect(bad.errors.map((e) => e.message)).toEqual([
      '83(b) filed 2025-05-31, before the shares were issued on 2025-06-01',
      '83(b) filed 2025-07-02, after the 30-day window that closed on 2025-07-01',
      'An 83(b) election only applies to shares that vest: fill in the vesting months or leave the 83(b) column blank',
      'An 83(b) election only applies to shares that vest: fill in the vesting months or leave the 83(b) column blank',
      'Unreadable 83(b) filing date "soon" (use YYYY-MM-DD)',
    ]);
  });

  it('refuses an 83(b) date on anything but a certificate', () => {
    const row = (kind, cells) => {
      const r = ['Ada Chen', kind, 'Common Stock', '100', '', '', '', '', '', '', '', '2025-06-01', '', '', '', '', '', '2025-06-10'];
      for (const [i, v] of Object.entries(cells)) r[i] = v;
      return r;
    };
    const bad = buildSecurityPlan([
      row('Option', { 5: '0.10' }),
      row('RSU', {}),
      row('Warrant', { 5: '0.85' }),
      row('SAFE', { 6: '1000' }),
      row('Note', { 6: '1000' }),
    ], mapping, ctx);
    expect(bad.creates).toEqual([]);
    expect(bad.errors).toHaveLength(5);
    expect(new Set(bad.errors.map((e) => e.message))).toEqual(new Set([
      'An 83(b) election is filed on restricted stock, not on this kind of security: leave the 83(b) column blank',
    ]));
  });

  it('imports the template’s founder stock with its election on file', () => {
    const plan = buildSecurityPlan(SECURITY_TEMPLATE.slice(1), mapping, ctx);
    expect(plan.errors).toEqual([]);
    expect(plan.creates[0]).toMatchObject({
      kind: 'shares', vestingMonths: 48, cliffMonths: 12, vestingStart: '2023-05-20', filed83b: '2023-06-02',
    });
  });

  it('collects unknown share classes instead of failing the row', () => {
    const rows = [['Ada Chen', 'Shares', 'Series Z Preferred', '100', '1', '', '', '', '', '', '', '2026-01-01', '', '', '', '', '']];
    const plan = buildSecurityPlan(rows, mapping, ctx);
    expect(plan.errors).toEqual([]);
    expect(plan.newClasses).toEqual(['Series Z Preferred']);
  });

  it('reports the errors the issue names: unknown class holder, bad date, bad quantity', () => {
    const rows = [
      ['Nobody Here', 'Shares', 'Common Stock', '100', '1', '', '', '', '', '', '', '2026-01-01', '', '', '', '', ''],
      ['Ada Chen', 'Shares', 'Common Stock', '-5', '1', '', '', '', '', '', '', '2026-01-01', '', '', '', '', ''],
      ['Ada Chen', 'Shares', 'Common Stock', '100', '1', '', '', '', '', '', '', 'someday', '', '', '', '', ''],
      ['Ada Chen', 'Spaceship', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ];
    const plan = buildSecurityPlan(rows, mapping, ctx);
    expect(plan.creates).toEqual([]);
    expect(plan.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
    expect(plan.errors[0].message).toMatch(/Unknown stakeholder/);
    expect(plan.errors[1].message).toMatch(/positive/);
    expect(plan.errors[2].message).toMatch(/date/);
    expect(plan.errors[3].message).toMatch(/security type/);
  });

  it('rejects sub-share quantities on either side of the rounding boundary', () => {
    const rows = [
      ['Ada Chen', 'Shares', 'Common Stock', '0.4', '1', '', '', '', '', '', '', '2026-01-01', '', '', '', '', ''],
      ['Ada Chen', 'Shares', 'Common Stock', '0.6', '1', '', '', '', '', '', '', '2026-01-01', '', '', '', '', ''],
    ];
    const plan = buildSecurityPlan(rows, mapping, ctx);
    expect(plan.errors.map((e) => e.line)).toEqual([2, 3]);
    expect(plan.errors.every((e) => /whole shares/.test(e.message))).toBe(true);
    expect(plan.creates).toEqual([]);
  });

  it('reads ISO typed as the security type into the tax classification', () => {
    const rows = [['Sam Rivera', 'ISO', '', '1000', '', '0.5', '', '', '', '', '', '2026-01-01', '48', '12', '', '', '']];
    const plan = buildSecurityPlan(rows, mapping, ctx);
    expect(plan.creates[0]).toMatchObject({ kind: 'option', optionType: 'iso' });
  });
});
