import { test, expect } from '@playwright/test';

for (const outcome of ['success', 'failure'])
  for (const reopened of [false, true])
    test(`repeated sign-out shares one pending ${outcome}${reopened ? ' across reopened Settings' : ''} and permits a later attempt`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) =>
        route.fulfill({
          contentType: 'application/javascript',
          body: `window.account={username:'Alice'};window.signOutCalls=0;
      window.puter={env:'web',auth:{isSignedIn:()=>!!window.account,getUser:async()=>window.account,
        signIn:async()=>{window.account={username:'Bob'};},
        signOut:()=>{window.signOutCalls++;return new Promise((resolve,reject)=>{window.finishSignOut=()=>{
          if(${JSON.stringify(outcome)}==='failure'&&window.signOutCalls===1)reject(new Error('Sign-out failed'));
          else{window.account=null;resolve();}
        };});}},fs:{readdir:async()=>[]},ui:{}};`,
        }),
      );
      await page.goto('/#library');
      await expect(page.locator('.account-label')).toHaveText('Alice');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      const signOut = settings.getByRole('button', { name: 'Sign out', exact: true });
      await signOut.dblclick();
      expect(await page.evaluate(() => window.signOutCalls)).toBe(1);
      if (reopened) {
        await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
        await expect(settings).toHaveCount(0);
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await signOut.click();
        expect(await page.evaluate(() => window.signOutCalls)).toBe(1);
      }
      await page.evaluate(() => window.finishSignOut());
      if (outcome === 'failure') {
        await expect(settings.getByRole('alert')).toHaveText('Sign-out failed');
        await expect(signOut).toBeEnabled();
        await expect(page.locator('.account-label')).toHaveText('Alice');
      } else {
        await expect(page.locator('.account-label')).toHaveText('Local workspace');
        if (reopened) await expect(settings).toBeVisible();
        else {
          await expect(settings).toHaveCount(0);
          await page.getByRole('button', { name: 'Settings', exact: true }).click();
        }
        await settings.getByRole('button', { name: 'Sign in with Puter', exact: true }).click();
        await expect(page.locator('.account-label')).toHaveText('Bob');
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
      }
      await signOut.click();
      await expect.poll(() => page.evaluate(() => window.signOutCalls)).toBe(2);
      await page.evaluate(() => window.finishSignOut());
      await expect(page.locator('.account-label')).toHaveText('Local workspace');
      await expect(settings).toHaveCount(0);
    });
