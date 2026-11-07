import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { offExportPdf } from '../fixtures/off-export.js';

for (const kind of ['radio', 'checkbox'])
  for (const inherited of [false, true])
    for (const defaultOnly of [false, true])
      test(`form ${kind} keeps an Off export distinct from no selection (inherited=${inherited}, default=${defaultOnly})`, async ({
        page,
      }) => {
        await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
        await page.goto('/#library');
        const { doc } = await offExportPdf({ kind, inherited, defaultOnly });
        const open = async (document) => {
          const pending = page.waitForEvent('filechooser');
          await page.keyboard.press('ControlOrMeta+o');
          await (
            await pending
          ).setFiles({
            name: 'off-export.pdf',
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
        const off = page.getByRole(kind, {
          name: `Settings.Mode${kind === 'radio' ? ': Off' : ''} (on page)`,
          exact: true,
        });
        const other = page.getByRole(kind, {
          name: `Settings.Mode${kind === 'radio' ? ': Other' : ''} (on page)`,
          exact: true,
        });
        await open(doc);
        await expect(off).toBeChecked();
        await page.getByRole('button', { name: 'Next page', exact: true }).click();
        await expect(other).not.toBeChecked();
        await other.check();
        expect(
          (await download()).getForm().getField('Settings.Mode').acroField.getValue().decodeText(),
        ).toBe('1');
        await page.getByRole('button', { name: 'Previous page', exact: true }).click();
        await expect(off).not.toBeChecked();
        await off.check();
        const saved = await download();
        expect(saved.getForm().getField('Settings.Mode').acroField.getValue().decodeText()).toBe(
          '0',
        );
        await expect(off).toBeChecked();
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(off).not.toBeChecked();
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect(off).toBeChecked();
        await open(saved);
        await expect(off).toBeChecked();
        await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Fill forms' });
        await expect(dialog.getByLabel('Settings.Mode', { exact: true })).toHaveValue('Off');
        await dialog
          .getByLabel('Settings.Mode', { exact: true })
          .selectOption({ label: 'Choose an option' });
        await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
        await expect(off).not.toBeChecked();
        const cleared = await download();
        expect(cleared.getForm().getField('Settings.Mode').acroField.getValue().decodeText()).toBe(
          'Off',
        );
        await open(cleared);
        await expect(off).not.toBeChecked();
        await off.check();
        expect(
          (await download()).getForm().getField('Settings.Mode').acroField.getValue().decodeText(),
        ).toBe('0');
      });
