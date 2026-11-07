import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='public/fixtures/fixed-table-preference.docx',ref=JSON.parse(readFileSync('tests/fixtures/fixed-table-preference/reference.json'));
test('matches all native fixed-width conflicts and painted cell bounds through editing',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync('tests/fixtures/fixed-table-preference/native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveJSProperty('readOnly',false);await expect(input).toHaveValue(/^larger absolute/);
 const check=async bytes=>{
  const actual=await page.evaluate(async bytes=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
   const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
   return layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables).cells.map(c=>({left:c.x*.75,width:c.width*.75,top:c.y*.75,height:c.height*.75}));
  },[...bytes]);
  expect(actual).toHaveLength(ref.cells.length);
  ref.cells.forEach((c,i)=>{for(const k of ['left','width','top','height'])expect(Math.abs(actual[i][k]-c[k]),`cell ${i} ${k}`).toBeLessThan(.2);});
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const pixels=await page.locator('canvas.canvas-page').evaluate((canvas,cells)=>{const ctx=canvas.getContext('2d'),scale=canvas.width/612;return cells.map(c=>[c.left+2,c.left+c.width/2,c.left+c.width-2].map(x=>Array.from(ctx.getImageData(Math.round(x*scale),Math.round((c.top+c.height-3)*scale),1,1).data).slice(0,3)));},ref.cells);
  pixels.forEach((colors,i)=>expect(colors,`cell ${i} painted width`).toEqual(Array(3).fill(ref.cells[i].color)));
  return actual;
 };
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));writeFileSync(info.outputPath('actual.json'),JSON.stringify(await check(readFileSync(source)),null,2));
 writeFileSync(info.outputPath('page1.png'),Buffer.from((await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL())).split(',')[1],'base64'));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edit ');const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
 for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(parts[name]);
 await check(readFileSync(edited));await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'Edit '+original);await check(readFileSync(edited));await expect(page.locator('#playground-error')).toBeEmpty();expect(errors).toEqual([]);
});
