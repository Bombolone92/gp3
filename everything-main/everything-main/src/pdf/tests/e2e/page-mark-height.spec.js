import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';

for (const kind of ['header', 'number'])
  for (const edge of ['top', 'bottom'])
    test(`a vertically clipped ${kind} at ${edge} can be corrected without changing the PDF`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const doc = await PDFDocument.create();
      doc.addPage([300, 30]);
      const label = kind === 'header' ? 'Åg' : '1';
      doc.setTitle(label);
      const opening = page.waitForEvent('filechooser');
      await page.keyboard.press('ControlOrMeta+o');
      await (
        await opening
      ).setFiles({
        name: 'report.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await doc.save()),
      });
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      const bar = page.getByRole('menubar', { name: 'PDF menus' });
      if (await bar.isVisible())
        await bar.getByRole('menuitem', { name: 'Insert', exact: true }).click();
      else {
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
        await page.getByRole('menu').getByRole('menuitem', { name: 'Insert', exact: true }).click();
      }
      await page
        .getByRole('menu')
        .getByRole('menuitem', {
          name: kind === 'header' ? 'Header and footer…' : 'Page numbers…',
          exact: true,
        })
        .click();
      const dialog = page.getByRole('dialog', {
        name: kind === 'header' ? 'Header and footer' : 'Add page numbers',
        exact: true,
      });
      const apply = dialog.getByRole('button', {
        name: kind === 'header' ? 'Add header and footer' : 'Add page numbers',
        exact: true,
      });
      const size = dialog.getByLabel('Size (pt)', { exact: true });
      if (kind === 'header') {
        await dialog
          .getByLabel(edge === 'top' ? 'Top center' : 'Bottom center', { exact: true })
          .fill('{title}');
        await size.fill('36');
      } else {
        await dialog.getByLabel('Format', { exact: true }).selectOption('plain');
        await dialog.getByLabel('Position', { exact: true }).selectOption(`${edge}-center`);
        await size.fill('72');
      }
      await apply.click();
      await expect(dialog.getByRole('alert')).toContainText('too tall for page 1');
      await expect(size).toHaveValue(kind === 'header' ? '36' : '72');
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      await expect(page.locator('.textLayer')).not.toContainText(label);
      if (kind === 'header')
        await expect(
          dialog.getByLabel(edge === 'top' ? 'Top center' : 'Bottom center', { exact: true }),
        ).toHaveValue('{title}');
      else await expect(dialog.getByLabel('Start at', { exact: true })).toHaveValue('1');
      await size.fill('6');
      await apply.click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('.textLayer')).toContainText(label);
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const task = pdfjs.getDocument({
        data: new Uint8Array(await readFile(await (await downloading).path())),
      });
      try {
        const pdf = await task.promise;
        const content = await (await pdf.getPage(1)).getTextContent();
        expect(content.items.map((item) => item.str).join('')).toBe(label);
      } finally {
        await task.destroy();
      }
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.locator('.textLayer')).not.toContainText(label);
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(page.locator('.textLayer')).toContainText(label);
    });
