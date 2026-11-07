import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { spellcheckFormPdf } from '../fixtures/spellcheck-form.js';

for (const inherited of [false, true])
  for (const readOnly of [false, true])
    for (const surface of ['page', 'dialog'])
      test(`form spellchecking follows PDF flags (${surface}, inherited=${inherited}, readOnly=${readOnly})`, async ({
        page,
      }) => {
        await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
        await page.goto('/#library');
        const { doc, fields } = await spellcheckFormPdf({ inherited, readOnly });
        const open = async (document) => {
          const pending = page.waitForEvent('filechooser');
          await page.keyboard.press('ControlOrMeta+o');
          await (
            await pending
          ).setFiles({
            name: 'spellcheck.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from(await document.save()),
          });
          await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        };
        const dialog = page.getByRole('dialog', { name: 'Fill forms' });
        const control = (name) =>
          (surface === 'dialog' ? dialog : page).getByLabel(
            `${name}${surface === 'page' ? ' (on page)' : ''}${readOnly ? ' (read only)' : ''}`,
            { exact: true },
          );
        const check = async () => {
          if (surface === 'dialog')
            await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
          for (const { name, kind, enabled } of fields) {
            await expect(control(name)).toHaveJSProperty(
              'spellcheck',
              enabled && kind !== 'Password',
            );
            await expect(control(name)).toHaveValue('Original');
            if (readOnly) await expect(control(name)).not.toBeEditable();
          }
        };
        await open(doc);
        await check();
        if (!readOnly) await control(fields[0].name).fill('Changed');
        if (surface === 'dialog')
          await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        const saved = await PDFDocument.load(await readFile(await (await pending).path()));
        for (const { name, enabled } of fields)
          expect(saved.getForm().getField(name).isSpellChecked()).toBe(enabled);
        expect(saved.getForm().getTextField(fields[0].name).getText()).toBe(
          readOnly ? 'Original' : 'Changed',
        );
        if (!readOnly) {
          await page.getByRole('button', { name: 'Undo', exact: true }).click();
          await expect(page.getByLabel(`${fields[0].name} (on page)`, { exact: true })).toHaveValue(
            'Original',
          );
          await page.getByRole('button', { name: 'Redo', exact: true }).click();
          await expect(page.getByLabel(`${fields[0].name} (on page)`, { exact: true })).toHaveValue(
            'Changed',
          );
        }
        await open(saved);
        if (surface === 'dialog')
          await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
        for (const { name, kind, enabled } of fields)
          await expect(control(name)).toHaveJSProperty(
            'spellcheck',
            enabled && kind !== 'Password',
          );
      });
