import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';

for(const fixture of ['toc-pageref','toc-pageref-formatting','toc-hyperlink-style']) test(`preserves native cached field rendering and original download: ${fixture}`,async({page},info)=>{
 const source=`public/fixtures/${fixture}.docx`,ref=JSON.parse(readFileSync(`tests/fixtures/${fixture}/reference.json`));
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(`tests/fixtures/${fixture}/native.pdf`)).digest('hex')).toBe(ref.pdfSha256);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const fill=CanvasRenderingContext2D.prototype.fillText;window.fieldPaint=[];CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...args){window.fieldPaint.push({text,font:this.font,color:this.fillStyle});return fill.call(this,text,x,y,...args);};});
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Nested table of contents control/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(4);
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{loadCanvasFonts,measureCanvasText,setCanvasFontAlternatives}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)),{bestEffort:true});await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');setCanvasFontAlternatives(ctx,p.styles.fontAlternatives);
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories,{bestEffort:true,styles:p.styles});
  return l.lines.map(l=>({page:l.page,baseline:l.baseline*.75,fragments:l.fragments.filter(f=>f.text.trim()).map(f=>({text:f.text,x:f.x*.75}))}));
 },readFileSync(source).toString('base64'));
 writeFileSync(info.outputPath('actual.json'),JSON.stringify(actual,null,2));
 for(let p=0;p<4;p++){
  const lines=actual.filter(l=>l.page===p),native=ref.pages[p];
  const plain=t=>t.replace(/[.\s]/g,'');expect(plain(lines.flatMap(l=>l.fragments.map(f=>f.text)).join(''))).toBe(plain(native.map(l=>l.text).join('')));
  for(const line of lines)for(const f of line.fragments){const text=f.text.trim(),n=native.filter(n=>n.text.includes(text)).sort((a,b)=>Math.abs(a.baseline-line.baseline)-Math.abs(b.baseline-line.baseline))[0];expect(n,text).toBeTruthy();expect(Math.abs(n.baseline-line.baseline),text+' baseline').toBeLessThan(.3);expect(Math.abs(n.glyphs[n.text.indexOf(text)]-f.x),text+' origin').toBeLessThan(.3);}
 }
 if(fixture.endsWith('formatting')){
  const paint=await page.evaluate(()=>window.fieldPaint);
  expect(paint.some(p=>p.text==='First topic'&&p.font.includes('Times New Roman')&&p.font.includes('italic')&&p.color==='#7030a0')).toBe(true);
  expect(paint.some(p=>p.text==='2'&&p.font.includes('Courier New')&&p.color==='#008040')).toBe(true);
 }
 if(fixture==='toc-hyperlink-style'){
  const paint=await page.evaluate(()=>window.fieldPaint);
  expect(paint.some(p=>p.text==='First topic'&&p.font.includes('Times New Roman')&&!p.font.includes('italic')&&p.color==='#000000')).toBe(true);
  expect(paint.some(p=>p.text==='First topic'&&p.font.includes('italic')&&p.color==='#2050c0')).toBe(true);
  expect(paint.some(p=>p.text==='Second topic'&&p.color==='#c02030')).toBe(true);
 }
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const saved=info.outputPath('noedit.docx');await(await pending).saveAs(saved);expect(unzipSync(readFileSync(saved))).toEqual(unzipSync(readFileSync(source)));
 for(const[i,data]of(await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL()))).entries())writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(data.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
