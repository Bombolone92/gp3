import { localPoint, worldPoint } from "./geometry.js";
import { canonicalLanguage } from "./accessibility/language-tag.js";
import { validateTextRuns } from "./rich-text.js";
export function validateCommentLanguage(message) {
  if (message.lang !== undefined && !canonicalLanguage(message.lang))
    throw Error("Invalid comment language.");
  validateTextRuns(message.text, message.textRuns);
  if (
    message.textRuns?.some((run) =>
      Object.keys(run.style).some((key) => key !== "lang"),
    )
  )
    throw Error("Invalid comment language.");
}
export const COMMENT_LIMITS = {
  threads: 500,
  replies: 100,
  messages: 5000,
  text: 4000,
};
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
const keys = (v, allowed) =>
  object(v) && Object.keys(v).every((k) => allowed.includes(k));
const string = (v, max) =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const coordinate = (v) => Number.isFinite(v) && Math.abs(v) <= 1e6;
const time = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 8640000000000000;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function validateComments(comments) {
  if (comments === undefined) return;
  if (!Array.isArray(comments) || comments.length > COMMENT_LIMITS.threads)
    throw Error("Invalid board comments.");
  const ids = new Set();
  let count = 0;
  for (const thread of comments) {
    if (
      !keys(thread, [
        "id",
        "x",
        "y",
        "anchorId",
        "dx",
        "dy",
        "resolved",
        "messages",
      ]) ||
      !string(thread.id, 128) ||
      ids.has(thread.id) ||
      !coordinate(thread.x) ||
      !coordinate(thread.y) ||
      typeof thread.resolved !== "boolean" ||
      !Array.isArray(thread.messages) ||
      !thread.messages.length ||
      thread.messages.length > COMMENT_LIMITS.replies ||
      (thread.anchorId !== undefined
        ? !string(thread.anchorId, 256) ||
          !coordinate(thread.dx) ||
          !coordinate(thread.dy)
        : thread.dx !== undefined || thread.dy !== undefined)
    )
      throw Error("Invalid comment thread.");
    ids.add(thread.id);
    const messages = new Set();
    for (const m of thread.messages) {
      if (
        !keys(m, [
          "id",
          "authorId",
          "authorName",
          "text",
          "createdAt",
          "editedAt",
          "deleted",
          "lang",
          "textRuns",
        ]) ||
        !string(m.id, 128) ||
        messages.has(m.id) ||
        !string(m.authorId, 200) ||
        !string(m.authorName, 100) ||
        !string(m.text, COMMENT_LIMITS.text) ||
        !m.text.trim() ||
        !time(m.createdAt) ||
        (m.editedAt !== undefined &&
          (!time(m.editedAt) || m.editedAt < m.createdAt)) ||
        (m.deleted !== undefined && typeof m.deleted !== "boolean")
      )
        throw Error("Invalid comment message.");
      validateCommentLanguage(m);
      messages.add(m.id);
      if (++count > COMMENT_LIMITS.messages)
        throw Error("This board has reached its comment limit.");
    }
  }
}
// Commits checked at the same time can each stay within the limits while
// together crossing them. Discussions cannot be removed, so the shared board
// shows the oldest discussions and messages that fit, the same on every
// client, instead of becoming impossible to save. Messages are in order.
export function limitComments(comments) {
  let total = 0;
  for (const thread of comments)
    total +=
      thread.messages.length > COMMENT_LIMITS.replies
        ? Infinity
        : thread.messages.length;
  if (
    comments.length <= COMMENT_LIMITS.threads &&
    total <= COMMENT_LIMITS.messages
  )
    return comments;
  const age = (thread) => thread.messages[0]?.createdAt ?? Infinity;
  const ordered = [...comments].sort(
    (a, b) => age(a) - age(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const kept = new Map();
  let room = COMMENT_LIMITS.messages;
  for (const thread of ordered) {
    if (kept.size === COMMENT_LIMITS.threads) break;
    const count = Math.min(
      thread.messages.length,
      COMMENT_LIMITS.replies,
      room,
    );
    if (thread.messages.length && !count) continue;
    room -= count;
    kept.set(
      thread,
      count < thread.messages.length
        ? { ...thread, messages: thread.messages.slice(0, count) }
        : thread,
    );
  }
  return comments.filter((t) => kept.has(t)).map((t) => kept.get(t));
}
export function commentPoint(thread, byId) {
  const anchor = byId.get(thread.anchorId);
  return anchor
    ? worldPoint(anchor, { x: anchor.x + thread.dx, y: anchor.y + thread.dy })
    : { x: thread.x, y: thread.y };
}
// A discussion whose object is removed stays at the object's last saved
// position but keeps its attachment, so it follows the object again when an
// undo or a restored version brings the object back.
export function updateCommentAnchors(comments = [], items) {
  if (!comments.length) return comments;
  const byId = new Map(items.map((i) => [i.id, i]));
  let changed = false;
  const result = comments.map((thread) => {
    if (!thread.anchorId || !byId.has(thread.anchorId)) return thread;
    const p = commentPoint(thread, byId);
    if (thread.x === p.x && thread.y === p.y) return thread;
    changed = true;
    return { ...thread, ...p };
  });
  return changed ? result : comments;
}
// The first characters of a comment, never ending in half an emoji or other
// character written as two code units.
export function commentExcerpt(text, length) {
  const cut = String(text).slice(0, length);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}
export const commentActivity = (thread) =>
  Math.max(...thread.messages.map((m) => m.editedAt || m.createdAt));
export function commentMessage(author, text, now = Date.now()) {
  return {
    id: crypto.randomUUID(),
    authorId: author.id,
    authorName: author.name,
    text: text.trim(),
    createdAt: now,
  };
}
export function commentThread(point, author, text, anchor, now = Date.now()) {
  return {
    id: crypto.randomUUID(),
    x: point.x,
    y: point.y,
    ...(anchor ? commentAttachment(point, anchor) : {}),
    resolved: false,
    messages: [commentMessage(author, text, now)],
  };
}
export function commentAttachment(point, anchor) {
  const p = localPoint(anchor, point);
  return { anchorId: anchor.id, dx: p.x - anchor.x, dy: p.y - anchor.y };
}
// Merge by identity, down to individual replies. Concurrent replies and changes
// to different fields survive queued saves; a stale local array never replaces a thread.
function rebaseRecords(local, before, remote, nested) {
  const old = new Map(before.map((i) => [i.id, i])),
    mine = new Map(local.map((i) => [i.id, i]));
  const result = remote.map((r) => {
    const a = old.get(r.id),
      b = mine.get(r.id);
    if (!b) return structuredClone(r); // Comments use recoverable tombstones, not removals.
    const next = structuredClone(r);
    for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b)])) {
      if (!nested && ["text", "textRuns"].includes(k)) continue;
      if (k === nested) next[k] = rebaseRecords(b[k], a?.[k] || [], r[k], null);
      else if (!same(a?.[k], b[k])) {
        if (b[k] === undefined) delete next[k];
        else next[k] = structuredClone(b[k]);
      }
    }
    if (!nested && (!same(a?.text, b.text) || !same(a?.textRuns, b.textRuns))) {
      next.text = b.text;
      if (b.textRuns) next.textRuns = structuredClone(b.textRuns);
      else delete next.textRuns;
    }
    return next;
  });
  const present = new Set(result.map((i) => i.id));
  for (const i of local)
    if (!present.has(i.id) && !old.has(i.id)) result.push(structuredClone(i));
  return result;
}
export const rebaseComments = (local = [], before = [], remote = []) =>
  rebaseRecords(local, before, remote, "messages");

// Enforced by the worker as well as the UI. Editors can resolve/reposition a
// thread, but cannot impersonate another author or change another user's words.
// Counts include discussions the board leaves out for exceeding the limits:
// a change may not add to a count already over its limit.
export function validateCommentGrowth(before, after) {
  if (
    (after.threads.size > COMMENT_LIMITS.threads &&
      after.threads.size > before.threads.size) ||
    (after.total > COMMENT_LIMITS.messages && after.total > before.total)
  )
    throw Error("This board has reached its comment limit.");
  for (const [id, count] of after.threads)
    if (count > COMMENT_LIMITS.replies && count > (before.threads.get(id) ?? 0))
      throw Error("Invalid comment thread.");
}
// Messages are ordered by creation time, which the author's device sets.
// Edits queued offline can be older than messages others posted since, so
// only a date before the discussion began, or far ahead, is refused.
const CLOCK_SKEW = 86_400_000;
export function validateCommentChanges(
  before = [],
  after = [],
  user,
  now = Date.now(),
) {
  const next = new Map(after.map((t) => [t.id, t]));
  for (const t of before)
    if (!next.has(t.id))
      throw Error("Comment threads cannot be removed. Resolve them instead.");
  const prior = new Map(before.map((t) => [t.id, t]));
  for (const t of after) {
    const old = new Map(
      (prior.get(t.id)?.messages || []).map((m) => [m.id, m]),
    );
    const began = old.size
      ? Math.min(...[...old.values()].map((m) => m.createdAt))
      : -Infinity;
    if ([...old.keys()].some((id) => !t.messages.some((m) => m.id === id)))
      throw Error("Comments must be deleted with a recoverable marker.");
    for (const m of t.messages) {
      const a = old.get(m.id);
      if (!a) {
        if (
          m.authorId !== user.uuid ||
          m.authorName !== (user.username || "Member")
        )
          throw Error("Comment author does not match the signed-in account.");
        if (m.createdAt < began || m.createdAt > now + CLOCK_SKEW)
          throw Error("This comment's time is not valid.");
      } else if (!same(a, m)) {
        if (
          a.authorId !== user.uuid ||
          ["authorId", "authorName", "createdAt"].some((k) => a[k] !== m[k])
        )
          throw Error("Only the author can edit this comment.");
        // Discussions are listed by their latest activity; a date far ahead
        // would keep one at the top for everyone.
        if (m.editedAt !== a.editedAt && m.editedAt > now + CLOCK_SKEW)
          throw Error("This comment's time is not valid.");
      }
    }
  }
}
