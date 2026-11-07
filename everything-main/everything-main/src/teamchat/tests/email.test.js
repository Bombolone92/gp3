/**
 * The calling side of the email worker (src/lib/email.js). parseEmails is
 * what turns a pasted blob of recipients into addresses, so a paste out of a
 * mail client — where every address wears a display name — has to work.
 */
import { describe, it, expect } from 'vitest';
import { parseEmails } from '../src/lib/email.js';

describe('parseEmails', () => {
  it('separates on commas, semicolons, whitespace, and newlines', () => {
    expect(parseEmails('a@x.com, b@y.com; c@z.com\nd@w.com e@v.com').emails)
      .toEqual(['a@x.com', 'b@y.com', 'c@z.com', 'd@w.com', 'e@v.com']);
  });

  it('reads "Display Name <addr>" as its address, not as bad tokens', () => {
    const { emails, bad } = parseEmails('Ellis Fry <ellis@example.com>, Maria <maria@example.com>');
    expect(emails).toEqual(['ellis@example.com', 'maria@example.com']);
    expect(bad).toEqual([]);
  });

  it('takes a bare bracketed address', () => {
    expect(parseEmails('<solo@x.com>').emails).toEqual(['solo@x.com']);
  });

  it('keeps a bare address that sits just before a bracketed entry', () => {
    const { emails, bad } = parseEmails('pat@example.com Ellis Fry <ellis@example.com>');
    expect(emails).toEqual(['ellis@example.com', 'pat@example.com']);
    expect(bad).toEqual([]);
    // A display name that merely decorates with an @ is not an address.
    expect(parseEmails('Support @ Acme <support@acme.com>')).toEqual({ emails: ['support@acme.com'], bad: [] });
  });

  it('lowercases and de-duplicates, across bracketed and bare forms', () => {
    expect(parseEmails('A@X.com, a@x.com, Foo <A@X.com>').emails).toEqual(['a@x.com']);
  });

  it('still reports a genuinely malformed address', () => {
    const { emails, bad } = parseEmails('ellis@example.com, notanemail, maria@example.com');
    expect(emails).toEqual(['ellis@example.com', 'maria@example.com']);
    expect(bad).toEqual(['notanemail']);
  });

  it('rejects an over-long address and an empty blob', () => {
    expect(parseEmails(`${'x'.repeat(250)}@y.com`).emails).toEqual([]);
    expect(parseEmails('   ')).toEqual({ emails: [], bad: [] });
    expect(parseEmails(null)).toEqual({ emails: [], bad: [] });
  });
});
