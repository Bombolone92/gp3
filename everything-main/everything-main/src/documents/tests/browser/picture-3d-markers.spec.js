import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';

for(const folder of ['picture-3d-circle-outlines','picture-3d-texture-markers'])test.describe(folder,()=>{
 const root=`tests/fixtures/${folder}/`,ref=JSON.parse(readFileSync(root+'reference.json'));
 let page,context;
 test.beforeAll(async({browser})=>{
  test.setTimeout(180000);
  for(const [file,hash]of [['control.docx',ref.sourceSha256],['native.pdf',ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(hash);
  context=await browser.newContext({deviceScaleFactor:3});page=await context.newPage();
  await page.goto('/playground.html',{timeout:120000});
  const old=await page.getByRole('textbox',{name:'Document text'}).elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(root+'control.docx');
  await expect.poll(()=>old.evaluate(e=>e.isConnected),{timeout:120000}).toBe(false);
  await expect(page.getByRole('textbox',{name:'Document text'})).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(5);
 });
 test.afterAll(async()=>{await context?.close();});
 for(const [i,c]of ref.cases.entries())test(`native circular outline and texture ${c.name}`,async({},info)=>{
  const canvas=page.locator('canvas.canvas-page').nth(i);
  const measured=await canvas.evaluate(canvas=>{
   const ctx=canvas.getContext('2d'),s=canvas.width/612;
   if(s!==4)throw Error(`Expected four pixels per point, got ${s}`);
   const boundary=[];
   const {data,width,height}=ctx.getImageData(240,480,1032,872);
   const ink=(x,y)=>Math.min(...data.slice((y*width+x)*4,(y*width+x)*4+3))<240;
   for(let y=0;y<height;y++){let first=-1,last=-1;for(let x=0;x<width;x++)if(ink(x,y)){if(first<0)first=x;last=x;}if(first>=0)boundary.push([60+first/4,120+y/4],[60+(last+1)/4,120+y/4]);}
   for(let x=0;x<width;x++){let first=-1,last=-1;for(let y=0;y<height;y++)if(ink(x,y)){if(first<0)first=y;last=y;}if(first>=0)boundary.push([60+x/4,120+first/4],[60+x/4,120+(last+1)/4]);}
   const bands={};
   for(const axis of ['x','y']){
    const slice=axis==='y'?ctx.getImageData(756,640,1,556):ctx.getImageData(480,916,560,1),base=axis==='y'?160:120;
    bands[axis]={};
    for(const name of ['dark','bright']){
     const runs=[];let start=-1;
     for(let i=0;i<=slice.data.length/4;i++){
      const v=(slice.data[i*4]+slice.data[i*4+1]+slice.data[i*4+2])/3,inside=name==='dark'?v<110:v>160&&v<230;
      if(inside&&start<0)start=i;
      if(!inside&&start>=0){if(i-start>2)runs.push([base+start/4,base+i/4]);start=-1;}
     }
     bands[axis][name]=runs;
    }
   }
   return {boundary,bands};
  });
  const directed=(a,b)=>Math.max(...a.map(p=>Math.sqrt(Math.min(...b.map(q=>(p[0]-q[0])**2+(p[1]-q[1])**2)))));
  const error=Math.max(directed(measured.boundary,c.boundaryPt),directed(c.boundaryPt,measured.boundary));
  expect(error).toBeLessThanOrEqual(1.25); // Existing independent picture-outline acceptance bound.
  if(c.bandsPt)for(const axis of ['x','y'])for(const name of ['dark','bright']){
   expect(measured.bands[axis][name]).toHaveLength(1);
   for(let edge=0;edge<2;edge++)expect(Math.abs(measured.bands[axis][name][0][edge]-c.bandsPt[axis][name][0][edge])).toBeLessThanOrEqual(.5);
  }
  writeFileSync(info.outputPath('measurements.json'),JSON.stringify({silhouetteErrorPt:error,bands:measured.bands},null,2));
  writeFileSync(info.outputPath(c.name+'.png'),Buffer.from((await canvas.evaluate(c=>c.toDataURL())).split(',')[1],'base64'));
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
  try{await fresh.goto('/playground.html',{timeout:120000});await fresh.getByLabel('Open DOCX file').setInputFiles(edited.path);await expect(fresh.getByRole('textbox',{name:'Document text'})).toHaveValue('Edited '+text,{timeout:120000});await expect(fresh.locator('canvas.canvas-page')).toHaveCount(5);await expect(fresh.getByRole('textbox',{name:'Document text'})).toHaveJSProperty('readOnly',false);}finally{await fresh.close();}
 });
});
