/**
 * Sixteenth review pass, region C: the shared email worker (its own runtime,
 * since it binds the worker globals the workspace worker also binds).
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { createMemoryKv, createMemoryFs, createWorkerRuntime } from '../dev/worker-runtime.js';

const BASE = 'https://teamchat-email.test';
const alice = { uuid: 'u-alice-0000', username: 'alice' };

let runtime;
let sends;

beforeAll(async () => {
  runtime = await createWorkerRuntime({
    kv: createMemoryKv(),
    fs: createMemoryFs(),
    owner: { uuid: 'u-dev-0000', username: 'dev' },
    loadWorker: () => import('../worker/email.js'),
  });
  globalThis.me.puter.email = { send: async (message) => { sends.push(message); return {}; } };
});

beforeEach(() => {
  sends = [];
  runtime.setStores({ kv: createMemoryKv() });
});

async function post(body, caller = alice) {
  const res = await runtime.dispatch(`${BASE}/invites`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, caller);
  return { status: res.status, data: await res.json() };
}

const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('an invitation whose names are cut short through an emoji', () => {
  it('is composed of whole characters: no half of one reaches the subject, the text or the html', async () => {
    // 59 letters then an emoji, then more: the name is clamped at 60 units, through the emoji.
    const inviter = `${'A'.repeat(59)}\u{1F600} Smith`;
    const workspace = `${'W'.repeat(59)}\u{1F389} Inc`;
    const channel = `${'c'.repeat(39)}\u{1F680}x`;
    const note = `${'n'.repeat(399)}\u{1F44B}!`;
    const res = await post({ kind: 'guest', server: 'alice.puter.work', code: 'ABCD-EFGH-JKLM', workspace, inviter, channel, note, emails: ['pat@example.com'] });
    expect(res.status).toBe(200);
    expect(sends).toHaveLength(1);
    const [mail] = sends;
    for (const part of [mail.subject, mail.text, mail.html]) expect(LONE.test(part)).toBe(false);
    // The subject itself is clamped at 160 (the workspace name is cut there, whole characters again); the body carries the names in full.
    expect(mail.subject.startsWith(`${'A'.repeat(59)} invited you to #${'c'.repeat(39)} in ${'W'.repeat(10)}`)).toBe(true);
    expect(mail.subject.length).toBeLessThanOrEqual(160);
    expect(mail.text).toContain(`guest of ${'W'.repeat(59)} on Teamchat`);
    expect(mail.text).toContain(`${'A'.repeat(59)} added a note:\n${'n'.repeat(399)}`);
  });
});
