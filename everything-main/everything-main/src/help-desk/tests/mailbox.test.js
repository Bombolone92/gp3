import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { importMailbox } from '../src/client/mailbox.js';

// A mailbox listing is newest first and paged, like puter.email.list.
function fakeMailbox(count, { failGet = () => false } = {}) {
  const now = Date.now();
  const msgs = Array.from({ length: count }, (_, i) => ({ id: `m${i}`, date: new Date(now - (count - i) * 60000).toISOString(), subject: `s${i}` })).reverse();
  window.puter = {
    auth: { getUser: async () => ({ uuid: 'u', username: 'owner' }) },
    email: {
      list: async ({ limit, cursor }) => {
        const start = cursor ? Number(cursor) : 0;
        return { items: msgs.slice(start, start + limit), cursor: start + limit < msgs.length ? String(start + limit) : null };
      },
      get: async (id) => {
        if (failGet(id)) throw new Error('transient');
        const m = msgs.find((x) => x.id === id);
        return { from: { address: 'c@x.io' }, subject: m.subject, text: 'hi', date: m.date };
      },
    },
  };
}

function fakeDesk(ref, imported) {
  return {
    post: async (_path, body) => {
      imported.push(body.messages[0].subject);
      return { results: [{ status: 'created' }] };
    },
    upload: async () => ({}),
  };
}

describe('mailbox import', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { delete window.puter; });

  it('imports a backlog larger than one run without losing older mail', async () => {
    fakeMailbox(150);
    const imported = [];
    const app = { ref: 'w/a', api: fakeDesk('w/a', imported), replica: { upsert() {} } };
    for (let i = 0; i < 5; i++) await importMailbox(app);
    expect(new Set(imported).size).toBe(150);
    expect(imported.length).toBe(150);
  });

  it('retries a message that failed instead of skipping past it', async () => {
    let failing = true;
    fakeMailbox(5, { failGet: (id) => failing && id === 'm1' });
    const imported = [];
    const app = { ref: 'w/a', api: fakeDesk('w/a', imported), replica: { upsert() {} } };
    const first = await importMailbox(app);
    expect(first.failed).toBe(1);
    failing = false;
    await importMailbox(app);
    expect(imported.sort()).toEqual(['s0', 's1', 's2', 's3', 's4']);
  });

  it('retries a message the help desk could not file', async () => {
    fakeMailbox(3);
    const filed = [];
    let storageDown = true;
    const app = { ref: 'w/a', replica: { upsert() {} } };
    app.api = {
      upload: async () => ({}),
      post: async (_p, body) => {
        const subject = body.messages[0].subject;
        if (storageDown && subject === 's1') return { results: [{ status: 'failed', reason: 'Storage is busy' }] };
        filed.push(subject);
        return { results: [{ status: 'created' }] };
      },
    };
    const first = await importMailbox(app);
    expect(first).toMatchObject({ created: 2, failed: 1 });
    storageDown = false;
    await importMailbox(app);
    expect(filed.sort()).toEqual(['s0', 's1', 's2']);
  });

  it('gives up on a message that keeps failing so later mail still moves on', async () => {
    fakeMailbox(3, { failGet: (id) => id === 'm0' });
    const imported = [];
    const app = { ref: 'w/a', api: fakeDesk('w/a', imported), replica: { upsert() {} } };
    for (let i = 0; i < 6; i++) await importMailbox(app);
    expect(imported.sort()).toEqual(['s1', 's2']);
    const state = JSON.parse(localStorage.getItem('help-desk:mailbox:w/a'));
    expect(state.retries).toEqual({});
    const later = await importMailbox(app);
    expect(later.failed).toBe(0);
    expect(imported.length).toBe(2);
  });

  it('stops filing mail when the open help desk changes mid-run', async () => {
    fakeMailbox(4);
    const a = [];
    const b = [];
    const app = { ref: 'w/a', replica: { upsert() {} } };
    app.api = {
      upload: async () => ({}),
      post: async (_p, body) => {
        a.push(body.messages[0].subject);
        if (a.length === 2) Object.assign(app, { ref: 'w/b', api: fakeDesk('w/b', b) });
        return { results: [{ status: 'created' }] };
      },
    };
    await importMailbox(app);
    expect(a).toEqual(['s0', 's1']);
    expect(b).toEqual([]);
  });

  it('shares a check that is already running instead of importing twice', async () => {
    fakeMailbox(3);
    const imported = [];
    const app = { ref: 'w/a', api: fakeDesk('w/a', imported), replica: { upsert() {} } };
    const [x, y] = await Promise.all([importMailbox(app), importMailbox(app)]);
    expect(x).toBe(y);
    expect(imported.length).toBe(3);
  });
});
