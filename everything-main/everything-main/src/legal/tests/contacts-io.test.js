import { describe, it, expect } from 'vitest';
import { contactsFromRows, splitDuplicates, contactsToRows, looksLikeEmail } from '../src/core/contacts-io.js';
import { csvObjects } from '../src/core/csv.js';

describe('contactsFromRows', () => {
  it('maps common header aliases to a person', () => {
    const rows = csvObjects('First Name,Surname,E-mail,Mobile,Address,City,State,Zip,Tags\nAda,Lovelace,ada@example.com,555-1000,1 Main St,Riverton,OR,97301,"VIP; Referral"\n');
    const [c] = contactsFromRows(rows);
    expect(c.type).toBe('person');
    expect(c.firstName).toBe('Ada');
    expect(c.lastName).toBe('Lovelace');
    expect(c.emails).toEqual([{ address: 'ada@example.com', type: 'work', primary: true }]);
    expect(c.phones[0].number).toBe('555-1000');
    expect(c.addresses[0]).toMatchObject({ street: '1 Main St', city: 'Riverton', region: 'OR', postal: '97301' });
    expect(c.tags).toEqual(['VIP', 'Referral']);
  });

  it('treats a row with only a company name as a company', () => {
    const [c] = contactsFromRows([{ company: 'Acme LLC', email: 'hi@acme.example' }]);
    expect(c.type).toBe('company');
    expect(c.companyName).toBe('Acme LLC');
  });

  it('honors an explicit type column', () => {
    const [c] = contactsFromRows([{ type: 'Company', name: 'Globex' }]);
    expect(c.type).toBe('company');
    expect(c.companyName).toBe('Globex');
  });

  it('splits a full name column into first and last', () => {
    const [c] = contactsFromRows([{ name: 'Mary Ann Jones' }]);
    expect(c.firstName).toBe('Mary Ann');
    expect(c.lastName).toBe('Jones');
  });

  it('skips rows without any name', () => {
    expect(contactsFromRows([{ email: 'x@example.com' }, {}])).toEqual([]);
  });

  it('keeps a person company as text when importing', () => {
    const [c] = contactsFromRows([{ 'first name': 'Bo', company: 'Initech', title: 'CFO' }]);
    expect(c.type).toBe('person');
    expect(c.companyName).toBe('Initech');
    expect(c.jobTitle).toBe('CFO');
  });
});

describe('splitDuplicates', () => {
  const existing = [{ type: 'person', firstName: 'Ada', lastName: 'Lovelace', emails: [{ address: 'ADA@example.com', primary: true }] }];
  it('detects duplicates by name and email, case-insensitively', () => {
    const incoming = contactsFromRows([
      { 'first name': 'ada', 'last name': 'lovelace', email: 'ada@example.com' },
      { 'first name': 'Ada', 'last name': 'Lovelace', email: 'other@example.com' },
      { 'first name': 'Grace', 'last name': 'Hopper' },
      { 'first name': 'Grace', 'last name': 'Hopper' },
    ]);
    const { fresh, dupes } = splitDuplicates(incoming, existing);
    expect(fresh.map((c) => `${c.firstName} ${c.emails[0]?.address || ''}`.trim())).toEqual(['Ada other@example.com', 'Grace']);
    expect(dupes).toHaveLength(2);
  });
});

describe('contactsToRows', () => {
  it('writes a header and one row per contact, resolving companies', () => {
    const rows = contactsToRows(
      [
        { type: 'person', firstName: 'Ada', lastName: 'Lovelace', companyId: 'c1', emails: [{ address: 'a@x.io', primary: true }], tags: ['VIP'], addresses: [{ city: 'Riverton', primary: true }] },
        { id: 'c1', type: 'company', companyName: 'Analytical Engines' },
      ],
      (id) => (id === 'c1' ? 'Analytical Engines' : ''),
    );
    expect(rows[0][0]).toBe('Type');
    expect(rows[1].slice(0, 2)).toEqual(['Person', 'Ada Lovelace']);
    expect(rows[1][6]).toBe('Analytical Engines');
    expect(rows[1][8]).toBe('a@x.io');
    expect(rows[1][12]).toBe('Riverton');
    expect(rows[2][1]).toBe('Analytical Engines');
  });

  it('round-trips through the importer', () => {
    const src = [{ type: 'person', firstName: 'Lin', lastName: 'Ng', emails: [{ address: 'lin@example.com', primary: true }], phones: [{ number: '555', primary: true }], tags: ['A', 'B'] }];
    const rows = contactsToRows(src);
    const objs = rows.slice(1).map((r) => Object.fromEntries(rows[0].map((k, i) => [k.toLowerCase(), r[i]])));
    const [back] = contactsFromRows(objs);
    expect(back).toMatchObject({ type: 'person', firstName: 'Lin', lastName: 'Ng', tags: ['A', 'B'] });
    expect(back.emails[0].address).toBe('lin@example.com');
  });
});

describe('looksLikeEmail', () => {
  it('accepts plain addresses and rejects junk', () => {
    expect(looksLikeEmail('a@b.co')).toBe(true);
    expect(looksLikeEmail(' a@b.co ')).toBe(true);
    expect(looksLikeEmail('a@b')).toBe(false);
    expect(looksLikeEmail('nope')).toBe(false);
  });
});
