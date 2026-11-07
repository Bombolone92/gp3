import {it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {flattenMaskCubic, maskedCubicContours, cubicCoveragePixels} from '../tools/candidates/svg-cubic-coverage.mjs';

const identity = {a:1, d:1, e:0, f:0};
for (const [family, remaining] of [
  ['svg-cubic-coverage', [0,0,0,0,0,0]],
  // Independently recorded remaining native arithmetic errors, not exact cases.
  ['svg-cubic-coverage-large', [7,0,0,51,0,2]],
]) {
  const folder = `tests/fixtures/${family}/`;
  const cases = JSON.parse(readFileSync(folder+'cases.json'));
  const native = JSON.parse(readFileSync(folder+'native-coverage-reference.json'));
  const frames = JSON.parse(readFileSync(folder+'metafile-reference.json'));
  for (const [i, control] of cases.entries()) it(`${family} ${control.name} preserves the measured reference coverage`, () => {
    const contours = maskedCubicContours(control.path, identity);
    expect(contours).not.toBeNull();
    const entry = frames.images[i], row = native.rows[i];
    const alpha = row.alphaBase64 ? Buffer.from(row.alphaBase64, 'base64') : inflateSync(Buffer.from(row.alphaDeflateBase64, 'base64'));
    const box = {x:entry.transform[4], y:entry.transform[5], width:entry.size[0], height:entry.size[1]};
    const pixels = cubicCoveragePixels(contours, box, [32,96,192]);
    let changed = 0;
    for (let n=0;n<alpha.length;n++) if (pixels[n*4+3]!==alpha[n]) changed++;
    expect(changed).toBe(remaining[i]);
  });
}

it('leaves unsupported or incomplete path grammar on the vector path', () => {
  for (const d of ['M0 0 L10 10Z','M0 0 C1 2 3 4 5','M0 0 c1 2 3 4 5 6Z','M0 0 C1 2 3 4 5 6Z L8 9','M0 0 C1 2 3 4 1e999 6Z']) {
    expect(maskedCubicContours(d,identity)).toBeNull();
  }
  expect(flattenMaskCubic([[0,0],[1,2],[3,4],[Infinity,0]])).toBeNull();
});

it('keeps separate subpaths and uses the requested winding rule', () => {
  const contours = [[[0,0],[3,0],[3,3],[0,3]],[[1,1],[2,1],[2,2],[1,2]]];
  const box={x:0,y:0,width:3,height:3};
  expect(cubicCoveragePixels(contours,box,[0,0,0],'nonzero')[19]).toBe(255);
  expect(cubicCoveragePixels(contours,box,[0,0,0],'evenodd')[19]).toBe(0);
  const parsed=maskedCubicContours('M0 0 C0 1 1 1 1 0Z M2 0 C2 1 3 1 3 0Z',identity);
  expect(parsed).toHaveLength(2);
});
