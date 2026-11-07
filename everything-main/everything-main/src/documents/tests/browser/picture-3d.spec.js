import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
for (const name of ['picture-3d', 'picture-3d-outlines', 'picture-lighting']) {
const fixture = `public/fixtures/${name}.docx`;
const reference = JSON.parse(readFileSync(`tests/fixtures/${name}/reference.json`, 'utf8'));
test(`renders native ${name} through edit, undo and reopen`, async ({ page }, info) => {
  test.setTimeout(180000); // Each independent fixture renders twice, including outlined extrusions.
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(fixture);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(new RegExp(`^${reference.cases[0].name}`), { timeout: 60000 }); await expect(input).toHaveJSProperty('readOnly', false);
  const original = await input.inputValue();
  const check = async () => {
    await expect(page.locator('canvas.canvas-page')).toHaveCount(reference.cases.length);
    for (const [index, c] of reference.cases.entries()) {
      const canvas = page.locator('canvas.canvas-page').nth(index); await canvas.scrollIntoViewIfNeeded();
      const samples = [...c.samples, ...c.sideSamples, ...c.contourSamples, ...(c.outlineSamples || [])];
      const colors = await canvas.evaluate((canvas, samples) => {
        const ctx = canvas.getContext('2d'), ratio = canvas.width / 612;
        return samples.map(p => [...ctx.getImageData(Math.round(p.x * ratio), Math.round(p.y * ratio), 1, 1).data].slice(0, 3));
      }, samples);
      for (const [j, rgb] of colors.entries()) for (const channel of [0, 1, 2]) expect(Math.abs(rgb[channel] - samples[j].rgb[channel]), `${c.name} sample ${j} channel ${channel}`).toBeLessThanOrEqual(4);
      const outline = await canvas.evaluate((canvas, c) => {
        const ratio = canvas.width / 612, ctx = canvas.getContext('2d');
        const left = Math.floor(60 * ratio), top = Math.floor(120 * ratio), w = Math.ceil((80 + c.widthPt) * ratio), h = Math.ceil((40 + c.heightPt) * ratio);
        const data = ctx.getImageData(left, top, w, h).data, points = [];
        for (let y = 0; y < h; y++) {
          let first = -1, last = -1;
          for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (Math.min(data[i], data[i + 1], data[i + 2]) < 240) { if (first < 0) first = x; last = x; } }
          if (first >= 0) points.push([(left + first) / ratio, (top + y) / ratio], [(left + last + 1) / ratio, (top + y) / ratio]);
        }
        for (let x = 0; x < w; x++) {
          let first = -1, last = -1;
          for (let y = 0; y < h; y++) { const i = (y * w + x) * 4; if (Math.min(data[i], data[i + 1], data[i + 2]) < 240) { if (first < 0) first = y; last = y; } }
          if (first >= 0) points.push([(left + x) / ratio, (top + first) / ratio], [(left + x) / ratio, (top + last + 1) / ratio]);
        }
        return points;
      }, c);
      // Compare Euclidean boundary distances, not x-distance on near-tangent
      // rows, where subpixel antialiasing can move the scan endpoint far away.
      expect(outline.length).toBeGreaterThan(0);
      for (const [from, to] of [[outline, c.outline], [c.outline, outline]]) {
        const distance = Math.max(...from.map(([x, y]) => Math.min(...to.map(([u, v]) => Math.hypot(x - u, y - v)))));
        expect(distance, `${c.name} silhouette distance`).toBeLessThanOrEqual(1.25);
      }
    }
  };
  await check();
  for (const index of [3, 8]) writeFileSync(info.outputPath(`picture-3d-${index}.png`), Buffer.from(await page.locator('canvas.canvas-page').nth(index).evaluate(c => c.toDataURL().split(',')[1]), 'base64'));
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const download = async suffix => { const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const path = info.outputPath(`picture-3d-${suffix}.docx`); await (await pending).saveAs(path); return path; };
  const edited = await download('edited');
  const source = unzipSync(readFileSync(fixture)), saved = unzipSync(readFileSync(edited));
  expectBodyEditParts(saved, source);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  const undone = unzipSync(readFileSync(await download('undo')));
  for (const name of Object.keys(source)) expect(Buffer.from(undone[name]).equals(Buffer.from(source[name])), name).toBe(true);
  const previous = await input.elementHandle(); page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Open DOCX file').setInputFiles(edited);
  // Decode every retained 3D picture before replacing the editor.
  await expect.poll(() => previous.evaluate(el => el.isConnected), { timeout: 60000 }).toBe(false);
  await previous.dispose(); await expect(input).toHaveValue('Edited ' + original);
  await check(); expect(errors).toEqual([]);
});
}
