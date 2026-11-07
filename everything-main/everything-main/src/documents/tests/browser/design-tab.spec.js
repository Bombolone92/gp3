import { test, expect } from '@playwright/test';
import { onTab, downloadDocx, showAllTools } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';

test('Paragraph Spacing presets restyle Normal paragraphs in one step and survive saving', async ({ page }, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' });
  await input.fill('One\nTwo\nThree');
  await showAllTools(page);
  const spacing = page.getByRole('combobox', { name: 'Line spacing' });
  const after = page.getByRole('spinbutton', { name: 'Space after paragraph (pt)', includeHidden: true });
  const choose = async name => {
    await (await onTab(page, 'design')).locator('.ribbon-card').getByRole('button', { name: 'Paragraph Spacing' }).click();
    await page.getByRole('menu', { name: 'Paragraph Spacing' }).getByRole(name === 'Style Set Default' ? 'menuitem' : 'menuitemradio', { name: new RegExp(`^${name}`) }).click();
  };
  await choose('Tight');
  await expect(spacing).toHaveValue('1.15');
  await expect(after).toHaveValue('6');
  await expect(input).toBeFocused();
  await (await onTab(page, 'design')).locator('.ribbon-card').getByRole('button', { name: 'Paragraph Spacing' }).click();
  await expect(page.getByRole('menuitemradio', { name: /^Tight/ })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await choose('Double');
  await expect(spacing).toHaveValue('2');
  await input.press('ControlOrMeta+z');
  await expect(spacing).toHaveValue('1.15');
  const path = info.outputPath('paragraph-spacing.docx');
  const download = page.waitForEvent('download'); await downloadDocx(page); await (await download).saveAs(path);
  await reopenDocx(page, input, path, 'One\nTwo\nThree');
  await expect(spacing).toHaveValue('1.15');
  await choose('Style Set Default');
  await expect(spacing).toHaveValue('1');
  expect(errors).toEqual([]);
});
