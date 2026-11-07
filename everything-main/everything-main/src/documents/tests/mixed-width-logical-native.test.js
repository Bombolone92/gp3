import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

it('binds logical native reference cell-width observations to the independent mixed-width controls', () => {
  const r = JSON.parse(readFileSync('tests/fixtures/measurements/mixed-width-logical-native.json', 'utf8'));
  for (const [name, hash] of Object.entries(r.hashes))
    expect(createHash('sha256').update(readFileSync(`${r.sourceFixture}/${name}`)).digest('hex')).toBe(hash);
  expect(r.widthsBeforePdf).toHaveLength(16);
  expect(r.widthsBeforePdf).toEqual(r.widthsAfterPdf);
  for (const widths of r.widthsBeforePdf) {
    expect(widths).toHaveLength(4);
    for (const width of widths) {
      expect(width).toBeGreaterThan(0);
      expect(Math.abs(width * 20 - Math.round(width * 20))).toBeLessThan(1e-6);
    }
  }
  const cases = JSON.parse(readFileSync(`${r.sourceFixture}/cases.json`, 'utf8'));
  const { noWrapScope: bodyScope, ...body } = cases[1];
  const { noWrapScope: allScope, ...all } = cases[9];
  expect(bodyScope).toBe('body'); expect(allScope).toBe('all'); expect(body).toEqual(all);
  expect(r.widthsBeforePdf[1]).not.toEqual(r.widthsBeforePdf[9]);
  expect(r.viewerWidths[1]).toEqual(r.viewerWidths[9]);
});
