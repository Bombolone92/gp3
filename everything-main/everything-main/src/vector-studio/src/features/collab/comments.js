/**
 * Review comments: discussion threads pinned to a point on the canvas or
 * to an object, with replies, @mentions, editing, deletion and resolving.
 *
 * Data (plain JSON, replaced immutably, kept in doc.comments and saved
 * with the file):
 *   { threads: { [id]: {
 *       id, created, author: { id, name },
 *       anchor: { x, y, node?, dx?, dy? },   // node pins keep an offset from
 *                                            // the object's top-left corner;
 *                                            // x, y is the last known place
 *       resolved, resolvedBy?, resolvedAt?, deleted?,
 *       messages: { [id]: { id, author, text, created, edited?, deleted? } } } } }
 *
 * Changes are ops so they merge when shared: thread and message fields are
 * separate last-writer-wins registers, and creating is idempotent, so
 * concurrent replies all survive. Comments never enter Undo/Redo. Deleting
 * marks a message (or thread) deleted; its text is cleared.
 *
 *   { t, create: thread }      { t, set: { resolved, ... } }
 *   { t, m, create: message }  { t, m, set: { text, edited, deleted } }
 *
 * Shared by the browser and the collaboration worker (which checks
 * authorship with checkCommentOps).
 */

export const MAX_THREADS = 1000;
export const MAX_MESSAGES = 200;
export const MAX_TEXT = 4000;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const THREAD_FIELDS = new Set(['anchor', 'resolved', 'resolvedBy', 'resolvedAt', 'deleted']);
const MESSAGE_FIELDS = new Set(['text', 'edited', 'deleted']);

export function emptyComments() {
  return { threads: {} };
}

export function threadsOf(data) {
  return Object.values(data?.threads || {});
}

/** Apply comment ops; returns new data (or the same object when nothing changed). */
export function applyCommentOps(data, ops) {
  let threads = data?.threads || {};
  let changed = false;
  const own = new Set(); // thread ids already copied in this call
  const writable = (t) => {
    if (!changed) {
      threads = { ...threads };
      changed = true;
    }
    if (!own.has(t)) {
      threads[t] = { ...threads[t], messages: { ...threads[t].messages } };
      own.add(t);
    }
    return threads[t];
  };
  for (const op of ops || []) {
    if (!op || typeof op.t !== 'string') continue;
    const cur = threads[op.t];
    if (op.m === undefined) {
      if (op.create) {
        if (cur) continue;
        if (!changed) {
          threads = { ...threads };
          changed = true;
        }
        threads[op.t] = { ...op.create, id: op.t, messages: {} };
        own.add(op.t);
      } else if (op.set && cur) {
        const t = writable(op.t);
        for (const [k, v] of Object.entries(op.set)) if (THREAD_FIELDS.has(k)) t[k] = v;
      }
      continue;
    }
    if (!cur || typeof op.m !== 'string') continue;
    if (op.create) {
      if (cur.messages?.[op.m]) continue;
      const t = writable(op.t);
      t.messages[op.m] = { ...op.create, id: op.m };
    } else if (op.set && cur.messages?.[op.m]) {
      const t = writable(op.t);
      const msg = { ...t.messages[op.m] };
      for (const [k, v] of Object.entries(op.set)) if (MESSAGE_FIELDS.has(k)) msg[k] = v;
      t.messages[op.m] = msg;
    }
  }
  return changed ? { ...(data || {}), threads } : data;
}

/** Messages of a thread, oldest first; deleted ones are kept as placeholders. */
export function messagesOf(thread) {
  return Object.values(thread?.messages || {}).sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
}

/** Threads that still show (a deleted thread or one whose every message is deleted does not). */
export function visibleThreads(data) {
  return threadsOf(data)
    .filter((t) => !t.deleted && messagesOf(t).some((m) => !m.deleted))
    .sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
}

/** @usernames mentioned in text (lowercase, unique). */
export function mentionsIn(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/(^|[^\w@])@([A-Za-z0-9_][A-Za-z0-9_.-]{0,63})/g)) out.add(m[2].replace(/[.-]+$/, '').toLowerCase());
  return [...out];
}

/** Text split into plain and mention parts, for display: [{ text, mention? }]. */
export function splitMentions(text, known = null) {
  const parts = [];
  const s = String(text || '');
  let last = 0;
  for (const m of s.matchAll(/(^|[^\w@])@([A-Za-z0-9_][A-Za-z0-9_.-]{0,63})/g)) {
    const name = m[2].replace(/[.-]+$/, '');
    if (known && !known.has(name.toLowerCase())) continue;
    const start = m.index + m[1].length;
    if (start > last) parts.push({ text: s.slice(last, start) });
    parts.push({ text: `@${name}`, mention: name });
    last = start + name.length + 1;
  }
  if (last < s.length) parts.push({ text: s.slice(last) });
  return parts;
}

/**
 * Where a pin shows: an object pin follows its object (by its bounds),
 * falling back to the last known point when the object is gone.
 */
export function pinPosition(thread, boundsOf) {
  const a = thread.anchor || { x: 0, y: 0 };
  if (a.node) {
    const b = boundsOf(a.node);
    if (b) return { x: b.x + (a.dx || 0), y: b.y + (a.dy || 0), attached: true };
  }
  return { x: a.x || 0, y: a.y || 0, attached: false };
}

// ---- op builders (the caller applies them and, when shared, sends them) ----

export function createThreadOps({ id, messageId, author, text, anchor, now = Date.now() }) {
  return [
    { t: id, create: { created: now, author, anchor, resolved: false } },
    { t: id, m: messageId, create: { author, text: String(text).slice(0, MAX_TEXT), created: now } },
  ];
}

export function replyOps(threadId, { id, author, text, now = Date.now() }) {
  return [{ t: threadId, m: id, create: { author, text: String(text).slice(0, MAX_TEXT), created: now } }];
}

export function editMessageOps(threadId, messageId, text, now = Date.now()) {
  return [{ t: threadId, m: messageId, set: { text: String(text).slice(0, MAX_TEXT), edited: now } }];
}

export function deleteMessageOps(threadId, messageId) {
  return [{ t: threadId, m: messageId, set: { deleted: true, text: '' } }];
}

export function resolveOps(threadId, resolved, by, now = Date.now()) {
  return [{ t: threadId, set: resolved ? { resolved: true, resolvedBy: by, resolvedAt: now } : { resolved: false, resolvedBy: null, resolvedAt: null } }];
}

export function moveThreadOps(threadId, anchor) {
  return [{ t: threadId, set: { anchor } }];
}

export function deleteThreadOps(threadId) {
  return [{ t: threadId, set: { deleted: true } }];
}

/**
 * Comments written before a document was shared carry the local author;
 * sharing gives them the owner's identity.
 */
export function claimLocalComments(data, author) {
  if (!data?.threads) return data;
  const threads = {};
  const local = (a) => !a || a.id === 'local';
  for (const [id, t] of Object.entries(data.threads)) {
    const messages = {};
    for (const [mid, m] of Object.entries(t.messages || {})) messages[mid] = local(m.author) ? { ...m, author } : m;
    threads[id] = { ...t, author: local(t.author) ? author : t.author, messages };
  }
  return { ...data, threads };
}

// ---- permissions (worker) ----

const fail = (message, status = 403) => {
  throw Object.assign(new Error(message), { status });
};

function checkAnchor(a) {
  if (!a || typeof a !== 'object' || !Number.isFinite(a.x) || !Number.isFinite(a.y)) fail('Invalid comment position.', 400);
  if (a.node !== undefined && (typeof a.node !== 'string' || a.node.length > 120)) fail('Invalid comment position.', 400);
}

function checkAuthor(author, user) {
  if (!author || author.id !== user.uuid) fail('Comments can only be written as yourself.');
}

/**
 * Check comment ops against who sends them: anyone who may comment adds
 * threads and replies as themselves, resolves and reopens; only a
 * message's author edits or deletes it; a thread is moved or deleted by
 * its author or an editor. Throws on the first refusal.
 */
export function checkCommentOps(data, ops, user, role) {
  if (!['owner', 'editor', 'commenter'].includes(role)) fail('You cannot comment on this document.');
  const editor = role === 'owner' || role === 'editor';
  const threads = data?.threads || {};
  const created = new Map(); // threads created in this batch
  let count = Object.keys(threads).length;
  for (const op of ops) {
    if (!op || typeof op !== 'object' || typeof op.t !== 'string' || !ID.test(op.t)) fail('Invalid comment.', 400);
    if (op.m !== undefined && (typeof op.m !== 'string' || !ID.test(op.m))) fail('Invalid comment.', 400);
    if (!op.create === !op.set) fail('Invalid comment.', 400);
    const thread = threads[op.t] || created.get(op.t);
    if (op.m === undefined) {
      if (op.create) {
        if (thread) continue; // repeated creation is a no-op
        if (++count > MAX_THREADS) fail('This document has too many comments.', 422);
        checkAuthor(op.create.author, user);
        checkAnchor(op.create.anchor);
        created.set(op.t, { author: op.create.author, messages: {} });
        continue;
      }
      if (!thread) continue;
      for (const [k, v] of Object.entries(op.set)) {
        if (!THREAD_FIELDS.has(k)) fail('Invalid comment change.', 400);
        if (k === 'anchor') {
          checkAnchor(v);
          if (!editor && thread.author?.id !== user.uuid) fail('Only its author or an editor can move this comment.');
        }
        if (k === 'deleted' && !editor && thread.author?.id !== user.uuid) fail('Only its author or an editor can delete this comment.');
        if (k === 'resolvedBy' && v !== null && v?.id !== user.uuid) fail('Comments can only be resolved as yourself.');
      }
      continue;
    }
    if (!thread) continue;
    const msg = thread.messages?.[op.m];
    if (op.create) {
      if (msg) continue;
      checkAuthor(op.create.author, user);
      if (typeof op.create.text !== 'string' || op.create.text.length > MAX_TEXT) fail('Comments are limited to 4,000 characters.', 422);
      if (Object.keys(thread.messages || {}).length >= MAX_MESSAGES) fail('This discussion has too many replies.', 422);
      continue;
    }
    if (!msg) continue;
    if (msg.author?.id !== user.uuid) fail("You can only change your own comments.");
    for (const [k, v] of Object.entries(op.set)) {
      if (!MESSAGE_FIELDS.has(k)) fail('Invalid comment change.', 400);
      if (k === 'text' && (typeof v !== 'string' || v.length > MAX_TEXT)) fail('Comments are limited to 4,000 characters.', 422);
    }
  }
}
