/**
 * Client-side message window bookkeeping. The store talks to Puter through
 * api.js, so only the pure pieces are exercised here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mergeMessages, applyRange, store } from '../src/lib/store.js';
import { createOutbox, memoryStorage } from '../src/lib/outbox.js';
import { ApiError } from '../src/lib/api.js';
import { PRESENCE_WINDOW_MS } from '../src/lib/time.js';

const msg = (seq, text = `m${seq}`) => ({ seq, text, user: 'u', ts: 1000 + seq });

describe('mergeMessages', () => {
  it('merges by seq, keeps order, and parks pending entries last', () => {
    const pending = { seq: null, text: 'sending', pending: true };
    const out = mergeMessages([msg(1), msg(3), pending], [msg(2), { ...msg(3), text: 'edited' }]);
    expect(out.map((m) => m.seq)).toEqual([1, 2, 3, null]);
    expect(out[2].text).toBe('edited');
  });
});

describe('applyRange', () => {
  const window = [msg(1), msg(2), msg(3), msg(4)];

  it('refreshes what came back and drops what the range says is gone', () => {
    const data = { seq: 4, hasMore: false, messages: [msg(1), { ...msg(2), text: 'edited' }, msg(4)] };
    const out = applyRange(window, data, { from: 1, to: 4 });
    expect(out.map((m) => m.seq)).toEqual([1, 2, 4]); // 3 was deleted
    expect(out[1].text).toBe('edited');
  });

  it('keeps messages a partial answer never covered', () => {
    // The worker answers a from/to read a few blocks at a time: here it only
    // reached seq 2, so 3 and 4 must stay instead of vanishing from the list.
    const data = { seq: 4, hasMore: true, messages: [msg(1), msg(2)] };
    const out = applyRange(window, data, { from: 1, to: 4 });
    expect(out.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
  });

  it('keeps messages outside the requested range', () => {
    const data = { seq: 4, hasMore: false, messages: [msg(3), msg(4)] };
    const out = applyRange(window, data, { from: 3, to: 4 });
    expect(out.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
  });

  it('keeps a message that arrived after the read was asked for', () => {
    const data = { seq: 4, hasMore: false, messages: [msg(1), msg(2), msg(3), msg(4)] };
    const out = applyRange([...window, msg(5)], data, { from: 1, to: 4 });
    expect(out.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never touches unsent messages', () => {
    const pending = { seq: null, text: 'sending', pending: true };
    const failed = { seq: null, text: 'nope', failed: true };
    const data = { seq: 4, hasMore: false, messages: [] };
    const out = applyRange([msg(1), pending, failed], data, { from: 1, to: 1 });
    expect(out).toEqual([pending, failed]);
  });
});

describe('loadOlder', () => {
  const REF = 'abc123def0@teamchat-test';

  it('pages back from the oldest sequence it knows', async () => {
    const seen = [];
    globalThis.puter = {
      workers: {
        exec: async (url) => {
          seen.push(new URL(url).searchParams.get('before'));
          return new Response(JSON.stringify({ seq: 60, hasMore: false, messages: [{ seq: 8 }, { seq: 9 }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } });
        },
      },
    };
    store.wsId = REF;
    const c = store.conv('older');
    c.loaded = true;
    c.hasMore = true;
    c.messages = [{ seq: 10 }, { seq: null, pending: true }];
    await store.loadOlder('older');
    expect(seen).toEqual(['10']);
    expect(c.messages.map((m) => m.seq)).toEqual([8, 9, 10, null]);
    store.wsId = null;
    store.convs.clear();
    delete globalThis.puter;
  });
});

describe('fetchNewer', () => {
  const REF = 'abc123def0@teamchat-test';

  /** Answer message reads the way the worker does, recording every request. */
  function fakeWorker(reply) {
    const seen = [];
    globalThis.puter = {
      workers: {
        exec: async (url) => {
          const q = new URL(url).searchParams;
          seen.push(q.get('after'));
          return new Response(JSON.stringify(reply(q)), { status: 200, headers: { 'Content-Type': 'application/json' } });
        },
      },
    };
    return seen;
  }

  function loaded(convId, messages) {
    store.wsId = REF;
    const c = store.conv(convId);
    c.loaded = true;
    c.messages = messages;
    return c;
  }

  afterEach(() => {
    store.wsId = null;
    store.convs.clear();
    delete globalThis.puter;
  });

  it('asks from the newest sequence it knows, not from an unsent message', async () => {
    // A message that failed to send stays in the list with no sequence number.
    // Reading "after nothing" would return the newest page, whose hasMore
    // sends the walk straight back around: a request loop with no end.
    const seen = fakeWorker((q) => (q.get('after') == null
      ? { seq: 120, hasMore: true, messages: [{ seq: 120, text: 'newest page' }] }
      : { seq: 120, hasMore: false, messages: [] }));
    loaded('c1', [{ seq: 110, text: 'here' }, { seq: null, failed: true, text: 'not sent' }]);
    await store.fetchNewer('c1');
    expect(seen).toEqual(['110']);
  });

  it('walks on from the end of a page that brings nothing new, and never asks for the same page twice', async () => {
    // A page with more to come and nothing in it is a run of deleted
    // messages as long as the page (three blocks from the one after the
    // newest known): the walk goes on from the page's end, and stops once
    // the reach meets the counter, whatever the answer says about more.
    const seen = fakeWorker(() => ({ seq: 300, hasMore: true, messages: [] }));
    loaded('c2', [{ seq: 10 }]);
    await store.fetchNewer('c2');
    expect(seen).toEqual(['10', '150']);
    expect(store.conv('c2').seq).toBe(300);
  });

  it('keeps walking forward while pages carry new messages', async () => {
    const seen = fakeWorker((q) => {
      const after = Number(q.get('after'));
      const to = Math.min(after + 2, 5);
      return { seq: 5, hasMore: to < 5, messages: Array.from({ length: to - after }, (_, i) => ({ seq: after + i + 1 })) };
    });
    loaded('c3', [{ seq: 0 }]);
    await store.fetchNewer('c3');
    expect(seen).toEqual(['0', '2', '4']);
    expect(store.conv('c3').messages.map((m) => m.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('outbox delivery', () => {
  const REF = 'abc123def0@teamchat-test';
  const realOutbox = store.outbox;

  afterEach(() => {
    store.outbox = realOutbox;
    store.wsId = null;
    store.convs.clear();
    delete globalThis.puter;
  });

  it('sends a queued message under its client id and replaces its placeholder with the real one', async () => {
    const posts = [];
    globalThis.puter = {
      workers: {
        exec: async (url, init) => {
          const body = JSON.parse(init.body);
          posts.push({ path: new URL(url).pathname, body });
          return new Response(JSON.stringify({ message: { seq: 12, user: 'me', text: body.text, ts: 5, kind: 'msg', attachments: body.attachments, mentions: [], reactions: {}, replyCount: 0 } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } });
        },
      },
    };
    store.wsId = REF;
    store.outbox = createOutbox({
      storage: memoryStorage(),
      sendEntry: (e) => store._deliverQueued(e),
      uploadFile: async () => ({ id: 'file0000' }),
      onChange: () => store._syncQueued().catch(() => {}),
    });
    const c = store.conv('c1');
    c.loaded = true;
    c.messages = [{ seq: 11, text: 'before' }, { seq: null, tempId: 'c_q1', cid: 'c_q1', text: 'while offline', queued: true }];
    await store.outbox.enqueue({ id: 'c_q1', ws: REF, conv: 'c1', text: 'while offline', attachments: [{ id: 'fileaaaa' }] });
    const r = await store.outbox.flush();
    expect(r).toEqual({ sent: 1, left: 0 });
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toContain('/conv/c1/messages');
    expect(posts[0].body).toMatchObject({ text: 'while offline', cid: 'c_q1', attachments: [{ id: 'fileaaaa' }] });
    expect(c.messages.map((m) => m.seq)).toEqual([11, 12]);
    expect(c.messages[1].text).toBe('while offline');
    expect(c.seq).toBe(12);
  });

  it('queues a send that failed for want of a connection while the browser still said online, under its client id', async () => {
    let down = true;
    const posts = [];
    globalThis.puter = {
      workers: {
        exec: async (url, init) => {
          if (down) throw new TypeError('fetch failed');
          const body = JSON.parse(init.body);
          posts.push(body);
          return new Response(JSON.stringify({ message: { seq: 7, user: 'me', text: body.text, ts: 1, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0 } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } });
        },
      },
    };
    store.wsId = REF;
    store.outbox = createOutbox({
      storage: memoryStorage(),
      sendEntry: (e) => store._deliverQueued(e),
      uploadFile: async () => ({ id: 'file0000' }),
      onChange: () => store._syncQueued().catch(() => {}),
    });
    const c = store.conv('c4');
    c.loaded = true;
    c.messages = [];
    const temp = await store.send('c4', { text: 'flaky' });
    expect(temp.queued).toBe(true);
    expect(temp.failed).toBeFalsy();
    expect((await store.outbox.list()).map((e) => [e.id, e.ws, e.text])).toEqual([[temp.cid, REF, 'flaky']]);
    // The connection is back: sent once, under the client id the first try carried.
    down = false;
    await store.outbox.flush();
    expect(posts.map((p) => p.cid)).toEqual([temp.cid]);
    expect(c.messages.map((m) => m.seq)).toEqual([7]);
    expect(await store.outbox.list()).toEqual([]);
  });

  it('marks the placeholder failed when the worker refuses, and clears it on retry', async () => {
    let refuse = true;
    globalThis.puter = {
      workers: {
        exec: async () => (refuse
          ? new Response(JSON.stringify({ error: 'read_only', code: 'read_only', message: 'Only admins can post' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
          : new Response(JSON.stringify({ message: { seq: 3, user: 'me', text: 'x', ts: 1, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
      },
    };
    store.wsId = REF;
    store.outbox = createOutbox({
      storage: memoryStorage(),
      sendEntry: (e) => store._deliverQueued(e),
      uploadFile: async () => ({ id: 'file0000' }),
      onChange: () => store._syncQueued().catch(() => {}),
    });
    const c = store.conv('c2');
    c.loaded = true;
    const temp = { seq: null, tempId: 'c_q2', cid: 'c_q2', text: 'x', queued: true, failed: false };
    c.messages = [temp];
    await store.outbox.enqueue({ id: 'c_q2', ws: REF, conv: 'c2', text: 'x', attachments: [] });
    await store.outbox.flush();
    await new Promise((r) => setTimeout(r, 0));
    expect(temp.failed).toBe(true);
    expect(temp.error.message).toBe('Only admins can post');
    expect((await store.outbox.list())[0].failed).toBe(true);
    // Discarding drops the entry from the outbox too, so a reload cannot bring it back.
    const other = { seq: null, tempId: 'c_q3', cid: 'c_q3', text: 'y', queued: true };
    c.messages.push(other);
    await store.outbox.enqueue({ id: 'c_q3', ws: REF, conv: 'c2', text: 'y', attachments: [] });
    store.discard('c2', other);
    await new Promise((r) => setTimeout(r, 0));
    expect((await store.outbox.list()).map((e) => e.id)).toEqual(['c_q2']);
    // Retry goes through the outbox (same client id) and settles the placeholder.
    refuse = false;
    await store.retry('c2', temp);
    expect(c.messages.map((m) => m.seq)).toEqual([3]);
    expect(await store.outbox.list()).toEqual([]);
  });
});

describe('sync after the newest message was deleted', () => {
  const REF = 'abc123def0@teamchat-test';

  afterEach(() => {
    store.wsId = null;
    store.convs.clear();
    store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
    delete globalThis.puter;
  });

  it('stops asking for newer messages and re-reads the overlays instead', async () => {
    const seen = [];
    globalThis.puter = {
      workers: {
        exec: async (url) => {
          const q = new URL(url).searchParams;
          seen.push(q.get('after') != null ? `after=${q.get('after')}` : `${q.get('from')}-${q.get('to')}`);
          // Message 10 was deleted: the counter says 10, no read ever returns it.
          const body = q.get('after') != null
            ? { seq: 10, hasMore: false, messages: [] }
            : { seq: 10, hasMore: false, messages: [{ seq: 9, text: 'edited meanwhile' }] };
          return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
        },
      },
    };
    store.wsId = REF;
    store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
    const c = store.conv('c1');
    c.loaded = true;
    c.messages = [{ seq: 9, text: 'last visible' }];
    c.seq = 9;
    c.xSeen = 100;
    await store._applySync({ now: 1, c: { c1: { s: 10, t: 1, x: 100 } } });
    expect(seen).toEqual(['after=9']);
    expect(c.seq).toBe(10);
    // The next polls: nothing newer to ask for, so an overlay change is picked up.
    await store._applySync({ now: 2, c: { c1: { s: 10, t: 1, x: 200 } } });
    expect(seen).toEqual(['after=9', '9-9']);
    expect(c.messages[0].text).toBe('edited meanwhile');
    await store._applySync({ now: 3, c: { c1: { s: 10, t: 1, x: 200 } } });
    expect(seen).toHaveLength(2);
  });
});

describe('a message posted while the window was being re-read for an overlay change', () => {
  const REF = 'abc123def0@teamchat-test';
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

  afterEach(() => {
    store.wsId = null;
    store.convs.clear();
    store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
    delete globalThis.puter;
  });

  it('is fetched by the next poll rather than taken as already reached', async () => {
    const seen = [];
    globalThis.puter = {
      workers: {
        exec: async (url) => {
          const q = new URL(url).searchParams;
          seen.push(q.get('after') != null ? `after=${q.get('after')}` : `${q.get('from')}-${q.get('to')}`);
          // A reaction landed on 10; by the time the blocks were read for it, someone had posted 11.
          const body = q.get('after') != null
            ? { seq: 11, hasMore: false, messages: [{ seq: 11, text: 'posted meanwhile', user: 'u2' }] }
            : { seq: 11, hasMore: false, messages: [{ seq: 9, text: 'nine' }, { seq: 10, text: 'ten', reactions: { '+1': { u2: 1 } } }] };
          return json(body);
        },
      },
    };
    store.wsId = REF;
    store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
    const c = store.conv('c1');
    c.loaded = true;
    c.messages = [{ seq: 9, text: 'nine' }, { seq: 10, text: 'ten' }];
    c.seq = 10;
    c.xSeen = 0;
    await store._applySync({ now: 1, c: { c1: { s: 10, t: 1, x: 5 } } });
    expect(seen).toEqual(['9-10']);
    expect(c.messages[1].reactions).toEqual({ '+1': { u2: 1 } });
    // What the window has reached is still message 10: the read covered nothing past it.
    expect(c.seq).toBe(10);
    // The poll that reports the new message fetches it.
    await store._applySync({ now: 2, c: { c1: { s: 11, t: 2, x: 5, u: 'u2' } } });
    expect(seen).toEqual(['9-10', 'after=10']);
    expect(c.messages.map((m) => m.seq)).toEqual([9, 10, 11]);
  });
});

describe('a page that fails while newer messages are being read a few blocks at a time', () => {
  const REF = 'abc123def0@teamchat-test';
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

  afterEach(() => {
    store.wsId = null;
    store.convs.clear();
    store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
    delete globalThis.puter;
  });

  it('leaves the rest to the next poll instead of taking the counter as reached', async () => {
    const seen = [];
    let down = true;
    globalThis.puter = {
      workers: {
        exec: async (url) => {
          const after = Number(new URL(url).searchParams.get('after'));
          seen.push(`after=${after}`);
          if (after >= 160 && down) throw new TypeError('fetch failed');
          const hi = Math.min(400, after + 150);
          const messages = [];
          for (let s = after + 1; s <= hi; s++) messages.push({ seq: s, text: `m${s}`, user: 'u2' });
          return json({ seq: 400, hasMore: hi < 400, messages });
        },
      },
    };
    store.wsId = REF;
    store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
    const c = store.conv('c1');
    c.loaded = true;
    c.messages = [{ seq: 10, text: 'ten' }];
    c.seq = 10;
    // Back from a long sleep: the poll finds hundreds of new messages; the second page does not come.
    await store._applySync({ now: 1, c: { c1: { s: 400, t: 1, u: 'u2' } } });
    expect(seen).toEqual(['after=10', 'after=160']);
    expect(c.messages).toHaveLength(151);
    expect(c.seq).toBe(10); // what the window has reached is its newest message, not the counter
    // The next poll picks the reading up where it stopped.
    down = false;
    await store._applySync({ now: 2, c: { c1: { s: 400, t: 1, u: 'u2' } } });
    expect(seen).toEqual(['after=10', 'after=160', 'after=160', 'after=310']);
    expect(c.messages.map((m) => m.seq)).toEqual(Array.from({ length: 391 }, (_, i) => 10 + i));
    expect(c.seq).toBe(400);
  });
});

describe('a poll the worker does not answer', () => {
  const REF = 'abc123def0@teamchat-test';
  const respond = (status, body) => new Response(body, { status, headers: body ? { 'Content-Type': 'application/json' } : {} });
  afterEach(() => {
    clearTimeout(store._timer);
    store._timer = null;
    store.wsId = null;
  });

  async function pollWith(res) {
    globalThis.puter = { workers: { exec: async () => res } };
    store.wsId = REF;
    store._timer = setTimeout(() => {}, 60_000); // the loop is armed, as after startPolling
    const errors = [];
    const off = store.on('error', (e) => errors.push(e));
    await store.poll();
    off();
    return errors;
  }

  it('keeps polling when nothing at the address answers, like the boot path treats it', async () => {
    const errors = await pollWith(respond(404, ''));
    expect(errors.map((e) => e.code)).toEqual(['no_backend']);
    expect(store._timer).not.toBeNull(); // rescheduled: a redeploying worker comes back
  });

  it('stops when the worker itself says the caller is out', async () => {
    const errors = await pollWith(respond(403, JSON.stringify({ code: 'forbidden', message: 'You are not a member of this workspace' })));
    expect(errors.map((e) => e.code)).toEqual(['forbidden']);
    expect(store._timer).toBeNull();
  });
});

describe('the user document', () => {
  afterEach(() => {
    store.user = null;
    store.identity = null;
    delete globalThis.puter;
  });

  it('applies changes made close together one after another, so none is lost', async () => {
    let saved = { v: 1, profile: {}, prefs: { theme: 'dark' }, workspaces: [], worker: null };
    const tick = () => new Promise((r) => setTimeout(r, 5));
    globalThis.puter = {
      kv: {
        get: async () => { await tick(); return JSON.parse(JSON.stringify(saved)); },
        set: async (k, v) => { await tick(); saved = JSON.parse(JSON.stringify(v)); },
      },
    };
    store.user = JSON.parse(JSON.stringify(saved));
    store.identity = { uuid: 'me', username: 'me' };
    await Promise.all([
      store._mutateUser((doc) => { doc.prefs = { ...doc.prefs, starred: ['a'] }; }),
      store._mutateUser((doc) => { doc.prefs = { ...doc.prefs, enterSends: false }; }),
      store._mutateUser((doc) => { doc.workspaces.push({ ref: 'abc123def0@teamchat-test', name: 'Acme' }); }),
    ]);
    expect(saved.prefs).toEqual({ theme: 'dark', starred: ['a'], enterSends: false });
    expect(saved.workspaces).toHaveLength(1);
    expect(store.user.prefs).toEqual(saved.prefs);
  });
});

describe('retrying a failed send', () => {
  const REF = 'abc123def0@teamchat-test';

  afterEach(() => {
    store.wsId = null;
    store.convs.clear();
    delete globalThis.puter;
  });

  it('posts under the same client id, so a message the worker did receive is not doubled', async () => {
    const posts = [];
    let fail = true;
    globalThis.puter = {
      workers: {
        exec: async (url, init) => {
          const body = JSON.parse(init.body);
          posts.push(body);
          if (fail) throw new TypeError('Failed to fetch');
          return new Response(JSON.stringify({ message: { seq: 2, user: 'me', text: body.text, ts: 5, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0 } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } });
        },
      },
    };
    store.wsId = REF;
    const c = store.conv('c1');
    c.loaded = true;
    c.messages = [{ seq: 1, text: 'before' }];
    // For want of a connection: into the outbox, not a failed placeholder.
    const temp = await store.send('c1', { text: 'flaky' });
    expect(temp.queued).toBe(true);
    expect(temp.failed).toBeFalsy();
    expect((await store.outbox.list()).map((e) => e.id)).toEqual([temp.cid]);
    fail = false;
    await store.retry('c1', temp);
    expect(posts).toHaveLength(2);
    expect(posts[1].cid).toBe(posts[0].cid);
    expect(c.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(await store.outbox.list()).toEqual([]);
  });
});

describe('opening a permalink while the newest page is loading', () => {
  const REF = 'abc123def0@teamchat-test';

  afterEach(() => {
    store.wsId = null;
    store.convs.clear();
    delete globalThis.puter;
  });

  it('keeps the permalink window when the older request answers last', async () => {
    let releaseNewest;
    const newest = new Promise((r) => { releaseNewest = r; });
    globalThis.puter = {
      workers: {
        exec: async (url) => {
          const q = new URL(url).searchParams;
          const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
          if (q.get('from') != null) return json({ seq: 500, hasMore: false, messages: [{ seq: 100 }, { seq: 101 }] });
          await newest;
          return json({ seq: 500, hasMore: true, messages: [{ seq: 499 }, { seq: 500 }] });
        },
      },
    };
    store.wsId = REF;
    const events = [];
    const off = store.on('messages', (d) => events.push(d.reason + (d.focus ? `:${d.focus}` : '')));
    const first = store.loadConversation('c1');
    const second = store.loadAround('c1', 100);
    await second;
    releaseNewest();
    await first;
    off();
    const c = store.conv('c1');
    expect(c.messages.map((m) => m.seq)).toEqual([100, 101]);
    expect(c.hasNewer).toBe(true);
    expect(c.loaded).toBe(true);
    expect(c.loading).toBe(false);
    expect(events.filter((e) => e.startsWith('init'))).toEqual(['init:100']);
  });
});

describe('a page in flight when a permalink replaces the window', () => {
  const REF = 'abc123def0@teamchat-test';

  afterEach(() => {
    store.wsId = null;
    store.convs.clear();
    delete globalThis.puter;
  });

  function server(release) {
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    globalThis.puter = {
      workers: {
        exec: async (url) => {
          const q = new URL(url).searchParams;
          if (q.get('from') != null) return json({ seq: 500, hasMore: false, messages: [{ seq: 100 }, { seq: 101 }] });
          await release;
          if (q.get('after') != null) return json({ seq: 500, hasMore: true, messages: [{ seq: 481 }, { seq: 482 }] });
          return json({ seq: 500, hasMore: true, messages: [{ seq: 430 }, { seq: 431 }] });
        },
      },
    };
  }

  it('is not merged into the permalink window by the poll\'s fetchNewer', async () => {
    let go;
    server(new Promise((r) => { go = r; }));
    store.wsId = REF;
    const c = store.conv('c1');
    Object.assign(c, { loaded: true, loading: false, seq: 480, messages: [{ seq: 479 }, { seq: 480 }], hasMore: true, hasNewer: false });
    const newer = store.fetchNewer('c1');
    await store.loadAround('c1', 100);
    go();
    await newer;
    expect(c.messages.map((m) => m.seq)).toEqual([100, 101]);
    expect(c.hasNewer).toBe(true);
    expect(c.loading).toBe(false);
  });

  it('is not merged by loadOlder either', async () => {
    let go;
    server(new Promise((r) => { go = r; }));
    store.wsId = REF;
    const c = store.conv('c1');
    Object.assign(c, { loaded: true, loading: false, seq: 480, messages: [{ seq: 479 }, { seq: 480 }], hasMore: true, hasNewer: false });
    const older = store.loadOlder('c1');
    const around = store.loadAround('c1', 100);
    go();
    await older;
    await around;
    expect(c.messages.map((m) => m.seq)).toEqual([100, 101]);
    expect(c.hasMore).toBe(true);
    expect(c.loading).toBe(false);
  });
});

describe('jumping to a date', () => {
  const REF = 'abc123def0@teamchat-test';

  afterEach(() => {
    store.wsId = null;
    store.convs.clear();
    delete globalThis.puter;
  });

  function history(total, deleted) {
    const reads = [];
    globalThis.puter = {
      workers: {
        exec: async (url) => {
          const q = new URL(url).searchParams;
          const from = Number(q.get('from'));
          const to = Math.min(Number(q.get('to')), total);
          reads.push(`${from}-${to}`);
          const messages = [];
          for (let s = from; s <= to; s++) if (!deleted.has(s)) messages.push({ seq: s, ts: 1000 + s });
          return new Response(JSON.stringify({ seq: total, hasMore: false, messages }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        },
      },
    };
    return reads;
  }

  it('finds the first message on or after the time, deleted messages notwithstanding', async () => {
    store.wsId = REF;
    // The first messages and one in the middle are gone.
    history(400, new Set([1, 2, 3, 4, 5, 6, 7, 221]));
    expect(await store.seqAtOrAfter('c1', 1221)).toBe(222);
    expect(await store.seqAtOrAfter('c1', 1100)).toBe(100);
    expect(await store.seqAtOrAfter('c1', 1001)).toBe(8); // not 1: the opening messages were deleted
    expect(await store.seqAtOrAfter('c1', 1400)).toBe(400);
    expect(await store.seqAtOrAfter('c1', 1401)).toBeNull();
  });

  it('takes about as many reads as a binary search, each of a few messages', async () => {
    store.wsId = REF;
    const reads = history(5000, new Set());
    expect(await store.seqAtOrAfter('c1', 3333)).toBe(2333);
    expect(reads.length).toBeLessThan(16);
  });
});

describe('shared channel links', () => {
  const WS = 'abc123def0@teamchat-test';
  const HOST = 'host00host@teamchat-test';
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const hostBoot = () => ({
    now: Date.now(),
    workspace: { id: 'host00host', name: 'Acme', channels: { hch: { id: 'hch', name: 'design', count: 3, topic: 'Pixels' } }, members: {} },
    me: { role: 'external', channels: ['hch'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} },
    activity: { c: {}, p: {} },
  });

  /** A partner workspace with one entry for Acme's #design, which the member has joined here. */
  function partner() {
    store.wsId = WS;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.ws = { id: 'abc123def0', name: 'Globex', channels: { e1: { id: 'e1', name: 'design-acme', shared: { ref: HOST, ch: 'hch', conn: 'conn000001', host: 'Acme' } } }, members: { 'u-me': { role: 'admin', name: 'Me', username: 'me' } } };
    store.me = { role: 'admin', channels: ['e1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.act = { c: {}, p: {}, w: 0, u: 0 };
    store._localSeen.clear();
    store._seenAt.clear();
    store._notifyPending.clear();
  }

  /** Route each call by path; a handler may throw to stand for a network failure. */
  function worker(routes) {
    const calls = [];
    globalThis.puter = {
      workers: {
        exec: async (url, init = {}) => {
          const path = new URL(url).pathname;
          calls.push(`${init.method || 'GET'} ${path}`);
          const hit = Object.entries(routes).find(([k]) => path.endsWith(k));
          if (!hit) return json({ code: 'not_found', message: 'nope' }, 404);
          return hit[1](init);
        },
      },
    };
    return calls;
  }

  afterEach(() => {
    store.wsId = null;
    store.ws = null;
    store.me = null;
    store.profile = null;
    store.links = new Map();
    store.convs.clear();
    delete globalThis.puter;
  });

  it('counts the saved items, reminders, and scheduled messages kept on a host once its link has loaded', async () => {
    partner();
    const settle = async (until) => { for (let i = 0; i < 40 && !until(); i++) await new Promise((r) => setTimeout(r, 5)); };
    let releaseHost;
    const hostGate = new Promise((r) => { releaseHost = r; });
    worker({
      '/api/ws/host00host': async () => { await hostGate; return json(hostBoot()); },
      '/api/ws/abc123def0/saved': () => json({ items: [{ c: 'e1', s: 2, ts: 2 }] }),
      '/api/ws/host00host/saved': () => json({ items: [{ c: 'hch', s: 7, ts: 7 }] }),
      '/api/ws/abc123def0/scheduled': () => json({ scheduled: [], reminders: [] }),
      '/api/ws/host00host/scheduled': () => json({ scheduled: [{ id: 's1', conv: 'hch', dueAt: 1 }], reminders: [{ id: 'r1', conv: 'hch', dueAt: 2 }] }),
    });
    store._saved = null;
    store._savedCount = 0;
    store._scheduledCount = 0;
    store._reminderCount = 0;
    // The bootstrap: the links start loading, and the Later counts are read at once, before any host has answered.
    store._syncLinks();
    const link = store.links.get(HOST);
    await store.loadSaved();
    await store.loadScheduled();
    expect(store.savedCount()).toBe(1);
    expect(store.reminderCount()).toBe(0);
    releaseHost();
    await link.loading;
    expect(link.loaded).toBe(true);
    // What the host holds for the member counts here, under the entry's id, as soon as the host has answered.
    await settle(() => store.savedCount() === 2 && store.reminderCount() === 1);
    expect(store.savedCount()).toBe(2);
    expect(store.isSaved('e1', 7)).toBe(true);
    expect(store.scheduledCount()).toBe(1);
    expect(store.reminderCount()).toBe(1);
  });

  it('tells a host it cannot reach apart from a connection that has ended, and reaches for the host again', async () => {
    partner();
    let down = true;
    worker({
      '/api/ws/host00host': () => {
        if (down) throw new TypeError('fetch failed');
        return json(hostBoot());
      },
    });
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    // Out of reach is not the same as over: the channel waits, and is not offered for removal.
    expect(store.postAccess('e1')).toEqual({ ok: false, reason: 'shared_unreachable' });
    expect(link.lost).toBe(false);
    expect(link.retryAt).toBeGreaterThan(Date.now());
    expect(store.channel('e1').lost).toBeUndefined();
    // Back up: the retry loads it, and the channel opens.
    down = false;
    await store.retryLink('e1');
    expect(link.loaded).toBe(true);
    expect(store.postAccess('e1')).toEqual({ ok: true, reason: null });
    expect(store.channel('e1').topic).toBe('Pixels');
  });

  it('undoes a join here that the host refuses, and keeps one the host could not answer', async () => {
    partner();
    store.me.channels = [];
    let refuse = true;
    const calls = worker({
      '/channels/e1/join': () => json({ ok: true, shared: { ref: HOST, ch: 'hch', conn: 'conn000001', token: 'x.y' } }),
      '/api/connect/join': () => {
        if (refuse) return json({ code: 'limit', message: 'The workspace hosting this channel is full' }, 400);
        throw new TypeError('fetch failed');
      },
      '/channels/e1/leave': () => json({ ok: true }),
      '/api/ws/abc123def0': () => json({ now: Date.now(), workspace: store.ws, me: { ...store.me, channels: ['e1'] }, activity: { c: {}, p: {} } }),
      '/api/ws/host00host': () => { throw new TypeError('fetch failed'); },
    });
    // Refused: joined here alone, the entry would show a host that keeps refusing; the join is taken back.
    await expect(store.joinChannel('e1')).rejects.toMatchObject({ code: 'limit' });
    expect(calls).toContain('POST /api/ws/abc123def0/channels/e1/leave');
    expect(store.isJoined('e1')).toBe(false);
    expect(store.links.has(HOST)).toBe(false);
    // Not answering is not refusing: the join stands and the channel waits for the host.
    refuse = false;
    calls.length = 0;
    await expect(store.joinChannel('e1')).rejects.toMatchObject({ code: 'network' });
    expect(calls).not.toContain('POST /api/ws/abc123def0/channels/e1/leave');
    expect(store.isJoined('e1')).toBe(true);
    await store.links.get(HOST).loading;
    expect(store.postAccess('e1')).toEqual({ ok: false, reason: 'shared_unreachable' });
  });

  it('tells a host that answered no apart from one that did not answer', async () => {
    partner();
    worker({
      '/api/ws/host00host': () => json({ code: 'reattest', message: 'Your access to this shared channel needs renewing' }, 403),
      '/channels/e1/attest': () => json({ ref: HOST, ch: 'hch', conn: 'conn000001', token: 'x.y' }),
      '/api/connect/join': () => json({ code: 'limit', message: 'The workspace hosting this channel is full' }, 400),
    });
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    // A refusal is the host's word, shown as such: not "cannot be reached", not over either.
    expect(store.postAccess('e1')).toEqual({ ok: false, reason: 'shared_refused' });
    expect(link.error.code).toBe('limit');
    expect(link.lost).toBe(false);
    expect(store.channel('e1').lost).toBeUndefined();
    // Still asked again, like a host out of reach.
    expect(link.retryAt).toBeGreaterThan(Date.now());
  });

  it('marks the channel lost only when the host says the connection is over', async () => {
    partner();
    worker({
      '/api/ws/host00host': () => json({ code: 'forbidden', message: 'You are not a member of this workspace' }, 403),
      '/channels/e1/attest': () => json({ ref: HOST, ch: 'hch', conn: 'conn000001', token: 'x.y' }),
      '/api/connect/join': () => json({ code: 'connection_ended', message: 'This channel is no longer shared with your workspace' }, 404),
    });
    store._syncLinks();
    await store.links.get(HOST).loading;
    expect(store.postAccess('e1')).toEqual({ ok: false, reason: 'shared_lost' });
    expect(store.channel('e1').lost?.code).toBe('connection_ended');
    // A fresh copy of the workspace (as every refresh brings, without the verdict on it) keeps the verdict.
    const { lost, ...fresh } = store.ws.channels.e1;
    expect(lost).toBeTruthy();
    store.ws = { ...store.ws, channels: { e1: fresh } };
    store._syncLinks();
    expect(store.channel('e1').lost?.code).toBe('connection_ended');
    expect(store.postAccess('e1')).toEqual({ ok: false, reason: 'shared_lost' });
  });

  it('tells being removed by the host\'s admins apart from the connection ending, and keeps asking so a restore takes on its own', async () => {
    partner();
    let kept = true;
    const calls = worker({
      '/api/ws/host00host': () => (kept ? json({ code: 'forbidden', message: 'You are not a member of this workspace' }, 403) : json(hostBoot())),
      '/channels/e1/attest': () => json({ ref: HOST, ch: 'hch', conn: 'conn000001', token: 'x.y' }),
      '/api/connect/join': () => (kept ? json({ code: 'removed', message: 'An admin of Acme removed you from its shared channels' }, 403) : json({ exp: Date.now() + 1000 })),
    });
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    // The channel is lost to this member, with the host's reason on it; the connection itself is not over.
    expect(store.postAccess('e1')).toEqual({ ok: false, reason: 'shared_lost' });
    expect(store.channel('e1').lost?.code).toBe('removed');
    expect(link.lost).toBe(false);
    expect(link.retryAt).toBeGreaterThan(Date.now());
    // A refresh does not lose the verdict.
    const { lost, ...fresh } = store.ws.channels.e1;
    store.ws = { ...store.ws, channels: { e1: fresh } };
    store._syncLinks();
    expect(store.channel('e1').lost?.code).toBe('removed');
    // Restored on the host: the next try reads the host, whose document lists the member in the channel again, and the channel opens.
    kept = false;
    calls.length = 0;
    await store.retryLink('e1');
    expect(link.loaded).toBe(true);
    expect(store.channel('e1').lost).toBeUndefined();
    expect(store.postAccess('e1')).toEqual({ ok: true, reason: null });
    expect(calls).toContain('GET /api/ws/host00host');
  });

  it('counts a host whose workspace is gone as a connection that is over, not as one out of reach', async () => {
    partner();
    // The worker answers, in its own words: no such workspace. (An address with no worker behind it is `no_backend` and stays "unreachable".)
    worker({ '/api/ws/host00host': () => json({ code: 'not_found', message: 'Workspace not found' }, 404) });
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    expect(link.lost).toBe(true);
    expect(store.postAccess('e1')).toEqual({ ok: false, reason: 'shared_lost' });
    worker({ '/api/ws/host00host': () => json(null, 404) });
    store.links = new Map();
    store._syncLinks();
    await store.links.get(HOST).loading;
    expect(store.links.get(HOST).lost).toBe(false);
    expect(store.postAccess('e1')).toEqual({ ok: false, reason: 'shared_unreachable' });
  });

  it('accepts a share link only once the workspace is known to take the entry: a taken name never leaves a dangling connection on the host', async () => {
    partner();
    const calls = worker({
      '/api/ws/host00host': () => json(hostBoot()),
      '/api/ws/abc123def0': () => json({ now: Date.now(), workspace: store.ws, me: store.me, activity: { c: {}, p: {} } }),
      '/api/connect/accept': () => json({ conn: 'conn000002', secret: 's'.repeat(32), workspace: { id: 'other00000', name: 'Initech' }, channel: { id: 'ich', name: 'design-acme', topic: '' } }),
      '/channels/shared': (init) => { recorded.push(JSON.parse(init.body)); return json({ channel: { id: 'e2', name: 'design-initech', shared: { ref: 'other00000@teamchat-test', ch: 'ich', conn: 'conn000002', host: 'Initech' } } }); },
    });
    const recorded = [];
    // #design-acme is taken here by Acme's channel: Initech's is refused before the host hears of it.
    const attempt = { server: 'teamchat-test', code: 'AAAA-BBBB-CCCC', wsRef: WS, wsName: 'Globex', host: { ws: 'other00000', ch: 'ich' } };
    await expect(store.acceptConnect({ ...attempt, name: 'design-acme' })).rejects.toMatchObject({ code: 'exists' });
    expect(calls).toEqual([]);
    // The same name for the same channel is the entry itself (an accept repeated renews the connection).
    await expect(store.acceptConnect({ ...attempt, name: 'design-acme', host: { ws: 'host00host', ch: 'hch' } })).resolves.toMatchObject({ ref: WS });
    expect(calls.filter((c) => c.includes('/api/connect/accept'))).toHaveLength(1);
    // A free name goes through.
    const res = await store.acceptConnect({ ...attempt, name: 'design-initech' });
    expect(res.channel.name).toBe('design-initech');
    expect(res.host.name).toBe('Initech');
    // A link spelling the server the long way still records the host under
    // the one spelling the app files it by (the same host as another entry
    // must group under one link, and be the entry itself to a repeated accept).
    calls.length = 0;
    await expect(store.acceptConnect({ ...attempt, server: 'teamchat-test.puter.work', name: 'design-acme', host: { ws: 'host00host', ch: 'hch' } })).resolves.toMatchObject({ ref: WS });
    expect(calls.filter((c) => c.includes('/api/connect/accept'))).toHaveLength(1);
    expect(recorded.at(-1).ref).toBe('other00000@teamchat-test');
    // Not an admin: settled before the host is called too.
    store.me.role = 'member';
    calls.length = 0;
    await expect(store.acceptConnect({ ...attempt, name: 'free-name' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(calls).toEqual([]);
    // The host itself is no partner: refused before it is called, however the server is spelled.
    store.me.role = 'admin';
    await expect(store.acceptConnect({ ...attempt, name: 'free-name', host: { ws: 'abc123def0', ch: 'xch' } })).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.acceptConnect({ ...attempt, server: 'teamchat-test.puter.work', name: 'free-name', host: { ws: 'abc123def0', ch: 'xch' } })).rejects.toMatchObject({ code: 'invalid' });
    expect(calls).toEqual([]);
  });

  it('labels the entry with what the host calls itself now, not what it was called at the accept', async () => {
    partner();
    worker({ '/api/ws/host00host': () => json({ ...hostBoot(), workspace: { ...hostBoot().workspace, name: 'Acme Corp' } }) });
    store._syncLinks();
    await store.links.get(HOST).loading;
    expect(store.channel('e1').shared).toMatchObject({ ref: HOST, ch: 'hch', conn: 'conn000001', host: 'Acme Corp' });
    expect(store.hostOf('e1').ref).toBe(HOST);
  });

  it('counts and clears a host\'s inbox here only for someone who is external there', async () => {
    partner();
    store.me.inbox = 2;
    let role = 'external';
    const calls = worker({
      '/api/ws/host00host': () => { const b = hostBoot(); b.me.role = role; b.me.inbox = 3; return json(b); },
      '/inbox/read': () => json({ ok: true }),
    });
    store._syncLinks();
    await store.links.get(HOST).loading;
    expect(store.inboxUnread()).toBe(5);
    await store.readInbox();
    expect(calls.filter((c) => c.endsWith('/inbox/read'))).toEqual(['POST /api/ws/abc123def0/inbox/read', 'POST /api/ws/host00host/inbox/read']);
    expect(store.inboxUnread()).toBe(0);
    // A member of the host in their own right: its counter covers channels this workspace does not carry, so it stays the host workspace's own.
    role = 'member';
    store.me.inbox = 1;
    store.links = new Map();
    store._syncLinks();
    await store.links.get(HOST).loading;
    calls.length = 0;
    expect(store.inboxUnread()).toBe(1);
    await store.readInbox();
    expect(calls).toEqual(['POST /api/ws/abc123def0/inbox/read']);
    expect(store.links.get(HOST).me.inbox).toBe(3);
  });

  it('keeps what the member does in a shared channel (reading, muting, unfollowing) through a refresh of this workspace', async () => {
    partner();
    const calls = worker({
      '/api/ws/host00host': () => json({ ...hostBoot(), me: { role: 'external', channels: ['hch'], dms: {}, reads: { hch: 3 }, mentions: { hch: 2 }, notify: {}, threads: { hch_t2: 1 } } }),
      '/read': () => json({ ok: true }),
      '/notify': () => json({ ok: true }),
    });
    store._syncLinks();
    await store.links.get(HOST).loading;
    expect(store.mentionCount('e1')).toBe(2);
    expect(store.threadUnread('e1_t2')).toBe(1);
    store.markRead('e1', 5);
    expect(store.mentionCount('e1')).toBe(0);
    await store.setNotify('e1', { mute: true });
    await store.followThread('e1', 2, false);
    await store.markUnread('e1_t2', 1);
    expect(store.isMuted('e1')).toBe(true);
    expect(store.threadUnread('e1_t2')).toBe(0);
    // The host was told, under its own ids.
    expect(calls.filter((c) => c.includes('/api/ws/host00host/conv/'))).toEqual(['PUT /api/ws/host00host/conv/hch/notify', 'PUT /api/ws/host00host/conv/hch_t2/notify', 'POST /api/ws/host00host/conv/hch_t2/read']);
    // A refresh of this workspace brings a fresh `me` and lays the links back over it: nothing the member did is undone.
    store.me = { role: 'admin', channels: ['e1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store._syncLinks();
    expect(store.mentionCount('e1')).toBe(0);
    expect(store.isMuted('e1')).toBe(true);
    expect(store.threadUnread('e1_t2')).toBe(0);
    expect(store.me.reads.e1_t2).toBe(0);
  });

  it('lays the host\'s state over this workspace\'s copy without keeping what the host no longer has', async () => {
    partner();
    let hostMe = { role: 'external', channels: ['hch'], dms: { d1: { members: ['u-me', 'u-x'] } }, reads: { hch: 3, d1: 1 }, mentions: { hch: 2, d1: 1 }, notify: { hch: { mute: true } }, threads: { hch_t2: 1 } };
    worker({ '/api/ws/host00host': () => json({ ...hostBoot(), me: hostMe }) });
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    expect(store.mentionCount('e1')).toBe(2);
    expect(store.mentionCount('h_d1')).toBe(1);
    expect(store.isMuted('e1')).toBe(true);
    expect(store.threadUnread('e1_t2')).toBe(1);
    // Read on another device (mentions cleared, the mute lifted), or a fresh
    // document after a rejoin: what the host says now is all that stands here.
    hostMe = { role: 'external', channels: ['hch'], dms: {}, reads: { hch: 6 }, mentions: {}, notify: {}, threads: {} };
    await store._refreshLink(link);
    expect(store.mentionCount('e1')).toBe(0);
    expect(store.isMuted('e1')).toBe(false);
    expect(store.threadUnread('e1_t2')).toBe(0);
    expect(store.me.reads.e1).toBe(6);
    expect(store.me.dms.h_d1).toBeUndefined();
    expect(store.me.reads.h_d1).toBeUndefined();
    expect(store.me.mentions.h_d1).toBeUndefined();
  });

  it('takes a host\'s direct messages out of the sidebar once the connection is over, and keeps them while the host is merely out of reach', async () => {
    partner();
    let fail = null;
    const hostMe = { role: 'external', channels: ['hch'], dms: { d1: { members: ['u-me', 'u-x'] } }, reads: { d1: 2 }, mentions: {}, notify: {}, threads: {} };
    worker({
      '/api/ws/host00host': () => {
        if (fail === 'down') throw new TypeError('fetch failed');
        if (fail) return json({ code: 'forbidden', message: 'You are not a member of this workspace' }, 403);
        return json({ ...hostBoot(), me: hostMe });
      },
      '/channels/e1/attest': () => json({ ref: HOST, ch: 'hch', conn: 'conn000001', token: 'x.y' }),
      '/api/connect/join': () => json({ code: fail, message: 'no' }, fail === 'removed' ? 403 : 404),
    });
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    expect(store.me.dms.h_d1).toMatchObject({ host: HOST });
    expect(store.me.reads.h_d1).toBe(2);
    // Out of reach (the poll reloads a link on a 403; this stands for that reload failing): the direct message stays, to be read again when the host answers.
    fail = 'down';
    await store._loadLink(link);
    expect(link.loaded).toBe(false);
    expect(store.me.dms.h_d1).toBeDefined();
    // The connection ended: gone, with what was kept under it.
    fail = 'connection_ended';
    await store._loadLink(link);
    expect(link.lost).toBe(true);
    expect(store.me.dms.h_d1).toBeUndefined();
    expect(store.me.reads.h_d1).toBeUndefined();
    // Removed by the host's admins (the host forgets their document there): gone as well.
    fail = null;
    await store._loadLink(link);
    expect(store.me.dms.h_d1).toBeDefined();
    fail = 'removed';
    await store._loadLink(link);
    expect(link.lost).toBe(false);
    expect(store.me.dms.h_d1).toBeUndefined();
  });

  it('leaves nothing unread under a host once the connection is over: a channel with nothing more to show is not shown in bold', async () => {
    partner();
    let fail = null;
    const hostMe = { role: 'external', channels: ['hch'], dms: { d1: { members: ['u-me', 'u-x'] } }, reads: { hch: 40, d1: 2 }, mentions: {}, notify: {}, threads: {} };
    worker({
      '/api/ws/host00host': () => {
        if (fail) return json({ code: 'forbidden', message: 'You are not a member of this workspace' }, 403);
        return json({ ...hostBoot(), me: hostMe, activity: { c: { hch: { s: 40, t: 5, u: 'u-x' }, d1: { s: 2, t: 4, u: 'u-x' } }, p: {} } });
      },
      '/channels/e1/attest': () => json({ ref: HOST, ch: 'hch', conn: 'conn000001', token: 'x.y' }),
      '/api/connect/join': () => json({ code: fail, message: 'no' }, fail === 'removed' ? 403 : 404),
    });
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    store._setTyping({ e1: { 'u-x': Date.now() }, h_d1: { 'u-x': Date.now() } });
    expect(store.unreadCount('e1')).toBe(0);
    expect(store.latestSeq('e1')).toBe(40);
    // The connection ended: the cursors go (see the test above), and so do
    // the counters they were read against; else the entry would count all
    // forty messages as unread.
    fail = 'connection_ended';
    await store._loadLink(link);
    expect(link.lost).toBe(true);
    expect(store.unreadCount('e1')).toBe(0);
    expect(store.act.c.e1).toBeUndefined();
    expect(store.act.c.h_d1).toBeUndefined();
    expect(store.typingIn('e1')).toEqual([]);
    // Back (a restore, a fresh accept): what the host says now stands again.
    fail = null;
    await store._loadLink(link);
    expect(store.latestSeq('e1')).toBe(40);
    expect(store.unreadCount('e1')).toBe(0);
    expect(store.me.reads.h_d1).toBe(2);
  });

  it('tells every host before this workspace goes: a disconnect attestation for each entry when it is deleted, a leave on the host for each channel the member is in there as an external', async () => {
    partner();
    store.ws.channels.e2 = { id: 'e2', name: 'ops-initech', shared: { ref: 'init00init@teamchat-test', ch: 'och', conn: 'conn000002', host: 'Initech' } };
    store.ws.channels.local = { id: 'local', name: 'general' };
    store.me.channels = ['e1', 'e2', 'local'];
    const calls = worker({
      '/api/ws/host00host': () => json(hostBoot()),
      '/api/ws/init00init': () => json({ ...hostBoot(), workspace: { id: 'init00init', name: 'Initech', channels: { och: { id: 'och', name: 'ops' } }, members: {} }, me: { role: 'member', channels: ['och'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} } }),
      '/channels/e1/attest': () => json({ ref: HOST, ch: 'hch', conn: 'conn000001', token: 'x.y' }),
      '/channels/e2/attest': () => json({ code: 'connection_lost', message: 'gone' }, 409),
      '/api/connect/disconnect': () => json({ ok: true }),
      '/channels/hch/leave': () => json({ ok: true }),
    });
    store._syncLinks();
    await Promise.all([...store.links.values()].map((l) => l.loading));
    calls.length = 0;
    // Deleted: each host is told, one entry's word failing does not stop the other's.
    await store.disconnectHosts();
    expect(calls.sort()).toEqual(['POST /api/connect/disconnect', 'POST /api/ws/abc123def0/channels/e1/attest', 'POST /api/ws/abc123def0/channels/e2/attest']);
    calls.length = 0;
    // Left: the member leaves Acme's channel, where they are external; not
    // Initech's, where they are a member in their own right; nothing for the
    // local channel.
    await store.leaveHosts();
    expect(calls).toEqual(['POST /api/ws/host00host/channels/hch/leave']);
  });

  it('counts a host that moved as a connection that is over: the entry is lost in the host\'s words, nothing is renewed there, and the host\'s own refusal reads the same', async () => {
    partner();
    const calls = worker({
      '/api/ws/host00host': () => {
        const boot = hostBoot();
        boot.workspace.movedTo = 'host00host@teamchat-new';
        boot.workspace.members['u-me'] = { role: 'external', name: 'Me', username: 'me', exp: Date.now() + 10 * 60_000 };
        return json(boot);
      },
      '/channels/e1/attest': () => json({ ref: HOST, ch: 'hch', conn: 'conn000001', token: 'x.y' }),
      '/api/connect/join': () => json({ code: 'moved', message: 'This workspace moved; this copy is read-only' }, 423),
    });
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    // The copy still answers (reads work), so the link loads; what it says
    // about itself makes the entry lost, with the gate's wording for it.
    expect(link.loaded).toBe(true);
    expect(store.channel('e1').lost).toMatchObject({ code: 'moved' });
    expect(store.postAccess('e1')).toEqual({ ok: false, reason: 'shared_lost' });
    // The verdict survives a refresh of this workspace, and no renewal is
    // attempted against a host that refuses every write.
    store.ws.channels = { e1: { ...store.ws.channels.e1 } };
    store._syncLinks();
    expect(store.channel('e1').lost).toMatchObject({ code: 'moved' });
    calls.length = 0;
    store._renewLink(link);
    expect(link.renewing).toBeFalsy();
    expect(calls).toEqual([]);
    // Had the host's refusal come first (a member past their standing), it
    // would have said the same.
    link.lostConvs.clear();
    delete store.channel('e1').lost;
    const r = await store._attestLink(link);
    expect(r.ok).toBe(false);
    expect(store.channel('e1').lost).toMatchObject({ code: 'moved' });
  });

  it('opens the conversation one had with someone who has since left rather than asking the worker for a new one', async () => {
    partner();
    const calls = worker({});
    store.ws.former = { 'u-gone': { username: 'gone', name: 'Gina Gone', color: 2, org: { ref: HOST, name: 'Acme' } } };
    store.me.dms = { dm_1: { members: ['u-me', 'u-gone'] } };
    expect(await store.openDmWith('u-gone')).toEqual({ ws: WS, conv: 'dm_1' });
    expect(calls).toEqual([]);
    store.me.dms = {};
    await expect(store.openDmWith('u-gone')).rejects.toMatchObject({ code: 'gone', message: 'Gina Gone is no longer in Globex' });
    expect(calls).toEqual([]);
  });

  it('asks for a link preview by the host\'s setting, not this workspace\'s, in a shared channel', async () => {
    partner();
    store.ws.unfurl = false;
    const calls = worker({
      '/api/ws/host00host': () => json({ ...hostBoot(), workspace: { ...hostBoot().workspace, unfurl: true } }),
      '/conv/hch/messages': () => json({ message: { seq: 4, user: 'u-me', text: 'see https://example.com', ts: 5, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0 } }),
      '/unfurl': () => json({ unfurl: null }),
    });
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    await store.send('e1', { text: 'see https://example.com' });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toContain('POST /api/ws/host00host/conv/hch/messages/4/unfurl');
    // The host has previews off: no request, whatever this workspace's switch says.
    link.ws.unfurl = false;
    store.ws.unfurl = true;
    calls.length = 0;
    await store.send('e1', { text: 'and https://example.org' });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.filter((c) => c.endsWith('/unfurl'))).toEqual([]);
    expect(store.unfurlsIn('e1')).toBe(false);
    expect(store.unfurlsIn('c-local')).toBe(true);
  });

  it('carries a host\'s direct messages here only for an external member; a member of the host in their own right has them there', async () => {
    partner();
    let role = 'member';
    const boot = () => ({
      ...hostBoot(),
      workspace: { ...hostBoot().workspace, members: { 'u-x': { role: 'member', name: 'Xavier', username: 'x' } } },
      me: { role, channels: ['hch'], dms: { d1: { members: ['u-me', 'u-x'] } }, reads: { hch: 1, d1: 2 }, mentions: { d1: 1 }, notify: { d1: { mute: true } }, threads: { d1_t1: 1 } },
    });
    const calls = worker({
      '/api/ws/host00host': () => json(boot()),
      '/dms': () => json({ conv: 'd1', members: ['u-me', 'u-x'] }),
    });
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    // Admin of both Globex and Acme, looking at Globex: Acme's direct messages are Acme's, not doubled here.
    expect(store.me.dms.h_d1).toBeUndefined();
    expect(store.me.reads.h_d1).toBeUndefined();
    expect(store.me.mentions.h_d1).toBeUndefined();
    expect(store.me.notify.h_d1).toBeUndefined();
    expect(store.me.threads.h_d1_t1).toBeUndefined();
    expect(store.me.reads.e1).toBe(1);
    expect(store.dms()).toEqual([]);
    // Messaging someone met in the shared channel opens the conversation where it lives: on the host, as itself.
    calls.length = 0;
    expect(await store.openDmWith('u-x')).toEqual({ ws: HOST, conv: 'd1' });
    expect(calls).toEqual(['POST /api/ws/host00host/dms']);
    expect(store.me.dms.h_d1).toBeUndefined();
    // An external member is on the host for the shared channel alone: their direct messages there sit here, under External connections.
    role = 'external';
    await store._refreshLink(link);
    expect(store.me.dms.h_d1).toMatchObject({ host: HOST, members: ['u-me', 'u-x'] });
    expect(store.me.reads.h_d1).toBe(2);
    expect(store.mentionCount('h_d1')).toBe(1);
    expect(store.isMuted('h_d1')).toBe(true);
    expect(store.threadUnread('h_d1_t1')).toBe(1);
    expect(store.dms().map((d) => d.id)).toEqual(['h_d1']);
    expect(await store.openDmWith('u-x')).toEqual({ ws: WS, conv: 'h_d1' });
  });

  it('does not wait for a host to answer a poll: this workspace\'s own sync lands first, the host\'s when it comes', async () => {
    partner();
    let release;
    const hostAnswers = new Promise((r) => { release = r; });
    const calls = worker({
      '/api/ws/host00host': () => json({ ...hostBoot(), workspace: { ...hostBoot().workspace, members: { 'u-them': { role: 'member', name: 'Them', username: 'them' } } } }),
      '/api/ws/host00host/sync': () => hostAnswers.then(() => json({ now: Date.now(), c: { hch: { s: 7, t: 5, u: 'u-them' } }, p: {}, t: { hch: { 'u-them': Date.now() } }, w: 0, u: 0 })),
      '/api/ws/abc123def0/sync': () => json({ now: Date.now(), c: { general: { s: 3, t: 4, u: 'u-them' } }, p: {}, w: 0, u: 0 }),
    });
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    const incoming = [];
    const off = store.on('incoming', (list) => incoming.push(...list.map((n) => n.conv)));
    await store.poll();
    // Landed here while the host is still silent.
    expect(store.act.c.general).toMatchObject({ s: 3 });
    expect(store.act.c.e1).toBeUndefined();
    expect(incoming).toEqual(['general']);
    const inflight = link.syncing;
    expect(inflight).toBeTruthy();
    // The next poll asks this workspace again, not the host it is still waiting on.
    await store.poll();
    expect(calls.filter((c) => c.endsWith('/api/ws/host00host/sync'))).toHaveLength(1);
    expect(calls.filter((c) => c.endsWith('/api/ws/abc123def0/sync'))).toHaveLength(2);
    // The host's answer is folded in when it comes, under local ids.
    release();
    await inflight;
    expect(store.act.c.e1).toMatchObject({ s: 7 });
    expect(incoming).toEqual(['general', 'e1']);
    expect(store.typingIn('e1')).toEqual(['u-them']);
    expect(link.syncing).toBeNull();
    // This workspace's next poll says nobody is typing here; what the host said stands until it says otherwise.
    await store.poll();
    expect(store.typingIn('e1')).toEqual(['u-them']);
    off();
  });

  it('names someone who left, here or on the host, on what they wrote', async () => {
    partner();
    store.ws.former = { 'u-left': { username: 'left', name: 'Lena Left', color: 3, at: 1 } };
    worker({ '/api/ws/host00host': () => json({ ...hostBoot(), workspace: { ...hostBoot().workspace, former: { 'u-ext': { username: 'ext', name: 'Ed External', color: 4, org: { name: 'Initech', ref: 'x@y' }, at: 1 } } } }) });
    store._syncLinks();
    await store.links.get(HOST).loading;
    expect(store.member('u-left')).toMatchObject({ name: 'Lena Left', role: 'member', gone: true });
    expect(store.member('u-ext')).toMatchObject({ name: 'Ed External', role: 'external', org: { name: 'Initech' }, gone: true });
    expect(store.member('u-nobody')).toMatchObject({ name: 'Former member', gone: true });
    // A current card always wins over a remembered one.
    store.ws.members['u-left'] = { role: 'member', name: 'Lena Back', username: 'left' };
    expect(store.member('u-left')).toMatchObject({ name: 'Lena Back' });
    expect(store.member('u-left').gone).toBeUndefined();
  });

  it('asks to be let back into a channel the host does not list the member in, instead of calling it lost', async () => {
    partner();
    let joined = false;
    const calls = worker({
      '/api/ws/host00host': () => {
        const boot = hostBoot();
        if (!joined) {
          boot.me.channels = [];
          boot.workspace.channels = {};
        }
        return json(boot);
      },
      '/channels/e1/attest': () => json({ ref: HOST, ch: 'hch', conn: 'conn000001', token: 'x.y' }),
      '/api/connect/join': () => { joined = true; return json({ channel: 'hch', exp: Date.now() + 1000 }); },
    });
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    // Not lost: the member simply is not in it on the host, so Join is offered while the store asks on its own.
    expect(store.channel('e1').lost).toBeUndefined();
    expect(store.postAccess('e1')).toEqual({ ok: false, reason: 'not_joined' });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toContain('POST /api/connect/join');
    expect(store.postAccess('e1')).toEqual({ ok: true, reason: null });
  });

  it('keeps the channel on screen while the host asks for a fresh attestation, and takes it away only when the reload fails', async () => {
    partner();
    let renewed = false;
    let down = false;
    const calls = worker({
      '/api/ws/host00host': () => {
        if (down) throw new TypeError('fetch failed');
        return renewed ? json(hostBoot()) : json({ code: 'reattest', message: 'Your access to this shared channel needs renewing' }, 403);
      },
      '/channels/e1/attest': () => json({ ref: HOST, ch: 'hch', conn: 'conn000001', token: 'x.y' }),
      '/api/connect/join': () => { renewed = true; return json({ channel: 'hch', exp: Date.now() + 86400_000 }); },
    });
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    expect(store.postAccess('e1')).toEqual({ ok: true, reason: null });
    // A day later the host's poll answers 403: the link reloads (attesting on the way) with the channel still open.
    renewed = false;
    calls.length = 0;
    const sync = store._applySync({ now: Date.now(), c: {}, p: {} }, [{ link, error: new ApiError(403, 'reattest', 'renew') }]);
    expect(link.loading).toBeTruthy();
    expect(link.loaded).toBe(true);
    expect(store._liveLinks()).toEqual([]); // not polled while it reloads
    expect(store.postAccess('e1')).toEqual({ ok: true, reason: null });
    await sync;
    expect(calls).toEqual(['GET /api/ws/host00host', 'POST /api/ws/abc123def0/channels/e1/attest', 'POST /api/connect/join', 'GET /api/ws/host00host']);
    expect(store.postAccess('e1')).toEqual({ ok: true, reason: null });
    expect(store._liveLinks()).toEqual([link]);
    // A reload that fails outright is what takes the channel off the screen.
    down = true;
    await store._applySync({ now: Date.now(), c: {}, p: {} }, [{ link, error: new ApiError(403, 'reattest', 'renew') }]);
    expect(link.loaded).toBe(false);
    expect(store.postAccess('e1')).toEqual({ ok: false, reason: 'shared_unreachable' });
  });

  it('renews the member\'s standing on the host before it lapses, quietly', async () => {
    partner();
    const soon = Date.now() + 30 * 60_000;
    const later = Date.now() + 86400_000;
    const calls = worker({
      '/api/ws/host00host': () => {
        const boot = hostBoot();
        boot.workspace.members['u-me'] = { role: 'external', name: 'Me', username: 'me', exp: soon };
        return json(boot);
      },
      '/channels/e1/attest': () => json({ ref: HOST, ch: 'hch', conn: 'conn000001', token: 'x.y' }),
      '/api/connect/join': () => json({ channel: 'hch', exp: later }),
    });
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    calls.length = 0;
    store._renewLink(link);
    expect(link.renewing).toBeTruthy();
    await link.renewing;
    expect(calls).toEqual(['POST /api/ws/abc123def0/channels/e1/attest', 'POST /api/connect/join']);
    expect(link.ws.members['u-me'].exp).toBe(later);
    expect(link.loaded).toBe(true);
    // Renewed for a day: nothing more to do for now.
    store._renewLink(link);
    expect(link.renewing).toBeNull();
    // Someone who is a member of the host in their own right has nothing that lapses.
    link.ws.members['u-me'] = { role: 'member', name: 'Me' };
    store._renewLink(link);
    expect(link.renewing).toBeNull();
    expect(calls).toHaveLength(2);
  });
});

describe('a send that lands past the newest message the window holds', () => {
  const REF = 'abc123def0@teamchat-test';
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const settle = async (until) => { for (let i = 0; i < 20 && !until(); i++) await new Promise((r) => setTimeout(r, 5)); };

  afterEach(() => {
    store.wsId = null;
    store.me = null;
    store.convs.clear();
    delete globalThis.puter;
  });

  it('reads what others posted in between, which the poll would never come back for', async () => {
    let next = 12;
    const reads = [];
    globalThis.puter = {
      workers: {
        exec: async (url, init) => {
          const u = new URL(url);
          if ((init?.method || 'GET') === 'POST') return json({ message: { seq: next, user: 'u-me', text: 'mine', ts: 5, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0 } });
          reads.push(`${u.searchParams.get('from')}-${u.searchParams.get('to')}`);
          return json({ seq: next, hasMore: false, messages: [{ seq: 10, text: 'theirs', user: 'u2', ts: 3 }, { seq: 11, text: 'and theirs', user: 'u3', ts: 4 }] });
        },
      },
    };
    store.wsId = REF;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
    const c = store.conv('c1');
    c.loaded = true;
    c.messages = [{ seq: 9, text: 'before', user: 'u2', ts: 1 }];
    c.seq = 9;
    await store.send('c1', { text: 'mine' });
    await settle(() => c.messages.length === 4);
    expect(reads).toEqual(['10-11']);
    expect(c.messages.map((m) => m.seq)).toEqual([9, 10, 11, 12]);
    // The poll, told the counter is where our message is, has nothing left to fetch: the gap was the only chance.
    await store._applySync({ now: 1, c: { c1: { s: 12, t: 5, u: 'u-me' } } });
    expect(reads).toEqual(['10-11']);
    // Right after the newest: nothing to read.
    next = 13;
    await store.send('c1', { text: 'mine again' });
    await settle(() => c.messages.length === 5);
    expect(reads).toEqual(['10-11']);
    expect(c.messages.map((m) => m.seq)).toEqual([9, 10, 11, 12, 13]);
  });
});

describe('presence on screen', () => {
  const REF = 'abc123def0@teamchat-test';
  const setUp = () => {
    store.wsId = REF;
    store.identity = { uuid: 'u-me' };
    store.ws = { id: 'abc123def0', members: { 'u-me': { name: 'Me' }, 'u-ana': { name: 'Ana' } }, channels: {} };
    store.me = { reads: {}, mentions: {}, channels: [], dms: {} };
    store.links = new Map();
    store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
    store._presenceSeen = '';
    store._presenceMoved();
  };
  afterEach(() => {
    store.wsId = null;
    store.identity = null;
    store.ws = null;
  });

  it('redraws when a silence lets someone lapse from active to away, and not for a heartbeat that changes nothing', async () => {
    setUp();
    let events = 0;
    const off = store.on('activity', () => events++);
    // Ana's heartbeat arrives: she turns active.
    await store._applySync({ now: 1, c: {}, p: { 'u-ana': Date.now() - 1000 } });
    expect(store.presenceOf('u-ana')).toBe('active');
    expect(events).toBe(1);
    // Another heartbeat keeps her active: nothing on screen changes, so nothing is redrawn.
    await store._applySync({ now: 2, c: {}, p: { 'u-ana': Date.now() } });
    expect(events).toBe(1);
    // Her tab closes. Every poll now comes back empty; a minute and a half
    // later she is away, and the surfaces must hear about it all the same.
    store.act.p['u-ana'] = Date.now() - (PRESENCE_WINDOW_MS + 10_000);
    await store._applySync({ now: 3, c: {}, p: {} });
    expect(store.presenceOf('u-ana')).toBe('away');
    expect(events).toBe(2);
    await store._applySync({ now: 4, c: {}, p: {} });
    expect(events).toBe(2);
    off();
  });

  it('redraws for a lapse even while the worker is out of reach', async () => {
    setUp();
    store.act.p['u-ana'] = Date.now() - 1000;
    store._presenceMoved();
    globalThis.puter = { workers: { exec: async () => { throw new Error('offline'); } } };
    store._timer = setTimeout(() => {}, 60_000);
    let events = 0;
    const off = store.on('activity', () => events++);
    const offErr = store.on('error', () => {});
    store.act.p['u-ana'] = Date.now() - (PRESENCE_WINDOW_MS + 10_000);
    await store.poll();
    expect(events).toBe(1);
    expect(store.presenceOf('u-ana')).toBe('away');
    off();
    offErr();
    clearTimeout(store._timer);
    store._timer = null;
  });
});

describe('presence against the worker clock', () => {
  afterEach(() => {
    store.wsId = null;
    store.identity = null;
    store.ws = null;
    store._clockOffset = 0;
  });

  it('measures heartbeats against the worker clock the poll reports, not this device', async () => {
    store.wsId = 'abc123def0@teamchat-test';
    store.identity = { uuid: 'u-me' };
    store.ws = { id: 'abc123def0', members: { 'u-me': {}, 'u-ana': {} }, channels: {} };
    store.links = new Map();
    store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
    // This device runs two minutes ahead of the worker. Ana's heartbeat is a
    // second old by the worker's clock; by this device's it would look two minutes old.
    const workerNow = Date.now() - 120_000;
    await store._applySync({ now: workerNow - 2000, ts: workerNow, c: {}, p: { 'u-ana': workerNow - 1000 } });
    expect(store.presenceOf('u-ana')).toBe('active');
    expect(store.isOnline('u-ana')).toBe(true);
    // And the other way: a heartbeat older than the window by the worker's
    // clock is away, however fresh it looks against this device's.
    const skew = PRESENCE_WINDOW_MS + 30_000;
    const behind = Date.now() + skew;
    await store._applySync({ now: behind - 2000, ts: behind, c: {}, p: { 'u-ana': behind - (PRESENCE_WINDOW_MS + 10_000) } });
    expect(store.presenceOf('u-ana')).toBe('away');
    // A poll without a clock (an older worker) keeps the last offset rather than forgetting it.
    await store._applySync({ now: behind, c: {}, p: {} });
    expect(store._clockOffset).toBeCloseTo(skew, -3);
  });
});

describe('presence as a workspace opens', () => {
  afterEach(() => {
    clearTimeout(store._timer);
    store._timer = null;
    store.wsId = null;
    store.identity = null;
    store.ws = null;
    store._lastHeartbeat = 0;
  });

  it('heartbeats with the bootstrap and not again on the first poll', async () => {
    const REF = 'abc123def0@teamchat-test';
    const urls = [];
    const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    globalThis.puter = {
      workers: {
        exec: async (url) => {
          urls.push(url);
          const path = new URL(url).pathname;
          if (path === '/api/ws/abc123def0') {
            return json({ now: Date.now(), workspace: { id: 'abc123def0', name: 'Acme', channels: {}, members: { 'u-me': { name: 'Me' } } }, me: { role: 'admin', channels: [], dms: {}, reads: {}, mentions: {} }, activity: { c: {}, p: {}, w: 1, u: {} } });
          }
          if (path === '/api/ws/abc123def0/sync') return json({ now: Date.now() - 2000, ts: Date.now(), c: {}, p: {}, w: 1, u: 0 });
          return json({ items: [] });
        },
      },
    };
    store.identity = { uuid: 'u-me' };
    store.profile = { uuid: 'u-me', prefs: {} };
    store._lastHeartbeat = Date.now(); // as after a heartbeat in the workspace open before
    await store.openWorkspace(REF);
    const boot = urls.find((u) => new URL(u).pathname === '/api/ws/abc123def0');
    // No document here: the tab counts as in view.
    expect(new URL(boot).searchParams.get('hb')).toBe('1');
    expect(Date.now() - store._lastHeartbeat).toBeLessThan(1000);
    await store.poll();
    const sync = urls.find((u) => new URL(u).pathname === '/api/ws/abc123def0/sync');
    expect(sync).toBeTruthy();
    expect(new URL(sync).searchParams.get('hb')).toBeNull();
  });
});

describe('a tab that closes', () => {
  const REF = 'abc123def0@teamchat-test';
  let calls;
  const arm = () => {
    calls = [];
    globalThis.puter = { workers: { exec: async (url, init = {}) => { calls.push(`${init.method || 'GET'} ${new URL(url).pathname}${init.keepalive ? ' keepalive' : ''}`); return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }); } } };
    store.wsId = REF;
    store.identity = { uuid: 'u-me' };
    store.links = new Map();
    store._siblingBeats = new Map();
  };
  afterEach(() => {
    store.wsId = null;
    store.identity = null;
    store._lastHeartbeat = 0;
  });

  it('says goodbye for the person when it is what keeps them active, and clears its heartbeat clock', async () => {
    arm();
    store._lastHeartbeat = Date.now() - 10_000;
    store._sayBye();
    await Promise.resolve();
    expect(calls).toEqual(['DELETE /api/ws/abc123def0/presence keepalive']);
    expect(store._lastHeartbeat).toBe(0);
  });

  it('says nothing when it has not been heard from within the active window, or never heartbeated here', async () => {
    arm();
    store._lastHeartbeat = Date.now() - (PRESENCE_WINDOW_MS + 10_000); // hidden a while: already away
    store._sayBye();
    store._lastHeartbeat = 0; // opened hidden, never present
    store._sayBye();
    await Promise.resolve();
    expect(calls).toEqual([]);
  });

  it('says nothing while another tab of the account keeps the person here', async () => {
    arm();
    store._lastHeartbeat = Date.now() - 10_000;
    store._siblingBeats.set(REF, Date.now() - 20_000);
    store._sayBye();
    await Promise.resolve();
    expect(calls).toEqual([]);
    // A sibling not heard from in a heartbeat's time and change is gone too: this tab speaks.
    store._lastHeartbeat = Date.now() - 10_000;
    store._siblingBeats.set(REF, Date.now() - 60_000);
    store._sayBye();
    await Promise.resolve();
    expect(calls).toEqual(['DELETE /api/ws/abc123def0/presence keepalive']);
  });

  it('hears a sibling\'s goodbye said for it and heartbeats at the next poll', async () => {
    arm();
    store.ws = { id: 'abc123def0', members: { 'u-me': {} }, channels: {} };
    store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
    store._lastHeartbeat = Date.now() - 5000;
    await store._applySync({ now: 1, c: {}, p: { 'u-me': Date.now() }, ps: { 'u-me': 'off' } });
    expect(store._lastHeartbeat).toBe(0);
    store.ws = null;
  });

  it('counts someone whose tab said goodbye as not here', () => {
    arm();
    store.ws = { id: 'abc123def0', members: { 'u-me': {}, 'u-ana': {} }, channels: {} };
    store.act = { c: {}, p: { 'u-ana': Date.now() - 30_000 }, ps: { 'u-ana': 'off' }, w: 0, u: 0 };
    expect(store.presenceOf('u-ana')).toBe('away');
    expect(store.isOnline('u-ana')).toBe(false);
    store.act.ps = { 'u-ana': 'dnd' };
    expect(store.isOnline('u-ana')).toBe(true);
    store.ws = null;
  });
});

describe('a change of do not disturb', () => {
  const REF = 'abc123def0@teamchat-test';
  afterEach(() => {
    clearTimeout(store._timer);
    store._timer = null;
    store.wsId = null;
    store.identity = null;
    store.profile = null;
    store.ws = null;
    store._lastHeartbeat = 0;
    store._lastFlag = null;
  });

  it('goes out with the very next poll, paused or resumed, rather than at the next heartbeat', async () => {
    const urls = [];
    globalThis.puter = { workers: { exec: async (url) => { urls.push(new URL(url)); return new Response(JSON.stringify({ now: Date.now() - 2000, ts: Date.now(), c: {}, p: {}, w: 0, u: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } } };
    store.wsId = REF;
    store.identity = { uuid: 'u-me' };
    store.profile = { uuid: 'u-me', prefs: {} };
    store.ws = { id: 'abc123def0', members: { 'u-me': {} }, channels: {} };
    store.links = new Map();
    store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
    store._timer = setTimeout(() => {}, 60_000);
    store._beat(REF, null); // a plain heartbeat just went out
    await store.poll();
    expect(urls[0].searchParams.get('hb')).toBeNull();
    // Notifications paused: the next poll carries the heartbeat and the flag at once.
    store.profile.prefs.pauseUntil = Date.now() + 3_600_000;
    await store.poll();
    expect(urls[1].searchParams.get('hb')).toBe('1');
    expect(urls[1].searchParams.get('st')).toBe('dnd');
    // Nothing changed: no heartbeat before its time.
    await store.poll();
    expect(urls[2].searchParams.get('hb')).toBeNull();
    // The pause ends (by the clock here): the next poll clears the flag, again at once.
    store.profile.prefs.pauseUntil = Date.now() - 1;
    await store.poll();
    expect(urls[3].searchParams.get('hb')).toBe('1');
    expect(urls[3].searchParams.get('st')).toBeNull();
  });
});

describe('a tab left alone', () => {
  const REF = 'abc123def0@teamchat-test';
  afterEach(() => {
    clearTimeout(store._timer);
    store._timer = null;
    store.wsId = null;
    store.identity = null;
    store.profile = null;
    store.ws = null;
    store.huddle = null;
    store._lastHeartbeat = 0;
    store._lastFlag = null;
    store._lastInput = Date.now();
  });

  it('stops heartbeating after ten idle minutes, unless in a huddle, and starts again at the first touch', async () => {
    const urls = [];
    globalThis.puter = { workers: { exec: async (url) => { urls.push(new URL(url)); return new Response(JSON.stringify({ now: Date.now() - 2000, ts: Date.now(), c: {}, p: {}, w: 0, u: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } } };
    store.wsId = REF;
    store.identity = { uuid: 'u-me' };
    store.profile = { uuid: 'u-me', prefs: {} };
    store.ws = { id: 'abc123def0', members: { 'u-me': {} }, channels: {} };
    store.links = new Map();
    store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
    store._timer = setTimeout(() => {}, 60_000);
    store._lastHeartbeat = Date.now() - 60_000; // due
    store._lastInput = Date.now() - 11 * 60_000; // nobody has touched the tab for eleven minutes
    expect(store._present()).toBe(false);
    await store.poll();
    expect(urls[0].searchParams.get('hb')).toBeNull();
    // In a call, though, the person is here without touching anything.
    store.huddle = {};
    expect(store._present()).toBe(true);
    await store.poll();
    expect(urls[1].searchParams.get('hb')).toBe('1');
    store.huddle = null;
    store._lastHeartbeat = Date.now() - 60_000;
    // The first touch, and the heartbeat is back.
    store._lastInput = Date.now();
    await store.poll();
    expect(urls[2].searchParams.get('hb')).toBe('1');
  });
});

describe('window eviction', () => {
  afterEach(() => {
    store.wsId = null;
    store.me = null;
    store.openConv = null;
    store.openThread = null;
    store.convs.clear();
  });

  it('keeps a window holding an unsent message, and drops the idle one left longest ago instead', () => {
    store.wsId = 'abc123def0@teamchat-test';
    store.me = { dms: {}, channels: [] };
    // Sixteen channels visited in order, ch0 the longest ago: beside the
    // open one and the two holding unsent messages, thirteen idle windows,
    // one more than the twelve kept.
    for (let i = 0; i < 16; i++) {
      const c = store.conv(`ch${i}`);
      c.loaded = true;
      c.openedAt = 1000 + i;
      c.messages = [{ seq: 1, text: 'hi' }];
    }
    // Written offline in ch0 (queued), refused by the worker in ch1 (failed): neither has a sequence number yet.
    store.conv('ch0').messages.push({ seq: null, tempId: 'c_q', cid: 'c_q', text: 'later', queued: true });
    store.conv('ch1').messages.push({ seq: null, tempId: 'c_f', cid: 'c_f', text: 'nope', failed: true });
    store.setOpen('ch15');
    expect(store.convs.has('ch0')).toBe(true);
    expect(store.convs.has('ch1')).toBe(true);
    // ch2 is the oldest of the rest, and the one to go.
    expect(store.convs.has('ch2')).toBe(false);
    expect(store.convs.has('ch3')).toBe(true);
    expect(store.convs.size).toBe(15);
  });
});

describe('the Later lists and the pins answered after a switch of workspace', () => {
  const A = 'aaaaaa0001@teamchat-test';
  const B = 'bbbbbb0002@teamchat-test';
  const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  let release; // lets workspace A's slow worker answer

  beforeEach(() => {
    const gate = new Promise((r) => { release = r; });
    globalThis.puter = {
      workers: {
        exec: async (url) => {
          const path = new URL(url).pathname;
          const a = path.startsWith('/api/ws/aaaaaa0001/');
          if (a) await gate;
          if (path.endsWith('/saved')) return json({ items: a ? [{ c: 'dm_x', s: 3, ts: 3 }, { c: 'dm_x', s: 4, ts: 4 }] : [{ c: 'dm_x', s: 9, ts: 9 }] });
          if (path.endsWith('/scheduled')) return json(a ? { scheduled: [{ id: 's1', conv: 'general', dueAt: 1 }, { id: 's2', conv: 'general', dueAt: 2 }], reminders: [{ id: 'r1', conv: 'general', dueAt: 3 }] } : { scheduled: [], reminders: [{ id: 'r9', conv: 'general', dueAt: 9 }] });
          if (path.endsWith('/pins')) return json({ pins: a ? [{ seq: 3, by: 'u', ts: 3 }] : [] });
          return json({});
        },
      },
    };
    store.links = new Map();
    store.me = null;
    store.ws = null;
    store.act = { c: {}, p: {}, w: 0, u: 0 };
  });

  afterEach(() => {
    store.wsId = null;
    store._saved = null;
    store._savedCount = 0;
    store._scheduledCount = 0;
    store._reminderCount = 0;
    store._pins = new Map();
    delete globalThis.puter;
  });

  /** What openWorkspace does to these on a switch. */
  const switchTo = (ref) => {
    store.wsId = ref;
    store._pins = new Map();
    store._saved = null;
    store._savedCount = 0;
    store._scheduledCount = 0;
    store._reminderCount = 0;
  };

  it('does not count another workspace\'s saved items, reminders, or pins here', async () => {
    switchTo(A);
    const slow = [store.loadSaved(), store.loadScheduled(), store.loadPins('dm_x')];
    // B opens while A's worker is still thinking; B's own loads land first.
    switchTo(B);
    await store.loadSaved();
    await store.loadScheduled();
    await store.loadPins('dm_x');
    expect(store.savedCount()).toBe(1);
    expect(store.reminderCount()).toBe(1);
    expect(store.scheduledCount()).toBe(0);
    release();
    const [saved, sched, pins] = await Promise.all(slow);
    // The callers get their lists; the counts and caches stay B's.
    expect(saved).toHaveLength(2);
    expect(sched.scheduled).toHaveLength(2);
    expect(pins).toHaveLength(1);
    expect(store.savedCount()).toBe(1);
    expect(store.isSaved('dm_x', 9)).toBe(true);
    expect(store.isSaved('dm_x', 3)).toBe(false);
    expect(store.scheduledCount()).toBe(0);
    expect(store.reminderCount()).toBe(1);
    // The same direct message id in both workspaces: B's pins, none, are what its cache holds.
    expect(await store.loadPins('dm_x')).toEqual([]);
  });
});

describe('a line the worker wrote for the reader', () => {
  const REF = 'abc123def0@teamchat-test';
  const setUp = () => {
    store.wsId = REF;
    store.identity = { uuid: 'u-me' };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.ws = { id: 'abc123def0', members: { 'u-me': { name: 'Me' } }, channels: {} };
    store.me = { role: 'member', channels: [], dms: { dm_self: { members: ['u-me'] } }, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.links = new Map();
    store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
    store._localSeen = new Map();
  };

  it('stays unread when the activity names the system as its author, and is announced', async () => {
    setUp();
    const incoming = [];
    const off = store.on('incoming', (list) => incoming.push(...list));
    // A reminder come due lands in the reader's own space under their uuid,
    // but the activity entry says the system wrote it: not a line they sent
    // from another tab, so nothing marks it read here.
    await store._applySync({ now: 1, c: { dm_self: { s: 1, t: 1, u: 'sys' } } });
    off();
    expect(store.unreadCount('dm_self')).toBe(1);
    expect(store.me.reads.dm_self).toBeUndefined();
    expect(incoming).toEqual([{ conv: 'dm_self', from: 'sys', seq: 1 }]);
  });

  it('is read at once when the reader wrote it themselves elsewhere', async () => {
    setUp();
    const incoming = [];
    const off = store.on('incoming', (list) => incoming.push(...list));
    await store._applySync({ now: 1, c: { dm_self: { s: 1, t: 1, u: 'u-me' } } });
    off();
    expect(store.unreadCount('dm_self')).toBe(0);
    expect(incoming).toEqual([]);
  });
});

describe('a workspace still being imported', () => {
  it('is read-only in every conversation of its own, and says so', () => {
    store.wsId = 'abc123def0@teamchat-test';
    store.identity = { uuid: 'u-me' };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.ws = { id: 'abc123def0', importing: true, members: { 'u-me': { role: 'owner' } }, channels: { c1: { id: 'c1', name: 'general' } } };
    store.me = { role: 'owner', channels: ['c1'], dms: { dm1: { members: ['u-me', 'u-ana'] } }, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.links = new Map();
    store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
    expect(store.postAccess('c1')).toEqual({ ok: false, reason: 'importing' });
    expect(store.postAccess('c1', { thread: true })).toEqual({ ok: false, reason: 'importing' });
    expect(store.postAccess('dm1')).toEqual({ ok: false, reason: 'importing' });
    // Open: as before.
    delete store.ws.importing;
    expect(store.postAccess('c1').ok).toBe(true);
    expect(store.postAccess('dm1').ok).toBe(true);
  });
});

describe('a send that lands far past the newest message the window holds', () => {
  const REF = 'abc123def0@teamchat-test';
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const settle = async (until) => { for (let i = 0; i < 40 && !until(); i++) await new Promise((r) => setTimeout(r, 5)); };

  afterEach(() => {
    store.wsId = null;
    store.me = null;
    store.convs.clear();
    delete globalThis.puter;
  });

  it('reads the whole stretch in between, page after page, when the worker answers it a few blocks at a time', async () => {
    const reads = [];
    globalThis.puter = {
      workers: {
        exec: async (url, init) => {
          const u = new URL(url);
          if ((init?.method || 'GET') === 'POST') return json({ message: { seq: 400, user: 'u-me', text: 'mine', ts: 9, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0 } });
          const from = Number(u.searchParams.get('from'));
          const to = Number(u.searchParams.get('to'));
          reads.push(`${from}-${to}`);
          // The worker's range read: three blocks at most, and a word that there is more.
          const hi = Math.min(to, from + 3 * 50 - 1);
          const messages = [];
          for (let s = from; s <= hi; s++) messages.push({ seq: s, text: `m${s}`, user: 'u2', ts: s });
          return json({ seq: 400, hasMore: hi < to, messages });
        },
      },
    };
    store.wsId = REF;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
    const c = store.conv('c1');
    c.loaded = true;
    c.messages = [{ seq: 10, text: 'before', user: 'u2', ts: 1 }];
    c.seq = 10;
    await store.send('c1', { text: 'mine' });
    await settle(() => c.messages.length === 391);
    expect(reads).toEqual(['11-399', '161-399', '311-399']);
    // No hole anywhere: every number from 10 to 400 is there once.
    expect(c.messages.map((m) => m.seq)).toEqual(Array.from({ length: 391 }, (_, i) => 10 + i));
  });

  it('reads nothing in between when the window had reached the counter with every message of its page deleted', async () => {
    const reads = [];
    globalThis.puter = {
      workers: {
        exec: async (url, init) => {
          const u = new URL(url);
          if ((init?.method || 'GET') === 'POST') return json({ message: { seq: 301, user: 'u-me', text: 'mine', ts: 9, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0 } });
          reads.push(`${u.searchParams.get('from')}-${u.searchParams.get('to')}`);
          // Asked from the very start, the worker would hand back the oldest history.
          return json({ seq: 301, hasMore: true, messages: [{ seq: 1, text: 'ancient', user: 'u2', ts: 1 }] });
        },
      },
    };
    store.wsId = REF;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
    // The newest page came back empty (its messages all deleted) with the counter at 300.
    const c = store.conv('c1');
    c.loaded = true;
    c.messages = [];
    c.seq = 300;
    await store.send('c1', { text: 'mine' });
    await new Promise((r) => setTimeout(r, 20));
    expect(reads).toEqual([]);
    expect(c.messages.map((m) => m.seq)).toEqual([301]);
  });
});
