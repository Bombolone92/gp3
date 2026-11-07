import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

for (const [filename,referenceName] of [['controls','native'],['grouped','grouped-native']]) {
const source = `tests/fixtures/nonrotating-picture-fill/${filename}.docx`;
const reference = JSON.parse(readFileSync(`tests/fixtures/nonrotating-picture-fill/${referenceName}.json`,'utf8'));

test(`${filename}: keeps stretched pictures upright within transformed shape clips and preserves editing`, async ({page},info) => {
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox',{name:'Document text'});
  const canvases = page.locator('canvas.canvas-page');
  await expect(input).toHaveValue(/^(Nonrotating fill:|Shape rotation controls)/);
  await expect(input).toBeEditable();
  await expect(page.locator('#playground-error')).toBeEmpty();
  await expect(canvases).toHaveCount(reference.pages.length);
  const original = await input.inputValue();
  for (let index=0; index<reference.pages.length; index++) {
    const canvas = canvases.nth(index);
    await canvas.scrollIntoViewIfNeeded();
    const compare = () => canvas.evaluate((el,{native,colors,width}) => {
      const ctx = el.getContext('2d'), scale = el.width/width;
      const pixels = ctx.getImageData(0,0,el.width,el.height).data;
      const colorAt = (x,y) => { const i = (Math.floor(y*scale)*el.width+Math.floor(x*scale))*4; return [...pixels.slice(i,i+3)]; };
      const failures = native.samples.filter(([x,y,color]) => colorAt(x,y).some((v,c) => Math.abs(v-colors[color][c])>2));
      return {count:failures.length,first:failures.slice(0,5)};
    },{native:reference.pages[index],colors:reference.colors,width:reference.pagePixels[0]});
    await expect.poll(compare, {message:`native color samples on page ${index+1}`}).toEqual({count:0,first:[]});
  }
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const download = page.waitForEvent('download');
  await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const saved = info.outputPath('nonrotating-picture-fill.docx');
  await (await download).saveAs(saved);
  const before = unzipSync(readFileSync(source)), after = unzipSync(readFileSync(saved));
  expectBodyEditParts(after,before);
  await page.getByRole('button',{name:'Undo',exact:true}).click(); await expect(input).toHaveValue(original);
  await reopenDocx(page,input,saved,'Edited '+original);
  await expect(input).toBeEditable(); await expect(canvases).toHaveCount(reference.pages.length);
});
}
