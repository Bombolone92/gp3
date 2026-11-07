/**
 * Bookmarks, and links to a place in the document. A bookmark marks a
 * paragraph by name (the engine places `w:bookmarkStart` and `w:bookmarkEnd`
 * around the paragraph); a link with an anchor jumps to it in any DOCX reader.
 * Headings get a hidden bookmark (a name starting with "_", the convention
 * for bookmarks a producer makes for itself) the first time something links to them.
 */

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decode XML-escaped discovery names once for display and link destinations. */
export function decodeBookmarkName(name) {
  return name.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, (entity, code) => {
    if (code[0] !== '#') return XML_ENTITIES[code];
    const point = code[1] === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return [9, 10, 13].includes(point) || point >= 0x20 && point <= 0xd7ff || point >= 0xe000 && point <= 0xfffd || point >= 0x10000 && point <= 0x10ffff
      ? String.fromCodePoint(point) : entity;
  });
}

export const BOOKMARK_NAME_MAX = 40;

/** Valid bookmark names: letters, digits, and underscores, starting with a letter, at most 40 characters. Spaces become underscores. */
export function sanitizeBookmarkName(input) {
  // Combining marks belong to the letters they sit on: a decomposed "é" keeps its accent.
  let name = String(input || '').trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{M}\p{N}_]/gu, '');
  name = name.replace(/^[^\p{L}]+/u, '');
  // The cut must not leave half of a letter outside the Basic Multilingual Plane behind.
  return name.slice(0, BOOKMARK_NAME_MAX).replace(/[\ud800-\udbff]$/, '');
}

/** An error message for a typed name, or null when it can be used. */
export function validateBookmarkName(input, existing = []) {
  // The typed name is checked for the reserved prefix before it is made safe, which would silently drop it.
  if (/^\s*_/.test(String(input || ''))) return 'Names starting with an underscore are reserved';
  const name = sanitizeBookmarkName(input);
  if (!name) return 'Use letters, digits, and underscores, starting with a letter';
  if (existing.some((b) => (b.name || b) === name)) return 'A bookmark with that name already exists';
  return null;
}

/** The hidden bookmark name for a heading paragraph. */
export function headingBookmarkName(nodeId) {
  return `_Ref${String(nodeId || '').replace(/\W/g, '')}`.slice(0, BOOKMARK_NAME_MAX);
}

/** Whether a bookmark is one a producer (or this app) made for itself rather than the user. */
export function isHiddenBookmark(name) {
  return String(name || '').startsWith('_');
}

/** "name" from an anchor href ("#name"), or null for any other link. */
export function anchorFromHref(href) {
  const m = /^#(.+)$/.exec(String(href || '').trim());
  if (!m) return null;
  try { return decodeURIComponent(m[1]); }
  catch { return m[1]; } // Keep imported names with literal or invalid percent escapes usable.
}

/** The document's bookmarks as [{ name, blockId, hidden }], in document order as listed. */
export async function listBookmarks(api) {
  const items = (await api.bookmarks.list())?.items || [];
  return items.map((b) => ({ name: b.name, blockId: b.range?.from?.blockId || null, hidden: isHiddenBookmark(b.name) }));
}

/** The bookmark on a paragraph, preferring one the user named. */
export function bookmarkForBlock(bookmarks, blockId) {
  const mine = bookmarks.filter((b) => b.blockId === blockId);
  return mine.find((b) => !b.hidden) || mine[0] || null;
}

/** Resolve a decoded link name without confusing literal XML entity text. */
export function bookmarkForAnchor(bookmarks, anchor) {
  const matches = bookmarks.filter(bookmark => decodeBookmarkName(bookmark.name) === anchor);
  return matches.length && new Set(matches.map(bookmark => bookmark.blockId)).size === 1 ? matches[0] : null;
}

const ok = (r, what) => { if (r == null || r.success === false) throw new Error(r?.failure?.message || `${what} failed`); return r; };

/** The current engine resolves bookmark insertion targets in body text only. */
export function bookmarkStoryError(story) {
  return story && story.storyType !== 'body' ? 'New bookmarks can only be added to body text' : null;
}

export function placeLinkStoryError(story) {
  return story && story.storyType !== 'body' ? 'Links to bookmarks can only be added to body text' : null;
}

/** Put a bookmark named `name` on the paragraph `blockId`. */
export async function insertBookmark(api, blockId, name, { story } = {}) {
  // Supplying a story does not scope the engine's bookmark insertion. An ID
  // shared with body text would put the bookmark in the wrong paragraph.
  const unavailable = bookmarkStoryError(story);
  if (unavailable) throw new Error(unavailable);
  if (!blockId) throw new Error('Place the cursor in a paragraph first');
  return ok(await api.bookmarks.insert({ name, at: { kind: 'text', blockId, range: { start: 0, end: 0 } } }), 'Bookmark');
}

export async function removeBookmark(api, name) {
  return ok(await api.bookmarks.remove({ target: { kind: 'entity', entityType: 'bookmark', name } }), 'Remove bookmark');
}

/** The bookmark name to link a heading to: an existing one on that paragraph, or a hidden one made now. */
export async function ensureHeadingBookmark(api, nodeId, bookmarks = null, { onCreated = () => {}, beforeWrite = () => {} } = {}) {
  const all = bookmarks || await listBookmarks(api);
  const have = bookmarkForBlock(all, nodeId);
  if (have) return have.name;
  const name = headingBookmarkName(nodeId);
  beforeWrite();
  await insertBookmark(api, nodeId, name);
  // Keep the dialog's list current when a later linking step fails and the
  // user retries. The bookmark is already part of the document at this point.
  all.push({ name, blockId: nodeId, hidden: true });
  onCreated();
  return name;
}

/**
 * The places a link can point to: headings (linked through a bookmark on
 * the heading) and the user's own bookmarks. Each is { id, label, kind }.
 */
export function placeChoices(headings = [], bookmarks = []) {
  const out = headings.map((h) => ({ id: `h:${h.nodeId}`, label: h.text, kind: 'heading', nodeId: h.nodeId, level: h.level }));
  for (const b of bookmarks) if (!b.hidden) out.push({ id: `b:${b.name}`, label: decodeBookmarkName(b.name), kind: 'bookmark', name: b.name, blockId: b.blockId });
  return out;
}

/** Match a decoded link destination, retaining raw discovery names as choice IDs. */
export function choiceForAnchor(choices, anchor, bookmarks = []) {
  if (!anchor) return null;
  const names = bookmarks.filter(b => decodeBookmarkName(b.name) === anchor);
  if (new Set(names.map(b => b.blockId)).size > 1) return null;
  const direct = choices.filter(c => c.kind === 'bookmark' && decodeBookmarkName(c.name) === anchor);
  if (direct.length === 1) return direct[0].id;
  if (direct.length > 1) return null;
  const blockId = names[0]?.blockId;
  return choices.find((c) => c.kind === 'heading' && c.nodeId === blockId)?.id || null;
}

/**
 * Link the text at `blockId` from `start` to `end` to a bookmark. With a
 * collapsed range, `insertText(text)` types the link text at the caret first
 * (the engine's own insert refuses to create a link in some contexts).
 */
export async function linkToPlace(api, { blockId, start, end, story, text = '', insertText = null, onInserted = () => {}, beforeWrite = () => {} }, anchor) {
  const unavailable = placeLinkStoryError(story);
  if (unavailable) throw new Error(unavailable);
  if (!blockId) throw new Error('Place the cursor in the text first');
  let range = { start, end };
  if (!(end > start)) {
    if (!text || !insertText) throw new Error('Enter the link text');
    beforeWrite();
    if (!(await insertText(text))) throw new Error('The link text could not be typed here');
    range = { start, end: start + text.length };
    // The label now exists even if wrapping it fails. Let a retry target that
    // range instead of inserting another copy of the label.
    onInserted(range);
  }
  beforeWrite();
  return ok(await api.hyperlinks.wrap({ target: { kind: 'text', blockId, range }, link: { destination: { anchor } } }), 'Link');
}
