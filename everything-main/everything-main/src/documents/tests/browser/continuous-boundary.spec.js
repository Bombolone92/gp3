import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
test.setTimeout(180000);
const root='tests/fixtures/continuous-boundary/',reference=JSON.parse(readFileSync(root+'native.json'));
const geometry=async(page,source)=>page.evaluate(async bytes=>{
 const {DocxPackage}=await import('/src/engine/docx.js'),{validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js');
 const {layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
 const p=await DocxPackage.open(new Uint8Array(bytes));await validateCanvasLayout(p);const ctx=document.createElement('canvas').getContext('2d');
 const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories);
 return {pages:l.pageCount,lines:l.lines.filter(l=>l.fragments.some(f=>f.text)).map(l=>({page:l.page,text:l.fragments.map(f=>f.text).join(''),x:l.fragments[0].x*.75,baseline:l.baseline*.75}))};
},[...source]);
test('all independent continuous boundary controls match native placement',async({page},info)=>{
 await page.goto('/playground.html');const rows=[];
 for(const c of reference.cases){
  const source=readFileSync(root+c.name+'.docx');expect(createHash('sha256').update(source).digest('hex')).toBe(c.sourceSha256);
  expect(createHash('sha256').update(readFileSync(root+c.name+'.pdf')).digest('hex')).toBe(c.pdfSha256);
  const actual=await geometry(page,source);expect(actual.pages,c.name).toBe(c.pages);expect(actual.lines).toHaveLength(c.lines.length);
  actual.lines.forEach((l,i)=>{const n=c.lines[i];expect(l.text).toBe(n.text);expect(l.page).toBe(n.page);expect(Math.abs(l.baseline-n.baseline),c.name+' '+l.text).toBeLessThan(reference.tolerancePt);expect(Math.abs(l.x-n.x)).toBeLessThan(reference.tolerancePt);});
  rows.push({name:c.name,...actual});
 }
 writeFileSync(info.outputPath('geometry.json'),JSON.stringify(rows,null,2));
});
const save=async(page,info,name)=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
for(const name of ['table-2-1-continuous-24','empty-section-24','table-decoration'])test('edits and exports retained continuous boundary: '+name,async({page},info)=>{
 const file=root+name+'.docx';await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(file);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^BEFORE\n/,{timeout:90000});await expect(input).toHaveJSProperty('readOnly',false);
 const text=await input.inputValue(),original=unzipSync(readFileSync(file));expect(unzipSync(readFileSync(await save(page,info,'noedit')))).toEqual(original);
 await input.focus();await input.press('ControlOrMeta+End');await page.keyboard.insertText(' edited');
 const editedText=await input.inputValue(),edited=await save(page,info,'edited'),parts=unzipSync(readFileSync(edited));
 for(const path of Object.keys(original))if(path!=='word/document.xml')expect(parts[path]).toEqual(original[path]);
 await input.press('ControlOrMeta+z');expect(await input.inputValue()).toBe(text);expect(unzipSync(readFileSync(await save(page,info,'undo')))).toEqual(original);
 await reopenDocx(page,input,edited,editedText,{timeout:90000});await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 await page.screenshot({path:info.outputPath('control.png'),fullPage:true});await expect(page.locator('.canvas-message-error')).toHaveCount(0);
});
const external=process.env.DOCX_SPACING_REVIEW_SOURCE;
test('original quarterly report retains editing, package parts and six-page rendering',async({page},info)=>{
 test.skip(!external||!existsSync(external),'Local report supplied through DOCX_SPACING_REVIEW_SOURCE.');
 await page.goto('/playground.html');const old=await page.getByRole('textbox',{name:'Document text'}).elementHandle();await page.getByLabel('Open DOCX file').setInputFiles(external);
 await expect.poll(()=>old.evaluate(e=>e.isConnected),{timeout:90000}).toBe(false);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(6);
 const text=await input.inputValue(),original=unzipSync(readFileSync(external));expect(unzipSync(readFileSync(await save(page,info,'report-noedit')))).toEqual(original);
 for(let i=0;i<6;i++){const c=page.locator('canvas.canvas-page').nth(i);await c.scrollIntoViewIfNeeded();writeFileSync(info.outputPath('report-page'+(i+1)+'.png'),Buffer.from(await c.evaluate(c=>c.toDataURL().split(',')[1]),'base64'));}
 await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Checked ');const editedText=await input.inputValue(),edited=await save(page,info,'report-edited'),parts=unzipSync(readFileSync(edited));
 for(const path of Object.keys(original))if(path!=='word/document.xml')expect(parts[path]).toEqual(original[path]);
 await input.press('ControlOrMeta+z');expect(await input.inputValue()).toBe(text);expect(unzipSync(readFileSync(await save(page,info,'report-undo')))).toEqual(original);
 await reopenDocx(page,input,edited,editedText,{timeout:90000});await expect(page.locator('canvas.canvas-page')).toHaveCount(6);await expect(page.locator('.canvas-message-error')).toHaveCount(0);
});
