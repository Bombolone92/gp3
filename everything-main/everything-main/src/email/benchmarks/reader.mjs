import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Actual Chromium/app CPU and DOM, synthetic filesystem latency and bytes.
const label = process.argv[2] || 'reader-current';
const base = process.env.BENCH_URL || 'http://127.0.0.1:5174';
const sizes = (process.env.BENCH_SIZES || '1000,10000,100000').split(',').map(Number);
const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
const results = [];
await mkdir('benchmarks/results', { recursive: true });
for (const n of sizes) {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const snapshot = () => page.evaluate(() => ({ ...window.metrics,
    heap: performance.memory.usedJSHeapSize, timeOrigin: performance.timeOrigin,
    nodes: document.getElementsByTagName('*').length,
    cards: document.querySelectorAll('.msg-item').length,
    count: document.querySelector('.msg-count')?.textContent,
    page: document.querySelector('.thread-page-status')?.textContent,
  }));
  const measure = async (operation, action, ready) => {
    const before = await snapshot();
    const start = performance.now();
    await action();
    await ready();
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    const ms = Math.round(performance.now() - start);
    const after = await snapshot();
    if (before.timeOrigin !== after.timeOrigin) throw new Error('Page reloaded; discard run');
    const result = { n, threadSize: 1000, operation, ms,
      requests: after.requests - before.requests, bytes: after.bytes - before.bytes,
      bodies: after.bodies - before.bodies, heap: after.heap, nodes: after.nodes,
      cards: after.cards, count: after.count, page: after.page,
      longTasks: after.longTasks.slice(before.longTasks.length), errors: [...errors] };
    results.push(result);
    console.log(JSON.stringify(result));
  };
  try {
    await page.goto(`${base}/benchmarks/mailbox.html?n=${n}&latency=5&thread=1000`);
    await page.locator('.row').first().waitFor();
    const ready = () => page.waitForFunction(() =>
      document.querySelector('.msg-thread')?.getAttribute('aria-busy') === 'false'
      && document.querySelector('.msg-body'));
    await measure('complete-reader-cold', () => page.locator('.row').first().click(), ready);
    await page.getByRole('button', { name: 'Back to list', exact: true }).click();
    await measure('complete-reader-warm', () => page.locator('.row').first().click(), ready);
    const older = page.getByRole('button', { name: 'Older messages in conversation', exact: true });
    if (await older.count()) {
      await measure('older-page', () => older.click(), () => page.locator('.msg-item').first().waitFor());
      await measure('latest-page', () => page.getByRole('button', { name: 'Latest messages in conversation', exact: true }).click(), ready);
    }
  } catch (error) {
    results.push({ n, error: String(error), completed: false });
  } finally {
    await page.close();
    await writeFile(`benchmarks/results/${label}.json`, JSON.stringify(results, null, 2) + '\n');
  }
}
await browser.close();
