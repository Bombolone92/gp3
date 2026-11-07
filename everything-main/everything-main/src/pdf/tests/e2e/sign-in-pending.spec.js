import { test, expect } from '@playwright/test';

for (const outcome of ['success', 'failure', 'cancel'])
  test(`repeated sign-in requests share a pending ${outcome} and allow retry`, async ({ page }) => {
    await page.route('https://js.puter.com/**', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `window.signInCalls=0;window.puter={env:'web',auth:{
          isSignedIn:()=>false,getUser:async()=>({username:'Alice'}),
          signIn:()=>{window.signInCalls++;return new Promise((resolve,reject)=>{
            window.finishSignIn=()=>{
              ${outcome === 'success' ? 'resolve();' : outcome === 'failure' ? "reject(new Error('Sign-in service unavailable'));" : "reject({error:'auth_window_closed'});"}
            };
          });}
        },fs:{readdir:async()=>[]},ui:{}};`,
      }),
    );
    await page.goto('/#library');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    const signIn = settings.getByRole('button', { name: 'Sign in with Puter', exact: true });
    await signIn.click();
    await expect.poll(() => page.evaluate(() => window.signInCalls)).toBe(1);
    // A second activation while the service is pending must not open another auth window.
    await signIn.click();
    expect(await page.evaluate(() => window.signInCalls)).toBe(1);
    await page.evaluate(() => window.finishSignIn());
    if (outcome === 'success') {
      await expect(settings).toHaveCount(0);
      await expect(page.locator('.account-label')).toHaveText('Alice');
    } else {
      if (outcome === 'failure')
        await expect(settings.getByRole('alert')).toHaveText('Sign-in service unavailable');
      else await expect(settings.getByRole('alert')).toBeHidden();
      await signIn.click();
      await expect.poll(() => page.evaluate(() => window.signInCalls)).toBe(2);
    }
  });

for (const source of ['settings', 'library'])
  test(`a cloud open shares a sign-in started from ${source}`, async ({ page }) => {
    await page.route('https://js.puter.com/**', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `window.signInCalls=0;window.openPickers=0;window.puter={env:'web',auth:{
          isSignedIn:()=>false,getUser:async()=>({username:'Alice'}),
          signIn:()=>{window.signInCalls++;return new Promise(resolve=>{window.finishSignIn=resolve;});}
        },fs:{readdir:async()=>[]},ui:{showOpenFilePicker:async()=>{window.openPickers++;return null;}}};`,
      }),
    );
    await page.goto('/#library');
    if (source === 'settings') {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      await settings.getByRole('button', { name: 'Sign in with Puter', exact: true }).click();
      await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await expect(settings).toHaveCount(0);
    } else await page.getByRole('button', { name: 'Sign in with Puter', exact: true }).click();
    await page.getByRole('button', { name: 'Open from Puter', exact: true }).click();
    expect(await page.evaluate(() => window.signInCalls)).toBe(1);
    await page.evaluate(() => window.finishSignIn());
    await expect.poll(() => page.evaluate(() => window.openPickers)).toBe(1);
    await expect(page.locator('.account-label')).toHaveText('Alice');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
