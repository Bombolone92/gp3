import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

async function setup(page, hold = false) {
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.cryptoWrites=0; window.cryptoPickers=0;
    window.puter={env:'web',auth:{isSignedIn:()=>true,getUser:async()=>({username:'test-user'}),signIn:async()=>{},signOut:async()=>{}},
    fs:{readdir:async()=>[],write:async()=>{window.cryptoWrites++;return{path:'PDFs/saved.pdf'};}},
    ui:{onLaunchedWithItems:()=>{},onItemsOpened:()=>{},showSaveFilePicker:async()=>{window.cryptoPickers++;return{path:'PDFs/chosen.pdf'};}}};`,
    }),
  );
  await page.addInitScript((hold) => {
    window.nativeStreams = 0;
    const prototype = Object.getPrototypeOf(crypto.subtle);
    const encrypt = prototype.encrypt;
    prototype.encrypt = function (...args) {
      const result = encrypt.apply(this, args);
      if (args[2].byteLength < 64 * 1024) return result;
      window.nativeStreams++;
      if (!hold) return result;
      return result.then(async (bytes) => {
        await new Promise((resolve) => {
          window.releaseNative = resolve;
        });
        setTimeout(() => {
          window.nativeFinished = true;
        }, 0);
        return bytes;
      });
    };
  }, hold);
  await page.goto('/');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
}
async function privatePdf(page, size) {
  await page.evaluate(async (size) => {
    const { blankPdf, validatePdf } = await import('/src/core/document.js');
    const doc = await validatePdf(await blankPdf());
    const ref = doc.context.register(doc.context.stream(new Uint8Array(size)));
    const date = doc
      .getInfoDict()
      .entries()
      .find(([key]) => key.decodeText() === 'CreationDate')[1];
    for (const [key, value] of doc.context
      .obj({ PieceInfo: { PDFEditor: { LastModified: date, Private: ref } } })
      .entries())
      doc.getPage(0).node.set(key, value);
    const transfer = new DataTransfer();
    transfer.items.add(new File([await doc.save()], 'private.pdf', { type: 'application/pdf' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));
  }, size);
  await expect(page).toHaveTitle('private.pdf · PDF Editor');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
}
async function menu(page, name) {
  const bar = page.getByRole('menubar', { name: 'PDF menus' });
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
  else await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menu').getByRole('menuitem', { name, exact: true }).click();
}
async function protect(page) {
  await menu(page, 'Protect with password…');
  const dialog = page.getByRole('dialog', { name: 'Protect with password', exact: true });
  await dialog.getByLabel('Password to open', { exact: true }).fill('reader');
  await dialog.getByLabel('Confirm password', { exact: true }).fill('reader');
  await dialog.getByRole('button', { name: 'Protect', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('encrypting an 80 MB stream keeps the event loop responsive and produces a readable PDF', async ({
  page,
}) => {
  test.setTimeout(60000);
  await setup(page);
  await privatePdf(page, 80 * 1024 * 1024);
  await protect(page);
  await page.evaluate(() => {
    window.encryptionGap = 0;
    window.cryptoTick = performance.now();
    window.cryptoTimer = setInterval(() => {
      const now = performance.now();
      window.encryptionGap = Math.max(window.encryptionGap, now - window.cryptoTick);
      window.cryptoTick = now;
    }, 10);
  });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await pending;
  const observation = await page.evaluate(() => {
    clearInterval(window.cryptoTimer);
    return {
      streams: window.nativeStreams,
      gap: Math.max(window.encryptionGap, performance.now() - window.cryptoTick),
    };
  });
  expect(observation.streams).toBe(1);
  expect(observation.gap).toBeLessThan(1000);
  const task = pdfjs.getDocument({
    data: new Uint8Array(await readFile(await download.path())),
    password: 'reader',
  });
  try {
    const pdf = await task.promise;
    expect(pdf.numPages).toBe(1);
    expect((await pdf.getPage(1)).view).toHaveLength(4);
  } finally {
    await task.destroy();
  }
  await expect(page.locator('.save-status')).toHaveText('Downloaded');
});

for (const action of ['download', 'save', 'folder'])
  for (const replacement of ['library', 'pdf'])
    test(`${action} waiting for native encryption retires after leaving for ${replacement}`, async ({
      page,
    }) => {
      const downloads = [],
        errors = [];
      page.on('download', (download) => downloads.push(download));
      page.on('pageerror', (error) => errors.push(error.message));
      await setup(page, true);
      await privatePdf(page, 200000);
      await protect(page);
      if (action === 'folder') await menu(page, 'Save to another Puter folder…');
      else
        await page
          .getByRole('button', {
            name: action === 'save' ? 'Save to Puter' : 'Download',
            exact: true,
          })
          .click();
      await expect.poll(() => page.evaluate(() => typeof window.releaseNative)).toBe('function');
      if (replacement === 'library')
        await page.getByRole('button', { name: 'Back to your PDFs', exact: true }).click();
      else {
        const doc = await PDFDocument.create();
        doc.addPage();
        doc.addPage();
        const pending = page.waitForEvent('filechooser');
        await page.keyboard.press('ControlOrMeta+o');
        await (
          await pending
        ).setFiles({
          name: 'latest.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await doc.save()),
        });
      }
      await page.getByRole('button', { name: 'Leave without saving', exact: true }).click();
      if (replacement === 'library')
        await expect(
          page.getByRole('button', { name: 'New blank PDF', exact: true }),
        ).toBeVisible();
      else await expect(page).toHaveTitle('latest.pdf · PDF Editor');
      await page.evaluate(() => window.releaseNative());
      await expect.poll(() => page.evaluate(() => window.nativeFinished)).toBe(true);
      expect(downloads).toHaveLength(0);
      expect(await page.evaluate(() => [window.cryptoWrites, window.cryptoPickers])).toEqual([
        0, 0,
      ]);
      await expect(page.locator('#toast')).toBeHidden();
      if (replacement === 'pdf')
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
      expect(errors).toEqual([]);
    });
