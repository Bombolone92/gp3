import { showAllTools } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

const B = [30, 90, 180], O = [245, 150, 35], G = [40, 160, 85], P = [155, 60, 175];
async function selectImage(input, index = 0) {
  await input.evaluate((el, index) => { const at = [...el.value.matchAll(/\ufffc/g)][index].index; el.setSelectionRange(at, at + 1); el.dispatchEvent(new Event('select', { bubbles: true })); }, index);
}
async function openProperties(page, input, index = 0) {
  await selectImage(input, index); await page.getByRole('button', { name: 'Image properties', exact: true }).click();
}
async function apply(page, input) {
  await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await input.press('ArrowRight');
}
async function screenshot(page, testInfo, index, name) {
  const png = await page.locator('canvas.canvas-page').nth(index).evaluate(c => c.toDataURL()); writeFileSync(testInfo.outputPath(name), Buffer.from(png.split(',')[1], 'base64'));
}
async function pixels(page) {
  // Source quadrant colors locate the first picture without engine/layout access.
  // A short gap permits interpolated rows between the top and bottom quadrants.
  return page.locator('canvas.canvas-page').first().evaluate((canvas, colors) => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height), ratio = canvas.width / parseFloat(canvas.style.width);
    let left = Infinity, top = -1, right = 0, bottom = 0;
    const sample = (x, y) => Array.from(data.slice((Math.floor(y) * canvas.width + Math.floor(x)) * 4, (Math.floor(y) * canvas.width + Math.floor(x)) * 4 + 3));
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const at = (y * canvas.width + x) * 4;
        if (!colors.some(c => c[0] === data[at] && c[1] === data[at + 1] && c[2] === data[at + 2])) continue;
        if (top < 0) top = y; left = Math.min(left, x); right = Math.max(right, x); bottom = y;
      }
      if (top >= 0 && y - bottom > 4 * ratio) break;
    }
    if (top < 0) throw new Error('No source quadrant pixels were painted');
    return { x: left / ratio, y: top / ratio, width: (right - left + 1) / ratio, height: (bottom - top + 1) / ratio,
      corners: [[.2, .25], [.8, .25], [.2, .75], [.8, .75]].map(([x, y]) => sample(left + x * (right - left), top + y * (bottom - top))) };
  }, [B, O, G, P]);
}
async function download(page, testInfo, name) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = testInfo.outputPath(name); await (await event).saveAs(path); return path;
}

test('edits imported flips, preserves cropped colors and repeated headers, and adds a missing transform on export', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/flipped-images.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Flipped pictures/);
  const initial = await pixels(page); expect(initial.corners).toEqual([O, B, P, G]);
  const pages = await page.locator('canvas.canvas-page').count(); expect(pages).toBeGreaterThan(2);
  await page.locator('canvas.canvas-page').first().click({ position: { x: initial.x + initial.width / 2, y: initial.y + initial.height / 2 } });
  expect(await input.evaluate(el => el.selectionEnd - el.selectionStart)).toBe(1);
  await page.getByRole('button', { name: 'Image properties', exact: true }).click();
  await expect(page.getByLabel('Flip image horizontally')).toBeChecked(); await expect(page.getByLabel('Flip image vertically')).not.toBeChecked();
  await page.getByLabel('Flip image horizontally').uncheck(); await page.getByLabel('Flip image vertically').check();
  await page.getByLabel('Image width (in)', { exact: true }).fill('1.5'); await page.getByLabel('Image alt text').fill('Vertically flipped quadrants');
  await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('flip-properties.png') }); await apply(page, input);
  const flipped = await pixels(page); expect(flipped.corners).toEqual([G, P, B, O]); expect(Math.abs(flipped.width - 144)).toBeLessThan(2); expect(Math.abs(flipped.height - 72)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await selectImage(input); await input.press('ArrowRight'); await page.keyboard.insertText(' flipped');
  await openProperties(page, input, 3); await expect(page.getByLabel('Flip image horizontally')).toBeChecked(); await expect(page.getByLabel('Flip image vertically')).toBeChecked();
  await page.getByLabel('Flip image horizontally').uncheck(); await page.getByLabel('Flip image vertically').uncheck(); await apply(page, input);
  await openProperties(page, input, 4); await expect(page.getByLabel('Flip image horizontally')).not.toBeChecked(); await page.getByLabel('Flip image horizontally').check(); await apply(page, input);
  expect(await page.locator('canvas.canvas-page').count()).toBe(pages);
  for (const i of [0, 1, 2]) await screenshot(page, testInfo, i, `flipped-page-${i + 1}.png`);
  const text = await input.inputValue(), saved = await download(page, testInfo, 'flipped-images.docx');
  const original = unzipSync(readFileSync('public/fixtures/flipped-images.docx')), out = unzipSync(readFileSync(saved));
  expectBodyEditParts(out, original);
  await reopenDocx(page, input, saved, text);
  expect(await page.locator('canvas.canvas-page').count()).toBe(pages); expect((await pixels(page)).corners).toEqual([G, P, B, O]);
  await openProperties(page, input); await expect(page.getByLabel('Flip image horizontally')).not.toBeChecked(); await expect(page.getByLabel('Flip image vertically')).toBeChecked();
  await expect(page.getByLabel('Crop left (%)')).toHaveValue('25'); await expect(page.getByLabel('Image width (in)', { exact: true })).toHaveValue('1.5'); expect(errors).toEqual([]);
});

test('authors independent flips, mirrors asymmetric crop outsets and restores deletion with undo and redo', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue('');
  const png = unzipSync(readFileSync('public/fixtures/flipped-images.docx'))['word/media/image1.png'];
  await page.getByLabel('Insert image file').setInputFiles({ name: 'quadrants.png', mimeType: 'image/png', buffer: Buffer.from(png) }); await expect(input).toHaveValue('\ufffc');
  await openProperties(page, input); await page.getByLabel('Image width (in)', { exact: true }).fill('1.5'); await page.getByLabel('Image alt text').fill('Both axes with outsets'); await apply(page, input);
  const full = await pixels(page); expect(full.corners).toEqual([B, O, G, P]);
  for (const [horizontal, vertical, expected] of [[true, false, [O, B, P, G]], [false, true, [G, P, B, O]], [true, true, [P, G, O, B]]]) {
    await openProperties(page, input); await page.getByLabel('Flip image horizontally').setChecked(horizontal); await page.getByLabel('Flip image vertically').setChecked(vertical); await apply(page, input);
    const result = await pixels(page); expect(result.corners).toEqual(expected); for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(result[key] - full[key])).toBeLessThan(2);
  }
  await openProperties(page, input); await page.getByLabel('Crop left (%)').fill('-50'); await page.getByLabel('Crop top (%)').fill('-100'); await apply(page, input);
  const cropped = await pixels(page); expect(cropped.corners).toEqual([P, G, O, B]);
  expect(Math.abs(cropped.width - 96)).toBeLessThan(2); expect(Math.abs(cropped.height - 36)).toBeLessThan(2);
  // Source space is on the left/top; both flips move it to the right/bottom.
  expect(Math.abs(cropped.x - full.x)).toBeLessThan(2); expect(Math.abs(cropped.y - full.y)).toBeLessThan(2);
  await screenshot(page, testInfo, 0, 'flipped-outsets.png');
  await openProperties(page, input); await page.getByRole('button', { name: 'Reset crop', exact: true }).click(); await apply(page, input); expect((await pixels(page)).corners).toEqual([P, G, O, B]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await page.getByRole('button', { name: 'Redo', exact: true }).click(); await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await selectImage(input); await input.press('Backspace'); await expect(input).toHaveValue('');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await page.getByRole('button', { name: 'Redo', exact: true }).click(); await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await input.press('ArrowRight'); expect(await pixels(page)).toEqual(cropped); await page.keyboard.insertText(' after');
  const saved = await download(page, testInfo, 'new-flipped-images.docx');
  await reopenDocx(page, input, saved, '\ufffc after'); expect((await pixels(page)).corners).toEqual([P, G, O, B]);
  await openProperties(page, input); await expect(page.getByLabel('Flip image horizontally')).toBeChecked(); await expect(page.getByLabel('Flip image vertically')).toBeChecked();
  await expect(page.getByLabel('Crop left (%)')).toHaveValue('-50'); await expect(page.getByLabel('Crop top (%)')).toHaveValue('-100'); expect(errors).toEqual([]);
});
