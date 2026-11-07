import { describe, it, expect, beforeEach, vi } from 'vitest';

/* The same stand-in for Puter that store.test.js uses. */
const kv = new Map();
const files = new Map();
globalThis.puter = {
  auth: { getUser: async () => ({ username: 'test' }) },
  kv: {
    get: async (k) => (kv.has(k) ? kv.get(k) : null),
    set: async (k, v) => { kv.set(k, v); return true; },
  },
  fs: {
    read: async (path) => {
      if (!files.has(path)) {
        const err = new Error('not found');
        err.code = 'subject_does_not_exist';
        throw err;
      }
      return { text: async () => files.get(path) };
    },
    write: async (path, data) => { files.set(path, data); return { path }; },
    delete: async (path, opts) => {
      files.delete(path);
      if (opts?.recursive) {
        for (const key of [...files.keys()]) if (key.startsWith(`${path}/`)) files.delete(key);
      }
    },
  },
  hosting: { create: async () => ({}) },
};

const invoice = {
  id: 'D1', kind: 'invoice', number: 'INV-0001', clientId: '', currency: 'USD',
  issueDate: '2026-01-10', dueDate: '2026-01-24',
  items: [{ id: 'l1', name: 'Design', qty: 1, rate: 100 }],
  taxRate: 0, discountType: 'none', discountValue: 0,
  status: 'sent', payments: [], createdAt: 1,
};

const freshStore = async () => (await import('../src/lib/store.js')).store;
const shareLib = async () => import('../src/lib/share.js');

beforeEach(() => {
  vi.resetModules();
  kv.clear();
  files.clear();
});

describe('publishDoc', () => {
  it('publishes, records the token, and unpublish takes the page down', async () => {
    kv.set('invc:settings:v1', JSON.stringify({ share: { subdomain: 'inv-test' } }));
    files.set('invoicing-data/docs-2026.json', JSON.stringify([invoice]));
    kv.set('invc:years:v1', JSON.stringify(['2026']));
    const store = await freshStore();
    await store.init();
    const { publishDoc, unpublishDoc } = await shareLib();

    const url = await publishDoc(store, store.doc('D1'), null);
    const token = store.doc('D1').shareToken;
    expect(url).toBe(`https://inv-test.puter.site/${token}.html`);
    expect(files.has(`invoicing-data/public/${token}.html`)).toBe(true);

    await unpublishDoc(store, store.doc('D1'));
    expect(store.doc('D1').shareToken).toBeUndefined();
    expect(files.has(`invoicing-data/public/${token}.html`)).toBe(false);
  });

  it('takes a freshly written page back down when recording its token fails', async () => {
    kv.set('invc:settings:v1', JSON.stringify({ share: { subdomain: 'inv-test' } }));
    files.set('invoicing-data/docs-2026.json', JSON.stringify([invoice]));
    kv.set('invc:years:v1', JSON.stringify(['2026']));
    const store = await freshStore();
    await store.init();
    const { publishDoc } = await shareLib();

    // The page write lands; recording the token on the document fails.
    const write = puter.fs.write;
    puter.fs.write = async (path, data) => {
      if (path.includes('docs-2026')) throw new Error('connection dropped');
      return write(path, data);
    };
    try {
      await expect(publishDoc(store, store.doc('D1'), null)).rejects.toThrow();
    } finally {
      puter.fs.write = write;
    }
    // No live page may be left behind that the app can never take down:
    // without a recorded token, "Stop sharing" would never appear.
    expect(store.doc('D1').shareToken).toBeUndefined();
    const orphans = [...files.keys()].filter((p) => p.startsWith('invoicing-data/public/'));
    expect(orphans).toEqual([]);
  });

  it('takes the attachment copies back down too when a first publish fails after copying them', async () => {
    // The copies go up before the page. A page write that fails left them
    // readable at their URLs, under a token no document recorded — so
    // nothing could ever retire them.
    kv.set('invc:settings:v1', JSON.stringify({ share: { subdomain: 'inv-test' } }));
    files.set('invoicing-data/docs-2026.json', JSON.stringify([{
      ...invoice,
      shareAttachments: true,
      attachments: [{ id: 'a1', name: 'timesheet.pdf', size: 3, path: 'invoicing-data/attachments/D1/a1-timesheet.pdf' }],
    }]));
    files.set('invoicing-data/attachments/D1/a1-timesheet.pdf', 'pdf');
    kv.set('invc:years:v1', JSON.stringify(['2026']));
    const store = await freshStore();
    await store.init();
    const { publishDoc } = await shareLib();

    const write = puter.fs.write;
    puter.fs.write = async (path, data, opts) => {
      if (path.endsWith('.html')) throw new Error('connection dropped');
      return write(path, data, opts);
    };
    try {
      await expect(publishDoc(store, store.doc('D1'), null)).rejects.toThrow();
    } finally {
      puter.fs.write = write;
    }
    expect(store.doc('D1').shareToken).toBeUndefined();
    expect([...files.keys()].filter((p) => p.startsWith('invoicing-data/public/'))).toEqual([]);
  });

  it('leaves an already-shared page up when its refresh fails', async () => {
    kv.set('invc:settings:v1', JSON.stringify({ share: { subdomain: 'inv-test' } }));
    files.set('invoicing-data/docs-2026.json', JSON.stringify([{ ...invoice, shareToken: 'tok000000001' }]));
    files.set('invoicing-data/public/tok000000001.html', 'old page');
    kv.set('invc:years:v1', JSON.stringify(['2026']));
    const store = await freshStore();
    await store.init();
    const { republishIfShared } = await shareLib();
    const write = puter.fs.write;
    puter.fs.write = async () => { throw new Error('connection dropped'); };
    try {
      await expect(republishIfShared(store, 'D1')).rejects.toThrow();
    } finally {
      puter.fs.write = write;
    }
    expect(store.doc('D1').shareToken).toBe('tok000000001');
    expect(files.get('invoicing-data/public/tok000000001.html')).toBe('old page');
  });
});

describe('a document deleted while share work is in flight', () => {
  const seed = async (over = {}) => {
    kv.set('invc:settings:v1', JSON.stringify({ share: { subdomain: 'inv-test' } }));
    files.set('invoicing-data/docs-2026.json', JSON.stringify([{ ...invoice, ...over }]));
    kv.set('invc:years:v1', JSON.stringify(['2026']));
    const store = await freshStore();
    await store.init();
    return store;
  };
  const onDisk = () => JSON.parse(files.get('invoicing-data/docs-2026.json')).find((d) => d.id === 'D1');
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('stays in the trash after a first publish, and the page comes down', async () => {
    const store = await seed();
    const { publishDoc } = await shareLib();
    // The page write is slow; Delete lands while it is in the air. doc() is
    // live-only, so recording the token used to fall back to the pre-delete
    // copy and save it — lifting the document out of the trash, with a
    // public page nothing had recorded.
    const write = puter.fs.write;
    let release = null;
    puter.fs.write = async (path, data) => {
      if (path.startsWith('invoicing-data/public/') && path.endsWith('.html')) {
        await new Promise((r) => { release = r; });
      }
      return write(path, data);
    };
    try {
      const publishing = publishDoc(store, store.doc('D1'), null);
      while (!release) await tick();
      await store.deleteDoc('D1');
      expect(store.doc('D1')).toBeNull();
      release();
      await expect(publishing).rejects.toThrow('no longer here');
    } finally {
      puter.fs.write = write;
    }
    expect(store.doc('D1')).toBeNull();
    expect(onDisk().deletedAt).toBeTruthy();
    expect(onDisk().shareToken).toBeUndefined();
    expect([...files.keys()].filter((p) => p.startsWith('invoicing-data/public/'))).toEqual([]);
  });

  it('stays in the trash after a takedown', async () => {
    const store = await seed({ shareToken: 'tok000000001' });
    files.set('invoicing-data/public/tok000000001.html', 'page');
    const { unpublishDoc } = await shareLib();
    const remove = puter.fs.delete;
    let release = null;
    puter.fs.delete = async (path, options) => {
      if (path === 'invoicing-data/public/tok000000001.html') await new Promise((r) => { release = r; });
      return remove(path, options);
    };
    try {
      const taking = unpublishDoc(store, store.doc('D1'));
      while (!release) await tick();
      await store.deleteDoc('D1');
      release();
      await taking;
    } finally {
      puter.fs.delete = remove;
    }
    expect(store.doc('D1')).toBeNull();
    expect(onDisk().deletedAt).toBeTruthy();
    expect(files.has('invoicing-data/public/tok000000001.html')).toBe(false);
  });
});

describe('share work on one document, one piece at a time', () => {
  const seed = async () => {
    kv.set('invc:settings:v1', JSON.stringify({ share: { subdomain: 'inv-test' } }));
    files.set('invoicing-data/docs-2026.json', JSON.stringify([{
      ...invoice,
      shareToken: 'tok000000001',
      shareAttachments: true,
      attachments: [{ id: 'a1', name: 'timesheet.pdf', size: 3, path: 'invoicing-data/attachments/D1/a1-timesheet.pdf' }],
    }]));
    files.set('invoicing-data/attachments/D1/a1-timesheet.pdf', 'pdf');
    kv.set('invc:years:v1', JSON.stringify(['2026']));
    const store = await freshStore();
    await store.init();
    return store;
  };
  const publicFiles = () => [...files.keys()].filter((p) => p.startsWith('invoicing-data/public/'));
  it.each(['unpublish', 'refresh'])('reports an attachment deletion failure during %s and keeps the token for retry', async (action) => {
    const store = await seed();
    const { republishIfShared, unpublishDoc } = await shareLib();
    await republishIfShared(store, 'D1');
    await store.setShareAttachments('D1', false);
    const remove = puter.fs.delete;
    puter.fs.delete = async (path, options) => {
      if (path === 'invoicing-data/public/tok000000001') throw new Error('deletion denied');
      return remove(path, options);
    };
    const run = () => action === 'unpublish'
      ? unpublishDoc(store, store.doc('D1')) : republishIfShared(store, 'D1');
    try {
      await expect(run()).rejects.toThrow('deletion denied');
      expect(store.doc('D1').shareToken).toBe('tok000000001');
      expect(publicFiles()).toContain('invoicing-data/public/tok000000001/a1-timesheet.pdf');
    } finally {
      puter.fs.delete = remove;
    }
    await run();
    expect(publicFiles()).not.toContain('invoicing-data/public/tok000000001/a1-timesheet.pdf');
    if (action === 'unpublish') expect(store.doc('D1').shareToken).toBeUndefined();
  });

  it('can unpublish a document whose attachment folder is already absent', async () => {
    const store = await seed();
    const { unpublishDoc } = await shareLib();
    const remove = puter.fs.delete;
    puter.fs.delete = async (path, options) => {
      if (path === 'invoicing-data/public/tok000000001') {
        throw Object.assign(new Error('not found'), { code: 'subject_does_not_exist' });
      }
      return remove(path, options);
    };
    try {
      await unpublishDoc(store, store.doc('D1'));
      expect(store.doc('D1').shareToken).toBeUndefined();
    } finally {
      puter.fs.delete = remove;
    }
  });
  // The page write is what the tests hold back; the publish reaches it only
  // after copying the attachments and loading the page template.
  const untilHeld = async (held) => {
    for (let i = 0; i < 200 && !held.length; i++) await new Promise((r) => setTimeout(r, 5));
    expect(held.length).toBe(1);
  };

  it('lets a takedown pressed during a refresh finish the job, instead of being undone by it', async () => {
    // Record payment fires a refresh and does not wait for it; the refresh
    // re-copies every attachment, which takes a while. Stop sharing landed
    // in the middle: the token went, the toast said "No longer shared", and
    // then the refresh's remaining writes put the page and its files back —
    // under a token the document no longer carried.
    const store = await seed();
    const { republishIfShared, unpublishDoc } = await shareLib();
    const held = [];
    const write = puter.fs.write;
    puter.fs.write = (path, data, opts) => (path.endsWith('.html')
      ? new Promise((resolve) => { held.push(() => resolve(write(path, data, opts))); })
      : write(path, data, opts));
    try {
      const refresh = republishIfShared(store, 'D1');
      await untilHeld(held);
      const takedown = unpublishDoc(store, store.doc('D1'));
      await new Promise((r) => setTimeout(r, 0));
      held.splice(0).forEach((go) => go());
      await refresh;
      await takedown;
    } finally {
      puter.fs.write = write;
    }
    expect(store.doc('D1').shareToken).toBeUndefined();
    expect(publicFiles()).toEqual([]);
  });

  it('does nothing for a refresh queued behind the takedown', async () => {
    const store = await seed();
    const { republishIfShared, unpublishDoc } = await shareLib();
    const [, refreshed] = await Promise.all([
      unpublishDoc(store, store.doc('D1')),
      republishIfShared(store, 'D1'),
    ]);
    expect(refreshed).toBeUndefined();
    expect(store.doc('D1').shareToken).toBeUndefined();
    expect(publicFiles()).toEqual([]);
  });

  it('records the token on the document as it stands, not as the caller saw it', async () => {
    // A file attached while a publish was still copying used to vanish: the
    // publish saved the caller's copy of the document back, token added,
    // attachments as they were when it started.
    kv.set('invc:settings:v1', JSON.stringify({ share: { subdomain: 'inv-test' } }));
    files.set('invoicing-data/docs-2026.json', JSON.stringify([invoice]));
    kv.set('invc:years:v1', JSON.stringify(['2026']));
    const store = await freshStore();
    await store.init();
    const { publishDoc } = await shareLib();
    const held = [];
    const write = puter.fs.write;
    puter.fs.write = (path, data, opts) => (path.endsWith('.html')
      ? new Promise((resolve) => { held.push(() => resolve(write(path, data, opts))); })
      : write(path, data, opts));
    try {
      const stale = { ...store.doc('D1') };
      const publishing = publishDoc(store, stale, null);
      await untilHeld(held);
      await store.saveDoc({ ...store.doc('D1'), reference: 'PO-77' });
      held.splice(0).forEach((go) => go());
      await publishing;
    } finally {
      puter.fs.write = write;
    }
    expect(store.doc('D1').shareToken).toBeTruthy();
    expect(store.doc('D1').reference).toBe('PO-77');
  });
});
