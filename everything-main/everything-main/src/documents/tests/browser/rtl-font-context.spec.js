import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {requireNativeWordFonts} from './helpers/native-fonts.js';
const root='tests/fixtures/rtl-font-context/';
const cases=JSON.parse(readFileSync(root+'cases.json','utf8'));
const reference=JSON.parse(readFileSync(root+'reference.json','utf8'));
test('matches native numeric font context and complete line advances',async({page},info)=>{
  test.setTimeout(120000);
  await page.goto('/playground.html');
  await requireNativeWordFonts(page,['Arial','Courier New','Times New Roman']);
  const actual=await page.evaluate(async ({cases,bytes})=>{
    const {openCanvasDocument}=await import('/src/engine/open-document.js');
    const {prepareCanvasFont}=await import('/src/engine/font-availability.js');
    const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
    for(const f of ['Arial','Courier New','Times New Roman']) await prepareCanvasFont(f);
    const {pkg,images:decoded}=await openCanvasDocument(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));
    const ps=pkg.paragraphs,host=document.createElement('div');document.body.append(host);
    const editor=new CanvasEditor(host,{...pkg,images:decoded}),layout=editor.layout;
    const canvases=[...editor.pages.querySelectorAll('canvas')],images=canvases.map(c=>c.toDataURL().split(',')[1]);
    const bluePixels=canvases.map(c=>{const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<data.length;i+=4) if(data[i+2]>data[i]+100 && data[i+2]>data[i+1]+100)n++;return n;});
    const result={images,bluePixels,readOnly:editor.input.readOnly,samples:cases.map(c=>{
      const lines=layout.lines.filter(l=>l.paragraphId===ps[c.index*2+1].id),l=lines[0];
      return {index:c.index,count:lines.length,page:l.page,baseline:l.baseline*.75,lastT:l.stops.find(s=>s.offset===l.end-1).x*.75,
        fragments:l.fragments.map(f=>({text:f.text,font:f.fontFamily,size:f.fontSize,x:f.x*.75,width:f.width*.75,dir:f.bidiDirection}))};
    })};
    editor.destroy();host.remove();return result;
  },{cases,bytes:readFileSync(root+'control.docx').toString('base64')});
  writeFileSync(info.outputPath('actual.json'),JSON.stringify(actual.samples,null,2));
  for(const [i,png] of actual.images.entries()) writeFileSync(info.outputPath(`page-${i+1}.png`),Buffer.from(png,'base64'));
  expect(actual.images).toHaveLength(reference.pages.length);
  expect(actual.readOnly).toBe(false);expect(actual.bluePixels[3]).toBeGreaterThan(100);
  expect(actual.bluePixels.filter((_,i)=>i!==3).every(n=>n===0)).toBe(true);
  for(const s of actual.samples){
    const native=reference.samples[s.index],last=native.glyphs.filter(g=>g.text==='t').at(-1);
    expect(s.count).toBe(1);expect(s.page).toBe(cases[s.index].page);
    expect(Math.abs(s.baseline-native.baseline),`case ${s.index+1} baseline`).toBeLessThan(.25);
    expect(Math.abs(s.lastT-last.x),`case ${s.index+1} suffix position`).toBeLessThan(.35);
    if(cases[s.index].flag!=='cs'){
      const normalize=t=>t.replaceAll('۰','٠').replace(/[\s\[\]()]/gu,'');
      const visual=s.fragments.map(f=>f.dir==='rtl'?[...f.text].reverse().join(''):f.text).join('');
      expect(normalize(visual),`case ${s.index+1} visual order`).toBe(normalize([...native.glyphs].sort((a,b)=>a.x-b.x).map(g=>g.text).join('')));
    }
  }
});
