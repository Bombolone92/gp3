import { expect } from '@playwright/test';

export async function reopenDocx(page, input, path, text, options = {}) {
  // A round trip has identical text in both views. Wait for the old input to
  // detach before asserting content or dispatching selection into the new one.
  const previous = await input.elementHandle();
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Open DOCX file').setInputFiles(path);
  await expect.poll(() => previous.evaluate(el => el.isConnected), options).toBe(false);
  await previous.dispose();
  await expect(input).toHaveValue(text, options);
}
