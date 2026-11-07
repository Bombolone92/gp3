/**
 * List options beyond on/off: the bullet glyph or number format, restarting
 * the count, and continuing an earlier list. The engine's `lists` API works
 * on list items by paragraph id; a paragraph that is not in a list yet is
 * seeded first so a style pick from plain text still lands.
 */

export const BULLET_PRESETS = [
  { id: 'disc', label: 'Disc', marker: '•', lvlText: '•' },
  { id: 'circle', label: 'Circle', marker: '◦', lvlText: 'o' },
  { id: 'square', label: 'Square', marker: '▪', lvlText: '▪' },
  { id: 'dash', label: 'Dash', marker: '–', lvlText: '-' },
];

export const NUMBER_PRESETS = [
  { id: 'decimal', label: '1. 2. 3.', numFmt: 'decimal', lvlText: '%1.' },
  { id: 'decimalParenthesis', label: '1) 2) 3)', numFmt: 'decimal', lvlText: '%1)' },
  { id: 'lowerLetter', label: 'a. b. c.', numFmt: 'lowerLetter', lvlText: '%1.' },
  { id: 'lowerLetterParenthesis', label: 'a) b) c)', numFmt: 'lowerLetter', lvlText: '%1)' },
  { id: 'upperLetter', label: 'A. B. C.', numFmt: 'upperLetter', lvlText: '%1.' },
  { id: 'upperLetterParenthesis', label: 'A) B) C)', numFmt: 'upperLetter', lvlText: '%1)' },
  { id: 'lowerRoman', label: 'i. ii. iii.', numFmt: 'lowerRoman', lvlText: '%1.' },
  { id: 'upperRoman', label: 'I. II. III.', numFmt: 'upperRoman', lvlText: '%1.' },
];

const BULLET_ALIASES = { '•': 'disc', '\uF0B7': 'disc', 'o': 'circle', '○': 'circle', '◦': 'circle', '▪': 'square', '■': 'square', '\uF0A7': 'square', '-': 'dash', '–': 'dash', '—': 'dash' };

/**
 * The preset a list state (`numFmt`, `lvlText`) corresponds to, or null when
 * it is a custom format. Bullets match by glyph, including the Symbol-font
 * private-use characters existing documents use for common bullets.
 */
export function presetFor(state) {
  if (!state?.isListItem) return null;
  if (state.numFmt === 'bullet') return BULLET_ALIASES[String(state.lvlText ?? '').trim()] ?? (state.lvlText ? null : 'disc');
  const text = String(state.lvlText || '').replace(/%\d/g, '%1');
  return NUMBER_PRESETS.find((p) => p.numFmt === state.numFmt && p.lvlText === text)?.id || null;
}

const paragraph = (nodeId) => ({ kind: 'block', nodeType: 'paragraph', nodeId });
const listItem = (nodeId) => ({ kind: 'block', nodeType: 'listItem', nodeId });

/** The kind of list a preset makes: a bullet list, or a numbered one. */
function kindOf(presetId) {
  return BULLET_PRESETS.some((p) => p.id === presetId) ? 'bullet' : 'ordered';
}

/** The list engine supports body/header/footer stories, not notes or text boxes. */
export function listStoryError(story) {
  return story && !['body', 'headerFooterSlot', 'headerFooterPart'].includes(story.storyType)
    ? 'List formatting is not available in notes or text boxes' : null;
}

function requireListStory(story) {
  const error = listStoryError(story);
  // List addresses do not accept a story scope. Letting unsupported stories
  // fall through can resolve a repeated paragraph ID to the document body.
  if (error) throw new Error(error);
}

/** A result that changed nothing is fine; anything else that is not a success is a failure. */
export function failed(r) {
  return r == null || (r.success === false && r.failure?.code !== 'NO_OP');
}

/** Current list state for a paragraph, or null when it cannot be read. */
export async function listState(api, nodeId) {
  try {
    const s = await api.lists.getState({ target: paragraph(nodeId) });
    return s?.success === false ? null : s;
  } catch {
    return null;
  }
}

/**
 * Apply a bullet or number preset to the given paragraphs. Plain paragraphs
 * join a new list of the matching kind first. Resolves the number of
 * paragraphs touched; throws on the first failure.
 */
export async function applyListPreset(api, nodeIds, presetId, { story, beforeWrite = () => {}, onChange = () => {} } = {}) {
  requireListStory(story);
  const seed = kindOf(presetId);
  const preset = [...BULLET_PRESETS, ...NUMBER_PRESETS].find((p) => p.id === presetId);
  const done = new Set();
  // Plain paragraphs seeded in one go join one list: on their own, paragraphs in a table cell each started a list of their own, "1. 1. 1.".
  let seeded = null;
  for (const nodeId of nodeIds) {
    const state = await listState(api, nodeId);
    // An unreadable state is not a plain paragraph: seeding it could reset
    // an existing list's sequence and nesting level.
    if (state == null) throw new Error('Could not read the list settings');
    if (state && state.numId && done.has(`${state.numId}:${state.ilvl}`)) continue;
    if (state?.isListItem && state.ilvl > 0 && preset && api.lists.setLevelNumbering && api.lists.setLevelBullet) {
      // A preset picked on a nested item changes that level of its list, not the first; the engine's preset always formats the first.
      beforeWrite();
      const level = state.ilvl, target = listItem(nodeId);
      const r = seed === 'bullet'
        ? await api.lists.setLevelBullet({ target, level, markerText: preset.lvlText })
        : await api.lists.setLevelNumbering({ target, level, numFmt: preset.numFmt, lvlText: preset.lvlText.replace('%1', `%${level + 1}`) });
      if (failed(r)) throw new Error(r?.failure?.message || 'Could not change the list style');
      if (r.success !== false) onChange();
      done.add(`${state.numId}:${level}`);
      continue;
    }
    if (!state?.isListItem) {
      beforeWrite();
      const r = await api.lists.apply(seeded ? { target: paragraph(nodeId), seed, reuseNumId: seeded, ilvl: 0 } : { target: paragraph(nodeId), seed });
      if (failed(r)) throw new Error(r?.failure?.message || 'Could not start a list');
      if (r.success !== false) onChange();
      if (!seeded) seeded = (await listState(api, nodeId))?.numId || null;
    } else if (state.seed !== seed && typeof api.lists.setType === 'function') {
      // A preset changes the level the item sits on and no other, but the
      // kind belongs to the whole list: a numbered list given a bullet would
      // keep numbering every level below it, so an item indented under it
      // still came out 'a.', and a bullet list given numbers still nested
      // '○'. Changing kind converts the list, marker sequence and all.
      beforeWrite();
      const r = await api.lists.setType({ target: listItem(nodeId), kind: seed });
      if (failed(r)) throw new Error(r?.failure?.message || 'Could not change the list kind');
      if (r.success !== false) onChange();
    }
    beforeWrite();
    const r = await api.lists.applyPreset({ target: listItem(nodeId), preset: presetId });
    if (failed(r)) throw new Error(r?.failure?.message || 'Could not change the list style');
    if (r.success !== false) onChange();
    const after = await listState(api, nodeId);
    if (after?.numId) done.add(`${after.numId}:${after.ilvl}`);
  }
  return nodeIds.length;
}

/**
 * The rest of the list this paragraph is in, in document order. The engine
 * continues one item, which leaves the items under it behind as a list of
 * their own, counting again from the start; they come along with it.
 * Empty when the list cannot be read, which leaves the one item to continue
 * on its own, as it did before.
 */
async function itemsBelow(api, nodeId) {
  let items = null;
  try { items = (await api.lists.list?.({}))?.items; } catch { return []; }
  if (!Array.isArray(items)) return [];
  const at = items.findIndex((item) => item?.address?.nodeId === nodeId);
  if (at < 0) return [];
  const anchor = items[at], depth = anchor.level ?? 0;
  const below = [];
  for (const item of items.slice(at + 1)) {
    if (!item?.address?.nodeId) break;
    const level = item.level ?? 0;
    // A list is one run of items, and an item shallower than this one ends
    // the part of the list it heads. Another list at this depth or above is
    // where this one stops; one nested deeper under an item (documents often give
    // bulleted sub-points a numbering of their own) is passed over and left
    // as it is, with the rest of this list carrying on below it.
    if (item.listId !== anchor.listId ? level <= depth : level < depth) break;
    if (item.listId === anchor.listId) below.push({ nodeId: item.address.nodeId, level });
  }
  return below;
}

/**
 * Bring these items into the list that `nodeId` is now in, each at its own
 * level, so a whole run of items follows the first across. The engine's own
 * continue puts every item it moves on the first level, which would flatten
 * the sub-points under a restarted or continued item.
 */
async function bringAlong(api, nodeId, below, { beforeWrite, onChange, failure }) {
  if (!below.length) return;
  const state = await listState(api, nodeId);
  for (const item of below) {
    beforeWrite();
    const r = state?.numId
      ? await api.lists.apply({ target: paragraph(item.nodeId), seed: state.seed, reuseNumId: state.numId, ilvl: item.level })
      : await api.lists.continue({ target: paragraph(item.nodeId) });
    if (failed(r)) throw new Error(failure(r));
    if (r.success !== false) onChange();
  }
}

/** Start counting again at `startAt` from this paragraph on. */
export async function restartList(api, nodeId, startAt = 1, { story, beforeWrite = () => {}, onChange = () => {} } = {}) {
  requireListStory(story);
  // Read before the restart: it takes the item into a list of its own and
  // leaves the items under it counting in the old one, so "1. 2. 3." came
  // out "1. 2." above the caret and "1. 3." below it. They come across after.
  const below = await itemsBelow(api, nodeId);
  beforeWrite();
  const r = await api.lists.restart({ target: paragraph(nodeId), startAt });
  if (failed(r)) throw new Error(r?.failure?.message || 'Could not restart the numbering');
  if (r.success !== false) onChange();
  await bringAlong(api, nodeId, below, { beforeWrite, onChange, failure: (f) => f?.failure?.message || 'Could not restart the numbering' });
}

/**
 * The nearest earlier list of the same kind as this item's, other than its
 * own: `{ numId }` to continue, null when there is none. The engine's own
 * continue joins whatever list stands right above, a bullet list included,
 * which would turn the numbers into bullets.
 */
async function previousSameKind(api, nodeId) {
  let items = null;
  try { items = (await api.lists.list?.({}))?.items; } catch { return null; }
  if (!Array.isArray(items)) return null;
  const at = items.findIndex((item) => item?.address?.nodeId === nodeId);
  if (at < 0) return null;
  const own = items[at];
  let otherKind = false;
  for (let i = at - 1; i >= 0; i--) {
    const item = items[i];
    if (item.listId === own.listId || !item.address?.nodeId) continue;
    if (item.kind !== own.kind) { otherKind = true; continue; }
    const state = await listState(api, item.address.nodeId);
    if (state?.numId) return { numId: state.numId, level: own.level ?? 0 };
  }
  // Only lists of another kind stand earlier: the engine's own continue would join one of those.
  return otherKind ? { otherKind } : null;
}

/** Pick up the numbering of the previous list of the same kind. */
export async function continueList(api, nodeId, { story, beforeWrite = () => {}, onChange = () => {} } = {}) {
  requireListStory(story);
  const failure = (r) => r?.failure?.code === 'TARGET_NOT_FOUND' ? 'There is no earlier list to continue' : (r?.failure?.message || 'Could not continue the list');
  const below = await itemsBelow(api, nodeId);
  const previous = await previousSameKind(api, nodeId);
  if (previous?.otherKind) throw new Error('There is no earlier list of this kind to continue');
  const state = previous ? await listState(api, nodeId) : null;
  beforeWrite();
  // The same kind of list earlier in the document is the one to carry on, whatever stands in between.
  const r = previous && state?.seed
    ? await api.lists.apply({ target: paragraph(nodeId), seed: state.seed, reuseNumId: previous.numId, ilvl: previous.level })
    : await api.lists.continue({ target: paragraph(nodeId) });
  if (failed(r)) throw new Error(failure(r));
  if (r.success !== false) onChange();
  await bringAlong(api, nodeId, below, { beforeWrite, onChange, failure });
}

