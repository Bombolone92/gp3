import { downloadDocx } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

const size = page => page.getByRole('spinbutton', { name: 'Font size (pt)', exact: true });
const text = page => page.getByRole('textbox', { name: 'Document text', exact: true });
async function open(page) {
  await page.goto('/mock.html#/new');
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
}

test('Escape cancels a font-size draft without changing text, formatting or undo history', async ({ page }) => {
  await open(page);
  await text(page).fill('Keep this formatting'); await text(page).press('ControlOrMeta+a');
  const original = await size(page).inputValue();
  await size(page).fill('24'); await size(page).press('Escape');
  await expect(text(page)).toBeFocused(); await expect(size(page)).toHaveValue(original);
  await size(page).focus(); await size(page).press('ControlOrMeta+a'); await page.keyboard.type('24'); await page.keyboard.press('Escape');
  await expect(text(page)).toBeFocused(); await expect(size(page)).toHaveValue(original);
  expect(await text(page).evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([0, 20]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(text(page)).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('font-size drafts can be cancelled in the phone inspector, including invalid input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 }); await open(page);
  await page.getByRole('button', { name: 'Formatting Pane', exact: true }).click();
  const original = await size(page).inputValue();
  for (const draft of ['', '0', '13.25', '24']) {
    await size(page).fill(draft); await size(page).press('Escape');
    await expect(text(page)).toBeFocused(); await expect(size(page)).toHaveValue(original);
    await expect(page.getByRole('complementary', { name: 'Formatting Pane' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  }
  await size(page).fill('24');
  await size(page).evaluate(el => {
    for (const key of ['Escape', 'Enter']) for (const type of ['keydown', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { key, isComposing: true, bubbles: true, cancelable: true }));
  });
  await expect(size(page)).toBeFocused(); await expect(size(page)).toHaveValue('24');
  await expect(page.getByRole('complementary', { name: 'Formatting Pane' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await size(page).press('Escape'); await expect(size(page)).toHaveValue(original);
});

test('Enter commits half-point sizes, preserves selection and supports undo and redo', async ({ page }, info) => {
  await open(page); await text(page).fill('Half-point formatting'); await text(page).press('ControlOrMeta+a');
  const original = await size(page).inputValue();
  await size(page).fill('13.5'); await size(page).press('Enter');
  await expect(text(page)).toBeFocused(); await expect(size(page)).toHaveValue('13.5');
  expect(await text(page).evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([0, 21]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(size(page)).toHaveValue(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(size(page)).toHaveValue('13.5');
  const download = page.waitForEvent('download'); await downloadDocx(page);
  const path = info.outputPath('font-size-input.docx'); await (await download).saveAs(path);
  await reopenDocx(page, text(page), path, 'Half-point formatting');
  await text(page).press('ControlOrMeta+a'); await expect(size(page)).toHaveValue('13.5');
});

test('cancelling a mixed-size selection restores the mixed field without applying a draft', async ({ page }) => {
  await open(page); await text(page).fill('One two');
  await text(page).evaluate(el => { el.setSelectionRange(0, 3); el.dispatchEvent(new Event('select', { bubbles: true })); });
  await size(page).fill('18'); await size(page).press('Enter');
  await text(page).press('ControlOrMeta+a'); await expect(size(page)).toHaveValue('');
  await size(page).fill('24'); await size(page).press('Escape');
  await expect(text(page)).toBeFocused(); await expect(size(page)).toHaveValue('');
  expect(await text(page).evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([0, 7]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await text(page).press('ControlOrMeta+a'); await expect(size(page)).toHaveValue('12');
  await expect(text(page)).toHaveValue('One two');
});

test('Escape preserves distinct script sizes while Enter still applies the size to both declarations', async ({ page }, info) => {
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles('tests/fixtures/complex-script-formatting/control.docx');
  await expect(text(page)).toHaveValue(/^Case 1: Arial cs plain/);
  await text(page).evaluate(el => {
    const at = el.value.indexOf('ABC 012 ٠');
    el.setSelectionRange(at, at + 'ABC 012 ٠'.length); el.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await expect(size(page)).toHaveValue('16');
  const declarations = async name => {
    const event = page.waitForEvent('download'); await downloadDocx(page);
    const path = info.outputPath(name); await (await event).saveAs(path);
    const parts = unzipSync(readFileSync(path));
    if (name === 'font-size-cancel-cs.docx') {
      const original = unzipSync(readFileSync('tests/fixtures/complex-script-formatting/control.docx'));
      expect(Object.keys(parts).sort()).toEqual(Object.keys(original).sort());
      for (const [part, bytes] of Object.entries(original)) expect(Buffer.from(parts[part]).equals(Buffer.from(bytes)), part).toBe(true);
    }
    const xml = strFromU8(parts['word/document.xml']);
    return page.evaluate(xml => {
      const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const run = [...doc.getElementsByTagNameNS(ns, 'r')].find(r => r.textContent === 'ABC 012 ٠');
      return ['sz', 'szCs'].map(name => run.getElementsByTagNameNS(ns, name)[0].getAttributeNS(ns, 'val'));
    }, xml);
  };
  await size(page).fill('24'); await size(page).press('Escape');
  await expect(text(page)).toBeFocused(); await expect(size(page)).toHaveValue('16');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(await declarations('font-size-cancel-cs.docx')).toEqual(['20', '32']);
  await size(page).focus(); await size(page).press('Enter');
  await expect(text(page)).toBeFocused();
  expect(await declarations('font-size-same-value-cs.docx')).toEqual(['32', '32']);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await declarations('font-size-undo-cs.docx')).toEqual(['20', '32']);
});

test('a selection of mixed sizes shows the whole "Mixed" placeholder', async ({ page }) => {
  await page.goto('/mock.html#/new');
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
  const input = page.getByRole('textbox', { name: 'Document text' }), size = page.getByRole('spinbutton', { name: 'Font size (pt)' });
  await input.fill('Big and small');
  await input.evaluate(el => { el.setSelectionRange(0, 3); el.dispatchEvent(new Event('select')); });
  await size.fill('20'); await size.press('Enter');
  await input.evaluate(el => { el.setSelectionRange(0, 13); el.dispatchEvent(new Event('select')); });
  await expect(size).toHaveValue(''); await expect(size).toHaveAttribute('placeholder', 'Mixed');
  // The text box beside the size list's arrow must hold the placeholder.
  const room = await size.evaluate(el => {
    const style = getComputedStyle(el), context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontSize} ${style.fontFamily}`;
    return el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - context.measureText(el.placeholder).width;
  });
  expect(room).toBeGreaterThanOrEqual(0);
});

test('the size list offers every preset size, marks the current one and applies a choice', async ({ page }) => {
  await open(page); await text(page).fill('Pick a size'); await text(page).press('ControlOrMeta+a');
  await expect(size(page)).toHaveValue('12');
  await page.getByRole('button', { name: 'Font sizes', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Font size', exact: true });
  await expect(menu.getByRole('menuitemradio')).toHaveText(['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48', '72']);
  await expect(menu.getByRole('menuitemradio', { name: '12', exact: true })).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitemradio', { name: '24', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(text(page)).toBeFocused(); await expect(size(page)).toHaveValue('24');
  expect(await text(page).evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([0, 11]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(size(page)).toHaveValue('12');
});
