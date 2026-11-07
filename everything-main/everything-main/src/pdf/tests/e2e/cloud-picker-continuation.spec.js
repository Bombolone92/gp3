import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function cloudMenu(page) {
  const bar = page.getByRole('menubar');
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
  else await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open from Puter…', exact: true }).click();
}

for (const view of ['editor', 'library'])
  for (const phase of ['sign-in', 'picker'])
    for (const outcome of ['success', 'failure'])
      for (const newer of ['none', 'document', 'pending document', 'library'])
        test(`${view} cloud ${phase} ${outcome} respects ${newer}`, async ({ page }) => {
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          const cloud = await PDFDocument.create();
          cloud.setTitle('Cloud original');
          cloud.addPage([310, 400]);
          cloud.addPage([320, 400]);
          const encoded = Buffer.from(await cloud.save()).toString('base64');
          await page.route('https://js.puter.com/**', (route) =>
            route.fulfill({
              contentType: 'application/javascript',
              body: `window.cloudReads=0;window.cloudPickers=0;window.puter={env:'web',auth:{
              isSignedIn:()=>${phase === 'picker'},getUser:async()=>({username:'Alice'}),
              signIn:()=>new Promise((resolve,reject)=>{window.releaseCloudAction=()=>{
                ${outcome === 'success' ? 'resolve();' : "reject(new Error('Old cloud request failed'));"}
                setTimeout(()=>{window.cloudActionFinished=true;},0);
              };})
            },fs:{readdir:async()=>[],read:async()=>{window.cloudReads++;return new Blob([
              Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0))
            ]);}},ui:{showOpenFilePicker:()=>{
              window.cloudPickers++;
              const item={path:'older.pdf',name:'older.pdf'};
              if(${JSON.stringify(phase)}==='sign-in')return Promise.resolve(item);
              return new Promise((resolve,reject)=>{window.releaseCloudAction=()=>{
                ${outcome === 'success' ? 'resolve(item);' : "reject(new Error('Old cloud request failed'));"}
                setTimeout(()=>{window.cloudActionFinished=true;},0);
              };});
            }}};`,
            }),
          );
          await page.goto(view === 'library' ? '/#library' : '/');
          if (view === 'editor') {
            await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
            if (phase === 'picker')
              await expect(
                page.getByRole('button', { name: 'Save to Puter', exact: true }),
              ).toBeVisible();
            await cloudMenu(page);
          } else await page.getByRole('button', { name: 'Open from Puter', exact: true }).click();
          await expect
            .poll(() => page.evaluate(() => typeof window.releaseCloudAction))
            .toBe('function');
          if (newer !== 'none') {
            const latest = await PDFDocument.create();
            latest.setTitle('Latest document');
            latest.addPage([450, 500]);
            if (newer === 'pending document')
              await page.evaluate(() => {
                const read = File.prototype.arrayBuffer;
                File.prototype.arrayBuffer = async function () {
                  File.prototype.arrayBuffer = read;
                  const bytes = await read.call(this);
                  await new Promise((resolve) => {
                    window.releaseLatestRead = resolve;
                  });
                  return bytes;
                };
              });
            const choosing = page.waitForEvent('filechooser');
            await page.keyboard.press('ControlOrMeta+o');
            await (
              await choosing
            ).setFiles({
              name: 'latest.pdf',
              mimeType: 'application/pdf',
              buffer: Buffer.from(await latest.save()),
            });
            if (newer === 'pending document')
              await expect
                .poll(() => page.evaluate(() => typeof window.releaseLatestRead))
                .toBe('function');
            else {
              await expect(page).toHaveTitle('latest.pdf · PDF Editor');
              await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
              if (newer === 'library') {
                await page.getByRole('button', { name: 'Back to your PDFs', exact: true }).click();
                await expect(
                  page.getByRole('button', { name: 'New blank PDF', exact: true }),
                ).toBeVisible();
              }
            }
          }
          await page.evaluate(() => window.releaseCloudAction());
          await expect.poll(() => page.evaluate(() => window.cloudActionFinished)).toBe(true);
          if (newer === 'pending document') await page.evaluate(() => window.releaseLatestRead());
          if (newer === 'none' && outcome === 'success') {
            await expect(page).toHaveTitle('older.pdf · PDF Editor');
            await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
            expect(await page.evaluate(() => [window.cloudReads, window.cloudPickers])).toEqual([
              1, 1,
            ]);
            const downloading = page.waitForEvent('download');
            await page.getByRole('button', { name: 'Download', exact: true }).click();
            const saved = await PDFDocument.load(await readFile(await (await downloading).path()));
            expect(saved.getTitle()).toBe('Cloud original');
            expect(saved.getPageCount()).toBe(2);
          } else if (newer === 'none')
            await expect(page.locator('#toast')).toHaveText('Old cloud request failed');
          else {
            await expect(page).toHaveTitle(
              newer === 'library' ? 'PDF Editor' : 'latest.pdf · PDF Editor',
            );
            expect(await page.evaluate(() => window.cloudReads)).toBe(0);
            expect(await page.evaluate(() => window.cloudPickers)).toBe(phase === 'picker' ? 1 : 0);
            await expect(page.locator('#toast')).toBeHidden();
          }
          expect(errors).toEqual([]);
        });

for (const newer of ['picker', 'sign-out'])
  for (const outcome of ['success', 'failure'])
    test(`an earlier picker ${outcome} respects a newer ${newer}`, async ({ page }) => {
      const doc = await PDFDocument.create();
      doc.addPage([410, 500]);
      const encoded = Buffer.from(await doc.save()).toString('base64');
      await page.route('https://js.puter.com/**', (route) =>
        route.fulfill({
          contentType: 'application/javascript',
          body: `window.pickers=[];window.cloudReads=[];window.puter={env:'web',auth:{
          isSignedIn:()=>true,getUser:async()=>({username:'Alice'}),signOut:async()=>{}
        },fs:{readdir:async()=>[],read:async path=>{
          window.cloudReads.push(path);return new Blob([Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0))]);
        }},ui:{showOpenFilePicker:()=>new Promise((resolve,reject)=>{window.pickers.push({resolve,reject});})}};`,
        }),
      );
      await page.goto('/#library');
      await expect(page.locator('.account-label')).toHaveText('Alice');
      await page.getByRole('button', { name: 'Open from Puter', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.pickers.length)).toBe(1);
      if (newer === 'picker') {
        await page.getByRole('button', { name: 'Open from Puter', exact: true }).click();
        await expect.poll(() => page.evaluate(() => window.pickers.length)).toBe(2);
        await page.evaluate(() =>
          window.pickers[1].resolve({ path: 'latest.pdf', name: 'latest.pdf' }),
        );
        await expect(page).toHaveTitle('latest.pdf · PDF Editor');
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      } else {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await page
          .getByRole('dialog', { name: 'Settings', exact: true })
          .getByRole('button', { name: 'Sign out', exact: true })
          .click();
        await expect(page.locator('.account-label')).toHaveText('Local workspace');
      }
      await page.evaluate((outcome) => {
        if (outcome === 'failure') window.pickers[0].reject(new Error('Old picker failed'));
        else window.pickers[0].resolve({ path: 'older.pdf', name: 'older.pdf' });
        setTimeout(() => {
          window.oldPickerFinished = true;
        }, 0);
      }, outcome);
      await expect.poll(() => page.evaluate(() => window.oldPickerFinished)).toBe(true);
      await expect(page).toHaveTitle(newer === 'picker' ? 'latest.pdf · PDF Editor' : 'PDF Editor');
      expect(await page.evaluate(() => window.cloudReads)).toEqual(
        newer === 'picker' ? ['latest.pdf'] : [],
      );
      await expect(page.locator('#toast')).toBeHidden();
    });
