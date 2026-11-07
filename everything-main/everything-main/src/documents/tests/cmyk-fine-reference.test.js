import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

it('reconstructs the fine native CMYK grid and independently rejects its interpolation', () => {
  const root = 'tests/fixtures/cmyk-color-fine/';
  const ref = JSON.parse(readFileSync(root + 'reference.json'));
  const cases = JSON.parse(readFileSync(root + 'cases.json'));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const [name, expected] of Object.entries(ref.hashes)) expect(hash(readFileSync(root + name))).toBe(expected);
  const captures = unzipSync(readFileSync(root + 'native-metafiles.zip'));
  expect(cases.length).toBe(669);
  const samples = { grid: [], holdout: [] }, rgbBytes = [];
  for (const [index, group] of cases.entries()) {
    const data = Buffer.from(captures[`${index + 1}.emf`]);
    let pictures = 0;
    for (let p = 0; p < data.length;) {
      const type = data.readUInt32LE(p), length = data.readUInt32LE(p + 4);
      expect(length).toBeGreaterThanOrEqual(8);
      expect(p + length).toBeLessThanOrEqual(data.length);
      if (type === 81) {
        pictures++;
        const bmi = p + data.readUInt32LE(p + 48), bits = p + data.readUInt32LE(p + 56);
        const depth = data.readUInt16LE(bmi + 14);
        expect([data.readUInt32LE(bmi), data.readInt32LE(bmi + 4), data.readInt32LE(bmi + 8), data.readUInt32LE(bmi + 16)]).toEqual([40, 512, 256, 0]);
        expect([1, 4, 8]).toContain(depth);
        const stride = Math.ceil(512 * depth / 32) * 4;
        for (const [i, cmyk] of group.colors.entries()) {
          const x = i % 16 * 32 + 16, y = 255 - (Math.floor(i / 16) * 32 + 16);
          const byte = data[bits + y * stride + Math.floor(x * depth / 8)];
          const color = (byte >> (8 - depth - x * depth % 8)) & ((1 << depth) - 1);
          const at = bmi + 40 + color * 4, rgb = [data[at + 2], data[at + 1], data[at]];
          samples[group.set].push({ cmyk, rgb }); rgbBytes.push(...rgb);
        }
      }
      p += length;
    }
    expect(pictures).toBe(1);
  }
  expect(samples.grid.length).toBe(83521); expect(samples.holdout.length).toBe(2048);
  expect(hash(Uint8Array.from(rgbBytes))).toBe(ref.nativeRgbSha256);
  let maxError = 0, sumError = 0;
  for (const { cmyk, rgb } of samples.holdout) {
    const lo = cmyk.map(v => Math.min(Math.floor(v / 16), 15));
    const f = cmyk.map((v, k) => (v - ref.levels[lo[k]]) / (ref.levels[lo[k] + 1] - ref.levels[lo[k]]));
    const predicted = [0, 0, 0];
    for (let mask = 0; mask < 16; mask++) {
      let offset = 0, weight = 1;
      for (let k = 0; k < 4; k++) {
        const bit = (mask >> k) & 1; offset = offset * 17 + lo[k] + bit; weight *= bit ? f[k] : 1 - f[k];
      }
      for (let k = 0; k < 3; k++) predicted[k] += weight * samples.grid[offset].rgb[k];
    }
    const error = Math.max(...predicted.map((v, k) => Math.abs(Math.round(v) - rgb[k])));
    maxError = Math.max(maxError, error); sumError += error;
  }
  expect(maxError).toBe(6);
  // JS and numpy differ at exact half ties; the independent aggregate must
  // still agree to two decimal places across the whole set.
  expect(sumError / 2048).toBeCloseTo(ref.meanInterpolationError, 2);
});
