import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName, PDFBool } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { malformedAppearancePdf } from '../fixtures/malformed-appearance.js';
import { rendered } from '../helpers/list-render.js';

for (const kind of ['text', 'dropdown', 'checkbox', 'radio', 'button'])
  for (const location of ['field', 'widget'])
    for (const action of kind === 'button' ? ['flatten'] : ['edit', 'flatten'])
      test(`${action} remains responsive with a malformed ${kind} ${location} appearance`, async ({
        page,
      }) => {
        await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
        await page.goto('/#library');
        const { doc } = await malformedAppearancePdf({ kind, location });
        if (action === 'flatten')
          doc.getForm().acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
        const opening = page.waitForEvent('filechooser');
        await page.keyboard.press('ControlOrMeta+o');
        await (
          await opening
        ).setFiles({
          name: 'malformed-appearance.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await doc.save({ updateFieldAppearances: false })),
        });
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        if (action === 'edit') {
          await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
          const dialog = page.getByRole('dialog', { name: 'Fill forms' });
          const control = dialog.getByLabel('Value', { exact: true });
          if (kind === 'text') await control.fill('Changed');
          else if (kind === 'checkbox') await control.uncheck();
          else await control.selectOption(kind === 'radio' ? 'No' : 'Changed');
          await dialog.getByRole('button', { name: 'Save form', exact: true }).click();
          await expect(dialog).toHaveCount(0);
        } else {
          const bar = page.getByRole('menubar', { name: 'PDF menus' });
          if (await bar.isVisible())
            await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
          else await page.getByRole('button', { name: 'Menu', exact: true }).click();
          await page
            .getByRole('menu')
            .getByRole('menuitem', { name: 'Flatten…', exact: true })
            .click();
          const dialog = page.getByRole('dialog', { name: 'Flatten', exact: true });
          await dialog.getByRole('button', { name: 'Flatten', exact: true }).click();
          await expect(dialog).toHaveCount(0);
        }
        const downloading = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        const bytes = new Uint8Array(await readFile(await (await downloading).path()));
        const saved = await PDFDocument.load(bytes);
        if (action === 'flatten') {
          expect(saved.getForm().getFields()).toHaveLength(0);
          const output = await rendered(bytes);
          if (kind === 'text' || kind === 'dropdown')
            expect(output.lines.join('')).toContain('Original');
          if (kind === 'button') expect(output.lines.join('')).toContain('Submit');
        } else {
          const field = saved.getForm().getField('Value');
          if (kind === 'text') expect(field.getText()).toBe('Changed');
          else if (kind === 'checkbox') expect(field.isChecked()).toBe(false);
          else expect(field.getSelected()).toEqual(kind === 'radio' ? 'No' : ['Changed']);
        }
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      });
