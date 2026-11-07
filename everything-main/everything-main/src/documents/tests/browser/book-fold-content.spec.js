import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder='tests/fixtures/book-fold/';
const references=JSON.parse(readFileSync(folder+'content-reference.json','utf8'));
for(const reference of references)test('booklet content '+reference.name,async({page},info)=>{
 test.setTimeout(120000);const source=folder+reference.name+'.docx',errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(reference.name==='floating'?/^Body 1/:/Page 1 content/,{timeout:60000});await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(4);
 const placed=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js');
  const {layoutPageStories}=await import('/src/engine/page-story-layout.js');
  const {pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await validateCanvasLayout(p);
  const ctx=document.createElement('canvas').getContext('2d'),measure=(t,s)=>measureCanvasText(ctx,t,s);
  const body=layoutDocument(p.paragraphs,measure,pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories,{styles:p.styles,drawingLayouts:p.drawingLayouts});
  const stories=layoutPageStories(body,p.pageStories,[p.pageSettings],measure,p.numbering,{styles:p.styles,drawingLayouts:p.drawingLayouts});
  return {lines:[...body.lines,...stories.lines].map(l=>({page:l.page,y:l.baseline*.75,fragments:l.fragments.filter(f=>!f.image&&f.text.trim()).map(f=>({text:f.text,x:f.x*.75}))})),objects:body.floatingObjects.map(f=>({page:f.page,order:f.image.anchor.order,box:[f.x,f.y,f.x+f.width,f.y+f.height].map(v=>v*.75)}))};
 },readFileSync(source).toString('base64'));
 let checked=0;
 for(const line of placed.lines){
  if(!line.fragments.length)continue;
  const chars=reference.pages[line.page].chars.filter(c=>Math.abs(c.y-line.y)<.5).sort((a,b)=>a.x-b.x);
  const joined=chars.map(c=>c.text).join('');
  for(const fragment of line.fragments){
   const label=fragment.text.replace(/\s/g,'');let at=joined.indexOf(label),best=null;
   while(at>=0){if(!best||Math.abs(chars[at].x-fragment.x)<Math.abs(best.x-fragment.x))best=chars[at];at=joined.indexOf(label,at+1);}
   expect(best,`${reference.name} page ${line.page+1} ${label}`).not.toBeNull();
   expect(Math.abs(best.x-fragment.x),label).toBeLessThan(.3);checked++;
  }
 }
 expect(checked).toBeGreaterThan(reference.name==='floating'?10:70);
 expect(placed.objects).toHaveLength(reference.name==='floating'?0:12);
 for(const object of placed.objects){const name=['page','margin','wrapped'][(object.order-1)%3],box=reference.pages[object.page].rectangles[name];for(let i=0;i<4;i++)expect(Math.abs(object.box[i]-box[i]),name+' '+object.page).toBeLessThan(.6);}
 await page.getByRole('button',{name:'Download .docx',exact:true}).focus();
 for(let i=0;i<4;i++){const canvas=page.locator('canvas.canvas-page').nth(i);await canvas.scrollIntoViewIfNeeded();writeFileSync(info.outputPath('page'+(i+1)+'.png'),Buffer.from(await canvas.evaluate(c=>c.toDataURL().split(',')[1]),'base64'));}
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited'),out=unzipSync(readFileSync(edited));
 for(const[name,bytes]of Object.entries(parts))if(name!=='word/document.xml')expect(out[name]).toEqual(bytes);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);expect(errors).toEqual([]);
});
