import { test, expect } from '@playwright/test';

for (const view of ['editor', 'library'])
  for (const stage of ['profile', 'profile failure', 'session check'])
    for (const newer of ['sign-in', 'sign-out', 'SDK sign-in'])
      test(`${view} initial ${stage} respects a newer ${newer}`, async ({ page }) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('https://js.puter.com/**', (route) =>
          route.fulfill({
            contentType: 'application/javascript',
            body: `
          window.mockAccount={username:'Alice'};
          window.profileReads=0;window.sessionReads=0;
          const markFinished=()=>setTimeout(()=>{window.initialAccountFinished=true;},0);
          window.puter={env:'web',auth:{
            isSignedIn:()=>${JSON.stringify(stage)}==='session check' && ++window.sessionReads===1
              ? new Promise(resolve=>{window.releaseInitialAccount=()=>{
                  resolve(${newer === 'sign-out'});markFinished();
                };}) : Promise.resolve(!!window.mockAccount),
            getUser:()=>{
              if(${JSON.stringify(stage)}!=='session check' && ++window.profileReads===1)
                return new Promise((resolve,reject)=>{window.releaseInitialAccount=()=>{
                  if(${JSON.stringify(stage)}==='profile failure') reject(new Error('Old profile unavailable'));
                  else resolve({username:'Alice'});
                  markFinished();
                };});
              if(!window.mockAccount) throw new Error('Not signed in');
              return Promise.resolve(window.mockAccount);
            },
            signIn:async()=>{window.mockAccount={username:'Bob'};},
            signOut:async()=>{window.mockAccount=null;},
          },fs:{readdir:async()=>[{name:'report.pdf',path:'PDF Editor/report.pdf',size:10}]},ui:{}};`,
          }),
        );
        await page.goto(view === 'library' ? '/#library' : '/');
        if (view === 'editor')
          await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        await expect
          .poll(() => page.evaluate(() => typeof window.releaseInitialAccount))
          .toBe('function');
        if (newer === 'SDK sign-in')
          await page.evaluate(() => {
            window.mockAccount = { username: 'Bob' };
            window.puter.onAuth(window.mockAccount);
          });
        else {
          await page.getByRole('button', { name: 'Settings', exact: true }).click();
          const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
          await settings.getByRole('button', { name: 'Sign in with Puter', exact: true }).click();
          await expect(settings).toHaveCount(0);
          if (newer === 'sign-out') {
            await page.getByRole('button', { name: 'Settings', exact: true }).click();
            await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
            await expect(settings).toHaveCount(0);
            await expect(page.locator('.account-label')).toHaveText('Local workspace');
          }
        }
        if (view === 'library' && newer !== 'sign-out') {
          await expect(page.locator('.account-label')).toHaveText('Bob');
          await page.getByRole('searchbox', { name: 'Search PDFs', exact: true }).fill('report');
        }
        await page.evaluate(() => window.releaseInitialAccount());
        await expect.poll(() => page.evaluate(() => window.initialAccountFinished)).toBe(true);
        if (newer === 'sign-out') {
          await expect(page.locator('.account-label')).toHaveText('Local workspace');
          await page.getByRole('button', { name: 'New blank PDF', exact: true }).click();
          await expect(
            page.getByRole('button', { name: 'Sign in to save', exact: true }),
          ).toBeVisible();
        } else if (view === 'library') {
          await expect(page.locator('.account-label')).toHaveText('Bob');
          await expect(
            page.getByRole('searchbox', { name: 'Search PDFs', exact: true }),
          ).toHaveValue('report');
        } else
          await expect(
            page.getByRole('button', { name: 'Save to Puter', exact: true }),
          ).toBeVisible();
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
        await expect(settings).toContainText(
          newer === 'sign-out' ? 'Work locally' : 'Signed in as Bob',
        );
        await expect(settings).not.toContainText('Signed in as Alice');
        await expect(page.getByRole('dialog')).toHaveCount(1);
        await expect(
          settings.getByRole('button', {
            name: newer === 'sign-out' ? 'Sign in with Puter' : 'Sign out',
            exact: true,
          }),
        ).toBeVisible();
        expect(errors).toEqual([]);
      });
