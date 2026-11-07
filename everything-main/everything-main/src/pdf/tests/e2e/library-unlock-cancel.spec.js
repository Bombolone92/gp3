import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('cancelling a password prompt keeps the library as it was', async ({ page }) => {
  const locked = (await readFile('tests/fixtures/security/aes-256-r5.pdf')).toString('base64');
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
      const bytes = Uint8Array.from(atob(${JSON.stringify(locked)}), (c) => c.charCodeAt(0));
      window.listings = 0;
      window.puter = {
        env: 'web',
        auth: { isSignedIn: async () => true, getUser: async () => ({ username: 'test' }) },
        fs: {
          readdir: async () => {
            window.listings++;
            return [
              { name: 'secret report.pdf', path: '/test/PDF Editor/secret report.pdf', size: bytes.length, modified: 1700000000 },
              { name: 'other.pdf', path: '/test/PDF Editor/other.pdf', size: 10, modified: 1600000000 },
              { name: 'secret b.pdf', path: '/test/PDF Editor/secret b.pdf', size: 10, modified: 1500000000 },
            ];
          },
          read: async () => new Blob([bytes]),
        },
        ui: {},
      };`,
    }),
  );
  await page.goto('/#library');
  const row = page.getByRole('button', { name: 'secret report.pdf', exact: true });
  await expect(row).toBeVisible();
  const sort = page.getByRole('combobox', { name: 'Sort PDFs' });
  const search = page.getByRole('searchbox', { name: 'Search PDFs' });
  await sort.selectOption('name');
  await search.fill('secret');
  const listings = await page.evaluate(() => window.listings);
  await row.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Password required' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(row).toBeFocused();
  await expect(search).toHaveValue('secret');
  await expect(sort).toHaveValue('name');
  await expect(page.locator('.file-open')).toHaveCount(2);
  expect(await page.evaluate(() => window.listings)).toBe(listings);
});
