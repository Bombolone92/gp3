import { test, expect } from '@playwright/test';
import { PDFDocument, PDFArray, PDFDict, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { partialFlattenPdf } from '../fixtures/partial-flatten.js';

function retained(doc) {
  const field = doc.getForm().getField('Keep value'),
    kids = field.acroField.dict.lookup(PDFName.of('Kids'));
  const widgets = (kids instanceof PDFArray ? kids.asArray() : [field.acroField.dict])
    .map((entry) => doc.context.lookup(entry))
    .filter((entry) => entry instanceof PDFDict);
  return [
    field.acroField.dict,
    ...widgets,
    ...widgets.map((widget) => widget.lookup(PDFName.of('AP'))),
  ].map((dict) => dict?.toString());
}
for (const kind of ['text', 'dropdown', 'list', 'widget-layout', 'widgets'])
  test(`an unreadable ${kind} appearance does not block editing another field`, async ({
    page,
  }) => {
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/#library');
    const source = await PDFDocument.load(await partialFlattenPdf(kind));
    if (kind === 'widget-layout')
      source
        .getForm()
        .getField('Keep value')
        .acroField.getWidgets()[0]
        .dict.delete(PDFName.of('AP'));
    const bytes = await source.save({ updateFieldAppearances: false }),
      original = retained(source);
    const opening = page.waitForEvent('filechooser');
    await page.keyboard.press('ControlOrMeta+o');
    await (
      await opening
    ).setFiles({ name: 'form.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    const safe = page.getByRole('textbox', { name: 'Flatten me (on page)', exact: true });
    await safe.fill('Updated safe value');
    await safe.press('Tab');
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await expect(safe).toHaveValue('Updated safe value');
    const download = async () => {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      return new Uint8Array(await readFile(await (await pending).path()));
    };
    const saved = await PDFDocument.load(await download());
    expect(saved.getForm().getTextField('Flatten me').getText()).toBe('Updated safe value');
    expect(retained(saved)).toEqual(original);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(safe).toHaveValue('Visible value');
    expect(await download()).toEqual(bytes);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(safe).toHaveValue('Updated safe value');
    expect(retained(await PDFDocument.load(await download()))).toEqual(original);
  });
