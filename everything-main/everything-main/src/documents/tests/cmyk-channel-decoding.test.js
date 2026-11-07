import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import UTIF from 'utif';

// Decoder feasibility check only: no native reference RGB conversion is implied here.
// The independently authored JPEGs encode Adobe transform-0 CMYK, whose
// samples are inverted. Do not generalize this to YCCK or unmarked JPEGs.
it('recovers all 753 authored CMYK colors before any RGB conversion', () => {
  const root = 'tests/fixtures/cmyk-color-grid/';
  const groups = JSON.parse(readFileSync(root + 'cases.json'));
  const parts = unzipSync(readFileSync(root + 'control.docx'));
  let count = 0;
  for (const [index, group] of groups.entries()) {
    const bytes = parts[`word/media/image${index + 1}.png`];
    expect(bytes).toBeDefined();
    const decoder = new UTIF.JpegDecoder();
    decoder.parse(bytes);
    expect([decoder.width, decoder.height]).toEqual([256, 128]);
    const pixels = decoder.getData(decoder.width, decoder.height, false);
    expect(pixels.length).toBe(256 * 128 * 4);
    for (const [i, expected] of group.colors.entries()) {
      const x = i % 4 * 64 + 32, y = Math.floor(i / 4) * 32 + 16;
      const start = (y * 256 + x) * 4;
      expect(Array.from(pixels.slice(start, start + 4), v => 255 - v)).toEqual(expected);
      count++;
    }
  }
  expect(count).toBe(753);
});
