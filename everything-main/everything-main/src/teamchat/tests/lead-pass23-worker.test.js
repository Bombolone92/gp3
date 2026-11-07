/**
 * Worker routes (lead, review pass 23): what an import's page and file
 * requests read from the store.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { boot, as, USERS } from './helpers/harness.js';
import { countKv } from './helpers/kvcount.js';
import { KEYS } from '../src/shared/blocks.js';

const alice = USERS.alice;
const bob = USERS.bob;
let rt;

const headerFor = (wsId, ch) => ({
  format: 'teamchat-export', version: 1, workspace: { id: wsId, name: 'Acme' },
  channels: { [ch]: { id: ch, name: 'general', def: true } },
  members: { [alice.uuid]: { username: 'alice', name: 'Alice', role: 'owner' }, [bob.uuid]: { username: 'bob', name: 'Bob', role: 'member' } },
  memberDocs: { [alice.uuid]: { channels: [ch] }, [bob.uuid]: { channels: [ch] } },
});

describe('what a page and a file of an import read', () => {
  beforeEach(async () => {
    rt = await boot();
  });

  it('leave the importer\'s own document unread, which neither looks at (the finish reads it, to land them in the defaults)', async () => {
    const wsId = 'wsimportrd1';
    const ch = 'chimportrd1';
    expect((await as(alice).post('/api/workspaces/import', { header: headerFor(wsId, ch), profile: { name: 'Alice' } })).status).toBe(200);
    const own = KEYS.member(wsId, alice.uuid);
    const c = countKv(rt);
    const messages = [1, 2, 3].map((seq) => ({ seq, user: bob.uuid, text: `m${seq}`, ts: 1_700_000_000_000 + seq, kind: 'msg' }));
    expect((await as(alice).post(`/api/ws/${wsId}/import`, { conv: ch, messages, seq: 3 })).ok).toBe(true);
    expect(c.keys.get).not.toContain(own);
    expect(c.duplicateGets()).toEqual([]);
    c.reset();
    const form = new FormData();
    form.set('file', new Blob(['hello'], { type: 'text/plain' }), 'hello.txt');
    form.set('id', 'fileimport01');
    form.set('name', 'hello.txt');
    form.set('type', 'text/plain');
    const up = await as(alice).post(`/api/ws/${wsId}/import/file`, form);
    expect(up.status).toBeLessThan(500);
    expect(c.keys.get).not.toContain(own);
    c.reset();
    // The finish lands the importer in the defaults from their document: read there, as before.
    expect((await as(alice).post(`/api/ws/${wsId}/import/finish`)).ok).toBe(true);
    expect(c.keys.get).toContain(own);
    c.restore();
    // The messages landed, and the copy opens.
    const got = await as(alice).get(`/api/ws/${wsId}/conv/${ch}/messages`);
    expect(got.ok).toBe(true);
    expect(got.data.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
  });
});

describe('what revoking an integration and the steps of a move read', () => {
  beforeEach(async () => {
    rt = await boot();
  });

  it('leave the caller\'s own document unread, which none of them looks at', async () => {
    const { workspaceWith } = await import('./helpers/harness.js');
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const own = KEYS.member(wsId, alice.uuid);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const bot = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Bot', channels: [general.id] })).data;
    const c = countKv(rt);
    expect((await as(alice).del(`/api/ws/${wsId}/webhooks/${hook.id}`)).ok).toBe(true);
    expect(c.keys.get).not.toContain(own);
    c.reset();
    expect((await as(alice).del(`/api/ws/${wsId}/bots/${bot.id}`)).ok).toBe(true);
    expect(c.keys.get).not.toContain(own);
    c.reset();
    // A move's steps, each answered on the workspace alone (nothing is moving here, so each says so), with no read of the owner's document.
    for (const step of ['transfer/begin', 'transfer/cancel', 'transfer/complete']) {
      const res = await as(alice).post(`/api/ws/${wsId}/${step}`, {});
      expect(res.status, step).toBeLessThan(500);
      expect(c.keys.get, step).not.toContain(own);
      c.reset();
    }
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { cancel: true })).status).toBeLessThan(500);
    expect(c.keys.get).not.toContain(own);
    c.restore();
    // The integrations are gone, as before.
    const listed = (await as(alice).get(`/api/ws/${wsId}/webhooks`)).data;
    expect(listed.webhooks).toEqual([]);
    expect(listed.bots).toEqual([]);
  });
});

describe('a block closed early notes the numbers it skipped', () => {
  beforeEach(async () => {
    rt = await boot({ strictSize: true });
  });

  it('on the conversation\'s activity entry, for the readers\' unread counts, and the note follows the next message', async () => {
    const { workspaceWith } = await import('./helpers/harness.js');
    const { lastSeqOfBlock, blockIndexOf } = await import('../src/shared/blocks.js');
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const files = Array.from({ length: 5 }, (_, i) => `f${String(i).padStart(23, '0')}`);
    for (const id of files) await rt.kv.set(KEYS.file(id), { ws: wsId, u: alice.uuid, name: 'n'.repeat(120), size: 10 * 1024 * 1024, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', refs: 0 });
    const text = `log: ${'"quoted" error '.repeat(230)}`.slice(0, 3900);
    let rolledAt = null;
    let seq = 0;
    for (let i = 0; i < 50 && rolledAt === null; i++) {
      const res = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text, attachments: files.map((id) => ({ id })) });
      expect(res.status).toBe(200);
      seq = res.data.message.seq;
      if ((await rt.kv.get(KEYS.block(general.id, 0)))?.full) rolledAt = seq;
    }
    expect(rolledAt).not.toBeNull();
    expect(blockIndexOf(rolledAt)).toBe(0);
    // The run left unused: from the number after the last message to the block's end.
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.c[general.id].k).toEqual([rolledAt + 1, lastSeqOfBlock(0)]);
    expect(act.c[general.id].s).toBe(rolledAt);
    // The next message opens the next block; the note stands beside the moved counter.
    const next = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'after the roll' });
    expect(next.data.message.seq).toBe(lastSeqOfBlock(0) + 1);
    const after = await rt.kv.get(KEYS.activity(wsId));
    expect(after.c[general.id].s).toBe(lastSeqOfBlock(0) + 1);
    expect(after.c[general.id].k).toEqual([rolledAt + 1, lastSeqOfBlock(0)]);
  });
});
