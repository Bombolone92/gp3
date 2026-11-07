import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const folder='tests/fixtures/autofit-picture-preferences/';
const ref=JSON.parse(readFileSync(folder+'reference.json','utf8'));
test('retains native AutoFit preference limits, picture clipping, editing and package preservation',async({page},info)=>{
 test.setTimeout(120000);
 const source=folder+'control.docx',bytes=readFileSync(source),parts=unzipSync(bytes),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');
 const geometry=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);
  const ctx=document.createElement('canvas').getContext('2d');
  const layout=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return layout.cells.map(c=>({left:c.x*.75,width:c.width*.75}));
 },[...bytes]);
 expect(geometry).toHaveLength(ref.cases.length);
 for(const [i,c]of ref.cases.entries()){
  expect(Math.abs(geometry[i].left-c.left)).toBeLessThan(.2);
  expect(Math.abs(geometry[i].width-c.width)).toBeLessThan(.2);
 }
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^auto width/, {timeout:45000});await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(8);await expect(page.locator('#playground-error')).toBeEmpty();
  const pixels=await page.locator('canvas.canvas-page').evaluateAll((canvases,refs)=>canvases.map((canvas,i)=>{
   const ctx=canvas.getContext('2d'),data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   const left=Math.floor((refs[i].left-2)*canvas.width/612),right=Math.ceil((refs[i].left+refs[i].width+2)*canvas.width/612);
   let inside=0,outside=0;
   for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
    const k=(y*canvas.width+x)*4,color=(data[k]<<16)|(data[k+1]<<8)|data[k+2];
    if(color===0x1e5ab4||color===0xf59623){if(x<left||x>=right)outside++;else inside++;}
   }
   return {visible:inside>100,outside};
  }),ref.cases);
  expect(pixels).toEqual(ref.cases.map(()=>({visible:true,outside:0})));
 };
 await check();
 for(let i=0;i<8;i++)writeFileSync(info.outputPath(`page-${i}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue();
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const equal=(path,edited=false)=>{const actual=unzipSync(readFileSync(path));if(edited)return expectBodyEditParts(actual,parts);expect(Object.keys(actual).sort()).toEqual(Object.keys(parts).sort());for(const name of Object.keys(parts))expect(Buffer.from(actual[name]).equals(Buffer.from(parts[name])),name).toBe(true);};
 equal(await save('noedit'));
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited');equal(edited,true);await check();
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);equal(await save('undo'));await check();
 await reopenDocx(page,input,edited,'Edited '+original);await check();expect(errors).toEqual([]);
});
