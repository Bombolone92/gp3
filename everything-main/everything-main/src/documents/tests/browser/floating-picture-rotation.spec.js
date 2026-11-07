import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder = 'tests/fixtures/floating-picture-rotation/', source = folder + 'control.docx';
const ref = JSON.parse(readFileSync(folder + 'reference.json'));
test.use({ deviceScaleFactor: 3, viewport: { width: 1400, height: 1400 } });
test('matches native floating picture rotation, crop and flips through editing and reopening', async ({ page }, info) => {
  test.setTimeout(120000);
  for (const [name, hash] of [['control.docx', ref.sourceSha256], ['native.pdf', ref.pdfSha256]]) expect(createHash('sha256').update(readFileSync(folder + name)).digest('hex')).toBe(hash);
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Floating rotation controls/); await expect(input).toHaveJSProperty('readOnly', false);
  const check = async () => {
    await expect(page.locator('canvas.canvas-page')).toHaveCount(3);
    const actual = await page.evaluate(cases => {
      const canvases = [...document.querySelectorAll('canvas.canvas-page')];
      return cases.map(c => {
        const canvas = canvases[c.page], ctx = canvas.getContext('2d'), scale = canvas.width / 612;
        const colors = c.samples.map(([x, y]) => Array.from(ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data).slice(0, 3));
        const [l, t, r, b] = c.region, x0 = Math.round(l * scale), y0 = Math.round(t * scale), w = Math.round((r-l) * scale), h = Math.round((b-t) * scale);
        const pixels = ctx.getImageData(x0, y0, w, h).data; let left=w, top=h, right=0, bottom=0;
        for (let y=0; y<h; y++) for (let x=0; x<w; x++) {
          const n=4*(y*w+x), rgb=[pixels[n],pixels[n+1],pixels[n+2]];
          if (Math.max(...rgb)-Math.min(...rgb)>50) { left=Math.min(left,x); top=Math.min(top,y); right=Math.max(right,x+1); bottom=Math.max(bottom,y+1); }
        }
        return { colors, bounds: [(x0+left)/scale,(y0+top)/scale,(x0+right)/scale,(y0+bottom)/scale] };
      });
    }, ref.cases);
    for (const [i,c] of ref.cases.entries()) {
      const differences = actual[i].colors.flatMap((rgb,j) => rgb.map((v,k) => Math.abs(v-c.samples[j][k+2])));
      const mismatches = actual[i].colors.flatMap((rgb,j) => rgb.some((v,k)=>Math.abs(v-c.samples[j][k+2])>(i===15 ? 1 : 0)) ? [{sample:c.samples[j],actual:rgb}] : []);
      expect(Math.max(...differences), `case ${i+1} native pixels ${JSON.stringify(mismatches.slice(0,8))}`).toBeLessThanOrEqual(i===15 ? 1 : 0);
      c.bounds.forEach((v,j) => expect(Math.abs(actual[i].bounds[j]-v), `case ${i+1} bound ${j}`).toBeLessThan(1));
    }
  };
  await check(); const original = await input.inputValue();
  const save = async name => { const event=page.waitForEvent('download'); await page.getByRole('button',{name:'Download .docx',exact:true}).click(); const path=info.outputPath(name+'.docx'); await(await event).saveAs(path); return path; };
  const parts=unzipSync(readFileSync(source)); expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited '); await check();
  const edited=await save('edited'), out=unzipSync(readFileSync(edited)); for(const n of Object.keys(parts)) if(n!=='word/document.xml') expect(out[n]).toEqual(parts[n]);
  await input.press('ControlOrMeta+z'); expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,'Edited '+original); await check(); await expect(page.locator('#playground-error')).toBeEmpty();
});
test('clicks a quarter-turned picture outside its unrotated frame', async ({page}) => {
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'}); await expect(input).toHaveValue(/^Floating rotation controls/);
  const text=await input.inputValue(), at=[...text.matchAll(/\ufffc/g)][4].index;
  const canvas=page.locator('canvas.canvas-page').first(); await canvas.scrollIntoViewIfNeeded();
  const box=await canvas.boundingBox(); await page.mouse.click(box.x+160*box.width/612,box.y+635*box.width/612);
  await expect(input).toHaveJSProperty('selectionStart',at); await expect(input).toHaveJSProperty('selectionEnd',at+1);
});
