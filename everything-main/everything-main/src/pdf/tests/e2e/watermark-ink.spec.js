import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';

for (const layout of ['horizontal', 'diagonal'])
  test(`watermark accents and descenders fit on a short page (${layout})`, async ({
    page,
  }, testInfo) => {
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/#library');
    const doc = await PDFDocument.create();
    doc.addPage([300, 20]);
    const opening = page.waitForEvent('filechooser');
    await page.keyboard.press('ControlOrMeta+o');
    await (
      await opening
    ).setFiles({
      name: 'watermark.pdf',
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
    await page.getByRole('menu').getByRole('menuitem', { name: 'Watermark…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add watermark', exact: true });
    const label = 'Åg';
    await dialog.getByLabel('Text', { exact: true }).fill(label);
    await dialog.getByLabel('Layout', { exact: true }).selectOption(layout);
    await dialog.getByLabel('Opacity', { exact: true }).fill('100');
    await dialog.getByRole('button', { name: 'Add watermark', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await page.screenshot({ path: testInfo.outputPath('watermark.png') });
    const ink = await page
      .locator('.workspace .paper > canvas')
      .first()
      .evaluate((canvas) => {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let top = canvas.height,
          bottom = -1;
        for (let y = 0; y < canvas.height; y++)
          for (let x = 0; x < canvas.width; x++)
            if (data[(y * canvas.width + x) * 4] < 200) {
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
            }
        return { top, bottom, height: canvas.height };
      });
    expect(ink.bottom).toBeGreaterThan(ink.top);
    expect(ink.top).toBeGreaterThan(0);
    expect(ink.bottom).toBeLessThan(ink.height - 1);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const bytes = new Uint8Array(await readFile(await (await downloading).path()));
    const task = pdfjs.getDocument({ data: bytes });
    try {
      const pdf = await task.promise;
      for (let i = 1; i <= 1; i++) {
        const content = await (await pdf.getPage(i)).getTextContent();
        expect(content.items.map((item) => item.str).join('')).toBe(label);
      }
    } finally {
      await task.destroy();
    }
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator('.textLayer')).not.toContainText(label);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(page.locator('.textLayer')).toContainText(label);
  });
