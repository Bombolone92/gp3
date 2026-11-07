import { describe, it, expect, vi } from 'vitest';
import { createMailbox, mailFilename } from '../src/lib/mailbox.js';
import { pagedFs } from './pagedfs.js';

const OBJECTS = '/user/.mail/objects';
const DAY = '2026-09-17';
const names = (count, start = 0) => Array.from({ length: count }, (_, i) => `${String(i + start).padStart(6, '0')}--x`);
const setup = (tree, options = {}) => {
  const fs = pagedFs(OBJECTS, tree, options);
  const mailbox = createMailbox({ fs, objectsPath: OBJECTS, ...(options.pageSize ? { pageSize: options.pageSize } : {}) });
  return { fs, mailbox };
};
const shown = (mailbox) => mailbox.messages.map((message) => message.name);

describe('native directory pagination', () => {
  it('loads sixty messages across thirty days in two listings, then pages without rereading dates', async () => {
    const tree = Object.fromEntries(Array.from({ length: 60 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 0, i + 1));
      return [date.toISOString().slice(0, 10), [0, 1].map(hour => mailFilename('Message',
        new Date(date.getTime() + hour * 3600000)))];
    }));
    const { fs, mailbox } = setup(tree);
    const expected = Object.values(tree).flat().sort().reverse();
    await mailbox.open();
    expect(shown(mailbox)).toEqual(expected.slice(0, 60));
    expect(fs.calls).toHaveLength(2);
    expect(fs.calls.map(call => call.count)).toEqual([60, 120]);
    expect(fs.calls.every(call => call.path === OBJECTS)).toBe(true);
    expect(mailbox.hasMore).toBe(true);
    await mailbox.loadMore();
    expect(shown(mailbox)).toEqual(expected);
    expect(fs.calls).toHaveLength(3);
    expect(fs.calls[2].count).toBe(60);
    expect(mailbox.hasMore).toBe(false);
  });

  it('walks recent dates when a huge root would put thousands of directories before the files', async () => {
    const tree = Object.fromEntries(Array.from({ length: 1500 }, (_, i) =>
      [new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), names(2, i * 2)]));
    const { fs, mailbox } = setup(tree);
    await mailbox.open();
    expect(shown(mailbox)).toEqual(names(60, 2940).reverse());
    expect(fs.calls).toHaveLength(31);
    expect(fs.calls.every(call => !call.options.recursive)).toBe(true);
    expect(fs.calls.filter(call => call.path === OBJECTS)).toHaveLength(1);
    expect(mailbox.hasMore).toBe(true);
    fs.calls.length = 0;
    expect(await mailbox.sync()).toEqual([]);
    expect(fs.calls.map(call => call.count)).toEqual([256, 2]);
  });

  it('fills message batches through directory-only and short recursive pages', async () => {
    const { fs, mailbox } = setup({ [DAY]: names(5) }, { pageSize: 2, pageCap: 1 });
    await mailbox.open();
    expect(shown(mailbox)).toEqual(names(2, 3).reverse());
    expect(fs.calls.map(call => call.count)).toEqual([1, 1, 1, 1]);
    while (mailbox.hasMore) await mailbox.loadMore();
    expect(shown(mailbox)).toEqual(names(5).reverse());
  });

  it('retries a buffered page after invalidation without skipping older files or reviving a removed file', async () => {
    const tree = { [DAY]: names(5) };
    const { mailbox } = setup(tree, { pageSize: 2, pageCap: 2 });
    await mailbox.open();
    expect(shown(mailbox)).toEqual(names(2, 3).reverse());
    // One file remains buffered from the last short recursive page.
    tree[DAY] = tree[DAY].filter(name => name !== names(1, 2)[0]);
    mailbox.forget();
    await mailbox.loadMore();
    expect(shown(mailbox)).toEqual([...names(2, 3).reverse(), ...names(2).reverse()]);
    expect(mailbox.hasMore).toBe(false);
  });

  it('retries a recursive response invalidated while in flight', async () => {
    const tree = { [DAY]: names(6) };
    const { fs, mailbox } = setup(tree, { pageSize: 2 });
    await mailbox.open();
    const original = fs.readdir;
    let release;
    fs.readdir = async (path, options) => {
      const page = await original(path, options);
      if (!release) await new Promise(resolve => { release = resolve; });
      return page;
    };
    const paging = mailbox.loadMore();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    tree[DAY] = tree[DAY].filter(name => name !== names(1, 3)[0]);
    mailbox.forget();
    release();
    await paging;
    expect(shown(mailbox)).toEqual([5, 4, 2, 1].map(i => names(1, i)[0]));
    expect(mailbox.find(names(1, 3)[0])).toBeNull();
  });

  it('ignores out-of-folder files and deeper descendants in recursive responses', async () => {
    const { fs, mailbox } = setup({ [DAY]: names(3) });
    const original = fs.readdir;
    fs.readdir = async (path, options) => {
      const page = await original(path, options);
      if (options.recursive) page.items.unshift(
        { name: 'foreign', path: '/another/2026-09-17/foreign' },
        { name: 'nested', path: `${OBJECTS}/${DAY}/extra/nested` },
        { name: 'root-file', path: `${OBJECTS}/root-file` },
        { name: 'mismatch', path: `${OBJECTS}/${DAY}/different` });
      return page;
    };
    await mailbox.open();
    expect(shown(mailbox)).toEqual(names(3).reverse());
  });

  it('stops an abandoned empty-date scan and can reopen the complete first page', async () => {
    const tree = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`2026-09-${String(i + 1).padStart(2, '0')}`, []]));
    tree['2026-08-01'] = names(3);
    const { fs, mailbox } = setup(tree);
    const original = fs.readdir;
    let cancel = true;
    fs.readdir = async (path, options) => {
      const page = await original(path, options.recursive ? { ...options, limit: 1 } : options);
      if (cancel && options.recursive) {
        cancel = false;
        mailbox.cancelLoad();
      }
      return page;
    };
    expect(await mailbox.open()).toEqual([]);
    expect(fs.calls).toHaveLength(2);
    await mailbox.open();
    expect(shown(mailbox)).toEqual(names(3).reverse());
    expect(mailbox.hasMore).toBe(false);
  });

  it('ignores an abandoned root response after a newer open has completed', async () => {
    const { fs, mailbox } = setup({ [DAY]: names(3) });
    const original = fs.readdir;
    let release;
    fs.readdir = async (path, options) => {
      fs.readdir = original;
      return new Promise(resolve => { release = () => resolve({ items: [] }); });
    };
    const abandoned = mailbox.open();
    mailbox.cancelLoad();
    await mailbox.open();
    release();
    await abandoned;
    expect(shown(mailbox)).toEqual(names(3).reverse());
  });

  it('downloads only sixty file entries from a thousand-message day, newest first', async () => {
    const { fs, mailbox } = setup({ [DAY]: names(1000) });
    await mailbox.open();
    expect(shown(mailbox)).toEqual(names(60, 940).reverse());
    expect(fs.calls.map((call) => call.count)).toEqual([1, 61]);
    expect(fs.calls[1].options).toEqual({ recursive: true, depth: 2, cursor: null, limit: 61, sortBy: 'name', sortOrder: 'desc' });
    await mailbox.loadMore();
    expect(shown(mailbox)).toEqual(names(120, 880).reverse());
    expect(fs.calls.map((call) => call.count)).toEqual([1, 61, 60]);
    expect(fs.calls[2].options.cursor).toBeTypeOf('string');
    while (mailbox.hasMore) await mailbox.loadMore();
    expect(shown(mailbox)).toEqual(names(1000).reverse());
    expect(fs.calls.filter((call) => call.options.recursive)).toHaveLength(17);
    expect(fs.calls.every((call) => !('includeTotal' in call.options) && !('offset' in call.options))).toBe(true);
  });

  it('continues through short pages of date folders without treating them as the end', async () => {
    const tree = Object.fromEntries(Array.from({ length: 8 }, (_, i) =>
      [`2026-09-${String(i + 1).padStart(2, '0')}`, names(1, i)]));
    const { fs, mailbox } = setup(tree, { pageCap: 2, pageSize: 3 });
    await mailbox.open();
    expect(shown(mailbox)).toEqual(names(3, 5).reverse());
    expect(fs.calls.filter((call) => call.path === OBJECTS)).toHaveLength(2);
    expect(mailbox.hasMore).toBe(true);
    while (mailbox.hasMore) await mailbox.loadMore();
    expect(shown(mailbox)).toEqual(names(8).reverse());
    expect(fs.calls.filter((call) => call.path === OBJECTS)).toHaveLength(4);
  });

  it('retains a failed file-page cursor for retry', async () => {
    const { fs, mailbox } = setup({ [DAY]: names(5) }, { pageSize: 2 });
    await mailbox.open();
    const first = mailbox.messages[0];
    const original = fs.readdir;
    let fail = true;
    fs.readdir = async (path, options) => {
      if (fail && options?.recursive && options.cursor) throw new Error('offline');
      return original(path, options);
    };
    expect(await mailbox.loadMore()).toEqual([]);
    expect(mailbox.listError?.message).toBe('offline');
    expect(mailbox.hasMore).toBe(true);
    fail = false;
    await mailbox.loadMore();
    expect(shown(mailbox)).toEqual(names(4, 1).reverse());
    expect(mailbox.messages[0]).toBe(first);
    expect(mailbox.listError).toBeNull();
    await mailbox.loadMore();
    expect(shown(mailbox)).toEqual(names(5).reverse());
    expect(mailbox.hasMore).toBe(false);
  });

  it('retains a failed date-folder cursor for retry', async () => {
    const tree = { '2026-09-16': names(1), [DAY]: names(1, 1) };
    const { fs, mailbox } = setup(tree, { pageCap: 1, pageSize: 1 });
    await mailbox.open();
    const original = fs.readdir;
    fs.readdir = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(original);
    expect(await mailbox.loadMore()).toEqual([]);
    expect(mailbox.listError?.message).toBe('offline');
    expect(mailbox.hasMore).toBe(true);
    await mailbox.loadMore();
    expect(shown(mailbox)).toEqual(names(2).reverse());
    expect(mailbox.hasMore).toBe(false);
  });

  it('does not skip older mail when the loaded page is deleted', async () => {
    const tree = { [DAY]: names(5) };
    const { mailbox } = setup(tree, { pageSize: 2 });
    await mailbox.open();
    for (const message of [...mailbox.messages]) {
      tree[DAY] = tree[DAY].filter((name) => name !== message.name);
      mailbox.remove(message);
    }
    await mailbox.loadMore();
    expect(shown(mailbox)).toEqual(names(2, 1).reverse());
    await mailbox.loadMore();
    expect(shown(mailbox)).toEqual(names(3).reverse());
  });

  it('does not resurrect a catalog entry removed while its older page was in flight', async () => {
    const tree = { [DAY]: names(3) };
    const { fs, mailbox } = setup(tree, { pageSize: 1 });
    await mailbox.open();
    const all = await mailbox.listAll();
    const moved = all[1];
    // A complete catalog now answers paging locally. Invalidate it to
    // exercise a native page racing a removal of an already known entry.
    mailbox.forget();
    const original = fs.readdir;
    let release;
    fs.readdir = async (path, options) => {
      const page = await original(path, options);
      if (options.recursive && !release) await new Promise((resolve) => { release = resolve; });
      return page;
    };
    const paging = mailbox.loadMore();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    tree[DAY] = tree[DAY].filter((name) => name !== moved.name);
    mailbox.remove(moved);
    release();
    await paging;
    expect(shown(mailbox)).toEqual([names(1, 2)[0], names(1)[0]]);
    expect(mailbox.find(moved.name)).toBeNull();
    mailbox.insert(moved);
    expect(shown(mailbox)).toEqual(names(3).reverse());
  });

  it('ignores subdirectories without losing their following file pages', async () => {
    const { fs, mailbox } = setup({ [DAY]: names(2) }, { pageSize: 1 });
    const original = fs.readdir;
    fs.readdir = async (path, options) => {
      if (options.recursive && !options.cursor) {
        return { items: [{ name: 'nested', is_dir: true }], cursor: 'after-directory' };
      }
      return original(path, options.cursor === 'after-directory' ? { ...options, cursor: null } : options);
    };
    await mailbox.open();
    while (mailbox.hasMore) await mailbox.loadMore();
    expect(shown(mailbox)).toEqual(names(2).reverse());
  });

  it('reports malformed or repeated cursors rather than losing mail or looping', async () => {
    const { fs, mailbox } = setup({ [DAY]: names(5) }, { pageSize: 1 });
    await mailbox.open();
    const original = fs.readdir;
    fs.readdir = async (path, options) => ({ items: [], cursor: options.cursor });
    expect(await mailbox.loadMore()).toEqual([]);
    expect(mailbox.hasMore).toBe(true);
    expect(mailbox.listError?.message).toContain('cursor');
    fs.readdir = async () => ({});
    expect(await mailbox.loadMore()).toEqual([]);
    expect(mailbox.listError?.message).toContain('invalid response');
    fs.readdir = original;
    await mailbox.loadMore();
    expect(shown(mailbox)).toEqual(names(2, 3).reverse());
  });

  it('probes older SDKs without a limit so their array results cannot truncate the mailbox', async () => {
    const full = pagedFs(OBJECTS, { [DAY]: names(100) });
    const fs = { readdir: vi.fn(async (path, options = {}) => {
      const { cursor, ...legacy } = options;
      const items = await full.readdir(path, legacy);
      return options.limit ? items.slice(0, options.limit) : items;
    }) };
    const mailbox = createMailbox({ fs, objectsPath: OBJECTS });
    await mailbox.open();
    while (mailbox.hasMore) await mailbox.loadMore();
    expect(mailbox.messages).toHaveLength(100);
    expect(fs.readdir.mock.calls.every(([, options]) => options?.limit === undefined)).toBe(true);
  });
});

describe('arrival checks over cursor pages', () => {
  it('finds arrivals in a new date folder without changing the older-mail cursor', async () => {
    const tree = { '2026-09-16': names(3), [DAY]: names(3, 3) };
    const { fs, mailbox } = setup(tree, { pageSize: 2 });
    await mailbox.open();
    const previous = [...mailbox.messages];
    tree['2026-09-18'] = names(3, 6);
    fs.calls.length = 0;
    expect((await mailbox.sync()).map(message => message.name)).toEqual(names(3, 6).reverse());
    expect(mailbox.messages.slice(3)).toEqual(previous);
    expect(fs.calls.every(call => call.options.recursive)).toBe(true);
    while (mailbox.hasMore) await mailbox.loadMore();
    expect(shown(mailbox)).toEqual(names(9).reverse());
    expect(await mailbox.sync()).toEqual([]);
  });

  it('stops at the newest known message without listing the rest of a busy day', async () => {
    const { fs, mailbox } = setup({ [DAY]: names(1000, 1), '2026-09-16': names(1) });
    await mailbox.open();
    fs.calls.length = 0;
    expect(await mailbox.sync()).toEqual([]);
    expect(fs.calls.map((call) => call.count)).toEqual([62]);
    expect(fs.calls.every((call) => call.options.recursive)).toBe(true);
  });

  it('retries every arrival if a later page fails, then preserves the older-mail cursor', async () => {
    const tree = { [DAY]: names(1000) };
    const { fs, mailbox } = setup(tree);
    await mailbox.open();
    tree[DAY].push(...names(125, 1000));
    const original = fs.readdir;
    let fail = true;
    fs.readdir = async (path, options) => {
      if (fail && options.recursive && options.cursor) throw new Error('offline');
      return original(path, options);
    };
    expect(await mailbox.sync()).toEqual([]);
    expect(mailbox.find(names(1, 1124)[0])).toBeNull();
    fail = false;
    fs.calls.length = 0;
    expect(await mailbox.sync()).toHaveLength(125);
    expect(fs.calls.map((call) => call.count)).toEqual([61, 60, 60]);
    await mailbox.loadMore();
    expect(shown(mailbox)).toEqual(names(245, 880).reverse());
  });
});

describe('recursive catalogs', () => {
  it('reuses a complete catalog for older pages, including remove/undo and arrivals', async () => {
    const tree = { [DAY]: names(12) };
    const { fs, mailbox } = setup(tree, { pageSize: 2 });
    await mailbox.open();
    const all = await mailbox.listAll();
    const original = [...all];
    fs.calls.length = 0;
    expect(await mailbox.loadMore()).toEqual(original.slice(2, 4));
    mailbox.remove(original[0]);
    mailbox.remove(original[5]);
    mailbox.insert(original[0]);
    // Undo can restore an entry ahead of the catalog cursor or behind it.
    mailbox.insert(original[5]);
    const arrival = { ...original[0], name: '999999--x', path: `${OBJECTS}/${DAY}/999999--x` };
    mailbox.insert(arrival);
    while (mailbox.hasMore) await mailbox.loadMore();
    expect(mailbox.messages).toEqual([arrival, ...original]);
    expect(new Set(shown(mailbox)).size).toBe(13);
    expect(fs.calls).toHaveLength(0);
  });

  it('resumes native paging after catalog invalidation without skipping or duplicating entries', async () => {
    const tree = { [DAY]: names(12) };
    const { fs, mailbox } = setup(tree, { pageSize: 2 });
    await mailbox.open();
    await mailbox.listAll();
    await mailbox.loadMore();
    mailbox.forget();
    fs.calls.length = 0;
    while (mailbox.hasMore) await mailbox.loadMore();
    expect(shown(mailbox)).toEqual(names(12).reverse());
    expect(fs.calls.length).toBeGreaterThan(0);
  });

  it('catalogs a year in one recursive page, shares entries, and sorts newest first', async () => {
    const tree = Object.fromEntries(Array.from({ length: 365 }, (_, i) => {
      const day = new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10);
      return [day, names(1, i)];
    }));
    const { fs, mailbox } = setup(tree, { pageSize: 1 });
    await mailbox.open();
    const latest = mailbox.messages[0];
    fs.calls.length = 0;
    const progress = vi.fn();
    const [all, same] = await Promise.all([mailbox.listAll({ onProgress: progress }), mailbox.listAll()]);
    expect(all).toBe(same);
    expect(all[0]).toBe(latest);
    expect(all.map((message) => message.name)).toEqual(names(365).reverse());
    expect(fs.calls).toHaveLength(1);
    expect(fs.calls[0].options).toEqual({ recursive: true, depth: 2, cursor: null, limit: 1000, sortBy: 'name', sortOrder: 'desc' });
    expect(progress).toHaveBeenLastCalledWith(365);
    await mailbox.loadMore();
    expect(mailbox.messages[1]).toBe(all[1]);
  });

  it('follows recursive cursors even when a page contains only directories', async () => {
    const { fs, mailbox } = setup({ [DAY]: names(4) }, { pageCap: 1 });
    const progress = [];
    const all = await mailbox.listAll({ onProgress: (count) => progress.push(count) });
    expect(all.map((message) => message.name)).toEqual(names(4).reverse());
    expect(progress).toEqual([0, 1, 2, 3, 4]);
    expect(fs.calls.filter((call) => call.options.recursive)).toHaveLength(5);
    expect(mailbox.total).toBe(4);
  });

  it('treats an absent root as empty after pagination support has been detected', async () => {
    const { fs, mailbox } = setup({ [DAY]: names(4) });
    await mailbox.open();
    const original = fs.readdir;
    fs.readdir = async () => { throw { code: 'subject_does_not_exist' }; };
    expect(await mailbox.listAll()).toEqual([]);
    expect(mailbox.total).toBeNull();
    fs.readdir = original;
    expect(await mailbox.listAll()).toHaveLength(4);
  });

  it.each([new Error('offline'), { code: 'subject_does_not_exist' }])('does not cache a partial catalog or hide failures behind the legacy traversal (%j)', async (error) => {
    const { fs, mailbox } = setup({ [DAY]: names(4) }, { pageCap: 2, pageSize: 1 });
    await mailbox.open();
    const original = fs.readdir;
    fs.readdir = async (path, options) => {
      if (options.recursive && options.cursor) throw error;
      return original(path, options);
    };
    await expect(mailbox.listAll()).rejects.toBe(error);
    expect(mailbox.total).toBeNull();
    expect(mailbox.find(names(1)[0])).toBeNull();
    fs.readdir = original;
    expect(await mailbox.listAll()).toHaveLength(4);
    expect(mailbox.total).toBe(4);
  });

  it('restarts a recursive catalog invalidated in flight', async () => {
    const tree = { [DAY]: names(2) };
    const { fs, mailbox } = setup(tree);
    await mailbox.open();
    const original = fs.readdir;
    let release;
    fs.readdir = async (path, options) => {
      const page = await original(path, options);
      if (options.recursive && !release) await new Promise((resolve) => { release = resolve; });
      return page;
    };
    const listing = mailbox.listAll();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    tree[DAY].push(...names(1, 2));
    mailbox.forget();
    release();
    expect((await listing).map((message) => message.name)).toEqual(names(3).reverse());
  });

  it('keeps a moved message out of a recursive response that was already in flight', async () => {
    const tree = { [DAY]: names(3) };
    const { fs, mailbox } = setup(tree);
    await mailbox.open();
    const moved = mailbox.messages[0];
    const original = fs.readdir;
    let release;
    fs.readdir = async (path, options) => {
      const page = await original(path, options);
      if (options.recursive) await new Promise((resolve) => { release = resolve; });
      return page;
    };
    const listing = mailbox.listAll();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    tree[DAY] = tree[DAY].filter((name) => name !== moved.name);
    mailbox.remove(moved);
    release();
    expect((await listing).map((message) => message.name)).toEqual(names(2).reverse());
    expect(mailbox.find(moved.name)).toBeNull();
  });
});
