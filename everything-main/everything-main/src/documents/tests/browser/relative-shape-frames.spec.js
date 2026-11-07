import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/relative-shape-frames/',ref=JSON.parse(readFileSync(root+'reference.json'));
test('resizes relative local frames before rotation while retaining physical text and pens',async({page},info)=>{
 test.setTimeout(120000);
 for(const[name,hash]of [['controls.docx',ref.sourceSha256],['controls-native.pdf',ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+'controls.docx');
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Relative shape 1/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(23);
 const check=async()=>{
  const actual=await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>{
   const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
   return [[0,160,96],[18,52,86]].map(color=>{
    let l=c.width,t=c.height,r=-1,b=-1;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const n=4*(y*c.width+x);if(color.every((v,k)=>Math.abs(v-data[n+k])<=2)){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x);b=Math.max(b,y);}}
    return [l,t,r+1,b+1].map(v=>v*612/c.width);
   });
  }));
  writeFileSync(info.outputPath('native-bounds.json'),JSON.stringify(actual,null,2));
  for(const[i,p]of ref.pages.entries()){
   for(let k=0;k<4;k++)expect(Math.abs(actual[i][0][k]-p.bounds[k]),`case ${i+1} shape bound ${k}`).toBeLessThanOrEqual(1);
   if(p.textBounds)for(let k=0;k<4;k++)expect(Math.abs(actual[i][1][k]-p.textBounds[k]),`case ${i+1} text bound ${k}`).toBeLessThanOrEqual(1);
  }
 };
 await check();
 for(const i of [1,3,11,16,18,19])writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue(),parts=unzipSync(readFileSync(root+'controls.docx'));
 const save=async name=>{const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await wait).saveAs(path);return path;};
 const same=(path,edited=false)=>{const out=unzipSync(readFileSync(path));expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());if(edited)expectBodyEditParts(out,parts);else for(const[n,b]of Object.entries(parts))expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 same(await save('noedit'));await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited');same(edited,true);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);same(await save('undo'));await reopenDocx(page,input,edited,'Edited '+original);await check();expect(errors).toEqual([]);
});

test('reuses stable rasters, releases replaced rasters and retains the current one after a resource rejection',async({page})=>{
 await page.goto('/playground.html');
 const result=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{decodeShape}=await import('/src/engine/canvas-shapes.js');
  const pkg=await DocxPackage.open(new Uint8Array(bytes)),asset=Object.values(pkg.assets).find(a=>a.scene),before=JSON.stringify(asset);
  let reject=false,rejected;
  const image=await decodeShape(asset,new Map(),undefined,(_,next)=>{if(reject){rejected=next;throw Error('Resource limit');}});
  try {
   const frame={x:0,y:0,width:240,height:320},first=image.forPage(undefined,frame),reused=image.forPage(undefined,frame)===first;
   const nextFrame={...frame,width:280},next=image.forPage(undefined,nextFrame),released=first.bitmap.width===0;
   reject=true;let error;try{image.forPage(undefined,{...frame,width:300});}catch(e){error=e.message;}
   return {reused,released,error,rejectedReleased:rejected.bitmap.width===0,retained:image.forPage(undefined,nextFrame)===next,unchanged:JSON.stringify(asset)===before};
  } finally {image.close();}
 },[...readFileSync(root+'controls.docx')]);
 expect(result).toEqual({reused:true,released:true,error:'Resource limit',rejectedReleased:true,retained:true,unchanged:true});
});
