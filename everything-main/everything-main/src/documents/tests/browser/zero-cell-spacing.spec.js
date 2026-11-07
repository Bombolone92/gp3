import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const source='tests/fixtures/zero-cell-spacing/source.docx';
const ref=JSON.parse(readFileSync('tests/fixtures/zero-cell-spacing/reference.json'));
test('renders zero and ignored spacing in nested tables and preserves declarations through edits',async({page},info)=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^omitted/);await expect(input).toHaveJSProperty('readOnly',false);const original=await input.inputValue();
 const check=async()=>{
  const canvases=page.locator('canvas.canvas-page');await expect(canvases).toHaveCount(ref.pages.length);
  for(const [i,p]of ref.pages.entries()){
   const canvas=canvases.nth(i);await canvas.scrollIntoViewIfNeeded();
   const actual=await canvas.evaluate(c=>{const ctx=c.getContext('2d'),data=ctx.getImageData(0,0,c.width,c.height).data,result={},scale=612/c.width;
    for(const color of ['C9E7B5','DDEEFF']){const rgb=[0,2,4].map(i=>parseInt(color.slice(i,i+2),16));let l=c.width,t=c.height,r=-1,b=-1;
     for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const at=(y*c.width+x)*4;if(rgb.every((v,k)=>Math.abs(v-data[at+k])<=1)){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x);b=Math.max(b,y);}}
     result[color]=[l,t,r+1,b+1].map(v=>v*scale);
    }return result;
   });
   writeFileSync(info.outputPath('geometry-'+i+'.json'),JSON.stringify(actual));
   for(const color of Object.keys(p.bounds))for(let j=0;j<4;j++)expect(Math.abs(actual[color][j]-p.bounds[color][j]),p.name+' '+color+' '+j).toBeLessThan(1);
  }
 };
 await check();
 const parts=unzipSync(readFileSync(source));const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const exact=path=>{const result=unzipSync(readFileSync(path));for(const n of Object.keys(parts))expect(Buffer.from(result[n]).equals(Buffer.from(parts[n])),n).toBe(true);};
 exact(await save('noedit'));
 await input.evaluate(el=>{const at=el.value.indexOf('Inner1');el.focus();el.setSelectionRange(at,at+6);el.dispatchEvent(new Event('select',{bubbles:true}));});await page.keyboard.insertText('Edited');const text=await input.inputValue(),edited=await save('edited');
 expectBodyEditParts(unzipSync(readFileSync(edited)),parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);exact(await save('undo'));
 await reopenDocx(page,input,edited,text);await expect(input).toHaveJSProperty('readOnly',false);await check();expect(errors).toEqual([]);
});
