import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function open(page, bytes) {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (
    await chooser
  ).setFiles({
    name: 'checkpoint-focus.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
  await page.locator('.text-target').click();
}

for (const action of ['move', 'resize'])
  for (const moved of [false, true])
    test(`text ${action} checkpoint ${moved ? 'preserves newer focus' : 'restores handle focus'}`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const doc = await PDFDocument.create();
      doc
        .addPage([500, 500])
        .drawText('One two three\nfour five.', { x: 40, y: 400, size: 18, lineHeight: 22 });
      await open(page, await doc.save());
      const input = page.getByRole('textbox', { name: 'Edit text', exact: true });
      await expect(input).toHaveClass(/has-text-preview/);
      const field = page.getByLabel(
        action === 'move' ? 'Text X in points' : 'Paragraph width in points',
        { exact: true },
      );
      const before = Number(await field.inputValue());
      const handle = page.getByRole('button', {
        name: action === 'move' ? 'Move text' : 'Resize paragraph width',
        exact: true,
      });
      await handle.focus();
      await page.evaluate(async () => {
        const { blankPdf, validatePdf } = await import('/src/core/document.js');
        const prototype = Object.getPrototypeOf(await validatePdf(await blankPdf()));
        const save = prototype.save;
        prototype.save = async function (...args) {
          prototype.save = save;
          const bytes = await save.apply(this, args);
          await new Promise((resolve) => {
            window.releaseCheckpoint = resolve;
          });
          return bytes;
        };
      });
      await handle.press('Shift+ArrowRight');
      await expect.poll(() => page.evaluate(() => !!window.releaseCheckpoint)).toBe(true);
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'true');
      const settings = page.getByRole('button', { name: 'Settings', exact: true });
      if (moved) {
        await settings.focus();
        await settings.evaluate((button) => {
          window.newerFocusLost = false;
          button.addEventListener(
            'blur',
            () => {
              window.newerFocusLost = true;
            },
            { once: true },
          );
        });
      }
      await page.evaluate(() => window.releaseCheckpoint());
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      await expect(field).toHaveValue(String(before + 10));
      await expect(input).toHaveAttribute('aria-readonly', 'true');
      await expect(moved ? settings : handle).toBeFocused();
      if (moved) expect(await page.evaluate(() => window.newerFocusLost)).toBe(false);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      await page.locator('.text-target').click();
      await expect(field).toHaveValue(String(before));
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await page.locator('.text-target').click();
      await expect(field).toHaveValue(String(before + 10));
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const bytes = await readFile(await (await pending).path());
      await open(page, bytes);
      await expect(field).toHaveValue(String(before + 10));
      expect(await input.evaluate((element) => element.value.replace(/\s+/g, ' ').trim())).toBe(
        'One two three four five.',
      );
    });
