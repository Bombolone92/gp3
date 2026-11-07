import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../src/lib/store.js';
import { publishFeed, revokeFeed, regenerateFeed, FEED_PATH } from '../src/lib/calendar.js';

/** Puter stand-in with a hosting API, so the feed paths are exercised whole. */
function mockPuter() {
  const kv = new Map();
  const files = new Map();
  const sites = new Map();
  return {
    kv: {
      async get(k) { return kv.has(k) ? structuredClone(kv.get(k)) : null; },
      async set(k, v) { kv.set(k, structuredClone(v)); },
    },
    fs: {
      async read(p) {
        if (!files.has(p)) { const e = new Error('nope'); e.code = 'subject_does_not_exist'; throw e; }
        return new Blob([files.get(p)]);
      },
      async write(p, d) { files.set(p, typeof d === 'string' ? d : await new Blob([d]).text()); },
      async delete(p) {
        if (!files.has(p)) { const e = new Error('nope'); e.code = 'subject_does_not_exist'; throw e; }
        files.delete(p);
      },
    },
    hosting: {
      async create(subdomain, dir) { sites.set(subdomain, dir); return { subdomain }; },
      async delete(subdomain) {
        if (!sites.has(subdomain)) throw new Error('no such site');
        sites.delete(subdomain);
      },
    },
    auth: { async getUser() { return { username: 'tester' }; } },
    _files: files,
    _sites: sites,
  };
}

describe('calendar feed', () => {
  let mock;

  beforeEach(async () => {
    mock = mockPuter();
    globalThis.puter = mock;
    await store.importAll({ settings: {}, contracts: [], contacts: [] });
  });

  it('mints a subdomain that is a secret, not a readable id', async () => {
    const url = await publishFeed();
    // 24 characters of CSPRNG over a 32-symbol alphabet: 120 bits.
    expect(url).toMatch(/^https:\/\/cm-[a-z2-9]{24}\.puter\.site\/deadlines\.ics$/);

    const token = (u) => u.match(/cm-([a-z2-9]+)\./)[1];
    const second = await publishFeed();
    expect(token(second)).not.toBe(token(url));
    // uid() ended in the clock, so two ids minted in the same tick shared a
    // six-character tail. Every character here has to carry entropy.
    expect(token(second).slice(-6)).not.toBe(token(url).slice(-6));
  });

  it('publishes the calendar file into the hosted folder', async () => {
    await publishFeed();
    expect(mock._files.get(FEED_PATH)).toContain('BEGIN:VCALENDAR');
    expect([...mock._sites.values()]).toEqual(['contract-manager/calendar']);
    // Only the calendar is served; the contract data lives outside that folder.
    expect(mock._sites.get(store.settings.feed.subdomain)).toBe('contract-manager/calendar');
  });

  it('keeps the feed on record when neither deletion lands', async () => {
    const url = await publishFeed();
    mock.fs.delete = async () => { throw new Error('offline'); };
    mock.hosting.delete = async () => { throw new Error('offline'); };

    await expect(revokeFeed()).rejects.toThrow('offline');
    // The link is still live; forgetting it would report a dead link and throw
    // away the address needed to try again.
    expect(store.settings.feed.url).toBe(url);
  });

  /*
   * Deleting the file makes the URL 404, which looks like a dead link, but the
   * folder behind the address is still published: the next feed written into it
   * is served from that same address. So the file going is not enough.
   */
  it('will not call a revoke done while the address is still live', async () => {
    const url = await publishFeed();
    const { subdomain } = store.settings.feed;
    mock.hosting.delete = async () => { throw new Error('offline'); };

    await expect(revokeFeed()).rejects.toThrow('offline');
    expect(store.settings.feed.url).toBe(url);
    expect(mock._sites.get(subdomain)).toBe('contract-manager/calendar');
  });

  it('does not bring a replaced link back to life', async () => {
    await publishFeed();
    const first = store.settings.feed.subdomain;
    mock.hosting.delete = async () => { throw new Error('offline'); };

    await expect(regenerateFeed()).rejects.toThrow('offline');
    // Nothing was minted behind the user's back, and the address they were
    // about to be told had stopped working is not serving fresh deadlines.
    expect(store.settings.feed.subdomain).toBe(first);
    expect(mock._sites.size).toBe(1);
  });

  it('treats an already-missing file as gone rather than as a failure', async () => {
    await publishFeed();
    await mock.fs.delete(FEED_PATH);
    await revokeFeed();
    expect(store.settings.feed).toBeNull();
  });

  it('finishes a revoke whose address has already gone', async () => {
    await publishFeed();
    // As it would be on a retry, after the address went but the change to
    // settings did not save.
    mock._sites.delete(store.settings.feed.subdomain);
    await revokeFeed();
    expect(store.settings.feed).toBeNull();
  });
});
