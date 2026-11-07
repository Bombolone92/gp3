import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { themeColorTransform, luminanceTransform } from '../src/engine/colors.js';

for (const name of ['theme-primary-gray-sweep', 'theme-gray-tints', 'theme-gray-boundaries']) {
  it(`matches the native reference modifier controls: ${name}`, () => {
    const root = `tests/fixtures/${name}/`, cases = JSON.parse(readFileSync(root + 'cases.json'));
    const ref = JSON.parse(readFileSync(root + 'reference.json'));
    for (const [file, key] of [['control.docx', 'sourceSha256'], ['cases.json', 'casesSha256'], ['native.pdf', 'pdfSha256']]) {
      expect(createHash('sha256').update(readFileSync(root + file)).digest('hex')).toBe(ref[key]);
    }
    const boundaries = name === 'theme-gray-boundaries';
    expect(cases).toHaveLength(boundaries ? 128 : 512); expect(ref.colors).toHaveLength(cases.length);
    for (const base of new Set(cases.map(c => c.base))) {
      if (boundaries) {
        for (const mode of ['tint', 'shade']) expect(cases.filter(c => c.base === base && c.mode === mode).map(c => c.value)).toEqual([0, 1, 64, 128, 153, 191, 254, 255]);
      } else expect(cases.filter(c => c.base === base).map(c => c.value)).toEqual(Array.from({ length: 256 }, (_, i) => i));
    }
    for (const [i, c] of cases.entries()) {
      expect(ref.colors[i].label).toBe(c.label);
      const actual = themeColorTransform(c.base, c.mode === 'tint' ? c.value / 255 : undefined, c.mode === 'shade' ? c.value / 255 : undefined);
      expect(actual, `${c.label} ${c.base} ${c.mode} ${c.value}`).toBe(ref.colors[i].rgb.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase());
    }
  });
}

it('keeps WML tint precedence and DrawingML floating lightness separate', () => {
  expect(themeColorTransform('808080', 51 / 255, 0)).toBe('E5E5E5');
  expect(themeColorTransform('808080', 1, 0)).toBe('808080');
  expect(themeColorTransform('808080', 0, 1)).toBe('FFFFFF');
  expect(themeColorTransform('808080', undefined, 1)).toBe('808080');
  expect(luminanceTransform([.5, .5, .5], .5)).toEqual([.25, .25, .25]);
  expect(luminanceTransform([.5, .5, .5], .1, true)).toEqual([.6, .6, .6]);
});
