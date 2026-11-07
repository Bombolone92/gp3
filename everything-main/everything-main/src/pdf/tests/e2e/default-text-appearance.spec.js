import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { defaultTextPdf } from '../fixtures/default-text.js';

async function rendered(bytes) {
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
    const ops = await page.getOperatorList();
    return {
      pixels: Buffer.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
      text: ops.fnArray
        .flatMap((fn, i) =>
          fn === pdfjs.OPS.showText ? ops.argsArray[i][0].map((g) => g.unicode || '') : [],
        )
        .join(''),
    };
  } finally {
    await task.destroy();
  }
}
for (const kind of ['text', 'multiline', 'password', 'comb'])
  for (const inherited of [false, true])
    for (const action of ['flatten', 'neighbor'])
      test(`default ${kind} text survives ${action}, export and history (inherited=${inherited})`, async ({
        page,
      }) => {
        await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
        await page.goto('/#library');
        const { doc, field, shown, defaultValue } = await defaultTextPdf({ kind, inherited });
        const original = await rendered(await doc.save());
        for (const widget of field.acroField.getWidgets()) widget.dict.delete(PDFName.of('AP'));
        const opening = page.waitForEvent('filechooser');
        await page.keyboard.press('ControlOrMeta+o');
        await (
          await opening
        ).setFiles({
          name: 'default-text.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await doc.save({ updateFieldAppearances: false })),
        });
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        const control = page.getByLabel('Group.Value (on page)', { exact: true });
        await expect(control).toHaveValue(defaultValue);
        if (action === 'flatten') {
          const bar = page.getByRole('menubar', { name: 'PDF menus' });
          if (await bar.isVisible())
            await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
          else await page.getByRole('button', { name: 'Menu', exact: true }).click();
          await page
            .getByRole('menu')
            .getByRole('menuitem', { name: 'Flatten…', exact: true })
            .click();
          const dialog = page.getByRole('dialog', { name: 'Flatten', exact: true });
          await dialog.getByRole('button', { name: 'Flatten', exact: true }).click();
          await expect(dialog).toHaveCount(0);
          await expect(page.locator('.form-control')).toHaveCount(0);
        } else
          await page.getByLabel('Neighbor (on page)', { exact: true }).fill('Updated neighbor');
        const downloading = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        const bytes = new Uint8Array(await readFile(await (await downloading).path()));
        const output = await rendered(bytes);
        const saved = await PDFDocument.load(bytes);
        if (action === 'flatten') {
          expect(saved.getForm().getFields()).toHaveLength(0);
          expect(output.pixels.equals(original.pixels)).toBe(true);
        } else {
          expect(saved.getForm().getTextField('Group.Value').acroField.V()).toBeUndefined();
          expect(output.text).toBe(shown.replaceAll('\n', '') + 'Updated neighbor');
        }
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(control).toHaveValue(defaultValue);
        await expect(page.getByLabel('Neighbor (on page)', { exact: true })).toHaveValue(
          'Original neighbor',
        );
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        if (action === 'flatten') await expect(page.locator('.form-control')).toHaveCount(0);
        else {
          await expect(control).toHaveValue(defaultValue);
          await expect(page.getByLabel('Neighbor (on page)', { exact: true })).toHaveValue(
            'Updated neighbor',
          );
        }
      });
