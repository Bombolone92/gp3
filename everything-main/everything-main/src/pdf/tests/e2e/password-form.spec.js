import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { passwordFormPdf } from '../fixtures/password-form.js';

for (const inherited of [false, true])
  for (const readOnly of [false, true])
    test(`Fill forms masks password fields (inherited=${inherited}, readOnly=${readOnly})`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const { doc } = await passwordFormPdf({ inherited, readOnly });
      const suffix = readOnly ? ' (read only)' : '';
      const open = async (document) => {
        const pending = page.waitForEvent('filechooser');
        await page.keyboard.press('ControlOrMeta+o');
        await (
          await pending
        ).setFiles({
          name: 'password-form.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await document.save()),
        });
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      };
      await open(doc);
      const onPage = page.getByLabel(`Account.Secret (on page)${suffix}`, { exact: true });
      await expect(onPage).toHaveAttribute('type', 'password');
      await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Fill forms' });
      const secret = dialog.getByLabel(`Account.Secret${suffix}`, { exact: true });
      await expect(secret).toHaveAttribute('type', 'password');
      await expect(secret).toHaveAttribute('autocomplete', 'off');
      await expect(secret).toHaveAttribute('spellcheck', 'false');
      await expect(secret).toHaveValue('Example passphrase');
      if (readOnly) await expect(secret).toBeDisabled();
      else await secret.fill('Changed passphrase');
      await expect(dialog.getByLabel('Name', { exact: true })).toHaveAttribute('type', 'text');
      await dialog.getByLabel('Name', { exact: true }).fill('Updated name');
      const notes = dialog.getByLabel('Notes', { exact: true });
      await expect(notes).toHaveJSProperty('tagName', 'TEXTAREA');
      await expect(notes).toHaveValue('First line\nSecond line');
      await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const expected = readOnly ? 'Example passphrase' : 'Changed passphrase';
      await expect(onPage).toHaveValue(expected);
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const saved = await PDFDocument.load(await readFile(await (await pending).path()));
      const savedSecret = saved.getForm().getTextField('Account.Secret');
      expect(savedSecret.isPassword()).toBe(true);
      expect(savedSecret.isReadOnly()).toBe(readOnly);
      expect(savedSecret.getText()).toBe(expected);
      expect(saved.getForm().getTextField('Name').getText()).toBe('Updated name');
      expect(saved.getForm().getTextField('Notes').getText()).toBe('First line\nSecond line');
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.getByLabel('Name (on page)', { exact: true })).toHaveValue('Original name');
      await expect(onPage).toHaveValue('Example passphrase');
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(page.getByLabel('Name (on page)', { exact: true })).toHaveValue('Updated name');
      await expect(onPage).toHaveValue(expected);
      await open(saved);
      await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
      await expect(secret).toHaveAttribute('type', 'password');
      await expect(secret).toHaveValue(expected);
    });
