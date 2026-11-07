import { it, expect } from 'vitest';
import { nativeSvgAlpha } from '../src/engine/svg-native-opacity.js';

it('matches the independent reference vector alpha controls, including combined paint/object alpha', () => {
  const source = [0, .001, .1, .3, .5, .75, .999, 1];
  const bytes = [0, 0, 25, 76, 127, 191, 254, 255];
  source.forEach((value, i) => expect(nativeSvgAlpha(value, 1)).toBe(bytes[i] / 255));
  for (const [a, b, expected] of [[.9, .9, 206], [.1, .9, 22], [.5, .5, 63], [.3, .9, 68]]) {
    expect(nativeSvgAlpha(a, b)).toBe(expected / 255);
    expect(nativeSvgAlpha(a, 1, b)).toBe(expected / 255);
  }
  // Quantizing each declaration separately would incorrectly produce 205/255.
  expect(nativeSvgAlpha(.9, .9)).not.toBe(nativeSvgAlpha(nativeSvgAlpha(.9, 1), nativeSvgAlpha(.9, 1)));
});

it('retains exactly representable byte alpha and clamps the combined value', () => {
  for (let byte = 0; byte <= 255; byte++) expect(nativeSvgAlpha(byte / 255, 1)).toBe(byte / 255);
  expect(nativeSvgAlpha(-1, 1)).toBe(0);
  expect(nativeSvgAlpha(2, 1)).toBe(1);
});
