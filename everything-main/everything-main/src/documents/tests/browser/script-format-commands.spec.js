import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { showAllTools } from './helpers/editor-tools.js';

test('toolbar, keyboard and beforeinput commands retain both script properties through download and undo', async ({ page }, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html');
  const source = 'tests/fixtures/complex-script-properties/control.docx';
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/Default Latin text/);
  const text = await input.inputValue();
  await showAllTools(page);
  await input.evaluate(el => { el.setSelectionRange(0, 7); el.dispatchEvent(new Event('select', { bubbles: true })); });
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await input.press('Control+i');
  await input.evaluate(el => el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'formatBold', bubbles: true, cancelable: true })));
  async function download(name) {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(name); await (await event).saveAs(path); return path;
  }
  const edited = await download('commands.docx');
  const formats = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const pkg = await DocxPackage.open(new Uint8Array(bytes));
    return pkg.paragraphs[0].runs.map(r => ({ text: r.text, bold: r.bold, boldCs: r.boldCs, italic: r.italic, italicCs: r.italicCs }));
  }, [...readFileSync(edited)]);
  expect(formats[0]).toEqual({ text: 'Default', bold: false, boldCs: false, italic: true, italicCs: true });
  expect(formats[1]).toMatchObject({ text: ' Latin text', bold: false, boldCs: false, italic: false, italicCs: false });
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const restored = await download('undo.docx');
  expect(unzipSync(readFileSync(restored))).toEqual(unzipSync(readFileSync(source)));
  await reopenDocx(page, input, edited, text);
  await input.evaluate(el => { el.setSelectionRange(0, 7); el.dispatchEvent(new Event('select', { bubbles: true })); });
  await expect(page.getByRole('button', { name: 'Italic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});
