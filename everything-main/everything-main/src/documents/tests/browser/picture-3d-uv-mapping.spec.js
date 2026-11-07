import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/picture-3d-uv-mapping/';
const ref=JSON.parse(readFileSync(root+'native/reference.json'));
let context,page;
const open=async(page,source,count)=>{
 await page.goto('/playground.html');
 const old=await page.getByRole('textbox',{name:'Document text'}).elementHandle();
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 await expect.poll(()=>old.evaluate(e=>e.isConnected),{timeout:120000}).toBe(false);
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(count);
};
test.beforeAll(async({browser})=>{
 test.setTimeout(180000);context=await browser.newContext({deviceScaleFactor:3});page=await context.newPage();
 await open(page,root+'control.docx',5);
});
test.afterAll(async()=>{await context?.close();});

for(const mode of ['default','half'])test(`native ${mode} playback confirms uniform fit and distinguishes opposed extents`,async()=>{
 const c=ref.cases.find(c=>c.kind==='projected');
 const hashes=await page.evaluate(async({root,images,roi})=>{
  const result=[];
  for(const i of images){
   const image=new Image();image.src='/'+root+'native/projected/'+i.file;await image.decode();
   if(image.width!==2448||image.height!==3168)throw Error('Unexpected native scale');
   const canvas=document.createElement('canvas');canvas.width=roi[2]-roi[0];canvas.height=roi[3]-roi[1];
   const ctx=canvas.getContext('2d');ctx.drawImage(image,-roi[0],-roi[1]);
   const bytes=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   const digest=await crypto.subtle.digest('SHA-256',bytes);
   result.push([...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join(''));
  }return result;
 },{root,images:c.images.filter(i=>i.mode===mode),roi:ref.regionPx});
 expect(hashes).toEqual(c.images.filter(i=>i.mode===mode).map(i=>i.regionRgbaSha256));
 expect(hashes[0]).toBe(hashes[1]);expect(hashes[0]).toBe(hashes[2]);expect(hashes[0]).not.toBe(hashes[3]);
});
test('browser texture fit is identical for small uniform differences and retains nonuniform geometry',async()=>{
 const hashes=await page.locator('canvas.canvas-page').evaluateAll(async(canvases,roi)=>{
  return await Promise.all(canvases.map(async canvas=>{
   if(canvas.width!==2448||canvas.height!==3168)throw Error('Unexpected browser scale');
   const bytes=canvas.getContext('2d').getImageData(roi[0],roi[1],roi[2]-roi[0],roi[3]-roi[1]).data;
   const digest=await crypto.subtle.digest('SHA-256',bytes);
   return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }));
 },ref.regionPx);
 expect(hashes[0]).toBe(hashes[1]);expect(hashes[0]).toBe(hashes[2]);expect(hashes[0]).not.toBe(hashes[3]);
});
for(const c of ref.cases)test(`${c.kind} controls remain editable with exact undo and a fresh reopened export`,async({},info)=>{
 test.setTimeout(180000);
 const p=await context.newPage(),count=c.kind==='projected'?5:1;
 try{
  await open(p,root+c.source,count);
  const input=p.getByRole('textbox',{name:'Document text'}),text=await input.inputValue(),parts=unzipSync(readFileSync(root+c.source));
  const save=async name=>{const event=p.waitForEvent('download');await p.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return {path,parts:unzipSync(readFileSync(path))};};
  expect((await save('noedit')).parts).toEqual(parts);
  await input.press('ControlOrMeta+Home');await p.keyboard.insertText('Edited ');
  const edited=await save('edited');expect(edited.parts['word/document.xml']).not.toEqual(parts['word/document.xml']);
  expectBodyEditParts(edited.parts,parts);
  await input.press('ControlOrMeta+z');expect((await save('undo')).parts).toEqual(parts);
  const fresh=await context.newPage();
  try{await open(fresh,edited.path,count);await expect(fresh.getByRole('textbox',{name:'Document text'})).toHaveValue('Edited '+text);}finally{await fresh.close();}
  writeFileSync(info.outputPath('roundtrip.json'),JSON.stringify({kind:c.kind,pages:count,untouchedPartsPreserved:true,exactUndo:true,freshReopen:true}));
 }finally{await p.close();}
});
