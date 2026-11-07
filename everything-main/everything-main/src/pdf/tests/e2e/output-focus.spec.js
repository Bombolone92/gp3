import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

for (const action of ['Download', 'Save to Puter'])
  for (const moveFocus of [false, true])
    test(`${action} preserves keyboard focus after saving a form draft (move focus=${moveFocus})`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) =>
        route.fulfill({
          body: `window.puter = {
            env: 'web',
            auth: { isSignedIn: () => true, getUser: async () => ({ username: 'test-user' }) },
            fs: {
              readdir: async () => [],
              write: async (path, blob) => {
                window.savedOutput = [...new Uint8Array(await blob.arrayBuffer())];
                return { path };
              }
            },
            ui: { onLaunchedWithItems() {}, onItemsOpened() {} }
          };`,
        }),
      );
      const doc = await PDFDocument.create();
      const sheet = doc.addPage([400, 500]);
      const field = doc.getForm().createTextField('Response');
      field.setText('Original');
      field.addToPage(sheet, { x: 40, y: 300, width: 300, height: 40 });
      await page.goto('/#library');
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press('ControlOrMeta+o');
      await (
        await chooser
      ).setFiles({
        name: 'focus.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await doc.save()),
      });
      await page.getByLabel('Response (on page)', { exact: true }).fill('Reviewed response');
      // Hold the form commit so focus can move while an output operation is pending.
      await page.evaluate(async () => {
        const { blankPdf, validatePdf } = await import('/src/core/document.js');
        const prototype = Object.getPrototypeOf(await validatePdf(await blankPdf()));
        const save = prototype.save;
        prototype.save = async function (...args) {
          prototype.save = save;
          const bytes = await save.apply(this, args);
          await new Promise((resolve) => {
            window.releaseOutput = resolve;
          });
          return bytes;
        };
      });
      const button = page.getByRole('button', {
        name: action === 'Download' ? 'Download' : /^Save(?: to Puter)?$/,
        exact: true,
      });
      const settings = page.getByRole('button', { name: 'Settings', exact: true });
      await button.focus();
      const pending = action === 'Download' ? page.waitForEvent('download') : null;
      await button.press('Enter');
      await expect.poll(() => page.evaluate(() => Boolean(window.releaseOutput))).toBe(true);
      await expect(button).toBeDisabled();
      if (moveFocus) await settings.focus();
      await page.evaluate(() => window.releaseOutput());
      let bytes;
      if (pending) bytes = await readFile(await (await pending).path());
      else {
        await expect(page.locator('.save-status')).toHaveText('Saved to Puter');
        bytes = new Uint8Array(await page.evaluate(() => window.savedOutput));
      }
      await expect(button).toBeEnabled();
      await expect(moveFocus ? settings : button).toBeFocused();
      const saved = await PDFDocument.load(bytes);
      expect(saved.getForm().getTextField('Response').getText()).toBe('Reviewed response');
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.getByLabel('Response (on page)', { exact: true })).toHaveValue('Original');
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(page.getByLabel('Response (on page)', { exact: true })).toHaveValue(
        'Reviewed response',
      );
    });
