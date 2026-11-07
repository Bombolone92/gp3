import { test, expect } from '@playwright/test';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';
import { cryptAppearance } from '../fixtures/crypt-appearance.js';

async function menu(page, section, item) {
  const bar = page.getByRole('menubar', { name: 'PDF menus' });
  if (await bar.isVisible())
    await bar.getByRole('menuitem', { name: section, exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    if (section !== 'File')
      await page.getByRole('menuitem', { name: section, exact: true }).click();
  }
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
function firstPdf(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const directory = view.getUint32(bytes.length - 6, true),
    size = view.getUint32(directory + 20, true),
    offset = view.getUint32(directory + 42, true);
  return bytes.slice(
    offset + 30 + view.getUint16(offset + 26, true),
    offset + 30 + view.getUint16(offset + 26, true) + size,
  );
}
for (const [action, options] of [
  ['flatten', {}],
  ['extract', { custom: true, indirect: true }],
  ['split', { pages: 2 }],
  ['flatten Stamp', { type: 'stamp', identity: true }],
])
  test(`${action} handles Crypt appearances and keeps the open PDF usable`, async ({ page }) => {
    const { bytes, password } = await cryptAppearance(options);
    await page.route('https://js.puter.com/**', (route) => route.abort());
    await page.goto('/#library');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Open a PDF/ }).click();
    await (
      await chooser
    ).setFiles({ name: 'form.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
    const unlock = page.getByRole('dialog', { name: 'Password required', exact: true });
    await unlock.getByLabel('Password', { exact: true }).fill('owner');
    await unlock.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.locator('.page-caption')).toHaveText(`Page 1 of ${options.pages ?? 1}`);
    let saved;
    if (action.startsWith('flatten')) {
      await menu(page, 'File', 'Flatten…');
      await page
        .getByRole('dialog', { name: 'Flatten', exact: true })
        .getByRole('button', { name: 'Flatten', exact: true })
        .click();
      await expect(page.locator('#toast')).toHaveText(
        options.type === 'stamp' ? 'Flattened 1 comment.' : 'Flattened 1 field.',
      );
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      saved = new Uint8Array(await readFile(await (await pending).path()));
    } else {
      await menu(
        page,
        action === 'extract' ? 'Page' : 'File',
        action === 'extract' ? 'Extract pages…' : 'Split PDF…',
      );
      const dialog = page.getByRole('dialog', {
        name: action === 'extract' ? 'Extract pages' : 'Split PDF',
        exact: true,
      });
      const pending = page.waitForEvent('download');
      await dialog
        .getByRole('button', {
          name: action === 'extract' ? 'Download pages' : 'Download ZIP',
          exact: true,
        })
        .click();
      saved = new Uint8Array(await readFile(await (await pending).path()));
      if (action === 'split') saved = firstPdf(saved);
      await expect(
        page.getByRole('textbox', { name: 'private0 (on page)', exact: true }),
      ).toHaveValue('Private field');
    }
    const task = pdfjs.getDocument({
      data: saved,
      password,
      standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
        .pathname,
    });
    try {
      const output = await (await task.promise).getPage(1);
      expect(await output.getAnnotations()).toHaveLength(0);
      if (options.type !== 'stamp')
        expect((await output.getTextContent()).items.map((item) => item.str).join('')).toContain(
          'Private field',
        );
    } finally {
      await task.destroy();
    }
    if (action === 'flatten') {
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(
        page.getByRole('textbox', { name: 'private0 (on page)', exact: true }),
      ).toHaveValue('Private field');
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(
        page.getByRole('textbox', { name: 'private0 (on page)', exact: true }),
      ).toHaveCount(0);
    }
  });
