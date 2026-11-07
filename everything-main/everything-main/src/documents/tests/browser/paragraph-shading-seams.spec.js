import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='public/fixtures/paragraph-shading-seams.docx';
const refs=JSON.parse(readFileSync('tests/fixtures/paragraph-shading-seams/reference.json'));
test('unites matching vertical border ink with shading without filling clipped or contrasting regions',async({page})=>{
 await page.goto('/playground.html');
 const results=await page.evaluate(async()=>{
  const {paintParagraphBackgrounds}=await import('/src/engine/canvas-paragraph-backgrounds.js');
  const {paintParagraphBorder}=await import('/src/engine/canvas-paragraph-borders.js');
  return [1,1.25,2,4].flatMap(scale=>['left','right'].flatMap(side=>[false,true].map(clipped=>{
   const c=document.createElement('canvas');c.width=80*scale;c.height=40*scale;const ctx=c.getContext('2d');ctx.scale(scale,scale);ctx.fillStyle='white';ctx.fillRect(0,0,80,40);
   const x=20.4/scale,width=4/scale;
   const r={x:side==='right'?0:x+width,y:0,width:side==='right'?x:30,height:30,color:'#224466'};
   const b={x,y:0,width,height:30,horizontal:false,side,border:{style:'single',color:'224466'},background:'#FFFFFF',...(clipped?{cellClip:{left:0,right:80,top:5,bottom:25}}:{})};
   const ink=paintParagraphBackgrounds(ctx,[r],[b]);paintParagraphBorder(ctx,b,ink.get(b));
   const seamX=Math.floor((side==='right'?x:x+width)*scale);
   const rgb=(px,py)=>[...ctx.getImageData(px,py,1,1).data].slice(0,3);
   return {seam:rgb(seamX,10*scale),outside:rgb(Math.floor((x+width/2)*scale),2*scale),clipped};
  })));
 });
 for(const result of results){expect(result.seam).toEqual([34,68,102]);expect(result.outside).toEqual(result.clipped?[255,255,255]:[34,68,102]);}
});
async function download(page,info,name){const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await event).saveAs(path);return path;}
test('reproduces the separate-fill coverage defect and paints its continuous material once',async({page})=>{
 await page.goto('/playground.html');
 const pixels=await page.evaluate(async()=>{
  const {paintParagraphBackgrounds}=await import('/src/engine/canvas-paragraph-backgrounds.js');
  const {paintParagraphBorder}=await import('/src/engine/canvas-paragraph-borders.js');
  const rectangles=[{x:0,y:0,width:20,height:10.25,color:'#224466'},{x:0,y:10.75,width:20,height:10.25,color:'#224466'}];
  const borders=[10.25,10.5].map(y=>({x:0,y,width:20,height:.25,horizontal:true,border:{style:'single',color:'224466'},background:'#FFFFFF'}));
  return [false,true].map(join=>{const c=document.createElement('canvas');c.width=20;c.height=24;const ctx=c.getContext('2d');ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,20,24);
   let painted=new Map();if(join)painted=paintParagraphBackgrounds(ctx,rectangles,borders);else for(const r of rectangles){ctx.fillStyle=r.color;ctx.fillRect(r.x,r.y,r.width,r.height);}
   for(const border of borders)paintParagraphBorder(ctx,border,painted.get(border));
   return [...ctx.getImageData(10,10,1,1).data].slice(0,3);
  });
 });
 expect(pixels[0]).not.toEqual([34,68,102]);expect(pixels[1]).toEqual([34,68,102]);
});
for(const scale of [1,1.25,2,4])test.describe('scale '+scale,()=>{
 test.use({deviceScaleFactor:scale});
 test('paints continuous native shading without seams and retains contrasting dividers',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^BodyJoined/);await expect(input).toBeEditable();
  await expect(page.locator('canvas.canvas-page')).toHaveCount(8);
  if(scale===4){
   // Independent native control: blue shading touches its 0.24pt border at
   // x=24.60pt and x=587.52pt. Both interior shared pixels are solid blue.
   const edges=await page.locator('canvas.canvas-page').first().evaluate(c=>{
    const s=c.width/612,ctx=c.getContext('2d');
    return [24.60,587.52].map(x=>[...ctx.getImageData(Math.floor(x*s),Math.floor(75*s),1,1).data].slice(0,3));
   });
   expect(edges).toEqual([[34,68,102],[34,68,102]]);
  }
  for(const [i,ref] of refs.pages.entries()){
   const canvas=page.locator('canvas.canvas-page').nth(i);
   await expect.poll(()=>canvas.evaluate((c,ref)=>{
    const s=c.width/612,ctx=c.getContext('2d'),values=[];
    for(let y=Math.ceil(ref.lines[1].baseline*s);y<Math.floor(ref.lines[3].baseline*s);y++)values.push([...ctx.getImageData(Math.floor(200*s),y,1,1).data].slice(0,3));
    if(!ref.lines[0].text.includes('Between'))return values.every(v=>v.join(',')==='34,68,102');
    return values.some(v=>v.join(',')==='204,51,0')&&values.some(v=>v.join(',')==='34,68,102');
   },ref),ref.lines[0].text).toBe(true);
  }
  const original=unzipSync(readFileSync(source));expect(unzipSync(readFileSync(await download(page,info,'unchanged.docx')))).toEqual(original);
  if(scale===1){
   const text=await input.inputValue();await input.evaluate(el=>{el.focus();el.setSelectionRange(0,0);el.dispatchEvent(new Event('select',{bubbles:true}));});await input.press('!');await expect(input).toHaveValue('!'+text);
   const saved=await download(page,info,'edited.docx'),parts=unzipSync(readFileSync(saved));for(const [name,data] of Object.entries(original))if(name!=='word/document.xml')expect(parts[name]).toEqual(data);
   await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(text);expect(unzipSync(readFileSync(await download(page,info,'undo.docx')))).toEqual(original);
   await reopenDocx(page,input,saved,'!'+text);
  }
  expect(errors).toEqual([]);
 });
});
