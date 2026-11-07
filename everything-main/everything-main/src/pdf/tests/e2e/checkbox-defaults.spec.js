import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { checkboxOptionsPdf, useCheckboxDefault } from '../fixtures/checkbox-options.js';

for (const inherited of [false, true])
  for (const mode of ['on page', 'dialog'])
    test(`clears default-only checkbox groups (${mode}, inherited=${inherited})`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const { doc, field } = await checkboxOptionsPdf({ inherited, indirect: true, selected: 'B' });
      useCheckboxDefault(doc, field);
      const name = field.getName();
      const open = async (document) => {
        const pending = page.waitForEvent('filechooser');
        await page.keyboard.press('ControlOrMeta+o');
        await (
          await pending
        ).setFiles({
          name: 'checkbox-default.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await document.save({ updateFieldAppearances: false })),
        });
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      };
      const download = async () => {
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        return PDFDocument.load(await readFile(await (await pending).path()));
      };
      await open(doc);
      const box = page.getByRole('checkbox', { name: `${name}: Pickup (on page)`, exact: true });
      await expect(box).toBeChecked();
      if (mode === 'on page') await box.uncheck();
      else {
        await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Fill forms' });
        const choice = dialog.getByLabel(name, { exact: true });
        await expect(choice).toHaveValue('Pickup');
        await choice.selectOption({ index: 0 });
        await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
        await expect(dialog).not.toBeVisible();
      }
      const saved = await download();
      expect(saved.getForm().getCheckBox(name).acroField.V()?.decodeText()).toBe('Off');
      await expect(box).not.toBeChecked();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(box).toBeChecked();
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(box).not.toBeChecked();
      await open(saved);
      await expect(box).not.toBeChecked();
      await page.getByRole('checkbox', { name: `${name}: Courier (on page)`, exact: true }).check();
      expect((await download()).getForm().getCheckBox(name).acroField.getValue().decodeText()).toBe(
        'A',
      );
    });
