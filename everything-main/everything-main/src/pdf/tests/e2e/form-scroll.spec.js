import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

for (const multiline of [false, true])
  for (const action of ['resize', 'commit'])
    test(`the view inside a long ${multiline ? 'multiline' : 'single-line'} form field survives ${action}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1000, height: 800 });
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/#library');
      const doc = await PDFDocument.create();
      const sheet = doc.addPage([600, 800]);
      const field = doc.getForm().createTextField('Response');
      if (multiline) field.enableMultiline();
      field.addToPage(sheet, { x: 40, y: 300, width: 300, height: 70 });
      field.setFontSize(12);
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press('ControlOrMeta+o');
      await (
        await chooser
      ).setFiles({
        name: 'form-scroll.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await doc.save()),
      });
      const input = page.getByLabel('Response (on page)', { exact: true });
      const text = multiline
        ? Array.from({ length: 40 }, (_, i) => `Line ${i + 1} content`).join('\n')
        : 'Long form response '.repeat(30);
      await input.fill(text);
      for (let i = 0; i < (multiline ? 20 : 40); i++)
        await input.press(multiline ? 'ArrowUp' : 'ArrowLeft');
      const state = () =>
        input.evaluate((node) => ({
          top: node.scrollTop,
          left: node.scrollLeft,
          start: node.selectionStart,
          end: node.selectionEnd,
        }));
      const before = await state();
      expect(multiline ? before.top : before.left).toBeGreaterThan(0);
      if (action === 'resize') {
        const width = (await page.locator('.paper').boundingBox()).width;
        await page.setViewportSize({ width: 850, height: 800 });
        await expect
          .poll(async () => (await page.locator('.paper').boundingBox())?.width || Infinity)
          .toBeLessThan(width);
      } else await input.press(multiline ? 'ControlOrMeta+Enter' : 'Enter');
      await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
      await expect(page.locator('.paper')).toHaveAttribute('aria-busy', 'false');
      await expect(input).toBeFocused();
      // Let native focus/selection scrolling finish before checking the visible field contents.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const after = await state();
      expect(after.start).toBe(before.start);
      expect(after.end).toBe(before.end);
      expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(1);
      await page.keyboard.type('X');
      const expected = text.slice(0, before.start) + 'X' + text.slice(before.end);
      await expect(input).toHaveValue(expected);
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const saved = await PDFDocument.load(await readFile(await (await pending).path()));
      expect(saved.getForm().getTextField('Response').getText()).toBe(expected);
    });
