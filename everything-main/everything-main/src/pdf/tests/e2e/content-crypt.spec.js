import { test, expect } from '@playwright/test';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { cryptEditing } from '../fixtures/crypt-editing.js';
for (const [label, options] of [
  ['named Crypt', {}],
  ['Identity', { identity: true }],
  ['nested Crypt Form', { nested: true }],
  ['mixed clear and encrypted', { mixed: true }],
])
  test(`direct text edits in ${label} content retain protection through download and undo`, async ({
    page,
  }) => {
    const { bytes, password, name } = await cryptEditing(options);
    await page.route('https://js.puter.com/**', (route) => route.abort());
    await page.goto('/#library');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Open a PDF/ }).click();
    await (
      await chooser
    ).setFiles({ name: 'content.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
    const unlock = page.getByRole('dialog', { name: 'Password required', exact: true });
    await unlock.getByLabel('Password', { exact: true }).fill('owner');
    await unlock.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
    const target = page.getByRole('button', { name: 'Edit text: Original text', exact: true });
    await expect(target).toBeVisible();
    await target.dblclick({ position: { x: 8, y: 8 } });
    const input = page.getByRole('textbox', { name: 'Edit text', exact: true });
    await expect(input).toBeEditable();
    await input.fill('Edited text');
    await page.locator('.workspace').click({ position: { x: 4, y: 4 } });
    await expect(
      page.getByRole('button', { name: 'Edit text: Edited text', exact: true }),
    ).toBeVisible();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const saved = new Uint8Array(await readFile(await (await pending).path()));
    const task = pdfjs.getDocument({
      data: saved.slice(),
      password,
      standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
        .pathname,
    });
    try {
      expect(
        (await (await (await task.promise).getPage(1)).getTextContent()).items
          .map((x) => x.str)
          .join(''),
      ).toBe(options.mixed ? 'Edited textSecond secret' : 'Edited text');
    } finally {
      await task.destroy();
    }
    const raw = await PDFDocument.load(saved, { ignoreEncryption: true, updateMetadata: false });
    const content = raw.getPage(0).node.Contents().lookup(0);
    if (name)
      expect(
        content.dict.lookup(PDFName.of('DecodeParms')).lookup(0).lookup(PDFName.of('Name')),
      ).toBe(PDFName.of(name));
    else expect(content.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'));
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(target).toBeVisible();
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Edit text: Edited text', exact: true }),
    ).toBeVisible();
  });
