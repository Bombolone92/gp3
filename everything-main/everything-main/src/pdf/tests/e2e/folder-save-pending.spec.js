import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function fileMenu(page, label) {
  const bar = page.getByRole('menubar', { name: 'PDF menus' });
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
  else await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

for (const change of ['rename', 'replace', 'newer save', 'none'])
  test(`a folder save prepared before document ${change} opens only a current picker`, async ({
    page,
  }) => {
    await page.route('https://js.puter.com/**', (route) =>
      route.fulfill({
        body: `window.folderPickers = [];
          window.puter = {
            env: 'web',
            auth: { isSignedIn: () => true, getUser: async () => ({ username: 'test-user' }) },
            fs: { readdir: async () => [], write: async (path) => ({ path }) },
            ui: {
              onLaunchedWithItems() {}, onItemsOpened() {},
              showSaveFilePicker: (blob, name) => {
                window.folderPickers.push({ name, size: blob.size });
                return new Promise(() => {});
              }
            }
          };`,
      }),
    );
    await page.goto('/#library');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Open a PDF/ }).click();
    await (
      await chooser
    ).setFiles({
      name: 'original.pdf',
      mimeType: 'application/pdf',
      buffer: await readFile(new URL('../fixtures/security/owner-only.pdf', import.meta.url)),
    });
    await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    // Hold the encrypted PDF's final serialization, after the bytes have been prepared.
    await page.evaluate(async () => {
      const { blankPdf, validatePdf } = await import('/src/core/document.js');
      const prototype = Object.getPrototypeOf(await validatePdf(await blankPdf()));
      const save = prototype.save;
      prototype.save = async function (...args) {
        prototype.save = save;
        const bytes = await save.apply(this, args);
        await new Promise((resolve) => {
          window.releaseFolderSave = resolve;
        });
        return bytes;
      };
    });
    await fileMenu(page, 'Save to another Puter folder…');
    await expect.poll(() => page.evaluate(() => Boolean(window.releaseFolderSave))).toBe(true);
    if (change === 'rename') {
      await page.getByRole('button', { name: 'Rename original.pdf', exact: true }).click();
      await page.getByLabel('File name', { exact: true }).fill('renamed');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    } else if (change === 'replace') {
      await fileMenu(page, 'New blank PDF');
      await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
    } else if (change === 'newer save') {
      await page.getByRole('button', { name: 'Save to Puter', exact: true }).click();
      await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
    }
    await page.evaluate(async () => {
      window.releaseFolderSave();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    expect(await page.evaluate(() => window.folderPickers.map((item) => item.name))).toEqual(
      change === 'none' ? ['original.pdf'] : [],
    );
    // A picker whose cancellation never settles must still leave editing available.
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Place at page center', exact: true }),
    ).toBeVisible();
  });
