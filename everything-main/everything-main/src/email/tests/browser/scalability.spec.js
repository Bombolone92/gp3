import { test, expect } from '@playwright/test';

const search = async (page, value) => {
  await page.locator('.search-input').fill(value);
  await page.locator('.search-input').dispatchEvent('search');
};

test('10k broad search has complete counts, bounded pages and reader navigation across pages', async ({ page }) => {
  await page.goto('/benchmarks/mailbox.html?n=10000&latency=0');
  await expect(page.locator('.row')).toHaveCount(60);
  await search(page, 'subject:Message');
  await expect(page.locator('.list-meta')).toHaveText('9990 results in 10000 messages');
  await expect(page.locator('.row')).toHaveCount(60);
  const first = await page.locator('.row-subject').first().textContent();
  await page.getByRole('button', { name: 'Next results', exact: true }).click();
  await expect(page.locator('.row').first()).toBeFocused();
  await expect(page.locator('.row-subject').first()).not.toHaveText(first);
  await page.getByRole('button', { name: 'Previous results', exact: true }).click();
  await expect(page.locator('.row-subject').first()).toHaveText(first);
  await page.locator('.row').last().click();
  await expect(page.locator('.msg-position')).toHaveText('60 of 9990');
  await page.getByRole('button', { name: 'Older conversation', exact: true }).click();
  await expect(page.locator('.msg-position')).toHaveText('61 of 9990');
  await page.getByRole('button', { name: 'Back to list', exact: true }).click();
  await expect(page.locator('.row').first()).toBeFocused();
  await expect(page.locator('.row')).toHaveCount(60);
});

test('loading hundreds of messages bounds folder rows and makes earlier pages reachable', async ({ page }) => {
  await page.goto('/benchmarks/mailbox.html?n=1000&latency=0');
  await expect(page.locator('.row')).toHaveCount(60);
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: 'Load older messages', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Load older messages', exact: true })).toBeEnabled();
  }
  await expect(page.locator('.row')).toHaveCount(60);
  await page.getByRole('button', { name: 'Newer loaded messages', exact: true }).click();
  await expect(page.locator('.row')).toHaveCount(300);
  await expect(page.locator('.row').first()).toBeFocused();
  await page.getByRole('button', { name: 'Older loaded messages', exact: true }).click();
  await expect(page.locator('.row')).toHaveCount(60);
});

test('abandoned catalogs stop requesting pages and leave no partial complete search', async ({ page }) => {
  await page.goto('/benchmarks/mailbox.html?n=100000&latency=20');
  await expect(page.locator('.row')).toHaveCount(60);
  await search(page, 'subject:never');
  await expect(page.locator('.list-meta')).toContainText('Listing');
  await search(page, '');
  await expect(page.locator('.row')).toHaveCount(60);
  await page.waitForTimeout(100);
  const stopped = await page.evaluate(() => window.metrics.requests);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.metrics.requests)).toBe(stopped);
});

test('history failures remain explicit and Retry recovers', async ({ page }) => {
  await page.goto('/benchmarks/mailbox.html?n=1000&latency=0');
  await expect(page.locator('.row')).toHaveCount(60);
  await page.evaluate(() => { window.metrics.fail = true; });
  await page.locator('.row').first().click();
  await expect(page.getByRole('button', { name: 'Retry history', exact: true })).toBeVisible();
  await expect(page.locator('.msg-body')).toContainText('Hello benchmark');
  await page.evaluate(() => { window.metrics.fail = false; });
  await page.getByRole('button', { name: 'Retry history', exact: true }).click();
  await expect(page.locator('.msg-thread')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.history-status')).toHaveCount(0);
  await expect(page.locator('.msg-body')).toContainText('Hello benchmark');
});

test('older sparse inbox pages reuse the catalog fetched for history', async ({ page }) => {
  await page.goto('/benchmarks/mailbox.html?n=1000&latency=0&sparse');
  await expect(page.locator('.row')).toHaveCount(60);
  await page.locator('.row').first().click();
  await expect(page.locator('.msg-thread')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.history-status')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to list', exact: true }).click();
  const listed = await page.evaluate(() => window.metrics.listings);
  await page.getByRole('button', { name: 'Load older messages', exact: true }).click();
  await expect(page.locator('.row')).toHaveCount(120);
  expect(await page.evaluate(() => window.metrics.listings)).toBe(listed);
});

test('leaving a sender search stops scheduling headers', async ({ page }) => {
  await page.goto('/benchmarks/mailbox.html?n=1000&latency=20');
  await expect(page.locator('.row')).toHaveCount(60);
  await search(page, 'from:nobody');
  await expect.poll(() => page.evaluate(() => window.metrics.headers)).toBeGreaterThan(66);
  const before = await page.evaluate(() => window.metrics.headers);
  await search(page, '');
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => window.metrics.headers);
  expect(after - before).toBeLessThanOrEqual(6);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.metrics.headers)).toBe(after);
});

test('switching away stops empty-date scanning and reopening still loads the inbox', async ({ page }) => {
  await page.goto('/benchmarks/mailbox.html?n=1000&latency=5&emptyDays=1000');
  await page.waitForFunction(() => window.metrics.listings >= 3);
  await page.locator('.nav-item').filter({ hasText: 'Archive' }).click();
  await expect(page.locator('.center-note')).toContainText('Archived messages');
  const stopped = await page.evaluate(() => window.metrics.requests);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.metrics.requests)).toBe(stopped);
  await page.locator('.nav-item').filter({ hasText: 'Inbox' }).click();
  await expect(page.locator('.row')).toHaveCount(60);
  await expect(page.locator('.row').first()).toHaveAttribute('aria-label', /From Alice/);
});

test('experimental transport contract sends Range and rejects a truncated partial response', async ({ page }) => {
  await page.goto('/benchmarks/mailbox.html?n=1000&latency=0');
  const ranges = [];
  let broken = false;
  await page.route('**/read?*', async route => {
    ranges.push(route.request().headers().range);
    await route.fulfill({ status: 206, headers: { 'Content-Range': 'bytes 0-8191/8388608' },
      body: 'a'.repeat(broken ? 5 : 8192) });
  });
  const read = () => page.evaluate(async () => {
    const { createMailFS } = await import('/benchmarks/range-transport.js');
    const fs = createMailFS({ APIOrigin: location.origin, authToken: 'fixture', fs: {} }, '/test/.mail');
    try { return (await fs.read('/test/.mail/a', { byte_count: 8192 })).size; }
    catch (error) { return error.message; }
  });
  expect(await read()).toBe(8192);
  broken = true;
  expect(await read()).toContain('Incomplete message range');
  expect(ranges).toEqual(['bytes=0-8191', 'bytes=0-8191']);
});

test('reopening attachment-heavy mail reuses the complete cached message', async ({ page }) => {
  await page.goto('/benchmarks/mailbox.html?n=1000&latency=0&large');
  await expect(page.locator('.row')).toHaveCount(60);
  await page.locator('.row').first().click();
  await expect(page.locator('.msg-body')).toContainText('Hello benchmark');
  await expect(page.locator('.attachment')).toHaveCount(1);
  await expect(page.locator('.attachment-name')).toHaveText('large.bin');
  expect(await page.evaluate(() => window.metrics.bodies)).toBe(1);
  await page.getByRole('button', { name: 'Back to list', exact: true }).click();
  await page.locator('.row').first().click();
  await expect(page.locator('.attachment')).toHaveCount(1);
  await expect(page.locator('.msg-body')).toContainText('Hello benchmark');
  expect(await page.evaluate(() => window.metrics.bodies)).toBe(1);
});

test('a server ignoring SDK byte limits still opens complete mail without dumping attachment bytes', async ({ page }) => {
  await page.goto('/benchmarks/mailbox.html?n=3&latency=0&large&ignoreRanges');
  await expect(page.locator('.row')).toHaveCount(3);
  await page.locator('.row').first().click();
  await expect(page.locator('.msg-body')).toHaveText('Hello benchmark');
  await expect(page.locator('.attachment-name')).toHaveText('large.bin');
  expect(await page.evaluate(() => window.metrics.bodies)).toBe(1);
  await page.getByRole('button', { name: 'Back to list', exact: true }).click();
  await page.locator('.row').first().click();
  await expect(page.locator('.msg-body')).toHaveText('Hello benchmark');
  await expect(page.locator('.attachment-name')).toHaveText('large.bin');
  expect(await page.evaluate(() => window.metrics.bodies)).toBe(1);
});

test('unread attachment-heavy history stays available without automatic body downloads', async ({ page }) => {
  await page.goto('/benchmarks/mailbox.html?n=1000&latency=0&large&thread=20');
  await expect(page.locator('.row')).toHaveCount(41);
  await page.locator('.row').first().click();
  await expect(page.locator('.msg-item')).toHaveCount(20);
  await expect(page.locator('.msg-item.is-open')).toHaveCount(1);
  await expect(page.locator('.attachment-name')).toHaveText('large.bin');
  expect(await page.evaluate(() => window.metrics.bodies)).toBe(1);
  // An older message remains reachable with the keyboard and loads on demand.
  await page.locator('.msg-item').first().getByRole('button', { name: /^Expand the message/ }).focus();
  await page.locator('.msg-item').first().getByRole('button', { name: /^Expand the message/ }).press('Enter');
  await expect(page.locator('.msg-item.is-open')).toHaveCount(2);
  await expect(page.locator('.attachment')).toHaveCount(2);
  expect(await page.evaluate(() => window.metrics.bodies)).toBe(2);
});

test('long conversations page through complete history with bounded cards and keyboard focus', async ({ page }) => {
  await page.goto('/benchmarks/mailbox.html?n=1000&latency=0&thread=1000');
  await page.locator('.row').first().click();
  await expect(page.locator('.msg-count')).toHaveText('1000');
  await expect(page.locator('.msg-thread')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.msg-item')).toHaveCount(40);
  await expect(page.locator('.thread-page-status')).toHaveText('Messages 961–1000 of 1000');
  const requests = await page.evaluate(() => window.metrics.requests);
  await page.getByRole('button', { name: 'First messages in conversation', exact: true }).click();
  await expect(page.locator('.thread-page-status')).toHaveText('Messages 1–60 of 1000');
  await expect(page.locator('.msg-item')).toHaveCount(60);
  await expect(page.locator('.msg-expander').first()).toBeFocused();
  await page.getByRole('button', { name: 'Newer messages in conversation', exact: true }).click();
  await expect(page.locator('.thread-page-status')).toHaveText('Messages 61–120 of 1000');
  await page.getByRole('button', { name: 'Latest messages in conversation', exact: true }).click();
  await expect(page.locator('.thread-page-status')).toHaveText('Messages 961–1000 of 1000');
  await expect(page.locator('.msg-body')).toContainText('Hello benchmark');
  expect(await page.evaluate(() => window.metrics.requests)).toBe(requests);
  // The range remains visible if the browser's native print command is used;
  // the app's Print button separately prepares every message for export.
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.thread-page-status')).toBeVisible();
  await expect(page.getByRole('button', { name: 'First messages in conversation', exact: true })).toBeHidden();
});

test('long attachment conversations stop bulk body reads after moving to another page', async ({ page }) => {
  await page.goto('/benchmarks/mailbox.html?n=125&latency=0&large&thread=125');
  await page.locator('.row').first().click();
  await expect(page.locator('.msg-thread')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.attachment-name')).toHaveText('large.bin');
  await page.getByRole('button', { name: 'First messages in conversation', exact: true }).click();
  await page.evaluate(() => {
    const read = window.benchFS.read;
    window.releaseBodies = null;
    const paused = new Promise(resolve => { window.releaseBodies = resolve; });
    window.bodyAttempts = 0;
    window.benchFS.read = async (path, options) => {
      if (!options?.byte_count) { window.bodyAttempts++; await paused; }
      return read(path, options);
    };
  });
  await page.getByRole('button', { name: 'Expand messages on this page', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.bodyAttempts)).toBe(4);
  await page.getByRole('button', { name: 'Latest messages in conversation', exact: true }).click();
  await page.evaluate(() => window.releaseBodies());
  await expect(page.locator('.attachment-name')).toHaveText('large.bin');
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.bodyAttempts)).toBe(4);
  await expect(page.locator('.msg-item')).toHaveCount(5);
  await expect(page.locator('.msg-body')).toContainText('Hello benchmark');
});

test('Print exports the complete paged conversation and removes its temporary document', async ({ page }) => {
  await page.goto('/benchmarks/mailbox.html?n=61&latency=0&thread=61');
  await page.locator('.row').first().click();
  await expect(page.locator('.msg-count')).toHaveText('61');
  await expect(page.locator('.msg-thread')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.msg-thread .msg-item')).toHaveCount(1);
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => {
    window.print = () => {
      const printed = document.querySelector('.print-conversation');
      window.printResult = {
        count: printed.querySelectorAll('.msg-body').length,
        display: getComputedStyle(printed).display,
        reader: getComputedStyle(document.querySelector('.message:not(.print-conversation)')).display,
      };
    };
    document.querySelector('[aria-label="Print"]').click();
  });
  await expect.poll(() => page.evaluate(() => window.printResult)).toEqual({ count: 61, display: 'block', reader: 'none' });
  await expect(page.locator('.print-conversation')).toHaveCount(0);
  await expect(page.locator('.msg-thread .msg-item')).toHaveCount(1);
  await expect(page.locator('.thread-page-status')).toHaveText('Messages 61–61 of 61');
});
