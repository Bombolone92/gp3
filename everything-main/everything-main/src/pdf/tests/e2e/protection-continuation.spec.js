import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { unlockPdf } from '../../src/core/security.js';

async function menu(page, action) {
  const bar = page.getByRole('menubar');
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
  else await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}

for (const newer of ['document', 'protection'])
  test(`an authenticated protection request respects a newer ${newer}`, async ({ page }) => {
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/#library');
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Open a PDF/ }).click();
    await (
      await choosing
    ).setFiles({
      name: 'original.pdf',
      mimeType: 'application/pdf',
      buffer: await readFile(new URL('../fixtures/security/owner-only.pdf', import.meta.url)),
    });
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await menu(page, newer === 'document' ? 'Remove password' : 'Change password…');
    const owner = page.getByRole('dialog', { name: 'Permissions password required', exact: true });
    await expect(owner).toBeVisible();
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
        await new Promise((resolve) => (window.releaseOldProtectionRender = resolve));
        window.oldProtectionRenderReleased = true;
        return result;
      };
    });
    await owner.getByLabel('Permissions password', { exact: true }).fill('owner');
    await owner.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(owner).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => !!window.releaseOldProtectionRender)).toBe(true);
    if (newer === 'document') {
      const choosing = page.waitForEvent('filechooser');
      await page.keyboard.press('ControlOrMeta+o');
      await (
        await choosing
      ).setFiles({
        name: 'latest.pdf',
        mimeType: 'application/pdf',
        buffer: await readFile(new URL('../fixtures/security/aes-256-r5.pdf', import.meta.url)),
      });
      const password = page.getByRole('dialog', { name: 'Password required', exact: true });
      await password.getByLabel('Password', { exact: true }).fill('user');
      await password.getByRole('button', { name: 'Open', exact: true }).click();
      await expect(page).toHaveTitle('latest.pdf · PDF Editor');
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    } else {
      await menu(page, 'Remove password');
      await expect(page.getByRole('button', { name: 'Protected', exact: true })).toBeHidden();
      await expect(page.locator('#toast')).toHaveText(
        'The password is removed when you download or save.',
      );
    }
    await page.evaluate(() => window.releaseOldProtectionRender());
    await expect.poll(() => page.evaluate(() => window.oldProtectionRenderReleased)).toBe(true);
    await expect(page.locator('.paper')).toHaveAttribute('aria-busy', 'false');
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('#toast')).not.toContainText('Editing unlocked');
    if (newer === 'document') {
      await expect(page.getByRole('button', { name: 'Protected', exact: true })).toBeVisible();
      await expect(page.locator('#toast')).toBeHidden();
    }
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const bytes = await readFile(await (await downloading).path());
    let doc;
    if (newer === 'document') {
      await expect(PDFDocument.load(bytes)).rejects.toThrow(/encrypted/i);
      doc = await PDFDocument.load((await unlockPdf(bytes, 'user')).bytes);
      expect((await unlockPdf(bytes, 'owner')).owner).toBe(true);
    } else doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getForm().getTextField('name').getText()).toBe('Grace');
  });
