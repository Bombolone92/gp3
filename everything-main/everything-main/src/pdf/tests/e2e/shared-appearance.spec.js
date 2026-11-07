import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { sharedAppearancePdf } from '../fixtures/shared-appearance.js';
import { rendered } from '../helpers/list-render.js';

for (const kind of ['text', 'dropdown', 'list'])
  for (const edit of ['page', 'dialog'])
    test(`editing one ${kind} preserves a field sharing its appearance (${edit})`, async ({
      page,
    }, testInfo) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const { doc } = await sharedAppearancePdf({ kind });
      const original = await doc.save();
      const before = (await rendered(original)).pixels;
      const opening = page.waitForEvent('filechooser');
      await page.keyboard.press('ControlOrMeta+o');
      await (
        await opening
      ).setFiles({
        name: 'shared-appearance.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(original),
      });
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      let control;
      if (edit === 'dialog') {
        await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
        control = page
          .getByRole('dialog', { name: 'Fill forms' })
          .getByLabel('First', { exact: true });
      } else control = page.getByLabel('First (on page)', { exact: true });
      if (kind === 'text') await control.fill('New');
      else await control.selectOption('New');
      if (edit === 'dialog')
        await page
          .getByRole('dialog', { name: 'Fill forms' })
          .getByRole('button', { name: 'Save form', exact: true })
          .click();
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const bytes = new Uint8Array(await readFile(await (await downloading).path()));
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      await page.screenshot({ path: testInfo.outputPath('edited.png') });
      const fields = (await PDFDocument.load(bytes)).getForm();
      const first = fields.getField('First');
      const second = fields.getField('Second');
      expect(kind === 'text' ? first.getText() : first.getSelected()).toEqual(
        kind === 'text' ? 'New' : ['New'],
      );
      expect(kind === 'text' ? second.getText() : second.getSelected()).toEqual(
        kind === 'text' ? 'Old' : ['Old'],
      );
      const after = (await rendered(bytes)).pixels;
      expect(after.subarray(after.length / 2).equals(before.subarray(before.length / 2))).toBe(
        true,
      );
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.getByLabel('First (on page)', { exact: true })).toHaveValue('Old');
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(page.getByLabel('First (on page)', { exact: true })).toHaveValue('New');
    });
