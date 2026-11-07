import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';

test('large reused SVG text renders like collapsed whitespace and survives editing, export and undo', async ({page}, info) => {
  test.setTimeout(180000);
  const files=['control.docx','compact.docx'].map(name=>`tests/fixtures/svg-use-large-text/${name}`);
  const before=unzipSync(readFileSync(files[0]));
  const sources=files.map(file=>Buffer.from(unzipSync(readFileSync(file))['word/media/vector.svg']).toString('base64'));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html', {timeout:180000});
  const result=await page.evaluate(async sources=>{
    const {decodeSvg}=await import('/src/engine/svg-images.js');
    const count=document.body.children.length;
    const rasters=[];
    for(const source of sources) {
      const bytes=Uint8Array.from(atob(source),c=>c.charCodeAt(0));
      const original=bytes.slice(),image=await decodeSvg(bytes);
      const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,1200,800);image.close();
      if(!bytes.every((v,i)=>v===original[i])) throw new Error('SVG source mutated');
      rasters.push(ctx.getImageData(0,0,1200,800).data);
    }
    const first=rasters[0];let captionInk=0;
    for(let y=120;y<300;y++) for(let x=30;x<700;x++) if(first[(y*1200+x)*4+3]) captionInk++;
    return {equal:first.every((v,i)=>v===rasters[1][i]),captionInk,
      blue:[...first.slice((450*1200+200)*4,(450*1200+200)*4+4)],clean:count===document.body.children.length};
  },sources);
  expect(result.equal).toBe(true);
  expect(result.captionInk).toBeGreaterThan(100);
  // Canvas unpremultiplies the 0.8-opacity color with byte rounding.
  result.blue.forEach((v,i)=>expect(Math.abs(v-[32,96,192,204][i])).toBeLessThanOrEqual(1));
  expect(result.clean).toBe(true);
  await page.getByLabel('Open DOCX file').setInputFiles(files[0]);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^SVG vector pictures/);
  await expect(input).not.toHaveAttribute('readonly');
  const original=await input.inputValue();
  const save=async(suffix,edited)=>{
    const pending=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download .docx',exact:true}).click();
    const path=info.outputPath(`${suffix}.docx`);await(await pending).saveAs(path);
    const after=unzipSync(readFileSync(path));
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    if(edited) expectBodyEditParts(after,before); else for(const name of Object.keys(before))
      expect(Buffer.from(after[name]).equals(Buffer.from(before[name])),name).toBe(true);
    return path;
  };
  await save('noedit',false);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const edited=await save('edited',true);
  await reopenDocx(page,input,edited,'Edited '+original);
  // Reopen the original before testing undo, so the history belongs to this edit.
  await reopenDocx(page,input,files[0],original);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
  await save('undo',false);
  expect(errors).toEqual([]);
});
