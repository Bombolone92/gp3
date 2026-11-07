import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const reference = JSON.parse(readFileSync('tests/fixtures/drawing-line-caps/reference.json', 'utf8'));
test('matches native cap and dash pixels, including dots and outside-frame square caps', async ({ page }, info) => {
  expect(createHash('sha256').update(readFileSync('public/fixtures/drawing-line-caps.docx')).digest('hex')).toBe(reference.sourceSha256);
  await page.goto('/playground.html');
  const result = await page.evaluate(async reference => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { decodeShape } = await import('/src/engine/canvas-shapes.js');
    const pkg = await DocxPackage.open(new Uint8Array(await (await fetch('/fixtures/drawing-line-caps.docx')).arrayBuffer()));
    const decoded = await decodeShape(Object.values(pkg.assets)[0], new Map());
    const canvas = new OffscreenCanvas(decoded.bitmap.width, decoded.bitmap.height), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(decoded.bitmap, 0, 0);
    const failures = [];
    for (const s of reference.samples) {
      const x = Math.floor((s.x / .75 - decoded.left) * 2), y = Math.floor((s.y / .75 - decoded.top) * 2);
      const actual = x < 0 || y < 0 || x >= canvas.width || y >= canvas.height ? [255, 255, 255] : [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
      const expected = s.ink ? reference.cases[s.case].color : [255, 255, 255];
      if (actual.reduce((sum, n, i) => sum + Math.abs(n - expected[i]), 0) > 55) failures.push({ ...s, actual, expected });
    }
    const result = { left: decoded.left, top: decoded.top, failures }; decoded.close(); return result;
  }, reference);
  expect(result.left).toBeLessThan(0); expect(result.top).toBeLessThan(0);
  expect(result.failures).toEqual([]);
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/drawing-line-caps.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Line cap probes/); await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('#playground-error')).toBeEmpty(); await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const original = await input.inputValue(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const save = async suffix => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(`line-caps-${suffix}.docx`); await (await pending).saveAs(path); return path;
  };
  const edited = await save('edited'); await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(unzipSync(readFileSync('public/fixtures/drawing-line-caps.docx')));
  await reopenDocx(page, input, edited, 'Edited ' + original);
  await expect(page.locator('#playground-error')).toBeEmpty();
  writeFileSync(info.outputPath('line-caps.png'), Buffer.from(await page.locator('canvas.canvas-page').evaluate(canvas => canvas.toDataURL().split(',')[1]), 'base64'));
});
