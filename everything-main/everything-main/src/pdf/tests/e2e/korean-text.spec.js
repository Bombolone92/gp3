import { clickAway } from './editing-helpers.js';
import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  const fontErrors = [];
  page.on('console', (message) => {
    if (
      /Failed to load font|Out of bounds subrIndex|Unable to detect correct font/.test(
        message.text(),
      )
    )
      fontErrors.push(message.text());
  });
  page.on('pageerror', (error) => fontErrors.push(error.message));
  page.fontErrors = fontErrors;
});
test.afterEach(async ({ page }) => {
  expect(page.fontErrors).toEqual([]);
});

async function openPdf(page, bytes) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'korean-subset.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
}

for (const face of ['Regular', 'Bold']) {
  test(`Korean ${face} subset edits preview, save, and reopen`, async ({ page }) => {
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/#library');
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(
      await readFile(new URL(`../../public/fonts/NotoSansKR-${face}.ttf`, import.meta.url)),
      { subset: true },
    );
    doc.addPage([500, 300]).drawText('회원가입', { font, x: 30, y: 180, size: 22 });
    await openPdf(page, await doc.save());
    await page.getByRole('button', { name: 'Edit text: 회원가입', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Edit text', exact: true });
    await input.fill('① 회원정보 수정');
    await expect(input).toHaveCSS('font-family', /Noto Sans KR/);
    await clickAway(page);
    await expect(input).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Edit text: ① 회원정보 수정', exact: true }),
    ).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const bytes = await readFile(await (await download).path());
    await page.getByRole('button', { name: 'Back to your PDFs', exact: true }).click();
    await openPdf(page, bytes);
    await page.getByRole('button', { name: 'Edit text: ① 회원정보 수정', exact: true }).click();
    await input.fill('② 대표자 변경');
    await clickAway(page);
    await expect(
      page.getByRole('button', { name: 'Edit text: ② 대표자 변경', exact: true }),
    ).toBeVisible();
  });
}

test('new Korean text loads the Korean preview font and can be saved', async ({ page }) => {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  doc.addPage([500, 300]);
  await openPdf(page, await doc.save());
  await page.getByRole('button', { name: 'Place at page center', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Text to add', exact: true });
  await input.fill('새로운 사용자');
  await expect(input).toHaveCSS('font-family', /Noto Sans KR/);
  await clickAway(page);
  await expect(
    page.getByRole('button', { name: 'Edit text: 새로운 사용자', exact: true }),
  ).toBeVisible();
});

test('a failed Korean font download preserves the draft and can be retried', async ({ page }) => {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  let downloads = 0;
  await page.route('**/fonts/NotoSansKR-Regular.ttf', (route) => {
    if (route.request().resourceType() === 'fetch' && ++downloads === 1)
      return route.fulfill({ status: 503, body: '' });
    return route.continue();
  });
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  doc.addPage([500, 300]);
  await openPdf(page, await doc.save());
  await page.getByRole('button', { name: 'Place at page center', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Text to add', exact: true });
  await input.fill('회원정보 수정');
  await clickAway(page);
  await expect(page.locator('.text-edit-error')).toHaveText(
    'Could not load the text font. Please retry.',
  );
  await expect(input).toHaveValue('회원정보 수정');
  await clickAway(page);
  await expect(
    page.getByRole('button', { name: 'Edit text: 회원정보 수정', exact: true }),
  ).toBeVisible();
  expect(downloads).toBe(2);
});
