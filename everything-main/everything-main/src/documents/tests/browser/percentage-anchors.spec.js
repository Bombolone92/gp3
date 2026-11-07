import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const directory = 'tests/fixtures/percentage-anchors/';
const references = JSON.parse(readFileSync(directory + 'reference.json', 'utf8'));

test('header percentages use expanded writing bounds and paragraph origins', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(directory + 'header-exact.docx');
  const input = page.getByRole('textbox', {name:'Document text'});
  await expect(input).toHaveValue('Header percentage controls');
  await expect(input).toHaveJSProperty('readOnly',false);
  const boxes = await page.locator('canvas.canvas-page').evaluate(canvas => {
    const c=document.createElement('canvas'); c.width=768;c.height=960;
    const ctx=c.getContext('2d');ctx.drawImage(canvas,0,0,768,960);
    const data=ctx.getImageData(0,0,768,960).data,bands=[];
    for(let y=0;y<960;y++) {
      let left=768,right=-1;
      for(let x=0;x<768;x++) {const i=(y*768+x)*4;if(data[i]<60&&data[i+1]>50&&data[i+1]<120&&data[i+2]>150){left=Math.min(left,x);right=x;}}
      if(right>=0) {if(bands.length&&bands.at(-1)[3]===y-1)bands.at(-1)[3]=y;else bands.push([left,y,right,y]);}
    }
    return bands;
  });
  // Native reference PDF image frames: (288,180), (270,351), (270,472.5) pt.
  const expected=[[384,240,479,287],[360,468,455,515],[360,630,455,677]];
  expect(boxes).toHaveLength(3);
  boxes.forEach((box,i)=>box.forEach((v,j)=>expect(Math.abs(v-expected[i][j])).toBeLessThanOrEqual(1)));
});

for (const reference of references) test(`${reference.name}: paints native percentage positions and preserves edits`, async ({ page }, info) => {
  test.setTimeout(120000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html');
  const source = directory + reference.name + '.docx';
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Percentage 1:/, { timeout: 60000 });
  await expect(input).toHaveJSProperty('readOnly', false);
  const canvases = page.locator('canvas.canvas-page'); await expect(canvases).toHaveCount(14);
  for (let index = 0; index < 14; index++) {
    const canvas = canvases.nth(index);
    await canvas.scrollIntoViewIfNeeded();
    const expected = reference.pages[index];
    await expect.poll(async () => canvas.evaluate(canvas => {
      const c = document.createElement('canvas'); c.width = 768; c.height = 960;
      const ctx = c.getContext('2d'); ctx.drawImage(canvas, 0, 0, 768, 960);
      const pixels = ctx.getImageData(0, 0, 768, 960).data;
      let left = 768, top = 960, right = -1, bottom = -1;
      for (let y = 0; y < 960; y++) for (let x = 0; x < 768; x++) {
        const i = (y * 768 + x) * 4;
        if (pixels[i] < 60 && pixels[i+1] > 50 && pixels[i+1] < 120 && pixels[i+2] > 150) {
          left = Math.min(left,x); top = Math.min(top,y); right = Math.max(right,x); bottom = Math.max(bottom,y);
        }
      }
      return [left,top,right,bottom];
    }).then(box => {
      const native = [Math.max(0,expected.x*4/3), Math.max(0,expected.y*4/3), Math.min(768,(expected.x+expected.width)*4/3)-1, Math.min(960,(expected.y+expected.height)*4/3)-1];
      return Math.max(...box.map((value,i) => Math.abs(value-native[i])));
    }), { message: `page ${index+1} native image bounds` }).toBeLessThanOrEqual(1);
  }
  const original = await input.inputValue(), before = unzipSync(readFileSync(source));
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const save = async name => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(name + '.docx'); await (await pending).saveAs(path); return path;
  };
  const edited = await save('edited'), after = unzipSync(readFileSync(edited));
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  for (const part of Object.keys(before)) if (part !== 'word/document.xml') expect(Buffer.from(after[part]).equals(Buffer.from(before[part])), part).toBe(true);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  const undo = unzipSync(readFileSync(await save('undo')));
  for (const part of Object.keys(before)) expect(Buffer.from(undo[part]).equals(Buffer.from(before[part])), part).toBe(true);
  await reopenDocx(page, input, edited, 'Edited ' + original);
  expect(errors).toEqual([]);
});
