import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder = 'tests/fixtures/picture-surfaces/';
for (const [docx, pdf, json, title] of [
  ['backing.docx', 'backing.pdf', 'backing-reference.json', 'backing fills across alpha, crop, geometry, groups, outlines and 3D'],
  ['source.docx', 'native.pdf', 'reference.json', 'combined backing, shadow, lighting and bevel surfaces'],
]) {
const source = folder + docx, reference = JSON.parse(readFileSync(folder + json));
test(`matches native ${title}`, async ({ page }, info) => {
  test.setTimeout(120000);
  expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
  expect(createHash('sha256').update(readFileSync(folder + pdf)).digest('hex')).toBe(reference.pdfSha256);
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^baseline/, { timeout: 60000 }); await expect(input).toHaveJSProperty('readOnly', false);
  const check = async () => {
    await expect(page.locator('canvas.canvas-page')).toHaveCount(reference.pages.length);
    await expect(page.locator('#playground-error')).toBeEmpty();
    const colors = await page.locator('canvas.canvas-page').evaluateAll((canvases, ref) => canvases.map((canvas, i) => {
      const ctx = canvas.getContext('2d'), scale = canvas.width / ref.pages[i].size[0];
      return Object.fromEntries(Object.entries(ref.samplePixels).map(([key, [x,y]]) => [key, [...ctx.getImageData(Math.round(x*scale), Math.round(y*scale), 1, 1).data].slice(0,3)]));
    }), reference);
    reference.pages.forEach((r,i) => Object.entries(r.samples).forEach(([key,rgb]) => rgb.forEach((v,c) => {
      // Existing alpha/3D controls allow up to three levels for native raster and
      // canvas compositing/lighting rounding. This is not an edge tolerance.
      expect(Math.abs(colors[i][key][c] - v), `${r.name} ${key} channel ${c}`).toBeLessThanOrEqual(3);
    })));
  };
  await check();
  for (const [i,data] of (await page.locator('canvas.canvas-page').evaluateAll(cs => cs.map(c => c.toDataURL()))).entries()) writeFileSync(info.outputPath(`page${i+1}.png`), Buffer.from(data.split(',')[1], 'base64'));
  const save = async name => { const pending = page.waitForEvent('download'); await page.getByRole('button', {name:'Download .docx', exact:true}).click(); const path=info.outputPath(name+'.docx'); await(await pending).saveAs(path);return path; };
  const original = await input.inputValue(), before = unzipSync(readFileSync(source));
  await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edit ');
  const edited = await save('edited'); await check();
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  const undo = unzipSync(readFileSync(await save('undo'))); expect(Object.keys(undo).sort()).toEqual(Object.keys(before).sort());
  for(const name of Object.keys(before)) expect(Buffer.from(undo[name]).equals(Buffer.from(before[name])), name).toBe(true);
  await reopenDocx(page, input, edited, 'Edit '+original, { timeout: 60000 }); await expect(input).toHaveJSProperty('readOnly', false); await check();
});
}
