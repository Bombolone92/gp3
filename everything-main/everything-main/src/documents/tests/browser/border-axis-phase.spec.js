import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='tests/fixtures/border-axis-phase/control.docx';

for(const zoom of [100,200])test(`all 128 native ${zoom}% screen bounds reproduce from the archived PNG pixels`,async({page})=>{
 const folder='tests/fixtures/border-axis-phase/';
 const reference=JSON.parse(readFileSync(folder+(zoom===100?'screen-reference.json':'screen-reference-200.json')));
 await page.goto('/playground.html');
 for(const p of reference.observations){
  const bounds=await page.evaluate(async({png,rows,offset,size})=>{
   const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
   if(image.width!==size[0]||image.height!==size[1])throw new Error('Unexpected native crop size');
   const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
   const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
   return rows.map(({region:[x,y,w,h]})=>{
    const data=ctx.getImageData(x-offset[0],y-offset[1],w,h).data;
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++){
     const at=(dy*w+dx)*4;if(Math.max(data[at],data[at+1],data[at+2])>=128)continue;
     left=Math.min(left,x+dx);top=Math.min(top,y+dy);right=Math.max(right,x+dx+1);bottom=Math.max(bottom,y+dy+1);
    }
    return [left,top,right,bottom];
   });
  },{png:readFileSync(folder+p.crop).toString('base64'),rows:p.comparisons,offset:reference.cropOffset,size:reference.cropSize});
  expect(bounds).toEqual(p.comparisons.map(c=>c.native));
 }
});
test('independent phase controls remain editable on eight pages with unchanged packages through undo',async({page},info)=>{
 test.setTimeout(180000);await page.goto('/playground.html');
 const previous=await page.getByRole('textbox',{name:'Document text'}).elementHandle();
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 await expect.poll(()=>previous.evaluate(e=>e.isConnected),{timeout:90000}).toBe(false);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(8);
 const result=await page.evaluate(async bytes=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js'),{CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes)),host=document.createElement('div'),errors=[];
  document.body.append(host);let editor;
  try{
   editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));editor.paint();
   return {pages:editor.canvases.length,errors,cells:editor.layout.cells.map(({tableId,page,x,y,width,height})=>({tableId,page,x,y,width,height})),
    borders:editor.layout.tableBorders.filter(b=>!b.guide).map(({tableId,page,x,y,width,height,horizontal})=>({tableId,page,x,y,width,height,horizontal})),pngs:editor.canvases.map(c=>c.toDataURL().split(',')[1])};
  }finally{editor?.destroy();host.remove();}
 },[...readFileSync(source)]);
 expect(result.pages).toBe(8);expect(result.errors).toEqual([]);expect(result.cells).toHaveLength(128);
 for(const [i,png] of result.pngs.entries())writeFileSync(info.outputPath(`page-${i+1}.png`),Buffer.from(png,'base64'));
 delete result.pngs;writeFileSync(info.outputPath('layout.json'),JSON.stringify(result,null,2));
 const before=unzipSync(readFileSync(source)),text=await input.inputValue();
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(before);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const edited=await save('edited'),after=unzipSync(readFileSync(edited));
 for(const [name,data] of Object.entries(before))if(name!=='word/document.xml')expect(after[name]).toEqual(data);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);expect(unzipSync(readFileSync(await save('undo')))).toEqual(before);
 await reopenDocx(page,input,edited,'Edited '+text);await expect(page.locator('canvas.canvas-page')).toHaveCount(8);
 await expect(page.locator('.canvas-message-error')).toHaveCount(0);
});
