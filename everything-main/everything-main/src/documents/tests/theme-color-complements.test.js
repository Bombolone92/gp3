import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = 'tests/fixtures/theme-color-complements/';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const cases = read(root + 'cases.json'), reference = read(root + 'reference.json');

it('binds the complementary-color native reference to its original source', () => {
  for (const [file, key] of [['control.docx', 'sourceSha256'], ['native.pdf', 'pdfSha256'], ['cases.json', 'casesSha256']]) {
    expect(createHash('sha256').update(readFileSync(root + file)).digest('hex')).toBe(reference[key]);
  }
  expect(reference.pages).toBe(4);
  expect(cases).toHaveLength(128);
  expect(reference.colors.map(c => c.label)).toEqual(cases.map(c => c.label));
});

it('records native complement asymmetry beyond a single final channel rounding', () => {
  const originals = read('tests/fixtures/theme-color-precision/cases.json');
  const native = read('tests/fixtures/theme-color-precision/native-colors.json');
  const sums = originals.map((c, i) => {
    expect(native[i].label).toBe(c.label);
    const complement = c.base.match(/../g).map(v => (255 - parseInt(v, 16)).toString(16).padStart(2, '0')).join('').toUpperCase();
    const matches = cases.map((v, index) => ({ ...v, index })).filter(v => v.base === complement && v.mode !== c.mode && v.value === c.value);
    expect(matches).toHaveLength(1);
    return native[i].rgb.map((value, channel) => value + reference.colors[matches[0].index].rgb[channel]);
  });
  expect(Math.min(...sums.flat())).toBe(253);
  expect(Math.max(...sums.flat())).toBe(255);
  expect(sums.filter(channels => channels.some(value => value < 254 || value > 256))).toHaveLength(34);
});
