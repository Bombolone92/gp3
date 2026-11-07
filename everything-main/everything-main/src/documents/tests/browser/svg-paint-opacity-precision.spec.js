import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';

for(const family of ['svg-paint-opacity-precision'])test(`${family}: native opacity precision and specified cascade`,async({page},info)=>{
 test.setTimeout(120000);
 const root=`tests/fixtures/${family}/`,hash=b=>createHash('sha256').update(b).digest('hex');
 const source=readFileSync(root+'control.docx'),ref=JSON.parse(readFileSync(root+'metafile-reference.json'));
 for(const [file,key] of [['control.docx','sourceSha256'],['cases.json','casesSha256'],['capture.emf','captureSha256'],['capture.json','captureMetadataSha256'],['native.emf','nativeSha256']])expect(hash(readFileSync(root+file)),file).toBe(ref[key]);
 for(const im of ref.images)expect(hash(readFileSync(root+im.path)),im.path).toBe(im.sha256);
 await page.goto('/playground.html');
 const result=await page.evaluate(async({svg,refs})=>{
  const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
  const original=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;
  const serialized=new XMLSerializer().serializeToString(original),children=document.body.children.length;
  const output=nativeSvgStrokes(original,{width:120,height:200},true);
  const pixels=async url=>{const im=new Image();im.src=url;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
  const rows=[];
  for(const [i,im] of [...output.querySelectorAll('image')].entries()){
   const a=await pixels(im.getAttribute('href')),n=await pixels(refs[i]);let changedAlpha=0,changedRgb=0;
   for(let at=0;at<a.length;at+=4){changedAlpha+=a[at+3]!==n[at+3];if(a[at+3]||n[at+3])changedRgb+=a[at]!==n[at]||a[at+1]!==n[at+1]||a[at+2]!==n[at+2];}
   rows.push({size:[+im.getAttribute('width'),+im.getAttribute('height')],origin:[+im.getAttribute('x'),+im.getAttribute('y')],length:a.length,nativeLength:n.length,changedAlpha,changedRgb});
  }
  return {rows,clean:children===document.body.children.length,unchanged:serialized===new XMLSerializer().serializeToString(original)};
 },{svg:new TextDecoder().decode(unzipSync(source)['word/media/vector.svg']),refs:ref.images.map(im=>'data:image/png;base64,'+readFileSync(root+im.path).toString('base64'))});
 writeFileSync(info.outputPath('native-comparison.json'),JSON.stringify(result,null,2));
 expect(result.clean).toBe(true);expect(result.unchanged).toBe(true);expect(result.rows).toHaveLength(ref.images.length);
 for(const [i,r] of result.rows.entries()){expect(r.size).toEqual(ref.images[i].size);expect(r.origin).toEqual(ref.images[i].transform.slice(4));expect(r.length).toBe(r.nativeLength);}
 expect(result.rows.filter(r=>r.changedAlpha||r.changedRgb)).toEqual([]);
 await editing(page,info,root+'control.docx');
});

async function editing(page,info,source){
 const previous=await page.getByRole('textbox',{name:'Document text'}).elementHandle();
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 await expect.poll(()=>previous.evaluate(e=>e.isConnected),{timeout:90000}).toBe(false);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveJSProperty('readOnly',false);
 const text=await input.inputValue(),before=unzipSync(readFileSync(source));
 const download=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
 const check=(path,edited)=>{const after=unzipSync(readFileSync(path));expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());if(edited)expectBodyEditParts(after,before);else for(const key of Object.keys(before))expect(Buffer.from(after[key]).equals(Buffer.from(before[key])),key).toBe(true);};
 check(await download('noedit'),false);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await expect(input).toHaveValue('Edited '+text);
 const edited=await download('edited');check(edited,true);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);check(await download('undo'),false);
 await reopenDocx(page,input,edited,'Edited '+text);
 await expect(page.locator('.canvas-message-error')).toHaveCount(0);
}
