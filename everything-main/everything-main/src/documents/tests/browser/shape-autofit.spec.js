import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/shape-autofit/',refs=JSON.parse(readFileSync(root+'reference.json'));
for(const [name,ref]of Object.entries(refs.variants))test(`native shape autofit ${name}`,async({page},info)=>{
 test.setTimeout(120000);const source=root+name+'.docx';
 for(const [path,hash]of [[source,ref.sourceSha256],[root+name+'-native.pdf',ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(hash);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Case 1/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(12);
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
  const pkg=await DocxPackage.open(new Uint8Array(bytes)),before=JSON.stringify(pkg.paragraphs);await validateCanvasLayout(pkg);
  if(JSON.stringify(pkg.paragraphs)!==before)throw Error('Measured geometry mutated source paragraphs');
  const c=document.createElement('canvas').getContext('2d'),l=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(c,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables,undefined,{drawingLayouts:pkg.drawingLayouts});
  return l.pages.map((_,i)=>{
   const lines=l.lines.filter(l=>l.page===i),baselines={};let box;
   for(const line of lines){const text=line.fragments.map(f=>f.text).join('').trim();if(['Before','After'].includes(text))baselines[text]=line.baseline*.75;for(const f of line.fragments)if(f.image)box={x:f.x*.75,y:(line.baseline-f.ascent)*.75,width:f.image.width/12700,height:f.image.height/12700};}
   return {box,baselines};
  });
 },[...readFileSync(source)]);
 writeFileSync(info.outputPath('geometry.json'),JSON.stringify(actual,null,2));
 for(const [i,r]of ref.pages.entries()){
  for(const key of ['x','y','width','height'])expect(Math.abs(actual[i].box[key]-r.box[key]),`page ${i+1} box ${key}`).toBeLessThan(.2);
  for(const [label,y]of Object.entries(r.baselines))expect(Math.abs(actual[i].baselines[label]-y),`page ${i+1} ${label}`).toBeLessThan(.2);
 }
 for(const i of [0,3,6,9])writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async n=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(n+'.docx');await(await pending).saveAs(path);return path;};
 const same=(path,edited=false)=>{const out=unzipSync(readFileSync(path));expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());if(edited)expectBodyEditParts(out,parts);else for(const [n,b]of Object.entries(parts))expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 same(await save('noedit'));await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited');same(edited,true);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);same(await save('undo'));await reopenDocx(page,input,edited,'Edited '+original);expect(errors).toEqual([]);
});
