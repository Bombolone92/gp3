import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function fileMenu(page, label) {
  const bar = page.getByRole('menubar');
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
  else await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}
async function switchAccount(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Leave this PDF?', exact: true });
  if (await confirm.count())
    await confirm.getByRole('button', { name: 'Leave without saving', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseSignOut)).toBe('function');
  await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await page.evaluate(() => window.releaseSignOut());
  await expect.poll(() => page.evaluate(() => window.signedOut)).toBe(true);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settings.getByRole('button', { name: 'Sign in with Puter', exact: true }).click();
  await expect(settings).toHaveCount(0);
}

for (const source of ['opened PDF', 'saved PDF', 'folder save', 'pending write', 'pending folder'])
  for (const changed of [false, true])
    test(`${source} keeps its destination within ${changed ? 'its original account' : 'the same account'}`, async ({
      page,
    }) => {
      const doc = await PDFDocument.create();
      doc.setTitle('Alice report');
      doc.addPage([410, 500]);
      const encoded = Buffer.from(await doc.save()).toString('base64');
      await page.route('https://js.puter.com/**', (route) =>
        route.fulfill({
          contentType: 'application/javascript',
          body: `window.account={username:'Alice'};window.writes=[];
          const item={path:'PDF Editor/report.pdf',name:'report.pdf'};
          const hold=()=>new Promise(resolve=>{window.releaseOldSave=()=>{resolve(item);setTimeout(()=>{window.oldSaveFinished=true;},0);};});
          window.puter={env:'web',auth:{isSignedIn:()=>!!window.account,getUser:async()=>window.account,
            signIn:async()=>{window.account={username:'Bob'};},signOut:()=>new Promise(resolve=>{window.releaseSignOut=()=>{
              window.account=null;resolve();setTimeout(()=>{window.signedOut=true;},0);
            };})},fs:{readdir:async()=>[],read:async()=>new Blob([Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0))]),
              write:async(path,blob,options)=>{
                window.writes.push({path,options,account:window.account?.username});
                if(${JSON.stringify(source)}==='pending write'&&window.writes.length===1)return hold();
                return window.account?.username==='Bob'&&!options.overwrite?{path:'PDF Editor/report (1).pdf',name:'report (1).pdf'}:item;
              }
            },ui:{showOpenFilePicker:async()=>item,showSaveFilePicker:async()=>${JSON.stringify(source)}==='pending folder'?hold():item}};`,
        }),
      );
      await page.goto('/');
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      await expect(page.getByRole('button', { name: 'Save to Puter', exact: true })).toBeVisible();
      if (source === 'opened PDF') {
        await fileMenu(page, 'Open from Puter…');
        await expect(page).toHaveTitle('report.pdf · PDF Editor');
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      } else if (source.includes('folder')) await fileMenu(page, 'Save to another Puter folder…');
      else await page.getByRole('button', { name: 'Save to Puter', exact: true }).click();
      if (source.startsWith('pending'))
        await expect.poll(() => page.evaluate(() => typeof window.releaseOldSave)).toBe('function');
      else await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
      if (changed) await switchAccount(page);
      if (source.startsWith('pending')) {
        await page.evaluate(() => window.releaseOldSave());
        await expect.poll(() => page.evaluate(() => window.oldSaveFinished)).toBe(true);
      }
      const priorStatus = await page.locator('.save-status').textContent();
      const expectedLabel = changed ? 'Save to Puter' : 'Save';
      const saveControl = page.getByRole('button', { name: /^Save(?: to Puter)?$/ });
      const priorLabel = await saveControl.getAttribute('aria-label');
      await saveControl.click();
      await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
      const last = await page.evaluate(() => window.writes.at(-1));
      expect(last.account).toBe(changed ? 'Bob' : 'Alice');
      expect(last.options.overwrite).toBe(!changed);
      expect(last.options.dedupeName).toBe(changed);
      expect(priorLabel).toBe(expectedLabel);
      if (changed) expect(priorStatus).not.toBe('Saved to Puter');
      else expect(priorStatus).toBe('Saved to Puter');
      if (changed) {
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
        const next = await page.evaluate(() => window.writes.at(-1));
        expect(next.path).toBe('PDF Editor/report (1).pdf');
        expect(next.options.overwrite).toBe(true);
      }
    });

test('an encrypted save prepared for an ended account cannot start its cloud write', async ({
  page,
}) => {
  const { readFile } = await import('node:fs/promises');
  const encoded = (
    await readFile(new URL('../fixtures/security/owner-only.pdf', import.meta.url))
  ).toString('base64');
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
    window.account={username:'Alice'};window.writes=[];const item={path:'PDF Editor/report.pdf',name:'report.pdf'};
    window.puter={env:'web',auth:{isSignedIn:()=>!!window.account,getUser:async()=>window.account,
      signIn:async()=>{window.account={username:'Bob'};},signOut:()=>new Promise(resolve=>{window.releaseSignOut=()=>{
        window.account=null;resolve();setTimeout(()=>{window.signedOut=true;},0);
      };})},fs:{readdir:async()=>[],read:async()=>new Blob([Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0))]),
      write:async(path,blob,options)=>{window.writes.push({path,options,account:window.account?.username});return item;}
    },ui:{showOpenFilePicker:async()=>item}};`,
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Save to Puter', exact: true })).toBeVisible();
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await fileMenu(page, 'Open from Puter…');
  await expect(page).toHaveTitle('report.pdf · PDF Editor');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(async () => {
    const { blankPdf, validatePdf } = await import('/src/core/document.js');
    const prototype = Object.getPrototypeOf(await validatePdf(await blankPdf()));
    const save = prototype.save;
    prototype.save = async function (...args) {
      prototype.save = save;
      const bytes = await save.apply(this, args);
      await new Promise((resolve) => {
        window.releaseExport = resolve;
      });
      return bytes;
    };
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseExport)).toBe('function');
  await switchAccount(page);
  await page.evaluate(() => window.releaseExport());
  await expect(page.getByRole('button', { name: /^Save(?: to Puter)?$/ })).toBeEnabled();
  expect(await page.evaluate(() => window.writes)).toEqual([]);
  await page.getByRole('button', { name: 'Save to Puter', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
  const write = await page.evaluate(() => window.writes[0]);
  expect(write.account).toBe('Bob');
  expect(write.options.overwrite).toBe(false);
  expect(write.options.dedupeName).toBe(true);
});
