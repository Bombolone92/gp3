import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { unlockPdf, documentAccess, openedProtection } from '../../src/core/security.js';

async function prepare(page) {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a PDF/ }).click();
  await (
    await choosing
  ).setFiles({
    name: 'restricted.pdf',
    mimeType: 'application/pdf',
    buffer: await readFile(new URL('../fixtures/security/owner-only.pdf', import.meta.url)),
  });
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
}

async function openAction(page, action) {
  if (action === 'Protected')
    return page.getByRole('button', { name: action, exact: true }).press('Enter');
  const bar = page.getByRole('menubar');
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
  else await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}

async function newerSettings(page, newer) {
  if (newer === 'none') return;
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
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

async function checkNewer(page, newer) {
  expect(
    await page.evaluate(() => document.activeElement === window.newerFocus && !window.newerBlurred),
  ).toBe(true);
  if (newer === 'open') {
    const settings = page.getByRole('dialog', {
      name: 'Settings',
      exact: true,
    });
    await expect(settings).toBeVisible();
    await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(settings).toHaveCount(0);
  }
}

async function authenticate(page) {
  const owner = page.getByRole('dialog', {
    name: 'Permissions password required',
    exact: true,
  });
  await owner.getByLabel('Permissions password', { exact: true }).fill('owner');
  await owner.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(owner).toHaveCount(0);
}

async function checkDownload(page, removed, name) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const bytes = await readFile(await (await downloading).path());
  let doc;
  if (removed) doc = await PDFDocument.load(bytes);
  else {
    await expect(PDFDocument.load(bytes)).rejects.toThrow(/encrypted/i);
    const opened = await unlockPdf(bytes, '');
    expect(documentAccess(openedProtection(opened, '')).copy).toBe(false);
    expect((await unlockPdf(bytes, 'owner')).owner).toBe(true);
    doc = await PDFDocument.load(opened.bytes);
  }
  expect(doc.getForm().getTextField('name').getText()).toBe(name);
  expect(doc.getPageCount()).toBe(2);
}

for (const action of ['Protected', 'Change password…', 'Remove password'])
  for (const newer of ['none', 'open', 'closed'])
    test(`${action} waiting for a form draft respects newer dialog ${newer}`, async ({ page }) => {
      await prepare(page);
      await page.getByLabel('name (on page)', { exact: true }).fill('Updated draft');
      await page.evaluate(async () => {
        const { blankPdf, validatePdf } = await import('/src/core/document.js');
        const prototype = Object.getPrototypeOf(await validatePdf(await blankPdf()));
        const save = prototype.save;
        prototype.save = async function (...args) {
          prototype.save = save;
          const bytes = await save.apply(this, args);
          await new Promise((resolve) => (window.releaseProtectionDraft = resolve));
          return bytes;
        };
      });
      await openAction(page, action);
      await expect.poll(() => page.evaluate(() => !!window.releaseProtectionDraft)).toBe(true);
      await newerSettings(page, newer);
      await page.evaluate(() => window.releaseProtectionDraft());
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const owner = page.getByRole('dialog', {
        name: 'Permissions password required',
        exact: true,
      });
      if (newer !== 'none') {
        await expect(owner).toHaveCount(0);
        await checkNewer(page, newer);
        await openAction(page, action);
      }
      await authenticate(page);
      if (action === 'Remove password')
        await expect(page.getByRole('button', { name: 'Protected', exact: true })).toBeHidden();
      else {
        if (action === 'Protected') {
          await expect(page.locator('.paper')).toHaveAttribute('aria-busy', 'false');
          await openAction(page, action);
        }
        const change = page.getByRole('dialog', {
          name: 'Change password',
          exact: true,
        });
        await expect(change).toBeVisible();
        await change.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(change).toHaveCount(0);
      }
      await checkDownload(page, action === 'Remove password', 'Updated draft');
    });

for (const action of ['Change password…', 'Remove password'])
  for (const newer of ['none', 'open', 'closed'])
    test(`${action} waiting for the authenticated page render respects newer dialog ${newer}`, async ({
      page,
    }) => {
      await prepare(page);
      await openAction(page, action);
      await page.evaluate(async () => {
        const url = performance
          .getEntriesByType('resource')
          .map((r) => r.name)
          .find((url) => /pdfjs-dist\.js(?:\?|$)/.test(url));
        const pdfjs = await import(url);
        const { blankPdf } = await import('/src/core/document.js');
        const task = pdfjs.getDocument({ data: await blankPdf() });
        const doc = await task.promise;
        const prototype = Object.getPrototypeOf(doc);
        await task.destroy();
        const getPage = prototype.getPage;
        prototype.getPage = async function (...args) {
          prototype.getPage = getPage;
          const result = await getPage.apply(this, args);
          await new Promise((resolve) => (window.releaseProtectionRender = resolve));
          return result;
        };
      });
      await authenticate(page);
      await expect.poll(() => page.evaluate(() => !!window.releaseProtectionRender)).toBe(true);
      await newerSettings(page, newer);
      await page.evaluate(() => window.releaseProtectionRender());
      await expect(page.locator('.paper')).toHaveAttribute('aria-busy', 'false');
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const change = page.getByRole('dialog', {
        name: 'Change password',
        exact: true,
      });
      if (newer !== 'none' && action === 'Change password…') {
        await expect(change).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Protected', exact: true })).toBeVisible();
        await checkNewer(page, newer);
        await checkDownload(page, false, 'Grace');
        await openAction(page, action);
      } else if (newer !== 'none') {
        // Authentication accepted the removal before the redraw. A newer dialog
        // must preserve that completed choice as well as the newer focus.
        await expect(page.getByRole('button', { name: 'Protected', exact: true })).toBeHidden();
        await checkNewer(page, newer);
      }
      if (action === 'Change password…') {
        await expect(change).toBeVisible();
        await change.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(change).toHaveCount(0);
      } else
        await expect(page.getByRole('button', { name: 'Protected', exact: true })).toBeHidden();
      await checkDownload(page, action === 'Remove password', 'Grace');
    });
