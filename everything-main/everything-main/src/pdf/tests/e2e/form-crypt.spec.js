import { test, expect } from '@playwright/test';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cryptAppearance } from '../fixtures/crypt-appearance.js';
import { unlockPdf } from '../../src/core/security.js';

for (const [action, options] of [
  ['page', {}],
  ['dialog', { custom: true, indirect: true, shared: true }],
  ['dropdown', { kind: 'dropdown' }],
  ['Identity', { identity: true }],
])
  test(`form encryption survives ${action} edits and undo`, async ({ page }) => {
    const source = await cryptAppearance(options);
    await page.route('https://js.puter.com/**', (route) => route.abort());
    await page.goto('/#library');
    const opening = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Open a PDF/ }).click();
    await (
      await opening
    ).setFiles({
      name: 'form.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(source.bytes),
    });
    const unlock = page.getByRole('dialog', { name: 'Password required', exact: true });
    await unlock.getByLabel('Password', { exact: true }).fill('owner');
    await unlock.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    if (action === 'dialog' || action === 'dropdown') {
      await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Fill forms' });
      const control = dialog.getByLabel('private0', { exact: true });
      if (action === 'dropdown') await control.selectOption({ label: 'Changed secret' });
      else await control.fill('Changed secret');
      await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    } else {
      await page.getByLabel('private0 (on page)', { exact: true }).fill('Changed secret');
      await page.getByLabel('private0 (on page)', { exact: true }).press('Tab');
    }
    const control = page.getByLabel('private0 (on page)', { exact: true });
    await expect(control).toHaveValue('Changed secret');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(control).toHaveValue('Private field');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(control).toHaveValue('Changed secret');
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const bytes = new Uint8Array(await readFile(await (await downloading).path()));
    const raw = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const appearance = raw
      .getForm()
      .getFields()[0]
      .acroField.getWidgets()[0]
      .dict.lookup(PDFName.of('AP'))
      .lookup(PDFName.of('N'));
    const filters = appearance.dict.lookup(PDFName.of('Filter'));
    expect(filters instanceof PDFArray).toBe(true);
    expect(filters.lookup(0)).toBe(PDFName.of('Crypt'));
    expect(
      appearance.dict.lookup(PDFName.of('DecodeParms')).lookup(0).lookup(PDFName.of('Name')),
    ).toBe(PDFName.of(source.name));
    const opened = await unlockPdf(bytes, source.password);
    const working = await PDFDocument.load(opened.bytes, { updateMetadata: false });
    const field = working.getForm().getField('private0');
    expect(options.kind === 'dropdown' ? field.getSelected() : field.getText()).toEqual(
      options.kind === 'dropdown' ? ['Changed secret'] : 'Changed secret',
    );
    const clear = field.acroField
      .getWidgets()[0]
      .dict.lookup(PDFName.of('AP'))
      .lookup(PDFName.of('N'))
      .getContents();
    if (options.identity) expect(appearance.getContents()).toEqual(clear);
    else expect(appearance.getContents()).not.toEqual(clear);
    if (options.shared)
      expect(working.getForm().getTextField('private1').getText()).toBe('Private field');
    const task = pdfjs.getDocument({
      data: bytes.slice(),
      password: source.password,
      standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
        .pathname,
    });
    try {
      const output = await (await task.promise).getPage(1),
        operators = await output.getOperatorList();
      const text = operators.fnArray
        .flatMap((fn, i) =>
          fn === pdfjs.OPS.showText
            ? operators.argsArray[i][0].map((glyph) => glyph.unicode || '')
            : [],
        )
        .join('');
      expect(text).toContain('Changed secret');
      if (options.shared) expect(text).toContain('Private field');
    } finally {
      await task.destroy();
    }
  });
