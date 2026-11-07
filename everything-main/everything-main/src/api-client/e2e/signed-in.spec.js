import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { mockApi } from './helpers.js';

const fakePuter = fs.readFileSync(path.resolve('e2e/fake-puter.js'), 'utf8');

async function asUser(page, config) {
  await page.addInitScript((c) => {
    window.__puterConfig = c;
  }, config);
  await page.route('https://js.puter.com/v2/', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: fakePuter }));
  await mockApi(page);
  await page.goto('/');
  await page.waitForSelector('.shell');
  const dismiss = page.locator('.toast .icon-btn');
  if (await dismiss.count()) await dismiss.first().click();
}

test('signed-in users get cloud sync, a profile picture and sign out', async ({ page }) => {
  await asUser(page, { user: 'ada' });
  await expect(page.getByRole('button', { name: 'Account: ada' })).toBeVisible();
  await expect(page.locator('.account .avatar img')).toBeVisible();
  await page.getByRole('button', { name: 'New collection' }).first().click();
  await page.getByRole('dialog').getByRole('textbox').fill('Synced');
  await page.keyboard.press('Enter');
  await expect(page.locator('.sync-state')).toHaveAttribute('title', /All changes saved|Syncing|Saving/);
  await expect.poll(() => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('fake-puter-cloud') || '{"files":{}}').files).some((k) => k.includes('/workspace/collections/')))).toBe(true);
  await page.getByRole('button', { name: 'Account: ada' }).click();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
});

test('inside the Puter desktop there is no sign out', async ({ page }) => {
  await asUser(page, { user: 'ada', env: 'app' });
  await page.getByRole('button', { name: 'Account: ada' }).click();
  await expect(page.getByRole('menuitem', { name: 'Export everything' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toHaveCount(0);
});

test('collections can be shared with another user', async ({ page }) => {
  await asUser(page, { user: 'ada' });
  await page.evaluate(async () => {
    const app = window.apiClient;
    const c = await app.ws.addCollection({ name: 'Team API' });
    await app.ws.addItem(c.id, c.id, { id: 'r1', type: 'request', name: 'Health', method: 'GET', url: 'https://api.test/health' });
  });
  await page.getByRole('treeitem', { name: /Team API/ }).getByRole('button', { name: /Actions for/ }).click({ force: true });
  await page.getByRole('menuitem', { name: 'Share...' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Invite people').fill('bob');
  await dialog.getByLabel('Access', { exact: true }).selectOption('read');
  await dialog.getByRole('button', { name: 'Share' }).click();
  await expect(dialog.locator('.share-row')).toContainText('bob');
  await dialog.getByRole('button', { name: 'Done' }).click();

  // Bob opens the app (same fake cloud, different user and local database).
  await page.evaluate(() => {
    window.__puterConfig = { user: 'bob' };
  });
  await page.addInitScript(() => {
    window.__puterConfig = { user: 'bob' };
  });
  await page.reload();
  await page.waitForSelector('.shell');
  await expect(page.locator('.tree-heading')).toHaveText(/Shared with you/);
  await expect(page.getByRole('treeitem', { name: /Team API/ })).toBeVisible();
  await page.getByRole('treeitem', { name: /Team API/ }).click();
  await expect(page.locator('.shared-banner')).toContainText('Shared with you by ada');
});
