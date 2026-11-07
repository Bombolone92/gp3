import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/inline-soft-hyphens/';
async function measured(page,bytes){return page.evaluate(async data=>{
 const {DocxPackage}=await import('/src/engine/docx.js'),{validateCanvasLayout,measureCanvasText,setCanvasFontAlternatives}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
 const p=await DocxPackage.open(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));await validateCanvasLayout(p);const ctx=document.createElement('canvas').getContext('2d');setCanvasFontAlternatives(ctx,p.styles.fontAlternatives);
 return layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories,{styles:p.styles,drawingLayouts:p.drawingLayouts}).lines.flatMap(l=>{const fs=l.fragments.filter(f=>!f.image&&f.text.trim());return fs.length?[{page:l.page,text:fs.map(f=>f.text.replace(/\s/g,'')).join(''),x:fs[0].x*.75,y:l.baseline*.75}]:[]});
},bytes.toString('base64'));}
for(const config of [
 ...[14,15].map(mode=>({name:`inline tails, mode ${mode}`,source:root+`control${mode}.docx`,reference:root+`reference${mode}.json`,pdf:root+`native${mode}-verified.pdf`})),
 {name:'discretionary versus literal hyphen metrics',source:'tests/fixtures/discretionary-hyphen-metrics/control.docx',reference:'tests/fixtures/discretionary-hyphen-metrics/reference.json',pdf:'tests/fixtures/discretionary-hyphen-metrics/native.pdf'},
]){
 const {source}=config,bytes=readFileSync(source),ref=JSON.parse(readFileSync(config.reference)),pageCount=ref.pages.length;
 test(`${config.name} match the native reference and preserve editing`,async({page},info)=>{
  test.setTimeout(180000);
  const hash=b=>createHash('sha256').update(b).digest('hex');expect(hash(bytes)).toBe(ref.sourceSha256);expect(hash(readFileSync(config.pdf))).toBe(ref.pdfSha256);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toBeEditable();await expect(page.locator('canvas.canvas-page')).toHaveCount(pageCount);
  const compare=async data=>{
   const actual=await measured(page,data);
   for(let pi=0;pi<pageCount;pi++){
    const rows=actual.filter(l=>l.page===pi);expect(rows.map(r=>r.text)).toEqual(ref.pages[pi].map(r=>r.text));
    for(const [i,row]of rows.entries()){expect(Math.abs(row.x-ref.pages[pi][i].x)).toBeLessThan(.15);expect(Math.abs(row.y-ref.pages[pi][i].y),`${config.name}, page ${pi+1}, ${row.text}`).toBeLessThan(.15);}
   }
  };
  await compare(bytes);
  const original=await input.inputValue(),parts=unzipSync(bytes);
  const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.focus();await input.press('ControlOrMeta+End');await page.keyboard.insertText(' Added');const edited=await save('edited'),out=unzipSync(readFileSync(edited));expectBodyEditParts(out,parts);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);const undone=readFileSync(await save('undo'));expect(unzipSync(undone)).toEqual(parts);await compare(undone);
  await reopenDocx(page,input,edited,original+' Added');await expect(page.locator('canvas.canvas-page')).toHaveCount(pageCount);expect(errors).toEqual([]);
 });
}
