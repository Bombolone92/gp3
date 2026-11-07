import { test, expect } from '@playwright/test';
import { showAllTools } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';

const cases = [
  ['continuation-long-merged-all', 'Merge 50', 'Merge 70'],
  ['continuation-long-merged-continuation', 'Merge 50', 'Merge 70'],
  ['continuation-long-merged-owner', 'Merge 51', 'Merge 70'],
  ['continuation-structure-header-16-0', 'Inner B25', 'Inner B30'],
];
for (const [name, secondPageText, editText] of cases) test(`edits and preserves a native continuation probe: ${name}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/continuation-borders/${name}.docx`);
  await showAllTools(page);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Nested table probe/);
  const canvases = page.locator('canvas.canvas-page');
  await expect(canvases).toHaveCount(2);
  await input.evaluate((el, label) => {
    const at = el.value.indexOf(label);
    if (at < 0) throw new Error('Missing probe text');
    el.focus(); el.setSelectionRange(at, at); el.dispatchEvent(new Event('select'));
  }, secondPageText);
  await expect.poll(() => input.evaluate(el => {
    const canvas = document.querySelectorAll('canvas.canvas-page')[1];
    const top = parseFloat(el.style.top), bottom = top + parseFloat(el.style.height);
    return top >= canvas.offsetTop && bottom <= canvas.offsetTop + canvas.clientHeight;
  })).toBe(true);
  const original = await input.inputValue();
  await input.evaluate((el, label) => {
    const at = el.value.indexOf(label) + label.length;
    el.focus(); el.setSelectionRange(at, at); el.dispatchEvent(new Event('select'));
  }, editText);
  await input.pressSequentially('X');
  const edited = original.replace(editText, editText + 'X');
  await expect(input).toHaveValue(edited);
  await input.press('Control+z'); await expect(input).toHaveValue(original);
  await input.press('Control+y'); await expect(input).toHaveValue(edited);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = info.outputPath(`${name}-edited.docx`);
  await (await pending).saveAs(path);
  await reopenDocx(page, input, path, edited);
  await expect(canvases).toHaveCount(2);
  await canvases.nth(1).scrollIntoViewIfNeeded();
  await canvases.nth(1).screenshot({ path: info.outputPath(`${name}-page-2.png`) });
});

for (const keep of [0, 1]) test(`keeps a heading with fully merged text when row keeping is ${keep}`, async ({ page }, info) => {
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/continuation-headings/continuation-keep-heading-${keep}.docx`);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Lead A/);
  for (const label of ['Heading', 'Word']) {
    await input.evaluate((el, text) => {
      const at = el.value.indexOf(text);
      if (at < 0) throw new Error('Missing heading probe text');
      el.focus(); el.setSelectionRange(at, at); el.dispatchEvent(new Event('select'));
    }, label);
    // The independent native PDFs put both labels on their second page.
    await expect.poll(() => input.evaluate(el => {
      const top = parseFloat(el.style.top);
      return [...document.querySelectorAll('canvas.canvas-page')].findIndex(canvas => top >= canvas.offsetTop && top < canvas.offsetTop + canvas.clientHeight);
    })).toBe(1);
  }
  const canvas = page.locator('canvas.canvas-page').nth(1);
  await canvas.scrollIntoViewIfNeeded();
  await canvas.screenshot({ path: info.outputPath(`continuation-keep-heading-${keep}-page-2.png`) });
});

for (const [name, label, pages] of [
  ['continuation-small-exact-20-96-0-zero', 'Inner A1', 1],
  ['continuation-small-exact-20-96-96', 'Inner A1', 1],
  ['continuation-small-exact-page-20-oversized', 'Inner A2', 3],
]) test(`edits clipped text in a short row with thick borders: ${name}`, async ({ page }, info) => {
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/continuation-exact/${name}.docx`);
  await showAllTools(page);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Nested table probe/);
  await expect(input).toBeEditable();
  const canvases = page.locator('canvas.canvas-page');
  await expect(canvases).toHaveCount(pages);
  const original = await input.inputValue();
  await input.evaluate((el, label) => {
    const at = el.value.indexOf(label) + label.length;
    el.focus(); el.setSelectionRange(at, at); el.dispatchEvent(new Event('select'));
  }, label);
  await input.pressSequentially('X');
  const edited = original.replace(label, label + 'X');
  await expect(input).toHaveValue(edited);
  await input.press('Control+z'); await expect(input).toHaveValue(original);
  await input.press('Control+y'); await expect(input).toHaveValue(edited);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = info.outputPath(`${name}-edited.docx`);
  await (await pending).saveAs(path);
  await reopenDocx(page, input, path, edited);
  await expect(input).toBeEditable();
  await expect(canvases).toHaveCount(pages);
  await canvases.last().screenshot({ path: info.outputPath(`${name}-page-${pages}.png`) });
});
