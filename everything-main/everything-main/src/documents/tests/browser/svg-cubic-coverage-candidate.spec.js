import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';

// This prototype is deliberately absent from the production import graph.
// Tests opt in to retain its native comparisons while performance is unresolved.
test.beforeEach(async({page})=>{
  const original=readFileSync('src/engine/svg-native-strokes.js','utf8');
  const body=`import {nativeSvgMaskedCubics} from '/tools/candidates/svg-cubic-coverage.mjs';\n`+
    original.replace('if (rasterGroups && correctViewport) nativeSvgGroups(svg,groupOpacities,paintOpacities);',
      'if (rasterGroups && correctViewport) { nativeSvgMaskedCubics(svg); nativeSvgGroups(svg,groupOpacities,paintOpacities); }');
  expect(body).toContain('{ nativeSvgMaskedCubics(svg); nativeSvgGroups(svg,groupOpacities,paintOpacities); }');
  await page.route(/\/src\/engine\/svg-native-strokes\.js(?:\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body}));
});

for (const [family, remaining] of [
  ['svg-cubic-coverage', [0,0,0,0,0,0]],
  ['svg-cubic-coverage-large', [7,0,0,51,0,2]],
]) test(`${family}: masked paths retain native coverage improvements`, async({page}) => {
  test.setTimeout(120000);
  const folder=`tests/fixtures/${family}/`,ref=JSON.parse(readFileSync(folder+'metafile-reference.json'));
  const source=new TextDecoder().decode(unzipSync(readFileSync(folder+'control.docx'))['word/media/vector.svg']);
  await page.goto('/playground.html');
  for(let i=0;i<ref.images.length;i++) {
    const entry=ref.images[i];
    const result=await page.evaluate(async({source,i,entry,native})=>{
      const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
      const root=new DOMParser().parseFromString(source,'image/svg+xml').documentElement;
      [...root.querySelectorAll('path')].forEach((path,n)=>{if(n!==i)path.remove();});
      const preview=nativeSvgStrokes(root,{width:Number(root.getAttribute('width')),height:Number(root.getAttribute('height'))},true);
      preview.removeAttribute('style');preview.querySelector('#_nativeSvgViewport')?.remove();
      const load=async src=>{const image=new Image();image.src=src;await image.decode();return image;};
      const a=document.createElement('canvas'),b=document.createElement('canvas');
      a.width=b.width=entry.size[0];a.height=b.height=entry.size[1];
      a.getContext('2d').drawImage(await load('data:image/svg+xml;base64,'+btoa(new XMLSerializer().serializeToString(preview))),-entry.transform[4],-entry.transform[5]);
      b.getContext('2d').drawImage(await load(native),0,0);
      const x=a.getContext('2d').getImageData(0,0,a.width,a.height).data,y=b.getContext('2d').getImageData(0,0,b.width,b.height).data;
      let changedAlpha=0,changedRgb=0;
      for(let n=0;n<x.length;n+=4){changedAlpha+=x[n+3]!==y[n+3];if(x[n+3]||y[n+3])changedRgb+=x[n]!==y[n]||x[n+1]!==y[n+1]||x[n+2]!==y[n+2];}
      return {changedAlpha,changedRgb,rasterized:preview.querySelectorAll('image').length};
    },{source,i,entry,native:'data:image/png;base64,'+readFileSync(folder+entry.path).toString('base64')});
    expect(result.rasterized).toBe(1);
    // Three larger controls remain partial. The other nine are exact native
    // alpha references; the limits may shrink as native arithmetic is resolved.
    expect(result.changedAlpha).toBeLessThanOrEqual(remaining[i]);
    if(!remaining[i])expect(result.changedRgb).toBe(0);
  }
});

test('unsupported masked-path contexts keep their vector rendering',async({page})=>{
  await page.goto('/playground.html');
  const result=await page.evaluate(async()=>{
    const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
    const shape='M1 1 C1 8 8 8 8 1 L8 10 L1 10 Z';
    const contexts=[
      `<path opacity=".5" mask="url(#m)" d="${shape}"/>`,
      `<g opacity=".5" mask="url(#m)"><path d="${shape}"/></g>`,
      `<path transform="scale(2)" mask="url(#m)" d="${shape}"/>`,
      `<path transform="translate(.25 0)" mask="url(#m)" d="${shape}"/>`,
      `<path stroke="black" mask="url(#m)" d="${shape}"/>`,
      `<path mask="url(#box)" d="${shape}"/>`,
    ];
    return contexts.map(context=>{
      const root=new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><defs><mask id="m" maskUnits="userSpaceOnUse"><rect width="40" height="40" fill="white"/></mask><mask id="box"><rect width="1" height="1" fill="white"/></mask></defs>${context}</svg>`,'image/svg+xml').documentElement;
      const preview=nativeSvgStrokes(root,{width:40,height:40},true);
      return preview.querySelectorAll('path').length;
    });
  });
  expect(result).toEqual([1,1,1,1,1,1]);
});
