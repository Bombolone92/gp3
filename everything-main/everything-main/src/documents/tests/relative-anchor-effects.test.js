import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { DocxPackage } from '../src/engine/docx.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { positionedImageFrame } from '../src/engine/positioned-images.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const directory = 'tests/fixtures/relative-anchor-effects/';
const references = JSON.parse(readFileSync(directory + 'reference.json', 'utf8'));

for (const reference of references) it(`${reference.name}: matches native frames for fixed, width-only, height-only and both-axis sizes`, async () => {
  const pkg = await DocxPackage.open(readFileSync(directory + reference.name + '.docx'));
  const images = pkg.paragraphs.flatMap(p => p.runs.flatMap(r => r.image ? [r.image] : []));
  expect(images).toHaveLength(8);
  // Native table top is 60 pt after the exact-spaced title; width is 500 pt.
  const cell = reference.name === 'cell' ? { x: 48, y: 60 / .75, width: 500 / .75, margins: { top: 0 } } : null;
  images.forEach((image, i) => {
    const frame = positionedImageFrame({ image }, { page: 0, y: 0 }, pageGeometry(pkg.pageSettings), cell);
    for (const axis of ['x', 'y', 'width', 'height']) {
      expect(Math.abs(frame[axis] * .75 - reference.paths[i][axis]), `shape ${i} ${axis}`).toBeLessThan(.051);
    }
  });
});
