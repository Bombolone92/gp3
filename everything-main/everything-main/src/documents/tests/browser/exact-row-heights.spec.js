import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { showAllTools, onTab } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';
const source = 'public/fixtures/exact-row-heights.docx';
async function select(input, text, whole = false) {
  await input.evaluate((el, { text, whole }) => {
    const at = el.value.indexOf(text); if (at < 0) throw new Error('Missing text: ' + text);
    el.focus(); el.setSelectionRange(at, at + (whole ? text.length : 0)); el.dispatchEvent(new Event('select', { bubbles: true }));
  }, { text, whole });
}
async function fixture(page) {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Exact row heights/);
  await expect(page.locator('#playground-error')).toBeEmpty(); return input;
}
async function download(page, info, name) {
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = info.outputPath(name); await (await pending).saveAs(path); return path;
}
async function height(page, value) {
  await (await onTab(page, 'tableLayout')).getByRole('button', { name: 'Row height', exact: true }).click(); const d = page.getByRole('dialog', { name: 'Row height', exact: true });
  await d.getByRole('combobox', { name: 'Row height setting' }).selectOption('exact');
  await d.getByRole('spinbutton', { name: 'Exact row height (pt)' }).fill(String(value));
  await d.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(d).toHaveCount(0);
}
async function images(page) { return page.locator('canvas.canvas-page').evaluateAll(canvases => canvases.map(c => c.toDataURL())); }

test('paints clipped rows and preserves hidden text through accessible editing, undo and independent export', async ({ page }, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); const input = await fixture(page), original = await input.inputValue();
  await page.getByRole('button', { name: 'Download .docx', exact: true }).focus();
  const initial = await images(page); expect(initial.length).toBeGreaterThan(2);
  initial.forEach((png, i) => writeFileSync(info.outputPath(`exact-row-page-${i + 1}.png`), Buffer.from(png.split(',')[1], 'base64')));
  const colored = await page.locator('canvas.canvas-page').first().evaluate(c => {
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let top = Infinity, bottom = -Infinity, count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] === 224 && data[i + 1] === 32 && data[i + 2] === 112) {
      const y = Math.floor(i / 4 / c.width); top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
    }
    return { height: (bottom - top + 1) / (c.width / 576), count };
  });
  // Solid pixels exclude the antialiased fractional boundary and table border.
  expect(colored.count).toBeGreaterThan(1000); expect(colored.height).toBeGreaterThanOrEqual(46); expect(colored.height).toBeLessThanOrEqual(48);
  const unchanged = await download(page, info, 'exact-rows-unchanged.docx');
  const before = unzipSync(readFileSync(source)), after = unzipSync(readFileSync(unchanged));
  expect(Object.keys(after)).toEqual(Object.keys(before)); for (const name of Object.keys(before)) expect(Buffer.from(before[name]).equals(Buffer.from(after[name])), name).toBe(true);
  await page.getByRole('checkbox', { name: 'Text mode', exact: true }).check(); await select(input, 'HIDDEN TWO', true); await page.keyboard.insertText('REVISED HIDDEN Á😀');
  await expect(input).toHaveValue(original.replace('HIDDEN TWO', 'REVISED HIDDEN Á😀'));
  await page.getByRole('checkbox', { name: 'Text mode', exact: true }).uncheck(); await page.getByRole('button', { name: 'Download .docx', exact: true }).focus();
  expect(await images(page)).toEqual(initial);
  await select(input, 'Exact visible'); await expect((await onTab(page, 'tableLayout')).getByRole('button', { name: 'Row height', exact: true })).toHaveAttribute('title', 'Row height: Exactly 24 pt');
  await height(page, 36); await expect(input).toBeFocused(); await expect((await onTab(page, 'tableLayout')).getByRole('button', { name: 'Row height', exact: true })).toHaveAttribute('title', 'Row height: Exactly 36 pt');
  const edited = await input.inputValue(), saved = await download(page, info, 'exact-row-heights.docx');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue(original);
  await page.getByRole('button', { name: 'Download .docx', exact: true }).focus(); expect(await images(page)).toEqual(initial);
  await reopenDocx(page, input, saved, edited); await select(input, 'Exact visible'); await expect((await onTab(page, 'tableLayout')).getByRole('button', { name: 'Row height', exact: true })).toHaveAttribute('title', 'Row height: Exactly 36 pt');
  expect(errors).toEqual([]);
});

test('keeps narrow exact-height controls usable, validates zero and restores clipped content with Automatic', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 540 }); const input = await fixture(page); await select(input, 'Exact visible');
  await (await onTab(page, 'tableLayout')).getByRole('button', { name: 'Row height', exact: true }).click(); const d = page.getByRole('dialog', { name: 'Row height', exact: true });
  const size = d.getByRole('spinbutton', { name: 'Exact row height (pt)' }), apply = d.getByRole('button', { name: 'Apply', exact: true });
  await expect(size).toHaveValue('24'); await expect(apply).toBeInViewport(); await expect(d).toContainText('use Text mode');
  await size.fill('0'); await apply.click(); await expect(d).toBeVisible(); expect(await size.evaluate(el => el.validity.rangeUnderflow)).toBe(true);
  await size.fill('0.05'); await d.screenshot({ path: info.outputPath('exact-row-dialog-narrow.png') }); await apply.click(); await expect(d).toHaveCount(0); await expect(input).toBeFocused();
  await select(input, 'HIDDEN TWO'); await input.press('ArrowDown');
  expect(await input.evaluate(el => el.selectionStart)).toBeGreaterThanOrEqual((await input.inputValue()).indexOf('Following automatic row'));
  await select(input, 'Exact visible'); await (await onTab(page, 'tableLayout')).getByRole('button', { name: 'Row height', exact: true }).click();
  await d.getByRole('combobox', { name: 'Row height setting' }).selectOption('auto'); await expect(d.getByRole('spinbutton')).toBeDisabled(); await apply.click();
  await select(input, 'HIDDEN TWO'); const caret = await input.evaluate(el => ({ y: parseFloat(el.style.top), h: parseFloat(el.style.height) })); expect(caret.h).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await select(input, 'Exact visible'); await expect((await onTab(page, 'tableLayout')).getByRole('button', { name: 'Row height', exact: true })).toHaveAttribute('title', 'Row height: Exactly 24 pt');
});
