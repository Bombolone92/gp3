import { test, expect } from '@playwright/test';

const input = page => page.getByRole('textbox', { name: 'Document text' });
const runs = page => page.evaluate(() => window.__docs.current.view.engine.model.paragraphs[0].runs.map(r => [r.text, !!r.link, r.color, r.underlineStyle]));
async function link(page, address) {
  await input(page).press('ControlOrMeta+k');
  await page.getByLabel('Link address', { exact: true }).fill(address);
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click();
}

test('a new link is blue and underlined, and typing after it continues as plain text', async ({ page }) => {
  await page.goto('/mock.html#/new');
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
  await input(page).fill('Read the guide. See ');
  await input(page).evaluate(el => { el.setSelectionRange(9, 14); el.dispatchEvent(new Event('select')); });
  await link(page, 'https://example.com/guide');
  await input(page).press('ControlOrMeta+End');
  await link(page, 'https://example.com');
  await page.keyboard.type(' too');
  expect(await runs(page)).toEqual([
    ['Read the ', false, 'auto', 'none'], ['guide', true, '0563C1', 'single'], ['. See ', false, 'auto', 'none'],
    ['https://example.com', true, '0563C1', 'single'], [' too', false, 'auto', 'none']]);
  // Changing where a link goes keeps the way it looks.
  await input(page).evaluate(el => { el.setSelectionRange(10, 10); el.dispatchEvent(new Event('select')); });
  await link(page, 'https://example.org/');
  expect((await runs(page))[1]).toEqual(['guide', true, '0563C1', 'single']);
  // Creating a link and its look is one undo step.
  // Undo the address change, then " too" (two word steps), then the inserted link.
  for (let i = 0; i < 3; i++) await input(page).press('ControlOrMeta+z');
  await expect(input(page)).toHaveValue('Read the guide. See https://example.com');
  await input(page).press('ControlOrMeta+z');
  await expect(input(page)).toHaveValue('Read the guide. See ');
  expect(await runs(page)).toEqual([['Read the ', false, 'auto', 'none'], ['guide', true, '0563C1', 'single'], ['. See ', false, 'auto', 'none']]);
  await input(page).press('ControlOrMeta+z');
  expect(await runs(page)).toEqual([['Read the guide. See ', false, 'auto', 'none']]);
});

test('links pasted or imported without their own color look like links', async ({ page }) => {
  await page.goto('/mock.html#/new');
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
  await input(page).evaluate(el => {
    el.focus(); const data = new DataTransfer(); data.setData('text/html', '<p>Visit <a href="https://example.com/">the site</a> now</p>'); data.setData('text/plain', 'Visit the site now');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  expect(await runs(page)).toEqual([['Visit ', false, 'auto', 'none'], ['the site', true, '0563C1', 'single'], [' now', false, 'auto', 'none']]);
});
