import { describe, it, expect } from 'vitest';
import {
  parseRows, parseTable, sniffDelimiter, guessMapping, parseImportDate,
  parseImportNumber, parseImportBoolean, rowToContract, buildImport, previewFields,
} from '../src/lib/csv.js';

describe('parseRows', () => {
  it('splits plain rows', () => {
    expect(parseRows('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('keeps commas and newlines inside quoted fields', () => {
    const csv = 'title,notes\n"Lease, 4th floor","Line one\nLine two"';
    expect(parseRows(csv)).toEqual([
      ['title', 'notes'],
      ['Lease, 4th floor', 'Line one\nLine two'],
    ]);
  });

  it('reads a doubled quote as one quote', () => {
    expect(parseRows('a\n"He said ""yes"""')).toEqual([['a'], ['He said "yes"']]);
  });

  it('handles CRLF, a trailing newline, and a BOM', () => {
    expect(parseRows('﻿a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('normalizes a CRLF inside a quoted field to a newline', () => {
    expect(parseRows('a\n"one\r\ntwo"')).toEqual([['a'], ['one\ntwo']]);
  });

  it('keeps empty fields, including trailing ones', () => {
    expect(parseRows('a,b,c\n1,,')).toEqual([['a', 'b', 'c'], ['1', '', '']]);
  });
});

describe('sniffDelimiter', () => {
  it('finds semicolons and tabs, ignoring separators inside quotes', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(sniffDelimiter('a\tb\tc')).toBe('\t');
    expect(sniffDelimiter('"a,b,c,d";e')).toBe(';');
  });

  it('falls back to a comma when there is nothing to go on', () => {
    expect(sniffDelimiter('title')).toBe(',');
    expect(sniffDelimiter('')).toBe(',');
  });
});

describe('parseTable', () => {
  it('separates headers from records and drops blank lines', () => {
    const table = parseTable('Title ,End Date\nCloud,2026-01-01\n\n , \nLease,2027-02-03\n');
    expect(table.headers).toEqual(['Title', 'End Date']);
    expect(table.rows).toHaveLength(2);
  });
});

describe('guessMapping', () => {
  it('matches obvious headers', () => {
    const m = guessMapping(['Contract name', 'Vendor', 'Start', 'End date', 'Annual value', 'Notes']);
    expect(m.title).toBe(0);
    expect(m.counterparty).toBe(1);
    expect(m.startDate).toBe(2);
    expect(m.endDate).toBe(3);
    expect(m.value).toBe(4);
    expect(m.notes).toBe(5);
  });

  it('prefers an exact match over a partial one', () => {
    // "Renewal date" must not be claimed by the renewal-term field.
    const m = guessMapping(['Title', 'Renewal term', 'Renewal date']);
    expect(m.termMonths).toBe(1);
    expect(m.endDate).toBe(2);
  });

  it('never maps one column to two fields', () => {
    const m = guessMapping(['Name', 'Name']);
    const used = Object.values(m);
    expect(new Set(used).size).toBe(used.length);
  });

  it('leaves unknown columns alone', () => {
    const m = guessMapping(['Title', 'Internal ref', 'Owner initials']);
    expect(m.title).toBe(0);
    expect(Object.values(m)).not.toContain(1);
  });
});

describe('parseImportDate', () => {
  it('takes ISO as written', () => {
    expect(parseImportDate('2026-03-04')).toBe('2026-03-04');
    expect(parseImportDate('2026/03/04')).toBe('2026-03-04');
  });

  it('follows the stated order for ambiguous numeric dates', () => {
    expect(parseImportDate('03/04/2026', 'dmy')).toBe('2026-04-03');
    expect(parseImportDate('03/04/2026', 'mdy')).toBe('2026-03-04');
  });

  it('lets an impossible month settle the order regardless', () => {
    expect(parseImportDate('31/01/2026', 'mdy')).toBe('2026-01-31');
    expect(parseImportDate('01/31/2026', 'dmy')).toBe('2026-01-31');
  });

  it('reads month names in either position', () => {
    expect(parseImportDate('12 Mar 2026')).toBe('2026-03-12');
    expect(parseImportDate('Mar 12, 2026')).toBe('2026-03-12');
    expect(parseImportDate('1 September 2026')).toBe('2026-09-01');
  });

  it('expands a two-digit year', () => {
    expect(parseImportDate('04/05/26', 'dmy')).toBe('2026-05-04');
  });

  it('refuses anything it cannot read, rather than guessing', () => {
    for (const bad of ['', null, 'next Tuesday', '2026-13-01', '31/02/2026', 'Q3', '2026']) {
      expect(parseImportDate(bad)).toBeNull();
    }
  });
});

describe('parseImportNumber', () => {
  it('strips symbols and reads both decimal conventions', () => {
    expect(parseImportNumber('$1,234.56')).toBe(1234.56);
    expect(parseImportNumber('1.234,56 EUR')).toBe(1234.56);
    expect(parseImportNumber('2400')).toBe(2400);
    expect(parseImportNumber('1,200')).toBe(1200);
    expect(parseImportNumber('12 months')).toBe(12);
  });

  it('tells a thousands separator from a decimal point', () => {
    expect(parseImportNumber('1.200')).toBe(1200);
    expect(parseImportNumber('1.234.567')).toBe(1234567);
    expect(parseImportNumber('1,5')).toBe(1.5);
    expect(parseImportNumber('12.50')).toBe(12.5);
    expect(parseImportNumber('0.5')).toBe(0.5);
  });

  it('reads bracketed and signed negatives', () => {
    expect(parseImportNumber('(500)')).toBe(-500);
    expect(parseImportNumber('-42')).toBe(-42);
  });

  it('is null for nothing usable', () => {
    expect(parseImportNumber('')).toBeNull();
    expect(parseImportNumber('n/a')).toBeNull();
    expect(parseImportNumber(null)).toBeNull();
  });
});

describe('parseImportBoolean', () => {
  it('reads the usual spellings', () => {
    for (const yes of ['Yes', 'y', 'TRUE', '1', 'Auto', 'evergreen']) {
      expect(parseImportBoolean(yes)).toBe(true);
    }
    for (const no of ['No', 'n', 'false', '0', 'fixed']) {
      expect(parseImportBoolean(no)).toBe(false);
    }
  });

  it('is null when the cell says nothing either way', () => {
    expect(parseImportBoolean('')).toBeNull();
    expect(parseImportBoolean('maybe')).toBeNull();
  });
});

describe('rowToContract', () => {
  const headers = ['Contract', 'Vendor', 'Value', 'Start', 'End', 'Renews', 'Internal ref'];
  const mapping = guessMapping(headers);
  const row = ['Cloud hosting', 'Northwind', '$2,400', '2025-01-01', '2026-01-01', 'yes', 'REF-9'];

  it('maps a clean row', () => {
    const { contract, counterparty, problems } = rowToContract(row, mapping, headers, { currency: 'USD' });
    expect(problems).toEqual([]);
    expect(counterparty).toBe('Northwind');
    expect(contract.title).toBe('Cloud hosting');
    expect(contract.value).toBe(2400);
    expect(contract.startDate).toBe('2025-01-01');
    expect(contract.endDate).toBe('2026-01-01');
    expect(contract.autoRenew).toBe(true);
  });

  it('keeps unmapped columns in the notes instead of dropping them', () => {
    const { contract, extras } = rowToContract(row, mapping, headers, {});
    expect(extras).toContain('Internal ref: REF-9');
    expect(contract.notes).toContain('Internal ref: REF-9');
  });

  it('reports why a row cannot be imported', () => {
    const bad = ['', 'Northwind', 'x', 'nonsense', '2020-01-01', '', ''];
    const { problems } = rowToContract(bad, mapping, headers, {});
    expect(problems).toContain('no title');
    expect(problems.some((p) => p.includes('start date'))).toBe(true);
  });

  it('rejects an end date before the start date', () => {
    const backwards = ['Lease', 'Castle', '', '2026-06-01', '2026-01-01', '', ''];
    const { problems } = rowToContract(backwards, mapping, headers, {});
    expect(problems).toContain('end date is before the start date');
  });

  it('leaves auto-renew off unless the sheet says otherwise', () => {
    const quiet = ['Lease', 'Castle', '', '', '', '', ''];
    expect(rowToContract(quiet, mapping, headers, {}).contract.autoRenew).toBe(false);
  });

  it('falls back to the default currency and notice period', () => {
    const quiet = ['Lease', '', '', '', '', '', ''];
    const { contract } = rowToContract(quiet, mapping, headers, { currency: 'GBP', noticeDefault: 45 });
    expect(contract.currency).toBe('GBP');
    expect(contract.noticeDays).toBe(45);
  });
});

describe('billing and status words', () => {
  const headers = ['Title', 'Value', 'Billing', 'Status'];
  const mapping = guessMapping(headers);
  const read = (billing, status = '') =>
    rowToContract(['X', '1000', billing, status], mapping, headers, {}).contract;

  it('reads the ways a spreadsheet spells a billing period', () => {
    for (const word of ['Yearly', 'per year', 'p.a.', 'Per annum', 'Annually', 'annual']) {
      expect(read(word).billing, word).toBe('annual');
    }
    for (const word of ['Monthly', 'per month', '/mo', 'USD / month', 'pcm']) {
      expect(read(word).billing, word).toBe('monthly');
    }
    for (const word of ['Quarterly', 'per quarter', 'qtr']) {
      expect(read(word).billing, word).toBe('quarterly');
    }
    for (const word of ['One-off', 'once', 'one time', 'lump sum']) {
      expect(read(word).billing, word).toBe('one-time');
    }
  });

  it('still assumes monthly for a priced row that says nothing', () => {
    expect(read('').billing).toBe('monthly');
    expect(read('Net 30').billing).toBe('monthly');
  });

  it('reads a status that says the agreement is over, or not yet in force', () => {
    for (const word of ['Expired', 'Ended', 'Cancelled', 'Canceled', 'Closed', 'Completed', 'Inactive']) {
      expect(read('', word).status, word).toBe('terminated');
    }
    for (const word of ['Pending', 'Unsigned', 'In negotiation']) {
      expect(read('', word).status, word).toBe('draft');
    }
    for (const word of ['Active', 'Live', 'In force', 'Ongoing']) {
      expect(read('', word).status, word).toBe('active');
    }
    // A word it does not know is left at the default rather than guessed.
    expect(read('', 'purple').status).toBe('active');
  });

  it('shows the billing period a priced row will be saved with', () => {
    const { shown } = previewFields(['X', '42000', '', ''], mapping, headers, {});
    expect(shown).toContainEqual(['Billing', 'Monthly']);
    const yearly = previewFields(['X', '42000', 'yearly', ''], mapping, headers, {});
    expect(yearly.shown).toContainEqual(['Billing', 'Annual']);
    // Nothing to say for an unpriced row with no billing column mapped.
    const bare = guessMapping(['Title']);
    expect(previewFields(['X'], bare, ['Title'], {}).shown.some(([k]) => k === 'Billing')).toBe(false);
  });
});

describe('buildImport', () => {
  const csv = [
    'Contract,Vendor,End date',
    'Cloud hosting,Northwind,2026-12-01',
    ',Northwind,2026-12-01',
    'Office lease,Castle & Main,2027-01-31',
    'Retainer,northwind,2026-06-30',
  ].join('\n');

  it('creates one contact per new counterparty and reuses existing ones', () => {
    const table = parseTable(csv);
    const mapping = guessMapping(table.headers);
    const { contracts, newContacts, skipped } = buildImport(table, mapping, {
      existingContacts: [{ id: 'c1', name: 'Castle & Main' }],
    });
    expect(contracts.map((c) => c.title)).toEqual(['Cloud hosting', 'Office lease', 'Retainer']);
    // "Northwind" appears twice in different cases: one contact, not two.
    expect(newContacts.map((c) => c.name)).toEqual(['Northwind']);
    expect(skipped).toEqual([{ row: 3, reasons: ['no title'] }]);
  });

  it('numbers skipped rows the way the spreadsheet does', () => {
    const table = parseTable('Contract\nGood\n\nAlso good');
    const mapping = guessMapping(table.headers);
    const { skipped, contracts } = buildImport(table, mapping, {});
    expect(skipped).toEqual([]);
    expect(contracts).toHaveLength(2);
  });
});
