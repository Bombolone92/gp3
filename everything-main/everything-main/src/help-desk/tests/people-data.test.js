// Local days are checked in a zone far from UTC.
process.env.TZ = 'America/Los_Angeles';

import { describe, it, expect } from 'vitest';
import {
  parseCsv, toCsv, guessMapping, buildImportRows, ticketCounts, memberCounts, satisfaction, customersToCsv,
} from '../src/views/people-data.js';

describe('parseCsv', () => {
  it('reads quoted fields with delimiters, escaped quotes and line breaks', () => {
    const rows = parseCsv('﻿Name,Email,Notes\r\n"Doe, Jane",jane@x.io,"Said ""hi""\nthen left"\r\nBob,bob@x.io,\n\n');
    expect(rows).toEqual([
      ['Name', 'Email', 'Notes'],
      ['Doe, Jane', 'jane@x.io', 'Said "hi"\nthen left'],
      ['Bob', 'bob@x.io', ''],
    ]);
  });

  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('round-trips through toCsv', () => {
    const rows = [['Name', 'Notes'], ['Doe, Jane', 'Line one\nLine "two"'], ['Plain', '']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('neutralizes cells a spreadsheet would treat as formulas', () => {
    expect(toCsv([['=SUM(A1)', '+1', '@x', 'ok']])).toBe("'=SUM(A1),'+1,'@x,ok");
  });
});

describe('import mapping', () => {
  it('guesses columns from common header names', () => {
    const m = guessMapping(['Full Name', 'E-mail', 'Company', 'Mobile', 'Labels', 'Comments']);
    expect(m).toMatchObject({ name: 0, email: 1, organization: 2, phone: 3, tags: 4, notes: 5, first: -1, last: -1 });
  });

  it('maps a CRM export\'s Company Name to the organization, not the name', () => {
    expect(guessMapping(['First Name', 'Last Name', 'Email', 'Company Name'])).toMatchObject({ first: 0, last: 1, email: 2, organization: 3, name: -1 });
    expect(guessMapping(['Contact Name', 'Email Address', 'Account Name'])).toMatchObject({ name: 0, email: 1 });
  });

  it('keeps names, emails and companies apart when headers share words', () => {
    expect(guessMapping(['First Name', 'Last Name', 'Account Name', 'Email'])).toMatchObject({ first: 0, last: 1, organization: 2, email: 3, name: -1 });
    expect(guessMapping(['Customer Email', 'Customer Name'])).toMatchObject({ email: 0, name: 1 });
    expect(guessMapping(['Email', 'Organization Name'])).toMatchObject({ email: 0, organization: 1, name: -1 });
    // A full name with only one of first and last name is still the name.
    expect(guessMapping(['Client Name', 'Surname', 'Email'])).toMatchObject({ name: 0, last: 1, email: 2 });
    expect(guessMapping(['First Name', 'Account Name', 'Email'])).toMatchObject({ first: 0, organization: 1, name: -1 });
  });

  it('imports time zones and languages, back from an export too', () => {
    const csv = customersToCsv([{ name: 'Ann', email: 'ann@x.io', tz: 'Europe/Berlin', locale: 'de-DE', tags: [] }], new Map());
    const rows = parseCsv(csv);
    const { rows: out } = buildImportRows(rows.slice(1), guessMapping(rows[0]));
    expect(out[0]).toMatchObject({ name: 'Ann', tz: 'Europe/Berlin', locale: 'de-DE' });
    const odd = buildImportRows([['Bo', 'Mars/Olympus', 'not a language!']], guessMapping(['Name', 'Time zone', 'Language']));
    expect(odd.rows[0]).toEqual({ name: 'Bo', email: undefined });
  });

  it('exports the day a customer was added in local time', () => {
    const evening = new Date(2026, 9, 12, 23, 30).getTime();
    const csv = customersToCsv([{ name: 'Ann', email: 'ann@x.io', tags: [], createdAt: evening }], new Map());
    expect(parseCsv(csv)[1].at(-1)).toBe('2026-10-12');
  });

  it('imports an export back unchanged', () => {
    const csv = customersToCsv([{ name: '-Dash', email: 'd@x.io', phone: '+1 555 0100', tags: [] }], new Map());
    const rows = parseCsv(csv);
    const { rows: out } = buildImportRows(rows.slice(1), guessMapping(rows[0]));
    expect(out[0]).toMatchObject({ name: '-Dash', email: 'd@x.io', phone: '+1 555 0100' });
  });

  it('matches organization names the way the server stores them', () => {
    const m = guessMapping(['Name', 'Company']);
    const orgs = new Map([['acme corp', 7]]);
    const res = buildImportRows([['Ann', 'Acme\u00a0Corp'], ['Ben', 'Newco  Inc'], ['Cy', 'newco inc']], m, orgs);
    expect(res.rows[0]).toEqual({ name: 'Ann', email: undefined, org: 7 });
    expect(res.orgNames).toEqual(['Newco Inc']);
  });

  it('combines first and last names and resolves organizations', () => {
    const header = ['First Name', 'Last Name', 'Email', 'Company'];
    const m = guessMapping(header);
    const orgs = new Map([['acme corp', 7]]);
    const res = buildImportRows([
      ['Jane', 'Doe', 'JANE@acme.test', 'Acme Corp'],
      ['', '', 'not-an-email', 'Acme Corp'],
      ['Bo', '', '', 'Newco'],
      ['', '', '', ''],
    ], m, orgs);
    expect(res.rows).toEqual([
      { name: 'Jane Doe', email: 'jane@acme.test', org: 7 },
      { name: 'Bo', email: undefined, orgName: 'Newco' },
    ]);
    expect(res.skipped).toBe(2);
    expect(res.orgNames).toEqual(['Newco']);
  });

  it('uses the email name when there is no name column value', () => {
    const res = buildImportRows([['', 'sam@x.io']], { name: 0, email: 1, first: -1, last: -1, phone: -1, organization: -1, tags: -1, notes: -1 });
    expect(res.rows[0].name).toBe('sam');
  });
});

describe('counts', () => {
  const tickets = [
    { requester: 1, org: 5, status: 'open' },
    { requester: 1, org: 5, status: 'solved', csat: { score: 'good' } },
    { requester: 2, org: null, status: 'pending', csat: { score: 'bad' } },
    { requester: 2, org: null, status: 'new', deleted: 123 },
    { requester: 3, org: 5, status: 'open', spam: true },
  ];

  it('counts open and total tickets per customer and organization, ignoring trash and spam', () => {
    const { byUser, byOrg } = ticketCounts(tickets);
    expect(byUser.get(1)).toEqual({ open: 1, total: 2 });
    expect(byUser.get(2)).toEqual({ open: 1, total: 1 });
    expect(byUser.has(3)).toBe(false);
    expect(byOrg.get(5)).toEqual({ open: 1, total: 2 });
  });

  it('summarizes satisfaction', () => {
    expect(satisfaction(tickets)).toEqual({ good: 1, bad: 1, rated: 2, percent: 50 });
    expect(satisfaction([]).percent).toBe(null);
  });

  it('counts customers per organization', () => {
    expect(memberCounts([{ org: 1 }, { org: 1 }, { org: null }, { org: 2 }])).toEqual(new Map([[1, 2], [2, 1]]));
  });
});

describe('customersToCsv', () => {
  it('exports customers with their organization names', () => {
    const csv = customersToCsv(
      [{ name: 'Doe, Jane', email: 'j@x.io', org: 1, tags: ['vip', 'beta'], createdAt: new Date(2026, 0, 2, 12).getTime() }],
      new Map([[1, { name: 'Acme' }]]),
    );
    const rows = parseCsv(csv);
    expect(rows[0][0]).toBe('Name');
    expect(rows[1]).toEqual(['Doe, Jane', 'j@x.io', '', 'Acme', 'vip beta', '', '', '', '2026-01-02']);
  });
});
