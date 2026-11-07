import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const folder='tests/fixtures/inline-picture-extents/';
const source=readFileSync(folder+'control.docx');
const ref=JSON.parse(readFileSync(folder+'reference.json'));

test('matches native inline picture frame advances, baselines and paint centers',async({page},info)=>{
 await page.goto('/playground.html');
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js');
  const {pageGeometry}=await import('/src/engine/page-settings.js');
  const {inlineImagePaintFrame}=await import('/src/engine/images.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(p);
  const ctx=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return l.lines.filter(line=>line.fragments.some(f=>f.image)).map(line=>{
   const f=line.fragments.find(f=>f.image),frame=inlineImagePaintFrame(f.image,f.x,line.baseline-f.ascent);
   const stop=line.stops.find(s=>s.offset===f.end+1);
   return {page:line.page,right:stop.x*.75,y:line.baseline*.75,cx:(frame.x+frame.width/2)*.75,cy:(frame.y+frame.height/2)*.75};
  });
 },source.toString('base64'));
 writeFileSync(info.outputPath('positions.json'),JSON.stringify(actual,null,2));
 expect(actual).toHaveLength(24);
 for(const [i,o]of ref.observations.entries()){
  const a=actual[i],m=o.imageMatrix;
  expect(a.page).toBe(o.page);
  expect(Math.abs(a.right-o.right.x),`case ${i+1} advance`).toBeLessThan(.3);
  expect(Math.abs(a.y-o.left.y),`case ${i+1} baseline`).toBeLessThan(.3);
  expect(Math.abs(a.cx-(m[4]+(m[0]+m[2])/2)),`case ${i+1} center x`).toBeLessThan(.3);
  expect(Math.abs(a.cy-(792-m[5]-(m[1]+m[3])/2)),`case ${i+1} center y`).toBeLessThan(.3);
 }
});

test('paints native rotated pixels and preserves editing, undo and reopening',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(folder+'control.docx');
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Case 1/);await expect(input).toBeEditable();
 const original=await input.inputValue(),parts=unzipSync(source);
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(7);
  const samples=await page.evaluate(obs=>obs.map(o=>{
   const canvas=document.querySelectorAll('canvas.canvas-page')[o.page],ctx=canvas.getContext('2d'),scale=canvas.width/612;
   return o.samples.map(([x,y])=>Array.from(ctx.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data).slice(0,3));
  }),ref.observations);
  for(const [i,o]of ref.observations.entries())expect(samples[i],`case ${i+1} native pixels`).toEqual(o.samples.map(s=>s.slice(2)));
 };
 const save=async name=>{const next=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await next).saveAs(path);return path;};
 await check();expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+End');await page.keyboard.insertText(' edited');await check();const edited=await save('edited');
 const out=unzipSync(readFileSync(edited));expectBodyEditParts(out,parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,original+' edited');await check();expect(errors).toEqual([]);
});
