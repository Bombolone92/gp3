import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { inheritedChoicePdf } from '../fixtures/inherited-choice.js';
import { listFields } from '../../src/core/document.js';

for (const list of [false, true])
  test(`inherited ${list ? 'list' : 'dropdown'} choices save from the page and forms dialog`, async ({
    page,
  }) => {
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/#library');
    const { doc } = await inheritedChoicePdf({ list, indirect: true, defaultOnly: true });
    const opening = page.waitForEvent('filechooser');
    await page.keyboard.press('ControlOrMeta+o');
    await (
      await opening
    ).setFiles({
      name: 'inherited-choice.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    });
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    const field = page.getByLabel('Destination.Country (on page)', { exact: true });
    await field.selectOption(list ? ['FR', 'JP'] : 'FR');
    await field.press('Enter');
    const download = async () => {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      return PDFDocument.load(await readFile(await (await pending).path()));
    };
    // Saving must accept the choices already offered by the on-page control.
    const saved = await download();
    expect(listFields(saved)[0].value).toEqual(list ? ['FR', 'JP'] : ['FR']);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    if (list) await expect(field).toHaveValues(['CA']);
    else await expect(field).toHaveValue('CA');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    if (list) await expect(field).toHaveValues(['FR', 'JP']);
    else await expect(field).toHaveValue('FR');
    await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Fill forms' });
    const choice = dialog.getByLabel('Destination.Country', { exact: true });
    await expect(choice.locator('option[value="CA"]')).toHaveText('Canada');
    await expect(choice.locator('option[value="FR"]')).toHaveText('France');
    await expect(choice.locator('option[value="JP"]')).toHaveText('Japan');
    await choice.selectOption('JP');
    await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(listFields(await download())[0].value).toEqual(['JP']);
  });
