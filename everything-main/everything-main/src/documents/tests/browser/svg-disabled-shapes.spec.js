import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {createHash} from 'node:crypto';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const source='public/fixtures/svg-disabled-shapes.docx',bytes=readFileSync(source);

test('non-rendering shapes cannot disable visible group corrections or change source drawings',async({page},info)=>{
 await page.goto('/playground.html');
 const folder='tests/fixtures/svg-disabled-shapes/',ref=JSON.parse(readFileSync(folder+'reference.json'));
 const hash=b=>createHash('sha256').update(b).digest('hex');
 expect(hash(bytes)).toBe(ref.sourceSha256);expect(hash(readFileSync(folder+'capture.emf'))).toBe(ref.captureSha256);
 const png=readFileSync(folder+'native-cached.png');expect(hash(png)).toBe(ref.pngSha256);
 const native=await page.evaluate(async({url,rows})=>{
  const image=new Image();image.src=url;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
  const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
  const samples=rows.map(({box:[x,y,r,b]})=>ctx.getImageData(x,y,r-x,b-y).data);
  return {size:[image.width,image.height],equal:samples.every(a=>a.every((v,i)=>v===samples[0][i])),ink:samples[0].some((v,i)=>i%4!==3&&v<255)};
 },{url:'data:image/png;base64,'+png.toString('base64'),rows:ref.rows});
 expect(native).toEqual({size:ref.size,equal:true,ink:true});
 const result=await page.evaluate(async bytes=>{
  const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
  const {svgInfo}=await import('/src/engine/svg-images.js');
  const b=new Uint8Array(bytes),root=new DOMParser().parseFromString(new TextDecoder().decode(b),'image/svg+xml').documentElement;
  const serialized=new XMLSerializer().serializeToString(root),children=document.body.children.length;
  const output=nativeSvgStrokes(root,svgInfo(b),true);
  return {images:[...output.querySelectorAll('image')].map(n=>({href:n.getAttribute('href'),size:[+n.getAttribute('width'),+n.getAttribute('height')],origin:[+n.getAttribute('x'),+n.getAttribute('y')]})),
   unchanged:serialized===new XMLSerializer().serializeToString(root),clean:children===document.body.children.length};
 },[...unzipSync(bytes)['word/media/vector.svg']]);
 expect(result.unchanged).toBe(true);expect(result.clean).toBe(true);expect(result.images).toHaveLength(4);
 for(const image of result.images)expect(image.href).toBe(result.images[0].href);
 writeFileSync(info.outputPath('layers.json'),JSON.stringify(result.images.map(({href,...geometry})=>geometry),null,2));
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^SVG vector pictures/);await expect(input).toHaveJSProperty('readOnly',false);
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return {path,parts:unzipSync(readFileSync(path))};};
 const original=unzipSync(bytes),text=await input.inputValue();expect((await save('noedit')).parts).toEqual(original);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const edited=await save('edited');expectBodyEditParts(edited.parts,original);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);expect((await save('undo')).parts).toEqual(original);
 await reopenDocx(page,input,edited.path,'Edited '+text);await expect(input).toHaveJSProperty('readOnly',false);
});

test('disabled geometry ignores unused strokes but a zero-length round-capped line still paints',async({page})=>{
 await page.goto('/playground.html');
 const result=await page.evaluate(async()=>{
  const {decodeSvg}=await import('/src/engine/svg-images.js');
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><g opacity=".8">'+
   '<rect width="0%" height="20" stroke="blue" stroke-width="40"/>'+
   '<circle r="0pt" stroke="blue" stroke-width="40"/>'+
   '<ellipse rx="0" ry="20" stroke="blue" stroke-width="40"/>'+
   '<line x1="40" y1="40" x2="40" y2="40" stroke="red" stroke-width="10" stroke-linecap="round"/></g></svg>';
  const image=await decodeSvg(new TextEncoder().encode(svg));
  try{const c=document.createElement('canvas');c.width=c.height=80;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
   const data=ctx.getImageData(0,0,80,80).data;let red=0,blue=0;
   for(let i=0;i<data.length;i+=4){if(!data[i+3])continue;red+=data[i]>data[i+2];blue+=data[i+2]>data[i];}
   return {red,blue};
  }finally{image.close();}
 });
 expect(result.red).toBeGreaterThan(40);expect(result.blue).toBe(0);
});
