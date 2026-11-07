/**
 * Seventeenth review pass, region C: the shared email worker (its own runtime,
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

const invite = (over = {}) => ({ kind: 'workspace', server: 'alice.puter.work', code: 'ABCD-EFGH-JKLM', workspace: 'Acme', inviter: 'Alice A.', emails: ['pat@example.com', 'sam@example.com'], ...over });

describe('the daily cap on a store whose counter answers with something other than a number', () => {
  it('lets the sends through, as a cap that cannot be read is no cap, rather than refusing everyone as over the limit', async () => {
    for (const answer of [undefined, null, {}, { value: 3 }, 'nope']) {
      const kv = createMemoryKv();
      kv.incr = async () => answer;
      runtime.setStores({ kv });
      sends = [];
      const r = await post(invite());
      expect([r.status, r.data.sent, r.data.capped], String(answer)).toEqual([200, 2, 0]);
      expect(sends).toHaveLength(2);
    }
    // A counter that does answer still caps: two sends of a hundred already made leave none.
    const kv = createMemoryKv();
    kv.incr = async () => 102;
    runtime.setStores({ kv });
    const capped = await post(invite());
    expect([capped.status, capped.data.error]).toEqual([429, 'daily_limit']);
    // And one answering as a numeric string is read as its number.
    const kv2 = createMemoryKv();
    kv2.incr = async () => '101';
    runtime.setStores({ kv: kv2 });
    sends = [];
    const one = await post(invite());
    expect([one.status, one.data.sent, one.data.capped]).toEqual([200, 1, 1]);
  });
});
