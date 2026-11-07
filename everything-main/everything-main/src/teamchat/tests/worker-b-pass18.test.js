/**
 * Review pass 18, the message plane: channels, messages, threads, reactions,
 * pins, saved messages, direct messages, huddles, shared channels, transfer.
 * Each test here is a hole that was found in the worker's routes and closed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';

const { alice, bob, carol } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

const msgs = async (who, wsId, conv) => (await as(who).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages;

describe('a reaction on a line the worker wrote', () => {
  it('is refused by its address, from the person the line is about, from anyone else and from a bot token, and leaves the conversation\'s stamp where it was', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const joined = (await msgs(alice, wsId, general.id)).find((m) => m.kind === 'sys' && m.text === 'bob joined');
    expect(joined).toBeTruthy();
    const bot = await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Deploy', channels: [general.id], scopes: ['react'] });
    expect(bot.ok).toBe(true);
    const before = (await rt.kv.get(KEYS.activity(wsId))).c[general.id];
    const url = `/api/ws/${wsId}/conv/${general.id}/messages/${joined.seq}/reactions`;
    for (const who of [bob, carol, alice]) {
      const res = await as(who).post(url, { reaction: 'wave' });
      expect(res.status).toBe(400);
      expect(res.data).toMatchObject({ code: 'invalid', message: 'System lines take no reactions' });
    }
    const byBot = await as(null).post(`/bot/${bot.data.token}/channels/${general.id}/messages/${joined.seq}/reactions`, { reaction: 'wave', on: true });
    expect(byBot.status).toBe(400);
    expect(byBot.data.code).toBe('invalid');
    // Nothing was written onto the line, and no tab is told the conversation changed.
    const block = await rt.kv.get(KEYS.block(general.id, 0));
    expect(block.x?.[`s${joined.seq}`]?.r).toBeUndefined();
    expect((await rt.kv.get(KEYS.activity(wsId))).c[general.id]).toEqual(before);
    expect((await msgs(alice, wsId, general.id)).find((m) => m.seq === joined.seq).reactions).toEqual({});
    // A message a member wrote still takes one, from a member and from the token.
    const said = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'hello' })).data.message;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages/${said.seq}/reactions`, { reaction: 'wave' })).data).toEqual({ ok: true, on: true });
    expect((await as(null).post(`/bot/${bot.data.token}/channels/${general.id}/messages/${said.seq}/reactions`, { reaction: 'wave', on: true })).data).toEqual({ ok: true, on: true });
    const reactors = Object.keys((await msgs(alice, wsId, general.id)).find((m) => m.seq === said.seq).reactions.wave);
    expect(reactors).toHaveLength(2);
    expect(reactors).toContain(bob.uuid);
    expect(reactors.some((k) => k.startsWith('bot_'))).toBe(true);
  });
});

describe('deleting a line the worker wrote', () => {
  it('is an admin\'s alone: the person the line is about cannot take the record of their joining or pinning out, and anyone else is refused as before', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const joined = (await msgs(alice, wsId, general.id)).find((m) => m.kind === 'sys' && m.text === 'bob joined');
    expect(joined.user).toBe(bob.uuid);
    const said = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'pin me' })).data.message;
    expect((await as(carol).post(`/api/ws/${wsId}/conv/${general.id}/pins`, { seq: said.seq })).ok).toBe(true);
    const pinned = (await msgs(alice, wsId, general.id)).find((m) => m.kind === 'sys' && /pinned a message/.test(m.text));
    expect(pinned.user).toBe(carol.uuid);
    // The subject of each line, and a bystander.
    for (const [who, line] of [[bob, joined], [carol, pinned], [carol, joined], [bob, pinned]]) {
      const res = await as(who).del(`/api/ws/${wsId}/conv/${general.id}/messages/${line.seq}`);
      expect(res.status).toBe(403);
      expect(res.data.code).toBe('forbidden');
    }
    const standing = await msgs(alice, wsId, general.id);
    expect(standing.find((m) => m.seq === joined.seq)?.text).toBe('bob joined');
    expect(standing.find((m) => m.seq === pinned.seq)?.deleted).toBe(false);
    // A member still deletes their own message, and not another's; an admin still takes a system line out.
    const mine = (await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'oops' })).data.message;
    expect((await as(carol).del(`/api/ws/${wsId}/conv/${general.id}/messages/${mine.seq}`)).status).toBe(403);
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${general.id}/messages/${mine.seq}`)).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${joined.seq}`)).ok).toBe(true);
    const after = await msgs(alice, wsId, general.id);
    expect(after.find((m) => m.seq === joined.seq)).toBeUndefined();
    expect(after.find((m) => m.seq === mine.seq)).toBeUndefined();
  });
});

describe('a channel bookmark\'s address', () => {
  it('is refused past its length rather than stored cut short, and refused with a control or bidirectional character in it; an address in any script within the limit stands', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const put = (bookmarks) => as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { bookmarks });
    const standing = [{ label: 'Docs', url: 'https://docs.example/start' }];
    expect((await put(standing)).ok).toBe(true);
    const long = `https://a.example/${'a'.repeat(5000)}`;
    for (const url of [long, `https://a.example/${'a'.repeat(501 - 'https://a.example/'.length)}`]) {
      const res = await put([{ label: 'x', url }]);
      expect(res.status).toBe(400);
      expect(res.data).toMatchObject({ code: 'invalid', message: 'That link is too long (500 characters at most)' });
    }
    for (const url of ['https://a.example/x\u0000y', 'https://a.example/x\u001by', 'https://a.example/\u202emoc.live', 'https://a.example/x\u200by', 'https://a.example/x\ufeffy', 'javascript:alert(1)', 'data:text/html,hi', 'vbscript:msgbox', '//evil.example/x', 'https://a.example/x y', 'https://a.example/x\ny', 'https://a.example/x\u00a0y']) {
      const res = await put([{ label: 'x', url }]);
      expect(res.status).toBe(400);
      expect(res.data).toMatchObject({ code: 'invalid', message: 'Bookmarks need an http or https link' });
    }
    // Nothing of the refused writes reached the channel.
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.channels[general.id].bookmarks.map((b) => b.url)).toEqual(['https://docs.example/start']);
    // An address exactly at the limit, and one written in another script, stand whole.
    const exact = `https://a.example/${'a'.repeat(500 - 'https://a.example/'.length)}`;
    const kept = await put([{ label: 'x', url: exact }, { label: 'y', url: 'https://ja.wikipedia.org/wiki/日本語' }, { label: 'z', url: '  https://b.example/trimmed  ' }]);
    expect(kept.ok).toBe(true);
    expect(kept.data.channel.bookmarks.map((b) => b.url)).toEqual([exact, 'https://ja.wikipedia.org/wiki/日本語', 'https://b.example/trimmed']);
  });
});
