import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { unzipSync, strFromU8 } from 'fflate';
import { nativeSvgFrame, nativeSvgDimensions } from '../src/engine/svg-native-viewport.js';
import { svgInfo } from '../src/engine/svg-images.js';
const directory = 'tests/fixtures/svg-viewport-geometry/';
const references = JSON.parse(readFileSync(directory + 'reference.json', 'utf8'));

it.each(references)('matches the native $name form extent, including the final device pixel', reference => {
  const frame = nativeSvgFrame(Math.round(reference.width), Math.round(reference.height));
  const native = reference.forms[0];
  expect(frame.width * .12).toBeCloseTo(native.bounds[2], 3);
  expect(frame.height * .12).toBeCloseTo(native.bounds[3], 3);
  expect(-frame.x * .12).toBeCloseTo(native.rectangles[0][0], 4);
});

it.each(['small','medium','fractional','odd'])('reproduces %s frame rounding from the independently captured EMF header', name => {
  const emf = readFileSync(directory + name + '-native.emf');
  const rect = [24,28,32,36].map(offset => emf.readInt32LE(offset));
  const px = emf.readInt32LE(72) / (emf.readInt32LE(80) * 100);
  const py = emf.readInt32LE(76) / (emf.readInt32LE(84) * 100);
  const width = emf.readInt32LE(16) - emf.readInt32LE(8) + 1;
  const height = emf.readInt32LE(20) - emf.readInt32LE(12) + 1;
  expect(nativeSvgFrame(width,height)).toEqual({x:rect[0]*px,y:rect[1]*py,width:(rect[2]-rect[0])*px+1,height:(rect[3]-rect[1])*py+1});
});

it('uses intrinsic pixel sizing before viewBox fitting while preserving fractional and physical source attributes', () => {
  const dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser;
  try {
    for (const ref of references) {
      const bytes = unzipSync(readFileSync(directory + ref.name + '.docx'))['word/media/vector.svg'];
      const root = new DOMParser().parseFromString(strFromU8(bytes), 'image/svg+xml').documentElement;
      const before = root.outerHTML;
      expect(nativeSvgDimensions(root, svgInfo(bytes))).toEqual({width:Math.round(ref.width),height:Math.round(ref.height)});
      expect(root.outerHTML).toBe(before);
    }
  } finally { delete globalThis.DOMParser; dom.window.close(); }
});
