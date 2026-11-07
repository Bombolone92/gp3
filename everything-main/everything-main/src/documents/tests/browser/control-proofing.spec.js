import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { showAllTools } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

const source = 'tests/fixtures/control-proofing/source.docx';
const originalParts = unzipSync(readFileSync(source));
async function download(page, info, name) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = info.outputPath(name); await (await pending).saveAs(path); return path;
}
function retained(path, edited = false) {
  const parts = unzipSync(readFileSync(path));
  if (edited) expectBodyEditParts(parts, originalParts);
  else {
    expect(Object.keys(parts).sort()).toEqual(Object.keys(originalParts).sort());
    for (const name of Object.keys(parts)) expect(Buffer.from(parts[name]).equals(Buffer.from(originalParts[name])), name).toBe(true);
  }
  return strFromU8(parts['word/document.xml']);
}
async function capture(page, input) {
  // Undo restores the original selection. Compare document paint at the same
  // collapsed selection rather than comparing a highlight with unselected text.
  await input.evaluate(el => {
    el.setSelectionRange(0, 0); el.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Download .docx', exact: true }).focus();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.locator('canvas.canvas-page').evaluate(c => c.toDataURL());
}

for (const [index, text] of ['[Your name]', 'Existing company', '[Plain value]', 'Linked company', 'Persistent company'].entries()) {
  test(`proofing annotations allow editing control ${index + 1} and exact undo`, async ({ page }, info) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/playground.html'); await showAllTools(page);
    await page.getByLabel('Open DOCX file').setInputFiles(source);
    const input = page.getByRole('textbox', { name: 'Document text' });
    await expect(input).toHaveValue(/^Content control proofing markers/);
    await expect(input).toBeEditable();
    await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
    const original = await input.inputValue();
    const before = await capture(page, input);
    writeFileSync(info.outputPath('before.png'), Buffer.from(before.split(',')[1], 'base64'));
    await input.evaluate((el, text) => {
      const at = el.value.indexOf(text); if (at < 0) throw new Error('Missing control');
      el.focus(); el.setSelectionRange(at, at + text.length);
      el.dispatchEvent(new Event('select', { bubbles: true }));
    }, text);
    await page.keyboard.insertText('Replacement Á😀');
    const edited = original.replace(text, 'Replacement Á😀');
    await expect(input).toHaveValue(edited);
    const path = await download(page, info, 'edited.docx');
    const xml = retained(path, true);
    expect((xml.match(/<w:sdtPr[ >]/g) || []).length).toBe(index === 4 ? 5 : 4);
    if (index !== 4) expect(xml).not.toContain(`original-${index + 1}`);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(input).toHaveValue(original);
    retained(await download(page, info, 'undo.docx'));
    expect(await capture(page, input)).toBe(before);
    await reopenDocx(page, input, path, edited);
    await expect(input).toBeEditable(); await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}
