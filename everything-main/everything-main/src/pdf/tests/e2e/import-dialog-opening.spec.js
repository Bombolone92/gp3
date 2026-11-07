import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function prepare(page) {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
}

async function chooseSource(page, buffer, name = 'source.pdf') {
  const chooser = page.waitForEvent('filechooser');
  // FileChooser's element handle uses an isolated world; capture the app's handler
  // through the native click in the page world so its promise can be observed.
  await page.evaluate((name) => {
    const click = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function (...args) {
      if (this.type === 'file') {
        HTMLInputElement.prototype.click = click;
        const change = this.onchange;
        window.finishedImports ??= {};
        window.finishedImports[name] = false;
        this.onchange = async function (...args) {
          try {
            await change.apply(this, args);
          } finally {
            window.finishedImports[name] = true;
          }
        };
      }
      return click.apply(this, args);
    };
  }, name);
  const bar = page.getByRole('menubar');
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'Page', exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Page', exact: true }).click();
  }
  await page.getByRole('menuitem', { name: 'Insert pages from PDF…', exact: true }).click();
  const selected = await chooser;
  await selected.setFiles({ name, mimeType: 'application/pdf', buffer });
}

async function plainSource() {
  const doc = await PDFDocument.create();
  doc.addPage([401, 500]);
  doc.addPage([402, 500]);
  return Buffer.from(await doc.save());
}

async function holdStage(page, stage) {
  await page.evaluate(async (stage) => {
    const hold = () => new Promise((resolve) => (window.releaseSourceStage = resolve));
    if (stage === 'file read') {
      const read = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = async function () {
        File.prototype.arrayBuffer = read;
        const bytes = await read.call(this);
        await hold();
        return bytes;
      };
    } else if (stage.endsWith('password check')) {
      const digest = SubtleCrypto.prototype.digest;
      SubtleCrypto.prototype.digest = async function (...args) {
        SubtleCrypto.prototype.digest = digest;
        const bytes = await digest.apply(this, args);
        await hold();
        return bytes;
      };
    } else {
      const { blankPdf, validatePdf } = await import('/src/core/document.js');
      const PDFDocument = (await validatePdf(await blankPdf())).constructor;
      const load = PDFDocument.load;
      PDFDocument.load = async function (...args) {
        if (stage === 'source rejection') {
          try {
            return await load.apply(this, args);
          } catch (error) {
            PDFDocument.load = load;
            await hold();
            throw error;
          }
        }
        // An encrypted file fails its first parse; hold the successful decrypted parse.
        const doc = await load.apply(this, args);
        PDFDocument.load = load;
        await hold();
        return doc;
      };
    }
  }, stage);
}

async function unlockSource(page, permissions = false) {
  const dialog = page.getByRole('dialog', {
    name: permissions ? 'Permissions password required' : 'Password required',
    exact: true,
  });
  await dialog
    .getByLabel(permissions ? 'Permissions password' : 'Password', { exact: true })
    .fill(permissions ? 'owner' : 'user');
  await dialog.getByRole('button', { name: permissions ? 'Unlock' : 'Open', exact: true }).click();
}

for (const stage of [
  'file read',
  'source parse',
  'open password check',
  'permissions password check',
  'unlocked source parse',
])
  for (const newer of ['none', 'open', 'closed'])
    test(`import waiting for ${stage} respects newer dialog ${newer}`, async ({ page }) => {
      await prepare(page);
      const permissions = stage === 'permissions password check';
      const encrypted =
        permissions || stage === 'open password check' || stage === 'unlocked source parse';
      const buffer = encrypted
        ? await readFile(
            new URL(
              `../fixtures/security/${permissions ? 'owner-only' : 'aes-256-r5'}.pdf`,
              import.meta.url,
            ),
          )
        : await plainSource();
      await holdStage(page, stage);
      await chooseSource(page, buffer);
      if (stage === 'unlocked source parse') await unlockSource(page);
      await expect.poll(() => page.evaluate(() => !!window.releaseSourceStage)).toBe(true);
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      if (newer !== 'none') {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await expect(settings).toBeVisible();
        if (newer === 'closed') {
          await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
          await expect(settings).toHaveCount(0);
          await page.getByRole('button', { name: 'Settings', exact: true }).focus();
        }
        await page.evaluate(() => {
          window.newerFocus = document.activeElement;
          document.activeElement.addEventListener('blur', () => (window.newerBlurred = true));
        });
      }
      await page.evaluate(() => window.releaseSourceStage());
      if (newer === 'none' && stage.endsWith('password check'))
        await unlockSource(page, permissions);
      const insert = page.getByRole('dialog', { name: 'Insert pages', exact: true });
      if (newer !== 'none') {
        await expect
          .poll(() => page.evaluate(() => window.finishedImports['source.pdf']))
          .toBe(true);
        await expect(insert).toHaveCount(0);
        await expect(page.getByRole('dialog', { name: /password required/i })).toHaveCount(0);
        expect(
          await page.evaluate(
            () => document.activeElement === window.newerFocus && !window.newerBlurred,
          ),
        ).toBe(true);
        if (newer === 'open') {
          await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
          await expect(settings).toHaveCount(0);
        }
        // A fresh request may still use the same source and its own password dialogs.
        await chooseSource(page, buffer);
        if (encrypted) await unlockSource(page, permissions);
      }
      await expect(insert).toContainText('source.pdf has 2 pages');
      await insert.getByRole('button', { name: 'Insert pages', exact: true }).click();
      await expect(page.locator('.page-caption')).toHaveText('Page 2 of 3');
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const saved = await PDFDocument.load(await readFile(await (await download).path()));
      expect(saved.getPageCount()).toBe(3);
      if (!encrypted)
        expect(
          saved
            .getPages()
            .slice(1)
            .map((p) => p.getWidth()),
        ).toEqual([401, 402]);
      // Source forms are imported as fixed page content, leaving no editable fields.
      expect(saved.getForm().getFields()).toHaveLength(0);
    });

for (const stage of ['file read', 'source rejection'])
  test(`a late invalid source after ${stage} does not report an error in a newer dialog`, async ({
    page,
  }) => {
    await prepare(page);
    await holdStage(page, stage);
    await chooseSource(page, Buffer.from('not a PDF'));
    await expect.poll(() => page.evaluate(() => !!window.releaseSourceStage)).toBe(true);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(settings).toBeVisible();
    await page.evaluate(() => window.releaseSourceStage());
    await expect.poll(() => page.evaluate(() => window.finishedImports['source.pdf'])).toBe(true);
    await expect(settings.getByRole('alert')).toBeHidden();
    await expect(page.locator('#toast')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  });

test('an invalid source still reports its error when the import is current', async ({ page }) => {
  await prepare(page);
  await chooseSource(page, Buffer.from('not a PDF'));
  await expect(page.locator('#toast')).toHaveText('This file is not a PDF. Choose a PDF file.');
  await expect(page.getByRole('dialog', { name: 'Insert pages', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('a newer source choice supersedes a source still being read', async ({ page }) => {
  await prepare(page);
  await holdStage(page, 'file read');
  await chooseSource(page, await plainSource(), 'older.pdf');
  await expect.poll(() => page.evaluate(() => !!window.releaseSourceStage)).toBe(true);
  await chooseSource(page, await plainSource(), 'newer.pdf');
  const insert = page.getByRole('dialog', { name: 'Insert pages', exact: true });
  await expect(insert).toContainText('newer.pdf has 2 pages');
  await page.evaluate(() => window.releaseSourceStage());
  await expect.poll(() => page.evaluate(() => window.finishedImports['older.pdf'])).toBe(true);
  await expect(insert).toHaveCount(1);
  await expect(insert).toContainText('newer.pdf has 2 pages');
  await insert.getByRole('button', { name: 'Insert pages', exact: true }).click();
  await expect(page.locator('.page-caption')).toHaveText('Page 2 of 3');
});
