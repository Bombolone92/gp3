import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { SpellChecker, decodeWordList, editDistance, matchCase, tokenize } from '../src/imaging/text/spelling';

const words = ['the', 'of', 'and', 'a', 'to', 'in', 'is', 'I', 'this', 'that', 'they', 'then', 'there', 'their', 'English', 'London', 'receive', 'separate', 'definitely', 'color', 'colour', 'cat', "cat's", 'cut', 'cot', 'coat', 'hello', 'help', 'world', 'word', "don't", 'NASA'];
const sc = new SpellChecker(words);

describe('edit distance', () => {
  it('counts insertions, deletions, substitutions and swaps', () => {
    expect(editDistance('cat', 'cat')).toBe(0);
    expect(editDistance('cat', 'cut')).toBe(1);
    expect(editDistance('cat', 'cats')).toBe(1);
    expect(editDistance('teh', 'the')).toBe(1);
    expect(editDistance('recieve', 'receive')).toBe(1);
    expect(editDistance('abc', 'xyz')).toBe(3);
    expect(editDistance('abcdef', 'a', 2)).toBe(3);
    expect(editDistance('', 'ab')).toBe(2);
  });
});

describe('checking', () => {
  it('accepts dictionary words and their case variants', () => {
    expect(sc.check('the')).toBe(true);
    expect(sc.check('The')).toBe(true);
    expect(sc.check('THE')).toBe(true);
    expect(sc.check('English')).toBe(true);
    expect(sc.check('ENGLISH')).toBe(true);
    expect(sc.check('english')).toBe(false);
    expect(sc.check('tHe')).toBe(false);
    expect(sc.check('NASA')).toBe(true);
    expect(sc.check('nasa')).toBe(false);
  });
  it('handles apostrophes and possessives', () => {
    expect(sc.check('don’t')).toBe(true);
    expect(sc.check("world's")).toBe(true);
    expect(sc.check("London's")).toBe(true);
    expect(sc.check("cats'")).toBe(false);
    expect(sc.check("'hello'")).toBe(true);
  });
  it('skips what it cannot check', () => {
    expect(sc.check('abc123')).toBe(true);
    expect(sc.check('שלום')).toBe(true);
    expect(sc.check('')).toBe(true);
  });
  it('supports a user dictionary and ignored words', () => {
    const c = new SpellChecker(words);
    expect(c.check('Puter')).toBe(false);
    c.add('Puter');
    expect(c.check('Puter')).toBe(true);
    expect(c.check('zzyzx')).toBe(false);
    c.ignore('zzyzx');
    expect(c.check('zzyzx')).toBe(true);
    c.clearIgnored();
    expect(c.check('zzyzx')).toBe(false);
  });
});

describe('suggestions', () => {
  it('ranks by distance, first letter and frequency', () => {
    expect(sc.suggest('teh')[0]).toBe('the');
    expect(sc.suggest('recieve')[0]).toBe('receive');
    expect(sc.suggest('seperate')[0]).toBe('separate');
    expect(sc.suggest('cxt')).toEqual(expect.arrayContaining(['cat', 'cut', 'cot']));
    expect(sc.suggest('cxt').indexOf('cat')).toBeLessThan(sc.suggest('cxt').indexOf('cot'));
  });
  it('keeps the case pattern of the misspelled word', () => {
    expect(sc.suggest('Teh')[0]).toBe('The');
    expect(sc.suggest('TEH')[0]).toBe('THE');
    expect(sc.suggest('english')[0]).toBe('English');
    expect(sc.suggest('londn')[0]).toBe('London');
  });
  it('splits run-together words', () => {
    expect(sc.suggest('thisis')).toContain('this is');
  });
  it('limits the count and returns nothing for gibberish', () => {
    expect(sc.suggest('cxt', 2)).toHaveLength(2);
    expect(sc.suggest('qqqqqqqq')).toEqual([]);
  });
  it('matches case', () => {
    expect(matchCase('Helo', 'hello')).toBe('Hello');
    expect(matchCase('HELO', 'hello')).toBe('HELLO');
    expect(matchCase('helo', 'London')).toBe('London');
  });
});

describe('tokenizing', () => {
  it('finds words with ranges and skips URLs, e-mail and digits', () => {
    const t = 'Teh cat’s 3rd visit to https://exampel.com and me@exampel.org, recieve-it! abc123';
    const toks = tokenize(t);
    expect(toks.map((x) => x.word)).toEqual(['Teh', 'cat’s', 'visit', 'to', 'and', 'recieve', 'it']);
    for (const x of toks) expect(t.slice(x.start, x.end)).toBe(x.word);
    expect(sc.misspellings(t).map((m) => m.word)).toEqual(['Teh', 'visit', 'recieve', 'it']);
  });
});

describe('bundled word list', () => {
  const bytes = new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'dictionaries', 'en-US.txt.gz')));
  const list = decodeWordList(bytes);
  const en = new SpellChecker(list);
  it('decodes plain and gzip-compressed lists', () => {
    expect(list.length).toBeGreaterThan(100_000);
    expect(decodeWordList(new TextEncoder().encode('a\nb\n'))).toEqual(['a', 'b']);
    expect(decodeWordList(new Uint8Array(gzipSync('x\r\ny')))).toEqual(['x', 'y']);
  });
  it('checks and corrects common English', () => {
    for (const w of ['the', 'Hello', 'world', 'running', 'color', 'colors', "isn't", 'Wednesday', 'Paris']) expect(en.check(w), w).toBe(true);
    for (const w of ['recieve', 'definately', 'seperate', 'teh', 'wierd']) expect(en.check(w), w).toBe(false);
    expect(en.suggest('recieve')).toContain('receive');
    expect(en.suggest('definately')).toContain('definitely');
    expect(en.suggest('teh').slice(0, 3)).toContain('the');
    expect(en.suggest('wierd')).toContain('weird');
  });
  it('suggests quickly', () => {
    const t0 = performance.now();
    for (const w of ['recieve', 'definately', 'acommodate', 'occurence', 'beleive']) en.suggest(w);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
