import { test, expect } from '@playwright/test';
import { PDFDocument, decodePDFRawStream } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { inheritedAppearancePdf } from '../fixtures/inherited-appearance.js';

for (const kind of ['text', 'multiline', 'dropdown', 'list'])
  for (const level of ['parent', 'form'])
    for (const mode of ['page', 'dialog'])
      test(`editing preserves inherited color and size (${kind}, ${level}, ${mode})`, async ({
        page,
      }) => {
        await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
        await page.goto('/#library');
        const { doc } = await inheritedAppearancePdf({ kind, level, indirect: true });
        const open = async (doc) => {
          const [previous] = await page.locator('.editor').elementHandles();
          const opening = page.waitForEvent('filechooser');
          await page.keyboard.press('ControlOrMeta+o');
          await (
            await opening
          ).setFiles({
            name: 'styled-field.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from(await doc.save()),
          });
          // The previous editor stays usable until the newly selected file is read.
          if (previous) {
            await expect.poll(() => previous.evaluate((node) => node.isConnected)).toBe(false);
            await previous.dispose();
          }
          await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        };
        await open(doc);
        const onPage = page.getByLabel('Group.Value (on page)', { exact: true });
        const checkStyle = async () => {
          await expect(onPage).toBeEnabled();
          await onPage.focus();
          await expect(onPage).toHaveCSS('font-size', '12px');
          await expect(onPage).toHaveCSS('color', 'rgb(178, 26, 51)');
        };
        await checkStyle();
        const change = (control) =>
          kind === 'dropdown' || kind === 'list'
            ? control.selectOption('Changed')
            : control.fill('Changed');
        if (mode === 'page') await change(onPage);
        else {
          await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
          const dialog = page.getByRole('dialog', { name: 'Fill forms' });
          await change(dialog.getByLabel('Group.Value', { exact: true }));
          await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
          await expect(dialog).toHaveCount(0);
        }
        const downloading = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        const saved = await PDFDocument.load(await readFile(await (await downloading).path()));
        const field = saved.getForm().getField('Group.Value');
        const stream = saved.context.lookup(field.acroField.getWidgets()[0].getNormalAppearance());
        const operators = new TextDecoder().decode(decodePDFRawStream(stream).decode());
        expect(operators).toContain('0.7 0.1 0.2 rg');
        expect(operators).toMatch(/\/[^\s]+ 12 Tf/);
        await checkStyle();
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(onPage).toHaveValue('Original');
        await checkStyle();
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect(onPage).toHaveValue('Changed');
        await checkStyle();
        await open(saved);
        await expect(onPage).toHaveValue('Changed');
        await checkStyle();
      });
