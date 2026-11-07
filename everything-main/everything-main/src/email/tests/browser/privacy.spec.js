import { test, expect } from '@playwright/test';

for (const sender of ['constructor', '__proto__', 'newsletter@example.com']) {
  test(`remote images require consent for sender ${sender}`, async ({ page }) => {
    const requests = [];
    await page.route('https://tracker.example/**', (route) => {
      requests.push(route.request().url());
      return route.fulfill({ contentType: 'image/png', body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=', 'base64') });
    });
    await page.goto(`/tests/browser/privacy.html?sender=${encodeURIComponent(sender)}`);
    await page.locator('.row').filter({ hasText: 'Remote image consent test' }).click();
    await page.getByRole('button', { name: 'Show original formatting', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Show images', exact: true })).toBeVisible();
    const frame = page.frameLocator('.msg-frame');
    await expect(frame.locator('body')).toContainText('A newsletter');
    expect(requests).toEqual([]);
    await page.getByRole('button', { name: 'Show images', exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
  });
}
