import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const root='tests/fixtures/section-fields/';
const references=JSON.parse(readFileSync(root+'reference.json','utf8'));
for(const reference of references)test(`${reference.name}: section-spanning nested fields match the native reference and remain editable`,async({page},info)=>{
 const source=readFileSync(root+reference.name+'.docx');
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 const measure=bytes=>page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
  const {bodyFieldRanges}=await import('/src/engine/body-fields.js');
  const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);const c=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(c,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return {pages:l.pageCount,markers:l.lines.filter(line=>line.marker).map(line=>line.marker.text),fields:bodyFieldRanges(p.paragraphs).map(r=>({type:r.field.type,start:r.start,end:r.end})),lines:l.lines.filter(line=>line.fragments.some(f=>f.text)).map(line=>({page:line.page,x:line.stops[0].x*.75,baseline:line.baseline*.75,text:line.fragments.map(f=>f.text).join('')}))};
 },[...bytes]);
 const actual=await measure(source);expect(actual.pages).toBe(reference.pages);expect(actual.fields).toHaveLength(reference.name==='boundaries'?5:2);
 if(reference.name==='boundaries')expect(actual.markers).toEqual(['1.','2.']);
 expect(actual.lines).toHaveLength(reference.lines.length);
 for(const ref of reference.lines){const line=actual.lines.find(l=>l.text.startsWith(ref.label));expect(line,ref.label).toBeTruthy();expect(line.page).toBe(ref.page);for(const key of ['x','baseline'])expect(Math.abs(line[key]-ref[key]),ref.label+' '+key).toBeLessThan(.2);}
 await page.getByLabel('Open DOCX file').setInputFiles(root+reference.name+'.docx');const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^C01 /);await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(reference.pages);
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 for(const[i,data]of(await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL()))).entries())writeFileSync(info.outputPath(`page-${i+1}.png`),Buffer.from(data.split(',')[1],'base64'));
 const original=await input.inputValue(),parts=unzipSync(source);
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 const at=original.indexOf(reference.name==='boundaries'?'C12 Numbered':'C19 Result')+5;
 await input.evaluate((e,at)=>{e.focus();e.setSelectionRange(at,at);e.dispatchEvent(new Event('select',{bubbles:true}));},at);await page.keyboard.insertText('X');
 const edited=await save('edited'),output=unzipSync(readFileSync(edited)),after=await measure(readFileSync(edited));
 expect(after.pages).toBe(reference.pages);expect(after.fields).toEqual(actual.fields.map(r=>({...r,start:r.start>=at?r.start+1:r.start,end:r.end>=at?r.end+1:r.end})));
 for(const[name,bytes]of Object.entries(parts))if(name!=='word/document.xml')expect(output[name]).toEqual(bytes);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,original.slice(0,at)+'X'+original.slice(at));await expect(input).toHaveJSProperty('readOnly',false);expect(errors).toEqual([]);
});
