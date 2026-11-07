import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { formPreservationPdf } from '../fixtures/form-preservation.js';

for (const defaultOnly of [false, true])
  for (const editName of [false, true])
    test(`Fill forms preserves untouched values (default=${defaultOnly}, edit=${editName})`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const doc = await formPreservationPdf({ defaultOnly });
      const pending = page.waitForEvent('filechooser');
      await page.keyboard.press('ControlOrMeta+o');
      await (
        await pending
      ).setFiles({
        name: 'preserve-form.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await doc.save({ updateFieldAppearances: false })),
      });
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      const openDialog = () =>
        page.getByRole('button', { name: 'Fill forms', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Fill forms' });
      const save = async () => {
        await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
        await expect(dialog).toHaveCount(0);
      };
      const download = async () => {
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        return PDFDocument.load(await readFile(await (await pending).path()));
      };
      await openDialog();
      await expect(dialog.getByLabel('Single', { exact: true })).toHaveValue('FirstSecond');
      await expect(dialog.getByLabel('Notes', { exact: true })).toHaveValue('First\nSecond\nThird');
      if (editName) await dialog.getByLabel('Name', { exact: true }).fill('Updated');
      await save();
      const saved = await download();
      const form = saved.getForm();
      for (const [name, expected] of [
        ['Single', 'First\r\nSecond'],
        ['Notes', 'First\r\nSecond\rThird'],
      ]) {
        const field = form.getTextField(name);
        expect
          .soft(field.acroField.dict.lookup(PDFName.of(defaultOnly ? 'DV' : 'V')).decodeText())
          .toBe(expected);
        if (defaultOnly) expect.soft(field.acroField.V()).toBeUndefined();
      }
      const radio = form.getRadioGroup('Delivery');
      expect
        .soft(radio.acroField.dict.lookup(PDFName.of(defaultOnly ? 'DV' : 'V')).decodeText())
        .toBe('Legacy');
      if (defaultOnly) expect.soft(radio.acroField.V()).toBeUndefined();
      expect(form.getTextField('Name').getText()).toBe(editName ? 'Updated' : 'Original');
      if (editName) {
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(page.getByLabel('Name (on page)', { exact: true })).toHaveValue('Original');
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect(page.getByLabel('Name (on page)', { exact: true })).toHaveValue('Updated');
      } else await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      // Explicit edits, including clearing a value absent from the radio options, still apply.
      await openDialog();
      await dialog.getByLabel('Single', { exact: true }).fill('Changed');
      await dialog.getByLabel('Notes', { exact: true }).fill('New first\nNew second');
      await dialog.getByLabel('Delivery', { exact: true }).selectOption('Pickup');
      await dialog.getByLabel('Delivery', { exact: true }).selectOption('');
      await save();
      const edited = (await download()).getForm();
      expect(edited.getTextField('Single').getText()).toBe('Changed');
      expect(edited.getTextField('Notes').getText()).toBe('New first\nNew second');
      expect(edited.getRadioGroup('Delivery').acroField.getValue().decodeText()).toBe('Off');
    });
