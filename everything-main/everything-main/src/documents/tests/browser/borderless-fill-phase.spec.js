import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';

const folder='tests/fixtures/borderless-fill-phase/',source=folder+'control.docx';
const reference=JSON.parse(readFileSync(folder+'reference.json'));
test.describe.configure({timeout:180000});
for(const observation of reference.observations)test(`borderless shading matches all native bounds at ${observation.zoom}%`,async({page},info)=>{
 await page.goto('/playground.html');
 const actual=await page.evaluate(async({bytes,o,nativePng})=>{
  if(devicePixelRatio!==1)throw Error('Native reference requires DPR 1');
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {pkg,images}=await openCanvasDocument(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));
  const host=document.createElement('div');document.body.append(host);const errors=[];
  const editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
  try{
   editor.setZoom(o.zoom/100);const before=JSON.stringify(editor.layout.cells);editor.paint();
   const measure=ctx=>o.rows.map(row=>{
    const [x,y,w,h]=row.region,d=ctx.getImageData(x,y,w,h).data;let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;
    for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
     const at=4*(yy*w+xx),red=d[at],green=d[at+1],blue=d[at+2];
     if(.299*red+.587*green+.114*blue<166&&(row.color==='FF0000'?red>128&&red>green+32&&red>blue+32:blue>128&&blue>red+32&&blue>green+32)){
      l=Math.min(l,x+xx);t=Math.min(t,y+yy);r=Math.max(r,x+xx+1);b=Math.max(b,y+yy+1);
     }
    }return[l,t,r,b];
   });
   const image=new Image();image.src='data:image/png;base64,'+nativePng;await image.decode();
   if(image.width!==o.cropSize[0]||image.height!==o.cropSize[1])throw Error('Unexpected native crop dimensions');
   const nativeCanvas=document.createElement('canvas');nativeCanvas.width=image.width;nativeCanvas.height=image.height;
   const nativeCtx=nativeCanvas.getContext('2d');nativeCtx.drawImage(image,0,0);
   return{bounds:measure(editor.canvases[0].getContext('2d')),native:measure(nativeCtx),errors,readOnly:!!pkg.readOnly,pages:editor.canvases.length,unchanged:before===JSON.stringify(editor.layout.cells),png:editor.canvases[0].toDataURL().split(',')[1]};
  }finally{editor.destroy();host.remove();}
 },{bytes:readFileSync(source).toString('base64'),o:observation,nativePng:readFileSync(folder+observation.crop).toString('base64')});
 expect(actual.errors).toEqual([]);expect(actual.readOnly).toBe(false);expect(actual.pages).toBe(1);expect(actual.unchanged).toBe(true);
 writeFileSync(info.outputPath('page.png'),Buffer.from(actual.png,'base64'));
 writeFileSync(info.outputPath('bounds.json'),JSON.stringify({zoom:observation.zoom,actual:actual.bounds,native:observation.rows.map(r=>r.bounds)},null,2));
 expect(actual.bounds).toEqual(observation.rows.map(r=>r.bounds));
 expect(actual.native).toEqual(observation.rows.map(r=>r.bounds));
});

test('borderless shading remains editable with exact no-edit and undo packages',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 const input=page.getByRole('textbox',{name:'Document text',exact:true}),prior=await input.elementHandle();
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 await expect.poll(()=>prior.evaluate(e=>e.isConnected),{timeout:60000}).toBe(false);
 await expect(input).toHaveJSProperty('readOnly',false);const text=await input.inputValue();
 const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const original=unzipSync(readFileSync(source));expect(unzipSync(readFileSync(await download('noedit.docx')))).toEqual(original);
 await input.focus();await input.press('ControlOrMeta+End');await page.keyboard.insertText('Shading edit.');await expect(input).toHaveValue(text+'Shading edit.');
 const edited=await download('edited.docx'),parts=unzipSync(readFileSync(edited));
 expect(Object.keys(parts).sort()).toEqual(Object.keys(original).sort());
 for(const key of Object.keys(original))if(key!=='word/document.xml')expect(parts[key]).toEqual(original[key]);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);
 expect(unzipSync(readFileSync(await download('undo.docx')))).toEqual(original);
 await reopenDocx(page,input,edited,text+'Shading edit.',{timeout:60000});expect(errors).toEqual([]);
});
