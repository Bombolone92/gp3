import { test, expect } from '@playwright/test';

const start = async (page) => {
  // End at a day boundary so the next page requires a directory request.
  await page.goto('/tests/browser/conversation.html?pageSize=10');
  const more = page.getByRole('button', { name: 'Load older messages', exact: true });
  await expect(more).toBeVisible();
  return more;
};

test('returning from search keeps the pending page disabled and leaves one load button', async ({ page }) => {
  await page.goto('/tests/browser/conversation.html?pageSize=4');
  await expect(page.locator('.btn-more')).toBeVisible();
  const before = await page.locator('.row').count();
  await page.evaluate(() => {
    const fs = window.puter.fs;
    const readdir = fs.readdir.bind(fs);
    fs.readdir = (path) => {
      if (!path.includes('/objects/')) return readdir(path);
      fs.readdir = readdir;
      return new Promise((resolve) => {
        window.releaseOlder = () => resolve(readdir(path));
      });
    };
  });
  await page.locator('.btn-more').click();
  await expect(page.locator('.btn-more')).toBeDisabled();
  await page.locator('.search-input').fill('subject:"Welcome to your Puter mailbox"');
  await expect(page.locator('.row')).toHaveCount(1);
  await page.locator('.search-input').fill('');
  await expect(page.locator('.row')).toHaveCount(before);
  await expect(page.locator('.btn-more')).toBeDisabled();
  await expect(page.locator('.btn-more')).toHaveText('Load older messages');
  await expect(page.locator('.btn-more')).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => window.releaseOlder());
  await expect.poll(() => page.locator('.row').count()).toBeGreaterThan(before);
  await expect(page.locator('.btn-more')).toHaveCount(1);
  await expect(page.locator('.btn-more')).toBeEnabled();
});

test('keyboard paging continues on the first newly displayed message', async ({ page }) => {
  const more = await start(page);
  const before = await page.locator('.row').count();
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.row')).toHaveCount(12);
  const next = page.locator('.row').nth(before);
  await expect(next).toBeFocused();
  await expect(next).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('Enter');
  await expect(page.locator('.msg-item').first()).toBeVisible();
});

test('a failed keyboard page load hands focus to Retry', async ({ page }) => {
  const more = await start(page);
  await page.evaluate(() => {
    const fs = window.puter.fs;
    const readdir = fs.readdir.bind(fs);
    fs.readdir = (path) => path.includes('/objects/')
      ? Promise.reject(new Error('offline')) : readdir(path);
  });
  await more.focus();
  await page.keyboard.press('Enter');
  const retry = page.getByRole('button', { name: 'Retry loading messages', exact: true });
  await expect(retry).toBeEnabled();
  await expect(retry).toBeFocused();
});

test('paging without any starred matches leaves focus on the folder toolbar', async ({ page }) => {
  const more = await start(page);
  await page.locator('.nav-item').filter({ has: page.locator('.nav-label', { hasText: /^Starred$/ }) }).click();
  await expect(page.locator('.row:visible')).toHaveCount(0);
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.btn-more')).toHaveCount(0);
  await expect(page.locator('.row:visible')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh this folder', exact: true })).toBeFocused();
});

test('a completed page does not take focus back from another control', async ({ page }) => {
  const more = await start(page);
  await page.evaluate(() => {
    const fs = window.puter.fs;
    const readdir = fs.readdir.bind(fs);
    fs.readdir = (path) => {
      if (!path.includes('/objects/')) return readdir(path);
      fs.readdir = readdir;
      return new Promise((resolve) => {
        window.releaseOlder = () => resolve(readdir(path));
      });
    };
  });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.btn-more')).toBeDisabled();
  await page.locator('.search-input').focus();
  await page.evaluate(() => window.releaseOlder());
  await expect(page.locator('.row')).toHaveCount(12);
  await expect(page.locator('.search-input')).toBeFocused();
});
