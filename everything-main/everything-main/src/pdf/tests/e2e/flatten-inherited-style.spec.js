import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName, PDFBool } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { inheritedAppearancePdf } from '../fixtures/inherited-appearance.js';
import { inheritedAlignmentPdf } from '../fixtures/inherited-alignment.js';
import { inheritedTextLimitPdf } from '../fixtures/inherited-text-limit.js';

async function pixels(bytes) {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
      .pathname,
  });
  try {
    const page = await (await task.promise).getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;
    return Buffer.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
  } finally {
    await task.destroy();
  }
}
for (const kind of ['text', 'dropdown', 'list', 'alignment', 'comb'])
  for (const stale of [false, true])
    test(`flatten preserves inherited ${kind} styling through export and undo (stale=${stale})`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const { doc: source } =
        kind === 'alignment'
          ? await inheritedAlignmentPdf({
              alignment: 2,
              multiline: true,
              rotation: 90,
              indirect: true,
            })
          : kind === 'comb'
            ? await inheritedTextLimitPdf({ comb: true, indirect: true })
            : await inheritedAppearancePdf({ kind, level: 'form', indirect: true });
      const original = await source.save();
      const doc = await PDFDocument.load(original);
      if (stale) doc.getForm().acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
      else
        for (const field of doc.getForm().getFields())
          for (const widget of field.acroField.getWidgets()) widget.dict.delete(PDFName.of('AP'));
      const opening = page.waitForEvent('filechooser');
      await page.keyboard.press('ControlOrMeta+o');
      await (
        await opening
      ).setFiles({
        name: 'flatten-styled-form.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await doc.save({ updateFieldAppearances: false })),
      });
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      const bar = page.getByRole('menubar', { name: 'PDF menus' });
      if (await bar.isVisible())
        await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
      else await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('menu').getByRole('menuitem', { name: 'Flatten…', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Flatten', exact: true });
      await dialog.getByRole('button', { name: 'Flatten', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      await expect(page.locator('.form-control')).toHaveCount(0);
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const bytes = new Uint8Array(await readFile(await (await downloading).path()));
      expect((await PDFDocument.load(bytes)).getForm().getFields()).toHaveLength(0);
      expect((await pixels(bytes)).equals(await pixels(original))).toBe(true);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Fill forms', exact: true })).toBeEnabled();
      await expect(page.locator('.form-control')).toHaveCount(1);
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      await expect(page.locator('.form-control')).toHaveCount(0);
    });
