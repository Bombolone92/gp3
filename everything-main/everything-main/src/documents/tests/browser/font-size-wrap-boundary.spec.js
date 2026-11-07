import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const root='tests/fixtures/font-size-wrap-boundary/',source=root+'control.docx';
test('matches native minimum widths at every tested font size',async({page})=>{
 const ref=JSON.parse(readFileSync(root+'native-width-thresholds.json','utf8').replace(/^\uFEFF/,''));
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(ref.sourceSha256);
 await page.goto('/playground.html');
 const widths=await page.evaluate(async sizes=>{
  const {prepareCanvasFont}=await import('/src/engine/font-availability.js');await prepareCanvasFont('Arial');
  const {measureCanvasText}=await import('/src/engine/canvas-text.js'),ctx=document.createElement('canvas').getContext('2d');
  return sizes.map(fontSize=>Math.ceil(measureCanvasText(ctx,'MMMM MMMM MMMM MMMM MMMM MMMM MMMM MMMM',{fontFamily:'Arial',fontSize,characterSpacing:1,kerning:0}).width*.75*20)/20);
 },ref.cases.map(c=>c.size));
 expect(widths).toEqual(ref.cases.map(c=>c.minWidth));
});
test('matches native fractional-size wrapping and retains editing and undo',async({page},info)=>{
 test.setTimeout(120000);
 const bytes=readFileSync(source),ref=JSON.parse(readFileSync(root+'reference.json'));
 for(const [n,hash] of Object.entries(ref.hashes))expect(createHash('sha256').update(readFileSync(root+n)).digest('hex')).toBe(hash);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^MMMM/);await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
 const rows=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await validateCanvasLayout(p);
  const ctx=document.createElement('canvas').getContext('2d'),l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories,{styles:p.styles});
  return l.lines.map(row=>({page:row.page,baseline:row.baseline*.75,x:row.fragments[0].x*.75,count:row.fragments.map(f=>f.text).join('').replaceAll(' ','').length}));
 },bytes.toString('base64'));
 const native=ref.cases.flatMap(c=>c.lines);expect(rows).toHaveLength(native.length);
 rows.forEach((row,i)=>{expect(row.count).toBe(native[i].origins.length);expect(row.page).toBe(native[i].page);expect(Math.abs(row.baseline-native[i].baseline)).toBeLessThan(.3);expect(Math.abs(row.x-native[i].origins[0])).toBeLessThan(.1);});
 const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited'),after=unzipSync(readFileSync(edited));
 for(const [n,b] of Object.entries(parts))if(n!=='word/document.xml')expect(after[n]).toEqual(b);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);
});
