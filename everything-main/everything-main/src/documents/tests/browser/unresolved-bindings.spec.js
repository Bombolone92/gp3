import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { showAllTools } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';
import { openReadOnlyPreview } from './helpers/preview.js';

test('keeps active fallback mappings read-only even when the requested store ID is absent', async ({ page }) => {
  const parts = unzipSync(readFileSync('public/fixtures/unresolved-bindings.docx'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('/f:root/f:absent', '/f:root/f:value'));
  await page.goto('/playground.html');
  await openReadOnlyPreview(page, { name: 'active-binding.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });
});

test('edits unresolved controls without changing their binding or custom data, and restores every part on undo', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const source = 'public/fixtures/unresolved-bindings.docx';
  await page.goto('/playground.html'); await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/Saved unresolved content 3/);
  const original = await input.inputValue();
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  await page.getByRole('button', { name: 'Download .docx', exact: true }).focus();
  const before = await page.locator('canvas.canvas-page').evaluate(c => c.toDataURL());
  writeFileSync(info.outputPath('original.png'), Buffer.from(before.split(',')[1], 'base64'));
  await input.evaluate(el => {
    const start = el.value.indexOf('Saved unresolved content 1');
    el.focus(); el.setSelectionRange(start + 1, start + 4);
    el.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await page.keyboard.insertText('EDIT');
  const editedText = original.replace('Saved unresolved content 1', 'SEDITd unresolved content 1');
  await expect(input).toHaveValue(editedText);
  async function download(name) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(name); await (await pending).saveAs(path); return path;
  }
  const edited = await download('edited.docx');
  const a = unzipSync(readFileSync(source)), b = unzipSync(readFileSync(edited));
  expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
  for (const name of Object.keys(a)) if (name !== 'word/document.xml') expect(Buffer.from(b[name]).equals(Buffer.from(a[name])), name).toBe(true);
  expect((strFromU8(b['word/document.xml']).match(/<w15:dataBinding\b/g) || [])).toHaveLength(3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(input).toHaveValue(original);
  const restored = unzipSync(readFileSync(await download('restored.docx')));
  for (const name of Object.keys(a)) expect(Buffer.from(restored[name]).equals(Buffer.from(a[name])), name).toBe(true);
  // Undo restores the original text selection; compare pages with the same
  // collapsed selection used before editing, so the highlight is not artwork.
  await input.evaluate(el => { el.setSelectionRange(0, 0); el.dispatchEvent(new Event('select', { bubbles: true })); });
  await page.getByRole('button', { name: 'Download .docx', exact: true }).focus();
  expect(await page.locator('canvas.canvas-page').evaluate(c => c.toDataURL()) === before).toBe(true);
  await reopenDocx(page, input, edited, editedText);
  await expect(page.locator('#playground-error')).toBeEmpty();
  expect(errors).toEqual([]);
});
