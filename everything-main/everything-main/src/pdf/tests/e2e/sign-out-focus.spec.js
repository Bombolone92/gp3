import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.signOutCalls = 0; window.puter = {
      env: 'web', auth: { isSignedIn: () => true, getUser: async () => ({username:'test'}),
        signOut: async () => { window.signOutCalls++; } },
      fs: { readdir: async () => [] }, ui: {},
    };`,
    }),
  );
  await page.goto('/');
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
  await expect(page.getByRole('button', { name: 'Save to Puter', exact: true })).toBeVisible();
  const bar = page.getByRole('menubar', { name: 'PDF menus' });
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'Page', exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Page', exact: true }).click();
  }
  await page.getByRole('menuitem', { name: 'Rotate clockwise', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Unsaved changes');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Appearance', { exact: true }).focus();
}
async function signOut(page, activation) {
  const button = page.getByRole('button', { name: 'Sign out', exact: true });
  if (activation === 'pointer') await button.click();
  else {
    await button.focus();
    await page.keyboard.press('Enter');
  }
  const confirmation = page.getByRole('dialog', { name: 'Leave this PDF?', exact: true });
  await expect(confirmation).toBeVisible();
  return confirmation;
}
for (const activation of ['pointer', 'keyboard']) {
  for (const dismiss of ['Cancel', 'Escape'])
    test(`${activation} sign-out returns focus after ${dismiss}`, async ({ page }) => {
      await setup(page);
      const confirmation = await signOut(page, activation);
      if (dismiss === 'Cancel')
        await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      else await page.keyboard.press('Escape');
      await expect(
        page.getByRole('dialog', { name: 'Leave this PDF?', includeHidden: true }),
      ).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused();
      await expect(page.locator('.save-status')).toHaveText('Unsaved changes');
      expect(await page.evaluate(() => window.signOutCalls)).toBe(0);
      // The next keyboard action must reopen the confirmation from the chosen control.
      await page.keyboard.press('Enter');
      await expect(confirmation).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused();
      await page
        .getByRole('dialog', { name: 'Settings', exact: true })
        .getByRole('button', { name: 'Close dialog', exact: true })
        .click();
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    });
  test(`${activation} sign-out still leaves after confirmation`, async ({ page }) => {
    await setup(page);
    const confirmation = await signOut(page, activation);
    await confirmation.getByRole('button', { name: 'Leave without saving', exact: true }).click();
    await expect(page.getByRole('button', { name: 'New blank PDF', exact: true })).toBeVisible();
    await expect(page.locator('.account-label')).toHaveText('Local workspace');
    expect(await page.evaluate(() => window.signOutCalls)).toBe(1);
    expect(await page.evaluate(() => location.hash)).toBe('#library');
    await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(0);
  });
}
