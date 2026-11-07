import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function setup(page, launch = false) {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  doc.addPage([300, 300]);
  const bytes = Buffer.from(await doc.save()).toString('base64');
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
      window.exits=0; window.signIns=0; window.reads=[]; window.writes=[];
      window.requestClose=()=>{ if(window.closeApp) window.closeApp(); else window.exits++; };
      window.puter={env:'app',auth:{
        getUser:()=>new Promise((resolve,reject)=>{
          window.finishProfile=fail=>{
            if(fail) reject(new Error('Profile unavailable')); else resolve({username:'test-user'});
            setTimeout(()=>{window.profileSettled=true;},0);
          };
        }),
        signIn:async()=>{window.signIns++;throw new Error('Desktop sign-in is unavailable');},
      },fs:{
        readdir:async()=>[],
        read:async(path)=>{window.reads.push(path);return new Blob([Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0))]);},
        write:async(path,blob)=>{window.writes.push({path,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))});return {path,name:path.split('/').pop()};},
      },ui:{
        onItemsOpened:handler=>{window.openItems=handler;if(${launch}) handler([{path:'launch.pdf',name:'launch.pdf'}]);},
        onWindowClose:handler=>{window.closeApp=handler;},
      },exit:()=>{window.exits++;}};`,
    }),
  );
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => typeof window.finishProfile)).toBe('function');
  await expect(page.locator('.page-caption')).toHaveText(`Page 1 of ${launch ? 2 : 1}`);
}
async function finishProfile(page, outcome) {
  await page.evaluate((fail) => window.finishProfile(fail), outcome === 'failure');
  await expect.poll(() => page.evaluate(() => window.profileSettled)).toBe(true);
}
async function rotate(page) {
  const bar = page.getByRole('menubar', { name: 'PDF menus' });
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'Page', exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Page', exact: true }).click();
  }
  await page.getByRole('menuitem', { name: 'Rotate clockwise', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Unsaved changes');
}
async function downloaded(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  return PDFDocument.load(await readFile(await (await pending).path()));
}
for (const timing of ['before', 'during'])
  for (const outcome of ['success', 'failure'])
    for (const choice of ['cancel', 'leave'])
      test(`desktop close ${choice} with profile ${outcome} ${timing} confirmation`, async ({
        page,
      }) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await setup(page);
        await rotate(page);
        if (timing === 'before') await finishProfile(page, outcome);
        await page.evaluate(() => {
          window.requestClose();
        });
        const confirmation = page.getByRole('dialog', { name: 'Leave this PDF?', exact: true });
        await expect(confirmation).toBeVisible();
        expect(await page.evaluate(() => window.exits)).toBe(0);
        if (timing === 'during') {
          await finishProfile(page, outcome);
          await expect(confirmation).toBeVisible();
        }
        await confirmation
          .getByRole('button', {
            name: choice === 'cancel' ? 'Cancel' : 'Leave without saving',
            exact: true,
          })
          .click();
        if (choice === 'leave') await expect.poll(() => page.evaluate(() => window.exits)).toBe(1);
        else {
          await expect(
            page.getByRole('dialog', { name: 'Leave this PDF?', includeHidden: true }),
          ).toHaveCount(0);
          expect(await page.evaluate(() => window.exits)).toBe(0);
          await expect(page.locator('.save-status')).toHaveText('Unsaved changes');
          expect((await downloaded(page)).getPage(0).getRotation().angle).toBe(90);
          await page.getByRole('button', { name: 'Undo', exact: true }).click();
          await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
          await page.getByRole('button', { name: 'Settings', exact: true }).click();
          await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toContainText(
            `Signed in as ${outcome === 'success' ? 'test-user' : 'Puter user'}`,
          );
        }
        expect(await page.evaluate(() => window.signIns)).toBe(0);
        expect(errors).toEqual([]);
      });
for (const activity of ['launch', 'open', 'save'])
  for (const outcome of ['success', 'failure'])
    test(`desktop ${activity} works before profile ${outcome}`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await setup(page, activity === 'launch');
      if (activity === 'open') {
        await expect.poll(() => page.evaluate(() => typeof window.openItems)).toBe('function');
        await page.evaluate(() => window.openItems([{ path: 'opened.pdf', name: 'opened.pdf' }]));
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
      }
      const name =
        activity === 'launch' ? 'launch.pdf' : activity === 'open' ? 'opened.pdf' : 'Untitled.pdf';
      if (activity === 'save') {
        await rotate(page);
        await page.getByRole('button', { name: 'Save to Puter', exact: true }).click();
        await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
        const writes = await page.evaluate(() => window.writes);
        expect(writes).toHaveLength(1);
        expect(writes[0].path).toBe('PDF Editor/Untitled.pdf');
        expect(
          (await PDFDocument.load(new Uint8Array(writes[0].bytes))).getPage(0).getRotation().angle,
        ).toBe(90);
      } else expect(await page.evaluate(() => window.reads)).toEqual([name]);
      expect(await page.evaluate(() => window.profileSettled)).toBeUndefined();
      await finishProfile(page, outcome);
      await expect(page).toHaveTitle(`${name} · PDF Editor`);
      const saved = await downloaded(page);
      expect(saved.getPageCount()).toBe(activity === 'save' ? 1 : 2);
      expect(saved.getPage(0).getRotation().angle).toBe(activity === 'save' ? 90 : 0);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toContainText(
        `Signed in as ${outcome === 'success' ? 'test-user' : 'Puter user'}`,
      );
      expect(await page.evaluate(() => window.signIns)).toBe(0);
      expect(errors).toEqual([]);
    });
