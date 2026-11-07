import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const folder='tests/fixtures/svg-vector-opacity-precision/';

test('pending vector SVG precision with native byte fractions, CSS and paired shapes',async({page},info)=>{
 const ref=JSON.parse(readFileSync(folder+'reference.json'));
 for(const [file,hash] of Object.entries(ref.hashes))expect(createHash('sha256').update(readFileSync(folder+file)).digest('hex')).toBe(hash);
 const source=readFileSync(folder+'control.docx'),svg=new TextDecoder().decode(unzipSync(source)['word/media/vector.svg']);
 await page.goto('/playground.html');
 const result=await page.evaluate(async ({svg,refs})=>{
  const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
  const {decodeSvg}=await import('/src/engine/svg-images.js');
  const {nativeSvgFrame}=await import('/src/engine/svg-native-viewport.js');
  const root=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;
  const original=new XMLSerializer().serializeToString(root),count=document.body.children.length;
  const prepared=nativeSvgStrokes(root,{width:120,height:360},true);
  const frame=nativeSvgFrame(120,360),sx=120/frame.width,sy=360/frame.height;
  const image=await decodeSvg(new TextEncoder().encode(svg));
  const c=document.createElement('canvas');c.width=1200;c.height=3600;const ctx=c.getContext('2d');ctx.drawImage(image,0,0,1200,3600);image.close();
  const rows=[...prepared.querySelectorAll('rect,path')].map((node,i)=>{
   const x=(refs[i].sample[0]-frame.x)*sx;
   const y=(refs[i].sample[1]-frame.y)*sy;
   return {alpha:ctx.getImageData(Math.floor(x*10),Math.floor(y*10),1,1).data[3],fill:node.style.fill,opacity:node.style.opacity,fillOpacity:node.style.fillOpacity};
  });
  return {rows,unchanged:original===new XMLSerializer().serializeToString(root),clean:count===document.body.children.length};
 },{svg,refs:ref.rows});
 writeFileSync(info.outputPath('native-vector-colors.json'),JSON.stringify(result,null,2));
 expect(result.clean).toBe(true);expect(result.unchanged).toBe(true);
 expect(result.rows).toHaveLength(ref.rows.length);
 const previous=await page.getByRole('textbox',{name:'Document text'}).elementHandle();
 await page.getByLabel('Open DOCX file').setInputFiles(folder+'control.docx');
 await expect.poll(()=>previous.evaluate(e=>e.isConnected),{timeout:90000}).toBe(false);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveJSProperty('readOnly',false);
 const text=await input.inputValue(),before=unzipSync(source);
 const download=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
 const check=(path,edited)=>{const after=unzipSync(readFileSync(path));expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());if(edited)expectBodyEditParts(after,before);else for(const key of Object.keys(before))expect(Buffer.from(after[key]).equals(Buffer.from(before[key])),key).toBe(true);};
 check(await download('noedit'),false);await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 await expect(input).toHaveValue('Edited '+text);const edited=await download('edited');check(edited,true);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);check(await download('undo'),false);
 await reopenDocx(page,input,edited,'Edited '+text);await expect(page.locator('.canvas-message-error')).toHaveCount(0);
 test.fail(true,'Vector opacity precision differs from the native reference; alpha-only correction regresses overlapping corpus artwork.');
 expect(result.rows.map(r=>r.alpha)).toEqual(ref.rows.map(r=>r.alpha));
});
