import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { checkboxOptionsPdf, incompleteCheckboxPdf } from '../fixtures/checkbox-options.js';

async function checkboxPdf(selected, mapped) {
  const doc = await PDFDocument.create();
  const field = doc.getForm().createCheckBox('Delivery');
  for (let i = 0; i < 2; i++)
    field.addToPage(doc.addPage([300, 300]), { x: 40, y: 200, width: 20, height: 20 });
  for (const [i, widget] of field.acroField.getWidgets().entries()) {
    const option = i ? 'Pickup' : 'Courier';
    const value = mapped ? String(i) : option;
    const appearances = widget.getAppearances().normal;
    appearances.set(PDFName.of(value), appearances.get(PDFName.of('Yes')));
    appearances.delete(PDFName.of('Yes'));
    widget.setAppearanceState(PDFName.of(option === selected ? value : 'Off'));
  }
  field.acroField.dict.set(
    PDFName.of('V'),
    PDFName.of(
      mapped && selected !== 'Off' ? String(['Courier', 'Pickup'].indexOf(selected)) : selected,
    ),
  );
  if (mapped)
    field.acroField.dict.set(
      PDFName.of('Opt'),
      doc.context.obj(['Courier', 'Pickup'].map((value) => PDFHexString.fromText(value))),
    );
  return doc;
}
async function download(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  return PDFDocument.load(await readFile(await (await pending).path()));
}
const expectSelection = (doc, value, mapped) => {
  const field = doc.getForm().getCheckBox('Delivery');
  const raw = mapped && value !== 'Off' ? String(['Courier', 'Pickup'].indexOf(value)) : value;
  expect(field.acroField.getValue().decodeText()).toBe(raw);
  expect(
    field.acroField.getWidgets().map((widget) => widget.getAppearanceState().decodeText()),
  ).toEqual(['Courier', 'Pickup'].map((option) => (option === value ? raw : 'Off')));
};
for (const appearance of ['missing', 'off-only'])
  for (const mode of ['on page', 'dialog'])
    test(`clears incomplete checkbox groups (${appearance}, ${mode})`, async ({ page }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const { doc } = await incompleteCheckboxPdf(appearance);
      const open = async (document) => {
        const pending = page.waitForEvent('filechooser');
        await page.keyboard.press('ControlOrMeta+o');
        await (
          await pending
        ).setFiles({
          name: 'incomplete-checkbox.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await document.save({ updateFieldAppearances: false })),
        });
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      };
      await open(doc);
      const box = page.getByRole('checkbox', { name: 'Delivery: Courier (on page)', exact: true });
      await expect(box).toBeChecked();
      if (mode === 'on page') await box.uncheck();
      else {
        await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Fill forms' });
        await dialog.getByLabel('Delivery', { exact: true }).selectOption({ index: 0 });
        await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
        await expect(dialog).not.toBeVisible();
      }
      const saved = await download(page);
      const expectState = (document, selected) => {
        const field = document.getForm().getCheckBox('Delivery');
        expect(field.acroField.getValue().decodeText()).toBe(selected);
        expect(
          field.acroField.getWidgets().map((widget) => widget.getAppearanceState().decodeText()),
        ).toEqual([selected, 'Off', 'Off']);
      };
      expectState(saved, 'Off');
      await expect(box).not.toBeChecked();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(box).toBeChecked();
      expectState(await download(page), 'A');
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(box).not.toBeChecked();
      expectState(await download(page), 'Off');
      await open(saved);
      await expect(box).not.toBeChecked();
      await box.check();
      expectState(await download(page), 'A');
    });
for (const mapped of [false, true])
  for (const initial of ['Off', 'Pickup'])
    test(`checkbox choices on separate pages save their export values (initial=${initial}, mapped=${mapped})`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const open = async (doc) => {
        const pending = page.waitForEvent('filechooser');
        await page.keyboard.press('ControlOrMeta+o');
        await (
          await pending
        ).setFiles({
          name: 'delivery.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await doc.save()),
        });
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      };
      await open(await checkboxPdf(initial, mapped));
      const box = page.getByRole('checkbox', { name: 'Delivery (on page)', exact: true });
      await expect(box).not.toBeChecked();
      await box.check();
      expectSelection(await download(page), 'Courier', mapped);
      await expect(box).toBeChecked();
      await page.getByRole('button', { name: 'Next page', exact: true }).click();
      await expect(page.locator('.page-caption')).toHaveText('Page 2 of 2');
      await expect(box).not.toBeChecked();
      await box.check();
      expectSelection(await download(page), 'Pickup', mapped);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(box).not.toBeChecked();
      expectSelection(await download(page), 'Courier', mapped);
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(box).toBeChecked();
      const saved = await download(page);
      expectSelection(saved, 'Pickup', mapped);
      await open(saved);
      await expect(box).not.toBeChecked();
      await page.getByRole('button', { name: 'Next page', exact: true }).click();
      await expect(box).toBeChecked();
      await box.uncheck();
      expectSelection(await download(page), 'Off', mapped);
    });

for (const inherited of [false, true])
  for (const first of ['Courier', ''])
    test(`Fill forms preserves mapped checkbox options (inherited=${inherited}, first=${JSON.stringify(first)})`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const { doc, field } = await checkboxOptionsPdf({
        inherited,
        indirect: true,
        values: [first, 'Pickup'],
      });
      const name = field.getName();
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: /Open a PDF/ }).click();
      await (
        await chooser
      ).setFiles({
        name: 'mapped-options.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await doc.save()),
      });
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      const edit = async () => {
        await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
        return page.getByRole('dialog', { name: 'Fill forms' }).getByLabel(name, { exact: true });
      };
      const choice = await edit();
      await expect(choice.locator('option')).toHaveText([
        'Choose an option',
        first || '(Empty option)',
        'Pickup',
      ]);
      await expect(choice).toHaveJSProperty('selectedIndex', 1);
      await choice.selectOption('Pickup');
      await page.getByRole('button', { name: 'Save form', exact: true }).click();
      await expect(
        page.getByRole('checkbox', { name: `${name}: Pickup (on page)`, exact: true }),
      ).toBeChecked();
      const saved = await download(page);
      expect(saved.getForm().getCheckBox(name).acroField.getValue().decodeText()).toBe('B');
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
      const restored = await edit();
      await expect(restored).toHaveJSProperty('selectedIndex', 1);
      // An empty export is distinct from the placeholder that clears the field.
      await restored.selectOption({ index: 0 });
      await page.getByRole('button', { name: 'Save form', exact: true }).click();
      expect(
        (await download(page)).getForm().getCheckBox(name).acroField.getValue().decodeText(),
      ).toBe('Off');
    });
