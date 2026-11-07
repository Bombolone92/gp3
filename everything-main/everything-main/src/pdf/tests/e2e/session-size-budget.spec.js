import { test, expect } from '@playwright/test';

test('an oversized page duplication preserves the PDF without serializing the rejected edit', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://js.puter.com/**', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(async () => {
    const { blankPdf, validatePdf } = await import('/src/core/document.js');
    const doc = await validatePdf(await blankPdf());
    // Legal page-level application data is copied with the page but ignored by readers.
    // Keep the real 60 MB encoded payload without making rendering scan a giant comment.
    const privateData = doc.context.register(doc.context.stream(new Uint8Array(60 * 1024 * 1024)));
    const date = doc
      .getInfoDict()
      .entries()
      .find(([key]) => key.decodeText() === 'CreationDate')[1];
    const pieceInfo = doc.context.obj({
      PieceInfo: { PDFEditor: { LastModified: date, Private: privateData } },
    });
    for (const [key, value] of pieceInfo.entries()) doc.getPage(0).node.set(key, value);
    const transfer = new DataTransfer();
    transfer.items.add(new File([await doc.save()], 'large.pdf', { type: 'application/pdf' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));
  });
  await expect(page).toHaveTitle('large.pdf · PDF Editor');
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(async () => {
    const { blankPdf, validatePdf } = await import('/src/core/document.js');
    const prototype = Object.getPrototypeOf(await validatePdf(await blankPdf()));
    const save = prototype.save;
    window.editSaves = 0;
    prototype.save = function (...args) {
      window.editSaves++;
      return save.apply(this, args);
    };
  });
  if (!(await page.locator('#page-sidebar').isVisible()))
    await page.getByRole('button', { name: 'Toggle pages panel', exact: true }).click();
  await page.locator('.thumb-item').first().hover();
  await page.getByRole('button', { name: 'Page 1 actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Duplicate page', exact: true }).click();
  await expect(page.locator('#toast')).toContainText(
    'This edit would exceed the 100 MB PDF limit.',
  );
  expect(await page.evaluate(() => window.editSaves)).toBe(0);
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
  await expect(page.locator('.thumb-item')).toHaveCount(1);
  await expect(page).toHaveTitle('large.pdf · PDF Editor');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});
