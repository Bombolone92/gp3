import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
test.use({deviceScaleFactor:4});
const folder='tests/fixtures/source-sans-family/',source=folder+'control.docx';
const bytes=readFileSync(source),ref=JSON.parse(readFileSync(folder+'ink-reference.json'));
test('matches native ink for regular, bold, italic and Black exact-face styles',async({page},info)=>{
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(folder+'native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/\ufffc/);await expect(input).toHaveJSProperty('readOnly',false);
 const measured=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{measureCanvasText,loadCanvasFonts}=await import('/src/engine/canvas-text.js');
  const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
  return layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables).lines.filter(l=>l.fragments.some(f=>f.text?.startsWith('Measured typography'))).map(l=>l.baseline*.75);
 },[...bytes]);
 expect(measured).toHaveLength(8);
 const samples=ref.lines.map((l,i)=>({...l,dy:Math.round((measured[i]-l.baseline)*16/3)}));
 const ratios=await page.locator('canvas.canvas-page').evaluate((canvas,lines)=>{
  if(canvas.width!==3264||canvas.height!==4224)throw Error('Expected 384dpi canvas');
  const ctx=canvas.getContext('2d');return lines.map(l=>{const [x,y,r,b]=l.box,p=ctx.getImageData(x,y+l.dy,r-x,b-y).data;let ink=0;
   for(let i=0;i<p.length;i+=4)ink+=1-(p[i]+p[i+1]+p[i+2])/765;return ink/l.ink;});
 },samples);
 writeFileSync(info.outputPath('ink-ratios.json'),JSON.stringify(ratios,null,2));
 for(const [i,ratio] of ratios.entries()){expect(ratio,`style ${i}`).toBeGreaterThan(.95);expect(ratio,`style ${i}`).toBeLessThan(1.05);}
});
