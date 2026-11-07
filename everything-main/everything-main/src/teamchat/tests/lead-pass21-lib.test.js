/**
 * Client libraries (review pass 21, lead): the store driven in node with its
 * fields set by hand, as tests/client-lib-pass21.test.js drives it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { store } from '../src/lib/store.js';

const REF = 'abc123def0@teamchat-test';

function open() {
  store.wsId = REF;
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.ws = {
    id: 'abc123def0', name: 'Acme', owner: 'u-me',
    channels: { c1: { id: 'c1', name: 'general', def: true, count: 3 } },
    members: {
      'u-me': { role: 'member', name: 'Me', username: 'me' },
      u2: { role: 'member', name: 'Ana', username: 'ana' },
      u3: { role: 'member', name: 'Ben', username: 'ben' },
    },
  };
  store.me = { role: 'member', channels: ['c1'], dms: { d1: { id: 'd1', members: ['u-me', 'u2', 'u3'] } }, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.act = { c: {}, p: {}, w: 1, u: 0 };
}

afterEach(() => {
  store.wsId = null;
  store.ws = null;
  store.me = null;
  store.profile = null;
  store.act = { c: {}, p: {}, w: 0, u: 0 };
});

describe('how many an @here reaches in a direct message', () => {
  it('counts the others here right now, as a guess, rather than every member as certain', () => {
    open();
    // Nobody but the sender has a heartbeat: @here rings nobody, and the
    // confirm must say so rather than "Notify 2 people active now".
    expect(store.broadcastReach('d1', 'here')).toEqual({ count: 0, exact: false });
    // Ana was here a moment ago; Ben has not been seen.
    store.act.p.u2 = Date.now();
    expect(store.broadcastReach('d1', 'here')).toEqual({ count: 1, exact: false });
    // @channel in the same message reaches every other member, exactly.
    expect(store.broadcastReach('d1', 'channel')).toEqual({ count: 2, exact: true });
  });
});

describe('a share link that lost its server part', () => {
  it('is still read as a share link, so the reader can be told it is not valid rather than landed at home in silence', async () => {
    const { parseHash } = await import('../src/lib/router.js');
    expect(parseHash('#/connect/srv/ABCD-EFGH-IJKL')).toMatchObject({ name: 'connect', server: 'srv', code: 'ABCD-EFGH-IJKL' });
    expect(parseHash('#/connect/ABCD-EFGH-IJKL')).toMatchObject({ name: 'connect', server: null, code: 'ABCD-EFGH-IJKL' });
    // A bare "#/connect" says nothing at all and is home, as before.
    expect(parseHash('#/connect').name).toBe('home');
  });
});
