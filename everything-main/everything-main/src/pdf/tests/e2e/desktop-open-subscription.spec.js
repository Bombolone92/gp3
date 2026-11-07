import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function pdf(pages, title) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  for (let i = 0; i < pages; i++) doc.addPage([300, 300]);
  return Buffer.from(await doc.save()).toString('base64');
}
async function setup(page, { api = 'both', launch = true, held = false } = {}) {
  const bytes = await pdf(2, 'Initial file');
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
      window.reads = []; window.exits = 0; window.fileBytes = ${JSON.stringify(bytes)};
      const item = { path:'launch.pdf', name:'launch.pdf' };
      const replay = callback => { if (${launch}) callback([item]); };
      window.puter = {
        env:'app', auth:{getUser:async()=>({username:'test'})},
        fs:{readdir:async()=>[],read:async(path)=>{
          window.reads.push(path);
          const blob = new Blob([Uint8Array.from(atob(window.fileBytes), c=>c.charCodeAt(0))]);
          if (${held} && path === 'launch.pdf') return new Promise((resolve,reject)=>{
            window.finishLaunch = fail => {
              if (fail) reject(new Error('Obsolete launch failed')); else resolve(blob);
              setTimeout(()=>{window.launchSettled=true;},0);
            };
          });
          return blob;
        }},
        ui:{
          ${api !== 'opened' ? 'onLaunchedWithItems:callback=>replay(callback),' : ''}
          ${api !== 'launched' ? 'onItemsOpened:callback=>{window.openItems=callback;replay(callback);},' : ''}
          onWindowClose:callback=>{window.closeApp=callback;},
        },
        exit:()=>{window.exits++;},
      };`,
    }),
  );
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => typeof window.closeApp)).toBe('function');
}
async function checkPdf(page, name, pages, title) {
  await expect(page).toHaveTitle(`${name} · PDF Editor`);
  await expect(page.locator('.page-caption')).toHaveText(`Page 1 of ${pages}`);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const result = await PDFDocument.load(await readFile(await (await pending).path()));
  expect(result.getPageCount()).toBe(pages);
  expect(result.getTitle()).toBe(title);
}
for (const api of ['both', 'opened', 'launched'])
  for (const launch of [true, false])
    test(`${api} desktop callbacks handle ${launch ? 'a launch file' : 'a plain launch'} once`, async ({
      page,
    }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await setup(page, { api, launch });
      if (launch) await checkPdf(page, 'launch.pdf', 2, 'Initial file');
      else await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
      const reads = launch ? ['launch.pdf'] : [];
      expect(await page.evaluate(() => window.reads)).toEqual(reads);
      if (api !== 'launched') {
        // Reopening the same path is a fresh request, not a duplicate to suppress forever.
        await page.evaluate(
          (bytes) => {
            window.fileBytes = bytes;
            window.openItems([{ path: 'launch.pdf', name: 'launch.pdf' }]);
          },
          await pdf(3, 'Updated file'),
        );
        await checkPdf(page, 'launch.pdf', 3, 'Updated file');
        reads.push('launch.pdf');
        await page.evaluate(
          (bytes) => {
            window.fileBytes = bytes;
            window.openItems([{ path: 'other.pdf', name: 'other.pdf' }]);
          },
          await pdf(4, 'Other file'),
        );
        await checkPdf(page, 'other.pdf', 4, 'Other file');
        reads.push('other.pdf');
        expect(await page.evaluate(() => window.reads)).toEqual(reads);
      }
      await page.evaluate(() => window.closeApp());
      await expect.poll(() => page.evaluate(() => window.exits)).toBe(1);
      expect(errors).toEqual([]);
    });
for (const api of ['both', 'opened'])
  for (const fail of [false, true])
    test(`${api} desktop callbacks keep a newer file after an older launch ${fail ? 'fails' : 'finishes'}`, async ({
      page,
    }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await setup(page, { api, held: true });
      await expect.poll(() => page.evaluate(() => typeof window.finishLaunch)).toBe('function');
      expect(await page.evaluate(() => window.reads)).toEqual(['launch.pdf']);
      await page.evaluate(
        (bytes) => {
          window.fileBytes = bytes;
          window.openItems([{ path: 'newer.pdf', name: 'newer.pdf' }]);
        },
        await pdf(3, 'Newer file'),
      );
      await checkPdf(page, 'newer.pdf', 3, 'Newer file');
      await page.evaluate((fail) => window.finishLaunch(fail), fail);
      await expect.poll(() => page.evaluate(() => window.launchSettled)).toBe(true);
      await checkPdf(page, 'newer.pdf', 3, 'Newer file');
      expect(await page.evaluate(() => window.reads)).toEqual(['launch.pdf', 'newer.pdf']);
      expect(errors).toEqual([]);
      expect(await page.locator('#toast').textContent()).not.toContain('Obsolete launch failed');
    });
