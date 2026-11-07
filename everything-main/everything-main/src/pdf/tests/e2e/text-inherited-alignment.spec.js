import { test, expect } from '@playwright/test';
import { PDFDocument, decodePDFRawStream } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { inheritedAlignmentPdf } from '../fixtures/inherited-alignment.js';

for (const alignment of [1, 2])
  for (const mode of ['page', 'dialog'])
    test(`editing an inherited alignment preserves exported positioning (Q=${alignment}, ${mode})`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const { doc } = await inheritedAlignmentPdf({ alignment, indirect: true });
      const opening = page.waitForEvent('filechooser');
      await page.keyboard.press('ControlOrMeta+o');
      await (
        await opening
      ).setFiles({
        name: 'aligned-field.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await doc.save()),
      });
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      const onPage = page.getByLabel('Address.Value (on page)', { exact: true });
      await expect(onPage).toHaveCSS('text-align', alignment === 1 ? 'center' : 'right');
      if (mode === 'page') await onPage.fill('Changed text');
      else {
        await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Fill forms' });
        await dialog.getByLabel('Address.Value', { exact: true }).fill('Changed text');
        await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
        await expect(dialog).toHaveCount(0);
      }
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const saved = await PDFDocument.load(await readFile(await (await downloading).path()));
      const field = saved.getForm().getTextField('Address.Value');
      const stream = saved.context.lookup(field.acroField.getWidgets()[0].getNormalAppearance());
      const operators = new TextDecoder().decode(decodePDFRawStream(stream).decode());
      const x = Number(/1 0 0 1 ([\d.]+) [\d.]+ Tm/.exec(operators)[1]);
      expect(x).toBeCloseTo(alignment === 1 ? 82.712 : 163.424, 2);
      expect(field.getText()).toBe('Changed text');
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(onPage).toHaveValue('Original');
      await expect(onPage).toHaveCSS('text-align', alignment === 1 ? 'center' : 'right');
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(onPage).toHaveValue('Changed text');
    });
