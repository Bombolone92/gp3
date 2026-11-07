import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

for (const fixture of ['svg-mask-quantization','svg-mask-intermediate','svg-mask-quantization-boundary','svg-mask-intermediate-boundary']) {
it(`binds ${fixture} controls to original native rasters`, () => {
  const root=`tests/fixtures/${fixture}/`;
  const cases=JSON.parse(readFileSync(root+'cases.json'));
  const ref=JSON.parse(readFileSync(root+'metafile-reference.json'));
  const source=readFileSync(`public/fixtures/${fixture}.docx`);
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  expect(hash(source)).toBe(ref.sourceSha256);
  expect(hash(readFileSync(root+'native.emf'))).toBe(ref.nativeSha256);
  expect(cases).toHaveLength(36); expect(ref.images).toHaveLength(36);
  expect(new Set(cases.map(c=>c.color)).size).toBe(6);
  expect(new Set(cases.map(c=>c.opacity)).size).toBe(6);
  const svg=new TextDecoder().decode(unzipSync(source)['word/media/vector.svg']);
  for (const [i,c] of cases.entries()) {
    expect(svg).toContain(`fill="${c.color}" fill-opacity="${c.opacity}"`);
    const im=ref.images[i];
    expect(hash(readFileSync(root+im.path))).toBe(im.sha256);
    expect(im.size).toEqual([18,10]);
    expect(im.transform).toEqual([1,0,0,1,c.x-9,c.y-5]);
    expect(im.middleColumn).toHaveLength(10);
  }
});
}

it('matches native solid-mask alpha by rounding luminance before applying native alpha', () => {
  for (const suffix of ['', '-boundary']) {
    const folder=kind=>`tests/fixtures/svg-mask-${kind}${suffix}/`;
    const colors=JSON.parse(readFileSync(folder('intermediate')+'metafile-reference.json'));
    const masks=JSON.parse(readFileSync(folder('quantization')+'metafile-reference.json'));
    const cases=JSON.parse(readFileSync(folder('intermediate')+'cases.json'));
    for (const [i,image] of colors.images.entries()) {
      const [r,g,b,a]=image.middleColumn[Math.floor(image.size[1]/2)];
      const rgb=cases[i].color.slice(1).match(/../g).map(c=>parseInt(c,16));
      const reciprocal=a?Math.floor(255*65536/a):0;
      expect(rgb.map(c=>Math.floor(Math.round(c*a/255)*reciprocal/65536))).toEqual([r,g,b]);
      const mask=masks.images[i];
      const expected=mask.middleColumn[Math.floor(mask.size[1]/2)][3];
      expect(Math.round(Math.round(r*.2126+g*.7152+b*.0722)*a/255)).toBe(expected);
    }
  }
});
