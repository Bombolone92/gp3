import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

for (const fixture of ['drawing-luminance-precision', 'drawing-color-sequences']) test(`native DrawingML swatches survive editing: ${fixture}`, async ({ page }, info) => {
  const folder = `tests/fixtures/${fixture}/`, source = folder + 'source.docx';
  const bytes = readFileSync(source), original = unzipSync(bytes), ref = JSON.parse(readFileSync(folder + 'reference.json'));
  const hash = data => createHash('sha256').update(data).digest('hex');
  expect(hash(bytes)).toBe(ref.sourceSha256); expect(hash(readFileSync(folder + 'native.pdf'))).toBe(ref.pdfSha256);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^DrawingML luminance controls 1/);
  await expect(input).toHaveJSProperty('readOnly', false);
  const expected = ref.cases.map(c => c.rgb);
  const check = async () => {
    await expect(page.locator('canvas.canvas-page')).toHaveCount(3);
    await expect.poll(async () => page.locator('canvas.canvas-page').evaluateAll((canvases, cases) => cases.map(c => {
      const ctx = canvases[c.page].getContext('2d'), x = Math.round(c.x * 4 / 3), y = Math.round(c.y * 4 / 3);
      return [...ctx.getImageData(x, y, 1, 1).data].slice(0,3).map(v => v.toString(16).padStart(2,'0')).join('').toUpperCase();
    }), ref.cases)).toEqual(expected);
  };
  await check();
  const download = async name => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(name + '.docx'); await (await pending).saveAs(path); return path;
  };
  expect(unzipSync(readFileSync(await download('noedit')))).toEqual(original);
  const text = await input.inputValue();
  await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Test ');
  const editedText = await input.inputValue(), editedPath = await download('edited'), parts = unzipSync(readFileSync(editedPath));
  for (const name of Object.keys(original)) if (name !== 'word/document.xml') expect(parts[name]).toEqual(original[name]);
  await check(); await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(text);
  expect(unzipSync(readFileSync(await download('undo')))).toEqual(original); await check();
  page.once('dialog', d => d.accept()); await page.getByLabel('Open DOCX file').setInputFiles(editedPath);
  await expect(input).toHaveValue(editedText); await expect(input).toHaveJSProperty('readOnly', false); await check();
  expect(errors).toEqual([]);
});
