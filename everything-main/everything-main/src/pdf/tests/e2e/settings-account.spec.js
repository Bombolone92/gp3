import { test, expect } from '@playwright/test';

for (const change of ['initial profile', 'late sign-out'])
  for (const focus of ['appearance', 'about', 'account'])
    test(`Settings follows ${change} while preserving ${focus}`, async ({ page }) => {
      const profile = change === 'initial profile';
      await page.route('https://js.puter.com/**', (route) =>
        route.fulfill({
          contentType: 'application/javascript',
          body: `
        const account={username:'Alice'};
        window.puter={env:'web',auth:{isSignedIn:()=>true,
          getUser:()=>${profile ? 'new Promise(resolve=>{window.releaseAccountChange=()=>{resolve(account);setTimeout(()=>{window.accountChanged=true;},0);};})' : 'Promise.resolve(account)'},
          signIn:async()=>{},
          signOut:()=>${profile ? 'Promise.resolve()' : 'new Promise(resolve=>{window.releaseAccountChange=()=>{resolve();setTimeout(()=>{window.accountChanged=true;},0);};})'}
        },fs:{readdir:async()=>[]},ui:{}};`,
        }),
      );
      await page.goto('/');
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      if (!profile)
        await expect(
          page.getByRole('button', { name: 'Save to Puter', exact: true }),
        ).toBeVisible();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      if (!profile) {
        await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
        await expect
          .poll(() => page.evaluate(() => typeof window.releaseAccountChange))
          .toBe('function');
        await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
        await expect(settings).toHaveCount(0);
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
      }
      const appearance = settings.getByLabel('Appearance');
      await appearance.selectOption('dark');
      const selected =
        focus === 'appearance'
          ? appearance
          : settings.getByRole('button', {
              name:
                focus === 'about'
                  ? 'About PDF Editor'
                  : profile
                    ? 'Sign in with Puter'
                    : 'Sign out',
              exact: true,
            });
      await selected.focus();
      await expect(selected).toBeFocused();
      await expect
        .poll(() => page.evaluate(() => typeof window.releaseAccountChange))
        .toBe('function');
      await page.evaluate(() => window.releaseAccountChange());
      await expect.poll(() => page.evaluate(() => window.accountChanged)).toBe(true);
      await expect(settings).toContainText(profile ? 'Signed in as Alice' : 'Work locally');
      const current = settings.getByRole('button', {
        name: profile ? 'Sign out' : 'Sign in with Puter',
        exact: true,
      });
      await expect(current).toBeVisible();
      await expect(
        settings.getByRole('button', {
          name: profile ? 'Sign in with Puter' : 'Sign out',
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(appearance).toHaveValue('dark');
      await expect(focus === 'account' ? current : selected).toBeFocused();
      await expect(page).toHaveTitle('Untitled.pdf · PDF Editor');
      await expect(page.getByRole('dialog')).toHaveCount(1);
      if (profile) {
        await current.click();
        await expect(
          page.getByRole('button', { name: 'New blank PDF', exact: true }),
        ).toBeVisible();
        await expect(page.locator('.account-label')).toHaveText('Local workspace');
      } else {
        await current.click();
        await expect(
          page.getByRole('button', { name: 'Save to Puter', exact: true }),
        ).toBeVisible();
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      }
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });

test('a profile answer preserves the sign-out confirmation return target', async ({ page }) => {
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.getUserCalls=0;window.puter={
    env:'web',auth:{isSignedIn:()=>true,signIn:async()=>{},signOut:async()=>{},
      getUser:()=>++window.getUserCalls===1 ? new Promise(resolve=>{
        window.releaseProfile=()=>{resolve({username:'Alice'});setTimeout(()=>{window.profileFinished=true;},0);};
      }) : Promise.resolve({username:'Alice'})},fs:{readdir:async()=>[]},ui:{}};`,
    }),
  );
  await page.goto('/');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => page.evaluate(() => typeof window.releaseProfile)).toBe('function');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('button', { name: 'Sign in with Puter', exact: true }).click();
  await expect(settings).toHaveCount(0);
  const bar = page.getByRole('menubar');
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'Page', exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Page', exact: true }).click();
  }
  await page.getByRole('menuitem', { name: 'Rotate clockwise', exact: true }).click();
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Leave this PDF?', exact: true });
  await expect(confirmation).toBeVisible();
  await page.evaluate(() => window.releaseProfile());
  await expect.poll(() => page.evaluate(() => window.profileFinished)).toBe(true);
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused();
  await expect(page).toHaveTitle('* Untitled.pdf · PDF Editor');
});

test('a late desktop session keeps focus on an available Settings control', async ({ page }) => {
  let deliverSdk;
  await page.route('https://js.puter.com/**', async (route) => {
    await new Promise((resolve) => {
      deliverSdk = resolve;
    });
    await route.fulfill({
      contentType: 'application/javascript',
      body: `window.puter={
      env:'app',auth:{getUser:async()=>({username:'Alice'})},fs:{readdir:async()=>[]},
      ui:{onLaunchedWithItems:()=>{},onItemsOpened:()=>{}}};`,
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByLabel('Appearance').selectOption('dark');
  await settings.getByRole('button', { name: 'Sign in with Puter', exact: true }).focus();
  deliverSdk();
  await expect(settings).toContainText('Signed in as Alice');
  await expect(
    settings.getByRole('button', { name: 'Sign in with Puter', exact: true }),
  ).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
  await expect(settings.getByLabel('Appearance')).toHaveValue('dark');
  await expect(settings.getByLabel('Appearance')).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(1);
});
