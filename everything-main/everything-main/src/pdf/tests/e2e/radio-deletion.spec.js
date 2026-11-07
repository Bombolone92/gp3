import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { radioPagesPdf } from '../fixtures/radio-pages.js';

for (const defaultOnly of [false, true])
  for (const exportNamed of [false, true])
    for (const selected of ['Courier', 'Pickup'])
      test(`deleting a page preserves surviving radio selections (default=${defaultOnly}, exports=${exportNamed}, selected=${selected})`, async ({
        page,
      }) => {
        await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
        await page.goto('/#library');
        const { doc, field } = await radioPagesPdf({
          defaultOnly,
          selected,
          inherited: true,
          exportNamed,
        });
        const name = field.getName();
        const open = async (document) => {
          const pending = page.waitForEvent('filechooser');
          await page.keyboard.press('ControlOrMeta+o');
          await (
            await pending
          ).setFiles({
            name: 'radio-pages.pdf',
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
        const choice = async (value) => {
          await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
          const dialog = page.getByRole('dialog', { name: 'Fill forms' });
          await expect(dialog.getByLabel(name, { exact: true })).toHaveValue(value);
          await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        };
        await open(doc);
        await choice(selected);
        const bar = page.getByRole('menubar', { name: 'PDF menus' });
        if (await bar.isVisible())
          await bar.getByRole('menuitem', { name: 'Page', exact: true }).click();
        else {
          await page.getByRole('button', { name: 'Menu', exact: true }).click();
          await page.getByRole('menu').getByRole('menuitem', { name: 'Page', exact: true }).click();
        }
        await page
          .getByRole('menu')
          .getByRole('menuitem', { name: 'Delete page', exact: true })
          .click();
        await page.getByRole('button', { name: 'Delete page', exact: true }).click();
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
        const kept = selected === 'Pickup';
        const pickup = page.getByRole('radio', { name: `${name}: Pickup (on page)`, exact: true });
        await expect(pickup).toBeChecked({ checked: kept });
        await choice(kept ? 'Pickup' : '');
        const saved = await download();
        const savedField = saved.getForm().getRadioGroup(name);
        expect(savedField.acroField.V()?.decodeText()).toBe(
          kept ? (defaultOnly ? undefined : exportNamed ? 'Pickup' : '1') : 'Off',
        );
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
        await choice(selected);
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
        await expect(pickup).toBeChecked({ checked: kept });
        await open(saved);
        await expect(pickup).toBeChecked({ checked: kept });
        await page.getByRole('radio', { name: `${name}: Express (on page)`, exact: true }).check();
        expect((await download()).getForm().getRadioGroup(name).getSelected()).toBe('Express');
      });
