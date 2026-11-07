import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {requireNativeWordFonts} from './helpers/native-fonts.js';

const root='tests/fixtures/bidi-layout/';
const cases=JSON.parse(readFileSync(root+'cases.json','utf8'));
const reference=JSON.parse(readFileSync(root+'reference.json','utf8'));

// Internal layout/paint control: this does not enable strict DOCX editing.
test('compares mixed-direction wrapping and tabs with the native reference', async ({page},info)=>{
  test.setTimeout(120000);
  for(const [name,key] of [['control.docx','sourceSha256'],['native.pdf','pdfSha256'],['cases.json','casesSha256']]) expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(reference[key]);
  await page.goto('/playground.html');
  await requireNativeWordFonts(page,['Arial']);
  const actual=await page.evaluate(async cases=>{
    const {bidiControlParagraphs}=await import('/tests/helpers/bidi-controls.js');
    const {prepareCanvasFont}=await import('/src/engine/font-availability.js');
    const {measureCanvasText,setCanvasTextStyle}=await import('/src/engine/canvas-text.js');
    const {paintText}=await import('/src/engine/canvas-paint-text.js');
    const {layoutDocument}=await import('/src/engine/layout.js');
    const {pageGeometry}=await import('/src/engine/page-settings.js');
    await prepareCanvasFont('Arial');
    const ctx=document.createElement('canvas').getContext('2d');
    const paragraphs=bidiControlParagraphs(cases), geometry=pageGeometry({compatibilityMode:15});
    const layout=layoutDocument(paragraphs,(t,s)=>measureCanvasText(ctx,t,s),geometry);
    const pages=[];
    for(let i=0;i<=Math.max(...layout.lines.map(l=>l.page));i++){
      const canvas=document.createElement('canvas');canvas.width=816;canvas.height=1056;
      const paint=canvas.getContext('2d');paint.fillStyle='white';paint.fillRect(0,0,816,1056);paint.fillStyle='black';
      const lines=layout.lines.filter(l=>l.page===i);
      for(const line of lines) for(const fragment of line.fragments){setCanvasTextStyle(paint,fragment);paintText(paint,fragment,line.baseline);}
      pages.push({png:canvas.toDataURL().split(',')[1],lines:lines.map(l=>({baseline:l.baseline*.75,start:l.start,end:l.end,fragments:l.fragments.map(f=>({text:f.text,x:f.x*.75,width:f.width*.75,dir:f.bidiDirection})),stops:l.stops.map(s=>({offset:s.offset,x:s.x*.75}))}))});
    }
    return pages;
  },cases);
  writeFileSync(info.outputPath('actual.json'),JSON.stringify(actual.map(({png,...p})=>p),null,2));
  for(const [i,p] of actual.entries()) writeFileSync(info.outputPath(`page-${i+1}.png`),Buffer.from(p.png,'base64'));
  expect(actual).toHaveLength(reference.pages.length);
  for(const [i,p] of actual.entries()){
    expect(p.lines,`page ${i+1}`).toHaveLength(reference.pages[i].length);
    for(const [j,l] of p.lines.entries()) {
      const native=reference.pages[i][j],message=`page ${i+1} line ${j+1}`;
      expect(Math.abs(l.baseline-native.baseline),message).toBeLessThan(.25);
      const text=l.fragments.map(f=>f.text).join('');
      if(text.endsWith('Right')) {
        const last=native.glyphs.filter(g=>g.text==='t').at(-1);
        expect(Math.abs(l.stops.find(s=>s.offset===l.end-1).x-last.x),message+' suffix origin').toBeLessThan(.3);
      }
      // PDF ToUnicode loses bracket mirroring and ligature character order.
      // Compare Hebrew/Latin/number order separately from the visual review
      // of brackets and Arabic ink, without treating labels as bidi coverage.
      if(l.fragments.some(f=>f.dir) && !/[\u0600-\u06ff]/u.test(text)) {
        const normalize=t=>t.replace(/[\s\[\]()]/g,'');
        const visual=l.fragments.map(f=>f.dir==='rtl'?[...f.text].reverse().join(''):f.text).join('');
        expect(normalize(visual),message+' visual order').toBe(normalize([...native.glyphs].sort((a,b)=>a.x-b.x).map(g=>g.text).join('')));
      }
    }
  }
});
