import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { showAllTools } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

for (const name of ['body-placeholder', 'cell-placeholder', 'singleline-placeholder', 'mixed-placeholder']) {
  test(`formats and replaces ${name} through export and exact undo`, async ({ page }, info) => {
    const source = `tests/fixtures/plain-text-block-placeholders/${name}-source.docx`;
    const originalParts = unzipSync(readFileSync(source)), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/playground.html'); await showAllTools(page);
    await page.getByLabel('Open DOCX file').setInputFiles(source);
    const input = page.getByRole('textbox', { name: 'Document text' });
    await expect(input).toHaveValue(/Alpha Bravo\nSecond line\nThird line/);
    await expect(input).toBeEditable();
    const original = await input.inputValue();
    const select = async length => input.evaluate((el, length) => {
      const at = el.value.indexOf('Alpha Bravo') + 2;
      el.focus(); el.setSelectionRange(at, at + length);
      el.dispatchEvent(new Event('select', { bubbles: true }));
    }, length);
    const save = async (filename, edited, textEdited = false) => {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
      const path = info.outputPath(filename); await (await pending).saveAs(path);
      const parts = unzipSync(readFileSync(path));
      if (textEdited) expectBodyEditParts(parts, originalParts);
      else {
        expect(Object.keys(parts).sort()).toEqual(Object.keys(originalParts).sort());
        for (const key of Object.keys(parts)) if (!edited || key !== 'word/document.xml')
          expect(Buffer.from(parts[key]).equals(Buffer.from(originalParts[key])), key).toBe(true);
      }
      return { path, xml: strFromU8(parts['word/document.xml']) };
    };
    await select(2); await page.getByRole('button', { name: 'Bold', exact: true }).click();
    await expect(input).toHaveValue(original);
    const formatted = await save('formatted.docx', true);
    expect((formatted.xml.match(/<w:sdtPr[ >]/g) || []).length).toBe(1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await save('format-undo.docx', false);
    await select(0); await page.keyboard.insertText('Replacement Á😀');
    const edited = original.replace('Alpha Bravo\nSecond line\nThird line', 'Replacement Á😀');
    await expect(input).toHaveValue(edited);
    const saved = await save('edited.docx', true, true);
    expect(saved.xml).not.toContain('<w:sdtPr');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(input).toHaveValue(original); await save('undo.docx', false);
    await reopenDocx(page, input, saved.path, edited); await expect(input).toBeEditable();
    expect(errors).toEqual([]);
  });
}
