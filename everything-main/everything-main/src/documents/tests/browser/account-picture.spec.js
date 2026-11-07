import { test, expect } from '@playwright/test';

const account = page => page.getByRole('button', { name: 'Account menu for demo', exact: true });

test('shows a cropped profile picture in home and editor, sharing the cache across views and theme changes', async ({ page }, info) => {
  await page.goto('/mock.html?picture#/home');
  const image = account(page).locator('img');
  await expect(image).toBeVisible();
  expect(await image.evaluate(img => [img.naturalWidth, img.naturalHeight])).toEqual([64, 40]);
  expect(await image.evaluate(img => [img.offsetWidth, img.offsetHeight, getComputedStyle(img).objectFit])).toEqual([32, 32, 'cover']);
  await page.evaluate(async () => {
    const { session } = await import('/src/lib/session.js');
    const original = puter.auth.getProfilePicture;
    window.pictureCalls = 0;
    puter.auth.getProfilePicture = (...args) => { window.pictureCalls++; return original(...args); };
    window.avatarImage = document.querySelector('.user-btn img');
    session.setTheme('dark');
  });
  await expect(image).toBeVisible();
  expect(await image.evaluate(img => img === window.avatarImage)).toBe(true);
  await account(page).click();
  await expect(page.getByRole('menu', { name: 'Account', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'New document', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Document text' })).toBeVisible();
  await expect(image).toBeVisible();
  expect(await page.evaluate(() => window.pictureCalls)).toBe(0);
  await page.screenshot({ path: info.outputPath('profile-picture-editor.png'), animations: 'disabled' });
  await page.evaluate(() => { location.hash = '#/home'; });
  await expect(image).toBeVisible();
  expect(await page.evaluate(() => window.pictureCalls)).toBe(0);
});

test('keeps the initial while loading, recovers from an undecodable image, and ignores a late response after sign-out', async ({ page }) => {
  await page.route('**/dev/puter-mock.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.pictureCalls = 0; puter.auth.getProfilePicture = () => { window.pictureCalls++; return new Promise(resolve => { window.resolvePicture = resolve; }); };` });
  });
  await page.goto('/mock.html#/new');
  await expect(page.getByRole('textbox', { name: 'Document text' })).toBeVisible();
  await expect(account(page)).toHaveText('d');
  expect(await page.evaluate(() => window.pictureCalls)).toBe(1);
  await page.evaluate(() => {
    const create = document.createElement;
    document.createElement = function(...args) {
      const element = create.apply(this, args);
      if (args[0] === 'img') {
        element.addEventListener('error', () => { window.pictureDecodeFailed = true; });
        document.createElement = create;
      }
      return element;
    };
    window.resolvePicture('data:image/png;base64,aGVsbG8=');
  });
  await expect.poll(() => page.evaluate(() => window.pictureDecodeFailed)).toBe(true);
  await expect(account(page)).toHaveText('d');
  await expect(account(page).locator('img')).toHaveCount(0);
  await page.evaluate(async () => {
    const { session } = await import('/src/lib/session.js');
    puter.auth.signOut(); await session.refresh();
    await puter.auth.signIn(); await session.refresh();
  });
  expect(await page.evaluate(() => window.pictureCalls)).toBe(2);
  await page.evaluate(async () => {
    const { session } = await import('/src/lib/session.js');
    puter.auth.signOut(); await session.refresh();
    window.resolvePicture('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZAAAAABJRU5ErkJggg==');
  });
  const guest = page.getByRole('button', { name: 'Account menu. Not signed in', exact: true });
  await expect(guest.locator('.user-avatar-anon')).toBeVisible();
  await expect(guest.locator('img')).toHaveCount(0);
});

test('does not request a picture or prompt for authentication when signed out', async ({ page }) => {
  await page.route('**/dev/puter-mock.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.pictureCalls = 0; window.signInCalls = 0; puter.auth.getProfilePicture = () => { window.pictureCalls++; return Promise.resolve(null); }; puter.auth.signIn = () => { window.signInCalls++; };` });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/mock.html?picture&signedout#/new');
  await expect(page.getByRole('textbox', { name: 'Document text' })).toBeVisible();
  await expect(page.locator('.user-avatar-anon')).toBeVisible();
  await expect(page.locator('.user-btn img')).toHaveCount(0);
  expect(await page.evaluate(() => [window.pictureCalls, window.signInCalls])).toEqual([0, 0]);
  expect(errors).toEqual([]);
});
