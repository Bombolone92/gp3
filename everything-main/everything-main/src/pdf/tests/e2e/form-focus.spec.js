import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

for (const fails of [false, true])
  for (const moved of [false, true])
    test(`a form commit ${fails ? 'failure' : 'success'} preserves ${moved ? 'newer control focus' : 'field focus and caret'}`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const doc = await PDFDocument.create();
      const sheet = doc.addPage([400, 500]);
      const field = doc.getForm().createTextField('Response');
      field.setText('Original');
      field.addToPage(sheet, { x: 40, y: 300, width: 300, height: 40 });
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press('ControlOrMeta+o');
      await (
        await chooser
      ).setFiles({
        name: 'form-focus.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await doc.save()),
      });
      const input = page.getByLabel('Response (on page)', { exact: true });
      await input.fill('Reviewed response');
      await input.press('ArrowLeft');
      await input.press('ArrowLeft');
      const caret = await input.evaluate((node) => node.selectionStart);
      await page.evaluate(async (fails) => {
        const { blankPdf, validatePdf } = await import('/src/core/document.js');
        const prototype = Object.getPrototypeOf(await validatePdf(await blankPdf()));
        const save = prototype.save;
        prototype.save = async function (...args) {
          prototype.save = save;
          const bytes = await save.apply(this, args);
          await new Promise((resolve) => {
            window.releaseForm = resolve;
          });
          if (fails) throw new Error('Delayed form save failed.');
          return bytes;
        };
      }, fails);
      await input.press('Enter');
      await expect.poll(() => page.evaluate(() => !!window.releaseForm)).toBe(true);
      await expect(input).toBeDisabled();
      const settings = page.getByRole('button', { name: 'Settings', exact: true });
      if (moved) await settings.focus();
      await page.evaluate(() => window.releaseForm());
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      if (fails)
        await expect(page.locator('.form-edit-error')).toHaveText('Delayed form save failed.');
      else await expect(page.locator('.form-edit-error')).toBeHidden();
      await expect(input).toHaveValue('Reviewed response');
      await expect(moved ? settings : input).toBeFocused();
      if (moved) {
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
        await expect(dialog).toHaveCount(0);
      } else {
        await expect(input).toHaveJSProperty('selectionStart', caret);
        await expect(input).toHaveJSProperty('selectionEnd', caret);
      }
      if (fails) {
        await input.press('Enter');
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        await expect(page.locator('.form-edit-error')).toBeHidden();
      }
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const saved = await PDFDocument.load(await readFile(await (await pending).path()));
      expect(saved.getForm().getTextField('Response').getText()).toBe('Reviewed response');
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(input).toHaveValue('Original');
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(input).toHaveValue('Reviewed response');
    });
