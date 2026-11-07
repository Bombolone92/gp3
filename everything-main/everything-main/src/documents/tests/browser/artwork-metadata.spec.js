import { openReadOnlyPreview } from './helpers/preview.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { showAllTools } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';
const source = 'public/fixtures/artwork-metadata.docx';
async function download(page, path) {
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); await (await pending).saveAs(path);
}
async function pixels(page) {
  return page.locator('canvas.canvas-page').first().evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = { teal: 0, pink: 0, blue: 0 };
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 36 && data[i + 1] === 168 && data[i + 2] === 144) counts.teal++;
      if (data[i] === 208 && data[i + 1] === 32 && data[i + 2] === 128) counts.pink++;
      if (data[i] === 32 && data[i + 1] === 80 && data[i + 2] === 192) counts.blue++;
    }
    return counts;
  });
}

for (const source of ['public/fixtures/artwork-metadata.docx', 'public/fixtures/drawing-creation-ids.docx', 'tests/fixtures/blip-creation-ids/control.docx']) test(`renders ${source}, edits surrounding text, and preserves original drawings through undo and export`, async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/playground.html'); await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Artwork metadata/); await expect(page.locator('#playground-error')).toBeEmpty();
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const original = await input.inputValue(), colors = await pixels(page);
  expect(colors.teal).toBeGreaterThan(5000); expect(colors.pink).toBeGreaterThan(200); expect(colors.blue).toBeGreaterThan(200);
  const canvas = await page.locator('canvas.canvas-page').evaluate(el => el.toDataURL());
  writeFileSync(info.outputPath('artwork-page.png'), Buffer.from(canvas.split(',')[1], 'base64'));
  await input.evaluate(el => { const at = el.value.indexOf('\ufffc'); el.focus(); el.setSelectionRange(at, at + 1); el.dispatchEvent(new Event('select')); });
  await input.press('Backspace'); await expect.poll(async () => (await pixels(page)).teal).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue(original);
  // Undo restores the object selection, whose tint intentionally changes pixels.
  await input.press('ControlOrMeta+Home');
  await expect.poll(async () => (await pixels(page)).teal).toBe(colors.teal);
  const unchanged = info.outputPath('artwork-unchanged.docx'); await download(page, unchanged);
  const before = unzipSync(readFileSync(source)), after = unzipSync(readFileSync(unchanged));
  for (const name of Object.keys(before)) expect(Buffer.from(after[name]).equals(Buffer.from(before[name])), name).toBe(true);
  // The plain-text clipboard must leave existing drawing identities intact.
  expect(await input.evaluate(el => {
    el.focus(); el.setSelectionRange(0, 'Artwork'.length); el.dispatchEvent(new Event('select'));
    const data = new DataTransfer(); el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
    return data.getData('text/plain');
  })).toBe('Artwork');
  await input.press('ControlOrMeta+Home');
  await input.evaluate(el => {
    const data = new DataTransfer(); data.setData('text/plain', 'Edited ');
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(input).toHaveValue('Edited ' + original);
  const exported = info.outputPath(source.split('/').at(-1)); await download(page, exported);
  await reopenDocx(page, input, exported, 'Edited ' + original);
  await expect.poll(async () => (await pixels(page)).teal).toBe(colors.teal); expect(errors).toEqual([]);
});

test('previews unsupported drawing metadata and theme styles', async ({ page }, info) => {
  await page.goto('/playground.html'); const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toBeVisible();
  const original = await input.inputValue();
  for (const [fixture, from, to, message] of [
    [source, '<adec:decorative', '<adec:decorative unsupported="1"', 'invalid decorative properties'],
    [source, '<a:effectRef idx="0"', '<a:effectRef idx="99"', 'missing theme effect style'],
    ['public/fixtures/drawing-creation-ids.docx', '<identity:creationId', '<identity:creationId unsupported="1"', 'invalid creation ID properties'],
  ]) {
    const parts = unzipSync(readFileSync(fixture)), xml = strFromU8(parts['word/document.xml']); expect(xml).toContain(from);
    parts['word/document.xml'] = strToU8(xml.replace(from, to));
    await openReadOnlyPreview(page, { name: 'unsupported.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });

  }
});


test('image creation IDs leave the existing artwork raster unchanged', async ({ page }) => {
  const rasters = [];
  await page.goto('/playground.html');
  for (const source of ['public/fixtures/drawing-creation-ids.docx', 'tests/fixtures/blip-creation-ids/control.docx']) {
    const previous = await page.getByRole('textbox', { name: 'Document text' }).elementHandle();
    await page.getByLabel('Open DOCX file').setInputFiles(source);
    await expect.poll(() => previous.evaluate(el => el.isConnected)).toBe(false);
    await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveJSProperty('readOnly', false);
    await page.getByRole('button', { name: 'Download .docx', exact: true }).focus();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    rasters.push(await page.locator('canvas.canvas-page').evaluateAll(cs => cs.map(c => c.toDataURL())));
  }
  expect(rasters[1]).toEqual(rasters[0]);
});
