/**
 * The email worker, run against fake Puter objects: who may send, what is
 * sent, duplicate skipping and the daily cap.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../src/workers/email-worker.js', import.meta.url)), 'utf8');

function load() {
  const routes = {};
  const router = {
    get: (path, fn) => (routes[`GET ${path}`] = fn),
    post: (path, fn) => (routes[`POST ${path}`] = fn),
  };
  new Function('router', SRC)(router);
  return routes;
}

function memoryKV() {
  const m = new Map();
  return {
    m,
    get: async (k) => (m.has(k) ? m.get(k) : null),
    set: async (k, v) => void m.set(k, v),
    incr: async (k, n = 1) => {
      const v = (Number(m.get(k)) || 0) + n;
      m.set(k, v);
      return v;
    },
    expire: async () => {},
  };
}

function setup({ caller = true } = {}) {
  const sent = [];
  const kv = memoryKV();
  const me = { puter: { kv, authToken: 'owner-token', email: { send: vi.fn(async (msg) => (sent.push(msg), {})) } } };
  const user = caller ? { uuid: 'user-1', puter: { authToken: 'user-token' } } : null;
  const routes = load();
  const send = async (body) => {
    const request = { json: async () => body, headers: new Map() };
    const res = await routes['POST /send']({ request, me, user });
    return { status: res.status, data: await res.json() };
  };
  return { send, sent, kv, routes };
}

const body = (extra = {}) => ({
  message: { id: 'msg1', kind: 'announcement', senderName: 'Brightside Property Co.', senderEmail: 'office@brightside.example' },
  recipients: [{ email: 'Ana@Example.com', name: 'Ana', version: 'abcdef0123456789' }],
  subject: 'Water shutoff',
  body: 'Water is off <b>Thursday</b>.',
  ...extra,
});

describe('email worker', () => {
  it('answers health checks', async () => {
    const { routes } = setup();
    const res = await routes['GET /health']({});
    expect((await res.json()).ok).toBe(true);
  });

  it('refuses callers without a Puter session', async () => {
    const { send, sent } = setup({ caller: false });
    expect((await send(body())).status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('sends one escaped message per recipient, billed to the caller, replying to the sender', async () => {
    const { send, sent } = setup();
    const out = await send(body({ recipients: [{ email: 'a@x.com', version: 'aaaaaaaa' }, { email: 'b@x.com', version: 'bbbbbbbb' }] }));
    expect(out.status).toBe(200);
    expect(out.data.sent).toBe(2);
    expect(sent.map((m) => m.to)).toEqual(['a@x.com', 'b@x.com']);
    expect(sent[0].requesterToken).toBe('user-token');
    expect(sent[0].replyTo).toBe('office@brightside.example');
    expect(sent[0].html).toContain('&lt;b&gt;Thursday&lt;/b&gt;');
    expect(sent[0].html).toContain('Brightside Property Co.');
    expect(sent[0].text).toBe('Water is off <b>Thursday</b>.');
  });

  it('skips a recipient who already received the identical message', async () => {
    const { send, sent } = setup();
    await send(body());
    const again = await send(body());
    expect(again.data.skipped).toBe(1);
    expect(sent).toHaveLength(1);
    const forced = await send(body({ force: true }));
    expect(forced.data.sent).toBe(1);
  });

  it('two identical requests at once send the message once', async () => {
    const { sent, routes, kv } = setup();
    // Handing a message over takes a moment, as it does for real.
    const me = { puter: { kv, authToken: 'owner-token', email: { send: vi.fn(async (msg) => (await new Promise((r) => setTimeout(r, 20)), sent.push(msg), {})) } } };
    const user = { uuid: 'user-1', puter: { authToken: 'user-token' } };
    const send = async () => ({ data: await (await routes['POST /send']({ request: { json: async () => body(), headers: new Map() }, me, user })).json() });
    const [a, b] = await Promise.all([send(), send()]);
    expect(sent).toHaveLength(1);
    expect(a.data.sent + b.data.sent).toBe(1);
    // The one that lost the race does not claim the message was delivered.
    expect([...a.data.results, ...b.data.results].filter((r) => r.reason === 'in_progress')).toHaveLength(1);
    expect([...a.data.results, ...b.data.results].filter((r) => r.reason === 'already_sent')).toHaveLength(0);
  });

  it('a send that failed can be retried', async () => {
    const { send, sent, routes, kv } = setup();
    let fail = true;
    const me = { puter: { kv, authToken: 'owner-token', email: { send: vi.fn(async (msg) => (fail ? Promise.reject(new Error('smtp down')) : (sent.push(msg), {}))) } } };
    const user = { uuid: 'user-1', puter: { authToken: 'user-token' } };
    const post = async () => (await routes['POST /send']({ request: { json: async () => body(), headers: new Map() }, me, user })).json();
    expect((await post()).failed).toBe(1);
    fail = false;
    expect((await post()).sent).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it('sends documents and pictures but not web pages or programs', async () => {
    const content = Buffer.from('x').toString('base64');
    const tryAttach = async (filename, contentType) => {
      const { send, sent } = setup();
      const out = await send(body({ attachments: [{ filename, contentType, content }] }));
      return { status: out.status, sent: sent.length };
    };
    expect(await tryAttach('receipt.pdf', 'application/pdf')).toEqual({ status: 200, sent: 1 });
    expect(await tryAttach('invoice.html', 'text/html')).toEqual({ status: 400, sent: 0 });
    expect(await tryAttach('setup.exe', 'application/x-msdownload')).toEqual({ status: 400, sent: 0 });
    expect(await tryAttach('setup.exe', 'application/pdf')).toEqual({ status: 400, sent: 0 });
  });

  it('refuses a message too long to send whole instead of cutting it', async () => {
    const { send, sent } = setup();
    const long = `${'Line of text. '.repeat(1430)}TOTAL DUE: $1,234.00`;
    const out = await send(body({ body: long }));
    expect(out.status).toBe(400);
    expect(out.data.error).toBe('body_too_long');
    expect((await send(body({ subject: 'S'.repeat(201) }))).data.error).toBe('subject_too_long');
    expect(sent).toHaveLength(0);
  });

  it('validates the request', async () => {
    const { send } = setup();
    expect((await send(body({ message: { id: 'bad id!' } }))).data.error).toBe('message_id_required');
    expect((await send(body({ subject: '' }))).data.error).toBe('subject_required');
    expect((await send(body({ body: '   ' }))).data.error).toBe('body_required');
    expect((await send(body({ recipients: [{ email: 'x@y.co' }] }))).data.error).toBe('version_required');
    expect((await send(body({ recipients: [] }))).data.error).toBe('recipients_required');
  });

  it('folds header injection out of the subject and caps recipients per request', async () => {
    const { send, sent } = setup();
    const many = Array.from({ length: 9 }, (_, i) => ({ email: `t${i}@x.com`, version: `0000000${i}` }));
    const out = await send(body({ subject: 'Hi\r\nBcc: evil@x.com', recipients: many }));
    expect(out.data.sent).toBe(5);
    expect(sent[0].subject).toBe('Hi Bcc: evil@x.com');
  });

  it('stops at the daily limit', async () => {
    const { send, kv } = setup();
    const day = new Date().toISOString().slice(0, 10);
    // Pre-fill today's counter for this caller to the cap.
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('user-1')))].map((b) => b.toString(16).padStart(2, '0')).join('');
    kv.m.set(`mail:rate:${hash}:${day}`, 300);
    const out = await send(body());
    expect(out.status).toBe(429);
  });
});
