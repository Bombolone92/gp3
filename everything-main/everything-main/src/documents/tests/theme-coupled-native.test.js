import {it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {themeColorTransform} from '../src/engine/colors.js';

const families = ['theme-low-chroma-sweep', 'theme-shade-sweep', 'theme-color-boundaries',
  'theme-color-complements', 'theme-channel-extrema', 'theme-permutations',
  'theme-color-precision', 'theme-chroma-midtones', 'theme-minmax-neighbors', 'theme-standard-accents'];
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');

for (const name of families) it(`matches every independently captured native WML theme color: ${name}`, () => {
  const root = `tests/fixtures/${name}/`, cases = json(root + 'cases.json');
  let native;
  if (name === 'theme-color-precision') {
    for (const [file, hash] of Object.entries(json(root + 'manifest.json').sha256))
      expect(digest(file.endsWith('.docx') ? 'public/fixtures/' + file : root + file), file).toBe(hash);
    native = json(root + 'native-saved-colors.json').map(row => ({label: row.label, hex: row.attributes.val}));
  } else {
    const reference = json(root + 'reference.json');
    const source = ['theme-minmax-neighbors', 'theme-standard-accents'].includes(name) ? name + '-20261004.docx' : 'control.docx';
    for (const [file, key] of [[source, 'sourceSha256'], ['cases.json', 'casesSha256'], ['native.pdf', 'pdfSha256']])
      expect(digest(root + file), file).toBe(reference[key]);
    if (name === 'theme-chroma-midtones')
      for (const [file, hash] of Object.entries(json(root + 'manifest.json'))) expect(digest(root + file), file).toBe(hash);
    native = reference.colors.map(row => ({label: row.label, hex: Buffer.from(row.rgb).toString('hex').toUpperCase()}));
  }
  expect(native.map(row => row.label)).toEqual(cases.map(row => row.label));
  expect(cases).toHaveLength(name.includes('sweep') || name === 'theme-chroma-midtones' ? 512 : name === 'theme-minmax-neighbors' ? 208 : name === 'theme-standard-accents' ? 144 : 128);
  for (const [index, c] of cases.entries()) {
    expect(themeColorTransform(c.base, c.mode === 'tint' ? c.value / 255 : undefined,
      c.mode === 'shade' ? c.value / 255 : undefined), `${c.label} ${c.base}/${c.mode}/${c.value}`).toBe(native[index].hex);
  }
});

it('preserves identity, modifier endpoints and tint precedence across chromatic branch boundaries', () => {
  for (const base of ['4F81BD', 'C0504D', 'FEFDFC', '000001', 'FFFEFE', '7F8000', 'FF0100']) {
    expect(themeColorTransform(base)).toBe(base);
    expect(themeColorTransform(base, 1, 0)).toBe(base);
    expect(themeColorTransform(base, undefined, 1)).toBe(base);
    expect(themeColorTransform(base.toLowerCase(), 1)).toBe(base);
    expect(themeColorTransform(base.toLowerCase(), undefined, 1)).toBe(base);
    expect(themeColorTransform(base, 0, 1)).toBe('FFFFFF');
    expect(themeColorTransform(base, undefined, 0)).toBe('000000');
    for (const amount of [12, 99, 128, 139, 248, 254])
      expect(themeColorTransform(base, amount / 255, 0)).toBe(themeColorTransform(base, amount / 255));
  }
});
