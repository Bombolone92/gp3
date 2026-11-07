import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const root='tests/fixtures/content-control-index-fields/';
test('invisible index entries match the native reference and survive adjacent typing and control unwrapping',async({page},info)=>{
 const source=readFileSync(root+'control.docx'),reference=JSON.parse(readFileSync(root+'reference.json','utf8'));
 const positions=JSON.parse(readFileSync(root+'native-positions.json','utf8'));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);const c=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(c,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return {pages:l.pageCount,lines:l.lines.map(line=>({x:line.stops[0].x*.75,baseline:line.baseline*.75,text:line.fragments.map(f=>f.text).join('')}))};
 },[...source]);
 expect(actual.pages).toBe(1);expect(actual.lines.map(l=>l.text)).toEqual(reference.visibleLines);
 actual.lines.forEach((line,i)=>{for(const key of ['x','baseline'])expect(Math.abs(line[key]-positions[i][key]),positions[i].label+' '+key).toBeLessThan(.2);});
 await page.getByLabel('Open DOCX file').setInputFiles(root+'control.docx');const input=page.getByRole('textbox',{name:'Document text'});
 const original=reference.visibleLines.join('\n');await expect(input).toHaveValue(original);await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(1);await page.locator('canvas.canvas-page').screenshot({path:info.outputPath('index-fields.png')});
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const parts=unzipSync(source);expect(unzipSync(readFileSync(await save('index-noedit')))).toEqual(parts);
 const at=original.indexOf('C02 outside LR')+'C02 outside L'.length;
 await input.evaluate((e,at)=>{e.focus();e.setSelectionRange(at,at);e.dispatchEvent(new Event('select',{bubbles:true}));},at);await page.keyboard.insertText('X');
 const edited=await save('index-edited'),output=unzipSync(readFileSync(edited));
 const details=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {bodyFieldRanges}=await import('/src/engine/body-fields.js');
  const p=await DocxPackage.open(new Uint8Array(bytes));return {fields:bodyFieldRanges(p.paragraphs).map(r=>({start:r.start,end:r.end})),control:p.paragraphs[1].runs.some(r=>r.contentControl)};
 },[...readFileSync(edited)]);
 expect(details.control).toBe(false);expect(details.fields).toHaveLength(8);expect(details.fields[1]).toEqual({start:at,end:at});
 for(const[name,bytes]of Object.entries(parts))if(name!=='word/document.xml')expect(output[name]).toEqual(bytes);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('index-undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,original.slice(0,at)+'X'+original.slice(at));await expect(input).toHaveJSProperty('readOnly',false);expect(errors).toEqual([]);
});
