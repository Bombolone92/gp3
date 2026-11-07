/**
 * Family conversations: one thread per child, shared by everyone on staff
 * and every family member linked to that child.
 *
 *   threads              { id: studentId, lastAt, lastText, lastFrom: 'staff' | 'family',
 *                          lastAuthor, staffReadAt, familyReadAt: { [uuid]: iso } }
 *   messages:<studentId> { id, studentId, at: iso, from: 'staff' | 'family', author,
 *                          authorUuid, text, media: [attachment] }
 *
 * The thread record is small and loads with the app, so the inbox and
 * unread badges never need to read the messages themselves.
 */
import { partition } from './keys.js';

export const messagesName = (studentId) => partition('messages', studentId);

export function sendMessage(store, { studentId, text = '', from, author = '', authorUuid = '', media = [], at = new Date().toISOString() }) {
  const body = String(text).trim();
  if (!body && !media.length) return null;
  const msg = store.put(messagesName(studentId), {
    studentId,
    at,
    from,
    author,
    authorUuid: authorUuid || undefined,
    text: body,
    media: media.length ? media : undefined,
  });
  const cur = store.get('threads', studentId) || { id: studentId };
  const preview = body || (media.length > 1 ? `${media.length} attachments` : 'Attachment');
  const next = { ...cur, lastAt: at, lastText: preview.slice(0, 140), lastFrom: from, lastAuthor: author };
  // Sending counts as reading the conversation.
  if (from === 'staff') next.staffReadAt = at;
  else next.familyReadAt = { ...(cur.familyReadAt || {}), [authorUuid || 'family']: at };
  store.put('threads', next);
  return msg;
}

export function markRead(store, studentId, { role, uuid = 'family', at = new Date().toISOString() }) {
  const cur = store.get('threads', studentId);
  if (!cur || !isUnread(cur, { role, uuid })) return;
  // A device whose clock is behind the sender's would otherwise record a read
  // time before the last message, leave it unread, and write again on every render.
  if (at < cur.lastAt) at = cur.lastAt;
  if (role === 'family') store.put('threads', { ...cur, familyReadAt: { ...(cur.familyReadAt || {}), [uuid]: at } });
  else store.put('threads', { ...cur, staffReadAt: at });
}

export function isUnread(thread, { role, uuid = 'family' }) {
  if (!thread?.lastAt) return false;
  if (role === 'family') {
    if (thread.lastFrom !== 'staff') return false;
    const read = thread.familyReadAt?.[uuid];
    return !read || read < thread.lastAt;
  }
  if (thread.lastFrom !== 'family') return false;
  return !thread.staffReadAt || thread.staffReadAt < thread.lastAt;
}

export function unreadCount(threads, who) {
  let n = 0;
  for (const t of threads) if (isUnread(t, who)) n++;
  return n;
}

export function sortMessages(list) {
  return [...list].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
