import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { unnamedParentPdf } from '../fixtures/unnamed-form-parent.js';

for (const parentName of [undefined, ''])
  for (const mode of ['on page', 'dialog', 'literal name'])
    test(`edits fields with unnamed parents (${mode}, parent=${parentName})`, async ({ page }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const { doc } = await unnamedParentPdf({ parentName });
      const name = parentName === undefined ? 'Name' : '.Name';
      const open = async (document) => {
        const pending = page.waitForEvent('filechooser');
        await page.keyboard.press('ControlOrMeta+o');
        await (
          await pending
        ).setFiles({
          name: 'unnamed-parent.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await document.save({ updateFieldAppearances: false })),
        });
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      };
      await open(doc);
      const input = page.getByRole('textbox', { name: `${name} (on page)`, exact: true });
      const other = page.getByRole('textbox', { name: 'undefined.Name (on page)', exact: true });
      await expect(input).toHaveValue('Original');
      const expectedName = mode === 'literal name' ? 'Original' : 'Updated';
      const expectedOther = mode === 'on page' ? 'Separate field' : 'Separate update';
      if (mode !== 'dialog') {
        const target = mode === 'literal name' ? other : input;
        await target.fill(mode === 'literal name' ? expectedOther : expectedName);
        await target.press('Tab');
      } else {
        await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Fill forms' });
        await dialog.getByLabel(name, { exact: true }).fill('Updated');
        await dialog.getByLabel('undefined.Name', { exact: true }).fill('Separate update');
        await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
        await expect(dialog).toHaveCount(0);
      }
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const saved = await PDFDocument.load(await readFile(await (await pending).path()));
      const texts = saved
        .getForm()
        .getFields()
        .filter((field) => typeof field.getText === 'function');
      expect(texts.map((field) => field.getText())).toEqual([expectedName, expectedOther]);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(input).toHaveValue('Original');
      await expect(other).toHaveValue('Separate field');
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(input).toHaveValue(expectedName);
      await expect(other).toHaveValue(expectedOther);
      await open(saved);
      await expect(input).toHaveValue(expectedName);
      await expect(other).toHaveValue(expectedOther);
    });
