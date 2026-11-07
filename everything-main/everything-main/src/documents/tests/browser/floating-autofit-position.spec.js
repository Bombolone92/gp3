import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/floating-autofit-position/',source=root+'control.docx',ref=JSON.parse(readFileSync(root+'origins.json'));
test('keeps floating AutoFit widths independent of position through editing and export',async({page},info)=>{
 test.setTimeout(180000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 const geometry=async bytes=>page.evaluate(async bytes=>{const {DocxPackage}=await import('/src/engine/docx.js');const p=await DocxPackage.open(Uint8Array.from(bytes));const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');await loadCanvasFonts(p);const {layoutDocument,hitTest,caretRect}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');const c=document.createElement('canvas').getContext('2d'),l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(c,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);return {pages:l.pageCount,lines:l.lines.map(line=>{const caret=caretRect(l,line.start);return {page:line.page,text:line.fragments.map(f=>f.text).join(''),x:line.stops[0].x*.75,y:line.baseline*.75,hit:hitTest(l,caret.page,caret.x+.1,caret.y+caret.height/2),start:line.start};})};},[...bytes]);
 await page.getByLabel('Open DOCX file').setInputFiles(source);const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Case 1/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(6);
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source)),initial=await geometry(readFileSync(source));expect(initial.pages).toBe(6);
 for(const[i,lines]of ref.entries())for(const r of lines){const a=initial.lines.find(l=>l.page===i&&l.text===r.text);expect(a).toBeTruthy();expect(Math.abs(a.x-r.x),`case ${i+1} ${r.text} X`).toBeLessThan(.15);expect(Math.abs(a.y-r.y),`case ${i+1} ${r.text} Y`).toBeLessThan(.15);if(/^[ABC]\d+$/.test(a.text))expect(a.hit).toBe(a.start);}
 writeFileSync(info.outputPath('geometry.json'),JSON.stringify(initial,null,2));
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
 const exact=path=>{const out=unzipSync(readFileSync(path));expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const[n,b]of Object.entries(parts))expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};exact(await save('noedit'));
 const at=original.lastIndexOf('Time: 2:00 PM');expect(at).toBeGreaterThan(0);await input.evaluate((el,at)=>{el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select'));},at);await page.keyboard.insertText('Extra\n');const editedText=await input.inputValue(),path=await save('edited');
 const updated=await geometry(readFileSync(path)),before=initial.lines.find(l=>l.page===5&&l.text==='Time: 2:00 PM'),after=updated.lines.find(l=>l.page===5&&l.text==='Time: 2:00 PM');expect(after.y-before.y).toBeCloseTo(12);expect(after.hit).toBe(after.start);
 const out=unzipSync(readFileSync(path));expectBodyEditParts(out,parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);exact(await save('undo'));await reopenDocx(page,input,path,editedText);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(6);expect(errors).toEqual([]);
});
