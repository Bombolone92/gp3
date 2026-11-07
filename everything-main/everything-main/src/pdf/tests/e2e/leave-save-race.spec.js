import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function rotate(page) {
  const bar = page.getByRole('menubar', { name: 'PDF menus' });
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'Page', exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Page', exact: true }).click();
  }
  await page.getByRole('menuitem', { name: 'Rotate clockwise', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
}
async function downloadPdf(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  return PDFDocument.load(await readFile(await (await pending).path()));
}
for (const phase of ['sign-in', 'save'])
  for (const entry of ['back', 'hash'])
    for (const newer of ['none', 'pdf', 'library', 'pending pdf'])
      test(`${entry} leave waiting for ${phase} respects ${newer}`, async ({ page }) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript((holdRead) => {
          if (!holdRead) return;
          const read = File.prototype.arrayBuffer;
          File.prototype.arrayBuffer = async function () {
            const bytes = await read.call(this);
            if (this.name === 'latest.pdf')
              await new Promise((resolve) => {
                window.releaseLatest = resolve;
              });
            return bytes;
          };
        }, newer === 'pending pdf');
        await page.route('https://js.puter.com/**', (route) =>
          route.fulfill({
            contentType: 'application/javascript',
            body: `
            window.writes = [];
            const hold = () => new Promise(resolve => {
              window.releaseLeave = () => {
                resolve();
                setTimeout(() => { window.leaveFinished = true; }, 0);
              };
            });
            window.puter = {
              env: 'web',
              auth: {
                isSignedIn: () => false,
                getUser: async () => ({ username: 'test' }),
                signIn: async () => { if (${JSON.stringify(phase)} === 'sign-in') await hold(); },
              },
              fs: {
                readdir: async () => [],
                write: async (path, blob) => {
                  window.writes.push({ path, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) });
                  if (${JSON.stringify(phase)} === 'save') await hold();
                  return { path, name: path.split('/').pop() };
                },
              },
              ui: {},
            };`,
          }),
        );
        await page.goto('/');
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
        await rotate(page);
        if (entry === 'back')
          await page.getByRole('button', { name: 'Back to your PDFs', exact: true }).click();
        else
          await page.evaluate(() => {
            location.hash = '#library';
          });
        await page.getByRole('button', { name: 'Sign in and save', exact: true }).click();
        await expect.poll(() => page.evaluate(() => typeof window.releaseLeave)).toBe('function');
        if (newer.includes('pdf')) {
          const doc = await PDFDocument.create();
          doc.addPage([300, 300]);
          doc.addPage([300, 300]);
          const chooser = page.waitForEvent('filechooser');
          await page.keyboard.press('ControlOrMeta+o');
          await (
            await chooser
          ).setFiles({
            name: 'latest.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from(await doc.save()),
          });
          if (newer === 'pending pdf')
            await expect
              .poll(() => page.evaluate(() => typeof window.releaseLatest))
              .toBe('function');
          else {
            await page.getByRole('button', { name: 'Leave without saving', exact: true }).click();
            await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
          }
        } else if (newer === 'library') {
          await page.getByRole('button', { name: 'Back to your PDFs', exact: true }).click();
          await page.getByRole('button', { name: 'Leave without saving', exact: true }).click();
          await expect(
            page.getByRole('button', { name: 'New blank PDF', exact: true }),
          ).toBeVisible();
        }
        await page.evaluate(() => window.releaseLeave());
        await expect.poll(() => page.evaluate(() => window.leaveFinished)).toBe(true);
        if (newer === 'pending pdf') {
          // A newer open already owns navigation, even before its bytes are available.
          await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
          await page.evaluate(() => window.releaseLatest());
          if (phase === 'sign-in')
            await page.getByRole('button', { name: 'Leave without saving', exact: true }).click();
        }
        if (newer.includes('pdf')) {
          await expect(page).toHaveTitle('latest.pdf · PDF Editor');
          await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
          await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
          expect(await page.evaluate(() => location.hash)).toBe('');
          const doc = await downloadPdf(page);
          expect(doc.getPageCount()).toBe(2);
          expect(doc.getPage(0).getRotation().angle).toBe(0);
        } else {
          await expect(
            page.getByRole('button', { name: 'New blank PDF', exact: true }),
          ).toBeVisible();
          expect(await page.evaluate(() => location.hash)).toBe('#library');
          await expect(page.locator('.account-label')).toHaveText('test');
        }
        const writes = await page.evaluate(() => window.writes);
        expect(writes).toHaveLength(phase === 'save' || newer === 'none' ? 1 : 0);
        if (writes.length) {
          expect(writes[0].path).toBe('PDF Editor/Untitled.pdf');
          const saved = await PDFDocument.load(new Uint8Array(writes[0].bytes));
          expect(saved.getPageCount()).toBe(1);
          expect(saved.getPage(0).getRotation().angle).toBe(90);
        }
        expect(errors).toEqual([]);
        expect(await page.locator('#toast').textContent()).not.toMatch(
          /Something went wrong|Cannot read/,
        );
        if (!newer.includes('pdf')) {
          await page.getByRole('button', { name: 'New blank PDF', exact: true }).click();
          await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
        }
      });
