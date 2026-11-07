import { expect, it } from 'vitest';
import { prepareText } from '../src/core/text-edit.js';

it('looks up source glyph codes without scanning the whole font for every character', async () => {
  const map = new Map(
    Array.from({ length: 3000 }, (_, index) => [
      String.fromCodePoint(0x400 + index),
      String.fromCharCode(index >> 8, index & 255),
    ]),
  );
  const text = [...map.keys()].slice(-100).join('').repeat(50);
  const startsWith = String.prototype.startsWith;
  let comparisons = 0;
  let encoded;
  try {
    String.prototype.startsWith = function (...args) {
      comparisons++;
      return startsWith.apply(this, args);
    };
    encoded = await prepareText({}, { map }, text);
  } finally {
    String.prototype.startsWith = startsWith;
  }
  expect(encoded.font).toBeUndefined();
  expect(encoded.encoded[0]).toBe(
    `<${[...text].map((char) => [...map.get(char)].map((byte) => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('')).join('')}>`,
  );
  expect(comparisons).toBeLessThanOrEqual(text.length * 2);
});

it('prefers the longest source ligature and retains supplementary Unicode characters', async () => {
  const map = new Map([
    ['f', '\x01'],
    ['i', '\x02'],
    ['fi', '\x03'],
    ['ffi', '\x04'],
    ['😀', '\x05'],
  ]);
  const result = await prepareText({}, { map }, 'ffi fi😀'.replace(' ', ''));
  expect(result.encoded).toEqual(['<040305>']);
});
