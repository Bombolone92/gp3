import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
for(const name of ['wmf-vectors','wmf-standard'])test(`${name}: matches native polygons through editing, exact undo and export/reopen`, async ({ page }, info) => {
  const folder=`tests/fixtures/${name}/`,source=folder+'control.docx';
  const ref = JSON.parse(readFileSync(folder + 'reference.json'));
  for (const [name, hash] of [['control.docx', ref.sourceSha256], ['native.pdf', ref.pdfSha256]]) expect(createHash('sha256').update(readFileSync(folder + name)).digest('hex')).toBe(hash);
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Shape defaults controls/); await expect(input).toHaveJSProperty('readOnly', false);
  const check = async () => {
    await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
    const colors = await page.locator('canvas.canvas-page').evaluate((canvas, samples) => {
      const ctx = canvas.getContext('2d'), scale = canvas.width / 612;
      return samples.map(s => Array.from(ctx.getImageData(Math.round(s.x * scale), Math.round(s.y * scale), 1, 1).data).slice(0, 3));
    }, ref.samples);
    expect(colors).toEqual(ref.samples.map(s => s.color));
  };
  await check(); await page.locator('canvas.canvas-page').screenshot({path:info.outputPath('reference.png')});const original = await input.inputValue();
  const save = async name => { const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const path = info.outputPath(name + '.docx'); await (await event).saveAs(path); return path; };
  const originalParts = unzipSync(readFileSync(source)); expect(unzipSync(readFileSync(await save('noedit')))).toEqual(originalParts);
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited '); await check();
  const edited = await save('edited'), editedParts = unzipSync(readFileSync(edited));
  for (const name of Object.keys(originalParts)) if (name !== 'word/document.xml') expect(editedParts[name]).toEqual(originalParts[name]);
  await input.press('ControlOrMeta+z'); expect(unzipSync(readFileSync(await save('undo')))).toEqual(originalParts);
  await reopenDocx(page, input, edited, 'Edited ' + original); await check(); await expect(page.locator('#playground-error')).toBeEmpty();
});
