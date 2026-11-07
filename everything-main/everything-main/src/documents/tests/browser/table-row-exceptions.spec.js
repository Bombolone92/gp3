import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';

const root='tests/fixtures/table-row-exceptions/',ref=JSON.parse(readFileSync(root+'reference.json'));
const colors=['D02020','208020','2040D0','9020A0','008090','D07000','B08000','E8B0B0','B0E8B0','B0D0E8','E8D0B0'];

test('matches native row exception borders, conditional shading, merges and page cuts through editing',async({page},info)=>{
 test.setTimeout(120000);
 for(const [name,hash] of [['controls.docx',ref.sourceSha256],['controls-native.pdf',ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+'controls.docx');
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^baseline/);await expect(input).toBeEditable();
 await expect(page.locator('canvas.canvas-page')).toHaveCount(18);
 const check=async()=>{
  const actual=await page.locator('canvas.canvas-page').evaluateAll((canvases,colors)=>canvases.map((canvas,index)=>{
   const {width,height}=canvas,data=canvas.getContext('2d').getImageData(0,0,width,height).data,out={};
   const bands=values=>{const result=[];for(let i=0;i<values.length;i++)if(values[i]){const start=i;while(values[i+1])i++;result.push([start*612/width,(i+1)*612/width]);}return result;};
   for(const color of index>=11&&index<=13?colors.slice(7):colors.slice(0,7)){
    const rgb=color.match(/../g).map(v=>parseInt(v,16)),channel=rgb.indexOf(Math.min(...rgb)),xs=new Uint8Array(width),ys=new Uint8Array(height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
     const at=4*(y*width+x),alpha=(255-data[at+channel])/(255-rgb[channel]);
     if(alpha>.25&&rgb.every((c,k)=>Math.abs(data[at+k]-(255-alpha*(255-c)))<3)){xs[x]=1;ys[y]=1;}
    }
    if(xs.some(Boolean))out[color]={x:bands(xs),y:bands(ys)};
   }
   return out;
  }),colors);
  writeFileSync(info.outputPath('observed-bands.json'),JSON.stringify(actual,null,2));
  for(const [i,expected] of ref.pages.entries()){
   expect(Object.keys(actual[i]).sort(),`page ${i+1} colors`).toEqual(Object.keys(expected).sort());
   for(const color of Object.keys(expected))for(const axis of ['x','y']){
    const a=actual[i][color][axis],b=expected[color][axis],label=`page ${i+1} ${color} ${axis}`;
    expect(a.length,label).toBe(b.length);
    for(let j=0;j<b.length;j++)for(let k=0;k<2;k++)expect(Math.abs(a[j][k]-b[j][k]),label).toBeLessThanOrEqual(1);
   }
  }
 };
 await check();
 const original=await input.inputValue(),parts=unzipSync(readFileSync(root+'controls.docx'));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const same=(path,edited=false)=>{const out=unzipSync(readFileSync(path));expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());if(edited)expectBodyEditParts(out,parts);else for(const [name,bytes] of Object.entries(parts))expect(Buffer.from(out[name]).equals(Buffer.from(bytes)),name).toBe(true);};
 same(await save('noedit'));await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const edited=await save('edited');same(edited,true);await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);same(await save('undo'));
 await reopenDocx(page,input,edited,'Edited '+original);await check();expect(errors).toEqual([]);
});
