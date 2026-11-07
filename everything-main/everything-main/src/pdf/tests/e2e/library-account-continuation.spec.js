import { test, expect } from '@playwright/test';

for (const stage of ['read', 'buffer'])
  for (const newer of ['none', 'sign-out', 'other account'])
    test(`Duplicate's pending ${stage} respects ${newer}`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('https://js.puter.com/**', (route) =>
        route.fulfill({
          contentType: 'application/javascript',
          body: `window.account={username:'Alice'};window.writes=[];window.libraryBuffers=0;
          const hold=()=>new Promise(resolve=>{window.releaseDuplicate=()=>{resolve();setTimeout(()=>{window.duplicateReleased=true;},0);};});
          window.puter={env:'web',auth:{
            isSignedIn:()=>!!window.account,getUser:async()=>window.account,
            signOut:async()=>{window.account=null;},signIn:async()=>{window.account={username:'Bob'};}
          },fs:{
            readdir:async()=>[{name:'private.pdf',path:'PDF Editor/private.pdf'}],
            read:async()=>{
              if(${JSON.stringify(stage)}==='read')await hold();
              const blob=new Blob(['private Alice content']);
              const buffer=blob.arrayBuffer;
              blob.arrayBuffer=async function(){window.libraryBuffers++;if(${JSON.stringify(stage)}==='buffer')await hold();return buffer.call(this);};
              return blob;
            },
            write:async(path,blob)=>{
              window.writes.push({path,account:window.account?.username??null,text:await blob.text()});
              return {path};
            }
          },ui:{}};`,
        }),
      );
      await page.goto('/#library');
      await expect(page.locator('.account-label')).toHaveText('Alice');
      await page.getByRole('button', { name: 'Options for private.pdf', exact: true }).click();
      await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
      await expect.poll(() => page.evaluate(() => typeof window.releaseDuplicate)).toBe('function');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      if (newer !== 'none') {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
        await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
        await expect(page.locator('.account-label')).toHaveText('Local workspace');
        if (newer === 'other account') {
          await page.getByRole('button', { name: 'Settings', exact: true }).click();
          await settings.getByRole('button', { name: 'Sign in with Puter', exact: true }).click();
          await expect(settings).toHaveCount(0);
          await expect(page.locator('.account-label')).toHaveText('Bob');
        }
      }
      await page.evaluate(() => window.releaseDuplicate());
      await expect.poll(() => page.evaluate(() => window.duplicateReleased)).toBe(true);
      expect(await page.evaluate(() => window.writes)).toEqual(
        newer === 'none'
          ? [
              {
                path: 'PDF Editor/private copy.pdf',
                account: 'Alice',
                text: 'private Alice content',
              },
            ]
          : [],
      );
      expect(await page.evaluate(() => window.libraryBuffers)).toBe(
        stage === 'buffer' || newer === 'none' ? 1 : 0,
      );
      await expect(page.locator('.account-label')).toHaveText(
        newer === 'none' ? 'Alice' : newer === 'other account' ? 'Bob' : 'Local workspace',
      );
      await expect(page.locator('#toast')).toBeHidden();
      expect(errors).toEqual([]);
    });

for (const signedOut of [false, true])
  test(`a duplicate read failure ${signedOut ? 'is retired after sign-out' : 'still reports a current error'}`, async ({
    page,
  }) => {
    await page.route('https://js.puter.com/**', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `window.puter={env:'web',auth:{isSignedIn:()=>true,getUser:async()=>({username:'Alice'}),signOut:async()=>{}},
        fs:{readdir:async()=>[{name:'private.pdf',path:'PDF Editor/private.pdf'}],
          read:()=>new Promise((resolve,reject)=>{window.failDuplicate=()=>{
            reject(new Error('Duplicate read failed'));setTimeout(()=>{window.duplicateFailed=true;},0);
          };})},ui:{}};`,
      }),
    );
    await page.goto('/#library');
    await page.getByRole('button', { name: 'Options for private.pdf', exact: true }).click();
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof window.failDuplicate)).toBe('function');
    if (signedOut) {
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Settings', exact: true })
        .getByRole('button', { name: 'Sign out', exact: true })
        .click();
      await expect(page.locator('.account-label')).toHaveText('Local workspace');
    }
    await page.evaluate(() => window.failDuplicate());
    await expect.poll(() => page.evaluate(() => window.duplicateFailed)).toBe(true);
    if (signedOut) {
      expect(await page.locator('#toast').textContent()).not.toContain('Duplicate read failed');
      await expect(page.locator('#toast')).toBeHidden();
    } else {
      const dialog = page.getByRole('dialog', { name: 'private.pdf', exact: true });
      await expect(dialog.getByRole('alert')).toHaveText('Duplicate read failed');
      await expect(dialog.getByRole('button', { name: 'Duplicate', exact: true })).toBeEnabled();
    }
  });
