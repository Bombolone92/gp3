import { test, expect } from '@playwright/test';

for (const action of ['Rename', 'Delete', 'Duplicate'])
  for (const signedOut of [false, true])
    test(`${action}'s library dialog ${signedOut ? 'retires when its account ends' : 'still works within its account'}`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) =>
        route.fulfill({
          contentType: 'application/javascript',
          body: `window.account={username:'Alice'};window.actions=[];
        const record=(action,path)=>window.actions.push({action,path,account:window.account?.username??null});
        window.puter={env:'web',auth:{isSignedIn:()=>!!window.account,getUser:async()=>window.account,
          signIn:async()=>{window.account={username:'Bob'};},
          signOut:()=>new Promise(resolve=>{window.releaseSignOut=()=>{window.account=null;resolve();};})},
          fs:{readdir:async()=>[{name:'private.pdf',path:'PDF Editor/private.pdf'}],
            read:async(path)=>{record('read',path);return new Blob(['private content']);},
            write:async(path)=>{record('write',path);return {path};},
            rename:async(path)=>record('rename',path),delete:async(path)=>record('delete',path)},ui:{}};`,
        }),
      );
      await page.goto('/#library');
      await expect(page.locator('.account-label')).toHaveText('Alice');
      if (signedOut) {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
        await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
        await expect.poll(() => page.evaluate(() => typeof window.releaseSignOut)).toBe('function');
        await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
        await expect(settings).toHaveCount(0);
      }
      await page.getByRole('button', { name: 'Options for private.pdf', exact: true }).click();
      if (action !== 'Duplicate')
        await page.getByRole('button', { name: action, exact: true }).click();
      const dialog = page.getByRole('dialog', {
        name:
          action === 'Rename' ? 'Rename PDF' : action === 'Delete' ? 'Delete PDF?' : 'private.pdf',
        exact: true,
      });
      await expect(dialog).toBeVisible();
      if (action === 'Rename')
        await dialog.getByRole('textbox', { name: 'File name', exact: true }).fill('renamed');
      if (signedOut) {
        await page.evaluate(() => window.releaseSignOut());
        await expect(page.locator('.account-label')).toHaveText('Local workspace');
      }
      // Exercise an obsolete confirmation if it remains exposed by the app.
      if (await dialog.isVisible())
        await dialog
          .getByRole('button', {
            name:
              action === 'Rename' ? 'Continue' : action === 'Delete' ? 'Delete PDF' : 'Duplicate',
            exact: true,
          })
          .click();
      await expect(dialog).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => window.actions))
        .toEqual(
          signedOut
            ? []
            : action === 'Duplicate'
              ? [
                  { action: 'read', path: 'PDF Editor/private.pdf', account: 'Alice' },
                  { action: 'write', path: 'PDF Editor/private copy.pdf', account: 'Alice' },
                ]
              : [
                  {
                    action: action.toLowerCase(),
                    path: 'PDF Editor/private.pdf',
                    account: 'Alice',
                  },
                ],
        );
      if (signedOut) {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await page
          .getByRole('dialog', { name: 'Settings', exact: true })
          .getByRole('button', { name: 'Sign in with Puter', exact: true })
          .click();
        await expect(page.locator('.account-label')).toHaveText('Bob');
        await expect(
          page.getByRole('button', { name: 'Options for private.pdf', exact: true }),
        ).toBeEnabled();
      }
    });
