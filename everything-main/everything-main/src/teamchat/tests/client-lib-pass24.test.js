/**
 * Twenty-fourth review pass, client libraries. Pure modules are imported
 * straight in; the browser is faked where a test needs one, as in
 * tests/client-lib-pass23.test.js.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { store } from '../src/lib/store.js';
import { createOutbox, memoryStorage } from '../src/lib/outbox.js';
import { cachedObjectUrl } from '../src/lib/files.js';
import { cleanText, LIMITS, extractMentionNames, broadcastKind, linkableText, firstLinkOf } from '../src/shared/limits.js';

/* ---- lib/store.js: a message scheduled while the Later lists are on their way ---- */

const REF = 'abc123def0@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tick = (ms = 2) => new Promise((r) => setTimeout(r, ms));
/** Route each call by the end of its path (first match wins); a handler gets the query and the request init. */
function worker(routes) {
  const calls = [];
  globalThis.puter = {
    workers: {
      exec: async (url, init = {}) => {
        const u = new URL(url);
        calls.push(`${init.method || 'GET'} ${u.pathname}${u.search}`);
        const hit = Object.entries(routes).find(([k]) => u.pathname.endsWith(k));
        if (!hit) return json({ code: 'not_found', message: 'nope' }, 404);
        return hit[1](u.searchParams, init);
      },
    },
  };
  return calls;
}
function openAcme() {
  store.wsId = REF;
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.ws = { id: 'abc123def0', name: 'Acme', channels: { c1: { id: 'c1', name: 'general' } }, members: { 'u-me': { role: 'member', name: 'Me', username: 'me' } } };
  store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.act = { c: { c1: { s: 1, t: 1000 } }, p: {}, ps: {}, w: 1, u: 0 };
  store.links = new Map();
  store._laterCache = new Map();
  store._scheduledCount = 0;
  store._reminderCount = 0;
}
function closeAcme() {
  store.wsId = null;
  store.ws = null;
  store.me = null;
  store.profile = null;
  store.links = new Map();
  store.act = { c: {}, p: {}, w: 0, u: 0 };
  delete globalThis.puter;
}

describe('the Later counts when a message is scheduled while the lists are being read', () => {
  afterEach(closeAcme);

  it('count the message: a list read that predates it is read again rather than laid over it', async () => {
    openAcme();
    const onServer = { scheduled: [], reminders: [] };
    let release;
    const held = new Promise((r) => { release = r; });
    let lists = 0;
    const calls = worker({
      '/reminders': async (q, init) => {
        const body = JSON.parse(init.body);
        const e = { id: `r${onServer.reminders.length + 1}`, conv: body.conv, seq: body.seq, dueAt: body.dueAt, note: body.note };
        onServer.reminders.push(e);
        return json({ reminder: e });
      },
      '/scheduled': async (q, init) => {
        if (init.method === 'POST') {
          const body = JSON.parse(init.body);
          const e = { id: `s${onServer.scheduled.length + 1}`, conv: body.conv, text: body.text, dueAt: body.dueAt };
          onServer.scheduled.push(e);
          return json({ scheduled: e });
        }
        lists++;
        if (lists === 1) await held; // the first list read is slow
        return json({ scheduled: [...onServer.scheduled], reminders: [...onServer.reminders] });
      },
    });
    const dueAt = Math.floor(Date.now() / 60_000) * 60_000 + 22_000 + 3_600_000;
    const reading = store.loadScheduled(); // as the workspace opens
    await tick(5);
    await store.schedule('c1', { text: 'later', dueAt });
    await store.remind('c1', 1, dueAt, 'note');
    expect(store.scheduledCount()).toBe(1);
    expect(store.reminderCount()).toBe(1);
    release(); // the list from before the two writes lands now
    await reading;
    expect(store.scheduledCount()).toBe(1);
    expect(store.reminderCount()).toBe(1);
    expect(lists).toBe(2); // the stale list was read again once
    expect(calls.filter((c) => c.startsWith('GET') && c.includes('/scheduled')).length).toBe(2);
    // Read once more with nothing changed meanwhile: one read, the counts as they are.
    await store.loadScheduled();
    expect(lists).toBe(3);
    expect(store.scheduledCount()).toBe(1);
  });

  it('a deletion or a change landing while a list is out reads it again too', async () => {
    openAcme();
    const onServer = { scheduled: [{ id: 's1', conv: 'c1', text: 'a', dueAt: Date.now() + 3_600_000 }, { id: 's2', conv: 'c1', text: 'b', dueAt: Date.now() + 7_200_000 }], reminders: [] };
    let release;
    const held = new Promise((r) => { release = r; });
    let lists = 0;
    worker({
      '/scheduled/s1': async (q, init) => {
        if (init.method === 'DELETE') onServer.scheduled = onServer.scheduled.filter((e) => e.id !== 's1');
        return json({ ok: true });
      },
      '/scheduled': async () => {
        lists++;
        if (lists === 1) await held;
        return json({ scheduled: [...onServer.scheduled], reminders: [] });
      },
    });
    const reading = store.loadScheduled();
    await tick(5);
    await store.deleteScheduled({ id: 's1' });
    release();
    await reading;
    expect(store.scheduledCount()).toBe(1);
    expect(lists).toBe(2);
  });
});

/* ---- a gateway's 408 or 425 is no refusal: outbox, reads, file fetches ---- */

describe('a 408 or a 425 answer (a gateway timing the request out, or holding it as too early)', () => {
  afterEach(closeAcme);

  it('keeps a queued message in line for the next flush, where a 403 still sets it aside', async () => {
    const answers = [];
    const outbox = createOutbox({
      storage: memoryStorage(),
      isOnline: () => true,
      owner: () => 'me',
      uploadFile: async () => ({ id: 'f' }),
      sendEntry: async () => {
        const a = answers.shift();
        if (a === 'ok') return { message: { seq: 1 } };
        // A gateway's page (`http_NNN`, none of the worker's words) for the
        // passing statuses; the 403 is the worker's own refusal, with its code.
        throw Object.assign(new Error(`e${a}`), { status: a, code: a === 403 ? 'forbidden' : `http_${a}` });
      },
    });
    await outbox.enqueue({ ws: 'A', conv: 'c1', text: 'hello' });
    answers.push(408);
    expect(await outbox.flush()).toEqual({ sent: 0, left: 1 });
    let [e] = await outbox.list();
    expect(e.failed).toBeFalsy();
    expect(e.attempts).toBe(1);
    answers.push(425);
    expect(await outbox.flush()).toEqual({ sent: 0, left: 1 });
    [e] = await outbox.list();
    expect(e.failed).toBeFalsy();
    expect(e.attempts).toBe(2);
    answers.push('ok');
    expect(await outbox.flush()).toEqual({ sent: 1, left: 0 });
    // A refusal proper is set aside as before.
    await outbox.enqueue({ ws: 'A', conv: 'c1', text: 'again' });
    answers.push(403);
    expect(await outbox.flush()).toEqual({ sent: 0, left: 1 });
    [e] = await outbox.list();
    expect(e.failed).toBe(true);
  });

  it('keeps a read the gateway answered so for the next sync, as a 401 is kept, where a 403 is given up on', async () => {
    openAcme();
    store.me.reads = {};
    let status = 408;
    // A gateway's answer for the passing statuses; the 403 is the worker's own refusal, with its code.
    worker({ '/read': async () => json({ code: status === 403 ? 'forbidden' : `http_${status}`, message: 'gateway' }, status) });
    const key = `${REF}:c1`;
    store.markRead('c1', 1);
    store._flushReads();
    await tick(20);
    let kept = store._readRetry.get(key);
    expect(kept).toBeTruthy();
    expect(kept.attempts).toBe(1);
    expect(kept.seen.acked).toBe(0); // not acknowledged: a document from before is not yet trusted
    store._readRetry.clear();
    store._seenAt.clear();
    store._localSeen.clear();
    status = 425;
    store.markRead('c1', 1);
    store._flushReads();
    await tick(20);
    kept = store._readRetry.get(key);
    expect(kept).toBeTruthy();
    store._readRetry.clear();
    store._seenAt.clear();
    store._localSeen.clear();
    status = 401;
    store.markRead('c1', 1);
    store._flushReads();
    await tick(20);
    expect(store._readRetry.get(key)).toBeTruthy(); // the pass-22 rule stands
    store._readRetry.clear();
    store._seenAt.clear();
    store._localSeen.clear();
    status = 403;
    store.markRead('c1', 1);
    store._flushReads();
    await tick(20);
    expect(store._readRetry.get(key)).toBeUndefined();
  });

  it('is remembered for a file only briefly, not as a refusal that stands for minutes', async () => {
    const map = new Map();
    const fail = (status, code) => () => Promise.reject(Object.assign(new Error('x'), { status, code }));
    await cachedObjectUrl(map, 'a', fail(408, 'http_408')).catch(() => {});
    await cachedObjectUrl(map, 'b', fail(425, 'http_425')).catch(() => {});
    await cachedObjectUrl(map, 'c', fail(404, 'not_found')).catch(() => {});
    await cachedObjectUrl(map, 'd', fail(401, 'unauthorized')).catch(() => {});
    const left = (k) => map.get(k).failedUntil - Date.now();
    expect(left('a')).toBeGreaterThan(0);
    expect(left('a')).toBeLessThanOrEqual(15_000);
    expect(left('b')).toBeLessThanOrEqual(15_000);
    expect(left('d')).toBeLessThanOrEqual(15_000);
    expect(left('c')).toBeGreaterThan(60_000);
  });
});

/* ---- lib/store.js: the Threads badge after a channel is deleted ---- */

describe('the Threads badge with counters left for a conversation the workspace no longer has', () => {
  afterEach(() => {
    store.wsId = null;
    store.ws = null;
    store.me = null;
    store.profile = null;
    store.links = new Map();
    store.act = { c: {}, p: {}, w: 0, u: 0 };
  });

  it('counts the replies of threads in the channels and direct messages that stand, and none of a deleted channel\'s', () => {
    store.wsId = 'abc123def0@teamchat-test';
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.ws = { id: 'abc123def0', name: 'Acme', channels: { c1: { id: 'c1', name: 'general' }, sh: { id: 'sh', name: 'shared', shared: { ref: 'h0st00000a@teamchat-host', ch: 'hc', conn: 'k', host: 'Host' } } }, members: { 'u-me': { role: 'member', name: 'Me', username: 'me' } } };
    store.me = {
      role: 'member', channels: ['c1', 'sh'], dms: { dm_a1: { members: ['u-me', 'u-ann'] } }, reads: {}, mentions: {}, notify: {},
      // c1's thread, the direct message's, the shared entry's, and one of a channel deleted since
      threads: { c1_t5: 2, dm_a1_t3: 1, sh_t9: 5, gone_t7: 4 },
    };
    expect(store.threadBadge()).toBe(8);
    // The thread's own count still stands for a listing that names it.
    expect(store.threadUnread('gone_t7')).toBe(4);
    // A host's direct message folded in under its h_ id counts once it is listed.
    store.me.threads.h_dm_zz_t1 = 3;
    expect(store.threadBadge()).toBe(8);
    store.me.dms.h_dm_zz = { members: ['u-me', 'u-x'], host: 'h0st00000a@teamchat-host' };
    expect(store.threadBadge()).toBe(11);
    // The tab's total follows the badge.
    expect(store.totalBadge()).toBe(11);
    // The channel listed again (a document from before its deletion): counted as before.
    store.ws.channels.gone = { id: 'gone', name: 'old' };
    expect(store.threadBadge()).toBe(15);
  });
});
import { formatMessage, previewText, highlightSnippet } from '../src/lib/format.js';
import { toggleQuote } from '../src/lib/formatting.js';

/* ---- lib/format.js: a stray backtick before a code block ---- */

describe('a search snippet and a preview of a message with a lone backtick before a code block', () => {
  const text = "it's `broken```js\nreturn code\n``` and `fine`, ok";

  it('keep the block\'s words and mark the one searched for, with no placeholder character left in', () => {
    const out = highlightSnippet(text, ['code']);
    expect(out).toContain('<mark>code</mark>');
    expect(out).toContain('return');
    expect(out).toContain('fine');
    expect(out).not.toMatch(/[-]/);
    // A span before the block and one after it, as the renderer has them.
    expect(highlightSnippet('`a`\n```\nb c\n```\n`d`', ['c'])).toBe('a b <mark>c</mark> d');
  });

  it('read the block as [code] and the span after it as code, as before, with the stray backtick kept as written', () => {
    expect(previewText(text, 200)).toBe("it's `broken [code] and fine, ok");
    expect(previewText('a `x` b ```\ncode\n``` `y`', 200)).toBe('a x b [code] y');
    expect(previewText('```\ncode\n```', 200)).toBe('[code]');
    expect(previewText('say `hi`', 200)).toBe('say hi');
  });
});

/* ---- lib/formatting.js: Quote from the very start of the text ---- */

describe('Quote with the caret at the start of a text that opens with an empty line', () => {
  it('quotes that first line rather than putting the arrow on a line of its own', () => {
    // The caret on the empty first line, nothing selected.
    expect(toggleQuote({ value: '\nabc', start: 0, end: 0 })).toEqual({ value: '> \nabc', start: 2, end: 2 });
    // The empty first line selected (Shift+Down from the top).
    expect(toggleQuote({ value: '\nabc', start: 0, end: 1 })).toEqual({ value: '> \nabc', start: 2, end: 3 });
    // A selection over the empty first line and the one after it quotes both.
    expect(toggleQuote({ value: '\nabc\ndef', start: 0, end: 5 })).toEqual({ value: '> \n> abc\ndef', start: 2, end: 9 });
    // And back: the quote comes off the same lines.
    expect(toggleQuote({ value: '> \nabc', start: 0, end: 0 })).toEqual({ value: '\nabc', start: 0, end: 0 });
    // The second empty line, and a text that opens with a word, as before.
    expect(toggleQuote({ value: '\n\nabc', start: 1, end: 1 })).toEqual({ value: '\n> \nabc', start: 3, end: 3 });
    expect(toggleQuote({ value: 'x\nabc', start: 0, end: 0 })).toEqual({ value: '> x\nabc', start: 2, end: 2 });
    expect(toggleQuote({ value: 'hello', start: 5, end: 5 })).toEqual({ value: '> hello', start: 7, end: 7 });
  });
});

/* ---- shared/limits.js: mentions ring what the renderer draws as a chip ---- */

describe('a mention right after a struck or italic run', () => {
  const members = { alice: { uuid: 'u1', name: 'Alice' }, bob: { uuid: 'u2', name: 'Bob' } };
  const chips = (text) => {
    const html = formatMessage(text, { members, me: 'u1' });
    const out = new Set();
    for (const m of html.matchAll(/class="mention(?: mention-me)?" data-uuid="(u[12])"/g)) out.add(m[1] === 'u1' ? 'alice' : 'bob');
    for (const m of html.matchAll(/mention-broadcast">@(channel|here|everyone)</g)) out.add(m[1]);
    return [...out].sort();
  };
  const rung = (text) => extractMentionNames(text).filter((n) => ['alice', 'bob', 'channel', 'here', 'everyone'].includes(n)).sort();

  it('rings whom the renderer draws: the closing mark is a boundary there, as a bold mark is', () => {
    // "~fixed~@alice": the renderer closes the struck run with a tag and
    // draws alice's chip after it; read from the raw text with the mark
    // taken off, "fixed@alice" was one word and rang nobody.
    expect(chips('~fixed~@alice can you check')).toEqual(['alice']);
    expect(rung('~fixed~@alice can you check')).toEqual(['alice']);
    expect(rung('_@alice_@bob')).toEqual(['alice', 'bob']);
    expect(chips('_@alice_@bob')).toEqual(['alice', 'bob']);
    expect(rung('_see_@channel')).toEqual(['channel']);
    expect(broadcastKind(extractMentionNames('_see_@channel'))).toBe('channel');
    // An address in italics followed by a handle: the address ends at the
    // mark, and the handle after it is a mention, as drawn.
    expect(firstLinkOf('_https://x.io/a_,@bob')).toBe('https://x.io/a');
    expect(rung('_https://x.io/a_,@bob')).toEqual(['bob']);
    expect(chips('_https://x.io/a_,@bob')).toEqual(['bob']);
    // The stand-in for the tag is a space; a run followed by one, or by
    // punctuation, reads as before but for it.
    expect(linkableText('see _https://x.io/a_: now')).toBe('see https://x.io/a : now');
    expect(linkableText('_x_ y')).toBe('x  y');
    expect(firstLinkOf('see _https://x.io/a_: now')).toBe('https://x.io/a');
    expect(firstLinkOf('_https://x.io/a_:8080')).toBe('https://x.io/a');
    expect(rung('hello @alice')).toEqual(['alice']);
    expect(rung('a_b@alice')).toEqual([]);
  });

  it('agrees with the renderer over a few thousand random texts of marks, handles, addresses and punctuation', () => {
    const TOK = ['hi', ' ', ' ', '\n', '@alice', '@bob', '@channel', '@here', '_', '__', '**', '~', '`', '```', 'https://x.io/@alice', 'https://x.io/a', '(', ')', '"', "'", ':', '.', ',', '-', '> ', 'a_b', 'x@alice', '@alice.', '@Alice', '*', '@alice_', '“', '”', '!', '?', '&', '<', '>', '@bob-', 'http://', '@'];
    let seed = 0x2f6e2b1;
    const rnd = (n) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; // one LCG, the same texts every run
      return (seed >>> 8) % n;
    };
    const off = [];
    for (let i = 0; i < 4000; i++) {
      const n = 2 + rnd(7);
      let text = '';
      for (let j = 0; j < n; j++) text += TOK[rnd(TOK.length)];
      if (chips(text).join() !== rung(text).join()) off.push(text);
    }
    expect(off).toEqual([]);
  });
});

/* ---- shared/limits.js: the cut between whole characters ---- */

describe('a bounded text cut inside a run of flags', () => {
  const flag = '\u{1F1FA}\u{1F1F8}'; // 🇺🇸, two regional indicators, four units

  it('falls between whole flags wherever the run stands against the cut', () => {
    // Two letters put the run two units off the sixty-four the cut used to
    // look back over: read from the middle of a flag, the indicators paired
    // up the wrong way from there on, and the cut fell between the two
    // halves of a flag (a boxed letter at the end of the text).
    expect(cleanText(`ab${flag.repeat(30)}`, 100)).toBe(`ab${flag.repeat(24)}`);
    // Every offset of the run against the cut.
    for (let lead = 0; lead < 8; lead++) {
      const whole = Math.floor((100 - lead) / 4);
      expect(cleanText(`${'x'.repeat(lead)}${flag.repeat(40)}`, 100)).toBe(`${'x'.repeat(lead)}${flag.repeat(whole)}`);
    }
  });

  it('holds for a message of the longest length the workers take', () => {
    const text = `Go US ${flag.repeat(1100)}`; // six units, then the run: the cut lands inside a flag
    const out = cleanText(text, LIMITS.messageText);
    expect(out).toBe(`Go US ${flag.repeat(Math.floor((LIMITS.messageText - 6) / 4))}`);
    expect(out.length).toBeLessThanOrEqual(LIMITS.messageText);
  });

  it('keeps the plain cases and the run-of-marks fallback as they were', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
    expect(cleanText(`${'a'.repeat(58)}${family}`, 60)).toBe('a'.repeat(58));
    expect(cleanText(`${'a'.repeat(49)}${family}b`, 60)).toBe(`${'a'.repeat(49)}${family}`);
    expect(cleanText('x'.repeat(10), 4)).toBe('xxxx');
    const zalgo = `a${'́'.repeat(200)}`;
    expect(cleanText(zalgo, 60)).toHaveLength(60);
    expect(cleanText(`${'b'.repeat(10)}${zalgo}`, 60)).toBe('b'.repeat(10));
  });
});
