import { test, expect } from '@playwright/test';

test('searching for constructor does not select every message as a match', async ({ page }) => {
  await page.goto('/tests/browser/conversation.html');
  await expect(page.locator('.row')).toHaveCount(12);
  await page.locator('.search-input').fill('constructor');
  await expect(page.locator('.list-meta')).toHaveText('0 results in 14 messages');
  await expect(page.locator('.row')).toHaveCount(0);
});

test('an impossible date is searched as text instead of matching the whole inbox', async ({ page }) => {
  await page.goto('/tests/browser/conversation.html');
  await expect(page.locator('.row')).toHaveCount(12);
  await page.locator('.search-input').fill('before:9999-02-30');
  await expect(page.locator('.list-meta')).toHaveText('0 results in 14 messages');
  await expect(page.locator('.row')).toHaveCount(0);
});

const interruptedSearch = async (page) => {
  await page.goto('/tests/browser/conversation.html?pageSize=3');
  await expect(page.locator('.btn-more')).toBeVisible();
  await page.evaluate(() => {
    const fs = window.puter.fs;
    const read = fs.read.bind(fs);
    fs.read = async () => { throw new Error('offline'); };
    window.restoreHeaderReads = () => { fs.read = read; };
  });
  await page.locator('.search-input').fill('from:petrova');
};

test('search reports unreadable messages and Enter retries the same query', async ({ page }) => {
  await interruptedSearch(page);
  await expect(page.locator('.list-meta')).toHaveText('0 results · could not read 11 messages');
  await expect(page.locator('.center-note')).toContainText('Search again to retry');
  await page.evaluate(() => window.restoreHeaderReads());
  await page.locator('.search-input').press('Enter');
  await expect(page.locator('.row')).toHaveCount(1);
  await expect(page.locator('.row-subject')).toHaveText('Q3 usage report attached');
  await expect(page.locator('.list-meta')).toHaveText('1 result in 14 messages');
});

test('a failed header read does not create a sender named unreadable', async ({ page }) => {
  await interruptedSearch(page);
  await expect(page.locator('.list-meta')).toContainText('could not read 11 messages');
  await page.locator('.search-input').fill('from:unreadable');
  await page.locator('.search-input').press('Enter');
  await expect(page.locator('.list-meta')).toHaveText('0 results · could not read 11 messages');
  await expect(page.locator('.row')).toHaveCount(0);
});

test('subject-only search still works when message headers cannot be read', async ({ page }) => {
  await interruptedSearch(page);
  await expect(page.locator('.list-meta')).toContainText('could not read');
  await page.locator('.search-input').fill('subject:"Q3 usage report attached"');
  await expect(page.locator('.row')).toHaveCount(1);
  await expect(page.locator('.row-subject')).toHaveText('Q3 usage report attached');
  await expect(page.locator('.list-meta')).toHaveText('1 result in 14 messages');
});

test('pending search keeps its placeholder stable and never flashes an empty result', async ({ page }) => {
  await page.goto('/tests/browser/conversation.html?pageSize=3');
  await expect(page.locator('.row')).toHaveCount(3);
  const opacity = await page.evaluate(() => {
    const fs = window.puter.fs;
    const read = fs.read.bind(fs);
    const held = new Promise(resolve => { window.releaseSearch = resolve; });
    fs.read = async (...args) => { await held; return read(...args); };
    const input = document.querySelector('.search-input');
    input.value = 'from:nonexistent';
    input.dispatchEvent(new Event('search'));
    return getComputedStyle(document.querySelector('.list-meta')).opacity;
  });
  expect(opacity).toBe('0');
  const pending = page.getByRole('status', { name: 'Searching your messages' });
  await expect(pending).toHaveCSS('opacity', '1');
  await expect(page.locator('.msglist')).not.toContainText('No messages match');
  await page.locator('.search-input').focus();
  await page.evaluate(() => window.releaseSearch());
  await expect(page.locator('.list-meta')).toHaveText('0 results in 14 messages');
  await expect(page.locator('.list-meta')).toHaveCSS('opacity', '1');
  await expect(page.locator('.msglist')).toContainText('No messages match your search.');
  await expect(pending).toHaveCount(0);
  await expect(page.locator('.search-input')).toBeFocused();
});
