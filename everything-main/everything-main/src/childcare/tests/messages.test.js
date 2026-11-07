import { describe, it, expect } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { sendMessage, markRead, isUnread, unreadCount, messagesName } from '../src/core/messages.js';

describe('messages', () => {
  it('keeps the thread summary in step and tracks unread on both sides', async () => {
    const s = createStore({ backend: createMemoryBackend(), flushDelay: 10_000 });
    await s.init();
    const family = { role: 'family', uuid: 'u1' };
    const staff = { role: 'staff' };
    sendMessage(s, { studentId: 'k1', text: '  Running late today  ', from: 'family', author: 'Mia', authorUuid: 'u1', at: '2026-10-12T08:00:00.000Z' });
    let t = s.get('threads', 'k1');
    expect(t).toMatchObject({ lastText: 'Running late today', lastFrom: 'family' });
    expect(isUnread(t, staff)).toBe(true);
    expect(isUnread(t, family)).toBe(false);
    markRead(s, 'k1', { role: 'staff', at: '2026-10-12T08:05:00.000Z' });
    expect(isUnread(s.get('threads', 'k1'), staff)).toBe(false);
    sendMessage(s, { studentId: 'k1', text: 'No problem!', from: 'staff', author: 'Tess', at: '2026-10-12T08:06:00.000Z' });
    t = s.get('threads', 'k1');
    expect(isUnread(t, family)).toBe(true);
    expect(isUnread(t, { role: 'family', uuid: 'u2' })).toBe(true);
    expect(unreadCount([t], family)).toBe(1);
    expect(s.all(messagesName('k1'))).toHaveLength(2);
  });

  it('ignores empty messages and previews attachments', async () => {
    const s = createStore({ backend: createMemoryBackend(), flushDelay: 10_000 });
    await s.init();
    expect(sendMessage(s, { studentId: 'k1', text: '   ', from: 'staff' })).toBeNull();
    sendMessage(s, { studentId: 'k1', from: 'staff', media: [{ path: 'a' }, { path: 'b' }] });
    expect(s.get('threads', 'k1').lastText).toBe('2 attachments');
  });
});
