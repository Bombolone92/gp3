import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {unzipSync} from 'fflate';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/picture-3d-left-outlines/';
const ref=JSON.parse(readFileSync(root+'native.json'));
let page,context;
test.beforeAll(async({browser})=>{
 test.setTimeout(180000);
 expect(createHash('sha256').update(readFileSync(root+'control.docx')).digest('hex')).toBe(ref.capture.sourceSha256);
 for(const c of ref.capture.captures)expect(createHash('sha256').update(gunzipSync(readFileSync(root+c.file+'.gz'))).digest('hex')).toBe(c.sha256);
 context=await browser.newContext({deviceScaleFactor:3});page=await context.newPage();
 await page.goto('/playground.html');
 const old=await page.getByRole('textbox',{name:'Document text'}).elementHandle();
 await page.getByLabel('Open DOCX file').setInputFiles(root+'control.docx');
 await expect.poll(()=>old.evaluate(e=>e.isConnected),{timeout:120000}).toBe(false);
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(10);
});
test.afterAll(async()=>{await context?.close();});
test('native gray wall interior colors survive the picture bitmap and page painter',async({},info)=>{
 const wall=JSON.parse(readFileSync(root+'wall-interior.json'));
 const colors=await page.locator('canvas.canvas-page').first().evaluate((canvas,samples)=>{
  const ctx=canvas.getContext('2d');
  return samples.map(([x,y])=>[...ctx.getImageData(Math.floor(x*4),Math.floor(y*4),1,1).data].slice(0,3));
 },wall.samples);
 const errors=colors.map((rgb,j)=>Math.max(...rgb.map((v,i)=>Math.abs(v-wall.samples[j][i+2]))));
 expect(Math.max(...errors)).toBeLessThanOrEqual(3);
 writeFileSync(info.outputPath('wall-colors.json'),JSON.stringify({samples:errors.length,maximum:Math.max(...errors),errors}));
});
test('paired outlines and extrusion preserve native outer silhouette',async({},info)=>{
 const results=[];
 for(const r of ref.measurements){
  const measured=await page.locator('canvas.canvas-page').nth(r.page-1).evaluate(canvas=>{
   if(canvas.width!==2448||canvas.height!==3168)throw Error('Unexpected raster scale');
   const {data,width,height}=canvas.getContext('2d').getImageData(240,480,1160,720),result={};
   for(const threshold of [200,240,250]){
    let left=width,top=height,right=-1,bottom=-1;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
     const i=(y*width+x)*4;
     if(Math.min(data[i],data[i+1],data[i+2])<threshold){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
    }
    result[threshold]=[60+left/4,120+top/4,60+(right+1)/4,120+(bottom+1)/4];
   }
   return result;
  });
  for(const threshold of [200,240,250])for(let j=0;j<4;j++)expect(Math.abs(measured[threshold][j]-r.thresholds[threshold].native[j])).toBeLessThanOrEqual(.5);
  results.push({page:r.page,measured});
 }
 writeFileSync(info.outputPath('outer-boundaries.json'),JSON.stringify(results,null,2));
});
 test('editing preserves all other parts, exact undo and fresh reopening',async({},info)=>{
  test.setTimeout(180000);
  const input=page.getByRole('textbox',{name:'Document text'}),text=await input.inputValue(),parts=unzipSync(readFileSync(root+'control.docx'));
  const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return {path,parts:unzipSync(readFileSync(path))};};
  expect((await save('noedit')).parts).toEqual(parts);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const edited=await save('edited');expect(edited.parts['word/document.xml']).not.toEqual(parts['word/document.xml']);
  expectBodyEditParts(edited.parts,parts);
  await input.press('ControlOrMeta+z');expect((await save('undo')).parts).toEqual(parts);
  const fresh=await page.context().newPage();
  try{await fresh.goto('/playground.html',{timeout:120000});await fresh.getByLabel('Open DOCX file').setInputFiles(edited.path);await expect(fresh.getByRole('textbox',{name:'Document text'})).toHaveValue('Edited '+text,{timeout:120000});await expect(fresh.locator('canvas.canvas-page')).toHaveCount(10);await expect(fresh.getByRole('textbox',{name:'Document text'})).toHaveJSProperty('readOnly',false);}finally{await fresh.close();}
 });
