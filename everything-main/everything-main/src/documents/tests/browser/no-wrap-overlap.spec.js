import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const source='public/fixtures/no-wrap-overlap.docx';
const refs=JSON.parse(readFileSync('tests/fixtures/no-wrap-overlap/reference.json'));
async function bounds(canvas){return canvas.evaluate(el=>{
 const data=el.getContext('2d').getImageData(0,0,el.width,el.height).data,scale=el.width/612;
 return [[204,51,68],[34,85,170]].map(color=>{
  let left=Infinity,top=Infinity,right=-1,bottom=-1;
  for(let y=0;y<el.height;y++)for(let x=0;x<el.width;x++){
   const at=(y*el.width+x)*4;
   if(color.every((v,j)=>data[at+j]===v)){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  }
  return right<0?null:[left/scale,top/scale,(right-left+1)/scale,(bottom-top+1)/scale];
 });});}
test('paints native collision positions and preserves editable anchors through export and undo',async({page},info)=>{
 test.setTimeout(120000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'}),canvases=page.locator('canvas.canvas-page');
 await expect(input).toHaveValue(/^No-wrap overlap case 0/);await expect(canvases).toHaveCount(refs.length);
 const original=await input.inputValue();
 for(const ref of refs){
  const canvas=canvases.nth(ref.case);await canvas.scrollIntoViewIfNeeded();
  await expect.poll(async()=> (await bounds(canvas)).every(Boolean)).toBe(true);
  const actual=await bounds(canvas);
  ['red','blue'].forEach((color,i)=>actual[i].forEach((v,j)=>expect(Math.abs(v-ref.frames[color][j])).toBeLessThan(1.1)));
 }
 const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const unchanged=await download('unchanged.docx');expect(unzipSync(readFileSync(unchanged))).toEqual(unzipSync(readFileSync(source)));
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const edited=await download('edited.docx'),parts=unzipSync(readFileSync(edited)),originalParts=unzipSync(readFileSync(source));
 expectBodyEditParts(parts,originalParts);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);
 const undo=await download('undo.docx');expect(unzipSync(readFileSync(undo))).toEqual(originalParts);
 await reopenDocx(page,input,edited,'Edited '+original);await expect(canvases).toHaveCount(refs.length);
 await canvases.nth(1).scrollIntoViewIfNeeded();await expect.poll(async()=> (await bounds(canvases.nth(1)))[1]?.[0]).toBeGreaterThan(215);
 expect(errors).toEqual([]);
});
