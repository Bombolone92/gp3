import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

test('an excessive extraction stays open for correction without downloading an unusable PDF', async ({
  page,
}) => {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/');
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
  const bar = page.getByRole('menubar', { name: 'PDF menus' });
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'Page', exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Page', exact: true }).click();
  }
  await page.getByRole('menuitem', { name: 'Extract pages…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Extract pages', exact: true });
  const range = dialog.getByLabel('Page range', { exact: true });
  const submit = dialog.getByRole('button', { name: 'Download pages', exact: true });
  const downloads = [];
  page.on('download', (download) => downloads.push(download));
  await range.fill(Array(1001).fill('1').join(','));
  await submit.click();
  await expect(dialog.locator('.dialog-error')).toHaveText(
    'The extracted PDF would exceed 1,000 pages.',
  );
  await expect(range).toBeEnabled();
  await expect(submit).toBeEnabled();
  expect(downloads).toHaveLength(0);
  await range.fill('1, 1');
  const pending = page.waitForEvent('download');
  await submit.click();
  const exported = await PDFDocument.load(await readFile(await (await pending).path()));
  expect(exported.getPageCount()).toBe(2);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
  await expect(page.locator('.save-status')).toHaveText('Local file');
});
