import { describe, it, expect, vi } from 'vitest';
import { createMessageReads } from '../src/lib/messagereads.js';

describe('session message reads', () => {
  it('reports complete cached bytes only while retained, without fetching or confusing partial ranges', async () => {
    const fs = { read: vi.fn(async (path, options) => {
      const blob = new Blob([path === '/oversized' ? '123456789' : '12345678']);
      return options?.byte_count ? blob.slice(0, options.byte_count) : blob;
    }) };
    const reads = createMessageReads(fs, { maxBytes: 8, maxEntries: 1,
      maxHeadBytes: 8, maxHeadEntries: 1 });
    expect(reads.hasComplete('/missing')).toBe(false);
    expect(fs.read).not.toHaveBeenCalled();
    await reads.read('/partial', { byte_count: 4 });
    expect(reads.hasComplete('/partial')).toBe(false);
    await reads.read('/full');
    expect(reads.hasComplete('/full')).toBe(true);
    await reads.read('/other');
    expect(reads.hasComplete('/full')).toBe(false);
    await reads.read('/oversized');
    expect(reads.hasComplete('/oversized')).toBe(false);
    await reads.read('/short', { byte_count: 16 });
    expect(reads.hasComplete('/short')).toBe(true);
    await reads.read('/new-short', { byte_count: 16 });
    expect(reads.hasComplete('/short')).toBe(false);
    reads.forget();
    expect(reads.hasComplete('/other')).toBe(false);
    expect(reads.hasComplete('/new-short')).toBe(false);
    expect(fs.read).toHaveBeenCalledTimes(6);
  });
  it('reuses only EOF-proven short ranges and keeps offsets distinct', async () => {
    const fs = { read: vi.fn(async (path, options) => {
      const blob = new Blob(['12345678']);
      return options?.byte_count ? blob.slice(options.offset ?? 0, (options.offset ?? 0) + options.byte_count) : blob;
    }) };
    const reads = createMessageReads(fs);
    await reads.read('/a', { byte_count: 4 });
    expect(await (await reads.read('/a')).text()).toBe('12345678');
    expect(fs.read).toHaveBeenCalledTimes(2);
    await reads.read('/b', { byte_count: 16 });
    expect(await (await reads.read('/b')).text()).toBe('12345678');
    expect(await (await reads.read('/b', { offset: 3, byte_count: 2 })).text()).toBe('45');
    expect(fs.read).toHaveBeenCalledTimes(3);
    await reads.read('/c', { offset: 7, byte_count: 16 });
    expect(await (await reads.read('/c')).text()).toBe('12345678');
    expect(fs.read).toHaveBeenCalledTimes(5);
  });

  it('bounds all read concurrency and starts queued bodies before background heads', async () => {
    const release = [];
    const fs = { read: vi.fn(path => new Promise(resolve => release.push(() => resolve(new Blob([path]))))) };
    const reads = createMessageReads(fs, { concurrency: 2 });
    const jobs = ['/a', '/b', '/c', '/d'].map(path => reads.read(path, { byte_count: 1 }));
    jobs.push(reads.read('/foreground'));
    await vi.waitFor(() => expect(fs.read).toHaveBeenCalledTimes(2));
    release.shift()();
    await vi.waitFor(() => expect(fs.read).toHaveBeenCalledTimes(3));
    expect(fs.read.mock.calls[2][0]).toBe('/foreground');
    for (let i = 0; i < 4; i++) {
      await vi.waitFor(() => expect(release.length).toBeGreaterThan(0));
      release.shift()();
    }
    await Promise.all(jobs);
  });

  it('bounds short-message retention independently from body retention', async () => {
    const fs = { read: vi.fn(async path => new Blob([path])) };
    const reads = createMessageReads(fs, { maxHeadEntries: 2, maxHeadBytes: 4 });
    await reads.read('/body');
    for (const path of ['/a', '/b', '/c']) await reads.read(path, { byte_count: 10 });
    await reads.read('/body');
    await reads.read('/b');
    await reads.read('/c');
    expect(fs.read).toHaveBeenCalledTimes(4);
    await reads.read('/a');
    expect(fs.read).toHaveBeenCalledTimes(5);
    reads.forget();
    await reads.read('/c');
    expect(fs.read).toHaveBeenCalledTimes(6);
  });
  it('shares overlapping headers without confusing ranges or full messages', async () => {
    const fs = { read: vi.fn(async (path, options) => new Blob([
      options?.byte_count ? 'header'.slice(0, options.byte_count) : 'header and body',
    ])) };
    const reads = createMessageReads(fs);
    const [a, b, longer, full] = await Promise.all([
      reads.read('/mail', { byte_count: 4 }), reads.read('/mail', { byte_count: 4 }),
      reads.read('/mail', { byte_count: 6 }), reads.read('/mail'),
    ]);
    expect(fs.read).toHaveBeenCalledTimes(3);
    expect(a).toBe(b);
    expect(await longer.text()).toBe('header');
    expect(await full.text()).toBe('header and body');
    expect(await reads.read('/mail')).toBe(full);
    expect(await (await reads.read('/mail', { byte_count: 4 })).text()).toBe('head');
    expect(fs.read).toHaveBeenCalledTimes(3);
  });

  it('retries failures and keeps separate sessions isolated', async () => {
    const fs = { read: vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(new Blob(['ok'])) };
    const reads = createMessageReads(fs);
    await expect(reads.read('/mail')).rejects.toThrow('offline');
    expect(await (await reads.read('/mail')).text()).toBe('ok');
    await createMessageReads(fs).read('/mail');
    expect(fs.read).toHaveBeenCalledTimes(3);
  });

  it('evicts least recently used bodies within the byte budget and skips oversized files', async () => {
    const fs = { read: vi.fn(async (path) => new Blob([path])) };
    const reads = createMessageReads(fs, { maxBytes: 4 });
    await reads.read('/a');
    await reads.read('/b');
    await reads.read('/a'); // b is now the oldest
    await reads.read('/c'); // evicts b
    await reads.read('/oversized');
    await reads.read('/a');
    await reads.read('/c');
    expect(fs.read.mock.calls.map(([path]) => path)).toEqual(['/a', '/b', '/c', '/oversized']);
    await reads.read('/b');
    await reads.read('/oversized');
    expect(fs.read).toHaveBeenCalledTimes(6);
  });

  it('also caps the number of retained messages', async () => {
    const fs = { read: vi.fn(async () => new Blob([])) };
    const reads = createMessageReads(fs, { maxEntries: 2 });
    for (const path of ['/a', '/b', '/c', '/a']) await reads.read(path);
    expect(fs.read).toHaveBeenCalledTimes(4);
  });

  it('invalidates changed folders without dropping unrelated cached bodies', async () => {
    const fs = { read: vi.fn(async () => new Blob(['original'])) };
    const reads = createMessageReads(fs);
    await reads.read('/inbox/a');
    await reads.read('/inbox-other/b');
    reads.forget('/inbox');
    fs.read.mockResolvedValue(new Blob(['updated']));
    expect(await (await reads.read('/inbox/a')).text()).toBe('updated');
    expect(await (await reads.read('/inbox-other/b')).text()).toBe('original');
    reads.forget();
    expect(await (await reads.read('/inbox-other/b')).text()).toBe('updated');
  });

  it('does not let an invalidated in-flight response replace fresh data', async () => {
    let finish;
    const fs = { read: vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue(new Blob(['new'])) };
    const reads = createMessageReads(fs);
    const old = reads.read('/mail');
    await Promise.resolve();
    reads.forget('/mail');
    await reads.read('/mail');
    finish(new Blob(['old']));
    await old;
    expect(await (await reads.read('/mail')).text()).toBe('new');
    expect(fs.read).toHaveBeenCalledTimes(2);
  });
});
