import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const label = process.argv[2] || 'current';
const base = process.env.BENCH_URL || 'http://127.0.0.1:5174';
const sizes = (process.env.BENCH_SIZES || '1000,10000,100000').split(',').map(Number);
const scenarios = (process.env.BENCH_SCENARIOS || 'dense,sparse,large').split(',');
const timeout = Number(process.env.BENCH_TIMEOUT || 150000);
const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
const results = [];
await mkdir('benchmarks/results', { recursive: true });
const save = () => writeFile(`benchmarks/results/${label}.json`, JSON.stringify(results, null, 2) + '\n');
for (const n of sizes) for (const scenario of scenarios) {
  const page = await browser.newPage();
  page.setDefaultTimeout(timeout);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const snapshot = () => page.evaluate(() => ({ ...window.metrics, longTasks: [...window.metrics.longTasks],
    timeOrigin: performance.timeOrigin,
    heap: performance.memory?.usedJSHeapSize, rows: document.querySelectorAll('.row').length,
    nodes: document.getElementsByTagName('*').length, meta: document.querySelector('.list-meta')?.textContent }));
  const measure = async (operation, action, ready) => {
    const before = operation === 'inbox-cold' ? { requests: 0, bytes: 0, headers: 0, bodies: 0, longTasks: [] } : await snapshot();
    const start = performance.now();
    let expired = false;
    const deadline = operation === 'broad-subject' ? setTimeout(() => { expired = true; page.close().catch(() => {}); }, Number(process.env.BENCH_BROAD_TIMEOUT || 20000)) : null;
    let error;
    try { await action(); await ready(); } catch (e) { error = String(e).slice(0, 200); }
    if (deadline) clearTimeout(deadline);
    if (expired || page.isClosed()) {
      results.push({ n, scenario, operation, ms: Math.round(performance.now() - start), error: 'Renderer exceeded broad-search deadline; page closed to bound benchmark resources', completed: false });
      console.log(JSON.stringify(results.at(-1)));
      await save();
      return false;
    }
    // Flush PerformanceObserver delivery before collecting long tasks.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    const ms = operation === 'inbox-cold' ? await page.evaluate(() => performance.now() - window.started) : performance.now() - start;
    const after = await snapshot();
    if (before.timeOrigin && after.timeOrigin !== before.timeOrigin) {
      throw new Error(`Page reloaded during ${operation}; discard this scenario and rerun against unchanged source`);
    }
    results.push({ n, scenario, operation, ms: Math.round(ms), requests: after.requests - before.requests,
      bytes: after.bytes - before.bytes, headers: after.headers - before.headers, bodies: after.bodies - before.bodies,
      rows: after.rows, nodes: after.nodes, heap: after.heap, peakActive: after.peakActive, meta: after.meta,
      longTasks: after.longTasks.slice(before.longTasks.length), errors: [...errors], ...(error ? { error } : {}) });
    console.log(JSON.stringify(results.at(-1)));
    await save();
    return !error;
  };
  const search = async value => {
    await page.locator('.search-input').fill(value);
    await page.locator('.search-input').dispatchEvent('search');
  };
  const done = () => page.waitForFunction(() => /results? in \d+ messages/.test(document.querySelector('.list-meta').textContent));
  // A settling measurement includes this explicit 150ms observation window;
  // unlike active==0 alone, it cannot mistake an inter-page yield for completion.
  const idle = () => page.waitForFunction(() => window.metrics.active === 0 && performance.now() - window.metrics.lastComplete > 150);
  const historyDone = async () => {
    await page.waitForFunction(() => !document.querySelector('.history-status, .msg-thread[aria-busy="true"]'));
    await idle();
  };
  try {
    const fixture = scenario === 'ignored-ranges' ? 'large&ignoreRanges'
      : scenario === 'abandon-folder' ? 'emptyDays=1000'
      : scenario === 'catalog-page' ? 'sparse'
      : scenario === 'thread' ? 'large&thread=20'
      : ['sparse', 'large'].includes(scenario) ? scenario : '';
    await page.goto(`${base}/benchmarks/mailbox.html?n=${n}&latency=${scenario === 'latency' ? 40 : 5}&${fixture}`);
    await page.waitForFunction(() => window.started);
    if (scenario === 'abandon-folder') {
      await page.waitForFunction(() => window.metrics.listings >= 3);
      await measure('switch-away', () => page.locator('.nav-item').filter({ hasText: 'Archive' }).click(),
        () => page.waitForFunction(() => document.querySelector('.center-note')?.textContent.includes('Archived messages')));
      await measure('abandoned-folder-work', async () => {}, () => page.waitForTimeout(300));
      await page.close();
      await save();
      continue;
    }
    await measure('inbox-cold', async () => {}, () => page.locator('.row').first().waitFor());
    await page.locator('.nav-item').filter({ hasText: 'Archive' }).click();
    await page.waitForFunction(() => document.querySelector('.center-note')?.textContent.includes('Archived messages'));
    await measure('inbox-warm', () => page.locator('.nav-item').filter({ hasText: 'Inbox' }).click(), () => page.locator('.row').first().waitFor());
    if (scenario === 'coldsearch') {
      await measure('targeted-cold-before-history', () => search('subject:Needle from:alice'), done);
      await search('');
      await measure('targeted-warm', () => search('subject:Needle from:alice'), done);
    } else if (scenario === 'failures') {
      await page.evaluate(() => { window.metrics.fail = true; });
      await measure('search-failed', () => search('subject:Needle'), () => page.waitForFunction(() => document.querySelector('.list-meta')?.textContent === 'Search unavailable'));
      await page.evaluate(() => { window.metrics.fail = false; });
      await measure('search-retry', () => search('subject:Needle'), done);
      await search('');
    } else {
      await measure('open-cold', () => page.locator('.row').first().click(), () => page.locator('.msg-body').first().waitFor());
      await measure('history-cold-settle', async () => {}, historyDone);
      await page.getByRole('button', { name: 'Back to list', exact: true }).click();
      await measure('open-warm', () => page.locator('.row').first().click(), () => page.locator('.msg-body').first().waitFor());
      await measure('history-warm-settle', async () => {}, historyDone);
      await page.getByRole('button', { name: 'Back to list', exact: true }).click();
      if (scenario === 'catalog-page') {
        await measure('next-page-after-history', () => page.getByRole('button', { name: 'Load older messages', exact: true }).click(),
          () => page.waitForFunction(() => document.querySelectorAll('.row').length === 120));
      }
      if (scenario !== 'latency') {
        const complete = await measure('search-cold-headers', () => search('subject:Needle from:alice'), done);
        await search('');
        await measure(complete ? 'search-warm' : 'search-resume', () => search('subject:Needle from:alice'), done);
        await search('');
      }
      // Broad search also benchmarks warm catalog CPU/DOM independently of headers.
      await page.evaluate(({ n, scenario }) => {
        window.expectedBroad = n - Math.ceil(n / 1000) - (scenario === 'thread' ? 19 : 0);
      }, { n, scenario });
      await measure('broad-subject', () => search('subject:Message'), () => page.waitForFunction(() =>
        new RegExp(`^${window.expectedBroad} results in`).test(document.querySelector('.list-meta').textContent)));
    }
  } catch (e) {
    results.push({ n, scenario, error: String(e).slice(0, 500) });
    console.log(JSON.stringify(results.at(-1)));
  }
  await page.close();
  await save();
}
await browser.close();
