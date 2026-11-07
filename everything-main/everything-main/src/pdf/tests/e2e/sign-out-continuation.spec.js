import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

async function rotate(page) {
  const bar = page.getByRole('menubar');
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'Page', exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Page', exact: true }).click();
  }
  await page.getByRole('menuitem', { name: 'Rotate clockwise', exact: true }).click();
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
}

async function chooseLatest(page, dirty, pending) {
  const doc = await PDFDocument.create();
  doc.setTitle('Latest report');
  doc.addPage([401, 500]);
  doc.addPage([402, 500]);
  if (pending)
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
    buffer: Buffer.from(await doc.save()),
  });
  if (pending)
    await expect.poll(() => page.evaluate(() => typeof window.releaseLatestRead)).toBe('function');
  else {
    if (dirty)
      await page
        .getByRole('dialog', { name: 'Leave this PDF?', exact: true })
        .getByRole('button', { name: 'Leave without saving', exact: true })
        .click();
    await expect(page).toHaveTitle('latest.pdf · PDF Editor');
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await rotate(page);
  }
}

for (const dirty of [false, true])
  for (const newer of ['none', 'same edits', 'new document', 'pending document', 'library'])
    test(`sign-out after ${dirty ? 'discarding changes' : 'a clean PDF'} respects ${newer}`, async ({
      page,
    }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('https://js.puter.com/**', (route) =>
        route.fulfill({
          contentType: 'application/javascript',
          body: `window.puter={
        env:'web',auth:{isSignedIn:()=>true,getUser:async()=>({username:'test'}),
          signOut:()=>new Promise(resolve=>{window.releaseSignOut=()=>{
            resolve();setTimeout(()=>{window.signOutFinished=true;},0);
          };})},fs:{readdir:async()=>[]},ui:{}};`,
        }),
      );
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Save to Puter', exact: true })).toBeVisible();
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      if (dirty) await rotate(page);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
      if (dirty)
        await page
          .getByRole('dialog', { name: 'Leave this PDF?', exact: true })
          .getByRole('button', { name: 'Leave without saving', exact: true })
          .click();
      await expect.poll(() => page.evaluate(() => typeof window.releaseSignOut)).toBe('function');
      if (newer !== 'none') {
        await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
        await expect(settings).toHaveCount(0);
        if (newer === 'same edits') await rotate(page);
        else if (newer.endsWith('document'))
          await chooseLatest(page, dirty, newer === 'pending document');
        else {
          await page.getByRole('button', { name: 'Back to your PDFs', exact: true }).click();
          if (dirty)
            await page
              .getByRole('dialog', { name: 'Leave this PDF?', exact: true })
              .getByRole('button', { name: 'Leave without saving', exact: true })
              .click();
          await expect(
            page.getByRole('button', { name: 'New blank PDF', exact: true }),
          ).toBeVisible();
        }
      }
      await page.evaluate(() => window.releaseSignOut());
      await expect.poll(() => page.evaluate(() => window.signOutFinished)).toBe(true);
      if (newer === 'none' || newer === 'library') {
        await expect(
          page.getByRole('button', { name: 'New blank PDF', exact: true }),
        ).toBeVisible();
        await expect(page.locator('.account-label')).toHaveText('Local workspace');
        await expect(page.getByRole('dialog')).toHaveCount(0);
      } else {
        await expect(
          page.getByRole('button', { name: 'Sign in to save', exact: true }),
        ).toBeVisible();
        if (newer === 'pending document') {
          await page.evaluate(() => window.releaseLatestRead());
          if (dirty)
            await page
              .getByRole('dialog', { name: 'Save before leaving?', exact: true })
              .getByRole('button', { name: 'Leave without saving', exact: true })
              .click();
        }
        const original = newer === 'same edits';
        await expect(page).toHaveTitle(
          `${newer === 'pending document' ? '' : '* '}${original ? 'Untitled' : 'latest'}.pdf · PDF Editor`,
        );
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        const downloading = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        const doc = await PDFDocument.load(await readFile(await (await downloading).path()));
        expect(doc.getPageCount()).toBe(original ? 1 : 2);
        expect(doc.getPage(0).getRotation().angle).toBe(
          newer === 'pending document' ? 0 : original && dirty ? 180 : 90,
        );
        if (!original) {
          expect(doc.getTitle()).toBe('Latest report');
          expect(doc.getPage(0).getWidth()).toBe(401);
        }
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toContainText(
          'Work locally',
        );
        await expect(
          page.getByRole('button', { name: 'Sign in with Puter', exact: true }),
        ).toBeVisible();
      }
      expect(errors).toEqual([]);
    });
