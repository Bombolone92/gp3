import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { unlockPdf } from '../../src/core/security.js';
import { openDevicePicker } from './editing-helpers.js';

async function plainSource() {
  const doc = await PDFDocument.create();
  doc.setTitle('Newly opened report');
  doc.addPage([401, 500]);
  doc.addPage([402, 500]);
  return Buffer.from(await doc.save());
}

async function prepare(page, signedIn = false) {
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: signedIn
        ? `window.puter = {
      env:'app', auth:{getUser:async()=>({username:'test'})},
      fs:{readdir:async()=>[]}, ui:{onLaunchedWithItems:()=>{},onItemsOpened:()=>{}}
    };`
        : '',
    }),
  );
  await page.goto('/');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  if (signedIn)
    await expect(page.getByRole('button', { name: 'Save to Puter', exact: true })).toBeVisible();
}

async function rotate(page) {
  const bar = page.getByRole('menubar');
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'Page', exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Page', exact: true }).click();
  }
  await page.getByRole('menuitem', { name: 'Rotate clockwise', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
}

async function holdPreparation(page, password) {
  await page.evaluate(async (password) => {
    await import('/src/unlock-dialog.js');
    const hold = () =>
      new Promise((resolve) => {
        window.releaseOpenPreparation = resolve;
      });
    if (password) {
      const digest = SubtleCrypto.prototype.digest;
      let calls = 0;
      SubtleCrypto.prototype.digest = async function (...args) {
        const result = await digest.apply(this, args);
        if (++calls === 1) await hold();
        if (calls === 2) {
          SubtleCrypto.prototype.digest = digest;
          setTimeout(() => {
            window.openPreparationFinished = true;
          }, 0);
        }
        return result;
      };
    } else {
      const { blankPdf, validatePdf } = await import('/src/core/document.js');
      const PDFDocument = (await validatePdf(await blankPdf())).constructor;
      const load = PDFDocument.load;
      PDFDocument.load = async function (...args) {
        const doc = await load.apply(this, args);
        PDFDocument.load = load;
        await hold();
        setTimeout(() => {
          window.openPreparationFinished = true;
        }, 0);
        return doc;
      };
    }
  }, password);
}

async function choose(page, buffer) {
  const choosing = page.waitForEvent('filechooser');
  await openDevicePicker(page);
  await (await choosing).setFiles({ name: 'next.pdf', mimeType: 'application/pdf', buffer });
  await expect.poll(() => page.evaluate(() => !!window.releaseOpenPreparation)).toBe(true);
}

async function release(page) {
  await page.evaluate(() => window.releaseOpenPreparation());
  await expect.poll(() => page.evaluate(() => window.openPreparationFinished)).toBe(true);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

for (const phase of ['password', 'local leave', 'account leave'])
  for (const newer of ['none', 'Settings', 'About PDF Editor', 'Keyboard shortcuts', 'closed'])
    test(`opening waits for ${newer} before ${phase}`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const password = phase === 'password';
      await prepare(page, phase === 'account leave');
      if (!password) await rotate(page);
      await holdPreparation(page, password);
      await choose(
        page,
        password
          ? await readFile(new URL('../fixtures/security/aes-256-r5.pdf', import.meta.url))
          : await plainSource(),
      );
      const settings = page.getByRole('dialog', {
        name: 'Settings',
        exact: true,
      });
      if (newer !== 'none') {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await expect(settings).toBeVisible();
        if (newer === 'closed') {
          await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
          await expect(settings).toHaveCount(0);
        } else await settings.getByLabel('Appearance').selectOption('dark');
      }
      await release(page);
      if (newer !== 'none' && newer !== 'closed') {
        await expect(page.getByRole('dialog')).toHaveCount(1);
        await expect(settings.getByLabel('Appearance')).toBeFocused();
        await expect(page).toHaveTitle(`${password ? '' : '* '}Untitled.pdf · PDF Editor`);
        let current = settings;
        if (newer !== 'Settings') {
          await settings.getByRole('button', { name: newer, exact: true }).click();
          current = page.getByRole('dialog', { name: newer, exact: true });
          await expect(current).toBeVisible();
          await expect(settings).toHaveCount(0);
          await page.evaluate(
            () =>
              new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          await expect(page.getByRole('dialog')).toHaveCount(1);
        }
        await current.getByRole('button', { name: 'Close dialog', exact: true }).click();
        await expect(current).toHaveCount(0);
      }
      if (password) {
        const dialog = page.getByRole('dialog', {
          name: 'Password required',
          exact: true,
        });
        await expect(page.getByRole('dialog')).toHaveCount(1);
        await dialog.getByLabel('Password', { exact: true }).fill('user');
        await dialog.getByRole('button', { name: 'Open', exact: true }).click();
      } else {
        const dialog = page.getByRole('dialog', {
          name: phase === 'account leave' ? 'Leave this PDF?' : 'Save before leaving?',
          exact: true,
        });
        await expect(page.getByRole('dialog')).toHaveCount(1);
        await dialog.getByRole('button', { name: 'Leave without saving', exact: true }).click();
      }
      await expect(page).toHaveTitle('next.pdf · PDF Editor');
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const bytes = await readFile(await (await downloading).path());
      const doc = await PDFDocument.load(password ? (await unlockPdf(bytes, 'user')).bytes : bytes);
      expect(doc.getPageCount()).toBe(2);
      if (password) expect(doc.getForm().getTextField('name').getText()).toBe('Grace');
      else {
        expect(doc.getTitle()).toBe('Newly opened report');
        expect(doc.getPage(0).getWidth()).toBe(401);
        expect(doc.getPage(0).getRotation().angle).toBe(0);
      }
      expect(errors).toEqual([]);
    });

for (const newer of ['file', 'library'])
  test(`a queued password prompt is cancelled by a newer ${newer}`, async ({ page }) => {
    const base64 = (await plainSource()).toString('base64');
    await page.route('https://js.puter.com/**', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `window.puter = {
        env:'app', auth:{getUser:async()=>({username:'test'})},
        fs:{readdir:async()=>[],read:async()=>new Blob([Uint8Array.from(atob(${JSON.stringify(base64)}),c=>c.charCodeAt(0))])},
        ui:{onLaunchedWithItems:()=>{},onItemsOpened:handler=>{window.openItems=handler;}}
      };`,
      }),
    );
    await page.goto('/');
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await expect.poll(() => page.evaluate(() => typeof window.openItems)).toBe('function');
    await holdPreparation(page, true);
    await choose(
      page,
      await readFile(new URL('../fixtures/security/aes-256-r5.pdf', import.meta.url)),
    );
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', {
      name: 'Settings',
      exact: true,
    });
    await release(page);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    if (newer === 'file')
      await page.evaluate(() => window.openItems([{ path: 'latest.pdf', name: 'latest.pdf' }]));
    else {
      await page.evaluate(() => {
        location.hash = '#library';
      });
      await expect(page.getByRole('button', { name: 'New blank PDF', exact: true })).toBeAttached();
    }
    await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (newer === 'file') {
      await expect(page).toHaveTitle('latest.pdf · PDF Editor');
      await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
    } else {
      await expect(page.getByRole('button', { name: 'New blank PDF', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'New blank PDF', exact: true }).click();
      await expect(page).toHaveTitle('Untitled.pdf · PDF Editor');
      await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
    }
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
