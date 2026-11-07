import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function mockSDK(page, stage) {
  const doc = await PDFDocument.create();
  doc.addPage([410, 500]);
  const encoded = Buffer.from(await doc.save()).toString('base64');
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.account={username:'Alice',uuid:'alice'};window.writes=[];window.sessionReads=0;window.profileReads=0;
      const hold=(key,value)=>new Promise(resolve=>{window[key]=()=>{resolve(value);setTimeout(()=>{window[key+'Done']=true;},0);};});
      window.puter={env:'web',authToken:'token:alice',auth:{
        isSignedIn:()=>++window.sessionReads===1&&${JSON.stringify(stage)}==='session'
          ?hold('finishInitialRead',true):!!window.account,
        getUser:()=>{
          const account=window.account;
          if(++window.profileReads===1&&${JSON.stringify(stage)}==='profile')return hold('finishInitialRead',account);
          if(window.holdSignInProfile){window.holdSignInProfile=false;return hold('finishSignInProfile',account);}
          return Promise.resolve(account);
        },
        signIn:async()=>{window.account={username:'Bob',uuid:'bob'};window.puter.authToken='token:bob';window.holdSignInProfile=true;},
        signOut:async()=>{window.account=null;window.puter.authToken=null;}
      },fs:{
        readdir:async()=>[{name:window.account.username+' file.pdf',path:'PDF Editor/report.pdf'}],
        read:async()=>new Blob([Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0))]),
        write:async(path,blob,options)=>{window.writes.push({path,options,account:window.account.username});return {path,name:'report.pdf'};}
      },ui:{showOpenFilePicker:async()=>({name:'report.pdf',path:'PDF Editor/report.pdf'})}};`,
    }),
  );
}
async function delayedSignIn(page, changeAccount = true) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('button', { name: 'Sign in with Puter', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.finishSignInProfile)).toBe('function');
  await page.evaluate((changeAccount) => {
    if (changeAccount) {
      window.account = { username: 'Carol', uuid: 'carol' };
      window.puter.authToken = 'token:carol';
    }
    window.finishSignInProfile();
  }, changeAccount);
  await expect(settings).toHaveCount(0);
}

for (const stage of ['session', 'profile']) {
  test(`a startup ${stage} read cannot let sign-in attach an old profile to a newer SDK token`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await mockSDK(page, stage);
    await page.goto('/#library');
    await expect.poll(() => page.evaluate(() => typeof window.finishInitialRead)).toBe('function');
    await delayedSignIn(page);
    await expect(page.locator('.account-label')).toHaveText('Carol');
    await expect(page.getByRole('button', { name: 'Carol file.pdf', exact: true })).toBeVisible();
    await page.evaluate(() => window.finishInitialRead());
    await expect.poll(() => page.evaluate(() => window.finishInitialReadDone)).toBe(true);
    await expect(page.locator('.account-label')).toHaveText('Carol');
    await expect(page.locator('#toast')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test(`a startup ${stage} race cannot preserve another account's opened save destination`, async ({
    page,
  }) => {
    await mockSDK(page, stage);
    await page.goto('/#library');
    await expect.poll(() => page.evaluate(() => typeof window.finishInitialRead)).toBe('function');
    await delayedSignIn(page);
    // Open the current SDK account's file even if the app adopted an obsolete profile.
    await page.getByRole('button', { name: 'Carol file.pdf', exact: true }).click();
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await page.evaluate(() => {
      window.account = { username: 'Bob', uuid: 'bob' };
      window.puter.authToken = 'token:bob';
      return window.puter.onAuth(window.account);
    });
    await page.getByRole('button', { name: /^Save(?: to Puter)?$/ }).click();
    await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
    const write = await page.evaluate(() => window.writes.at(-1));
    expect(write.account).toBe('Bob');
    expect(write.options.overwrite).toBe(false);
    expect(write.options.dedupeName).toBe(true);
    await page.evaluate(() => window.finishInitialRead());
    await expect.poll(() => page.evaluate(() => window.finishInitialReadDone)).toBe(true);
    await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
  });
}

for (const stage of ['session', 'profile'])
  test(`a startup ${stage} read preserves a verified same-account save destination`, async ({
    page,
  }) => {
    await mockSDK(page, stage);
    await page.goto('/#library');
    await expect.poll(() => page.evaluate(() => typeof window.finishInitialRead)).toBe('function');
    await delayedSignIn(page, false);
    await expect(page.locator('.account-label')).toHaveText('Bob');
    await page.getByRole('button', { name: 'Bob file.pdf', exact: true }).click();
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await page.evaluate(() => window.puter.onAuth(window.account));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
    const write = await page.evaluate(() => window.writes.at(-1));
    expect(write.account).toBe('Bob');
    expect(write.options.overwrite).toBe(true);
    expect(write.options.dedupeName).toBe(false);
    await page.evaluate(() => window.finishInitialRead());
    await expect.poll(() => page.evaluate(() => window.finishInitialReadDone)).toBe(true);
    await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
    expect(await page.evaluate(() => window.writes)).toHaveLength(1);
  });
