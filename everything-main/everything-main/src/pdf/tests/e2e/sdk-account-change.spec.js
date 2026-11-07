import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function mockSDK(page, { protectedPdf = false, initialListError = false } = {}) {
  const doc = await PDFDocument.create();
  doc.addPage([410, 500]);
  const encoded = protectedPdf
    ? (
        await (
          await import('node:fs/promises')
        ).readFile(new URL('../fixtures/security/owner-only.pdf', import.meta.url))
      ).toString('base64')
    : Buffer.from(await doc.save()).toString('base64');
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.account={username:'Alice',uuid:'alice'};window.writes=[];window.listReads=0;window.profileReads=0;window.signInCalls=0;window.savePickers=0;
    const item={path:'PDF Editor/report.pdf',name:'report.pdf'};
    window.puter={env:'web',authToken:'token:alice',auth:{isSignedIn:()=>!!window.account,
      getUser:async()=>{
        window.profileReads++;
        const account=window.account;
        if(window.holdProfile){window.holdProfile=false;await new Promise(resolve=>{window.releaseProfile=()=>{resolve();setTimeout(()=>{window.profileDone=true;},0);};});}
        if(!account)throw new Error('No account');return account;
      },signOut:async()=>{window.account=null;window.puter.authToken=null;},signIn:async()=>{window.signInCalls++;window.account={username:'Bob',uuid:'bob'};window.puter.authToken='token:bob';}},
      fs:{readdir:async()=>{window.listReads++;if(${initialListError}&&window.listReads===1)throw new Error('Try later');return [{name:window.account.username+' file.pdf',path:'PDF Editor/report.pdf'}];},
        read:async()=>{if(window.holdRead)await new Promise(resolve=>{window.releaseRead=()=>{resolve();setTimeout(()=>{window.readDone=true;},0);};});
          return new Blob([Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0))]);},
        write:async(path,blob,options)=>{window.writes.push({path,options,account:window.account?.username});return item;}},
      ui:{showOpenFilePicker:async()=>item,showSaveFilePicker:async()=>{window.savePickers++;return null;}}};`,
    }),
  );
}
async function openCloud(page) {
  const bar = page.getByRole('menubar');
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
  else await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open from Puter…', exact: true }).click();
  await expect(page).toHaveTitle('report.pdf · PDF Editor');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
}
async function signOut(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Settings', exact: true })
    .getByRole('button', { name: 'Sign out', exact: true })
    .click();
  await expect(page.locator('.account-label')).toHaveText('Local workspace');
}

for (const same of [false, true])
  test(`an SDK auth callback ${same ? 'refreshes the same account without resetting library work' : 'switches an existing library account'}`, async ({
    page,
  }) => {
    await mockSDK(page);
    await page.goto('/#library');
    await expect(page.locator('.account-label')).toHaveText('Alice');
    const search = page.getByRole('searchbox', { name: 'Search PDFs', exact: true });
    await search.fill('file');
    const reads = await page.evaluate(() => window.listReads);
    await page.evaluate((same) => {
      window.account = same
        ? { username: 'Alice renamed', uuid: 'alice' }
        : { username: 'Bob', uuid: 'bob' };
      window.puter.authToken = 'token:' + window.account.uuid;
      return window.puter.onAuth(window.account);
    }, same);
    await expect(page.locator('.account-label')).toHaveText(same ? 'Alice renamed' : 'Bob');
    await expect(search).toHaveValue(same ? 'file' : '');
    if (same) expect(await page.evaluate(() => window.listReads)).toBe(reads);
    else
      await expect(page.getByRole('button', { name: 'Bob file.pdf', exact: true })).toBeVisible();
  });

for (const account of [
  { username: 'Bob', uuid: 'bob' },
  { username: 'Alice', uuid: 'different-alice' },
  { username: 'Alice renamed', uuid: 'alice' },
])
  test(`an SDK account ${account.uuid} / ${account.username} keeps cloud destinations within their owner`, async ({
    page,
  }) => {
    await mockSDK(page);
    await page.goto('/');
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await openCloud(page);
    await page.evaluate((account) => {
      window.account = account;
      window.puter.authToken = 'token:' + account.uuid;
      return window.puter.onAuth(account);
    }, account);
    await page.getByRole('button', { name: /^Save(?: to Puter)?$/ }).click();
    await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
    const write = await page.evaluate(() => window.writes.at(-1));
    expect(write.account).toBe(account.username);
    expect(write.options.overwrite).toBe(account.uuid === 'alice');
    expect(write.options.dedupeName).toBe(account.uuid !== 'alice');
  });

for (const newer of ['sign-out', 'other account'])
  test(`a delayed SDK auth callback cannot restore an older profile after ${newer}`, async ({
    page,
  }) => {
    await mockSDK(page);
    await page.goto('/#library');
    await expect(page.locator('.account-label')).toHaveText('Alice');
    await signOut(page);
    if (newer === 'other account') {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Settings', exact: true })
        .getByRole('button', { name: 'Sign in with Puter', exact: true })
        .click();
      await expect(page.locator('.account-label')).toHaveText('Bob');
    }
    await page.evaluate(() => window.puter.onAuth({ username: 'Alice', uuid: 'alice' }));
    await expect(page.locator('.account-label')).toHaveText(
      newer === 'sign-out' ? 'Local workspace' : 'Bob',
    );
  });

test('a save waits for SDK account verification and does not overwrite the older destination', async ({
  page,
}) => {
  await mockSDK(page);
  await page.goto('/');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await openCloud(page);
  await page.evaluate(() => {
    window.account = { username: 'Bob', uuid: 'bob' };
    window.puter.authToken = 'token:bob';
    window.holdProfile = true;
    window.puter.onAuth(window.account);
  });
  await expect.poll(() => page.evaluate(() => typeof window.releaseProfile)).toBe('function');
  const save = page.getByRole('button', { name: /^Save(?: to Puter)?$/ });
  await save.click();
  await expect(page.locator('.save-status')).toHaveText('Saving…');
  expect(await page.evaluate(() => window.writes)).toEqual([]);
  await page.evaluate(() => window.releaseProfile());
  await expect.poll(() => page.evaluate(() => window.profileDone)).toBe(true);
  await expect(save).toBeEnabled();
  expect(await page.evaluate(() => window.writes)).toEqual([]);
  await save.click();
  await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
  expect(await page.evaluate(() => window.writes.at(-1).options.overwrite)).toBe(false);
});

test('an older duplicate cannot write while SDK account verification is pending', async ({
  page,
}) => {
  await mockSDK(page);
  await page.goto('/#library');
  await expect(page.locator('.account-label')).toHaveText('Alice');
  await page.evaluate(() => {
    window.holdRead = true;
  });
  await page.getByRole('button', { name: 'Options for Alice file.pdf', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseRead)).toBe('function');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.account = { username: 'Bob', uuid: 'bob' };
    window.puter.authToken = 'token:bob';
    window.holdProfile = true;
    window.puter.onAuth(window.account);
  });
  await expect.poll(() => page.evaluate(() => typeof window.releaseProfile)).toBe('function');
  await page.evaluate(() => window.releaseRead());
  await expect.poll(() => page.evaluate(() => window.readDone)).toBe(true);
  expect(await page.evaluate(() => window.writes)).toEqual([]);
  await page.evaluate(() => window.releaseProfile());
  await expect(page.locator('.account-label')).toHaveText('Bob');
  expect(await page.evaluate(() => window.writes)).toEqual([]);
});

for (const initiallySignedOut of [false, true])
  test(`a token change before its callback verifies ${initiallySignedOut ? 'a signed-out' : 'the previous'} account before saving`, async ({
    page,
  }) => {
    await mockSDK(page);
    await page.goto('/');
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    if (initiallySignedOut) {
      await signOut(page);
      await page.getByRole('button', { name: 'New blank PDF', exact: true }).click();
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    } else await openCloud(page);
    await page.evaluate(() => {
      window.account = { username: 'Bob', uuid: 'bob' };
      window.puter.authToken = 'token:bob';
    });
    const save = page.getByRole('button', { name: /^(?:Save(?: to Puter)?|Sign in to save)$/ });
    await save.click();
    if (!initiallySignedOut) {
      await expect(save).toBeEnabled();
      expect(await page.evaluate(() => window.writes)).toEqual([]);
      await save.click();
    }
    await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
    const state = await page.evaluate(() => ({
      writes: window.writes,
      signIns: window.signInCalls,
    }));
    expect(state.signIns).toBe(0);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].account).toBe('Bob');
    expect(state.writes[0].options.overwrite).toBe(false);
  });

test('another token change during verification adopts the latest account without another callback', async ({
  page,
}) => {
  await mockSDK(page);
  await page.goto('/#library');
  await expect(page.locator('.account-label')).toHaveText('Alice');
  await page.evaluate(() => {
    window.account = { username: 'Bob', uuid: 'bob' };
    window.puter.authToken = 'token:bob';
    window.holdProfile = true;
    window.puter.onAuth(window.account);
  });
  await expect.poll(() => page.evaluate(() => typeof window.releaseProfile)).toBe('function');
  await page.evaluate(() => {
    window.account = { username: 'Carol', uuid: 'carol' };
    window.puter.authToken = 'token:carol';
    window.releaseProfile();
  });
  await expect(page.locator('.account-label')).toHaveText('Carol');
  await expect(page.getByRole('button', { name: 'Carol file.pdf', exact: true })).toBeVisible();
});

test('duplicate callbacks share a pending profile verification', async ({ page }) => {
  await mockSDK(page);
  await page.goto('/#library');
  await expect(page.locator('.account-label')).toHaveText('Alice');
  const reads = await page.evaluate(() => window.profileReads);
  await page.evaluate(() => {
    window.account = { username: 'Bob', uuid: 'bob' };
    window.puter.authToken = 'token:bob';
    window.holdProfile = true;
    window.puter.onAuth(window.account);
  });
  await expect.poll(() => page.evaluate(() => typeof window.releaseProfile)).toBe('function');
  await page.evaluate(() => {
    window.puter.onAuth(window.account);
    window.puter.onAuth(window.account);
  });
  expect(await page.evaluate(() => window.profileReads)).toBe(reads + 1);
  await page.evaluate(() => window.releaseProfile());
  await expect(page.locator('.account-label')).toHaveText('Bob');
  expect(await page.evaluate(() => window.profileReads)).toBe(reads + 1);
});

for (const freshSignIn of [false, true])
  test(`sign-out retires pending SDK verification${freshSignIn ? ' before a fresh sign-in' : ''}`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await mockSDK(page);
    await page.goto('/#library');
    await expect(page.locator('.account-label')).toHaveText('Alice');
    await page.evaluate(() => {
      window.account = { username: 'Carol', uuid: 'carol' };
      window.puter.authToken = 'token:carol';
      window.holdProfile = true;
      window.puter.onAuth(window.account);
    });
    await expect.poll(() => page.evaluate(() => typeof window.releaseProfile)).toBe('function');
    await signOut(page);
    if (freshSignIn) {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Settings', exact: true })
        .getByRole('button', { name: 'Sign in with Puter', exact: true })
        .click();
      await expect(page.locator('.account-label')).toHaveText('Bob');
    }
    await page.evaluate(() => window.releaseProfile());
    await expect.poll(() => page.evaluate(() => window.profileDone)).toBe(true);
    await expect(page.locator('.account-label')).toHaveText(
      freshSignIn ? 'Bob' : 'Local workspace',
    );
    await expect(page.locator('#toast')).toBeHidden();
    expect(errors).toEqual([]);
  });

test('a stale callback during a save preserves the verified current destination', async ({
  page,
}) => {
  await mockSDK(page);
  await page.goto('/');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => {
    window.account = { username: 'Bob', uuid: 'bob' };
    window.puter.authToken = 'token:bob';
    return window.puter.onAuth(window.account);
  });
  await openCloud(page);
  await page.evaluate(() => {
    window.holdProfile = true;
    window.puter.onAuth({ username: 'Alice', uuid: 'alice' });
  });
  await expect.poll(() => page.evaluate(() => typeof window.releaseProfile)).toBe('function');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Saving…');
  expect(await page.evaluate(() => window.writes)).toEqual([]);
  await page.evaluate(() => window.releaseProfile());
  await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
  expect(await page.evaluate(() => window.writes[0].options.overwrite)).toBe(true);
  expect(await page.evaluate(() => window.writes[0].account)).toBe('Bob');
});

test('a folder save rechecks an SDK token changed during encryption', async ({ page }) => {
  await mockSDK(page, { protectedPdf: true });
  await page.goto('/');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await openCloud(page);
  await page.evaluate(async () => {
    const { blankPdf, validatePdf } = await import('/src/core/document.js');
    const prototype = Object.getPrototypeOf(await validatePdf(await blankPdf()));
    const save = prototype.save;
    prototype.save = async function (...args) {
      prototype.save = save;
      const bytes = await save.apply(this, args);
      await new Promise((resolve) => {
        window.releaseExport = () => {
          resolve();
          setTimeout(() => {
            window.exportDone = true;
          }, 0);
        };
      });
      return bytes;
    };
  });
  const bar = page.getByRole('menubar');
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
  else await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save to another Puter folder…', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseExport)).toBe('function');
  await page.evaluate(() => {
    window.account = { username: 'Bob', uuid: 'bob' };
    window.puter.authToken = 'token:bob';
    window.releaseExport();
  });
  await expect.poll(() => page.evaluate(() => window.exportDone)).toBe(true);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toContainText(
    'Signed in as Bob',
  );
  expect(await page.evaluate(() => window.savePickers)).toBe(0);
});

for (const folder of [false, true])
  test(`a token change during a pending ${folder ? 'folder picker' : 'write'} cannot attach the previous destination to a new account`, async ({
    page,
  }) => {
    await mockSDK(page);
    await page.goto('/');
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await openCloud(page);
    await page.evaluate((folder) => {
      const hold = () =>
        new Promise((resolve) => {
          window.finishCloudSave = () =>
            resolve({ path: 'PDF Editor/previous.pdf', name: 'previous.pdf' });
        });
      if (folder) window.puter.ui.showSaveFilePicker = hold;
      else {
        const write = window.puter.fs.write;
        window.puter.fs.write = (...args) => {
          window.puter.fs.write = write;
          return hold(...args);
        };
      }
    }, folder);
    if (folder) {
      const bar = page.getByRole('menubar');
      if (await bar.isVisible())
        await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
      else await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page
        .getByRole('menuitem', { name: 'Save to another Puter folder…', exact: true })
        .click();
    } else await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof window.finishCloudSave)).toBe('function');
    await page.evaluate(() => {
      window.account = { username: 'Bob', uuid: 'bob' };
      window.puter.authToken = 'token:bob';
      window.finishCloudSave();
    });
    await expect(page.getByRole('button', { name: 'Save to Puter', exact: true })).toBeEnabled();
    await expect(page).toHaveTitle('report.pdf · PDF Editor');
    await page.getByRole('button', { name: 'Save to Puter', exact: true }).click();
    await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
    const write = await page.evaluate(() => window.writes.at(-1));
    expect(write.account).toBe('Bob');
    expect(write.path).toBe('PDF Editor/report.pdf');
    expect(write.options.overwrite).toBe(false);
  });

test('an old callback for the same account cannot roll back its verified profile', async ({
  page,
}) => {
  await mockSDK(page);
  await page.goto('/#library');
  await expect(page.locator('.account-label')).toHaveText('Alice');
  await page.evaluate(() => {
    window.account = { username: 'Alice renamed', uuid: 'alice' };
    return window.puter.onAuth(window.account);
  });
  await expect(page.locator('.account-label')).toHaveText('Alice renamed');
  await page.evaluate(() => window.puter.onAuth({ username: 'Alice', uuid: 'alice' }));
  await expect(page.locator('.account-label')).toHaveText('Alice renamed');
});

test('a library retry awaiting verification does not reread files after its account ends', async ({
  page,
}) => {
  await mockSDK(page, { initialListError: true });
  await page.goto('/#library');
  await expect(page.locator('.account-label')).toHaveText('Alice');
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.account = { username: 'Bob', uuid: 'bob' };
    window.puter.authToken = 'token:bob';
    window.holdProfile = true;
    window.puter.onAuth(window.account);
  });
  await expect.poll(() => page.evaluate(() => typeof window.releaseProfile)).toBe('function');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.file-list')).toContainText('Loading your PDFs');
  await page.evaluate(() => window.releaseProfile());
  await expect(page.getByRole('button', { name: 'Bob file.pdf', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.listReads)).toBe(2);
});
