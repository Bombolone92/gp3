/**
 * The outbox, with in-memory storage: order, retries on network failure,
 * setting aside what the worker refuses for good, and attachment uploads.
 */
import { describe, it, expect } from 'vitest';
import { createOutbox, memoryStorage, layeredStorage, makeClientId } from '../src/lib/outbox.js';

const netError = () => Object.assign(new Error('Could not reach the workspace server'), { status: 0, code: 'network' });
const refused = () => Object.assign(new Error('Only admins can post'), { status: 403, code: 'read_only' });

describe('outbox', () => {
  it('forgets what was bound for a workspace that was left, and nothing else', async () => {
    const box = createOutbox({ storage: memoryStorage(), sendEntry: async () => {}, uploadFile: async () => ({ id: 'file0000' }) });
    await box.enqueue({ ws: 'a', conv: 'c', text: 'to a', ts: 1 });
    await box.enqueue({ ws: 'b', conv: 'c', text: 'to b', ts: 2 });
    await box.enqueue({ ws: 'a', conv: 'd', text: 'to a again', ts: 3, failed: true });
    expect(await box.forget('a')).toBe(2);
    expect((await box.list()).map((e) => e.text)).toEqual(['to b']);
    expect(await box.forget('nothing')).toBe(0);
  });

  it('sends oldest first, stops at a network failure, and keeps what is left', async () => {
    const sent = [];
    let online = false;
    let failNet = false;
    const box = createOutbox({
      storage: memoryStorage(), isOnline: () => online,
      sendEntry: async (e) => { if (failNet) throw netError(); sent.push(e.text); },
      uploadFile: async () => ({ id: 'file0000' }),
    });
    await box.enqueue({ ws: 'w', conv: 'c', text: 'first', ts: 1 });
    await box.enqueue({ ws: 'w', conv: 'c', text: 'second', ts: 2 });
    expect((await box.flush()).sent).toBe(0); // offline: nothing tried
    online = true;
    failNet = true;
    const r1 = await box.flush();
    expect(r1).toEqual({ sent: 0, left: 2 });
    expect((await box.list())[0].attempts).toBe(1);
    failNet = false;
    const r2 = await box.flush();
    expect(r2).toEqual({ sent: 2, left: 0 });
    expect(sent).toEqual(['first', 'second']);
  });

  it('keeps trying while the worker does not answer (a bare 404), as for any network failure', async () => {
    const sent = [];
    let down = true;
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async (e) => { if (down) throw Object.assign(new Error('No Teamchat server answers at this address'), { status: 404, code: 'no_backend' }); sent.push(e.text); },
      uploadFile: async () => ({ id: 'file0000' }),
    });
    await box.enqueue({ ws: 'w', conv: 'c', text: 'hello', ts: 1 });
    expect(await box.flush()).toEqual({ sent: 0, left: 1 });
    expect((await box.list())[0].attempts).toBe(1);
    expect((await box.list())[0].failed).toBeFalsy();
    down = false;
    expect(await box.flush()).toEqual({ sent: 1, left: 0 });
    expect(sent).toEqual(['hello']);
  });

  it('sets aside an entry the worker refuses for good, and carries on', async () => {
    const sent = [];
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async (e) => { if (e.text === 'bad') throw refused(); sent.push(e.text); },
      uploadFile: async () => ({ id: 'file0000' }),
    });
    await box.enqueue({ ws: 'w', conv: 'c', text: 'bad', ts: 1 });
    await box.enqueue({ ws: 'w', conv: 'c', text: 'good', ts: 2 });
    const r = await box.flush();
    expect(r.sent).toBe(1);
    expect(sent).toEqual(['good']);
    const left = await box.list();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ text: 'bad', failed: true, lastError: 'Only admins can post' });
    await box.remove(left[0].id);
    expect(await box.list()).toEqual([]);
  });

  it('leaves a set-aside entry alone until it is retried, then tries it once more', async () => {
    const sent = [];
    let refuse = true;
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async (e) => { if (refuse) throw refused(); sent.push(e.text); },
      uploadFile: async () => ({ id: 'file0000' }),
    });
    const e = await box.enqueue({ ws: 'w', conv: 'c', text: 'later', ts: 1 });
    await box.flush();
    expect((await box.list())[0].failed).toBe(true);
    // Flushing again (the connection flickers, a workspace opens) does not resend it.
    refuse = false;
    expect(await box.flush()).toEqual({ sent: 0, left: 1 });
    expect(sent).toEqual([]);
    // Retry puts it back in line under the same id.
    expect((await box.retry(e.id))).toMatchObject({ id: e.id, failed: false, attempts: 0 });
    expect(await box.flush()).toEqual({ sent: 1, left: 0 });
    expect(sent).toEqual(['later']);
    expect(await box.retry('nope')).toBeNull();
  });

  it('uploads attachment bytes once, even when the send after them fails', async () => {
    const calls = [];
    let failNet = true;
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async (e) => { calls.push({ send: e.attachments }); if (failNet) throw netError(); },
      uploadFile: async (ws, f) => { calls.push({ upload: f.name }); return { id: `id_${f.name}` }; },
    });
    await box.enqueue({ ws: 'w', conv: 'c', text: 'photo', files: [{ name: 'a.png', type: 'image/png', blob: new Blob(['x']) }] });
    await box.flush();
    expect((await box.list())[0]).toMatchObject({ files: [], attachments: [{ id: 'id_a.png' }], attempts: 1 });
    failNet = false;
    await box.flush();
    expect(calls).toEqual([{ upload: 'a.png' }, { send: [{ id: 'id_a.png' }] }, { send: [{ id: 'id_a.png' }] }]);
  });

  it('does not upload a file again when a later one of the same message fails', async () => {
    const uploads = [];
    let failB = true;
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async () => {},
      uploadFile: async (ws, f) => {
        uploads.push(f.name);
        if (f.name === 'b' && failB) throw netError();
        return { id: `up_${f.name}` };
      },
    });
    await box.enqueue({ ws: 'w', conv: 'c', text: 'three', files: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] });
    await box.flush();
    // The first upload is kept as an attachment; the two not yet uploaded wait.
    expect((await box.list())[0]).toMatchObject({ attachments: [{ id: 'up_a' }], files: [{ name: 'b' }, { name: 'c' }], attempts: 1 });
    failB = false;
    await box.flush();
    expect(uploads).toEqual(['a', 'b', 'b', 'c']);
    expect(await box.list()).toEqual([]);
  });

  it('uploads attachment blobs before sending, keeping the same client id', async () => {
    const calls = [];
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async (e) => { calls.push({ id: e.id, attachments: e.attachments }); },
      uploadFile: async (ws, f) => { calls.push({ upload: f.name }); return { id: `id_${f.name}` }; },
    });
    const e = await box.enqueue({ id: makeClientId(), ws: 'w', conv: 'c', text: 'with files', files: [{ name: 'a.png', type: 'image/png', blob: new Blob(['x']) }] });
    expect(e.id).toMatch(/^c_[a-z0-9]+$/);
    await box.flush();
    expect(calls).toEqual([{ upload: 'a.png' }, { id: e.id, attachments: [{ id: 'id_a.png' }] }]);
  });
});

describe('outbox, on a device shared by accounts', () => {
  it('forgets a workspace for the signed-in account only', async () => {
    const storage = memoryStorage();
    let who = 'alice';
    const box = createOutbox({ storage, sendEntry: async () => {}, uploadFile: async () => ({ id: 'file0000' }), owner: () => who });
    await box.enqueue({ ws: 'w', conv: 'c', text: 'alice, offline', ts: 1 });
    who = 'bob';
    await box.enqueue({ ws: 'w', conv: 'c', text: 'bob, offline', ts: 2 });
    // Bob leaves the workspace on this device: his entry goes, alice's waits for her.
    expect(await box.forget('w')).toBe(1);
    expect((await storage.all()).map((e) => e.text)).toEqual(['alice, offline']);
    who = 'alice';
    expect((await box.list()).map((e) => e.text)).toEqual(['alice, offline']);
  });

  it('stamps entries with their author and lists, sends, and shows only the signed-in account\'s', async () => {
    const sent = [];
    let who = 'alice';
    const storage = memoryStorage();
    const box = createOutbox({ storage, owner: () => who, sendEntry: async (e) => { sent.push(`${e.uuid}:${e.text}`); }, uploadFile: async () => ({ id: 'f' }) });
    await box.enqueue({ ws: 'w', conv: 'c', text: 'from alice', ts: 1 });
    await storage.put({ id: 'old', ws: 'w', conv: 'c', text: 'from before the stamp', ts: 0, attempts: 0 });
    who = 'bob';
    await box.enqueue({ ws: 'w', conv: 'c', text: 'from bob', ts: 2 });
    // Bob sees his own and the unstamped one, never alice's; a flush as bob sends the same.
    expect((await box.list()).map((e) => e.text)).toEqual(['from before the stamp', 'from bob']);
    expect(await box.flush()).toEqual({ sent: 2, left: 0 });
    expect(sent).toEqual(['undefined:from before the stamp', 'bob:from bob']);
    expect((await storage.all()).map((e) => e.text)).toEqual(['from alice']);
    // Nobody signed in yet: nothing of anyone's is listed.
    who = null;
    expect(await box.list()).toEqual([]);
    who = 'alice';
    expect(await box.flush()).toEqual({ sent: 1, left: 0 });
    expect(sent.at(-1)).toBe('alice:from alice');
  });
});

describe('outbox, in two tabs of one device', () => {
  /** A Web Lock as the browser gives it: one holder at a time, in order of asking. */
  function fakeLocks() {
    let tail = Promise.resolve();
    return {
      request(name, fn) {
        const turn = tail.then(() => fn());
        tail = turn.catch(() => {});
        return turn;
      },
    };
  }

  it('sends an entry once when both tabs flush the same queue at the same instant', async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: { locks: fakeLocks() }, configurable: true });
    try {
      const storage = memoryStorage();
      const sent = [];
      const tab = () => createOutbox({
        storage,
        sendEntry: async (e) => { await new Promise((r) => setTimeout(r, 5)); sent.push(e.id); },
        uploadFile: async () => ({ id: 'file0000' }),
      });
      const [a, b] = [tab(), tab()];
      await a.enqueue({ ws: 'w', conv: 'c', text: 'once', ts: 1 });
      const results = await Promise.all([a.flush(), b.flush()]);
      expect(sent).toHaveLength(1);
      expect(results.map((r) => r.sent).sort()).toEqual([0, 1]);
      expect(await a.list()).toEqual([]);
    } finally {
      if (saved) Object.defineProperty(globalThis, 'navigator', saved);
      else delete globalThis.navigator;
    }
  });
});

describe('layered storage', () => {
  it('keeps in memory what the durable store would not take, and sends it', async () => {
    let broken = true;
    const kept = new Map();
    const durable = {
      all: async () => [...kept.values()],
      put: async (v) => (broken ? null : (kept.set(v.id, v), v.id)),
      del: async (id) => { kept.delete(id); },
    };
    const sent = [];
    const box = createOutbox({ storage: layeredStorage(durable), sendEntry: async (e) => { sent.push(e.text); }, uploadFile: async () => ({ id: 'f' }), isOnline: () => false });
    await box.enqueue({ ws: 'w', conv: 'c', text: 'offline, no IndexedDB', ts: 1 });
    expect((await box.list()).map((e) => e.text)).toEqual(['offline, no IndexedDB']);
    expect(kept.size).toBe(0);
    broken = false;
    await box.enqueue({ ws: 'w', conv: 'c', text: 'durable again', ts: 2 });
    expect(kept.size).toBe(1);
    expect((await box.list()).map((e) => e.text)).toEqual(['offline, no IndexedDB', 'durable again']);
    // A rewrite that lands durably leaves no memory copy behind to be sent twice.
    await box.retry((await box.list())[0].id);
    expect(kept.size).toBe(2);
    expect((await box.list())).toHaveLength(2);
  });
});

describe('outbox, while a flush is running', () => {
  it('goes round again for what was added or retried meanwhile', async () => {
    const sent = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async (e) => { if (e.text === 'slow') await gate; sent.push(e.text); },
      uploadFile: async () => ({ id: 'file0000' }),
    });
    await box.enqueue({ ws: 'w', conv: 'c', text: 'slow', ts: 1 });
    const first = box.flush();
    // The first flush took its list already; these arrive while it waits on the network.
    await box.enqueue({ ws: 'w', conv: 'c', text: 'added meanwhile', ts: 2 });
    expect(await box.flush()).toMatchObject({ sent: 0 });
    release();
    expect((await first).sent).toBe(2);
    expect(sent).toEqual(['slow', 'added meanwhile']);
    expect(await box.list()).toEqual([]);
  });

  it('does not go round again when the network failed', async () => {
    let calls = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async () => { calls++; await gate; throw Object.assign(new Error('down'), { status: 0 }); },
      uploadFile: async () => ({ id: 'file0000' }),
    });
    await box.enqueue({ ws: 'w', conv: 'c', text: 'a', ts: 1 });
    const first = box.flush();
    await box.enqueue({ ws: 'w', conv: 'c', text: 'b', ts: 2 });
    await box.flush();
    release();
    expect(await first).toEqual({ sent: 0, left: 2 });
    expect(calls).toBe(1);
  });

  it('does not send an entry discarded while an earlier one was going out', async () => {
    const sent = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async (e) => { sent.push(e.text); },
      uploadFile: async () => { await gate; return { id: 'file0000' }; },
    });
    await box.enqueue({ ws: 'w', conv: 'c', text: 'with a file', ts: 1, files: [{ name: 'a.png' }] });
    const second = await box.enqueue({ ws: 'w', conv: 'c', text: 'changed my mind', ts: 2 });
    const flushing = box.flush();
    await new Promise((r) => setTimeout(r, 0));
    await box.remove(second.id); // discarded while the first upload is still running
    release();
    await flushing;
    expect(sent).toEqual(['with a file']);
    expect(await box.list()).toEqual([]);
  });

  it('keeps attachments already uploaded when it uploads the ones that were not', async () => {
    const sent = [];
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async (e) => { sent.push(e.attachments.map((a) => a.id)); },
      uploadFile: async (ws, f) => ({ id: `up_${f.name}` }),
    });
    await box.enqueue({ ws: 'w', conv: 'c', text: 'both', ts: 1, attachments: [{ id: 'already00' }], files: [{ name: 'b' }] });
    await box.flush();
    expect(sent).toEqual([['already00', 'up_b']]);
  });
});

describe('an attempt is counted before it is made, so nothing offers itself as a first send twice', () => {
  it('counts the attempt before the send, and hands the sender an entry that says so', async () => {
    const seen = [];
    const store = memoryStorage();
    const box = createOutbox({ storage: store, sendEntry: async (e) => { seen.push(e.attempts); }, uploadFile: async () => ({ id: 'f' }) });
    await box.enqueue({ id: 'm1', ws: 'w', conv: 'c', text: 'hi', ts: 1 });
    await box.flush();
    // Not 0: by the time the worker hears of it, the attempt is on record.
    expect(seen).toEqual([1]);
  });

  it('an entry whose send is never heard back from still counts it, so the next pass is not a first send', async () => {
    const store = memoryStorage();
    let die = true;
    const box = createOutbox({
      storage: store,
      // The device disappears mid-request: the promise never settles as a
      // failure the outbox can write back, the way a closed tab does not.
      sendEntry: async () => { if (die) throw Object.assign(new Error('gone'), { status: 0 }); },
      uploadFile: async () => ({ id: 'f' }),
    });
    await box.enqueue({ id: 'm2', ws: 'w', conv: 'c', text: 'hi', ts: 1 });
    await box.flush();
    const [held] = await store.all();
    expect(held.attempts).toBe(1);
    die = false;
    await box.flush();
    // The second pass counts a second attempt: nothing here ever reads as first again.
    const left = await store.all();
    expect(left).toEqual([]);
  });
});
