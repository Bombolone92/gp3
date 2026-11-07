import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { inheritedTextLimitPdf } from '../fixtures/inherited-text-limit.js';

for (const kind of ['text', 'comb', 'multiline'])
  test(`Fill forms respects inherited ${kind} length limits`, async ({ page }) => {
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/#library');
    const { doc } = await inheritedTextLimitPdf({
      comb: kind === 'comb',
      multiline: kind === 'multiline',
      indirect: true,
    });
    const opening = page.waitForEvent('filechooser');
    await page.keyboard.press('ControlOrMeta+o');
    await (
      await opening
    ).setFiles({
      name: 'inherited-limit.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    });
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByLabel('Address.Code (on page)', { exact: true })).toHaveAttribute(
      'maxlength',
      '5',
    );
    await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Fill forms' });
    const input = dialog.getByLabel('Address.Code', { exact: true });
    await expect(input).toHaveAttribute('maxlength', '5');
    await input.fill('');
    await input.pressSequentially('543219876');
    await expect(input).toHaveValue('54321');
    await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Address.Code (on page)', { exact: true })).toHaveValue('54321');
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const saved = await PDFDocument.load(await readFile(await (await downloading).path()));
    expect(saved.getForm().getTextField('Address.Code').getText()).toBe('54321');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByLabel('Address.Code (on page)', { exact: true })).toHaveValue('123');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(page.getByLabel('Address.Code (on page)', { exact: true })).toHaveValue('54321');
  });
