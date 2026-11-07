import { test, expect } from '@playwright/test';

async function startOutput(page, kind) {
  if (kind === 'print') await page.keyboard.press('ControlOrMeta+p');
  else {
    const bar = page.getByRole('menubar', { name: 'PDF menus' });
    if (await bar.isVisible())
      await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
    else await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Download pages as images…', exact: true }).click();
  }
  await page
    .getByRole('dialog', {
      name: kind === 'print' ? 'Print' : 'Download pages as images',
      exact: true,
    })
    .getByRole('button', { name: kind === 'print' ? 'Print' : 'Download', exact: true })
    .click();
  return page.getByRole('dialog', {
    name: kind === 'print' ? 'Printing' : 'Downloading pages as images',
    exact: true,
  });
}

for (const kind of ['print', 'images'])
  for (const result of ['success', 'failure'])
    test(`cancelled ${kind} preparation stops before a late image-encoding ${result}`, async ({
      page,
    }) => {
      const errors = [],
        downloads = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('download', (download) => downloads.push(download.suggestedFilename()));
      await page.addInitScript(() => {
        window.printCalls = 0;
        window.print = () => {
          window.printCalls++;
          window.dispatchEvent(new Event('afterprint'));
        };
        const encode = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (callback, ...options) {
          const canvas = this;
          encode.call(
            canvas,
            (blob) => {
              if (!window.holdEncoding) return callback(blob);
              window.holdEncoding = false;
              window.heldEncoding = { canvas, release: (fail) => callback(fail ? null : blob) };
            },
            ...options,
          );
        };
      });
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/');
      await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
      await page.evaluate(() => {
        window.holdEncoding = true;
      });
      const progress = await startOutput(page, kind);
      await expect.poll(() => page.evaluate(() => Boolean(window.heldEncoding))).toBe(true);
      await expect(progress).toBeVisible();
      await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(progress).toHaveCount(0);
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      expect(
        await page.evaluate(() => [
          window.heldEncoding.canvas.width,
          window.heldEncoding.canvas.height,
        ]),
      ).toEqual([0, 0]);
      await page.getByRole('button', { name: 'Text', exact: true }).click();
      await page.evaluate((fail) => window.heldEncoding.release(fail), result === 'failure');
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      expect(await page.evaluate(() => window.printCalls)).toBe(0);
      expect(downloads).toEqual([]);
      expect(errors).toEqual([]);
      await expect(page.locator('#toast')).toBeHidden();
      await expect(page.locator('.print-sheets')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Place at page center', exact: true }),
      ).toBeVisible();
    });

test('print preparation can cancel a pending image decode and release its image URL', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.printCalls = 0;
    window.print = () => {
      window.printCalls++;
      window.dispatchEvent(new Event('afterprint'));
    };
    window.revokedImages = [];
    const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (url) => {
      window.revokedImages.push(url);
      revoke.call(URL, url);
    };
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      const pending = decode.call(this);
      if (!this.closest('.print-sheet')) return pending;
      return pending.then(
        () =>
          new Promise((resolve) => {
            window.heldDecode = { image: this, release: resolve };
          }),
      );
    };
  });
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/');
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
  const progress = await startOutput(page, 'print');
  await expect.poll(() => page.evaluate(() => Boolean(window.heldDecode))).toBe(true);
  const imageUrl = await page.evaluate(() => window.heldDecode.image.src);
  await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(progress).toHaveCount(0);
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => window.revokedImages)).toContain(imageUrl);
  await page.evaluate(() => window.heldDecode.release());
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(await page.evaluate(() => window.printCalls)).toBe(0);
  await expect(page.locator('.print-sheets')).toHaveCount(0);
});

for (const kind of ['print', 'images'])
  test(`${kind} preparation can stop while waiting for a PDF page`, async ({ page }) => {
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/');
    await page.evaluate(async (kind) => {
      const { pageImage, printPages } = await import('/src/print.js');
      const controller = new AbortController();
      window.outputProbe = { outcome: 'pending', renders: 0 };
      const pdf = {
        getPage: () =>
          new Promise((resolve) => {
            window.outputProbe.release = () =>
              resolve({
                getViewport: () => ({ width: 100, height: 100 }),
                render: () => {
                  window.outputProbe.renders++;
                  return { promise: Promise.resolve(), cancel() {} };
                },
              });
          }),
      };
      const pending =
        kind === 'print'
          ? printPages(pdf, [0], { signal: controller.signal })
          : pageImage(pdf, 0, { signal: controller.signal });
      pending.then(
        () => {
          window.outputProbe.outcome = 'completed';
        },
        (error) => {
          window.outputProbe.outcome = error.name;
        },
      );
      // Let the page request start before cancelling its wait.
      await Promise.resolve();
      controller.abort();
    }, kind);
    await expect.poll(() => page.evaluate(() => window.outputProbe.outcome)).toBe('AbortError');
    await page.evaluate(() => window.outputProbe.release());
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    expect(await page.evaluate(() => window.outputProbe.renders)).toBe(0);
    await expect(page.locator('.print-sheets')).toHaveCount(0);
  });
