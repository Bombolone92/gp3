import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

const folder = 'tests/fixtures/svg-cubic-coverage/';
const read = name => readFileSync(folder + name);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const reference = JSON.parse(read('metafile-reference.json'));
const geometry = JSON.parse(read('native-coverage-reference.json'));
const cases = JSON.parse(read('cases.json'));

it('binds six independently authored cubic controls to their native captures', () => {
  expect(hash(read('control.docx'))).toBe(reference.sourceSha256);
  expect(hash(read('cases.json'))).toBe(reference.casesSha256);
  expect(hash(read('capture.emf'))).toBe(reference.captureSha256);
  expect(hash(read('native.emf'))).toBe(reference.nativeSha256);
  expect(geometry.sourceSha256).toBe(reference.sourceSha256);
  expect(geometry.casesSha256).toBe(reference.casesSha256);
  expect(cases).toHaveLength(6);
  expect(geometry.rows).toHaveLength(6);
  const svg = new TextDecoder().decode(unzipSync(read('control.docx'))['word/media/vector.svg']);
  for (const entry of cases) expect(svg).toContain(`d="${entry.path}"`);
});

for (const [i, control] of cases.entries()) it(`${control.name}: flattened polygon coverage agrees with the native reference`, () => {
  const image = reference.images[i], row = geometry.rows[i];
  const bytes = read(image.path);
  expect(hash(bytes)).toBe(image.sha256);
  expect(row.nativeSha256).toBe(image.sha256);
  expect(row.changedPixels).toBe(0);
  const flat = row.flattened.find(item => item.flatness === 0.25);
  expect(flat.types[0]).toBe(0);
  expect(flat.types.at(-1) & 128).toBe(128);
  const points = flat.types.map((_, n) => flat.coordinates.slice(n * 2, n * 2 + 2));
  const [width, height] = image.size, alpha = Buffer.from(row.alphaBase64, 'base64');
  expect(alpha.length).toBe(width * height);
  const originX = image.transform[4], originY = image.transform[5];
  let changed = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let covered = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 8; sx++) {
      const px = originX + x + sx / 8, py = originY + y + sy / 4;
      let winding = 0;
      for (let n = 0; n < points.length; n++) {
        const a = points[n], b = points[(n + 1) % points.length];
        const cross = (b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1]);
        if (a[1] <= py && b[1] > py && cross > 0) winding++;
        if (a[1] > py && b[1] <= py && cross < 0) winding--;
      }
      if (winding) covered++;
    }
    if (Math.round(covered * 255 / 32) !== alpha[y * width + x]) changed++;
  }
  expect(changed).toBe(0);
});
