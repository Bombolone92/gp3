import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { ambiguousChoicePdf, ambiguousChoices } from '../fixtures/ambiguous-choice.js';

async function open(page, doc) {
  const pending = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (
    await pending
  ).setFiles({
    name: 'choice-labels.pdf',
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
async function prepare(page, options) {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  const { doc } = await ambiguousChoicePdf(options);
  await open(page, doc);
  return page.getByLabel('Destination.Country (on page)', { exact: true });
}

for (const inherited of [false, true])
  for (const defaultOnly of [false, true])
    test(`reentering an on-page dropdown label preserves its export (inherited=${inherited}, default=${defaultOnly})`, async ({
      page,
    }) => {
      const input = await prepare(page, { inherited, defaultOnly });
      const original = await input.inputValue();
      await input.fill(original);
      await input.press('Tab');
      const unchanged = await download(page);
      expect(unchanged.getForm().getDropdown('Destination.Country').getSelected()).toEqual(
        defaultOnly ? [] : ['B'],
      );
      if (defaultOnly) {
        expect(
          unchanged.getForm().getDropdown('Destination.Country').acroField.V(),
        ).toBeUndefined();
        expect(
          unchanged
            .getForm()
            .getDropdown('Destination.Country')
            .acroField.dict.lookup(PDFName.of('DV'))
            .decodeText(),
        ).toBe('B');
      }
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      const first = await page.locator('.form-layer datalist option').first().getAttribute('value');
      await input.fill(first);
      await input.press('Tab');
      const changed = await download(page);
      expect(changed.getForm().getDropdown('Destination.Country').getSelected()).toEqual(['A']);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(input).toHaveValue(original);
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(input).toHaveValue(first);
      await open(page, changed);
      await expect(input).toHaveValue(first);
    });

test('on-page dropdown suggestions preserve exports with ambiguous or normalized labels', async ({
  page,
}) => {
  const input = await prepare(page, {});
  for (const [index, [value]] of ambiguousChoices.entries()) {
    const label = await page
      .locator('.form-layer datalist option')
      .nth(index)
      .getAttribute('value');
    await input.fill(label);
    await input.press('Tab');
    const saved = await download(page);
    expect.soft(saved.getForm().getDropdown('Destination.Country').getSelected()).toEqual([value]);
  }
  await input.fill('Custom destination');
  await input.press('Tab');
  expect((await download(page)).getForm().getDropdown('Destination.Country').getSelected()).toEqual(
    ['Custom destination'],
  );
  await input.fill('');
  await input.press('Tab');
  expect((await download(page)).getForm().getDropdown('Destination.Country').getSelected()).toEqual(
    [],
  );
});
