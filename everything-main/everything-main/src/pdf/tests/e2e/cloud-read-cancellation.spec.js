import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { openDevicePicker } from './editing-helpers.js';

for (const source of ['desktop', 'picker', 'row'])
  for (const newer of source === 'desktop' ? ['none', 'pdf', 'library'] : ['none', 'pdf'])
    test(`${source} cloud response respects ${newer}`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const original = await PDFDocument.create();
      original.setTitle('Cloud original');
      original.addPage([300, 300]);
      const base64 = Buffer.from(await original.save()).toString('base64');
      await page.route('https://js.puter.com/**', (route) =>
        route.fulfill({
          contentType: 'application/javascript',
          body: `
          window.cloudBuffers = 0;
          const item = { path:'older.pdf', name:'older.pdf' };
          window.puter = {
            env:'app', auth:{ getUser:async()=>({username:'test'}) },
            fs:{ readdir:async()=>[item], read:()=>new Promise(resolve=>{
              window.releaseCloud = () => {
                const blob = new Blob([Uint8Array.from(atob(${JSON.stringify(base64)}), c=>c.charCodeAt(0))]);
                const read = blob.arrayBuffer;
                blob.arrayBuffer = function() { window.cloudBuffers++; return read.call(this); };
                resolve(blob);
                setTimeout(()=>{ window.cloudSettled = true; }, 0);
              };
            }) },
            ui:{ onLaunchedWithItems:()=>{}, onItemsOpened:handler=>{window.openItems=handler;}, showOpenFilePicker:async()=>item },
          };`,
        }),
      );
      await page.goto(source === 'desktop' ? '/' : '/#library');
      await expect.poll(() => page.evaluate(() => typeof window.openItems)).toBe('function');
      if (source === 'desktop') {
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
        await page.evaluate(() => window.openItems([{ path: 'older.pdf', name: 'older.pdf' }]));
      } else if (source === 'picker')
        await page.getByRole('button', { name: 'Open from Puter', exact: true }).click();
      else await page.getByRole('button', { name: 'older.pdf', exact: true }).click();
      await expect.poll(() => page.evaluate(() => typeof window.releaseCloud)).toBe('function');
      if (newer === 'pdf') {
        const latest = await PDFDocument.create();
        latest.setTitle('Latest document');
        latest.addPage([450, 300]);
        latest.addPage([450, 300]);
        const chooser = page.waitForEvent('filechooser');
        await openDevicePicker(page);
        await (
          await chooser
        ).setFiles({
          name: 'latest.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await latest.save()),
        });
        await expect(page).toHaveTitle('latest.pdf · PDF Editor');
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
      } else if (newer === 'library') {
        await page.getByRole('button', { name: 'Back to your PDFs', exact: true }).click();
        await expect(
          page.getByRole('button', { name: 'New blank PDF', exact: true }),
        ).toBeVisible();
      }
      await page.evaluate(() => window.releaseCloud());
      await expect.poll(() => page.evaluate(() => window.cloudSettled)).toBe(true);
      if (newer === 'none') {
        await expect(page).toHaveTitle('older.pdf · PDF Editor');
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
      }
      expect(await page.evaluate(() => window.cloudBuffers)).toBe(newer === 'none' ? 1 : 0);
      if (newer === 'library') {
        expect(await page.evaluate(() => location.hash)).toBe('#library');
        await page.getByRole('button', { name: 'New blank PDF', exact: true }).click();
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
      } else {
        await expect(page).toHaveTitle(`${newer === 'none' ? 'older' : 'latest'}.pdf · PDF Editor`);
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        const saved = await PDFDocument.load(await readFile(await (await pending).path()));
        expect(saved.getPageCount()).toBe(newer === 'none' ? 1 : 2);
        expect(saved.getTitle()).toBe(newer === 'none' ? 'Cloud original' : 'Latest document');
        expect(saved.getPage(0).getWidth()).toBe(newer === 'none' ? 300 : 450);
      }
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      expect(errors).toEqual([]);
      expect(await page.locator('#toast').textContent()).not.toMatch(
        /could not|Something went wrong/,
      );
    });
