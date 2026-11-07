import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder = 'tests/fixtures/point-outlines/';
const source = folder + 'control.docx';

test('retains round caps on coincident open lines and Beziers', async ({ page }, info) => {
  const reference = JSON.parse(readFileSync(folder + 'reference.json'));
  for (const [name, hash] of Object.entries(reference.sha256)) expect(createHash('sha256').update(readFileSync(folder + name)).digest('hex'), name).toBe(hash);
  await page.goto('/playground.html');
  const actual = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { decodeImages } = await import('/src/engine/images.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(bytes), c => c.charCodeAt(0)));
    const decoded = await decodeImages(pkg.assets, pkg.styles.fontAlternatives), rows = [];
    for (const im of decoded.values()) {
      const c = new OffscreenCanvas(im.bitmap.width, im.bitmap.height), ctx = c.getContext('2d');
      ctx.drawImage(im.bitmap, 0, 0); const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let ink = 0, x = 0, y = 0;
      for (let i = 3; i < data.length; i += 4) {
        const a = data[i] / 255, p = (i - 3) / 4; ink += a;
        x += (p % c.width + .5) * a; y += (Math.floor(p / c.width) + .5) * a;
      }
      rows.push({ ink, x: (im.left + x / ink * im.width / c.width) * .75, y: (im.top + y / ink * im.height / c.height) * .75 });
      im.close();
    }
    return rows;
  }, readFileSync(source).toString('base64'));
  expect(actual).toHaveLength(16);
  for (const i of reference.roundPointCases) {
    expect(actual[i].ink, `case ${i} paints a cap`).toBeGreaterThan(0);
    expect(Math.abs(actual[i].x - (i === 15 ? 50 : 100))).toBeLessThan(.25);
    expect(Math.abs(actual[i].y - (i === 15 ? 63 : 45))).toBeLessThan(.25);
  }
  expect(actual[9].ink).toBe(0); expect(actual[10].ink).toBe(0);
  expect(actual[11].ink).toBeGreaterThan(actual[14].ink); // Returning curve is not a point.
  const originalInput = page.getByRole('textbox', { name: 'Document text' });
  await expect(originalInput).toBeVisible();
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Curved stroke/); await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
  const original = await input.inputValue(), parts = unzipSync(readFileSync(source));
  const save = async name => { const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const path = info.outputPath(name + '.docx'); await (await event).saveAs(path); return path; };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const edited = await save('edited'), changed = unzipSync(readFileSync(edited));
  expect(Object.keys(changed).sort()).toEqual(Object.keys(parts).sort());
  for (const name of Object.keys(parts)) if (name !== 'word/document.xml') expect(changed[name], name).toEqual(parts[name]);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page, input, edited, 'Edited ' + original);
  await expect(input).toHaveJSProperty('readOnly', false);
});
