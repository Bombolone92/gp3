import { test, expect } from '@playwright/test';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';
import { cryptMetadata } from '../fixtures/crypt-metadata.js';

async function details(page) {
  const bar = page.getByRole('menubar', { name: 'PDF menus' });
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
  else await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Document details…', exact: true }).click();
  return page.getByRole('dialog', { name: 'Document details' });
}
for (const [label, options] of [
  ['named Crypt metadata', {}],
  ['Identity metadata', { crypt: 'Identity' }],
  ['shared indirect Crypt metadata', { crypt: 'LegacyCF', indirect: true, shared: true }],
])
  test(`document details reads and saves ${label}`, async ({ page }) => {
    const { bytes, password } = await cryptMetadata(options);
    await page.route('https://js.puter.com/**', (route) => route.abort());
    await page.goto('/#library');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Open a PDF/ }).click();
    await (
      await chooser
    ).setFiles({ name: 'metadata.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
    const unlock = page.getByRole('dialog', { name: 'Password required', exact: true });
    await unlock.getByLabel('Password', { exact: true }).fill('owner');
    await unlock.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
    const dialog = await details(page);
    await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('XMP title');
    await expect(dialog.getByLabel('Author', { exact: true })).toHaveValue('Ada');
    await dialog.getByLabel('Author', { exact: true }).fill('New author');
    await dialog.getByRole('button', { name: 'Save details', exact: true }).click();
    await expect(dialog).toBeHidden();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const saved = new Uint8Array(await readFile(await (await pending).path()));
    const task = pdfjs.getDocument({ data: saved, password });
    try {
      const { metadata } = await (await task.promise).getMetadata();
      expect(metadata.get('dc:title')).toBe('XMP title');
      expect(metadata.get('dc:creator')).toEqual(['New author']);
      expect(metadata.get('custom:reference')).toBe('record-123');
    } finally {
      await task.destroy();
    }
    const reopened = await details(page);
    await expect(reopened.getByLabel('Title', { exact: true })).toHaveValue('XMP title');
    await expect(reopened.getByLabel('Author', { exact: true })).toHaveValue('New author');
  });
