import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { downloadDocx } from './helpers/editor-tools.js';

for (const [name, expected] of [['hidden', '1\n\n3\n\n4\n\n11'], ['formatted', '1\nii\n3\n4']]) {
  test(`F9 refresh, undo and reopen for ${name} SEQ fields`, async ({ page }, info) => {
    test.setTimeout(90000);
    page.on('dialog', async dialog => {
      expect(dialog.type()).toBe('confirm');
      await dialog.accept();
    });
    const file = `tests/fixtures/sequence-hidden/${name}.docx`;
    await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
    const input = page.getByRole('textbox', { name: 'Document text' });
    const previous = await input.elementHandle();
    await page.getByLabel('Open DOCX file').setInputFiles(file);
    await expect.poll(() => previous.evaluate(el => el.isConnected)).toBe(false);
    await expect(input).toHaveJSProperty('readOnly', false);
    const original = await input.inputValue();
    expect(original.split('\n').every(t => t === 'stale')).toBe(true);
    await input.press('F9'); await expect(input).toHaveValue(expected);
    const download = page.waitForEvent('download'); await downloadDocx(page);
    const saved = info.outputPath('updated.docx'); await (await download).saveAs(saved);
    await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
    const undoneDownload = page.waitForEvent('download'); await downloadDocx(page);
    expect(unzipSync(readFileSync(await (await undoneDownload).path()))).toEqual(unzipSync(readFileSync(file)));
    const old = await input.elementHandle();
    await page.getByLabel('Open DOCX file').setInputFiles(saved);
    await expect.poll(() => old.evaluate(el => el.isConnected)).toBe(false);
    await expect(input).toHaveValue(expected);
    await input.press('F9'); await expect(input).toHaveValue(expected);
    await expect(page.locator('.canvas-message-error')).toHaveCount(0);
    await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  });
}
