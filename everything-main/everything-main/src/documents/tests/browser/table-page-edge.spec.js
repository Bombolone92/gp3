import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
for(const suffix of ['','-legacy'])test(`matches native page-edge tables and clipping${suffix}`,async({page},info)=>{
 test.setTimeout(120000);
 const source=`public/fixtures/table-page-edge${suffix}.docx`,ref=JSON.parse(readFileSync(`tests/fixtures/table-page-edge/reference${suffix}.json`));
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(ref.sourceSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Page-edge tables/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async bytes=>{
  const actual=await page.evaluate(async bytes=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
   const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
   const layout=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
   return p.tables.filter(t=>t.rows[0].cells[0].fill==='#336699').map(t=>t.rows[0].cells.map(c=>{const b=layout.cells.find(b=>b.id===c.id);return{left:b.x*.75,width:b.width*.75};}));
  },[...bytes]);
  expect(actual).toHaveLength(9);
  ref.cases.forEach((c,i)=>c.cells.forEach((cell,j)=>{if(cell)for(const k of ['left','width'])expect(Math.abs(actual[i][j][k]-cell[k]),`case ${i+1} cell ${j+1} ${k}`).toBeLessThan(.2);}));
  await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(9);
  const colors=await page.evaluate(cases=>{
   const canvases=[...document.querySelectorAll('canvas.canvas-page')];return cases.map((c,i)=>{const canvas=canvases[i],ctx=canvas.getContext('2d'),scale=canvas.width/612;return c.samples.map(([x,y])=>Array.from(ctx.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data).slice(0,3));});
  },ref.cases);
  ref.cases.forEach((c,i)=>expect(colors[i],`case ${i+1} page clipping`).toEqual(c.samples.map(s=>s.slice(2))));
 };
 const original=await input.inputValue();await check(readFileSync(source));
 for(const i of [0,2,4,7])writeFileSync(info.outputPath(`page-edge${suffix}-${i+1}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 await input.evaluate(el=>{const at=el.value.indexOf('\nA',el.value.indexOf('Page-edge tables: fully left'))+1;el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select',{bubbles:true}));});
 await page.keyboard.insertText('Hidden cell edit ');const editedText=await input.inputValue();expect(editedText).toContain('Hidden cell edit A');
 const save=async label=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const p=info.outputPath(`page-edge${suffix}-${label}.docx`);await(await pending).saveAs(p);return p;};
 const edited=await save('edited');await check(readFileSync(edited));await input.press('ControlOrMeta+z');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
 expect(unzipSync(readFileSync(await save('undo')))).toEqual(unzipSync(readFileSync(source)));
 await reopenDocx(page,input,edited,editedText);await check(readFileSync(edited));
});
