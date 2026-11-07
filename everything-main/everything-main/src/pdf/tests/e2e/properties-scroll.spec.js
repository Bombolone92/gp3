import { test, expect } from '@playwright/test';
import { PDFDocument, rgb } from 'pdf-lib';

for (const viewport of [
  { width: 1280, height: 500 },
  { width: 390, height: 600 },
])
  test.describe(`properties scrolling at ${viewport.width}px`, () => {
    test.use({ viewport });
    for (const action of ['numeric', 'button'])
      test(`${action} edits keep the focused property visible`, async ({ page }) => {
        await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
        await page.goto('/#library');
        const doc = await PDFDocument.create();
        doc.addPage([400, 500]).drawRectangle({
          x: 120,
          y: 180,
          width: 100,
          height: 100,
          color: rgb(0.8, 0.2, 0.2),
          borderColor: rgb(0.1, 0.1, 0.1),
          borderWidth: 2,
        });
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: /Open a PDF/ }).click();
        await (
          await chooser
        ).setFiles({
          name: 'properties.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await doc.save()),
        });
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        await page.getByRole('button', { name: 'Select shape 1', exact: true }).press('Enter');
        const angle = page.getByLabel('Shape rotation in degrees', { exact: true });
        let destination;
        if (action === 'numeric') {
          await angle.click();
          await angle.fill('45');
          destination = page.getByLabel('Shape stroke width in points', { exact: true });
          await angle.press('Shift+Tab');
        } else {
          destination = page.getByRole('button', {
            name: 'Rotate shape clockwise 90 degrees',
            exact: true,
          });
          await destination.click();
        }
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        await expect(angle).toHaveValue(action === 'numeric' ? '45' : '90');
        await expect(destination).toBeFocused();
        await expect(destination).toBeInViewport({ ratio: 1 });
        await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
        // Closing and opening a panel still starts its controls at the top.
        await page.getByRole('button', { name: 'Close shape editor', exact: true }).click();
        await expect(page.getByRole('group', { name: 'Edit shape', exact: true })).toHaveCount(0);
        await page.getByRole('button', { name: 'Select shape 1', exact: true }).press('Enter');
        await expect(page.getByRole('group', { name: 'Edit shape', exact: true })).toBeVisible();
        expect(await page.locator('.properties-content').evaluate((node) => node.scrollTop)).toBe(
          0,
        );
      });
  });
