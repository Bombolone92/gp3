import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const root='tests/fixtures/floating-table-spacing/',source=root+'control.docx';
const refs=JSON.parse(readFileSync(root+'reference.json'));
test('matches all native floating-table spacing baselines with browser font metrics',async({page})=>{
 await page.goto('/playground.html');
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument,hitTest}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(Uint8Array.from(bytes));await loadCanvasFonts(p);
  const c=document.createElement('canvas').getContext('2d'),l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(c,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return {pages:l.pageCount,lines:l.lines.filter(l=>l.fragments.some(f=>f.text.trim())).map(line=>({page:line.page,text:line.fragments.map(f=>f.text).join('').replace(/\s/g,''),x:line.stops[0].x*.75,y:line.baseline*.75,start:line.start,hit:hitTest(l,line.page,line.stops[0].x+1,line.baseline-2)}))};
 },[...readFileSync(source)]);
 expect(actual.pages).toBe(50);
 for(const[page,lines]of refs.pages.entries())for(const ref of lines){const line=actual.lines.find(l=>l.page===page&&l.text===ref.text);expect(line,ref.text).toBeTruthy();expect(Math.abs(line.x-ref.x)).toBeLessThan(.15);expect(Math.abs(line.y-ref.y)).toBeLessThan(.15);expect(line.hit).toBe(line.start);}
});
test('keeps floating-table spacing editable through export, undo and reopening',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Case 1\nTable 1/);await expect(input).toBeEditable();await expect(page.locator('canvas.canvas-page')).toHaveCount(50);
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const exact=path=>{const actual=unzipSync(readFileSync(path));expect(Object.keys(actual).sort()).toEqual(Object.keys(parts).sort());for(const[n,b]of Object.entries(parts))expect(Buffer.from(actual[n]).equals(Buffer.from(b)),n).toBe(true);};
 exact(await save('noedit'));
 await input.evaluate(el=>{const at=el.value.indexOf('Anchor 36');el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select',{bubbles:true}));});await page.keyboard.insertText('Extra\n');
 const changed=original.replace('Anchor 36','Extra\nAnchor 36');await expect(input).toHaveValue(changed);const edited=await save('edited');
 const exported=unzipSync(readFileSync(edited));for(const[n,b]of Object.entries(parts))if(n!=='word/document.xml')expect(Buffer.from(exported[n]).equals(Buffer.from(b)),n).toBe(true);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);exact(await save('undo'));
 await reopenDocx(page,input,edited,changed);await expect(input).toBeEditable();await expect(page.locator('canvas.canvas-page')).toHaveCount(50);expect(errors).toEqual([]);
});
