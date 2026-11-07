import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';
import { encryptedAttachment } from '../fixtures/encrypted-attachment.js';

async function attachment(bytes, password) {
  const task = pdfjs.getDocument({ data: bytes.slice(), password });
  try {
    const doc = await task.promise;
    return new Uint8Array(await doc.getAttachmentContent('private.txt'));
  } finally {
    await task.destroy();
  }
}
async function downloaded(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  return new Uint8Array(await readFile(await (await pending).path()));
}
for (const [label, options] of [
  ['AES-256 embedded default', {}],
  ['AES-128 embedded default', { algorithm: 'AES-128' }],
  ['Identity embedded default', { stream: 'StdCF', eff: 'Identity' }],
])
  test(`${label} preserves attachment data after protected download and password removal`, async ({
    page,
  }) => {
    const { bytes, payload, password } = await encryptedAttachment(options);
    await page.route('https://js.puter.com/**', (route) => route.abort());
    await page.goto('/#library');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Open a PDF/ }).click();
    await (
      await chooser
    ).setFiles({ name: 'attachment.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
    const passwordDialog = page.getByRole('dialog', { name: 'Password required', exact: true });
    await expect(passwordDialog).toBeVisible();
    await passwordDialog.getByLabel('Password', { exact: true }).fill('owner');
    await passwordDialog.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
    const protectedBytes = await downloaded(page);
    expect(
      Buffer.from(await attachment(protectedBytes, password)).equals(Buffer.from(payload)),
    ).toBe(true);
    await page.getByRole('button', { name: 'Protected', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Change password', exact: true })
      .getByRole('button', { name: 'Remove password', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Protected', exact: true })).toBeHidden();
    const ordinary = await downloaded(page);
    expect((await PDFDocument.load(ordinary)).isEncrypted).toBe(false);
    expect(Buffer.from(await attachment(ordinary)).equals(Buffer.from(payload))).toBe(true);
  });
