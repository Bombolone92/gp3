import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';

async function openPdf(page, bytes, name = 'photos.pdf') {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await expect(page).toHaveTitle(`${name} · PDF Editor`);
  await expect(page.locator('.page-caption')).toContainText('Page 1 of');
}
async function downloaded(page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  return PDFDocument.load(await readFile(await (await download).path()));
}
function imageWidth(doc) {
  const objects = doc.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'))?.entries() || [];
  return objects
    .map(([, ref]) => doc.context.lookup(ref))
    .find((object) => object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))
    ?.dict.lookup(PDFName.of('Width'))
    .asNumber();
}
for (const phase of ['document', 'page'])
  for (const newer of ['none', 'library', 'pdf'])
    test(`compression waiting for ${phase} respects ${newer === 'none' ? 'the original document' : `a newer ${newer} choice`}`, async ({
      page,
    }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('https://js.puter.com/**', (route) =>
        route.fulfill({
          contentType: 'application/javascript',
          body: `window.puter={env:'web',auth:{isSignedIn:()=>true,getUser:async()=>({username:'test'})},fs:{readdir:async()=>[]},ui:{onLaunchedWithItems:()=>{},onItemsOpened:()=>{}}};`,
        }),
      );
      const canvas = createCanvas(800, 600);
      const context = canvas.getContext('2d');
      const gradient = context.createLinearGradient(0, 0, 800, 600);
      gradient.addColorStop(0, 'red');
      gradient.addColorStop(1, 'blue');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 800, 600);
      const doc = await PDFDocument.create();
      const jpeg = await doc.embedJpg(await canvas.encode('jpeg', 95));
      doc.addPage([400, 400]).drawImage(jpeg, { x: 30, y: 200, width: 100, height: 75 });
      await page.goto('/#library');
      await openPdf(page, await doc.save());
      await page.evaluate((phase) => {
        const post = Worker.prototype.postMessage;
        window.compressionRenders = 0;
        window.compressionPages = 0;
        Worker.prototype.postMessage = function (message, ...rest) {
          if (message?.action === 'GetDocRequest' && !window.compressionId) {
            window.compressionId = message.data.docId;
            if (phase === 'document') {
              this.addEventListener('message', (event) => {
                if (
                  event.data?.action === 'GetDoc' &&
                  event.data.targetName === window.compressionId
                )
                  setTimeout(() => {
                    window.compressionLookupSettled = true;
                  }, 0);
              });
              window.releaseCompressionLookup = () => post.call(this, message, ...rest);
              return;
            }
          }
          if (message?.sourceName === window.compressionId) {
            if (message.action === 'GetOperatorList') window.compressionRenders++;
            if (message.action === 'GetPage') {
              window.compressionPages++;
              if (phase === 'page' && !window.releaseCompressionLookup) {
                this.addEventListener('message', (event) => {
                  if (
                    event.data?.callbackId === message.callbackId &&
                    event.data.targetName === window.compressionId
                  )
                    setTimeout(() => {
                      window.compressionLookupSettled = true;
                    }, 0);
                });
                window.releaseCompressionLookup = () => post.call(this, message, ...rest);
                return;
              }
            }
          }
          return post.call(this, message, ...rest);
        };
      }, phase);
      const bar = page.getByRole('menubar', { name: 'PDF menus' });
      if (await bar.isVisible())
        await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
      else await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Reduce file size…', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Reduce file size', exact: true })
        .getByRole('button', { name: 'Reduce size', exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => typeof window.releaseCompressionLookup))
        .toBe('function');
      if (newer !== 'none') {
        if (newer === 'library')
          await page.getByRole('button', { name: 'Back to your PDFs', exact: true }).click();
        else {
          const replacement = await PDFDocument.create();
          replacement.addPage([300, 300]);
          replacement.addPage([300, 300]);
          const chooser = page.waitForEvent('filechooser');
          await page.keyboard.press('ControlOrMeta+o');
          await (
            await chooser
          ).setFiles({
            name: 'latest.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from(await replacement.save()),
          });
        }
        await page.getByRole('button', { name: 'Leave without saving', exact: true }).click();
        if (newer === 'library')
          await expect(
            page.getByRole('button', { name: 'New blank PDF', exact: true }),
          ).toBeVisible();
        else await expect(page).toHaveTitle('latest.pdf · PDF Editor');
      }
      await page.evaluate(() => window.releaseCompressionLookup());
      await expect.poll(() => page.evaluate(() => window.compressionLookupSettled)).toBe(true);
      if (newer === 'none') {
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        await expect(page.locator('#toast')).toContainText('File size reduced');
      }
      expect(await page.evaluate(() => window.compressionRenders)).toBe(newer === 'none' ? 1 : 0);
      expect(await page.evaluate(() => window.compressionPages)).toBe(
        newer !== 'none' && phase === 'document' ? 0 : 1,
      );
      expect(errors).toEqual([]);
      if (newer === 'none') {
        expect(imageWidth(await downloaded(page))).toBe(208);
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
        expect(imageWidth(await downloaded(page))).toBe(800);
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
        expect(imageWidth(await downloaded(page))).toBe(208);
      } else {
        await expect(page.locator('#toast')).toBeHidden();
        if (newer === 'library')
          await page.getByRole('button', { name: 'New blank PDF', exact: true }).click();
        // Destroying the decoder task must leave the shared PDF worker usable.
        await expect(page.locator('.page-caption')).toHaveText(
          `Page 1 of ${newer === 'library' ? 1 : 2}`,
        );
        await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
        expect((await downloaded(page)).getPageCount()).toBe(newer === 'library' ? 1 : 2);
      }
    });
