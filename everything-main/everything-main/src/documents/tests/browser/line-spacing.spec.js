import { openReadOnlyPreview } from './helpers/preview.js';
import { showAllTools } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { writeFileSync, readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

async function select(input, text, end) {
  await input.evaluate((el, { text, end }) => { const at = el.value.indexOf(text); if (at < 0) throw new Error('Missing text'); el.setSelectionRange(at, end ? el.value.indexOf(end) + end.length : at); el.dispatchEvent(new Event('select', { bubbles: true })); }, { text, end });
}
async function fixture(page) {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/line-spacing.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Line spacing/); return input;
}
const control = page => page.getByRole('combobox', { name: 'Line spacing', exact: true }).locator('option:checked');
async function open(page) { await page.getByRole('button', { name: 'Line spacing options', exact: true }).click(); return page.getByRole('dialog', { name: 'Line spacing', exact: true }); }
async function spacing(page, rule, value) {
  const d = await open(page); await d.getByRole('combobox', { name: 'Line spacing rule' }).selectOption(rule);
  if (value !== undefined) await d.getByRole('spinbutton', { name: 'Line spacing amount' }).fill(String(value));
  await d.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(d).toHaveCount(0); await expect(page.getByRole('textbox', { name: 'Document text' })).toBeFocused();
}
async function download(page, info, name) { const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const path = info.outputPath(name); await (await event).saveAs(path); return path; }
async function screenshot(page, info, index, name) { const png = await page.locator('canvas.canvas-page').nth(index).evaluate(c => c.toDataURL().split(',')[1]); writeFileSync(info.outputPath(name), Buffer.from(png, 'base64')); }
async function redInkHeight(page) {
  // Match the fixture's CC0000 text, excluding red/orange pixels in emoji.
  return page.locator('canvas.canvas-page').evaluateAll(canvases => Math.max(...canvases.map(c => { const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height); let top = c.height, bottom = -1; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const at = (y * c.width + x) * 4; if (data[at] >= 200 && data[at] <= 208 && data[at + 1] < 8 && data[at + 2] < 8 && data[at + 3] > 200) { top = Math.min(top, y); bottom = Math.max(bottom, y); } } return Math.max(0, bottom - top + 1); })));
}

test('edits inherited, exact and minimum line heights with accessible controls and preserves DOCX exports', async ({ page }, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const input = await fixture(page), text = await input.inputValue(), button = page.getByRole('button', { name: 'Line spacing options', exact: true }), undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(button.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  const exactInk = await redInkHeight(page); expect(exactInk).toBeGreaterThan(20);
  await screenshot(page, info, 0, 'line-spacing-overflow-ink.png');
  await select(input, 'Inherited exact'); await expect(control(page)).toHaveText('Exactly 24 pt'); const top = await input.evaluate(el => parseFloat(el.style.top));
  await button.focus(); await button.press('Enter'); const d = page.getByRole('dialog', { name: 'Line spacing', exact: true }); await expect(d.getByRole('spinbutton', { name: 'Line spacing amount' })).toHaveValue('24');
  await d.getByRole('spinbutton', { name: 'Line spacing amount' }).fill('30'); await d.getByRole('button', { name: 'Apply', exact: true }).press('Enter'); await expect(input).toBeFocused(); expect(await input.evaluate(el => parseFloat(el.style.top))).toBeCloseTo(top + 6.4, 1);
  await undo.click(); await expect(control(page)).toHaveText('Exactly 24 pt'); await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(control(page)).toHaveText('Exactly 30 pt');
  await select(input, 'Direct minimum'); await spacing(page, 'inherit'); await expect(control(page)).toHaveText('Exactly 24 pt');
  await select(input, 'Omitted rule'); await expect(control(page)).toHaveText('1.5×'); await spacing(page, 'auto', 1.25);
  await select(input, 'Clipped exact'); await spacing(page, 'atLeast', 10); expect(Math.abs(await redInkHeight(page) - exactInk)).toBeLessThanOrEqual(1);
  await select(input, 'Header spacing'); await spacing(page, 'atLeast', 28); await expect(input).toHaveValue(text);
  await screenshot(page, info, 0, 'line-spacing-page.png'); await screenshot(page, info, 2, 'line-spacing-continued.png');
  const saved = await download(page, info, 'line-spacing.docx'); await reopenDocx(page, input, saved, text); await expect(undo).toBeDisabled();
  for (const [label, title] of [['Inherited exact', 'Exactly 30 pt'], ['Direct minimum', 'Exactly 24 pt'], ['Omitted rule', '1.25×'], ['Clipped exact', 'At least 10 pt'], ['Header spacing', 'At least 28 pt']]) { await select(input, label); await expect(control(page)).toHaveText(title); }
  expect(errors).toEqual([]);
});

test('authors fractional point heights and custom multiples, retains Unicode edits and reopens a fresh DOCX', async ({ page }, info) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click(); const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue('');
  await input.focus(); await page.keyboard.insertText('First Á😀\nSecond\nThird');
  await select(input, 'First'); await spacing(page, 'exact', 24.05); await select(input, 'Second'); await spacing(page, 'atLeast', 18); await select(input, 'Third'); await spacing(page, 'auto', 1.375);
  const original = await input.inputValue(); await select(input, 'First'); await input.press('End'); await input.press('Enter'); await page.keyboard.insertText('Inserted'); await page.getByRole('button', { name: 'Undo', exact: true }).click(); await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue(original);
  const saved = await download(page, info, 'new-line-spacing.docx'); await reopenDocx(page, input, saved, original); await select(input, 'First'); await expect(control(page)).toHaveText('Exactly 24.05 pt'); await screenshot(page, info, 0, 'new-line-spacing.png');
});

test('preserves mixed no-ops and repaginates tables without losing zoomed Unicode caret positions', async ({ page }) => {
  const input = await fixture(page), original = await input.inputValue(), undo = page.getByRole('button', { name: 'Undo', exact: true });
  await select(input, 'Inherited exact', 'Direct minimum'); const d = await open(page); await expect(d.getByRole('combobox', { name: 'Line spacing rule' })).toHaveValue('mixed'); await d.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(undo).toBeDisabled();
  await select(input, 'Flowing text.'); const count = await page.locator('canvas.canvas-page').count(); await spacing(page, 'atLeast', 42); expect(await page.locator('canvas.canvas-page').count()).toBeGreaterThan(count); await undo.click(); expect(await page.locator('canvas.canvas-page').count()).toBe(count);
  await select(input, 'Inherited exact'); await spacing(page, 'exact', 36); await input.evaluate(el => { const at = el.value.indexOf('Á😀', el.value.indexOf('Inherited exact')); el.setSelectionRange(at, at); el.dispatchEvent(new Event('select', { bubbles: true })); }); await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1.5');
  const caret = await input.evaluate(el => ({ left: parseFloat(el.style.left), top: parseFloat(el.style.top), height: parseFloat(el.style.height), at: el.selectionStart })), surface = await page.locator('.canvas-pages').boundingBox();
  await page.mouse.click(surface.x + caret.left + 1, surface.y + caret.top + caret.height / 2); expect(await input.evaluate(el => el.selectionStart)).toBe(caret.at); await input.press('ArrowRight'); expect(await input.evaluate(el => el.selectionStart)).toBe(caret.at + 2); await page.keyboard.insertText('X'); await undo.click(); await expect(input).toHaveValue(original);
});

test('keeps an untouched mixed amount with a common rule and applies an explicit amount in one undo step', async ({ page }) => {
  const input = await fixture(page), undo = page.getByRole('button', { name: 'Undo', exact: true });
  await select(input, 'Fractional height', 'Numbered line'); let d = await open(page);
  await expect(d.getByRole('combobox', { name: 'Line spacing rule' })).toHaveValue('exact'); await expect(d.getByRole('spinbutton', { name: 'Line spacing amount' })).toHaveValue('');
  await d.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(d).toHaveCount(0); await expect(undo).toBeDisabled();
  d = await open(page); await d.getByRole('spinbutton', { name: 'Line spacing amount' }).fill('32.05'); await d.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(d).toHaveCount(0); await expect(control(page)).toHaveText('Exactly 32.05 pt');
  await undo.click(); await expect(undo).toBeDisabled(); await expect(control(page)).toHaveText('Mixed');
});

test('rolls back line heights that cannot fit and leaves the dialog open for correction', async ({ page }) => {
  const input = await fixture(page), original = await input.inputValue(), undo = page.getByRole('button', { name: 'Undo', exact: true }); await select(input, 'Header spacing'); const count = await page.locator('canvas.canvas-page').count(), d = await open(page);
  await d.getByRole('spinbutton', { name: 'Line spacing amount' }).fill('600'); await d.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(d.getByRole('alert')).toContainText('cannot fit'); await expect(undo).toBeDisabled(); await expect(input).toHaveValue(original); expect(await page.locator('canvas.canvas-page').count()).toBe(count); await expect(control(page)).toHaveText('Exactly 24 pt');
  await d.getByRole('spinbutton', { name: 'Line spacing amount' }).fill('28'); await d.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(d).toHaveCount(0); await undo.click(); await expect(undo).toBeDisabled();
});

test('keeps custom line spacing reachable on a narrow screen and preserves points between exact and minimum modes', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 500 }); const input = await fixture(page); await select(input, 'Inherited exact'); const d = await open(page), size = d.getByRole('spinbutton', { name: 'Line spacing amount' }), apply = d.getByRole('button', { name: 'Apply', exact: true });
  await d.getByRole('combobox', { name: 'Line spacing rule' }).selectOption('atLeast'); await expect(size).toHaveValue('24'); await size.focus(); await expect(size).toBeInViewport(); await expect(apply).toBeInViewport(); expect(await d.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); await d.screenshot({ path: info.outputPath('line-spacing-narrow.png') }); await size.fill('24.05'); await apply.click(); await expect(d).toHaveCount(0); await expect(input).toBeFocused();
});

test('previews malformed spacing and unsupported page-edge compatibility as read-only with the original available', async ({ page }) => {
  const input = await fixture(page), original = await input.inputValue();
  for (const name of ['malformed', 'compatibility']) {
    const parts = unzipSync(readFileSync('public/fixtures/line-spacing.docx')), path = name === 'malformed' ? 'word/document.xml' : 'word/settings.xml', xml = strFromU8(parts[path]); parts[path] = strToU8(name === 'malformed' ? xml.replace('<w:spacing w:line="160" w:lineRule="exact"/>', '<w:spacing w:line="bad"/>') : xml.replace('<w:compat>', '<w:compat><w:suppressTopSpacing/>'));
    await openReadOnlyPreview(page, { name: name + '.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });   await expect(page.getByRole('button', { name: 'Download .docx', exact: true })).toBeEnabled();
  }
});
