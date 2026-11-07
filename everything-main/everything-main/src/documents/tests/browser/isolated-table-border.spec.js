import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const folder='tests/fixtures/isolated-table-border',file=`${folder}/isolated-table-border.docx`;
const ref=JSON.parse(readFileSync(`${folder}/reference.json`,'utf8'));
const bounds=rects=>[Math.min(...rects.map(r=>r[0])),Math.min(...rects.map(r=>r[1])),Math.max(...rects.map(r=>r[0]+r[2])),Math.max(...rects.map(r=>r[1]+r[3]))];
test('matches exposed bottom-border caps in body and header without extending top or internal edges',async({page},info)=>{
 test.setTimeout(120000);
 const bytes=readFileSync(file);
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(`${folder}/native.pdf`)).digest('hex')).toBe(ref.pdfSha256);
 await page.goto('/playground.html');
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{layoutPageStories}=await import('/src/engine/page-story-layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js'),{paintParagraphBorder}=await import('/src/engine/canvas-paragraph-borders.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d'),measure=(t,s)=>measureCanvasText(ctx,t,s);
  const l=layoutDocument(p.paragraphs,measure,pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories);
  const stories=layoutPageStories(l,p.pageStories,[p.pageSettings],measure,p.numbering,{styles:p.styles});
  return l.pages.map((_,page)=>{
   const boxes=[],paint={save(){},restore(){},fillRect(...r){boxes.push(r.map(v=>v*.75));}};
   for(const stroke of [...l.tableBorders,...stories.tableBorders].filter(s=>s.page===page&&!s.guide&&s.border.color==='20AA60'))paintParagraphBorder(paint,stroke);
   return boxes;
  });
 },bytes.toString('base64'));
 writeFileSync(info.outputPath('ink.json'),JSON.stringify(actual,null,2));
 expect(actual).toHaveLength(ref.cases.length);
 // Native PDF bounds are float32; allow 0.0001pt rounding at the 0.15pt ink tolerance.
 for(let i=0;i<actual.length;i++)for(const header of [true,false]){
  const a=bounds(actual[i].filter(r=>(r[1]<72)===header)),b=bounds(ref.cases[i].rectangles.filter(r=>(r[1]<72)===header));
  for(let edge=0;edge<4;edge++)expect(Math.abs(a[edge]-b[edge]),`page ${i+1} ${header?'header':'body'} edge ${edge}`).toBeLessThanOrEqual(.15 + 1e-4);
 }
 await page.getByLabel('Open DOCX file').setInputFiles(file);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Omitted layout empty/);await expect(input).toHaveJSProperty('readOnly',false);
 const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const next=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await next).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+End');await page.keyboard.insertText(' EDIT');const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
 expectBodyEditParts(changed,parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 const previous=await input.elementHandle();page.once('dialog',dialog=>dialog.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited);
 await page.waitForFunction(el=>!el.isConnected,previous,{timeout:60000});await previous.dispose();await expect(input).toHaveValue(original+' EDIT');
 await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.cases.length);await expect(page.locator('#playground-error')).toBeEmpty();
});
