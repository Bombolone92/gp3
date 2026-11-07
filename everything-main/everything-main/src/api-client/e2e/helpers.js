import fs from 'node:fs';
import path from 'node:path';

const axeSource = fs.readFileSync(path.resolve('node_modules/axe-core/axe.min.js'), 'utf8');

/** Serves a fake API at https://api.test with permissive CORS. Records requests. */
export async function mockApi(page) {
  const seen = [];
  await page.route('https://api.test/**', async (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    seen.push({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body: req.postData() });
    if (url.pathname === '/status/404') return route.fulfill({ status: 404, headers: { ...cors, 'content-type': 'application/json' }, body: '{"error":"not found"}' });
    if (url.pathname === '/html') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/html' }, body: '<h1>Hello</h1><script>parent.hacked = 1</script>' });
    // "big" is written as text so the digits survive: JavaScript numbers would round it.
    const body = JSON.stringify({ method: req.method(), path: url.pathname, query: Object.fromEntries(url.searchParams), json: safeJson(req.postData()), big: 0 }).replace('"big":0', '"big":12345678901234567890');
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json', 'x-request-id': 'abc123' }, body });
  });
  return seen;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text ?? null;
  }
}

/** Opens the app with an empty workspace and dismisses the first-run notice. */
export async function openApp(page) {
  await page.goto('/');
  await page.waitForSelector('.shell');
  const dismiss = page.locator('.toast .icon-btn');
  if (await dismiss.count()) await dismiss.first().click();
}

export async function axeViolations(page) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const res = await window.axe.run(document, { resultTypes: ['violations'] });
    return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  });
}

export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

export const sampleCollection = {
  info: { name: 'Sample API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  variable: [{ key: 'base', value: 'https://api.test' }],
  item: [
    {
      name: 'Users',
      item: [
        {
          name: 'List users',
          request: { method: 'GET', url: '{{base}}/users?page=1' },
          event: [{ listen: 'test', script: { exec: ["test('ok', () => expect(response.status).toBe(200));"] } }],
        },
        {
          name: 'Create user',
          request: { method: 'POST', url: '{{base}}/users', body: { mode: 'raw', raw: '{"name":"Ada"}', options: { raw: { language: 'json' } } } },
          event: [{ listen: 'test', script: { exec: ["test('echoes', () => expect(response.json().json.name).toBe('Ada'));"] } }],
        },
      ],
    },
    { name: 'Missing', request: { method: 'GET', url: '{{base}}/status/404' } },
  ],
};
