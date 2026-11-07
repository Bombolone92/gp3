import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { inspectImages } from '../../src/core/image-edit.js';
import { inspectPaths } from '../../src/core/path-edit.js';

for (const width of [390, 850])
  for (const kind of ['image', 'shape'])
    for (const action of ['resize', 'move'])
      test(`${kind} ${action} preserves fit-page geometry while its ${width}px properties dock stays open`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
        await page.goto('/#library');
        const doc = await PDFDocument.create();
        const sheet = doc.addPage([600, 800]);
        if (kind === 'image') {
          const image = await doc.embedPng(
            Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=',
              'base64',
            ),
          );
          sheet.drawImage(image, { x: 100, y: 400, width: 80, height: 60 });
        } else sheet.drawRectangle({ x: 100, y: 400, width: 80, height: 60 });
        const chooser = page.waitForEvent('filechooser');
        await page.keyboard.press('ControlOrMeta+o');
        await (
          await chooser
        ).setFiles({
          name: 'object-fit.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await doc.save()),
        });
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
        const paper = page.locator('.paper');
        await expect(paper).toHaveAttribute('aria-busy', 'false');
        await page.getByLabel('Zoom', { exact: true }).selectOption('page');
        await expect(paper).toHaveAttribute('aria-busy', 'false');
        const target = page.getByRole('button', { name: `Select ${kind} 1`, exact: true });
        await target.press('Enter');
        const input = page.getByLabel(`${kind === 'image' ? 'Image' : 'Shape'} width in points`, {
          exact: true,
        });
        await expect(input).toHaveValue('80');
        // The dock resize observer must have settled before recording the selection's geometry.
        await page.waitForTimeout(300);
        const before = await paper.boundingBox();
        const originalTarget = await target.getAttribute('style');
        if (action === 'resize') {
          await input.fill('120');
          await input.press('Tab');
          await expect(input).toHaveValue('120');
          await expect(input).toBeEnabled();
        } else {
          await page
            .getByRole('button', { name: `Move selected ${kind}`, exact: true })
            .press('ArrowRight');
        }
        await expect.poll(() => target.getAttribute('style')).not.toBe(originalTarget);
        await expect(page.locator('.image-preview')).toBeHidden();
        await expect(target).toBeEnabled();
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        await expect(page.getByRole('group', { name: `Edit ${kind}`, exact: true })).toBeVisible();
        const after = await paper.boundingBox();
        expect(after.width).toBeCloseTo(before.width, 0);
        expect(after.height).toBeCloseTo(before.height, 0);
        expect(after.x).toBeCloseTo(before.x, 0);
        expect(after.y).toBeCloseTo(before.y, 0);
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        const exported = await PDFDocument.load(await readFile(await (await pending).path()));
        const [object] = (kind === 'image' ? inspectImages : inspectPaths)(exported, 0);
        const expected = action === 'resize' ? [120, 0, 0, 90, 100, 370] : [80, 0, 0, 60, 101, 400];
        object.transform.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 5));
        await page.getByRole('button', { name: `Close ${kind} editor`, exact: true }).click();
        await expect(page.getByRole('group', { name: `Edit ${kind}`, exact: true })).toHaveCount(0);
        // After deselection, fit-page still responds to the available workspace.
        await page.setViewportSize({ width, height: 644 });
        await expect
          .poll(async () => (await paper.boundingBox())?.height)
          .toBeLessThan(before.height);
      });

for (const key of ['=', '2'])
  test(`zoom shortcut ${key} received during an object commit overrides the retained fit-page scale`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 850, height: 844 });
    await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto('/#library');
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]).drawRectangle({ x: 100, y: 400, width: 80, height: 60 });
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('ControlOrMeta+o');
    await (
      await chooser
    ).setFiles({
      name: 'object-zoom.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    });
    await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
    const paper = page.locator('.paper');
    await expect(paper).toHaveAttribute('aria-busy', 'false');
    await page.getByLabel('Zoom', { exact: true }).selectOption('page');
    await expect.poll(async () => (await paper.boundingBox())?.width).toBeLessThan(500);
    await page.getByRole('button', { name: 'Select shape 1', exact: true }).press('Enter');
    await expect(
      page.getByRole('button', { name: 'Move selected shape', exact: true }),
    ).toBeFocused();
    const before = (await paper.boundingBox()).width;
    await page.evaluate(async () => {
      const { PdfSession } = await import('/src/core/document.js');
      const change = PdfSession.prototype.change;
      PdfSession.prototype.change = async function (...args) {
        PdfSession.prototype.change = change;
        await new Promise((resolve) => {
          window.releaseFitCommit = resolve;
        });
        return change.apply(this, args);
      };
      window.fitFrames = { running: true, widths: [] };
      const sample = () => {
        if (!window.fitFrames.running) return;
        window.fitFrames.widths.push(
          document.querySelector('.paper').getBoundingClientRect().width,
        );
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const input = page.getByLabel('Shape width in points', { exact: true });
    await input.fill('120');
    await input.press('Tab');
    await expect.poll(() => page.evaluate(() => !!window.releaseFitCommit)).toBe(true);
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press(`ControlOrMeta+${key}`);
    await page.evaluate(() => window.releaseFitCommit());
    await expect(input).toHaveValue('120');
    await expect(input).toBeEnabled();
    // The next fixed zoom level above the fitted page's scale, or fit width.
    const above = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5].find(
      (level) => level > (before / 600) * 1.01,
    );
    await expect(page.getByLabel('Zoom', { exact: true })).toHaveValue(
      key === '=' ? String(above) : 'fit',
    );
    const expected =
      key === '='
        ? above * 600
        : await page
            .locator('.workspace')
            .evaluate((node) => Math.min(1.5, (node.clientWidth - 120) / 600) * 600);
    await expect.poll(async () => (await paper.boundingBox())?.width).toBeCloseTo(expected, 0);
    const widths = await page.evaluate(() => {
      window.fitFrames.running = false;
      return window.fitFrames.widths;
    });
    expect(widths.length).toBeGreaterThan(1);
    expect(
      widths.filter((width) => Math.abs(width - before) > 0.5 && Math.abs(width - expected) > 0.5),
    ).toEqual([]);
  });
