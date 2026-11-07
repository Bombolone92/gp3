import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

test.use({ deviceScaleFactor: 3 });
test('preserves regenerated sketch geometry through text editing, undo and reopen', async ({ page }, info) => {
  test.setTimeout(90000);
  const source = 'public/fixtures/picture-sketch-outlines.docx', errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Picture geometry controls/, { timeout: 45000 });
  await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  // Samples independently checked against picture-sketch-outlines/native.pdf
  // at 216 dpi: the regenerated contour and texture replace the stale cache.
  const check = async () => {
    await expect.poll(() => page.locator('canvas.canvas-page').evaluate(c => {
      const ctx = c.getContext('2d'), scale = c.width / 612;
      return [[321,540],[330,550],[365,545],[430,560]].map(([x,y]) =>
        Array.from(ctx.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data).slice(0,3));
    })).toEqual([[255,255,255],[224,32,48],[224,32,48],[224,176,32]]);
    await expect(page.locator('#playground-error')).toBeEmpty();
  };
  await check();
  const original = await input.inputValue();
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  await expect(input).toHaveValue('Edited ' + original);
  await check();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const output = info.outputPath('sketch-edited.docx');
  await (await pending).saveAs(output);
  const sourceParts = unzipSync(readFileSync(source)), editedParts = unzipSync(readFileSync(output));
  for (const name of Object.keys(sourceParts)) if (name !== 'word/document.xml') expect(editedParts[name]).toEqual(sourceParts[name]);
  const sketches = parts => strFromU8(parts['word/document.xml']).match(/<[^<>\s]*:lineSketchStyleProps\b[\s\S]*?<\/[^<>\s]*:lineSketchStyleProps>/g);
  expect(sketches(editedParts)).toEqual(sketches(sourceParts));
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original); await check();
  const undoPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const undoPath = info.outputPath('sketch-undo.docx'); await (await undoPending).saveAs(undoPath);
  expect(unzipSync(readFileSync(undoPath))).toEqual(sourceParts);
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(output);
  await expect(input).toHaveValue('Edited ' + original, { timeout: 45000 });
  await expect(input).toHaveJSProperty('readOnly', false);
  await check();
  await page.locator('canvas.canvas-page').screenshot({ path: info.outputPath('sketch-preview.png') });
  expect(errors).toEqual([]);
});

test('paints regenerated ellipses and retains the original invisible-outline controls', async ({ page }, info) => {
  test.setTimeout(90000);
  const source = 'tests/fixtures/sketch-ellipse/control.docx', errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^0: ellipse seed 0/, { timeout: 45000 });
  await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(4);
  // Independently sampled from sketch-ellipse/native.pdf at 216 dpi. These areas
  // are inside the regenerated ellipse but outside the stale texture rectangle.
  await expect.poll(() => page.locator('canvas.canvas-page').first().evaluate(c => {
    const ctx = c.getContext('2d'), scale = c.width / 612;
    return [[55,85],[165,110]].map(([x,y]) => Array.from(ctx.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data).slice(0,3));
  })).toEqual([[224,32,48],[224,176,32]]);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const output = info.outputPath('ellipse-preview-original.docx');
  await (await pending).saveAs(output);
  expect(unzipSync(readFileSync(output))).toEqual(unzipSync(readFileSync(source)));
  await expect(page.locator('#playground-error')).toBeEmpty();
  await page.locator('canvas.canvas-page').first().screenshot({ path: info.outputPath('ellipse-preview.png') });
  expect(errors).toEqual([]);
});


test('keeps unsupported sketch types read-only and downloads their original bytes', async ({ page }, info) => {
  const parts = unzipSync(readFileSync('public/fixtures/picture-sketch-outlines.docx'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('lineSketchCurved', 'lineSketchFreehand'));
  const source = info.outputPath('unsupported-sketch.docx'); writeFileSync(source, zipSync(parts));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Picture geometry controls/, { timeout: 45000 });
  await expect(input).toHaveJSProperty('readOnly', true);
  const original = await input.inputValue(); await input.focus(); await page.keyboard.type('Must not edit');
  await expect(input).toHaveValue(original);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const output = info.outputPath('unsupported-sketch-original.docx'); await (await pending).saveAs(output);
  expect(readFileSync(output).equals(readFileSync(source))).toBe(true);
});
