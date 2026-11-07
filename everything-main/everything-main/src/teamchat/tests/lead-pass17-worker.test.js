/**
 * Worker rules checked by the lead in review pass 17.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import { dmConvId } from '../src/shared/ids.js';

const { alice, bob } = USERS;

let rt;
beforeEach(async () => {
  rt = await boot();
});

const post = (u, wsId, conv, text, extra = {}) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text, ...extra });

describe('a thread under a line the worker wrote', () => {
  it('refuses a reply under a system line, and leaves the line without a thread', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const page = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    const joined = page.data.messages.find((m) => m.kind === 'sys' && /joined/.test(m.text));
    expect(joined).toBeTruthy();
    const res = await post(bob, wsId, `${general.id}_t${joined.seq}`, 'a reply under a join line');
    expect(res.status).toBe(400);
    expect(res.data).toMatchObject({ code: 'invalid', message: 'System lines have no thread' });
    const after = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    const root = after.data.messages.find((m) => m.seq === joined.seq);
    expect(root.replyCount).toBe(0);
    expect(root.lastReplyAt).toBeNull();
    // Nothing was written into the thread's conversation, and no thread
    // entry reached the poster's document.
    const thread = await as(bob).get(`/api/ws/${wsId}/conv/${general.id}_t${joined.seq}/messages`);
    expect(thread.data.messages).toEqual([]);
    const me = await as(bob).get(`/api/ws/${wsId}`);
    expect(me.data.me.threads?.[`${general.id}_t${joined.seq}`]).toBeUndefined();
  });

  it('refuses to schedule a reply under a system line', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const page = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    const created = page.data.messages.find((m) => m.kind === 'sys');
    const res = await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: `${general.id}_t${created.seq}`, text: 'later', dueAt: Date.now() + 3_600_000 });
    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalid');
    const list = await as(bob).get(`/api/ws/${wsId}/scheduled`);
    expect(list.data.scheduled ?? list.data.items ?? []).toEqual([]);
  });

  it('refuses a reply under a reminder line in one\'s own space', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = await post(bob, wsId, general.id, 'remember me');
    const base = Math.floor(Date.now() / 60_000) * 60_000 + 22_000;
    const r = await as(alice).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: m.data.message.seq, dueAt: base + 120_000, note: 'call' });
    expect(r.ok).toBe(true);
    await rt.kv.update(KEYS.sched(wsId), { [`m.${r.data.reminder.id}.dueAt`]: Date.now() - 1000 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1000 });
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    const self = dmConvId([alice.uuid], wsId);
    const line = (await as(alice).get(`/api/ws/${wsId}/conv/${self}/messages`)).data.messages.find((x) => x.kind === 'rem');
    expect(line).toBeTruthy();
    const res = await post(alice, wsId, `${self}_t${line.seq}`, 'a note under the reminder');
    expect(res.status).toBe(400);
    expect(res.data).toMatchObject({ code: 'invalid', message: 'Reminders have no thread' });
  });

  it('still takes a reply under a message a member wrote', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const root = await post(alice, wsId, general.id, 'a real root');
    expect(root.status).toBe(200);
    const res = await post(bob, wsId, `${general.id}_t${root.data.message.seq}`, 'a real reply');
    expect(res.status).toBe(200);
    const after = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(after.data.messages.find((m) => m.seq === root.data.message.seq).replyCount).toBe(1);
  });
});
