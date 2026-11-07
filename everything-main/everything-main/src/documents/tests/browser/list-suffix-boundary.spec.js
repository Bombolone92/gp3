import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/list-suffix-boundary/',ref=JSON.parse(readFileSync(root+'reference.json'));
for(const name of ['control','nohang'])test(`matches numbering suffix boundaries and retains editing: ${name}`,async({page},info)=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');const source=root+name+'.docx';
 await page.getByLabel('Open DOCX file').setInputFiles(source);const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^ Text1/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 const lines=await page.evaluate(async bytes=>{const {DocxPackage}=await import('/src/engine/docx.js');const p=await DocxPackage.open(Uint8Array.from(bytes));const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');await loadCanvasFonts(p);const {layoutDocument,hitTest,caretRect}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');const c=document.createElement('canvas').getContext('2d'),l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(c,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);return l.lines.map(line=>{const caret=caretRect(l,line.start+1);return {text:line.fragments.map(f=>f.text).join('').trimStart(),x:line.stops[1].x*.75,y:line.baseline*.75,hit:hitTest(l,caret.page,caret.x+.1,caret.y+caret.height/2),start:line.start+1};});},[...readFileSync(source)]);
 for(const r of ref.lines[name]){const a=lines.find(l=>l.text===r.text);expect(a).toBeTruthy();expect(Math.abs(a.x-r.x),r.text+' X').toBeLessThan(.15);expect(Math.abs(a.y-r.y),r.text+' Y').toBeLessThan(.15);expect(a.hit).toBe(a.start);}
 const png=await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL());writeFileSync(info.outputPath('page.png'),Buffer.from(png.split(',')[1],'base64'));
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const check=(path,edited=false)=>{const out=unzipSync(readFileSync(path));if(edited)return expectBodyEditParts(out,parts);expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const[n,b]of Object.entries(parts))if(!edited||n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};check(await save('noedit'));
 await input.focus();await input.press('ControlOrMeta+End');await page.keyboard.insertText(' edited');const editedText=await input.inputValue(),path=await save('edited');check(path,true);await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);check(await save('undo'));await reopenDocx(page,input,path,editedText);await expect(input).toHaveJSProperty('readOnly',false);expect(errors).toEqual([]);
});
