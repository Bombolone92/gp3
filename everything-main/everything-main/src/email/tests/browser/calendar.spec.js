import { test, expect } from '@playwright/test';

test('invitation appears above the body, survives formatting changes, and downloads', async ({ page }) => {
  await page.goto('/tests/browser/calendar.html');
  await page.locator('.row').click();
  const card = page.getByRole('region', { name: 'Calendar invitation: Product design review' });
  await expect(card).toBeVisible();
  await expect(page.locator('.calendar-invite')).toHaveCount(1);
  await expect(card).toContainText('America/Vancouver');
  await expect(card).toContainText('Studio 2, Vancouver');
  await expect(card).toContainText('Ana Petrova <ana@example.com>');
  expect(await page.locator('.msg-full').evaluate((node) => node.firstElementChild.className)).toBe('calendar-invite');
  await expect(page.locator('.msg-body')).toContainText('See you on Monday!');
  await card.getByText('2 guests', { exact: true }).click();
  await expect(card).toContainText('Mira Chen');
  await page.getByRole('button', { name: 'Show original formatting', exact: true }).click();
  await expect(card).toBeVisible();
  await expect(page.locator('.msg-html iframe')).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Download invite', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('invite.ics');
  const stream = await download.createReadStream();
  let content = '';
  for await (const chunk of stream) content += chunk.toString();
  expect(content).toContain('BEGIN:VCALENDAR');
  expect(content).toContain('UID:review@example.com');
});

test('mobile cancellation stays within the reader in dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/browser/calendar.html?dark&cancel');
  await page.locator('.row').click();
  const card = page.locator('.calendar-invite');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Event cancelled');
  await expect(card.getByRole('link', { name: 'Join meeting' })).toHaveCount(0);
  expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  const bounds = await card.boundingBox();
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
});
