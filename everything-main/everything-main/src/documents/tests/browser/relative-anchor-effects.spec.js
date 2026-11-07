import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const directory = 'tests/fixtures/relative-anchor-effects/';
const references = JSON.parse(readFileSync(directory + 'reference.json', 'utf8'));

for (const reference of references) test(`${reference.name}: paints native effect-box positions and preserves edits`, async ({ page }, info) => {
  test.setTimeout(60000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html');
  const source = directory + reference.name + '.docx';
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Relative anchor effect extents/, { timeout: 60000 });
  await expect(input).toHaveJSProperty('readOnly', false);
  const canvas = page.locator('canvas.canvas-page'); await expect(canvas).toHaveCount(1);
  const bounds = await canvas.evaluate(canvas => {
    const c = document.createElement('canvas'); c.width = 816; c.height = 1056;
    const ctx = c.getContext('2d'); ctx.drawImage(canvas, 0, 0, 816, 1056);
    const pixels = ctx.getImageData(0, 0, 816, 1056).data, bands = [];
    for (const [left, right] of [[0, 408], [408, 816]]) {
      const column = [];
      for (let y = 0; y < 1056; y++) {
        let min = 816, max = -1;
        for (let x = left; x < right; x++) {
          const i = (y * 816 + x) * 4, r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
          if (r > 170 && r > g + 80 && r > b + 80) { min = Math.min(min, x); max = x; }
        }
        if (max < 0) continue;
        if (column.length && column.at(-1)[3] + 1 === y) {
          const box = column.at(-1); box[0] = Math.min(box[0], min); box[2] = Math.max(box[2], max); box[3] = y;
        } else column.push([min, y, max, y]);
      }
      bands.push(...column);
    }
    return bands;
  });
  expect(bounds).toHaveLength(8);
  bounds.forEach((box, i) => box.forEach((value, j) => expect(Math.abs(value - reference.inkBounds[i][j]), `shape ${i} edge ${j}`).toBeLessThanOrEqual(1)));
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
