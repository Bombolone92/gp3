import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';

it('binds external-backdrop samples to the original transparent control and native captures', () => {
  const folder = 'tests/fixtures/svg-external-backdrop/';
  const ref = JSON.parse(readFileSync(folder + 'native-colors.json', 'utf8').replace(/^\uFEFF/, ''));
  for (const [name, hash] of Object.entries(ref.hashes)) expect(createHash('sha256').update(readFileSync(folder + name)).digest('hex'), name).toBe(hash);
  const cases = JSON.parse(readFileSync(folder + 'cases.json'));
  expect(cases).toHaveLength(9); expect(ref.samples).toHaveLength(4);
  for (const sample of ref.samples) {
    expect(sample.colors).toHaveLength(cases.length);
    for (const color of sample.colors) expect(color.length === 3 && color.every(v => Number.isInteger(v) && v >= 0 && v <= 255)).toBe(true);
  }
  const svg = strFromU8(unzipSync(readFileSync(folder + 'control.docx'))['word/media/vector.svg']);
  expect(svg.match(/<rect /g)).toHaveLength(10);
  expect(svg.match(/opacity=/g)).toHaveLength(10);
});
