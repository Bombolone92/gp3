import { test, expect } from '@playwright/test';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';
import { renamedCrypt } from '../fixtures/renamed-crypt.js';

for (const [label, options] of [
  ['custom filter', {}],
  ['shared indirect parameters', { shared: true, indirect: true }],
  ['AES-128 custom filter', { algorithm: 'AES-128' }],
])
  test(`changing passwords preserves attachments using ${label}`, async ({ page }) => {
    const { bytes, names, payload } = await renamedCrypt(options);
    await page.route('https://js.puter.com/**', (route) => route.abort());
    await page.goto('/#library');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Open a PDF/ }).click();
    await (
      await chooser
    ).setFiles({
      name: 'custom-filter.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(bytes),
    });
    const passwordDialog = page.getByRole('dialog', { name: 'Password required', exact: true });
    await passwordDialog.getByLabel('Password', { exact: true }).fill('owner');
    await passwordDialog.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
    await page.getByRole('button', { name: 'Protected', exact: true }).click();
    const change = page.getByRole('dialog', { name: 'Change password', exact: true });
    await change.getByLabel('Password to open', { exact: true }).fill('replacement');
    await change.getByLabel('Confirm password', { exact: true }).fill('replacement');
    await change.getByLabel('Permissions password', { exact: true }).fill('new-owner');
    await change.getByLabel('Password to open', { exact: true }).press('Enter');
    await expect(change).toBeHidden();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const changed = new Uint8Array(await readFile(await (await pending).path()));
    const task = pdfjs.getDocument({ data: changed, password: 'replacement' });
    try {
      const doc = await task.promise;
      for (const name of names)
        expect(Buffer.from(await doc.getAttachmentContent(name)).equals(Buffer.from(payload))).toBe(
          true,
        );
    } finally {
      await task.destroy();
    }
  });
