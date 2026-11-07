import { showAllTools } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

const colors = [[30, 90, 180], [245, 150, 35], [40, 160, 85], [155, 60, 175]];
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
async function download(page, testInfo, name) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = testInfo.outputPath(name); await (await event).saveAs(path); return path;
}
async function pixels(page, settings) {
  // Locate the first contiguous patch of source colors. Predict sample positions
  // from fixture dimensions and geometry, without reading engine layout state.
  return page.locator('canvas.canvas-page').first().evaluate((canvas, { colors, settings }) => {
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
    if (top < 0) throw new Error('No source colors were painted');
    const { width, height, angle, flipH, flipV, xs = [.25, .75] } = settings, a = angle * Math.PI / 180;
    const samples = [[xs[0], .25], [xs[1], .25], [xs[0], .75], [xs[1], .75]].map(([u, v]) => {
      const x = (u - .5) * width * (flipH ? -1 : 1), y = (v - .5) * height * (flipV ? -1 : 1);
      return sample((left + right) / 2 + (x * Math.cos(a) - y * Math.sin(a)) * ratio, (top + bottom) / 2 + (x * Math.sin(a) + y * Math.cos(a)) * ratio);
    });
    return { x: left / ratio, y: top / ratio, width: (right - left + 1) / ratio, height: (bottom - top + 1) / ratio, samples };
  }, { colors, settings });
}
function assertPaint(result, settings) {
  expect(result.samples).toEqual(colors);
  const a = settings.angle * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  expect(Math.abs(result.width - (settings.width * c + settings.height * s))).toBeLessThan(3);
  expect(Math.abs(result.height - (settings.width * s + settings.height * c))).toBeLessThan(3);
}

test('renders and edits imported rotations with crop/flip order, repeated headers, resize and preserved package parts', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/rotated-images.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Rotated pictures/);
  const settings = { width: 120, height: 60, angle: 30, flipH: true, xs: [1 / 6, .75] }, initial = await pixels(page, settings); assertPaint(initial, settings);
  expect(await page.locator('canvas.canvas-page').count()).toBeGreaterThan(2);
  await screenshot(page, testInfo, 0, 'imported-rotation.png');
  await page.locator('canvas.canvas-page').first().click({ position: { x: initial.x + initial.width / 2, y: initial.y + initial.height / 2 } });
  expect(await input.evaluate(el => el.selectionEnd - el.selectionStart)).toBe(1);
  await page.getByRole('button', { name: 'Image properties', exact: true }).click(); await expect(page.getByLabel('Image rotation (degrees)')).toHaveValue('30');
  await page.getByLabel('Image rotation (degrees)').fill('-90'); await page.getByLabel('Image width (in)', { exact: true }).fill('1.5');
  await page.getByLabel('Image alt text').fill('Rotated cropped quadrants');
  await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('rotation-properties.png') }); await apply(page, input);
  const changed = { ...settings, width: 144, height: 72, angle: 270 }; assertPaint(await pixels(page, changed), changed);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await selectImage(input); await input.press('ArrowRight'); assertPaint(await pixels(page, settings), settings);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await selectImage(input); await input.press('ArrowRight'); await page.keyboard.insertText(' rotated');
  await openProperties(page, input, 3); await expect(page.getByLabel('Image rotation (degrees)')).toHaveValue('45'); await page.getByLabel('Image rotation (degrees)').fill('90'); await apply(page, input);
  await openProperties(page, input, 4); await expect(page.getByLabel('Image rotation (degrees)')).toHaveValue('0'); await page.getByLabel('Image rotation (degrees)').fill('22.5'); await apply(page, input);
  const pages = await page.locator('canvas.canvas-page').count(); for (let i = 0; i < Math.min(pages, 3); i++) await screenshot(page, testInfo, i, `rotated-page-${i + 1}.png`);
  const text = await input.inputValue(), saved = await download(page, testInfo, 'rotated-images.docx');
  const original = unzipSync(readFileSync('public/fixtures/rotated-images.docx')), out = unzipSync(readFileSync(saved));
  expectBodyEditParts(out, original);
  await reopenDocx(page, input, saved, text); expect(await page.locator('canvas.canvas-page').count()).toBe(pages); assertPaint(await pixels(page, changed), changed);
  await openProperties(page, input); await expect(page.getByLabel('Image rotation (degrees)')).toHaveValue('270'); await expect(page.getByLabel('Image width (in)', { exact: true })).toHaveValue('1.5');
  await expect(page.getByLabel('Crop left (%)')).toHaveValue('25'); await expect(page.getByLabel('Flip image horizontally')).toBeChecked(); expect(errors).toEqual([]);
});

test('authors arbitrary angles, rotates asymmetric crop outsets after mirroring, and restores deletion and rotation with undo', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue('');
  const png = unzipSync(readFileSync('public/fixtures/rotated-images.docx'))['word/media/image1.png'];
  await page.getByLabel('Insert image file').setInputFiles({ name: 'quadrants.png', mimeType: 'image/png', buffer: Buffer.from(png) }); await expect(input).toHaveValue('\ufffc');
  await openProperties(page, input); await page.getByLabel('Image width (in)', { exact: true }).fill('1.5'); await page.getByLabel('Image rotation (degrees)').fill('30');
  await page.getByLabel('Flip image vertically').check(); await page.getByLabel('Image alt text').fill('Rotated outsets'); await apply(page, input);
  const angled = { width: 144, height: 72, angle: 30, flipV: true }; assertPaint(await pixels(page, angled), angled);
  await screenshot(page, testInfo, 0, 'authored-30-degrees.png');
  await openProperties(page, input); await page.getByLabel('Image rotation (degrees)').fill('-90'); await page.getByLabel('Flip image vertically').uncheck(); await page.getByLabel('Flip image horizontally').check(); await apply(page, input);
  const fullSettings = { width: 144, height: 72, angle: 270, flipH: true }, full = await pixels(page, fullSettings); assertPaint(full, fullSettings);
  await openProperties(page, input); await page.getByLabel('Crop left (%)').fill('-50'); await page.getByLabel('Crop top (%)').fill('-100'); await apply(page, input);
  const croppedSettings = { ...fullSettings, width: 96, height: 36 }, cropped = await pixels(page, croppedSettings); assertPaint(cropped, croppedSettings);
  expect(Math.abs(cropped.x - full.x - 36)).toBeLessThan(2); expect(Math.abs(cropped.y - full.y - 48)).toBeLessThan(2);
  await screenshot(page, testInfo, 0, 'rotated-outsets.png');
  await selectImage(input); await input.press('Backspace'); await expect(input).toHaveValue('');
  for (const name of ['Undo', 'Redo', 'Undo']) await page.getByRole('button', { name, exact: true }).click();
  await selectImage(input); await input.press('ArrowRight'); expect(await pixels(page, croppedSettings)).toEqual(cropped); await page.keyboard.insertText(' after');
  const saved = await download(page, testInfo, 'new-rotated-images.docx'); await reopenDocx(page, input, saved, '\ufffc after'); assertPaint(await pixels(page, croppedSettings), croppedSettings);
  await openProperties(page, input); await expect(page.getByLabel('Image rotation (degrees)')).toHaveValue('270'); await expect(page.getByLabel('Crop top (%)')).toHaveValue('-100'); expect(errors).toEqual([]);
});

test('opens rotated geometry with zero saved effect extents as editable', async ({ page }, testInfo) => {
  const parts = unzipSync(readFileSync('public/fixtures/rotated-images.docx'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace(/<wp:effectExtent[^>]*\/>/, '<wp:effectExtent l="0" t="0" r="0" b="0"/>'));
  await page.goto('/playground.html'); await showAllTools(page);
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^A small beginning/); const previous = await input.inputValue();
  await page.getByLabel('Open DOCX file').setInputFiles({ name: 'zero-effects-rotation.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });
  await expect(input).toHaveValue(/^Rotated pictures/); await expect(input).toBeEditable();
  expect(unzipSync(readFileSync(await download(page,testInfo,'zero-effects.docx')))).toEqual(parts);

});

test('disables rotation for a stationary picture fill while retaining other image edits', async ({ page }) => {
  const parts = unzipSync(readFileSync('public/fixtures/rotated-images.docx'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('rot="1800000"', 'rot="0"').replace('<pic:blipFill>', '<pic:blipFill rotWithShape="false">'));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles({ name: 'stationary-fill.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Rotated pictures/);
  await openProperties(page, input); await expect(page.getByLabel('Image rotation (degrees)')).toBeDisabled();
  await page.getByLabel('Image alt text').fill('Stationary fill'); await apply(page, input);
  await openProperties(page, input); await expect(page.getByLabel('Image alt text')).toHaveValue('Stationary fill'); await expect(page.getByLabel('Image rotation (degrees)')).toHaveValue('0');
});
