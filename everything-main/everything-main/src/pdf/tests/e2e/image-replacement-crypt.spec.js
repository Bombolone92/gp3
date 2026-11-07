import { test, expect } from '@playwright/test';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { cryptReplacement, replacementPng } from '../fixtures/crypt-replacement.js';
import { unlockPdf } from '../../src/core/security.js';
import { inspectImages } from '../../src/core/image-edit.js';

for (const [label, options] of [
  ['named cipher', {}],
  ['Identity exemption', { identity: true }],
  ['nested custom cipher', { nested: true, custom: true, indirect: true }],
  ['public alpha mask', { mask: 'SMask', maskIdentity: true }],
])
  test(`image replacement retains ${label} through export and history`, async ({ page }) => {
    const source = await cryptReplacement(options);
    await page.route('https://js.puter.com/**', (route) => route.abort());
    await page.goto('/#library');
    const opening = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Open a PDF/ }).click();
    await (
      await opening
    ).setFiles({
      name: 'private-image.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(source.bytes),
    });
    const unlock = page.getByRole('dialog', { name: 'Password required', exact: true });
    await unlock.getByLabel('Password', { exact: true }).fill('owner');
    await unlock.getByRole('button', { name: 'Open', exact: true }).click();
    const target = page.getByRole('button', { name: 'Select image 1', exact: true });
    await expect(target).toBeVisible();
    const canvas = page.locator('.paper > canvas').first(),
      original = await canvas.evaluate((c) => c.toDataURL());
    await target.press('Enter');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Replace image', exact: true }).click();
    await (
      await chooser
    ).setFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: replacementPng() });
    await expect(page.getByRole('button', { name: 'Replace image', exact: true })).toBeEnabled();
    await expect.poll(() => canvas.evaluate((c) => c.toDataURL())).not.toBe(original);
    const replacement = await canvas.evaluate((c) => c.toDataURL());
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => canvas.evaluate((c) => c.toDataURL())).toBe(original);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(() => canvas.evaluate((c) => c.toDataURL())).toBe(replacement);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const bytes = new Uint8Array(await readFile(await (await pending).path()));
    const opened = await unlockPdf(bytes, source.password);
    const working = await PDFDocument.load(opened.bytes, { updateMetadata: false });
    const raw = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const image = inspectImages(working, 0)[0].object,
      mask = image.dict.lookup(PDFName.of('SMask'));
    for (const [stream, name] of [
      [image, source.name],
      [mask, options.maskIdentity ? 'Identity' : source.name],
    ]) {
      const saved = raw.context.lookup(working.context.getObjectRef(stream));
      const filter = saved.dict.lookup(PDFName.of('Filter'));
      expect(filter instanceof PDFArray).toBe(true);
      expect(filter.lookup(0)).toBe(PDFName.of('Crypt'));
      expect(
        saved.dict.lookup(PDFName.of('DecodeParms')).lookup(0).lookup(PDFName.of('Name')),
      ).toBe(PDFName.of(name));
      if (name === 'Identity') expect(saved.getContents()).toEqual(stream.getContents());
      else expect(saved.getContents()).not.toEqual(stream.getContents());
    }
  });
