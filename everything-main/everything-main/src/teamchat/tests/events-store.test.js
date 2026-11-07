/**
 * The client half of events signalling (src/lib/store.js): the subscription
 * lifecycle (_evApply/_evTeardown/_onEvFailure), the scheduler built on top
 * of it (_evFast, poll()'s finally block), and the degradation detector
 * (_evMiss). See docs/systemDesignDocs/teamchatEventsSignaling.md, sections
 * 4 and 12.
 *
 * Puter is faked at `puter.workers.exec` (the sync protocol, as in
 * tests/store.test.js) and `puter.events.onLocal` (the subscription).
 * `store.poll()`/`store.refreshWorkspace()` are driven directly against the
 * singleton `store`, following the stubbing shape of tests/store.test.js
 * (roughly its lines 390-1700): fields are set by hand rather than going
 * through the full openWorkspace() boot sequence, except where the test is
 * specifically about that sequence (workspace switch).
 */
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import {
  store, POLL_VISIBLE_MS, POLL_HIDDEN_MS, POLL_SAFETY_MS,
  SIGNAL_FLOOR_MS, EV_RETRY_MS, EV_DEGRADE_MS, EV_MISSES_TO_DEGRADE, EV_TERMINAL_BACKOFF_MS, EV_AMBIGUOUS_CODE, EV_STALE_HANDLE_CODE,
} from '../src/lib/store.js';
import { EV_SHARDS } from '../src/shared/events.js';
import { fakeAuthToken } from '../dev/worker-runtime.js';

const WS_ID = 'abc123def0';
const REF = `${WS_ID}@teamchat-test`;
const OTHER_REF = 'zzz999zzz9@teamchat-test';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * A fake `puter.events.onLocal`: tracks every subscription made against it so
 * a test can deliver to one (`deliver`), fail it the way the SDK's onError
 * does (`fail`), refuse the very next subscribe attempt (`refuseNext`), or
 * have it resolve nothing at all (`resolveNothingNext`), as a misbehaving SDK
 * might.
 */
function fakeEvents() {
  const subs = [];
  let refuseWith = null;
  let resolveNothing = false;
  return {
    subs,
    refuseNext(err) { refuseWith = err; },
    resolveNothingNext() { resolveNothing = true; },
    onLocal: async (subject, handler, opts = {}) => {
      if (refuseWith) {
        const e = refuseWith;
        refuseWith = null;
        throw e;
      }
      if (resolveNothing) {
        resolveNothing = false;
        return undefined;
      }
      const sub = {
        subject, handler, onError: opts.onError, opts, offCalls: 0, off() { sub.offCalls++; },
      };
      subs.push(sub);
      return sub;
    },
    /** The most recently made subscription still standing (not off()'d). */
    latest() {
      for (let i = subs.length - 1; i >= 0; i--) if (!subs[i].offCalls) return subs[i];
      return null;
    },
    /** A delivery, optionally carrying the event the SDK would hand over (`includeValue`). */
    deliver(subject, event = undefined) { for (const s of subs) if (s.subject === subject && !s.offCalls) s.handler(event === undefined ? undefined : { event }); },
    fail(subject, err) { for (const s of subs) if (s.subject === subject && !s.offCalls) s.onError?.(err); },
  };
}

let ev;
let bootstrapEvents; // set per test; undefined = the bootstrap carries no `events` key at all
let syncExtra; // merged over the sync response's defaults, for WS_ID only
let remintAnswer; // (id) => body for POST .../events/handle; may return a promise, or throw, to control timing and failure
let remintCalls; // workspace ids _evRemint actually asked to re-mint, in order

beforeEach(() => {
  ev = fakeEvents();
  bootstrapEvents = undefined;
  syncExtra = {};
  remintAnswer = () => ({}); // an old worker: no `events` key, nothing to offer
  remintCalls = [];
  globalThis.document = { hidden: false };
  globalThis.puter = {
    appID: 'app-teamchat-test',
    events: ev,
    workers: {
      exec: async (url) => {
        const path = new URL(url).pathname;
        const remint = path.match(/^\/api\/ws\/([a-z0-9]+)\/events\/handle$/);
        if (remint) {
          remintCalls.push(remint[1]);
          return json(await remintAnswer(remint[1]));
        }
        const m = path.match(/^\/api\/ws\/([a-z0-9]+)(\/sync)?$/);
        if (!m) return json({ code: 'not_found' }, 404);
        const [, id, isSync] = m;
        if (isSync) {
          return json({
            now: Date.now() - 2000, ts: Date.now(), c: {}, p: {}, w: 0, u: 0,
            ...(id === WS_ID ? syncExtra : {}),
          });
        }
        return json({
          workspace: { id, name: 'Test', channels: {}, members: { 'u-me': {} } },
          me: {
            dms: {}, channels: [], notify: {}, reads: {}, mentions: {}, threads: {},
          },
          activity: { c: {}, w: 0, u: {} },
          now: Date.now(),
          ...(id === WS_ID && bootstrapEvents !== undefined ? { events: bootstrapEvents } : {}),
        });
      },
    },
  };
  store.wsId = REF;
  store.identity = { uuid: 'u-me' };
  store.profile = { uuid: 'u-me', username: 'me', prefs: {} };
  store.ws = { id: WS_ID, name: 'Test', channels: {}, members: { 'u-me': {} } };
  store.me = {
    dms: {}, channels: [], notify: {}, reads: {}, mentions: {}, threads: {},
  };
  store.act = {
    c: {}, p: {}, ps: {}, w: 0, u: 0,
  };
  store.huddles = {};
  store.links = new Map();
  store.convs.clear();
  store._localSeen.clear();
  store._seenAt.clear();
  store._hasQueued = false;
  store._poked = false;
  store._evPending = false;
  store._pendingReason = 'cadence';
  store._lastHeartbeat = Date.now(); // suppress a heartbeat write; not what these tests are about
  store._lastFlag = null;
  // poll()'s own rescheduling, and _onEvSignal's stopPolling() guard, both
  // gate on `this._timer !== null` — true throughout a real polling loop
  // (the fired timeout's id is still non-null when its callback runs), so a
  // direct call to poll()/_onEvSignal needs the same standing start.
  store._timer = setTimeout(() => {}, 999_000);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  store.stopPolling();
  clearTimeout(store._timer);
  store._timer = null;
  clearTimeout(store._evHiddenTimer);
  store._evHiddenTimer = null;
  store.ev = {
    state: 'off', sub: null, desc: null, lastDesc: null, epoch: 0,
    retryIdx: 0, retryTimer: null, retryUntil: 0, retryDesc: null, degradedUntil: 0, misses: 0, reminted: null,
  };
  store._evSyncAt = 0; // a fake-timer test polls its way into the future; the next test must not inherit that read time
  store._evNoValues = false; // one test proves a refusal stands down for good; it must not stand into the next
  store.wsId = null;
  store.identity = null;
  store.profile = null;
  store.ws = null;
  store.me = null;
  store.links = new Map();
  store.convs.clear();
  delete globalThis.puter;
  delete globalThis.document;
});

/**
 * The delay (ms) of the most recent call to store._schedule, spied on
 * directly rather than on the global setTimeout: api.js's own request-timeout
 * arming (`TIMEOUT_MS = 20_000`, coincidentally equal to POLL_SAFETY_MS) also
 * calls setTimeout during a poll, which would otherwise be indistinguishable
 * from the store's own rescheduling.
 */
function lastSchedule(spy) {
  const calls = spy.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

/**
 * _evApply's subscribe is a fire-and-forget `Promise.resolve().then(...)`
 * chain (never awaited by refreshWorkspace/_applyBootstrap, on purpose — it
 * must not hold up the document those apply at once): a few microtask ticks
 * past refreshWorkspace()'s own await are needed for it to actually settle
 * to 'on' or 'off'.
 */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('no events support at all', () => {
  it('no puter.events: cadence stays exactly POLL_VISIBLE_MS', async () => {
    delete globalThis.puter.events;
    bootstrapEvents = { mode: 'own', appUid: 'app-teamchat-test', key: `tc:ws:${WS_ID}:ev:s0`, shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('off'); // typeof puter.events.onLocal !== 'function'
    expect(ev.subs.length).toBe(0);
    const timers = vi.spyOn(store, '_schedule');
    await store.poll();
    expect(lastSchedule(timers)).toBe(POLL_VISIBLE_MS);
  });

  it('a bootstrap with no `events` key (an old worker) also stays at POLL_VISIBLE_MS', async () => {
    bootstrapEvents = undefined;
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('off');
    expect(ev.subs.length).toBe(0);
    const timers = vi.spyOn(store, '_schedule');
    await store.poll();
    expect(lastSchedule(timers)).toBe(POLL_VISIBLE_MS);
  });
});

describe('subscribing', () => {
  it('mode: own subscribes on kv:<appUid>:<key>', async () => {
    bootstrapEvents = { mode: 'own', appUid: 'app-teamchat-test', key: `tc:ws:${WS_ID}:ev:s2`, shards: EV_SHARDS, shard: 2 };
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('on');
    expect(ev.latest().subject).toBe(`kv:app-teamchat-test:tc:ws:${WS_ID}:ev:s2`);
  });

  it('mode: handle subscribes on kv:<handle>:s<shard>', async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-member', shards: EV_SHARDS, shard: 1 };
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('on');
    expect(ev.latest().subject).toBe('kv:kvh-member:s1');
  });

  it('mode: own is refused when this client\'s own app uid does not match events.appUid', async () => {
    globalThis.puter.appID = 'app-someone-elses';
    bootstrapEvents = { mode: 'own', appUid: 'app-teamchat-test', key: `tc:ws:${WS_ID}:ev:s0`, shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('off');
    expect(ev.subs.length).toBe(0);
  });

  it('a changed handle re-subscribes: the old subscription is torn down and a new one made', async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-one', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    const first = ev.latest();
    expect(first.subject).toBe('kv:kvh-one:s0');

    bootstrapEvents = { mode: 'handle', handle: 'kvh-two', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    expect(first.offCalls).toBe(1);
    const second = ev.latest();
    expect(second.subject).toBe('kv:kvh-two:s0');
    expect(store.ev.state).toBe('on');
  });

  it('a changed shard re-subscribes, same handle', async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-x', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    const first = ev.latest();

    bootstrapEvents = { mode: 'handle', handle: 'kvh-x', shards: EV_SHARDS, shard: 3 };
    await store.refreshWorkspace();
    await settle();
    expect(first.offCalls).toBe(1);
    expect(ev.latest().subject).toBe('kv:kvh-x:s3');
  });

  it('a changed mode re-subscribes', async () => {
    bootstrapEvents = { mode: 'own', appUid: 'app-teamchat-test', key: `tc:ws:${WS_ID}:ev:s0`, shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    const first = ev.latest();

    bootstrapEvents = { mode: 'handle', handle: 'kvh-now', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    expect(first.offCalls).toBe(1);
    expect(ev.latest().subject).toBe('kv:kvh-now:s0');
  });

  // appUid used to be left out of the "same descriptor" comparison, so an
  // own-mode bootstrap naming a new app uid over the same key read as
  // unchanged, and the tab kept subscribing to the old app's namespace.
  it('an appUid change over the same key is not the same descriptor: the old sub is torn down and own mode is refused', async () => {
    bootstrapEvents = { mode: 'own', appUid: 'app-teamchat-test', key: `tc:ws:${WS_ID}:ev:s0`, shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    const first = ev.latest();
    expect(store.ev.state).toBe('on');
    // Same key, a different app: this client's own appUid no longer matches it.
    bootstrapEvents = { mode: 'own', appUid: 'app-other', key: `tc:ws:${WS_ID}:ev:s0`, shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    expect(first.offCalls).toBe(1);
    expect(store.ev.state).toBe('off'); // refused, not left standing against the old app's namespace
  });

  it('the same descriptor again is left alone: no teardown, no re-subscribe', async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-same', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    const first = ev.latest();
    await store.refreshWorkspace();
    await settle(); // same events block again
    expect(first.offCalls).toBe(0);
    expect(ev.subs.length).toBe(1);
  });

  // store.appUid() must agree with the worker's own reading of the same
  // token (see src/shared/events.js), or own mode refuses the owner their
  // own subscription with nothing said (see appUid()'s docstring).
  it('with no puter.appID at all, own mode subscribes on the token\'s uid', async () => {
    delete globalThis.puter.appID;
    globalThis.puter.authToken = fakeAuthToken('app-teamchat-test');
    bootstrapEvents = { mode: 'own', appUid: 'app-teamchat-test', key: `tc:ws:${WS_ID}:ev:s0`, shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('on');
  });

  it('a puter.appID with no app- prefix is not trusted; own mode falls back to the token', async () => {
    const uuid = '4b1d9c20-7e3a-4f56-9a08-2c6d5e1f8b34';
    globalThis.puter.appID = uuid; // not the shape appUidFromToken ever produces
    globalThis.puter.authToken = fakeAuthToken(`app-${uuid}`);
    bootstrapEvents = { mode: 'own', appUid: `app-${uuid}`, key: `tc:ws:${WS_ID}:ev:s0`, shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('on');
  });

  it('a proper app-... puter.appID is used as it is', () => {
    expect(store.appUid()).toBe('app-teamchat-test'); // set by this file's beforeEach
  });
});

describe('reacting to a delivery', () => {
  beforeEach(async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-react', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
  });

  it('schedules a poll floored at SIGNAL_FLOOR_MS', async () => {
    store._lastPollAt = Date.now(); // as if a poll just finished
    const timers = vi.spyOn(store, '_schedule');
    ev.deliver('kv:kvh-react:s0');
    expect(lastSchedule(timers)).toBeLessThanOrEqual(SIGNAL_FLOOR_MS);
    expect(lastSchedule(timers)).toBeGreaterThanOrEqual(0);
  });

  it('a gap marker behaves exactly like an ordinary delivery', async () => {
    // A gap marker carries no payload of its own — the subject fires the
    // same handler either way (see the design doc, section 4.2): "something
    // happened, re-read" is the whole of what any delivery means here.
    store._lastPollAt = Date.now();
    const timers = vi.spyOn(store, '_schedule');
    ev.deliver('kv:kvh-react:s0');
    expect(lastSchedule(timers)).not.toBeNull();
  });

  it('while a poll is in flight, queues an event wakeup separately from a user poke', () => {
    store._polling = true;
    store._poked = false;
    ev.deliver('kv:kvh-react:s0');
    expect(store._poked).toBe(false);
    expect(store._evPending).toBe(true);
    store._polling = false;
  });

  it('any delivery resets the degradation miss counter', () => {
    store.ev.misses = 2;
    ev.deliver('kv:kvh-react:s0');
    expect(store.ev.misses).toBe(0);
  });
});

describe('failure and backoff', () => {
  // An SDK that resolves nothing at all is not a healthy subscription: left
  // as 'on' regardless (as it used to be), the holder would look healthy
  // forever and the tab would sit on the slow cadence for good, with nothing
  // ever tearing it down or trying again.
  it('a subscribe that resolves nothing is treated as a failure, with a retry armed', async () => {
    vi.useFakeTimers();
    ev.resolveNothingNext();
    bootstrapEvents = { mode: 'handle', handle: 'kvh-nothing', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('off');
    expect(ev.subs.length).toBe(0);
    await vi.advanceTimersByTimeAsync(EV_RETRY_MS[0] + 1);
    expect(store.ev.state).toBe('on');
    expect(ev.latest().subject).toBe('kv:kvh-nothing:s0');
  });

  it('onError backs off, then re-arms the same descriptor after EV_RETRY_MS[0]', async () => {
    vi.useFakeTimers();
    bootstrapEvents = { mode: 'handle', handle: 'kvh-fail', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    const first = ev.latest();
    ev.fail('kv:kvh-fail:s0', new Error('boom'));
    expect(store.ev.state).toBe('off');
    await vi.advanceTimersByTimeAsync(EV_RETRY_MS[0] - 1);
    expect(ev.subs.length).toBe(1); // not yet
    await vi.advanceTimersByTimeAsync(1);
    expect(ev.subs.length).toBe(2); // re-armed
    expect(ev.subs[1].subject).toBe(first.subject);
    expect(store.ev.state).toBe('on');
  });

  it('a code meaning the platform surface is off gets the long terminal backoff, not the short ladder', async () => {
    vi.useFakeTimers();
    bootstrapEvents = { mode: 'own', appUid: 'app-teamchat-test', key: `tc:ws:${WS_ID}:ev:s0`, shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    const err = new Error('off here');
    err.code = 'events_disabled';
    ev.fail(`kv:app-teamchat-test:tc:ws:${WS_ID}:ev:s0`, err);
    expect(store.ev.state).toBe('off');
    await vi.advanceTimersByTimeAsync(EV_RETRY_MS[EV_RETRY_MS.length - 1] + 1);
    expect(ev.subs.length).toBe(1); // the short ladder, even fully climbed, would have retried by now
    await vi.advanceTimersByTimeAsync(EV_TERMINAL_BACKOFF_MS - EV_RETRY_MS[EV_RETRY_MS.length - 1]);
    expect(ev.subs.length).toBe(2); // the terminal wait, though, has now elapsed
  });

  // A refused handshake and a dropped connection reach the client under one
  // code, so it cannot be terminal on sight. A drop that reconnects keeps the
  // short ladder — and resets it, since the subscription did come back.
  it('treats the ambiguous connection code as transient while reconnecting works', async () => {
    vi.useFakeTimers();
    bootstrapEvents = { mode: 'handle', handle: 'kvh-blip', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    const err = new Error('connection failed');
    err.code = EV_AMBIGUOUS_CODE;

    for (let i = 0; i < EV_RETRY_MS.length + 2; i++) {
      ev.fail('kv:kvh-blip:s0', err);
      expect(store.ev.state).toBe('off');
      // Always the first rung: a re-arm that succeeds clears the ladder, so a
      // flaky link is never punished with the hour.
      await vi.advanceTimersByTimeAsync(EV_RETRY_MS[0] + 1);
      expect(ev.subs.length).toBe(i + 2);
      expect(store.ev.state).toBe('on');
    }
  });

  // A socket that never once comes back, though — which is how a region that
  // will not admit an app connection at all actually presents — climbs the
  // ladder to its end and then waits the hour out.
  it('escalates the ambiguous code to the terminal wait once the ladder runs out unsuccessfully', async () => {
    vi.useFakeTimers();
    bootstrapEvents = { mode: 'handle', handle: 'kvh-dead', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    const blip = () => {
      const e = new Error('connection failed');
      e.code = EV_AMBIGUOUS_CODE;
      return e;
    };

    ev.fail('kv:kvh-dead:s0', blip());
    // Every re-arm is refused outright, so the ladder never resets.
    for (let i = 0; i < EV_RETRY_MS.length - 1; i++) {
      ev.refuseNext(blip());
      await vi.advanceTimersByTimeAsync(EV_RETRY_MS[i] + 1);
      expect(store.ev.state).toBe('off');
    }

    // The ladder is spent, so this last refusal put it on the terminal wait.
    const settled = ev.subs.length;
    await vi.advanceTimersByTimeAsync(EV_RETRY_MS[EV_RETRY_MS.length - 1] + 1);
    expect(ev.subs.length).toBe(settled); // the short ladder would have tried again by now
    await vi.advanceTimersByTimeAsync(EV_TERMINAL_BACKOFF_MS);
    expect(ev.subs.length).toBe(settled + 1);
  });

  it('a refresh with an unchanged descriptor does not cancel a pending backoff', async () => {
    vi.useFakeTimers();
    bootstrapEvents = { mode: 'handle', handle: 'kvh-stable', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    ev.fail('kv:kvh-stable:s0', new Error('boom'));
    expect(store.ev.state).toBe('off');
    const pendingTimer = store.ev.retryTimer;
    // The same descriptor arrives again, as a routine bootstrap refresh does
    // every few seconds: must not restart the ladder from its first rung.
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.retryTimer).toBe(pendingTimer);
    expect(ev.subs.length).toBe(1); // no new subscribe attempt yet
    await vi.advanceTimersByTimeAsync(EV_RETRY_MS[0] + 1);
    expect(ev.subs.length).toBe(2); // the original backoff still fired on schedule
  });

  it('a genuinely different descriptor while backing off cancels the pending backoff and re-arms at once', async () => {
    vi.useFakeTimers();
    bootstrapEvents = { mode: 'handle', handle: 'kvh-a', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    ev.fail('kv:kvh-a:s0', new Error('boom'));
    expect(store.ev.state).toBe('off');
    bootstrapEvents = { mode: 'handle', handle: 'kvh-b', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('on'); // re-armed immediately, not after the backoff window
    expect(ev.latest().subject).toBe('kv:kvh-b:s0');
  });
});

describe('re-minting a dead handle (EV_STALE_HANDLE_CODE)', () => {
  const stale = () => Object.assign(new Error('gone'), { code: EV_STALE_HANDLE_CODE });

  it('a stale-subject refusal asks the host for a fresh handle and subscribes to it at once', async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-dead', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    remintAnswer = () => ({ events: { mode: 'handle', handle: 'kvh-fresh', shards: EV_SHARDS, shard: 0 } });
    ev.fail('kv:kvh-dead:s0', stale());
    await settle();
    expect(remintCalls).toEqual([WS_ID]);
    expect(store.ev.state).toBe('on'); // subscribed at once, no backoff waited out
    expect(ev.latest().subject).toBe('kv:kvh-fresh:s0');
  });

  it('only once per dead handle: a second refusal of the same handle takes the terminal wait, not the ladder', async () => {
    vi.useFakeTimers();
    bootstrapEvents = { mode: 'handle', handle: 'kvh-dead2', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    remintAnswer = () => ({}); // nothing to offer: the wait _onEvFailure armed stands
    ev.fail('kv:kvh-dead2:s0', stale());
    await settle();
    expect(remintCalls.length).toBe(1);
    expect(store.ev.state).toBe('off');
    // The ladder's first rung re-arms the same dead subject, refused the same way again: no second ask.
    ev.refuseNext(stale());
    await vi.advanceTimersByTimeAsync(EV_RETRY_MS[0] + 1);
    expect(remintCalls.length).toBe(1);
    expect(store.ev.state).toBe('off');
    const settled = ev.subs.length;
    await vi.advanceTimersByTimeAsync(EV_RETRY_MS[EV_RETRY_MS.length - 1]);
    expect(ev.subs.length).toBe(settled); // the short ladder would have tried again by now
    await vi.advanceTimersByTimeAsync(EV_TERMINAL_BACKOFF_MS);
    expect(ev.subs.length).toBe(settled + 1); // the terminal wait's own end still fires
    expect(store.ev.state).toBe('on');
  });

  it('a re-mint that throws leaves the ladder\'s first rung standing, and the tab keeps polling', async () => {
    vi.useFakeTimers();
    bootstrapEvents = { mode: 'handle', handle: 'kvh-throw', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    remintAnswer = () => { throw new Error('offline'); };
    ev.fail('kv:kvh-throw:s0', stale());
    await settle();
    expect(remintCalls.length).toBe(1);
    expect(store._evFast()).toBe(false);
    await vi.advanceTimersByTimeAsync(EV_RETRY_MS[0] - 1);
    expect(store.ev.state).toBe('off');
    expect(store._evFast()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.ev.state).toBe('on');
    expect(ev.latest().subject).toBe('kv:kvh-throw:s0'); // the same, still-dead subject: no fresh handle came back
  });

  it('a handle that worked and dies later gets its own ask: a successful subscribe resets `reminted`', async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-a', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    remintAnswer = () => ({ events: { mode: 'handle', handle: 'kvh-b', shards: EV_SHARDS, shard: 0 } });
    ev.fail('kv:kvh-a:s0', stale());
    await settle();
    expect(remintCalls).toEqual([WS_ID]);
    expect(ev.latest().subject).toBe('kv:kvh-b:s0');
    expect(store.ev.reminted).toBeNull(); // the fresh handle's own success reset it

    // kvh-b itself dies later: a fresh problem, worth its own ask, not silently skipped.
    ev.fail('kv:kvh-b:s0', stale());
    await settle();
    expect(remintCalls).toEqual([WS_ID, WS_ID]);
  });

  it('own mode never asks for a re-mint: a stale-subject refusal there takes the ordinary ladder', async () => {
    vi.useFakeTimers();
    bootstrapEvents = { mode: 'own', appUid: 'app-teamchat-test', key: `tc:ws:${WS_ID}:ev:s0`, shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    ev.fail(`kv:app-teamchat-test:tc:ws:${WS_ID}:ev:s0`, stale());
    await settle();
    expect(remintCalls).toEqual([]); // own mode holds no handle to replace
    expect(store.ev.state).toBe('off');
    await vi.advanceTimersByTimeAsync(EV_RETRY_MS[0] + 1);
    expect(store.ev.state).toBe('on'); // the ordinary ladder's first rung, not the terminal wait
  });

  it('the same handle coming back from a re-mint is not resubscribed to at once', async () => {
    vi.useFakeTimers();
    bootstrapEvents = { mode: 'handle', handle: 'kvh-same', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    remintAnswer = () => ({ events: { mode: 'handle', handle: 'kvh-same', shards: EV_SHARDS, shard: 0 } });
    const first = ev.latest();
    ev.fail('kv:kvh-same:s0', stale());
    await settle();
    expect(remintCalls.length).toBe(1);
    expect(first.offCalls).toBe(0); // the "same handle" answer never touched the subscription
    expect(store.ev.state).toBe('off'); // still waiting out the ladder's first rung, unaffected
    await vi.advanceTimersByTimeAsync(EV_RETRY_MS[0] + 1);
    expect(store.ev.state).toBe('on'); // the wait's own end still fires, on schedule
    expect(ev.latest().subject).toBe('kv:kvh-same:s0');
  });

  it('a workspace switched away from during the round trip re-arms nothing', async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-switch', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    let resolveRemint;
    remintAnswer = () => new Promise((resolve) => { resolveRemint = resolve; });
    const holder = store.ev;
    ev.fail('kv:kvh-switch:s0', stale());
    await settle();
    expect(remintCalls.length).toBe(1);
    store.wsId = OTHER_REF; // switched away while the re-mint's own request is still in flight
    resolveRemint({ events: { mode: 'handle', handle: 'kvh-new', shards: EV_SHARDS, shard: 0 } });
    await settle();
    expect(ev.subs.some((s) => s.subject === 'kv:kvh-new:s0')).toBe(false);
    expect(holder.state).toBe('off');
  });

  it('a link\'s dead handle asks that link\'s own host, not the workspace\'s', async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-own-side', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    const link = { ref: OTHER_REF, loaded: true, loading: null, convs: new Map() };
    store.links.set(link.ref, link);
    store._evSetLink(link, REF, { mode: 'handle', handle: 'kvh-link-dead', shards: EV_SHARDS, shard: 1 });
    await settle();
    remintAnswer = () => ({ events: { mode: 'handle', handle: 'kvh-link-fresh', shards: EV_SHARDS, shard: 1 } });
    ev.fail('kv:kvh-link-dead:s1', stale());
    await settle();
    expect(remintCalls).toEqual(['zzz999zzz9']); // OTHER_REF's own id, not WS_ID
    expect(link.ev.state).toBe('on');
    expect(ev.latest().subject).toBe('kv:kvh-link-fresh:s1');
  });
});

describe('teardown', () => {
  it('stopPolling() tears the subscription down: off, unsubscribed, timer cleared', async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-stop', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    store.startPolling();
    const sub = ev.latest();
    store.stopPolling();
    expect(store.ev.state).toBe('off');
    expect(sub.offCalls).toBe(1);
    expect(store._timer).toBeNull();
  });

  it('a delivery after stopPolling() does not restart polling', async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-late', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    store.startPolling();
    // The epoch bump in _evTeardown already makes a real delivery arriving
    // this late unreachable in practice; this calls the handler directly, as
    // a race landing in the same tick as stopPolling() would, to exercise
    // _onEvSignal's own belt-and-suspenders guard (this._timer === null).
    const holder = store.ev;
    const wsId = store.wsId;
    store.stopPolling();
    const timers = vi.spyOn(store, '_schedule');
    store._onEvSignal(holder, wsId);
    expect(store._timer).toBeNull();
    expect(timers).not.toHaveBeenCalled();
  });

  it('a workspace switch tears down the old subscription', async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-switch', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    store.startPolling();
    const sub = ev.latest();
    await store.openWorkspace(OTHER_REF);
    expect(sub.offCalls).toBe(1);
  });
});

describe('the AND rule for shared-channel links', () => {
  beforeEach(async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-and', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('on'); // the workspace's own subscription is healthy going in
  });

  it('with no links at all, _evFast is true', () => {
    expect(store._evFast()).toBe(true);
  });

  it('a link not yet loaded keeps the classic cadence', () => {
    store.links.set('other-host', { loaded: false, loading: null, ev: null });
    expect(store._evFast()).toBe(false);
  });

  it('a link mid-load keeps the classic cadence', () => {
    store.links.set('other-host', { loaded: true, loading: Promise.resolve(), ev: { state: 'on' } });
    expect(store._evFast()).toBe(false);
  });

  it('a loaded link with no subscription of its own keeps the classic cadence', () => {
    store.links.set('other-host', { loaded: true, loading: null, ev: null });
    expect(store._evFast()).toBe(false);
  });

  it('a loaded link whose subscription is still arming keeps the classic cadence', () => {
    store.links.set('other-host', { loaded: true, loading: null, ev: { state: 'arming' } });
    expect(store._evFast()).toBe(false);
  });

  it('a loaded link with a healthy subscription of its own: the fast cadence applies', () => {
    store.links.set('other-host', { loaded: true, loading: null, ev: { state: 'on' } });
    expect(store._evFast()).toBe(true);
  });

  it('the poll scheduler picks POLL_SAFETY_MS only when _evFast is true', async () => {
    const timers = vi.spyOn(store, '_schedule');
    await store.poll();
    expect(lastSchedule(timers)).toBe(POLL_SAFETY_MS);
    timers.mockClear();
    store.links.set('other-host', { loaded: false, loading: null, ev: null });
    await store.poll();
    expect(lastSchedule(timers)).toBe(POLL_VISIBLE_MS);
  });
});

describe('the degradation detector', () => {
  /**
   * A change stamped just past this poll's own read: what a real,
   * unsignalled change looks like. Anything stamped before the previous
   * poll's read is the sync route's two seconds of margin re-reporting it,
   * which is not a miss.
   */
  const freshChange = () => ({ c: { general: { s: 2, t: Date.now() + 1, u: 'someone-else' } } });

  beforeEach(async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-degrade', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    // refreshWorkspace() (unlike a real bootstrap) does not seed this; set by
    // hand so every test here starts from a known "now" rather than whatever
    // an earlier poll (in this describe or another) last left it at.
    store._evSyncAt = Date.now();
  });

  it('three consecutive unpoked, unsignalled safety polls that find a c.* change degrade the session', async () => {
    for (let i = 0; i < EV_MISSES_TO_DEGRADE - 1; i++) {
      syncExtra = freshChange();
      store._pendingReason = 'cadence'; // a plain safety poll, not poked or signal-driven
      await store.poll();
      expect(store.ev.misses).toBe(i + 1);
      expect(store.ev.state).toBe('on'); // not degraded yet
    }
    syncExtra = freshChange();
    store._pendingReason = 'cadence';
    await store.poll();
    expect(store.ev.state).toBe('off'); // torn down on the third miss
    expect(store.ev.misses).toBe(0);
    expect(store.ev.degradedUntil).toBeGreaterThan(Date.now());
  });

  it('a real delivery in between resets the miss count, so it never reaches the threshold', async () => {
    syncExtra = freshChange();
    store._pendingReason = 'cadence';
    await store.poll();
    expect(store.ev.misses).toBe(1);
    ev.deliver('kv:kvh-degrade:s0');
    expect(store.ev.misses).toBe(0);
    syncExtra = freshChange();
    store._pendingReason = 'cadence';
    await store.poll();
    expect(store.ev.misses).toBe(0); // this poll consumes the delivered signal
    expect(store.ev.state).toBe('on');
  });

  it('a degraded session re-arms after EV_DEGRADE_MS', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < EV_MISSES_TO_DEGRADE; i++) {
      syncExtra = freshChange();
      store._pendingReason = 'cadence';
      await store.poll();
    }
    expect(store.ev.state).toBe('off');
    expect(ev.subs.filter((s) => !s.offCalls).length).toBe(0);
    await vi.advanceTimersByTimeAsync(EV_DEGRADE_MS + 1);
    expect(store.ev.state).toBe('on');
    expect(ev.latest().subject).toBe('kv:kvh-degrade:s0');
  });

  it('a poked poll finding the same kind of change does not count as a miss', async () => {
    syncExtra = freshChange();
    store._pendingReason = 'poke';
    await store.poll();
    expect(store.ev.misses).toBe(0);
  });

  it('an entry stamped before the previous poll\'s read is the sync route\'s margin, not a miss', async () => {
    syncExtra = { c: { general: { s: 2, t: Date.now() - 5000, u: 'someone-else' } } };
    store._pendingReason = 'cadence';
    await store.poll();
    expect(store.ev.misses).toBe(0);
    expect(store.ev.state).toBe('on');
  });

  it('an entry newer than the previous read counts as a miss', async () => {
    syncExtra = freshChange();
    store._pendingReason = 'cadence';
    await store.poll();
    expect(store.ev.misses).toBe(1);
  });

  it('the same change re-reported by the next poll is not a second miss', async () => {
    // The route's margin really does hand the same entry back once more: the
    // first poll reads it as the change it is, the second as the re-report.
    const t = Date.now();
    store._evSyncAt = t - 1;
    syncExtra = { c: { general: { s: 2, t, u: 'someone-else' } } };
    store._pendingReason = 'cadence';
    await store.poll();
    expect(store.ev.misses).toBe(1);
    // A poll that finds nothing new clears the streak, so the re-report
    // reads as the clean poll it is rather than as a second miss.
    store._pendingReason = 'cadence';
    await store.poll();
    expect(store.ev.misses).toBe(0);
  });

  it('an `x` stamp newer than the previous read counts as a miss too', async () => {
    syncExtra = { c: { general: { s: 2, x: Date.now() + 1, u: 'someone-else' } } };
    store._pendingReason = 'cadence';
    await store.poll();
    expect(store.ev.misses).toBe(1);
  });
});

describe('hidden tabs', () => {
  it('ignore a delivery outright', async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-hidden', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    globalThis.document.hidden = true;
    store._lastPollAt = Date.now();
    const timers = vi.spyOn(store, '_schedule');
    ev.deliver('kv:kvh-hidden:s0');
    expect(timers).not.toHaveBeenCalled();
    expect(store._poked).toBe(false);
  });

  it('keep polling at POLL_HIDDEN_MS regardless of how healthy the subscription is', async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-hidden2', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('on');
    globalThis.document.hidden = true;
    const timers = vi.spyOn(store, '_schedule');
    await store.poll();
    expect(lastSchedule(timers)).toBe(POLL_HIDDEN_MS);
  });
});

describe('the outbox holds the classic cadence, events or not', () => {
  it('_hasQueued keeps POLL_VISIBLE_MS even with a healthy subscription', async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-queued', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    expect(store._evFast()).toBe(true);
    store._hasQueued = true;
    const timers = vi.spyOn(store, '_schedule');
    await store.poll();
    expect(lastSchedule(timers)).toBe(POLL_VISIBLE_MS);
  });

  // What a hidden tab is promised is that it is never polled more often than
  // it is today, and a queued send is not a reason to break that: the
  // outbox's override only ever speeds up a tab that is in view.
  it('does not let a queued send speed a hidden tab up', async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-queued-hidden', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    store._hasQueued = true;
    globalThis.document.hidden = true;
    const timers = vi.spyOn(store, '_schedule');
    await store.poll();
    expect(lastSchedule(timers)).toBe(POLL_HIDDEN_MS);
  });
});


describe('event scheduling regressions', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    bootstrapEvents = { mode: 'handle', handle: 'kvh-race', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
  });

  it('keeps the two-second floor for deliveries during a poll', async () => {
    const exec = puter.workers.exec;
    puter.workers.exec = async (...args) => {
      ev.deliver('kv:kvh-race:s0');
      return exec(...args);
    };
    const schedule = vi.spyOn(store, '_schedule');
    await store.poll();
    expect(schedule).toHaveBeenLastCalledWith(SIGNAL_FLOOR_MS, 'signal');
  });

  it('preserves a user poke when a signal arrives during the same poll', async () => {
    const exec = puter.workers.exec;
    puter.workers.exec = async (...args) => {
      store.pokeSync();
      ev.deliver('kv:kvh-race:s0');
      return exec(...args);
    };
    const schedule = vi.spyOn(store, '_schedule');
    await store.poll();
    expect(schedule).toHaveBeenLastCalledWith(50, 'poke');
  });

  it('does not delay a pending user poke for a signal', () => {
    store.pokeSync();
    const schedule = vi.spyOn(store, '_schedule');
    ev.deliver('kv:kvh-race:s0');
    expect(schedule).not.toHaveBeenCalled();
  });

  it('does not speed up a tab hidden while its sync was in flight', async () => {
    const exec = puter.workers.exec;
    puter.workers.exec = async (...args) => {
      ev.deliver('kv:kvh-race:s0');
      document.hidden = true;
      return exec(...args);
    };
    const schedule = vi.spyOn(store, '_schedule');
    await store.poll();
    expect(lastSchedule(schedule)).toBe(POLL_HIDDEN_MS);
  });

  it('waits for visibility to re-arm after a hidden bootstrap refresh', async () => {
    document.hidden = true;
    store._evOnVisibility();
    await vi.advanceTimersByTimeAsync(60_001);
    expect(store.ev.state).toBe('off');
    bootstrapEvents = { ...bootstrapEvents, handle: 'kvh-new' };
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('off');
    document.hidden = false;
    store._evOnVisibility();
    await settle();
    expect(ev.latest().subject).toBe('kv:kvh-new:s0');
  });

  it('does not create a subscription when bootstrapped in a hidden tab', async () => {
    store.stopPolling();
    document.hidden = true;
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('off');
    expect(ev.subs).toHaveLength(1);
  });
});

/**
 * A hide shorter than HIDDEN_UNSUB_MS (any ordinary alt-tab) leaves the
 * subscription live: _evApply sets holder.lastDesc and returns early while
 * hidden, so a bootstrap that rotated the handle, moved the shard, or
 * withdrew the block was left standing on show, subscribed to a subject that
 * no longer matched it (or was gone), reading as healthy on the slow cadence
 * until the degradation detector noticed three misses later. _evOnVisibility
 * now re-applies holder.lastDesc unconditionally on show, not only when the
 * holder had actually been torn down.
 */
describe('a hidden tab picks up whatever the last bootstrap said, not only what teardown undid', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    bootstrapEvents = { mode: 'handle', handle: 'kvh-hold', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('on'); // live going into the hide, well under HIDDEN_UNSUB_MS
    document.hidden = true;
  });

  it('a rotated handle arriving during the hide is picked up on show', async () => {
    const first = ev.latest();
    bootstrapEvents = { mode: 'handle', handle: 'kvh-rotated', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    expect(first.offCalls).toBe(0); // _evApply no-ops while hidden: nothing has happened yet
    document.hidden = false;
    store._evOnVisibility();
    await settle();
    expect(first.offCalls).toBe(1);
    expect(ev.latest().subject).toBe('kv:kvh-rotated:s0');
  });

  it('events withdrawn during the hide ends the holder off on show, with no new subscription', async () => {
    const first = ev.latest();
    bootstrapEvents = null; // the bootstrap's own `events` key, present and explicitly null
    await store.refreshWorkspace();
    await settle();
    document.hidden = false;
    store._evOnVisibility();
    await settle();
    expect(store.ev.state).toBe('off');
    expect(first.offCalls).toBe(1);
    expect(ev.subs.some((s) => !s.offCalls)).toBe(false);
  });

  it('an unchanged descriptor during the hide does not churn the subscription on show', async () => {
    const first = ev.latest();
    await store.refreshWorkspace(); // same events block again
    await settle();
    document.hidden = false;
    store._evOnVisibility();
    await settle();
    expect(first.offCalls).toBe(0);
    expect(ev.subs.length).toBe(1);
  });

  it('a shard change during the hide is picked up on show too', async () => {
    const first = ev.latest();
    bootstrapEvents = { mode: 'handle', handle: 'kvh-hold', shards: EV_SHARDS, shard: 3 };
    await store.refreshWorkspace();
    await settle();
    document.hidden = false;
    store._evOnVisibility();
    await settle();
    expect(first.offCalls).toBe(1);
    expect(ev.latest().subject).toBe('kv:kvh-hold:s3');
  });
});

/**
 * _evTeardown clears retryTimer but leaves retryUntil/retryDesc standing (see
 * _evArmRetry), so a hide/show cycle does not throw away an outstanding
 * backoff: without that, a hidden teardown left holder.desc null, the
 * "nothing changed" guard did not fire, and showing the tab subscribed at
 * once and failed terminally again — one wasted failing subscribe per
 * hide/show cycle, forever, in a region where the feature is off.
 */
describe('a pending backoff survives a hide/show cycle', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    bootstrapEvents = { mode: 'handle', handle: 'kvh-wait', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    const err = new Error('off here');
    err.code = 'events_disabled'; // an EV_TERMINAL_CODES code: the hour-long wait
    ev.fail('kv:kvh-wait:s0', err);
    expect(store.ev.state).toBe('off');
  });

  it('a hide that tears the subscription down does not restart the wait: it fires once, on its own original schedule', async () => {
    document.hidden = true;
    store._evOnVisibility();
    await vi.advanceTimersByTimeAsync(60_001); // past HIDDEN_UNSUB_MS: torn down mid-wait
    document.hidden = false;
    store._evOnVisibility();
    await settle();
    expect(ev.subs.length).toBe(1); // no fresh attempt on show: the wait from before the hide still stands
    await vi.advanceTimersByTimeAsync(EV_TERMINAL_BACKOFF_MS);
    expect(ev.subs.length).toBe(2); // the wait's own end still fires, exactly once
  });

  it('a genuinely different descriptor arriving during the wait cancels it and subscribes the moment the tab is shown', async () => {
    document.hidden = true;
    store._evOnVisibility();
    await vi.advanceTimersByTimeAsync(60_001);
    bootstrapEvents = { mode: 'handle', handle: 'kvh-new', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('off'); // still hidden: _evApply no-ops
    document.hidden = false;
    store._evOnVisibility();
    await settle();
    expect(store.ev.state).toBe('on'); // not made to wait out the rest of the hour
    expect(ev.latest().subject).toBe('kv:kvh-new:s0');
  });
});

describe('shared-host degradation', () => {
  let link;
  const desc = { mode: 'handle', handle: 'kvh-link', shards: EV_SHARDS, shard: 1 };
  beforeEach(async () => {
    vi.useFakeTimers();
    bootstrapEvents = { mode: 'handle', handle: 'kvh-own', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    link = {
      ref: OTHER_REF, loaded: true, loading: null, since: 0, w: 0, u: 0,
      convs: new Map([['general', 'linked-general']]), evSyncAt: Date.now() - 1,
    };
    store.links.set(link.ref, link);
    store._evSetLink(link, REF, desc);
    await settle();
  });

  async function changed({ poke = false, ownSignal = false } = {}) {
    if (ownSignal) ev.deliver('kv:kvh-own:s0');
    const ts = (link.evSyncAt || Date.now()) + 1;
    await store._applyLinked([{ link, data: { now: ts - 2000, ts, c: { general: { s: 1, t: ts } }, p: {} } }], poke);
  }

  it('degrades a silent linked host even when the own subscription delivers', async () => {
    for (let i = 0; i < EV_MISSES_TO_DEGRADE; i++) await changed({ ownSignal: true });
    expect(link.ev.state).toBe('off');
    expect(store.ev.state).toBe('on');
    expect(store._evFast()).toBe(false);
    expect(ev.subs.find((s) => s.subject === 'kv:kvh-link:s1').offCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(EV_DEGRADE_MS + 1);
    expect(link.ev.state).toBe('on');
    expect(store._evFast()).toBe(true);
  });

  it('restores the classic cadence through actual linked sync requests', async () => {
    const exec = puter.workers.exec;
    puter.workers.exec = async (url, ...args) => {
      if (new URL(url).pathname === '/api/ws/zzz999zzz9/sync') {
        const ts = link.evSyncAt + 1;
        return json({ now: ts - 2000, ts, c: { general: { s: 1, t: ts } }, p: {}, w: 0, u: 0 });
      }
      return exec(url, ...args);
    };
    const schedule = vi.spyOn(store, '_schedule');
    for (let i = 0; i < EV_MISSES_TO_DEGRADE; i++) {
      store._pendingReason = 'cadence';
      await store.poll();
      await link.syncing;
    }
    expect(link.ev.state).toBe('off');
    await store.poll();
    expect(lastSchedule(schedule)).toBe(POLL_VISIBLE_MS);
  });

  it('resets only the delivering host and ignores re-reported changes', async () => {
    await changed();
    expect(link.ev.misses).toBe(1);
    ev.deliver('kv:kvh-link:s1');
    await changed();
    expect(link.ev.misses).toBe(0);
    await changed();
    expect(link.ev.misses).toBe(1);
    const ts = link.evSyncAt;
    await store._applyLinked([{ link, data: { now: ts - 2000, ts, c: { general: { s: 1, t: ts } }, p: {} } }]);
    expect(link.ev.misses).toBe(0);
    await changed({ poke: true });
    expect(link.ev.misses).toBe(0);
  });

  it('uses the newest descriptor when recovering', async () => {
    for (let i = 0; i < EV_MISSES_TO_DEGRADE; i++) await changed();
    store._evSetLink(link, REF, { ...desc, handle: 'kvh-rotated' });
    await vi.advanceTimersByTimeAsync(EV_DEGRADE_MS + 1);
    expect(ev.latest().subject).toBe('kv:kvh-rotated:s1');
  });

  it('stays off if a bootstrap withdraws events during recovery', async () => {
    for (let i = 0; i < EV_MISSES_TO_DEGRADE; i++) await changed();
    store._evSetLink(link, REF, null);
    await vi.advanceTimersByTimeAsync(EV_DEGRADE_MS + 1);
    expect(link.ev.state).toBe('off');
  });

  it('does not recover a removed link or restart after stopPolling', async () => {
    for (let i = 0; i < EV_MISSES_TO_DEGRADE; i++) await changed();
    const count = ev.subs.length;
    store._evTeardown(link.ev);
    store.links.delete(link.ref);
    store.stopPolling();
    await vi.advanceTimersByTimeAsync(EV_DEGRADE_MS + 1);
    expect(ev.subs).toHaveLength(count);
  });

  it('keeps a hidden link off through refresh and recovery, then re-arms on visibility', async () => {
    for (let i = 0; i < EV_MISSES_TO_DEGRADE; i++) await changed();
    document.hidden = true;
    store._evOnVisibility();
    await vi.advanceTimersByTimeAsync(60_001);
    store._evSetLink(link, REF, desc);
    await vi.advanceTimersByTimeAsync(EV_DEGRADE_MS);
    expect(link.ev.state).toBe('off');
    document.hidden = false;
    store._evOnVisibility();
    await settle();
    expect(link.ev.state).toBe('on');
  });

  // A link's holder gets the same hidden-tab treatment as the workspace's
  // own (see "a hidden tab picks up whatever the last bootstrap said"
  // above): a rotated descriptor arriving during a hide too short to tear
  // the link's subscription down must still be picked up on show.
  it('a link\'s descriptor rotated during a hide too short to tear it down is picked up on show', async () => {
    document.hidden = true;
    store._evOnVisibility();
    store._evSetLink(link, REF, { ...desc, handle: 'kvh-link-rotated' });
    document.hidden = false;
    store._evOnVisibility();
    await settle();
    expect(ev.latest().subject).toBe('kv:kvh-link-rotated:s1');
  });
});

describe('a signal that carries the shard it woke on (Events `includeValue`)', () => {
  const OWN_KEY = `tc:ws:${WS_ID}:ev:s0`;
  const ownDesc = { mode: 'own', appUid: 'app-teamchat-test', key: OWN_KEY, shards: EV_SHARDS, shard: 0 };
  const ownSubject = `kv:app-teamchat-test:${OWN_KEY}`;

  it('both modes ask for the value', async () => {
    bootstrapEvents = ownDesc;
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('on');
    expect(ev.latest().opts.includeValue).toBe(true);

    // A share handle delivers values too: the grant is over the region, and
    // the check that stops a revoked handle's deliveries stops its values
    // with them. A member is not left polling where the owner is not.
    store._evTeardown(store.ev);
    store._evApply(store.ev, WS_ID, { mode: 'handle', handle: 'kvh-values', shards: EV_SHARDS, shard: 0 });
    await settle();
    expect(store.ev.state).toBe('on');
    expect(ev.latest().opts.includeValue).toBe(true);
  });

  it('a delivery through a handle is judged the same way: covered by the last poll, no poll', async () => {
    bootstrapEvents = { mode: 'handle', handle: 'kvh-covered', shards: EV_SHARDS, shard: 0 };
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('on');
    store._evSyncAt = Date.now();
    store._lastPollAt = Date.now() - SIGNAL_FLOOR_MS;
    const timers = vi.spyOn(store, '_schedule');
    const subject = 'kv:kvh-covered:s0';
    ev.deliver(subject, { op: 'set', key: 's0', value: { t: store._evSyncAt - 1 } });
    expect(timers).not.toHaveBeenCalled();
    ev.deliver(subject, { op: 'set', key: 's0', value: { t: store._evSyncAt + 1 } });
    expect(timers).toHaveBeenCalledTimes(1);
  });

  it('a delivery the last poll already covered schedules no poll, and still counts as a delivery', async () => {
    bootstrapEvents = ownDesc;
    await store.refreshWorkspace();
    await settle();
    store._evSyncAt = Date.now();
    store.ev.misses = 2;
    const timers = vi.spyOn(store, '_schedule');
    // Written before this tab's last poll read: that poll carried it.
    ev.deliver(ownSubject, { op: 'set', key: OWN_KEY, value: { t: store._evSyncAt - 1 } });
    expect(timers).not.toHaveBeenCalled();
    // The subscription is plainly working, so the degradation detector is satisfied.
    expect(store.ev.misses).toBe(0);
    expect(store.ev.signalled).toBe(true);
  });

  it('a delivery stamped past the last poll polls, as one with no value does', async () => {
    bootstrapEvents = ownDesc;
    await store.refreshWorkspace();
    await settle();
    store._evSyncAt = Date.now();
    store._lastPollAt = Date.now() - SIGNAL_FLOOR_MS;
    const timers = vi.spyOn(store, '_schedule');
    ev.deliver(ownSubject, { op: 'set', key: OWN_KEY, value: { t: store._evSyncAt + 1 } });
    expect(timers).toHaveBeenCalledTimes(1);
    timers.mockClear();
    // An old platform, a value over the delivery cap, or a gap marker: nothing
    // is known, so the poll goes as it always did.
    ev.deliver(ownSubject);
    expect(timers).toHaveBeenCalledTimes(1);
    timers.mockClear();
    ev.deliver(ownSubject, { op: 'gap', reason: 'limit' });
    expect(timers).toHaveBeenCalledTimes(1);
  });

  it("a linked host's own delivery always polls: its shard is stamped by another worker's clock", async () => {
    bootstrapEvents = ownDesc;
    await store.refreshWorkspace();
    await settle();
    store._evSyncAt = Date.now();
    const link = { loaded: true, loading: null, ev: { state: 'on', misses: 0, signalled: false } };
    store.links.set('other-host', link);
    store._lastPollAt = Date.now() - SIGNAL_FLOOR_MS;
    const timers = vi.spyOn(store, '_schedule');
    store._onEvSignal(link.ev, store.wsId, { op: 'set', key: 'x', value: { t: store._evSyncAt - 1 } });
    expect(timers).toHaveBeenCalledTimes(1);
  });

  it('a region where values are not delivered yet subscribes again at once without them, and stops asking', async () => {
    bootstrapEvents = ownDesc;
    ev.refuseNext(Object.assign(new Error('nope'), { code: 'events_kv_handle_no_values' }));
    await store.refreshWorkspace();
    await settle();
    // No backoff rung was spent on it: the second attempt is already live.
    expect(store.ev.state).toBe('on');
    expect(store.ev.retryIdx).toBe(0);
    expect(store._evNoValues).toBe(true);
    expect(ev.latest().opts.includeValue).toBeUndefined();
    // And never asked for again, even on a fresh subscribe.
    store._evTeardown(store.ev);
    store._evApply(store.ev, WS_ID, ownDesc);
    await settle();
    expect(ev.latest().opts.includeValue).toBeUndefined();
  });
});

describe('the safety cadence, and the one change nothing signals', () => {
  const ownDesc = { mode: 'own', appUid: 'app-teamchat-test', key: `tc:ws:${WS_ID}:ev:s0`, shards: EV_SHARDS, shard: 0 };

  it('a healthy subscription polls at the safety floor, not the visible cadence', async () => {
    bootstrapEvents = ownDesc;
    await store.refreshWorkspace();
    await settle();
    expect(store.ev.state).toBe('on');
    const timers = vi.spyOn(store, '_schedule');
    await store.poll();
    expect(lastSchedule(timers)).toBe(POLL_SAFETY_MS);
  });

  it('but aims a poll at a scheduled message instead of stumbling on it', async () => {
    bootstrapEvents = ownDesc;
    // The worker says something comes due in eight seconds, which is sooner
    // than the safety floor: the tab waits that long and no longer.
    syncExtra = { ndIn: 8000 };
    await store.refreshWorkspace();
    await settle();
    const timers = vi.spyOn(store, '_schedule');
    await store.poll();
    const next = lastSchedule(timers);
    expect(next).toBeLessThan(POLL_SAFETY_MS);
    expect(next).toBeGreaterThan(7000);
  });

  it('a due time further off than the floor leaves the cadence alone', async () => {
    bootstrapEvents = ownDesc;
    syncExtra = { ndIn: 10 * 60_000 };
    await store.refreshWorkspace();
    await settle();
    const timers = vi.spyOn(store, '_schedule');
    await store.poll();
    expect(lastSchedule(timers)).toBe(POLL_SAFETY_MS);
  });

  it('nothing scheduled leaves the cadence alone', async () => {
    bootstrapEvents = ownDesc;
    syncExtra = {};
    await store.refreshWorkspace();
    await settle();
    const timers = vi.spyOn(store, '_schedule');
    await store.poll();
    expect(lastSchedule(timers)).toBe(POLL_SAFETY_MS);
  });
});
