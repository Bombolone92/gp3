import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root='tests/fixtures/shadow-raster-sampling/';
const ref=JSON.parse(readFileSync(root+'reference.json','utf8'));
const sha=file=>createHash('sha256').update(readFileSync(root+file)).digest('hex');

it('binds independently authored inputs, native PDF and metafile captures',()=>{
  for(const [file,hash]of Object.entries(ref.hashes))expect(sha(file),file).toBe(hash);
  expect(ref.pages).toHaveLength(20);
  for(const p of ref.pages){expect(p.centerRow).toHaveLength(p.shadowPixels[0]);expect(p.centerColumn).toHaveLength(p.shadowPixels[1]);}
  for(const c of ref.metafileComparisons){expect(sha(c.emf)).toBe(c.emfSha256);expect(sha(c.png)).toBe(c.pngSha256);}
});
it('retains the holdout that rejects a simple continuous-resolution grid formula',()=>{
  const p=ref.pages.find(p=>p.name==='square-144-blur-18');
  expect(Math.round((p.widthPt+2*p.blurPt)/(.36+.12*p.blurPt))).toBe(71);
  expect(p.shadowPixels).toEqual([72,72]);
});
it('separates placement quantization from alpha content for a translated rectangle',()=>{
  const a=ref.pages.find(p=>p.name==='fractional-blur-36-offset-0');
  const b=ref.pages.find(p=>p.name==='fractional-blur-36-offset-0.3');
  expect(a.alphaSha256).toBe(b.alphaSha256);expect(a.shadowPixels).toEqual(b.shadowPixels);
  expect(b.shadowMatrix[4]-a.shadowMatrix[4]).toBeCloseTo(.36,8);
  expect(b.shadowMatrix[5]-a.shadowMatrix[5]).toBeCloseTo(-.36,8);
});
it('keeps raw premultiplied PDF bytes distinct from native metafile composites',()=>{
  const purple=ref.metafileComparisons.find(p=>p.page===14),white=ref.metafileComparisons.find(p=>p.page===16);
  expect(ref.pages[13].centerPremultipliedRgba).toEqual([76,37,114,153]);
  expect(purple.pdfRgb).toEqual([177,138,216]);expect(purple.gdiRgb).toEqual([179,140,217]);
  expect(white.pdfRgb).toEqual([253,253,253]);expect(white.gdiRgb).toEqual([254,254,254]);
});
it('locates partial-opacity channel loss in the native bitmap before playback',()=>{
  expect(ref.metafileComparisons).toHaveLength(8);
  expect(ref.metafileComparisons.map(p=>p.nativeImages[0].centerRgba)).toEqual([
    [128,64,192,255],[128,63,191,153],
    [255,255,255,255],[254,254,254,153],
    [1,2,3,255],[1,1,3,153],
    [64,128,192,255],[63,128,191,153],
  ]);
  for(const p of ref.metafileComparisons){
    expect(p.nativeImages).toHaveLength(2);
    expect(p.nativeImages[1].centerRgba).toEqual([0,0,0,255]);
  }
});
