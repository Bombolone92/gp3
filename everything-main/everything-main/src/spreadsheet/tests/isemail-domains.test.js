import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// The domain was any run of characters between dots, so an address followed by a comma or an
// exclamation mark, or with a label opening on a hyphen, passed for an email address.
describe('ISEMAIL', () => {
  it('accepts a domain of letters, digits and inner hyphens', () => {
    for (const address of ['a@b.com', 'first.last@sub.example.co.uk', 'a+tag@b-c.org', 'a@münchen.de', 'A@B.COM', ' a@b.com ']) {
      expect(calc(`ISEMAIL("${address}")`), address).toBe(true);
    }
  });

  it('refuses punctuation in the domain and a hyphen at the edge of a label', () => {
    for (const address of ['a@b.com,c', 'a@b.com!', 'a@-b.com', 'a@b-.com', 'a@b_c.com', 'a@b..com', 'a@b', 'a@b.com.', 'a b@c.com', 'a@b.com c', 'a@b.c/d']) {
      expect(calc(`ISEMAIL("${address}")`), address).toBe(false);
    }
  });
});
