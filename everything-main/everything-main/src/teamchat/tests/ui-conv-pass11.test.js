/**
 * Conversation UI helpers that node can express (review pass 11): the pure
 * parts of src/ui/dom.js. Everything DOM-bound in that slice is verified by
 * code traces in the commit messages instead.
 */
import { describe, it, expect } from 'vitest';
import { composing } from '../src/ui/dom.js';
import { matchMembers } from '../src/lib/mentions.js';

const PEOPLE = [
  { uuid: 'u1', username: 'jose', name: 'José Álvarez' },
  { uuid: 'u2', username: 'hmueller', name: 'Hanna Müller' },
  { uuid: 'u3', username: 'brendan', name: 'Brendan Ó Briain' },
  { uuid: 'u4', username: 'dan', name: 'Dan Ito' },
  { uuid: 'u5', username: 'ana', name: 'Ana Rocha' },
];
const names = (list) => list.map((m) => m.username);

describe('matchMembers', () => {
  it('finds accented names from ASCII typed after the @', () => {
    expect(names(matchMembers(PEOPLE, 'jose'))).toEqual(['jose']);
    expect(names(matchMembers(PEOPLE, 'muller'))).toEqual(['hmueller']);
    expect(names(matchMembers(PEOPLE, 'alvarez'))).toEqual(['jose']);
    expect(names(matchMembers(PEOPLE, 'briain'))).toEqual(['brendan']);
  });

  it('matches the username by prefix and the name by substring, prefix matches first, then in name order', () => {
    // "dan": Dan by username and name, Brendan only inside his name.
    expect(names(matchMembers(PEOPLE, 'dan'))).toEqual(['dan', 'brendan']);
    // "an": Ana by prefix; Brendan, Dan Ito and Hanna Müller only inside their names, in name order.
    expect(names(matchMembers(PEOPLE, 'an'))).toEqual(['ana', 'brendan', 'dan', 'hmueller']);
    expect(names(matchMembers(PEOPLE, 'hmu'))).toEqual(['hmueller']);
    expect(matchMembers(PEOPLE, 'zzz')).toEqual([]);
  });

  it('lists everyone in name order for an empty query, up to the limit, and hands back the members themselves', () => {
    expect(names(matchMembers(PEOPLE, ''))).toEqual(['ana', 'brendan', 'dan', 'hmueller', 'jose']);
    expect(names(matchMembers(PEOPLE, '', 2))).toEqual(['ana', 'brendan']);
    expect(matchMembers(PEOPLE, 'jose')[0]).toBe(PEOPLE[0]); // the picked text is the plain username
  });
});

describe('composing', () => {
  it('is the input method at work: isComposing, or Safari’s keyCode 229 after compositionend', () => {
    expect(composing({ key: 'Enter', isComposing: true, keyCode: 13 })).toBe(true);
    // Safari fires the Enter that confirms a candidate after compositionend,
    // with isComposing false and only the legacy "process" key code left.
    expect(composing({ key: 'Enter', isComposing: false, keyCode: 229 })).toBe(true);
    expect(composing({ key: 'Enter', isComposing: false, keyCode: 13 })).toBe(false);
    expect(composing({ key: 'Enter' })).toBe(false);
  });
});
