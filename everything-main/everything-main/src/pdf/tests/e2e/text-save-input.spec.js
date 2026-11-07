import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

for (const kind of ['new', 'existing'])
  for (const fails of [false, true])
    test(`${kind} text stays locked during a pending ${fails ? 'failed' : 'successful'} save and resumes editing after failure`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const doc = await PDFDocument.create();
      doc.addPage([500, 600]).drawText('Original text', { x: 60, y: 350, size: 18 });
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press('ControlOrMeta+o');
      await (
        await chooser
      ).setFiles({
        name: 'text-lock.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await doc.save()),
      });
      await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
      await page.getByRole('button', { name: 'Text', exact: true }).click();
      if (kind === 'new')
        await page.getByRole('button', { name: 'Place at page center', exact: true }).click();
      else
        await page.getByRole('button', { name: 'Edit text: Original text', exact: true }).click();
      const input = page.locator('.page-text-input');
      await input.fill('Committed text');
      await page.evaluate(async (fails) => {
        const { PdfSession } = await import('/src/core/document.js');
        const change = PdfSession.prototype.change;
        PdfSession.prototype.change = async function (...args) {
          PdfSession.prototype.change = change;
          await new Promise((resolve) => {
            window.releaseTextSave = resolve;
          });
          if (fails) throw new Error('Delayed text save failed.');
          return change.apply(this, args);
        };
      }, fails);
      await input.press('ControlOrMeta+Enter');
      await expect.poll(() => page.evaluate(() => !!window.releaseTextSave)).toBe(true);
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'true');
      await page.keyboard.type('Uncommitted typing');
      await expect(input).toHaveValue('Committed text');
      await page.evaluate(() => window.releaseTextSave());
      if (fails) {
        await expect(page.locator('.text-edit-error')).toHaveText('Delayed text save failed.');
        await expect(input).toBeFocused();
        await input.press('End');
        await page.keyboard.type('X');
        await expect(input).toHaveValue('Committed textX');
        await input.press('Backspace');
        await expect(input).toHaveValue('Committed text');
        await input.press('ControlOrMeta+Enter');
      }
      await expect(input).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Edit text: Committed text', exact: true }),
      ).toHaveCount(1);
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = pdfjs.getDocument({
        data: new Uint8Array(await readFile(await (await pending).path())),
        standardFontDataUrl: new URL(
          '../../node_modules/pdfjs-dist/standard_fonts/',
          import.meta.url,
        ).pathname,
      });
      try {
        const content = await (await (await task.promise).getPage(1)).getTextContent();
        expect(content.items.map((item) => item.str).filter(Boolean)).toEqual(
          kind === 'new' ? ['Original text', 'Committed text'] : ['Committed text'],
        );
      } finally {
        await task.destroy();
      }
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Edit text: Original text', exact: true }),
      ).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    });
