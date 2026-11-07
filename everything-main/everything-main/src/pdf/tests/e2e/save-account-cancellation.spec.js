import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const stage of ['write', 'export'])
  for (const outcome of ['success', 'failure'])
    test(`an ended account's pending save ${stage} releases saving before its late ${outcome}`, async ({
      page,
    }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const encoded = (
        await readFile(new URL('../fixtures/security/owner-only.pdf', import.meta.url))
      ).toString('base64');
      await page.route('https://js.puter.com/**', (route) =>
        route.fulfill({
          contentType: 'application/javascript',
          body: `window.account={username:'Alice'};window.writes=[];
        const item={path:'PDF Editor/private.pdf',name:'private.pdf'};
        const hold=(key)=>new Promise((resolve,reject)=>{window[key]=()=>{
          if(key==='finishOldSave'&&${JSON.stringify(outcome)}==='failure')reject(new Error('Old save failed'));
          else resolve(item);
          setTimeout(()=>{window[key+'Done']=true;},0);
        };});
        window.puter={env:'web',auth:{isSignedIn:()=>!!window.account,getUser:async()=>window.account,
          signIn:async()=>{window.account={username:'Bob'};},signOut:()=>new Promise(resolve=>{window.finishSignOut=()=>{window.account=null;resolve();};})},
          fs:{readdir:async()=>[],read:async()=>new Blob([Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0))]),
          write:async(path,blob,options)=>{window.writes.push({path,options,account:window.account?.username});return hold(window.account?.username==='Alice'?'finishOldSave':'finishNewSave');}},
          ui:{showOpenFilePicker:async()=>item}};`,
        }),
      );
      await page.goto('/');
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      if (stage === 'export') {
        const bar = page.getByRole('menubar');
        if (await bar.isVisible())
          await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
        else await page.getByRole('button', { name: 'Menu', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Open from Puter…', exact: true }).click();
        await expect(page).toHaveTitle('private.pdf · PDF Editor');
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        await page.evaluate(async (outcome) => {
          const { blankPdf, validatePdf } = await import('/src/core/document.js');
          const prototype = Object.getPrototypeOf(await validatePdf(await blankPdf()));
          const save = prototype.save;
          prototype.save = async function (...args) {
            prototype.save = save;
            const bytes = await save.apply(this, args);
            await new Promise((resolve, reject) => {
              window.finishOldSave = () => {
                if (outcome === 'failure') reject(new Error('Old save failed'));
                else resolve();
                setTimeout(() => {
                  window.finishOldSaveDone = true;
                }, 0);
              };
            });
            return bytes;
          };
        }, outcome);
      }
      const save = page.getByRole('button', { name: /^Save(?: to Puter)?$/ });
      await save.click();
      await expect.poll(() => page.evaluate(() => typeof window.finishOldSave)).toBe('function');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Leave this PDF?', exact: true })
        .getByRole('button', { name: 'Leave without saving', exact: true })
        .click();
      await expect.poll(() => page.evaluate(() => typeof window.finishSignOut)).toBe('function');
      await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await expect(settings).toHaveCount(0);
      await page.evaluate(() => window.finishSignOut());
      await expect(
        page.getByRole('button', { name: 'Sign in to save', exact: true }),
      ).toBeEnabled();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await settings.getByRole('button', { name: 'Sign in with Puter', exact: true }).click();
      await expect(settings).toHaveCount(0);
      await save.click();
      await expect.poll(() => page.evaluate(() => typeof window.finishNewSave)).toBe('function');
      await expect(page.locator('.save-status')).toHaveText('Saving…');
      await page.evaluate(() => window.finishOldSave());
      await expect.poll(() => page.evaluate(() => window.finishOldSaveDone)).toBe(true);
      await expect(save).toBeDisabled();
      await expect(page.locator('.save-status')).toHaveText('Saving…');
      expect(await page.evaluate(() => window.writes.map((write) => write.account))).toEqual(
        stage === 'write' ? ['Alice', 'Bob'] : ['Bob'],
      );
      expect(await page.locator('#toast').textContent()).not.toContain('Old save failed');
      await page.evaluate(() => window.finishNewSave());
      await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
      expect(errors).toEqual([]);
    });
