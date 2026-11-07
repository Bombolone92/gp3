import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { positionedImageFrame } from '../src/engine/positioned-images.js';
import { pageGeometry } from '../src/engine/page-settings.js';
const folder = 'tests/fixtures/outline-curve-display/';
const reference = JSON.parse(readFileSync(folder + 'reference.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });

it('binds the native source packages, crops and PDF positions', () => {
  for (const [name, source] of Object.entries(reference.sources)) {
    const bytes = readFileSync(folder + name + '.docx'); expect(hash(bytes)).toBe(source.fixtureSha256);
    for (const [part, partBytes] of Object.entries(unzipSync(bytes))) expect(hash(partBytes), part).toBe(source.partsSha256[part]);
  }
  expect(hash(readFileSync(folder + 'native-phase-boundaries.pdf'))).toBe(reference.pdfSha256);
  expect(reference.observations).toHaveLength(4);
  for (const observation of reference.observations) {
    expect(hash(readFileSync(folder + observation.crop))).toBe(observation.cropSha256);
    expect(observation.originalFormat).toBe('JPEG'); expect(observation.measurements).toHaveLength(16);
  }
  const cases = JSON.parse(readFileSync(folder + 'phase-boundaries-cases.json'));
  expect(reference.pdfPaths).toHaveLength(16);
  reference.pdfPaths.forEach((path, i) => {
    expect(path.leftPt).toBeCloseTo(Math.trunc(cases[i].xEmu / 635) / 20, 6);
    expect(path.frameTopPt).toBeCloseTo(Math.trunc(cases[i].yEmu / 635) / 20, 6);
    expect(path.penPt).toBeCloseTo(4327 / 12700, 5);
  });
});

it.each(['control', 'phase-boundaries'])('retains all authored curves and exact package parts: %s', async name => {
  const bytes = readFileSync(folder + name + '.docx'), pkg = await DocxPackage.open(bytes);
  expect(pkg.readOnly).not.toBe(true);
  expect(pkg.paragraphs.flatMap(p => p.runs).filter(r => r.image)).toHaveLength(16);
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
});

it('positive page-relative offsets match native whole-twip placement', async () => {
  const pkg = await DocxPackage.open(readFileSync(folder + 'phase-boundaries.docx'));
  const actual = pkg.paragraphs.flatMap(p => p.runs).filter(r => r.image).map(r => {
    const frame = positionedImageFrame({ image: r.image }, { page: 0, y: 0 }, pageGeometry(pkg.pageSettings));
    return [Number((frame.x * .75).toFixed(5)), Number((frame.y * .75).toFixed(5))];
  });
  expect(actual).toEqual(reference.pdfPaths.map(p => [Number(p.leftPt.toFixed(5)), Number(p.frameTopPt.toFixed(5))]));
});
