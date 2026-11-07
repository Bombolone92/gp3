import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('locked saved contents paint identically to unwrapped contents while remaining read-only', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const renders = [];
  for (const variant of ['unwrapped', 'locked']) {
    await page.goto('/playground.html');
    const source = `public/fixtures/control-preview-${variant}.docx`;
    await page.getByLabel('Open DOCX file').setInputFiles(source);
    const input = page.getByRole('textbox', { name: 'Document text' });
    await expect(input).toHaveValue(/Following paragraph\./);
    const canvas = page.locator('canvas.canvas-page');
    await expect(canvas).toHaveCount(1);
    // Wait for the blue picture to be decoded and painted, not just text layout.
    await expect.poll(() => canvas.evaluate(c => {
      const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let count = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 32 && pixels[i + 1] === 128 && pixels[i + 2] === 192) count++;
      return count;
    })).toBeGreaterThan(1000);
    await input.blur();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    renders.push(await canvas.evaluate(c => c.toDataURL()));
    if (variant === 'locked') {
      await expect(input).toHaveAttribute('readonly');
      const original = await input.inputValue();
      await input.focus(); await page.keyboard.type('Must not edit'); await expect(input).toHaveValue(original);
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
      const path = testInfo.outputPath('control-preview-locked.docx');
      await (await download).saveAs(path);
      expect(readFileSync(path).equals(readFileSync(source))).toBe(true);
    }
  }
  expect(renders[1]).toBe(renders[0]);
  expect(errors).toEqual([]);
});
