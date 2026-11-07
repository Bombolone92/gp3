import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { cryptObjectStream } from '../fixtures/crypt-object-stream.js';
import { unlockPdf } from '../../src/core/security.js';

for (const [label, options] of [
  ['Identity', {}],
  ['indirect compressed Identity', { compressed: true, indirect: true }],
  ['compressed AES-256 Crypt', { crypt: 'StdCF', compressed: true }],
  ['compressed AES-128 Crypt', { crypt: 'StdCF', compressed: true, legacy: true }],
  [
    'AES-256 Crypt with Identity default',
    { crypt: 'StdCF', compressed: true, defaultIdentity: true, text: true },
  ],
  [
    'AES-128 Crypt with Identity default',
    { crypt: 'StdCF', compressed: true, defaultIdentity: true, text: true, legacy: true },
  ],
  [
    'direct Crypt streams with Identity default',
    { objectStream: false, defaultIdentity: true, text: true },
  ],
  [
    'RC4 Crypt with Identity default',
    { crypt: 'StdCF', compressed: true, defaultIdentity: true, text: true, rc4: true },
  ],
])
  test(`opening and downloading ${label} object streams retains details and page geometry`, async ({
    page,
  }) => {
    const { bytes, title, password } = await cryptObjectStream(options);
    await page.route('https://js.puter.com/**', (route) => route.abort());
    await page.goto('/#library');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Open a PDF/ }).click();
    await (
      await chooser
    ).setFiles({
      name: 'crypt-stream.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(bytes),
    });
    const passwordDialog = page.getByRole('dialog', { name: 'Password required', exact: true });
    await expect(passwordDialog).toBeVisible();
    await passwordDialog.getByLabel('Password', { exact: true }).fill(password);
    await passwordDialog.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
    await expect(page.getByRole('button', { name: 'Protected', exact: true })).toBeVisible();
    if (options.defaultIdentity)
      await expect(page.locator('.textLayer')).toContainText(
        options.legacy || options.rc4 ? 'Secret report' : 'Named filter content',
      );
    const bar = page.getByRole('menubar', { name: 'PDF menus' });
    if (await bar.isVisible())
      await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
    else await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Document details…', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Document details', exact: true });
    await expect(details.getByLabel('Title', { exact: true })).toHaveValue(title);
    await expect(details.getByLabel('Author', { exact: true })).toHaveValue('Ada');
    await details.getByRole('button', { name: 'Cancel', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const downloaded = new Uint8Array(await readFile(await (await pending).path()));
    expect((await PDFDocument.load(downloaded, { ignoreEncryption: true })).isEncrypted).toBe(true);
    const opened = await unlockPdf(downloaded, password);
    const doc = await PDFDocument.load(opened.bytes);
    expect(doc.getTitle()).toBe(title);
    expect(doc.getAuthor()).toBe('Ada');
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize()).toEqual(
      options.objectStream === false ? { width: 400, height: 300 } : { width: 510, height: 710 },
    );
  });
