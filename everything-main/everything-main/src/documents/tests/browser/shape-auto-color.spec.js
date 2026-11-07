import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/shape-auto-color/',refs=JSON.parse(readFileSync(root+'reference.json'));
test('shape automatic and explicit colors match the native reference before and after body edits and reopen',async({page},info)=>{
 test.setTimeout(180000);const source=root+'control.docx',parts=unzipSync(readFileSync(source)),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Case 1/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(36);
  for(const ref of refs.cases){
   const result=await page.locator('canvas.canvas-page').nth(ref.case-1).evaluate(async(c,{png,crop,foreground,background})=>{
    const im=new Image();im.src='data:image/png;base64,'+png;await im.decode();const w=im.width,h=im.height;
    const native=document.createElement('canvas');native.width=w;native.height=h;native.getContext('2d').drawImage(im,0,0);
    const a=c.getContext('2d').getImageData(crop[0],crop[1],w,h).data,b=native.getContext('2d').getImageData(0,0,w,h).data;
    const fg=foreground.match(/../g).map(v=>parseInt(v,16)),bg=background.match(/../g).map(v=>parseInt(v,16));
    if(foreground===background)return [a.filter((v,i)=>i%4<3&&Math.abs(v-bg[i%4])>40).length,0];
    const distance=Math.max(...fg.map((v,k)=>Math.abs(v-bg[k])));
    const mask=(data,fraction)=>{const out=new Uint8Array(w*h);for(let i=0;i<out.length;i++)out[i]=Math.max(...fg.map((v,k)=>Math.abs(data[i*4+k]-v)))<distance*fraction?1:0;return out;};
    const compare=(from,to)=>{let miss=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!from[i])continue;let found=false;for(let dy=-2;dy<=2&&!found;dy++)for(let dx=-2;dx<=2;dx++){if(x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)continue;if(to[(y+dy)*w+x+dx]){found=true;break;}}if(!found)miss++;}return miss;};return [compare(mask(a,.35),mask(b,.85)),compare(mask(b,.35),mask(a,.85))];
   },{png:readFileSync(root+`native-crop${ref.case}.png`).toString('base64'),crop:ref.crop,foreground:ref.nativeColor,background:ref.fill});
   expect(result,`case ${ref.case}`).toEqual([0,0]);
  }
 };
 await check();const original=await input.inputValue();
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
 const exact=path=>{const out=unzipSync(readFileSync(path));expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const[n,b]of Object.entries(parts))expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 exact(await save('noedit'));await input.evaluate(el=>{el.focus();el.setSelectionRange(0,0);el.dispatchEvent(new Event('select'));});await page.keyboard.insertText('Edited ');
 const edited=await input.inputValue(),path=await save('edited');await check();expectBodyEditParts(unzipSync(readFileSync(path)),parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);exact(await save('undo'));await reopenDocx(page,input,path,edited);await check();expect(errors).toEqual([]);
});
