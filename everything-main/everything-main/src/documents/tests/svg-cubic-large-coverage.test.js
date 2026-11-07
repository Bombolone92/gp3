import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { unzipSync } from 'fflate';

const folder = 'tests/fixtures/svg-cubic-coverage-large/';
const read = name => readFileSync(folder + name);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const reference = JSON.parse(read('metafile-reference.json'));
const geometry = JSON.parse(read('native-coverage-reference.json'));
const cases = JSON.parse(read('cases.json'));

it('binds the larger authored cubic controls to their reference captures', () => {
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

for (const [i, control] of cases.entries()) it(`${control.name}: native flattened coverage agrees with every reference alpha pixel`, () => {
  const image = reference.images[i], row = geometry.rows[i];
  expect(hash(read(image.path))).toBe(image.sha256);
  expect(row.nativeSha256).toBe(image.sha256);
  expect(row.changedPixels).toBe(0);
  const flat = row.flattened.find(item => item.flatness === 0.25);
  expect(flat.types[0]).toBe(0);
  expect(flat.types.at(-1) & 128).toBe(128);
  const points = flat.types.map((_, n) => flat.coordinates.slice(n * 2, n * 2 + 2));
  const [width, height] = image.size, alpha = inflateSync(Buffer.from(row.alphaDeflateBase64, 'base64'));
  expect(alpha.length).toBe(width * height);
  const [originX, originY] = image.transform.slice(4), counts = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let sy = 0; sy < 4; sy++) {
    const py = originY + y + sy / 4, events = [];
    for (let n = 0; n < points.length; n++) {
      const a = points[n], b = points[(n + 1) % points.length];
      if (a[1] <= py && py < b[1]) events.push([a[0] + (py - a[1]) * (b[0] - a[0]) / (b[1] - a[1]), 1]);
      else if (b[1] <= py && py < a[1]) events.push([a[0] + (py - a[1]) * (b[0] - a[0]) / (b[1] - a[1]), -1]);
    }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let winding = 0, start;
    for (const [x, change] of events) {
      const previous = winding;
      winding += change;
      if (!previous && winding) start = x;
      else if (previous && !winding) {
        const left = Math.max(0, Math.ceil((start - originX) * 8));
        const right = Math.min(width * 8, Math.ceil((x - originX) * 8));
        if (right <= left) continue;
        const first = Math.floor(left / 8), last = Math.floor((right - 1) / 8), offset = y * width;
        if (first === last) counts[offset + first] += right - left;
        else {
          counts[offset + first] += 8 - left % 8;
          counts[offset + last] += (right - 1) % 8 + 1;
          for (let column = first + 1; column < last; column++) counts[offset + column] += 8;
        }
      }
    }
  }
  let changed = 0;
  for (let n = 0; n < counts.length; n++) if (Math.round(counts[n] * 255 / 32) !== alpha[n]) changed++;
  expect(changed).toBe(0);
});
