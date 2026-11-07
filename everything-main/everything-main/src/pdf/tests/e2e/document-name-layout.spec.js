import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const filename = 'Very long report for customers and partners.pdf';
for (const width of [320, 360, 375, 390, 430, 768, 1280])
  for (const protectedPdf of [false, true])
    test(`long filename stays within its header at ${width}px, ${protectedPdf ? 'protected' : 'ordinary'}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      let buffer;
      if (protectedPdf)
        buffer = await readFile(new URL('../fixtures/security/owner-only.pdf', import.meta.url));
      else {
        const doc = await PDFDocument.create();
        doc.addPage([400, 500]);
        buffer = Buffer.from(await doc.save());
      }
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: /Open a PDF/ }).click();
      await (await chooser).setFiles({ name: filename, mimeType: 'application/pdf', buffer });
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      await expect(
        page.getByRole('button', { name: 'Sign in to save', exact: true }),
      ).toBeVisible();
      const rename = page.getByRole('button', { name: `Rename ${filename}`, exact: true });
      await expect(rename).toHaveAttribute('title', filename);
      const hitNames = await rename.evaluate((button) => {
        const box = button.getBoundingClientRect();
        return [box.x + 2, box.x + box.width / 2, box.right - 2].map((x) =>
          document
            .elementFromPoint(x, box.y + box.height / 2)
            ?.closest('button')
            ?.getAttribute('aria-label'),
        );
      });
      expect(hitNames).toEqual(Array(3).fill(`Rename ${filename}`));
      if (width === 390 && protectedPdf)
        await page.screenshot({ path: testInfo.outputPath('long-filename.png') });
      const box = await rename.boundingBox();
      const downloads = [];
      page.on('download', (download) => downloads.push(download.suggestedFilename()));
      // Exercise the edge that used to invoke Download rather than rename.
      await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
      const dialog = page.getByRole('dialog', { name: 'Name this PDF', exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel('File name', { exact: true })).toHaveValue(
        filename.slice(0, -4),
      );
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(downloads).toEqual([]);
      await expect(rename).toBeVisible();
      await expect(page.locator('.page-caption')).toHaveText(`Page 1 of ${protectedPdf ? 2 : 1}`);
    });
