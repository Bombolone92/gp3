import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { scrollingChoicePdf, selectedPixels } from '../fixtures/scrolling-choice.js';

for (const entry of ['page', 'dialog'])
  test(`a last-row list choice made from the ${entry} stays visible in the saved PDF`, async ({
    page,
  }) => {
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/#library');
    const { doc } = await scrollingChoicePdf();
    const opening = page.waitForEvent('filechooser');
    await page.keyboard.press('ControlOrMeta+o');
    await (
      await opening
    ).setFiles({
      name: 'choices.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    });
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    const field = page.getByLabel('Destination (on page)', { exact: true });
    if (entry === 'page') {
      await field.selectOption('Choice 12');
      await field.press('Enter');
    } else {
      await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Fill forms', exact: true });
      await dialog.getByLabel('Destination', { exact: true }).selectOption('Choice 12');
      await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
    const download = async () => {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      return new Uint8Array(await readFile(await (await pending).path()));
    };
    const bytes = await download();
    expect(
      (await PDFDocument.load(bytes)).getForm().getOptionList('Destination').getSelected(),
    ).toEqual(['Choice 12']);
    expect(await selectedPixels(bytes)).toBeGreaterThan(1000);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(field).toHaveValue('Choice 01');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(field).toHaveValue('Choice 12');
    expect(await selectedPixels(await download())).toBeGreaterThan(1000);
    await page.getByRole('button', { name: 'Back to your PDFs', exact: true }).click();
    const reopen = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Open a PDF/ }).click();
    await (
      await reopen
    ).setFiles({ name: 'saved.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
    await expect(field).toHaveValue('Choice 12');
    expect(await selectedPixels(await download())).toBeGreaterThan(1000);
  });
