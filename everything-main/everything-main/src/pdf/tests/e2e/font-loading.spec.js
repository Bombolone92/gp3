import { clickAway } from './editing-helpers.js';
import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

for (const failure of ['early download failure', 'invalid response'])
  test(`a font ${failure} preserves the draft and supports retry`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.route(/fontkit.*\.js/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await route.continue();
    });
    let downloads = 0;
    await page.route('**/fonts/NotoSans-Regular.ttf', (route) => {
      // The preview's CSS face is separate from the bytes requested by the PDF writer.
      if (route.request().resourceType() === 'fetch' && ++downloads === 1)
        return route.fulfill(
          failure === 'early download failure'
            ? { status: 503, body: '' }
            : {
                status: 200,
                contentType: 'text/html',
                body: '<html>Temporarily unavailable</html>',
              },
        );
      return route.continue();
    });
    await page.goto('/#library');
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Open a PDF/ }).click();
    await (
      await chooser
    ).setFiles({
      name: 'font-retry.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    });
    await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.getByRole('button', { name: 'Place at page center', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Text to add', exact: true });
    await input.fill('Keep this draft');
    await clickAway(page);
    await expect(page.locator('.text-edit-error')).toHaveText(
      'Could not load the text font. Please retry.',
    );
    await expect(input).toHaveValue('Keep this draft');
    await expect(page.locator('.text-target')).toHaveCount(0);
    await clickAway(page);
    await expect(input).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Edit text: Keep this draft', exact: true }),
    ).toBeVisible();
    expect(downloads).toBe(2);
    expect(errors).toEqual([]);
  });
