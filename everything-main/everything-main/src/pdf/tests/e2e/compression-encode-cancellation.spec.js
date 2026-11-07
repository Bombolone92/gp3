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
for (const phase of ['offscreen', 'dom'])
  for (const newer of ['none', 'library', 'pdf'])
    test(`${phase} JPEG encoding respects ${newer === 'none' ? 'the original document' : `a newer ${newer} choice`}`, async ({
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
      await page.evaluate((surface) => {
        window.compressionBufferReads = 0;
        const holdBlob = async (blob) => {
          const read = blob.arrayBuffer;
          blob.arrayBuffer = function () {
            window.compressionBufferReads++;
            return read.call(this);
          };
          await new Promise((resolve) => {
            window.releaseCompressionLookup = resolve;
          });
          setTimeout(() => {
            window.compressionLookupSettled = true;
          }, 0);
          return blob;
        };
        if (surface === 'offscreen') {
          const encode = OffscreenCanvas.prototype.convertToBlob;
          OffscreenCanvas.prototype.convertToBlob = async function (options) {
            const blob = await encode.call(this, options);
            return options.type === 'image/jpeg' ? holdBlob(blob) : blob;
          };
        } else {
          window.OffscreenCanvas = undefined;
          const encode = HTMLCanvasElement.prototype.toBlob;
          HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
            return encode.call(
              this,
              async (blob) => {
                callback(type === 'image/jpeg' ? await holdBlob(blob) : blob);
              },
              type,
              quality,
            );
          };
        }
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
      expect(await page.evaluate(() => window.compressionBufferReads)).toBe(
        newer === 'none' ? 1 : 0,
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
        // The replacement document remains usable after the old encoder finishes.
        await expect(page.locator('.page-caption')).toHaveText(
          `Page 1 of ${newer === 'library' ? 1 : 2}`,
        );
        await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
        expect((await downloaded(page)).getPageCount()).toBe(newer === 'library' ? 1 : 2);
      }
    });
