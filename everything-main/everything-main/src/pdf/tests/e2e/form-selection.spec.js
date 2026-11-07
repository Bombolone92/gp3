import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
for (const multiline of [false, true])
  for (const action of ['resize', 'commit'])
    for (const direction of ['backward', 'forward'])
      test(`${direction} selection survives ${action} (multiline=${multiline})`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 1000, height: 800 });
        await page.route('https://js.puter.com/**', (r) => r.fulfill({ body: '' }));
        await page.goto('/#library');
        const doc = await PDFDocument.create();
        const sheet = doc.addPage([600, 800]);
        const field = doc.getForm().createTextField('Response');
        if (multiline) field.enableMultiline();
        field.addToPage(sheet, { x: 40, y: 300, width: 300, height: 70 });
        const chooser = page.waitForEvent('filechooser');
        await page.keyboard.press('ControlOrMeta+o');
        await (
          await chooser
        ).setFiles({
          name: 'form.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await doc.save()),
        });
        const input = page.getByLabel('Response (on page)', { exact: true });
        await input.fill('Keyboard selection');
        if (direction === 'forward') for (let i = 0; i < 3; i++) await input.press('ArrowLeft');
        for (let i = 0; i < 3; i++)
          await input.press(direction === 'backward' ? 'Shift+ArrowLeft' : 'Shift+ArrowRight');
        const state = () =>
          input.evaluate((node) => ({
            start: node.selectionStart,
            end: node.selectionEnd,
            direction: node.selectionDirection,
          }));
        const before = await state();
        expect(before.direction).toBe(direction);
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
        expect(await state()).toEqual(before);
        await page.keyboard.press(
          direction === 'backward' ? 'Shift+ArrowRight' : 'Shift+ArrowLeft',
        );
        const expected = {
          ...before,
          ...(direction === 'backward' ? { start: before.start + 1 } : { end: before.end - 1 }),
        };
        expect(await state()).toEqual(expected);
        await page.keyboard.type('X');
        const text = 'Keyboard selection';
        await expect(input).toHaveValue(
          text.slice(0, expected.start) + 'X' + text.slice(expected.end),
        );
      });
