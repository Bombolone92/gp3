import { test, expect } from '@playwright/test';

for (const source of ['settings', 'cloud open'])
  for (const outcome of ['profile', 'profile failure'])
    for (const retry of [false, true])
      test(`${source} late ${outcome} respects sign-out${retry ? ' and a fresh sign-in' : ''}`, async ({
        page,
      }) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('https://js.puter.com/**', (route) =>
          route.fulfill({
            contentType: 'application/javascript',
            body: `window.signInCalls=0;window.openPickers=0;window.mockAccount=null;
            window.puter={env:'web',auth:{
              isSignedIn:()=>!!window.mockAccount,
              signIn:async()=>{
                window.mockAccount={username:++window.signInCalls===1?'Alice':'Bob'};
                window.puter.onAuth(window.mockAccount);
              },
              getUser:()=>window.signInCalls===1?new Promise((resolve,reject)=>{
                window.releaseOldProfile=()=>{
                  ${outcome === 'profile' ? "resolve({username:'Alice'});" : "reject(new Error('Old profile unavailable'));"}
                  setTimeout(()=>{window.oldProfileFinished=true;},0);
                };
              }):Promise.resolve(window.mockAccount),
              signOut:async()=>{window.mockAccount=null;}
            },fs:{readdir:async()=>[]},ui:{showOpenFilePicker:async()=>{window.openPickers++;return null;}}};`,
          }),
        );
        await page.goto('/#library');
        if (source === 'settings') {
          await page.getByRole('button', { name: 'Settings', exact: true }).click();
          await page
            .getByRole('dialog', { name: 'Settings', exact: true })
            .getByRole('button', { name: 'Sign in with Puter', exact: true })
            .click();
        } else {
          await page.getByRole('button', { name: 'Open from Puter', exact: true }).click();
          await expect(page.locator('.account-label')).toHaveText('Puter user');
          await page.getByRole('button', { name: 'Settings', exact: true }).click();
        }
        const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
        await expect
          .poll(() => page.evaluate(() => typeof window.releaseOldProfile))
          .toBe('function');
        await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
        await expect(settings).toHaveCount(0);
        await expect(page.locator('.account-label')).toHaveText('Local workspace');
        if (retry) {
          await page.getByRole('button', { name: 'Settings', exact: true }).click();
          await settings.getByRole('button', { name: 'Sign in with Puter', exact: true }).click();
          await expect.poll(() => page.evaluate(() => window.signInCalls)).toBe(2);
          await expect(settings).toHaveCount(0);
          await expect(page.locator('.account-label')).toHaveText('Bob');
        }
        await page.evaluate(() => window.releaseOldProfile());
        await expect.poll(() => page.evaluate(() => window.oldProfileFinished)).toBe(true);
        await expect(page.locator('.account-label')).toHaveText(retry ? 'Bob' : 'Local workspace');
        expect(await page.evaluate(() => window.openPickers)).toBe(0);
        expect(await page.locator('#toast').textContent()).not.toContain('Old profile unavailable');
        await expect(page.locator('#toast')).toBeHidden();
        expect(errors).toEqual([]);
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await expect(settings).toContainText(retry ? 'Signed in as Bob' : 'Work locally');
      });

for (const action of ['save', 'save as'])
  test(`sign-out retires authentication for a pending ${action}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('https://js.puter.com/**', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `window.writes=0;window.savePickers=0;window.mockAccount=null;
          window.puter={env:'web',auth:{
            isSignedIn:()=>!!window.mockAccount,
            signIn:async()=>{
              window.mockAccount={username:'Alice'};
              window.puter.onAuth(window.mockAccount);
            },
            getUser:()=>new Promise(resolve=>{
              window.releaseOldProfile=()=>{resolve({username:'Alice'});setTimeout(()=>{window.oldProfileFinished=true;},0);};
            }),
            signOut:async()=>{window.mockAccount=null;}
          },fs:{readdir:async()=>[],write:async()=>{window.writes++;return {};}}
          ,ui:{showSaveFilePicker:async()=>{window.savePickers++;return null;}}};`,
      }),
    );
    await page.goto('/');
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('button', { name: 'Sign in to save', exact: true })).toBeVisible();
    if (action === 'save')
      await page.getByRole('button', { name: 'Sign in to save', exact: true }).click();
    else {
      const bar = page.getByRole('menubar');
      if (await bar.isVisible())
        await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
      else await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page
        .getByRole('menuitem', { name: 'Save to another Puter folder…', exact: true })
        .click();
    }
    await expect.poll(() => page.evaluate(() => typeof window.releaseOldProfile)).toBe('function');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Settings', exact: true })
      .getByRole('button', { name: 'Sign out', exact: true })
      .click();
    if (action === 'save')
      await page
        .getByRole('dialog', { name: 'Leave this PDF?', exact: true })
        .getByRole('button', { name: 'Leave without saving', exact: true })
        .click();
    await expect(page.locator('.account-label')).toHaveText('Local workspace');
    await page.evaluate(() => window.releaseOldProfile());
    await expect.poll(() => page.evaluate(() => window.oldProfileFinished)).toBe(true);
    expect(await page.evaluate(() => [window.writes, window.savePickers])).toEqual([0, 0]);
    await expect(page.locator('.account-label')).toHaveText('Local workspace');
    await expect(page.locator('#toast')).toBeHidden();
    expect(errors).toEqual([]);
  });
