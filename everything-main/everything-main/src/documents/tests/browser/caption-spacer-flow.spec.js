import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const source=readFileSync('tests/fixtures/caption-spacer-flow/control.docx');
const reference=JSON.parse(readFileSync('tests/fixtures/caption-spacer-flow/native-reference.json','utf8'));
test.setTimeout(180000);

for(const native of reference.cases)test(`caption spacer case ${native.page}: native caption-to-label flow`,async({page})=>{
 await page.goto('/playground.html');
 const fonts=await page.evaluate(async()=>{const {checkFontAvailability,fontAvailable}=await import('/src/engine/font-availability.js');for(const font of ['Arial','Arial Black'])await checkFontAvailability(font);return ['Arial','Arial Black'].every(fontAvailable);});
 test.skip(!fonts,'Native control requires installed Arial and Arial Black.');
 const actual=await page.evaluate(async({bytes,pageNumber})=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));
  const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
  try{
   const lines=editor.layout.lines.filter(l=>l.page===pageNumber-1);
   const captions=lines.filter(l=>l.fragments.map(f=>f.text||'').join('')==='Caption');
   const label=lines.find(l=>l.fragments.map(f=>f.text||'').join('')==='W:');
   return {readOnly:!!pkg.readOnly,captions:captions.length,delta:(label.baseline-captions.at(-1).baseline)*.75};
  }finally{editor.destroy();host.remove();for(const bitmap of images.values())bitmap.close();}
 },{bytes:[...source],pageNumber:native.page});
 expect(actual.readOnly).toBe(false);expect(actual.captions).toBe(4);
 expect(Math.abs(actual.delta-native.captionToLabelPt)).toBeLessThan(.12);
});
