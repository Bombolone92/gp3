import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';

test('authored mask controls decode with native interior alpha',async({page})=>{
  const folder='tests/fixtures/svg-masks/';
  const reference=JSON.parse(readFileSync(folder+'metafile-reference.json'));
  const source=readFileSync('public/fixtures/svg-masks.docx');
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  expect(hash(source)).toBe(reference.sourceSha256);
  expect(hash(readFileSync(folder+'native.emf'))).toBe(reference.nativeSha256);
  for(const image of reference.images)expect(hash(readFileSync(folder+image.path))).toBe(image.sha256);
  const svg=new TextDecoder().decode(unzipSync(source)['word/media/vector.svg']);
  await page.goto('/playground.html');
  const result=await page.evaluate(async source=>{
    const {decodeSvg}=await import('/src/engine/svg-images.js');
    const root=new DOMParser().parseFromString(source,'image/svg+xml').documentElement;
    const before=new XMLSerializer().serializeToString(root),children=document.body.children.length;
    const image=await decodeSvg(new TextEncoder().encode(source));
    try {
      const canvas=document.createElement('canvas');canvas.width=120;canvas.height=80;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
      return {samples:Array.from({length:6},(_,i)=>[20,60].map(y=>Array.from(ctx.getImageData(i*20+10,y,1,1).data))),
        unchanged:before===new XMLSerializer().serializeToString(root),clean:children===document.body.children.length};
    } finally {image.close();}
  },svg);
  expect(result.unchanged).toBe(true);expect(result.clean).toBe(true);
  for(let i=0;i<6;i++)for(const [j,y] of [20,60].entries()){
    const native=reference.images[i].middleColumn[y]||[0,0,0,0],actual=result.samples[i][j];
    expect(actual[3]).toBe(native[3]);
    // Canvas unpremultiplication may round RGB; compare displayed color.
    for(let c=0;c<3;c++)expect(Math.abs(actual[c]*actual[3]/255-native[c]*native[3]/255)).toBeLessThanOrEqual(1);
  }
});

test('translucent groups preserve child mask and filter effects',async({page})=>{
  await page.goto('/playground.html');
  const result=await page.evaluate(async()=>{
    const {decodeSvg}=await import('/src/engine/svg-images.js');
    const xml='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><defs><mask id="m"><rect width="50" height="40" fill="white"/></mask><filter id="f"><feColorMatrix type="matrix" color-interpolation-filters="sRGB" values="0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 1 0"/></filter></defs><g opacity=".5"><rect width="50" height="80" fill="red" mask="url(#m)"/><rect x="50" width="50" height="80" fill="red" filter="url(#f)"/></g></svg>';
    const image=await decodeSvg(new TextEncoder().encode(xml)),c=document.createElement('canvas');c.width=100;c.height=80;
    const ctx=c.getContext('2d');ctx.drawImage(image,0,0);image.close();
    return [[25,20],[25,60],[75,20]].map(([x,y])=>[...ctx.getImageData(x,y,1,1).data]);
  });
  expect(result[0]).toEqual([255,0,0,128]);expect(result[1][3]).toBe(0);expect(result[2]).toEqual([0,255,0,128]);
});

test('masked full, cropped, grouped and fill pictures survive editing, undo and reopen',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/svg-masks.docx');
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^SVG vector/);await expect(input).toHaveJSProperty('readOnly',false);
  const original=await input.inputValue(),parts=unzipSync(readFileSync('public/fixtures/svg-masks.docx'));
  const save=async(name,edited=false)=>{
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
    const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);
    const output=unzipSync(readFileSync(path));expect(Object.keys(output).sort()).toEqual(Object.keys(parts).sort());
    if(edited)expectBodyEditParts(output,parts);else for(const n of Object.keys(parts))expect(Buffer.from(output[n]).equals(Buffer.from(parts[n])),n).toBe(true);
    return path;
  };
  await save('noedit');await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const edited=await save('edited',true);await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await save('undo');
  await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);expect(errors).toEqual([]);
});
