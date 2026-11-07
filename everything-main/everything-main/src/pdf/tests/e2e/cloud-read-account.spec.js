import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function fileMenu(page, action) {
  const bar = page.getByRole('menubar');
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
  else await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}

for (const stage of ['read', 'buffer'])
  for (const outcome of ['success', 'failure'])
    for (const retry of [false, true])
      test(`a cloud ${stage} ${outcome} cannot open after sign-out${retry ? ' and another sign-in' : ''}`, async ({
        page,
      }) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const doc = await PDFDocument.create();
        doc.setTitle('Alice private report');
        doc.addPage([310, 400]);
        doc.addPage([320, 400]);
        const encoded = Buffer.from(await doc.save()).toString('base64');
        await page.route('https://js.puter.com/**', (route) =>
          route.fulfill({
            contentType: 'application/javascript',
            body: `window.account={username:'Alice'};window.cloudBuffers=0;
            const hold=()=>new Promise((resolve,reject)=>{window.releaseCloud=()=>{
              ${outcome === 'success' ? 'resolve();' : "reject(new Error('Old cloud read failed'));"}
              setTimeout(()=>{window.cloudFinished=true;},0);
            };});
            window.puter={env:'web',auth:{isSignedIn:()=>!!window.account,getUser:async()=>window.account,
              signIn:async()=>{window.account={username:'Bob'};},
              signOut:()=>new Promise(resolve=>{window.releaseSignOut=()=>{
                window.account=null;resolve();setTimeout(()=>{window.signedOut=true;},0);
              };})
            },fs:{readdir:async()=>[],read:async()=>{
              if(${JSON.stringify(stage)}==='read')await hold();
              const blob=new Blob([Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0))]);
              const buffer=blob.arrayBuffer;
              blob.arrayBuffer=async function(){window.cloudBuffers++;if(${JSON.stringify(stage)}==='buffer')await hold();return buffer.call(this);};
              return blob;
            }},ui:{showOpenFilePicker:async()=>({path:'PDF Editor/private.pdf',name:'private.pdf'})}};`,
          }),
        );
        await page.goto('/');
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        await expect(
          page.getByRole('button', { name: 'Save to Puter', exact: true }),
        ).toBeVisible();
        await fileMenu(page, 'Open from Puter…');
        await expect.poll(() => page.evaluate(() => typeof window.releaseCloud)).toBe('function');
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
        await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
        await expect.poll(() => page.evaluate(() => typeof window.releaseSignOut)).toBe('function');
        await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
        await expect(settings).toHaveCount(0);
        await page.evaluate(() => window.releaseSignOut());
        await expect.poll(() => page.evaluate(() => window.signedOut)).toBe(true);
        await expect(
          page.getByRole('button', { name: 'Sign in to save', exact: true }),
        ).toBeVisible();
        if (retry) {
          await page.getByRole('button', { name: 'Settings', exact: true }).click();
          await settings.getByRole('button', { name: 'Sign in with Puter', exact: true }).click();
          await expect(settings).toHaveCount(0);
        }
        await page.evaluate(() => window.releaseCloud());
        await expect.poll(() => page.evaluate(() => window.cloudFinished)).toBe(true);
        await expect(page).toHaveTitle('Untitled.pdf · PDF Editor');
        expect(await page.evaluate(() => window.cloudBuffers)).toBe(stage === 'buffer' ? 1 : 0);
        expect(await page.locator('#toast').textContent()).not.toContain('Old cloud read failed');
        await expect(page.locator('#toast')).toBeHidden();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await expect(settings).toContainText(retry ? 'Signed in as Bob' : 'Work locally');
        expect(errors).toEqual([]);
      });

test('sign-out dismisses an account-bound password prompt and preserves a newer local draft', async ({
  page,
}) => {
  const { readFile } = await import('node:fs/promises');
  const encoded = (
    await readFile(new URL('../fixtures/security/aes-256-r5.pdf', import.meta.url))
  ).toString('base64');
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.account={username:'Alice'};window.puter={env:'web',auth:{
      isSignedIn:()=>!!window.account,getUser:async()=>window.account,
      signOut:()=>new Promise(resolve=>{window.releaseSignOut=()=>{
        window.account=null;resolve();setTimeout(()=>{window.signedOut=true;},0);
      };})
    },fs:{readdir:async()=>[],read:()=>new Promise(resolve=>{window.releaseCloud=()=>resolve(new Blob([
      Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0))
    ]));})},ui:{showOpenFilePicker:async()=>({path:'locked.pdf',name:'locked.pdf'})}};`,
    }),
  );
  await page.goto('/');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'Save to Puter', exact: true })).toBeVisible();
  await fileMenu(page, 'Open from Puter…');
  await expect.poll(() => page.evaluate(() => typeof window.releaseCloud)).toBe('function');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseSignOut)).toBe('function');
  await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Place at page center', exact: true }).click();
  const draft = page.getByRole('textbox', { name: 'Text to add', exact: true });
  await draft.fill('Keep my local draft');
  await page.evaluate(() => window.releaseCloud());
  const password = page.getByRole('dialog', { name: 'Password required', exact: true });
  await expect(password).toBeVisible();
  await page.evaluate(() => window.releaseSignOut());
  await expect.poll(() => page.evaluate(() => window.signedOut)).toBe(true);
  await expect(password).toHaveCount(0);
  await expect(page).toHaveTitle('* Untitled.pdf · PDF Editor');
  await expect(draft).toHaveValue('Keep my local draft');
  await expect(page.getByRole('button', { name: 'Sign in to save', exact: true })).toBeVisible();
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
});
