import { test, expect } from '@playwright/test';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { damagedWidgetsPdf } from '../fixtures/damaged-widgets.js';

for (const type of ['text', 'checkbox', 'radio'])
  for (const removed of [0, 1, 2])
    test(`deleting page ${removed + 1} preserves readable widgets in a damaged ${type} form`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const original = await damagedWidgetsPdf(type),
        opening = page.waitForEvent('filechooser');
      await page.keyboard.press('ControlOrMeta+o');
      await (
        await opening
      ).setFiles({
        name: 'damaged-widgets.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(original),
      });
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      for (let i = 0; i < removed; i++) {
        await page.getByRole('button', { name: 'Next page', exact: true }).click();
        await expect(page.locator('.page-caption')).toHaveText(`Page ${i + 2} of 3`);
      }
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
      await expect(page.locator('.page-caption')).toHaveText(`Page ${removed ? 2 : 1} of 2`);
      const download = async () => {
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        return new Uint8Array(await readFile(await (await pending).path()));
      };
      const saved = await PDFDocument.load(await download()),
        field = saved.getForm().getField('Keep');
      const widgets = field.acroField
        .Kids()
        .asArray()
        .map((ref) => saved.context.lookup(ref))
        .filter((dict) => dict instanceof PDFDict);
      expect(widgets).toHaveLength(removed === 2 ? 2 : 1);
      if (type === 'text') expect(field.getText()).toBe('Retained value');
      else
        expect(field.acroField.dict.lookup(PDFName.of('V')).decodeText()).toBe(
          type === 'checkbox' ? 'Yes' : removed === 1 ? 'Off' : '1',
        );
      // Show the surviving form page; the unused third page may currently be selected.
      if (removed) await page.getByRole('button', { name: 'Previous page', exact: true }).click();
      await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
      if (type === 'text')
        await expect(
          page.getByRole('textbox', { name: 'Keep (on page)', exact: true }),
        ).toHaveValue('Retained value');
      else if (type === 'checkbox')
        await expect(
          page.getByRole('checkbox', { name: 'Keep (on page)', exact: true }),
        ).toBeChecked();
      else
        await expect(
          page.getByRole('radio', {
            name: `Keep: ${removed === 0 ? 'Second' : 'First'} (on page)`,
            exact: true,
          }),
        ).toBeChecked({ checked: removed === 0 });
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.locator('.page-caption')).toContainText('of 3');
      expect(await download()).toEqual(original);
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(page.locator('.page-caption')).toContainText('of 2');
      expect((await PDFDocument.load(await download())).getPageCount()).toBe(2);
    });
