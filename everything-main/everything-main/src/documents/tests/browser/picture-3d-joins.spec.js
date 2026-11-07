import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const source='tests/fixtures/picture-3d-joins/source.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/picture-3d-joins/reference.json','utf8'));
test('matches native picture joins and preserves neutral metadata through editing',async({page},info)=>{
 test.setTimeout(240000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^flat-absent/,{timeout:120000});await expect(input).toHaveJSProperty('readOnly',false);
 const original=await input.inputValue();await expect(page.locator('canvas.canvas-page')).toHaveCount(reference.cases.length);
 for(const [i,c]of reference.cases.entries()){
  const canvas=page.locator('canvas.canvas-page').nth(i);await canvas.scrollIntoViewIfNeeded();
  writeFileSync(info.outputPath(c.name+'.png'),Buffer.from(await canvas.evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  const values=await canvas.evaluate((canvas,samples)=>{const ctx=canvas.getContext('2d'),scale=canvas.width/612;return samples.map(s=>[...ctx.getImageData(Math.round(s.x*scale),Math.round(s.y*scale),1,1).data].slice(0,3));},c.samples);
  for(const [j,value]of values.entries())for(let k=0;k<3;k++)expect(Math.abs(value[k]-c.samples[j].rgb[k]),`${c.name} (${c.samples[j].x},${c.samples[j].y}) channel ${k}`).toBeLessThanOrEqual(8);
  const outline=await canvas.evaluate(canvas=>{
   const ratio=canvas.width/612,ctx=canvas.getContext('2d'),left=Math.floor(80*ratio),top=Math.floor(120*ratio),w=Math.ceil(180*ratio),h=Math.ceil(150*ratio),data=ctx.getImageData(left,top,w,h).data,points=[];
   const ink=(x,y)=>Math.min(...data.slice((y*w+x)*4,(y*w+x)*4+3))<240;
   for(let y=0;y<h;y++){let first=-1,last=-1;for(let x=0;x<w;x++)if(ink(x,y)){if(first<0)first=x;last=x;}if(first>=0)points.push([(left+first)/ratio,(top+y)/ratio],[(left+last+1)/ratio,(top+y)/ratio]);}
   for(let x=0;x<w;x++){let first=-1,last=-1;for(let y=0;y<h;y++)if(ink(x,y)){if(first<0)first=y;last=y;}if(first>=0)points.push([(left+x)/ratio,(top+first)/ratio],[(left+x)/ratio,(top+last+1)/ratio]);}
   return points;
  });
  for(const[from,to]of [[outline,c.outline],[c.outline,outline]])expect(Math.max(...from.map(([x,y])=>Math.min(...to.map(([a,b])=>Math.hypot(x-a,y-b))))),c.name+' silhouette').toBeLessThanOrEqual(1.25);
 }
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const parts=unzipSync(readFileSync(source));expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited'),out=unzipSync(readFileSync(edited));
 expectBodyEditParts(out,parts);
 expect(new TextDecoder().decode(out['word/document.xml']).match(/lineSketchStyleProps/g)).toHaveLength(4);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'Edited '+original,{timeout:120000});await expect(input).toHaveJSProperty('readOnly',false);expect(errors).toEqual([]);
});

test('keeps bilinear alpha rounding within the 3D surface color range',async({page})=>{
 await page.goto('/playground.html');
 const result=await page.evaluate(async()=>{
  const {decodePicture3d}=await import('/src/engine/canvas-picture-3d.js');
  const source=new OffscreenCanvas(3,5),ctx=source.getContext('2d');ctx.fillStyle='rgb(10,20,0)';ctx.fillRect(0,0,3,5);const image=await createImageBitmap(source);
  const asset={scene:{width:33.17*12700,height:21.93*12700,geometry:'rect',turn:0,perspective:false,depth:0,contour:0,contourColor:'FFFFFF',lighting:{rig:'threePt',direction:'t'},backingFill:{rgb:'D9D9D9',alpha:1},image:{assetId:'source',crop:{left:0,right:0,top:0,bottom:0}}}};
  try{const decoded=await decodePicture3d(asset,new Map([['source',image]]));const canvas=new OffscreenCanvas(decoded.bitmap.width,decoded.bitmap.height),out=canvas.getContext('2d');out.drawImage(decoded.bitmap,0,0);const pixel=[...out.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data];decoded.close();return pixel;}finally{image.close();}
 });
 expect(result[3]).toBe(255);expect(result[1]).toBeGreaterThan(result[0]);expect(result[0]).toBeGreaterThan(result[2]);
});
