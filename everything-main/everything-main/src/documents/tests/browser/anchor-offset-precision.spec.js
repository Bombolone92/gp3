import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder = 'tests/fixtures/anchor-offset-precision/';

for (const name of ['control', 'containers']) test(`signed anchors preserve native positions and source geometry: ${name}`, async ({ page }, info) => {
  test.setTimeout(120000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html');
  const previous = await page.getByRole('textbox', { name: 'Document text' }).elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(folder + name + '.docx');
  await expect.poll(() => previous.evaluate(el => el.isConnected)).toBe(false);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(4);
  const original = await input.inputValue(), parts = unzipSync(readFileSync(folder + name + '.docx'));
  const save = async suffix => {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(suffix + '.docx'); await (await event).saveAs(path); return path;
  };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  for (const zoom of [1, 2]) {
    await page.getByRole('combobox', { name: 'Zoom' }).selectOption(String(zoom));
    for(let i=0;i<4;i++) {
      const pixels=await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL('image/png').split(',')[1]);
      writeFileSync(info.outputPath(`app-${zoom * 100}-${i}.png`),Buffer.from(pixels,'base64'));
    }
  }
  await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const edited = await save('edited'), changed = unzipSync(readFileSync(edited));
  for (const part of Object.keys(parts)) if (part !== 'word/document.xml') expect(changed[part], part).toEqual(parts[part]);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page, input, edited, 'Edited ' + original);
  await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveValue('Edited ' + original);
  expect(errors).toEqual([]);
});
