import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { nestedFormPdf } from '../fixtures/nested-form.js';

for (const depth of [1, 2])
  for (const surface of ['page', 'dialog'])
    test(`edits form fields below unnamed groups (${surface}, depth=${depth})`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const { doc, text } = await nestedFormPdf({ depth });
      const open = async (document) => {
        const pending = page.waitForEvent('filechooser');
        await page.keyboard.press('ControlOrMeta+o');
        await (
          await pending
        ).setFiles({
          name: 'nested-form.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await document.save({ updateFieldAppearances: false })),
        });
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      };
      await open(doc);
      const onPage = page.getByLabel('Customer.Name (on page)', { exact: true });
      await expect(onPage).toHaveValue('Original');
      if (surface === 'page') {
        await onPage.fill('Nested update');
        await onPage.press('Enter');
        await expect(page.locator('.form-edit-error')).toBeHidden();
      } else {
        await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Fill forms' });
        await dialog.getByLabel('Customer.Name', { exact: true }).fill('Nested update');
        await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
        await expect(dialog).toHaveCount(0);
      }
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const saved = await PDFDocument.load(await readFile(await (await pending).path()));
      expect(saved.context.lookup(text.ref).lookup(PDFName.of('V')).decodeText()).toBe(
        'Nested update',
      );
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(onPage).toHaveValue('Original');
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(onPage).toHaveValue('Nested update');
      await open(saved);
      await expect(onPage).toHaveValue('Nested update');
    });
