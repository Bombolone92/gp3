import { describe, it, expect } from 'vitest';
import { toggleWrap, toggleQuote, toggleCodeBlock, insertLink, applyFormat, formatForKey } from '../src/lib/formatting.js';

const sel = (value, start, end = start) => ({ value, start, end });

describe('toggleWrap', () => {
  it('wraps a selection and keeps it selected inside the marks', () => {
    expect(toggleWrap(sel('say hello now', 4, 9), '**')).toEqual({ value: 'say **hello** now', start: 6, end: 11 });
  });

  it('places the cursor between the marks when nothing is selected', () => {
    expect(toggleWrap(sel('abc', 3), '_')).toEqual({ value: 'abc__', start: 4, end: 4 });
  });

  it('unwraps when the selection includes the marks', () => {
    expect(toggleWrap(sel('say **hello** now', 4, 13), '**')).toEqual({ value: 'say hello now', start: 4, end: 9 });
  });

  it('unwraps when the marks sit just outside the selection', () => {
    expect(toggleWrap(sel('say **hello** now', 6, 11), '**')).toEqual({ value: 'say hello now', start: 4, end: 9 });
  });

  it('applying twice gives the text back', () => {
    const once = toggleWrap(sel('a b c', 2, 3), '~');
    expect(toggleWrap(once, '~')).toEqual(sel('a b c', 2, 3));
  });
});

describe('toggleQuote', () => {
  it('prefixes every line the selection touches', () => {
    expect(toggleQuote(sel('one\ntwo\nthree', 5, 9))).toEqual({ value: 'one\n> two\n> three', start: 7, end: 13 });
  });

  it('removes the prefix when every line already has it', () => {
    expect(toggleQuote(sel('> one\n> two', 0, 11))).toEqual({ value: 'one\ntwo', start: 0, end: 7 });
  });

  it('works on the current line with no selection', () => {
    expect(toggleQuote(sel('hello', 5))).toEqual({ value: '> hello', start: 7, end: 7 });
  });
});

describe('toggleCodeBlock', () => {
  it('fences the selection on its own lines', () => {
    expect(toggleCodeBlock(sel('run x = 1 now', 4, 9))).toEqual({ value: 'run \n```\nx = 1\n```\n now', start: 9, end: 14 });
  });

  it('does not add blank lines when the selection already sits on its own lines', () => {
    expect(toggleCodeBlock(sel('a\nb\nc', 2, 3))).toEqual({ value: 'a\n```\nb\n```\nc', start: 6, end: 7 });
  });

  it('lifts a fenced selection out again', () => {
    expect(toggleCodeBlock(sel('```js\nlet a\n```', 0, 15))).toEqual({ value: 'let a', start: 0, end: 5 });
    expect(toggleCodeBlock(sel('```\nlet a\n```', 4, 9))).toEqual({ value: 'let a', start: 0, end: 5 });
  });
});

describe('insertLink', () => {
  it('replaces the selection with the url and spaces it from its neighbours', () => {
    expect(insertLink(sel('see this', 4, 8), 'https://x.io')).toEqual({ value: 'see https://x.io', start: 4, end: 16 });
    expect(insertLink(sel('ab', 1), 'https://x.io')).toEqual({ value: 'a https://x.io b', start: 2, end: 14 });
  });
});

describe('applyFormat and formatForKey', () => {
  it('routes each kind', () => {
    expect(applyFormat(sel('x', 0, 1), 'code')).toEqual({ value: '`x`', start: 1, end: 2 });
    expect(applyFormat(sel('x', 0, 1), 'link')).toEqual(sel('x', 0, 1));
    expect(applyFormat(sel('x', 0, 1), 'link', 'https://a.b').value).toBe('https://a.b');
  });

  it('maps formatting keyboard shortcuts', () => {
    const k = (key, mods = {}) => formatForKey({ key, metaKey: true, ...mods });
    expect(k('b')).toBe('bold');
    expect(k('i')).toBe('italic');
    expect(k('x', { shiftKey: true })).toBe('strike');
    expect(k('c', { shiftKey: true })).toBe('code');
    expect(k('c', { shiftKey: true, altKey: true })).toBe('codeBlock');
    expect(formatForKey({ key: '\u00c7', code: 'KeyC', metaKey: true, shiftKey: true, altKey: true })).toBe('codeBlock'); // macOS: Option composes the letter
    expect(k('9', { shiftKey: true })).toBe('quote');
    expect(formatForKey({ key: '(', code: 'Digit9', metaKey: true, shiftKey: true })).toBe('quote');
    expect(k('u', { shiftKey: true })).toBe('link');
    expect(k('c')).toBe(null); // plain copy stays copy
    expect(formatForKey({ key: 'b' })).toBe(null);
  });
});
