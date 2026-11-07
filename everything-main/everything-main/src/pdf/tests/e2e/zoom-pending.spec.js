import { test, expect } from '@playwright/test';
import { PDFDocument, degrees } from 'pdf-lib';

async function pendingZoom(page, rotation = 0) {
  await page.route('https://js.puter.com/**', (route) => route.abort());
  const doc = await PDFDocument.create();
  const sheet = doc.addPage([400, 500]);
  sheet.setRotation(degrees(rotation));
  sheet.drawText('Original words', { x: 40, y: 350, size: 18 });
  await page.goto('/#library');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'zoom.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
  await page.getByLabel('Zoom', { exact: true }).selectOption('1');
  await expect(page.locator('.paper')).toHaveCSS('width', `${rotation ? 500 : 400}px`);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Edit text: Original words', exact: true }).click();
  await expect(page.locator('.text-draft-background')).toBeVisible();
  await page.getByRole('textbox', { name: 'Edit text', exact: true }).fill('Revised words');
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message?.action === 'GetTextContent') {
        Worker.prototype.postMessage = post;
        window.releaseZoomCommit = () => post.call(this, message, ...rest);
      } else post.call(this, message, ...rest);
    };
  });
  await page.keyboard.press('ControlOrMeta+=');
  await expect.poll(() => page.evaluate(() => !!window.releaseZoomCommit)).toBe(true);
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'true');
}

for (const rotation of [0, 90]) {
  for (const [key, expected] of [
    ['=', 1.25],
    ['-', 1],
  ]) {
    test(`rapid zoom ${key} while text commits retains each step at rotation ${rotation}`, async ({
      page,
    }) => {
      await pendingZoom(page, rotation);
      await page.keyboard.press(`ControlOrMeta+${key}`);
      await page.evaluate(() => window.releaseZoomCommit());
      await expect(page.getByLabel('Zoom', { exact: true })).toHaveValue(String(expected));
      await expect(page.locator('.paper')).toHaveCSS(
        'width',
        `${(rotation ? 500 : 400) * expected}px`,
      );
      await expect(
        page.getByRole('button', { name: 'Edit text: Revised words', exact: true }),
      ).toBeEnabled();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Edit text: Original words', exact: true }),
      ).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      await expect(page.getByLabel('Zoom', { exact: true })).toHaveValue(String(expected));
    });
  }
}

test('choosing the rendered zoom cancels a pending zoom change without discarding text', async ({
  page,
}) => {
  await pendingZoom(page);
  await page.getByLabel('Zoom', { exact: true }).selectOption('1');
  await page.evaluate(() => window.releaseZoomCommit());
  await expect(
    page.getByRole('button', { name: 'Edit text: Revised words', exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel('Zoom', { exact: true })).toHaveValue('1');
  await expect(page.locator('.paper')).toHaveCSS('width', '400px');
});
