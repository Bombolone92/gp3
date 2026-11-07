import { test, expect } from '@playwright/test';

test('archiving the loaded page keeps the rest of the inbox reachable', async ({ page }) => {
  await page.goto('/tests/browser/conversation.html?pageSize=10');
  await expect(page.locator('.btn-more')).toBeVisible();
  await page.locator('.select-all').check();
  await page.locator('.list-actions').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.locator('.row')).toHaveCount(0);
  const more = page.getByRole('button', { name: 'Load older messages', exact: true });
  await expect(more).toBeVisible();
  await expect(page.locator('.msglist')).not.toContainText('No mail yet.');
  await more.click();
  await expect(page.locator('.row')).toHaveCount(4);
  await expect(page.locator('.btn-more')).toHaveCount(0);
});

test('older messages remain available after a failed page read', async ({ page }) => {
  await page.goto('/tests/browser/conversation.html?pageSize=10');
  const more = page.getByRole('button', { name: 'Load older messages', exact: true });
  await expect(more).toBeVisible();
  const before = await page.locator('.row').count();
  await page.evaluate(() => {
    const fs = window.puter.fs;
    const readdir = fs.readdir.bind(fs);
    fs.readdir = (path) => path.includes('/objects/')
      ? Promise.reject(new Error('offline')) : readdir(path);
    window.restoreListing = () => { fs.readdir = readdir; };
  });
  await more.click();
  const retry = page.getByRole('button', { name: 'Retry loading messages', exact: true });
  await expect(retry).toBeVisible();
  await expect(retry).toBeEnabled();
  await expect(page.locator('.row')).toHaveCount(before);
  await expect(page.locator('.toast').last()).toContainText('Could not load some messages: offline');
  await page.evaluate(() => window.restoreListing());
  await retry.click();
  await expect(page.locator('.row')).toHaveCount(12);
  await expect(page.locator('.btn-more')).toHaveCount(0);
});

test('a failed Mark all as read does not change the folder opened while it was loading', async ({ page }) => {
  await page.goto('/tests/browser/conversation.html');
  await page.locator('.row').first().hover();
  await page.locator('.row').first().getByRole('button', { name: /^Archive/ }).click();
  const folder = (label) => page.locator('.nav-item').filter({
    has: page.locator('.nav-label', { hasText: new RegExp(`^${label}$`) }),
  });
  await folder('Archive').click();
  await expect(page.locator('.row.unread')).toHaveCount(1);
  await folder('Inbox').click();
  await expect(page.locator('.row.unread').first()).toBeVisible();
  await page.evaluate(() => {
    const fs = window.puter.fs;
    const readdir = fs.readdir.bind(fs);
    fs.readdir = (path) => {
      if (!path.endsWith('/objects')) return readdir(path);
      fs.readdir = readdir;
      return new Promise((resolve, reject) => {
        window.rejectMarkAll = () => reject(new Error('offline'));
      });
    };
  });
  await page.getByRole('button', { name: 'Mark all as read', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark all as read', exact: true })).toBeDisabled();
  await folder('Archive').click();
  await expect(page.locator('.row.unread')).toHaveCount(1);
  await page.evaluate(() => window.rejectMarkAll());
  await expect(page.locator('.toast').last()).toContainText('Could not mark all as read: offline');
  await expect(page.locator('.row.unread')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Mark all as read', exact: true })).toBeEnabled();
});

test('sent reply appears in the open thread and survives reopening in Sent and Inbox', async ({ page }) => {
  await page.route('**/test-api/email/send', (route) => route.fulfill({ json: { ok: true } }));
  await page.goto('/tests/browser/conversation.html');
  const thread = page.locator('.row').filter({ has: page.locator('.row-subject', { hasText: 'Thursday walkthrough' }) });
  await thread.click();
  await expect(page.locator('.msg-item')).toHaveCount(3);
  await page.locator('.msg-reply').getByRole('button', { name: 'Reply', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message body' }).fill('See you Thursday — sent from this conversation.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.msg-item')).toHaveCount(4);
  await expect(page.locator('.msg-item').last()).toContainText('See you Thursday');
  await expect(page.locator('.msg-item').last()).toHaveClass(/is-open/);
  await expect(page.locator('.msg-count')).toHaveText('4');
  for (const folder of ['Sent', 'Inbox']) {
    await page.locator('.nav-item').filter({ has: page.locator('.nav-label', { hasText: new RegExp(`^${folder}$`) }) }).click();
    await thread.click();
    await expect(page.locator('.msg-item')).toHaveCount(4);
    await expect(page.locator('.msg-item').last()).toContainText('See you Thursday');
  }
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await expect(page.locator('.msg-item.is-open')).toHaveCount(4);
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await expect(page.locator('.msg-item.is-open')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await expect(page.locator('.msg-item.is-open')).toHaveCount(4);
});
