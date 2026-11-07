import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName, PDFBool } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { passwordFormPdf } from '../fixtures/password-form.js';

async function paintedText(bytes) {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
      .pathname,
  });
  try {
    const page = await (await task.promise).getPage(1);
    const operators = await page.getOperatorList();
    return operators.fnArray
      .flatMap((fn, i) =>
        fn === pdfjs.OPS.showText
          ? operators.argsArray[i][0].map((glyph) => glyph.unicode || '')
          : [],
      )
      .join('');
  } finally {
    await task.destroy();
  }
}

for (const inherited of [false, true])
  for (const action of ['page', 'dialog', 'flatten-missing', 'flatten-stale'])
    test(`password appearances stay masked after ${action} (inherited=${inherited})`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const { doc, secret } = await passwordFormPdf({ inherited });
      if (action === 'flatten-missing')
        secret.acroField.getWidgets()[0].dict.delete(PDFName.of('AP'));
      if (action === 'flatten-stale')
        doc.getForm().acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
      const opening = page.waitForEvent('filechooser');
      await page.keyboard.press('ControlOrMeta+o');
      await (
        await opening
      ).setFiles({
        name: 'password.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await doc.save({ updateFieldAppearances: false })),
      });
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      const flattened = action.startsWith('flatten');
      const value = flattened ? 'Example passphrase' : 'Changed secret';
      if (action === 'page')
        await page.getByLabel('Account.Secret (on page)', { exact: true }).fill(value);
      else if (action === 'dialog') {
        await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Fill forms' });
        await dialog.getByLabel('Account.Secret', { exact: true }).fill(value);
        await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
        await expect(dialog).toHaveCount(0);
      } else {
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
      }
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const bytes = new Uint8Array(await readFile(await (await downloading).path()));
      const saved = await PDFDocument.load(bytes);
      if (flattened) expect(saved.getForm().getFields()).toHaveLength(0);
      else expect(saved.getForm().getTextField('Account.Secret').getText()).toBe(value);
      const painted = await paintedText(bytes);
      expect(painted).not.toContain(value);
      expect(painted).toContain('*'.repeat(value.length));
      expect(painted).toContain('Original name');
    });
