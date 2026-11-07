import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { checkboxDeletionPdf } from '../fixtures/checkbox-options.js';

for (const inherited of [false, true])
  for (const selected of ['A', 'B'])
    test(`deleting a page retains checkbox option names (inherited=${inherited}, selected=${selected})`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const { doc, field } = await checkboxDeletionPdf({ inherited, indirect: true, selected });
      const name = field.getName();
      const open = async (document) => {
        const pending = page.waitForEvent('filechooser');
        await page.keyboard.press('ControlOrMeta+o');
        await (
          await pending
        ).setFiles({
          name: 'checkbox-pages.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await document.save()),
        });
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      };
      const download = async () => {
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        return PDFDocument.load(await readFile(await (await pending).path()));
      };
      const options = async (expected, selected) => {
        await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Fill forms' });
        const choice = dialog.getByLabel(name, { exact: true });
        await expect(choice.locator('option')).toHaveText(['Choose an option', ...expected]);
        await expect(choice).toHaveValue(selected);
        return dialog;
      };
      await open(doc);
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
      const keptSelection = selected === 'B' ? 'Pickup' : '';
      let dialog = await options(['Pickup', 'Express'], keptSelection);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(
        page.getByRole('checkbox', { name: `${name}: Pickup (on page)`, exact: true }),
      ).toBeChecked({ checked: selected === 'B' });
      const saved = await download();
      const savedField = saved.getForm().getCheckBox(name);
      expect(savedField.acroField.getValue().decodeText()).toBe(selected === 'B' ? 'B' : 'Off');
      const exports = savedField.acroField.dict.lookup(PDFName.of('Opt'));
      expect(
        Array.from({ length: exports.size() }, (_, i) => exports.lookup(i).decodeText()),
      ).toEqual(['Pickup', 'Express']);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
      dialog = await options(
        ['Courier', 'Pickup', 'Express'],
        selected === 'A' ? 'Courier' : 'Pickup',
      );
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
      dialog = await options(['Pickup', 'Express'], keptSelection);
      await dialog.getByLabel(name, { exact: true }).selectOption('Express');
      await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
      const edited = await download();
      expect(edited.getForm().getCheckBox(name).acroField.getValue().decodeText()).toBe('C');
      await open(edited);
      await expect(
        page.getByRole('checkbox', { name: `${name}: Express (on page)`, exact: true }),
      ).toBeChecked();
    });
