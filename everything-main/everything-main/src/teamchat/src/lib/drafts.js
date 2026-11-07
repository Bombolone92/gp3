/**
 * Unsent messages, per conversation, kept in localStorage so a half-written
 * message survives switching conversations, a reload, and a closed tab.
 * A draft is `{ text, attachments, ts }` under `${wsId}:${convId}` (a
 * thread's id for a reply). Attachment entries carry the ids of finished
 * uploads only; bytes are never stored here.
 *
 * Changes are announced with a `teamchat:drafts` event on window so the
 * sidebar can mark rows and the Drafts view can refresh.
 */

const KEY = 'teamchat:drafts';
const MAX = 200;
let cache = null;
/**
 * Whether this tab's copy holds a change the browser's storage would not
 * take (full, or turned off): the copy is then the only one there is, and
 * is not read over from storage, which is behind it, until a write goes
 * through again. Read over on every change, as it is when storage works,
 * the drafts of every conversation but the one being typed in were gone
 * from the tab the moment the next one was typed in.
 */
let unsaved = false;
/**
 * What this tab took out of the map since its last write went through:
 * each key removed (a draft sent, or emptied) with when, and the moment
 * everything was cleared (sign-out), if it was. Storage still holds them
 * while it takes no writes, and read under the tab's copy (see reload) it
 * would put the sent message's draft back in the conversation and in the
 * Drafts count. A draft another tab wrote for the same conversation after
 * the removal is newer, and is taken.
 */
const removed = new Map();
let clearedAt = 0;

/** The map as storage has it; empty when storage cannot be read. */
function stored() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** Storage's map under this tab's copy, less what this tab has removed since it could last write. */
function merged() {
  const under = stored();
  for (const [k, d] of Object.entries(under)) {
    const at = Math.max(removed.get(k) || 0, clearedAt);
    if (at && !((d && d.ts) > at)) delete under[k];
  }
  return { ...under, ...cache };
}

function all() {
  if (cache) return cache;
  cache = stored();
  return cache;
}

/**
 * The map as stored right now, for a change to be written into. The map is
 * written whole, and another tab of this account writes it too: a change
 * laid into this tab's copy of it would write away a draft the other tab
 * saved since that copy was read.
 */
function reload() {
  // What another tab saved meanwhile is taken under this tab's copy (its
  // own drafts winning where both have one), so the first write that goes
  // through does not write the other tab's drafts away.
  if (unsaved && cache) return (cache = merged());
  cache = null;
  return all();
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
    unsaved = false;
    removed.clear();
    clearedAt = 0;
  } catch {
    unsaved = true; // full or unavailable: the in-memory copy serves this tab, and is kept (see reload)
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('teamchat:drafts'));
}

// Another tab wrote the drafts (the browser says so to every other tab of
// the origin): this tab's copy is behind, and is read again on the next
// look; and the change is announced here as one made here would be, so the
// sidebar's marks and the Drafts view follow what was written there.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    // While this tab holds what storage would not take, the other tab's
    // write is taken under its copy rather than in place of it (see reload).
    cache = unsaved && cache ? merged() : null;
    window.dispatchEvent(new CustomEvent('teamchat:drafts'));
  });
}

export function draftKey(wsId, convId) {
  return `${wsId}:${convId}`;
}

export function getDraft(key) {
  return all()[key] || null;
}

export function hasDraft(key) {
  const d = all()[key];
  return !!d && (!!d.text?.trim() || !!d.attachments?.length);
}

/** Store a draft, or remove it when there is nothing left in it. */
export function setDraft(key, { text = '', attachments = [] } = {}) {
  const store = reload();
  const empty = !text.trim() && !attachments.length;
  const before = store[key];
  if (empty) {
    if (!before) return;
    delete store[key];
    removed.set(key, Date.now());
  } else {
    if (before && before.text === text && JSON.stringify(before.attachments || []) === JSON.stringify(attachments)) return;
    store[key] = { text, attachments, ts: Date.now() };
    // Oldest first out when the map grows past what anyone would keep.
    const keys = Object.keys(store);
    if (keys.length > MAX) {
      keys.sort((a, b) => (store[a].ts || 0) - (store[b].ts || 0));
      for (const k of keys.slice(0, keys.length - MAX)) delete store[k];
    }
  }
  persist();
}

export function deleteDraft(key) {
  const store = reload();
  if (!(key in store)) return;
  delete store[key];
  removed.set(key, Date.now());
  persist();
}

/** Every draft in a workspace, newest first: `{ key, conv, text, attachments, ts }`. */
export function listDrafts(wsId) {
  const prefix = `${wsId}:`;
  return Object.entries(all())
    .filter(([k, d]) => k.startsWith(prefix) && d && (d.text?.trim() || d.attachments?.length))
    .map(([k, d]) => ({ key: k, conv: k.slice(prefix.length), text: d.text || '', attachments: d.attachments || [], ts: d.ts || 0 }))
    .sort((a, b) => b.ts - a.ts);
}

export function draftCount(wsId) {
  return listDrafts(wsId).length;
}

/**
 * Forget every draft of one workspace (left, removed from, or deleted; see
 * the store's forgetWorkspace). Kept, they sat in the browser's storage for
 * a workspace with no conversation to send them into, until the map's
 * pruning happened to reach them, and came back into their conversations
 * on a rejoin months later, half a thought from a context long gone; what
 * the member has there is what they had at the time. Each key is noted as
 * removed, as deleteDraft notes it, so a tab whose storage takes no writes
 * does not read them back from under its copy (see merged).
 */
export function forgetDrafts(wsId) {
  const store = reload();
  const prefix = `${wsId}:`;
  const keys = Object.keys(store).filter((k) => k.startsWith(prefix));
  if (!keys.length) return;
  for (const k of keys) {
    delete store[k];
    removed.set(k, Date.now());
  }
  persist();
}

/** Forget everything (sign-out). */
export function clearDrafts() {
  cache = {};
  removed.clear();
  clearedAt = Date.now();
  persist();
}

/** Tests: drop the in-memory copy so the next read comes from storage. */
export function _resetDraftCache() {
  cache = null;
}
