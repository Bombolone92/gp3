import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
for(const fixture of ['svg-group-raster','svg-group-transforms']) test(`${fixture}: native bounds, nested alpha and visible artwork`,async({page})=>{
  const folder=`tests/fixtures/${fixture}/`;
  const reference=JSON.parse(readFileSync(folder+'metafile-reference.json'));
  expect(createHash('sha256').update(readFileSync(`public/fixtures/${fixture}.docx`)).digest('hex')).toBe(reference.sourceSha256);
  for(const image of reference.images)expect(createHash('sha256').update(readFileSync(folder+image.path)).digest('hex')).toBe(image.sha256);
  await page.goto('/playground.html');
  const result=await page.evaluate(async ({refs,fixture})=>{
    const {DocxPackage}=await import('/src/engine/docx.js');
    const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
    const {decodeSvg,svgInfo}=await import('/src/engine/svg-images.js');
    const pkg=await DocxPackage.open(new Uint8Array(await(await fetch(`/fixtures/${fixture}.docx`)).arrayBuffer()));
    const bytes=pkg.assets['word/media/vector.svg'].bytes,xml=new DOMParser().parseFromString(new TextDecoder().decode(bytes),'image/svg+xml');
    const saved=new XMLSerializer().serializeToString(xml),count=document.body.children.length;
    const svg=nativeSvgStrokes(xml.documentElement,svgInfo(bytes),true),images=[...svg.querySelectorAll('image')];
    const pixels=async url=>{const image=new Image();image.src=url;await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
    const metrics=[];
    for(let i=0;i<images.length;i++) {
      const a=await pixels(images[i].getAttribute('href')),n=await pixels(refs[i]);let error=0,colorError=0;
      for(let at=3;at<a.length;at+=4){error+=Math.abs(a[at]-n[at]);for(let k=1;k<=3;k++)colorError+=Math.abs(a[at-k]*a[at]/255-n[at-k]*n[at]/255);}
      metrics.push({x:Number(images[i].getAttribute('x')),y:Number(images[i].getAttribute('y')),
        width:Number(images[i].getAttribute('width')),height:Number(images[i].getAttribute('height')),alphaError:error/(a.length/4),colorError:colorError/(a.length/4*3)});
    }
    const image=await decodeSvg(bytes),c=document.createElement('canvas');c.width=120;c.height=100;
    const ctx=c.getContext('2d');ctx.drawImage(image,0,0,120,100);image.close();
    const data=ctx.getImageData(0,0,120,100).data;let ink=0;for(let i=3;i<data.length;i+=4)ink+=data[i];
    return {metrics,ink,paths:svg.querySelectorAll('path').length,clean:count===document.body.children.length,
      unchanged:saved===new XMLSerializer().serializeToString(xml)};
  },{fixture,refs:reference.images.map(i=>'data:image/png;base64,'+readFileSync(folder+i.path).toString('base64'))});
  expect(result.metrics).toHaveLength(4);expect(result.paths).toBe(fixture==='svg-group-raster'?2:0);
  for(const [i,m] of result.metrics.entries()) {
    expect([m.x,m.y]).toEqual(reference.images[i].transform.slice(4));
    expect([m.width,m.height]).toEqual(reference.images[i].size);
    expect(m.alphaError).toBeLessThan(3);
    expect(m.colorError).toBeLessThan(3);
  }
  expect(result.ink).toBeGreaterThan(70000);expect(result.clean).toBe(true);expect(result.unchanged).toBe(true);
});

test('retains unverified paints and bounds without allocating huge raster layers',async({page})=>{
  await page.goto('/playground.html');
  const result=await page.evaluate(async()=>{
    const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
    const body='<defs><linearGradient id="c"><stop stop-color="red"/></linearGradient><clipPath id="clip"><rect width="10" height="10"/></clipPath></defs>'+
      '<g opacity=".5"><rect width="10" height="10" fill="url(#c)"/></g>'+
      '<g opacity=".5"><rect width="10" height="10" stroke="red"/></g>'+
      '<g opacity=".5" transform="rotate(20)"><rect width="10" height="10"/></g>'+
      '<g opacity=".5" clip-path="url(#clip)"><rect width="10" height="10"/></g>'+
      '<g opacity=".5"><rect width="10" height="10"/><rect x="100000000" width="10" height="10"/></g>'+
      '<g opacity=".5">'.repeat(16)+'<rect width="500" height="500"/>'+'</g>'.repeat(16);
    const root=new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100">${body}</svg>`,'image/svg+xml').documentElement;
    const svg=nativeSvgStrokes(root,{width:120,height:100},true);
    return {images:svg.querySelectorAll('image').length,groups:svg.querySelectorAll('g').length};
  });
  expect(result).toEqual({images:0,groups:21});
});
