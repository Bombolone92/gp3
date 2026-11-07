import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { editableChoicePdf } from '../fixtures/editable-choice.js';

async function open(page, doc) {
  const pending = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (
    await pending
  ).setFiles({
    name: 'choice-typing.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
}
async function download(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  return PDFDocument.load(await readFile(await (await pending).path()));
}
async function prepare(page, options = {}) {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  const { doc, field } = await editableChoicePdf(options);
  field.addToPage(doc.getPage(0), { x: 30, y: 45, width: 240, height: 30 });
  await open(page, doc);
  const inputs = page.getByLabel('Destination.Country (on page)', { exact: true });
  return { input: inputs.first(), mirror: inputs.nth(1) };
}

for (const inherited of [false, true])
  for (const defaultOnly of [false, true])
    for (const custom of ['CAPE VERDE', 'FRONTIER'])
      test(`typing a custom dropdown value preserves the entered text (${custom}, inherited=${inherited}, default=${defaultOnly})`, async ({
        page,
      }) => {
        const { input, mirror } = await prepare(page, { inherited, defaultOnly });
        await input.fill('');
        await input.pressSequentially(custom.slice(0, 2));
        expect(await input.inputValue()).toBe(custom.slice(0, 2));
        await expect(input).toHaveJSProperty('selectionStart', 2);
        await expect(mirror).toHaveValue(custom.startsWith('CA') ? 'Canada' : 'France');
        await input.pressSequentially(custom.slice(2));
        await expect(input).toHaveValue(custom);
        await expect(input).toHaveJSProperty('selectionStart', custom.length);
        await expect(input.locator('..')).toHaveClass(/has-draft/);
        await expect(input).toHaveAttribute('aria-invalid', 'false');
        await expect(mirror).toHaveValue(custom);
        const saved = await download(page);
        expect(saved.getForm().getDropdown('Destination.Country').getSelected()).toEqual([custom]);
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(input).toHaveValue('Canada');
        await expect(mirror).toHaveValue('Canada');
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect(input).toHaveValue(custom);
        await open(page, saved);
        await expect(input).toHaveValue(custom);
        await expect(mirror).toHaveValue(custom);
      });

test('editable dropdowns normalize after editing and retain Escape and Enter behavior', async ({
  page,
}) => {
  const { input, mirror } = await prepare(page);
  await input.fill('');
  await input.pressSequentially('CA');
  expect(await input.inputValue()).toBe('CA');
  await input.press('Tab');
  await expect(input).toHaveValue('Canada');
  expect((await download(page)).getForm().getDropdown('Destination.Country').getSelected()).toEqual(
    ['CA'],
  );
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await input.fill('');
  await input.pressSequentially('FR');
  await expect(input).toHaveValue('FR');
  await input.press('Escape');
  await expect(input).toHaveValue('Canada');
  await expect(mirror).toHaveValue('Canada');
  await input.fill('');
  await input.pressSequentially('FR');
  await input.press('Enter');
  await expect(input).toHaveValue('France');
  await expect(mirror).toHaveValue('France');
  expect((await download(page)).getForm().getDropdown('Destination.Country').getSelected()).toEqual(
    ['FR'],
  );
});
