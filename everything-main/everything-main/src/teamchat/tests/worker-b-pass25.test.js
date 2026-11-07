/**
 * Review pass 25, the message plane: channels, messages, threads, reactions,
 * pins, saved messages, direct messages, huddles, shared channels, transfer.
 * Each test here is a hole that was found in the worker's routes and closed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, BLOCK_BYTES, BLOCK_SIZE, blockIndexOf, lastSeqOfBlock, jsonBytes } from '../src/shared/blocks.js';

const { alice, bob } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

/** A conversation's first block a few bytes short of its budget: ten messages, counter at 10. */
async function nearlyFull(wsId, conv) {
  const block = { m: [], x: {} };
  for (let s = 1; s <= 10; s++) block.m.push({ s, u: alice.uuid, t: 'x'.repeat(4000), ts: Date.now() - 1000 + s });
  block.m[9].t += 'x'.repeat(BLOCK_BYTES - 40 - jsonBytes(block));
  await rt.kv.set(KEYS.block(conv, 0), block);
  await rt.kv.set(KEYS.seq(conv), 10);
  await rt.kv.update(KEYS.activity(wsId), { [`c.${conv}.s`]: 10 });
}

/** Post into a conversation until its counter stands at `n`. */
async function fillTo(wsId, conv, n) {
  let i = 0;
  while ((Number(await rt.kv.get(KEYS.seq(conv))) || 0) < n) expect((await as(alice).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text: `m${i++}` })).ok).toBe(true);
}

/** The whole export of a workspace, page by page, as the app gathers it. */
async function exportAll(wsId) {
  const first = await as(alice).get(`/api/ws/${wsId}/export`);
  expect(first.ok).toBe(true);
  let pages = first.data.pages;
  let cursor = first.data.cursor;
  while (cursor) {
    const more = await as(alice).get(`/api/ws/${wsId}/export?cursor=${encodeURIComponent(JSON.stringify(cursor))}`);
    expect(more.ok).toBe(true);
    pages = pages.concat(more.data.pages);
    cursor = more.data.cursor;
  }
  return { header: first.data.header, pages };
}

/**
 * Replay an export into a new workspace the way archive.js does: each page
 * in parts of `chunk` messages, the page's block range with each part and
 * the last part marked. `shape` may cut the page down to an older archive's.
 */
async function restore(archive, id, { chunk = 400, shape = (p) => p } = {}) {
  const created = await as(alice).post('/api/workspaces/import', { header: { ...archive.header, workspace: { ...archive.header.workspace, id } } });
  expect(created.ok).toBe(true);
  const copy = created.data.workspace.id;
  for (const raw of archive.pages) {
    const page = shape(raw);
    for (let k = 0; k === 0 || k < page.messages.length; k += chunk) {
      const r = await as(alice).post(`/api/ws/${copy}/import`, { conv: page.conv, seq: page.seq, from: page.from, to: page.to, last: k + chunk >= page.messages.length, messages: page.messages.slice(k, k + chunk) });
      expect(r.ok).toBe(true);
    }
  }
  expect((await as(alice).post(`/api/ws/${copy}/import/finish`, {})).ok).toBe(true);
  const general = Object.values((await rt.kv.get(KEYS.ws(copy))).channels).find((c) => c.name === 'general');
  return { copy, general };
}

describe('a workspace restored from an export whose newest messages left numbers standing for nothing', () => {
  it('closes the block the original had closed early, so a mention read to the last message clears and the numbers count as no unread', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await nearlyFull(wsId, general.id);
    // The eleventh message takes the block past its budget: closed behind it, the counter at 50.
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'closes @bob' })).data.message.seq).toBe(11);
    expect(Number(await rt.kv.get(KEYS.seq(general.id)))).toBe(lastSeqOfBlock(0));
    const archive = await exportAll(wsId);
    expect(archive.pages.find((p) => p.conv === general.id)).toMatchObject({ seq: 50, from: 0, to: 0 });
    const { copy, general: g } = await restore(archive, 'copy000001');
    expect(Number(await rt.kv.get(KEYS.seq(g.id)))).toBe(50);
    expect((await rt.kv.get(KEYS.block(g.id, 0))).full).toBe(1);
    const act = await rt.kv.get(KEYS.activity(copy));
    expect(act.c[g.id].s).toBe(50);
    expect(act.c[g.id].k).toEqual([12, 50]);
    // Bob, with a mention counted for him, reads to the last message standing: the badge clears, as it does on the original.
    await rt.kv.update(KEYS.member(copy, bob.uuid), { [`mentions.${g.id}`]: 1 });
    expect((await as(bob).post(`/api/ws/${copy}/conv/${g.id}/read`, { seq: 11 })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.member(copy, bob.uuid))).mentions[g.id]).toBe(0);
    // The next post opens the second block, as on the original.
    const next = await as(bob).post(`/api/ws/${copy}/conv/${g.id}/messages`, { text: 'after the move' });
    expect(next.ok).toBe(true);
    expect(blockIndexOf(next.data.message.seq)).toBe(1);
    expect((await as(alice).get(`/api/ws/${copy}/conv/${g.id}/messages`)).data.messages.map((m) => m.seq)).toContain(51);
  });

  it('closes a head block whose every message was deleted before the export, the run covering the whole block', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    // Fifty messages fill the first block (the "created" and "joined" lines among them); the fifty-first opens the second and is deleted.
    await fillTo(wsId, general.id, BLOCK_SIZE);
    const opener = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'gone soon @bob' });
    expect(opener.data.message.seq).toBe(51);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/51`)).ok).toBe(true);
    const archive = await exportAll(wsId);
    const page = archive.pages.find((p) => p.conv === general.id);
    expect(page).toMatchObject({ seq: 51, from: 0, to: 1 });
    expect(page.messages.some((m) => m.seq === 51)).toBe(false);
    const { copy, general: g } = await restore(archive, 'copy000002');
    expect(Number(await rt.kv.get(KEYS.seq(g.id)))).toBe(100);
    expect((await rt.kv.get(KEYS.block(g.id, 1))).full).toBe(1);
    expect((await rt.kv.get(KEYS.activity(copy))).c[g.id].k).toEqual([51, 100]);
    await rt.kv.update(KEYS.member(copy, bob.uuid), { [`mentions.${g.id}`]: 1 });
    expect((await as(bob).post(`/api/ws/${copy}/conv/${g.id}/read`, { seq: 50 })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.member(copy, bob.uuid))).mentions[g.id]).toBe(0);
    // The newest page reads the fifty that stand, and the next post lands in the third block.
    expect((await as(bob).get(`/api/ws/${copy}/conv/${g.id}/messages`)).data.messages).toHaveLength(50);
    expect(blockIndexOf((await as(bob).post(`/api/ws/${copy}/conv/${g.id}/messages`, { text: 'next' })).data.message.seq)).toBe(2);
  });

  it('leaves a block filled to its end alone, whatever the parts a page came in, and an archive from before pages named their blocks is closed by its last part', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await fillTo(wsId, general.id, 61);
    expect(Number(await rt.kv.get(KEYS.seq(general.id)))).toBe(61);
    const archive = await exportAll(wsId);
    // In parts of seven: several parts carry the head block, and the earlier
    // ones, cut short of its newest message, must not close it.
    const { copy, general: g } = await restore(archive, 'copy000003', { chunk: 7 });
    expect(Number(await rt.kv.get(KEYS.seq(g.id)))).toBe(61);
    expect((await rt.kv.get(KEYS.block(g.id, 1))).full).toBeUndefined();
    expect((await rt.kv.get(KEYS.block(g.id, 0))).full).toBeUndefined();
    expect((await rt.kv.get(KEYS.activity(copy))).c[g.id].k).toBeUndefined();
    expect(blockIndexOf((await as(bob).post(`/api/ws/${copy}/conv/${g.id}/messages`, { text: 'next' })).data.message.seq)).toBe(1);
    // Newest deleted, then an archive whose pages carry no block range (an
    // export from before): the last part, carrying the head block, closes it.
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/61`)).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/60`)).ok).toBe(true);
    const older = await exportAll(wsId);
    const { copy: copy2, general: g2 } = await restore(older, 'copy000004', { chunk: 7, shape: ({ from, to, ...p }) => p });
    expect(Number(await rt.kv.get(KEYS.seq(g2.id)))).toBe(100);
    expect((await rt.kv.get(KEYS.block(g2.id, 1))).full).toBe(1);
    expect((await rt.kv.get(KEYS.activity(copy2))).c[g2.id].k).toEqual([60, 100]);
    expect((await as(bob).get(`/api/ws/${copy2}/conv/${g2.id}/messages`)).data.messages.map((m) => m.seq)).toContain(59);
  });
});
