import { test, expect } from '@playwright/test';
import { PDFDocument, PDFHexString } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { editableChoicePdf } from '../fixtures/editable-choice.js';

test('Fill forms keeps ambiguous editable suggestions selectable', async ({ page }) => {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  const { doc, field } = await editableChoicePdf();
  field.acroField.setOptions(
    [
      ['A', 'Shared'],
      ['B', 'Shared'],
      ['C', 'Shared (A)'],
      ['D', ''],
      ['', ''],
      ['E', '(Empty option)'],
      ['NZ', 'New\nZealand'],
      ['Line\r\ncode', ''],
    ].map(([value, label]) => ({
      value: PDFHexString.fromText(value),
      display: PDFHexString.fromText(label),
    })),
  );
  field.acroField.setValues([PDFHexString.fromText('B')]);
  const pending = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (
    await pending
  ).setFiles({
    name: 'ambiguous-choice.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  for (const [label, value] of [
    ['Shared (A)', 'A'],
    ['Shared (B)', 'B'],
    ['Shared (A) (2)', 'C'],
    ['D', 'D'],
    ['(Empty option) (empty)', ''],
    ['(Empty option) (E)', 'E'],
    ['New Zealand', 'NZ'],
    ['Line code', 'Line\r\ncode'],
    ['Shared', 'Shared'],
  ]) {
    await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Fill forms' });
    const input = dialog.getByLabel('Destination.Country', { exact: true });
    if (label === 'Shared (A)') await expect(input).toHaveValue('Shared (B)');
    await input.fill(label);
    await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const saved = await PDFDocument.load(await readFile(await (await downloading).path()));
    expect(saved.getForm().getDropdown('Destination.Country').getSelected()).toEqual([value]);
  }
});

for (const inherited of [false, true])
  for (const defaultOnly of [false, true])
    test(`Fill forms edits custom dropdown values (inherited=${inherited}, default=${defaultOnly})`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const { doc } = await editableChoicePdf({ inherited, defaultOnly });
      const open = async (document) => {
        const pending = page.waitForEvent('filechooser');
        await page.keyboard.press('ControlOrMeta+o');
        await (
          await pending
        ).setFiles({
          name: 'editable-choice.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await document.save()),
        });
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      };
      const download = async () => {
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        return PDFDocument.load(await readFile(await (await pending).path()));
      };
      const openDialog = () =>
        page.getByRole('button', { name: 'Fill forms', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Fill forms' });
      const input = dialog.getByLabel('Destination.Country', { exact: true });
      const save = async () => {
        await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
        await expect(dialog).toHaveCount(0);
      };
      await open(doc);
      await expect(
        page.getByLabel('Destination.Country (on page)', { exact: true }),
      ).toHaveJSProperty('tagName', 'INPUT');
      await openDialog();
      await expect(input).toHaveJSProperty('tagName', 'INPUT');
      await expect(input).toHaveValue('Canada');
      await expect(dialog.getByLabel('Fixed', { exact: true })).toHaveJSProperty(
        'tagName',
        'SELECT',
      );
      await expect(dialog.getByLabel('Multiple', { exact: true })).toHaveValues([
        'First',
        'Second',
      ]);
      await save();
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      await openDialog();
      await input.fill('Custom destination');
      await save();
      const custom = await download();
      expect(custom.getForm().getDropdown('Destination.Country').getSelected()).toEqual([
        'Custom destination',
      ]);
      expect(custom.getForm().getDropdown('Destination.Country').isEditable()).toBe(true);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.getByLabel('Destination.Country (on page)', { exact: true })).toHaveValue(
        'Canada',
      );
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(page.getByLabel('Destination.Country (on page)', { exact: true })).toHaveValue(
        'Custom destination',
      );
      await open(custom);
      for (const [label, expected] of [
        ['France', ['FR']],
        ['(Empty option)', ['']],
        ['', []],
      ]) {
        await openDialog();
        await input.fill(label);
        await save();
        const saved = await download();
        expect(saved.getForm().getDropdown('Destination.Country').getSelected()).toEqual(expected);
        expect(saved.getForm().getDropdown('Fixed').getSelected()).toEqual(['A']);
        expect(saved.getForm().getDropdown('Fixed').isEditable()).toBe(false);
        expect(saved.getForm().getDropdown('Multiple').getSelected()).toEqual(['First', 'Second']);
      }
    });

for (const inherited of [false, true])
  test(`Fill forms keeps editable dropdowns read-only (inherited=${inherited})`, async ({
    page,
  }) => {
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/#library');
    const { doc } = await editableChoicePdf({ inherited, readOnly: true });
    const pending = page.waitForEvent('filechooser');
    await page.keyboard.press('ControlOrMeta+o');
    await (
      await pending
    ).setFiles({
      name: 'readonly-choice.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    });
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Fill forms' });
    const input = dialog.getByLabel('Destination.Country (read only)', { exact: true });
    await expect(input).toHaveJSProperty('tagName', 'INPUT');
    await expect(input).toHaveValue('Canada');
    await expect(input).toBeDisabled();
    await dialog.getByLabel('Fixed', { exact: true }).selectOption('B');
    await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const saved = await PDFDocument.load(await readFile(await (await downloading).path()));
    expect(saved.getForm().getDropdown('Destination.Country').getSelected()).toEqual(['CA']);
    expect(saved.getForm().getDropdown('Destination.Country').isReadOnly()).toBe(true);
    expect(saved.getForm().getDropdown('Fixed').getSelected()).toEqual(['B']);
  });
