import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { passwordFormPdf } from '../fixtures/password-form.js';
import { paintedText } from '../helpers/painted-text.js';

for (const inherited of [false, true])
  for (const readOnly of [false, true])
    test(`import masks existing password appearances (inherited=${inherited}, readOnly=${readOnly})`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript(() => {
        // Capture text from every render buffer, including thumbnails and print canvases.
        const fillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
          window.paintedText = (window.paintedText || '') + text;
          return fillText.call(this, text, ...args);
        };
        window.printed = false;
        window.print = () => {
          window.printed = !!document.querySelector('.print-sheet img')?.naturalWidth;
          window.dispatchEvent(new Event('afterprint'));
        };
      });
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const { doc } = await passwordFormPdf({ inherited, readOnly });
      const opening = page.waitForEvent('filechooser');
      await page.keyboard.press('ControlOrMeta+o');
      await (
        await opening
      ).setFiles({
        name: 'password.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await doc.save()),
      });
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      await page.screenshot({ path: testInfo.outputPath('import.png') });
      const checkPaint = async () => {
        const painted = await page.evaluate(() => window.paintedText);
        expect(painted).toContain('Original name');
        expect(painted).not.toContain('Example passphrase');
        expect(painted).toContain('*'.repeat('Example passphrase'.length));
      };
      await checkPaint();
      const suffix = readOnly ? ' (read only)' : '';
      const onPage = page.getByLabel(`Account.Secret (on page)${suffix}`, { exact: true });
      await expect(onPage).toHaveAttribute('type', 'password');
      await expect(onPage).toHaveValue('Example passphrase');
      if (readOnly) await expect(onPage).toBeDisabled();
      else {
        await onPage.focus();
        await onPage.blur();
      }
      await page.getByRole('button', { name: 'Text', exact: true }).click();
      await expect(onPage).toBeHidden();
      await checkPaint();
      await page.getByRole('button', { name: 'Select', exact: true }).click();

      // An immediate download retains the field data but only paints its mask.
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const bytes = new Uint8Array(await readFile(await (await downloading).path()));
      expect(await paintedText(bytes)).not.toContain('Example passphrase');
      const saved = (await PDFDocument.load(bytes)).getForm().getTextField('Account.Secret');
      expect(saved.getText()).toBe('Example passphrase');
      expect(saved.isPassword()).toBe(true);
      expect(saved.isReadOnly()).toBe(readOnly);

      // Undo must return to the normalized import, never to its original clear-text drawing.
      await page.getByRole('button', { name: 'Fill forms', exact: true }).click();
      const form = page.getByRole('dialog', { name: 'Fill forms' });
      await form.getByLabel('Name', { exact: true }).fill('Updated name');
      await form.getByRole('button', { name: 'Save form', exact: true }).click();
      await expect(form).toHaveCount(0);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.getByLabel('Name (on page)', { exact: true })).toHaveValue('Original name');
      await checkPaint();
      await page.keyboard.press('ControlOrMeta+p');
      await page
        .getByRole('dialog', { name: 'Print', exact: true })
        .getByRole('button', { name: 'Print', exact: true })
        .click();
      await expect.poll(() => page.evaluate(() => window.printed)).toBe(true);
      await checkPaint();
    });

for (const kind of ['unreadable neighbor', 'malformed widget', 'ordinary damaged form'])
  test(`import still opens a PDF with an ${kind}`, async ({ page }) => {
    await page.addInitScript(() => {
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        window.paintedText = (window.paintedText || '') + text;
        return fillText.call(this, text, ...args);
      };
    });
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/#library');
    const { doc, secret } = await passwordFormPdf();
    if (kind === 'ordinary damaged form') secret.disablePassword();
    if (kind === 'malformed widget') secret.acroField.Kids().push(PDFString.of('invalid'));
    else
      doc
        .getForm()
        .getTextField('Name')
        .acroField.dict.set(PDFName.of('FT'), PDFString.of('invalid'));
    const original = Buffer.from(await doc.save({ updateFieldAppearances: false }));
    const opening = page.waitForEvent('filechooser');
    await page.keyboard.press('ControlOrMeta+o');
    await (
      await opening
    ).setFiles({ name: 'damaged-form.pdf', mimeType: 'application/pdf', buffer: original });
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.paper')).toBeVisible();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const bytes = await readFile(await (await downloading).path());
    if (kind === 'ordinary damaged form') expect(bytes.equals(original)).toBe(true);
    else {
      const painted = await page.evaluate(() => window.paintedText);
      expect(painted).toContain('*'.repeat(18));
      expect(painted).not.toContain('Example passphrase');
      expect(await paintedText(new Uint8Array(bytes))).not.toContain('Example passphrase');
    }
  });
