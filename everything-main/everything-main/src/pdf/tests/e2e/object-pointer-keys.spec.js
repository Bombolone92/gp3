import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

for (const kind of ['image', 'shape'])
  for (const action of ['move', 'resize'])
    for (const ending of ['release', 'Escape'])
      test(`arrow keys keep a ${kind} pointer ${action} active until ${ending}`, async ({
        page,
      }) => {
        await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
        await page.goto('/#library');
        const doc = await PDFDocument.create();
        const sheet = doc.addPage([500, 600]);
        if (kind === 'image') {
          const image = await doc.embedPng(
            Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=',
              'base64',
            ),
          );
          sheet.drawImage(image, { x: 100, y: 300, width: 80, height: 60 });
        } else sheet.drawRectangle({ x: 100, y: 300, width: 80, height: 60 });
        const chooser = page.waitForEvent('filechooser');
        await page.keyboard.press('ControlOrMeta+o');
        await (
          await chooser
        ).setFiles({
          name: 'pointer-keys.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await doc.save()),
        });
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
        const target = page.getByRole('button', { name: `Select ${kind} 1`, exact: true });
        const targetFrame = () => target.evaluate((node) => node.getAttribute('style'));
        const initialTarget = await targetFrame();
        await target.press('Enter');
        const move = page.getByRole('button', { name: `Move selected ${kind}`, exact: true });
        await expect(move).toBeFocused();
        const handle = action === 'move' ? move : page.locator('.image-resize').nth(2);
        const box = await handle.boundingBox();
        const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + 20, start.y + 10, { steps: 3 });
        await expect(page.locator('.image-preview')).toBeVisible();
        const frame = () => move.evaluate((node) => node.getAttribute('style'));
        const beforeKey = await frame();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Shift+ArrowDown');
        // Cover the keyboard commit timer while the pointer still owns the gesture.
        await page.waitForTimeout(300);
        expect(await frame()).toBe(beforeKey);
        await page.mouse.move(start.x + 40, start.y + 20, { steps: 3 });
        await expect.poll(frame).not.toBe(beforeKey);
        if (ending === 'Escape') await page.keyboard.press('Escape');
        await page.mouse.up();
        await expect(page.locator('.image-preview')).toBeHidden();
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        if (ending === 'Escape') {
          expect(await targetFrame()).toBe(initialTarget);
          await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
          return;
        }
        await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
        await expect(move).toBeEnabled();
        const final = await frame();
        const finalTarget = await targetFrame();
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
        await expect.poll(targetFrame).toBe(initialTarget);
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect.poll(targetFrame).toBe(finalTarget);
        await expect(target).toBeEnabled();
        await target.press('Enter');
        expect(await frame()).toBe(final);
      });
