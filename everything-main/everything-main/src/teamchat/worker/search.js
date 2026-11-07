/**
 * The search index inside a worker. See src/shared/search.js for the layout;
 * this file is the part that touches storage: logging postings when a
 * message is posted or edited, folding the log into the month shards,
 * answering a query, and the resumable pass that indexes a workspace's
 * existing history.
 *
 * Cost, for the owner who pays for it. The store bills a write by the size
 * of the document it lands in, so the shape here keeps written documents
 * small and writes them rarely:
 *
 *   - Posting a message is one counter increment and one append to the
 *     current log segment, a document of at most SEARCH_FOLD_EVERY entries.
 *   - Every SEARCH_FOLD_EVERY-th message folds one completed segment into
 *     the shards: each shard touched is written once for the whole segment,
 *     and a shard holds one month, not the workspace's history.
 *   - A query reads the meta document, the unfolded log segments (and, on
 *     a workspace not yet rebuilt, the old index's shards), and one shard
 *     per query word from the newest month back, a couple of months per
 *     hop, then only the blocks holding the messages it is about to return;
 *     the hops per call are capped and a cursor carries the rest.
 *
 * Failures are counted in the meta document (`failed`) and reported with
 * every query, so an index that is quietly missing writes is visible.
 */
import { KEYS, blockIndexOf, mergeBlock, parentOfThread, threadConvId } from '../src/shared/blocks.js';
import {
  SEARCH_SHARDS, SEARCH_POSTINGS_PER_TOKEN, SEARCH_QUERY_TOKENS, SEARCH_PAGE, SEARCH_VERSION, SEARCH_FOLD_EVERY, SEARCH_LOG_TAIL,
  TOKEN_FILE, TOKEN_LINK, authorToken, scopedToken, legacyTerm, bucketOf, isBucket,
  indexTokens, isStopword, shardOf, encodePosting, decodePosting, matchesWords, hasLink,
} from '../src/shared/search.js';
import { kv, getMany } from './lib.js';

/** Block reads one hop of a search call may spend fetching candidate messages. */
const QUERY_BLOCKS = 12;
/** Storage hops one search call may spend after the meta document: month reads and block reads together. */
const QUERY_HOPS = 4;
/** Months whose shards one hop reads. */
const MONTHS_PER_HOP = 2;
/** Blocks one backfill call walks before handing back a cursor. */
const REINDEX_BLOCKS = 16;
/**
 * How many conversations one walk lists: the list goes back and forth with
 * the client between steps, so it is bounded; a thread found past the bound
 * is counted as skipped rather than dropped without a word.
 */
export const REINDEX_MAX_CONVS = 5000;
/** Months of the old index one backfill call drops before handing back a cursor. */
const REINDEX_DROP_MONTHS = 2;
/** Conversations with nothing in them one backfill call passes over before handing back a cursor (see counterReader). */
const REINDEX_SKIP_CONVS = 120;

/**
 * The message counters of a list of conversations, for a walk that reaches
 * them in order: `at(i)` answers the counter of `convs[i]`, read a dozen
 * ahead at a time (see getMany) the first time the walk comes to one not
 * yet read. The list may grow behind the walk (threads found on the way).
 * Read one at a time as each was reached, as they used to be, a walk spent
 * a round trip to the store on every conversation it passed over for
 * having nothing in it, and a direct message opened and never written in
 * is such a conversation, which a large workspace holds by the hundred:
 * one request of the export, or one step of the search index's rebuild,
 * ran to hundreds of round trips in a row, past what the platform lets a
 * request run, and neither got past the first page of the workspace.
 */
export function counterReader(convs) {
  const seqs = new Map();
  return async (i) => {
    const conv = convs[i];
    if (!seqs.has(conv)) {
      const ahead = [...new Set(convs.slice(i, i + 12).filter((c) => !seqs.has(c)))];
      const read = await getMany(ahead.map((c) => KEYS.seq(c)));
      ahead.forEach((c, j) => seqs.set(c, Number(read[j]) || 0));
    }
    return seqs.get(conv);
  };
}
/** Past this a shard is trimmed harder than the per-token cap. */
const SHARD_SOFT_BYTES = 300 * 1024;
/** Completed log segments one trigger folds at most; the rest wait for the next. */
const FOLD_SEGMENTS = 3;
/** How cursors named the index from before month buckets when it was read as the last month; still accepted. */
const LEGACY = 'legacy';

/* ------------------------------------------------------------------------ */
/* The meta document                                                         */
/* ------------------------------------------------------------------------ */

const metaKey = (wsId) => KEYS.searchMeta(wsId);

/** `{ c, folded, failed, months }`; every field may be missing. */
export async function searchMeta(wsId) {
  const m = await kv().get(metaKey(wsId));
  return m && typeof m === 'object' ? m : {};
}

const segmentOf = (c) => Math.floor((c - 1) / SEARCH_FOLD_EVERY);
/**
 * The last segment folded. A fold only ever reaches two segments behind the
 * one being written, so a pointer at or past segment `s` is not a state the
 * index can be in: the counter was reset under it (a rebuild's first step
 * dropped the meta document while a fold was writing `folded` back into the
 * empty one). It is read as nothing folded, so the segments are read and,
 * in time, folded over; a posting folded twice is deduped when read.
 */
function foldedOf(meta, s = Infinity) {
  const f = Number.isInteger(meta?.folded) ? meta.folded : -1;
  return f >= s ? -1 : f;
}
/** Months with postings, oldest first. */
const monthsOf = (meta) => Object.keys(meta?.months || {}).filter(isBucket).sort();

/** Segments a query has to read: what was posted since the last fold, bounded. */
function unfoldedSegments(meta) {
  const c = Number(meta?.c) || 0;
  if (!c) return [];
  const s = segmentOf(c);
  const from = Math.max(foldedOf(meta, s) + 1, s - SEARCH_LOG_TAIL + 1);
  const out = [];
  for (let k = from; k <= s; k++) out.push(k);
  return out;
}

/** Count failures where an admin can see them. Never throws. */
async function noteFailure(wsId, n = 1) {
  if (n > 0) await kv().incr(metaKey(wsId), { failed: n }).catch(() => {});
}

async function delMany(keys) {
  for (let i = 0; i < keys.length; i += 12) {
    await Promise.all(keys.slice(i, i + 12).map((k) => kv().del(k).catch(() => {})));
  }
}

/* ------------------------------------------------------------------------ */
/* Writing                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Group `tokens` of one message into { shard: { token: [posting] } }. Own
 * properties only: the word "constructor" is a token like any other, not
 * Object.prototype's function.
 */
export function groupPostings(groups, tokens, posting) {
  for (const t of tokens) {
    const n = shardOf(t);
    const g = groups.get(n) || (groups.set(n, {}), groups.get(n));
    if (!Object.hasOwn(g, t)) g[t] = [];
    g[t].push(posting);
  }
  return groups;
}

/** Group index entries `{ p: posting, t: [tokens] }` by month, then shard, then token. */
function groupEntries(entries) {
  const months = new Map();
  for (const e of entries) {
    if (!e || typeof e.p !== 'string' || !Array.isArray(e.t)) continue;
    const dec = decodePosting(e.p);
    if (!dec) continue;
    const b = bucketOf(dec.ts);
    const shards = months.get(b) || (months.set(b, new Map()), months.get(b));
    groupPostings(shards, e.t.filter((t) => typeof t === 'string'), e.p);
  }
  return months;
}

/**
 * Append entries to the shards of their months, a dozen writes at a time.
 * A month not yet in the meta document is noted there first, so a query
 * knows to read it as soon as its postings land. Returns how many writes
 * failed; never throws.
 */
async function writeEntries(wsId, entries, known = null) {
  const months = groupEntries(entries);
  if (!months.size) return 0;
  let failed = 0;
  const fresh = [...months.keys()].filter((b) => !known || !Object.hasOwn(known, b));
  if (fresh.length) {
    await kv().update(metaKey(wsId), Object.fromEntries(fresh.map((b) => [`months.${b}`, 1]))).catch(() => { failed++; });
  }
  const writes = [];
  for (const [b, shards] of months) for (const [n, map] of shards) writes.push([KEYS.searchBucket(wsId, b, n), map]);
  for (let i = 0; i < writes.length; i += 12) {
    await Promise.all(writes.slice(i, i + 12).map(([k, map]) => appendPostings(k, map).catch(() => { failed++; })));
  }
  if (failed) await noteFailure(wsId, failed);
  return failed;
}

/**
 * Append postings to a shard. kv.add appends to each token's array in one
 * atomic write and, when it hands the document back, over-long lists are
 * trimmed to the newest entries. A store that refuses add on a missing key,
 * or a document that has hit the value limit, falls back to a read, trim,
 * and set.
 */
export async function appendPostings(key, map) {
  let doc = null;
  try {
    doc = await kv().add(key, map);
  } catch {
    doc = null;
    const cur = (await kv().get(key)) || {};
    for (const [t, list] of Object.entries(map)) {
      const have = Object.hasOwn(cur, t) && Array.isArray(cur[t]) ? cur[t] : [];
      cur[t] = have.concat(list);
    }
    await kv().set(key, trimShard(cur, true));
    return;
  }
  if (!doc || typeof doc !== 'object') return;
  const cap = shardCap(doc);
  const over = {};
  for (const t of Object.keys(map)) {
    if (Object.hasOwn(doc, t) && Array.isArray(doc[t]) && doc[t].length > cap) over[t] = doc[t].slice(-cap);
  }
  if (Object.keys(over).length) await kv().update(key, over).catch(() => {});
}

function shardCap(doc) {
  const c = Number(doc?._cap);
  return Number.isInteger(c) && c > 0 ? c : SEARCH_POSTINGS_PER_TOKEN;
}

/**
 * Keep every list at the shard's cap. When the whole document is still too
 * large (`hard`), the cap is halved and remembered in `_cap`, so a shard that
 * collects an unusual number of distinct words keeps working at the cost of
 * shorter memories for each. Still too large at the smallest cap, the shard
 * holds more distinct words than one document takes, each with a handful of
 * postings that no cap shortens (a month of long messages in many words:
 * some nine thousand words, posted once each, in one shard of sixty-four),
 * and the words whose newest posting is oldest go, until the rest fit. Left
 * as it was, as it used to be, the store refused the document whole, this
 * write and every later one into the shard failed the same way, and the
 * postings for a sixty-fourth of the words were lost for the rest of the
 * month, the writes counted as failed and nothing more.
 */
function trimShard(doc, hard = false) {
  let cap = shardCap(doc);
  const apply = () => {
    for (const t of Object.keys(doc)) {
      if (t === '_cap') continue;
      if (!Array.isArray(doc[t])) delete doc[t];
      else if (doc[t].length > cap) doc[t] = doc[t].slice(-cap);
    }
  };
  apply();
  if (hard) {
    while (JSON.stringify(doc).length > SHARD_SOFT_BYTES && cap > 8) {
      cap = Math.max(8, Math.floor(cap / 2));
      doc._cap = cap;
      apply();
    }
    if (JSON.stringify(doc).length > SHARD_SOFT_BYTES) dropOldestWords(doc);
  }
  return doc;
}

/**
 * Take words off a shard, the one whose newest posting is oldest first,
 * until the document is within its bound (see trimShard). The size is kept
 * as a running count of what each word's entry takes in the JSON, since
 * measuring the whole document again for every word taken off would be
 * quadratic in the thousands of them this runs over.
 */
function dropOldestWords(doc) {
  const newest = new Map();
  for (const [t, list] of Object.entries(doc)) {
    if (t === '_cap' || !Array.isArray(list)) continue;
    newest.set(t, Math.max(0, ...list.map((p) => decodePosting(p)?.ts || 0)));
  }
  const words = [...newest.keys()].sort((a, b) => newest.get(a) - newest.get(b));
  let size = JSON.stringify(doc).length;
  for (const t of words) {
    if (size <= SHARD_SOFT_BYTES) break;
    size -= JSON.stringify(t).length + 1 + JSON.stringify(doc[t]).length + 1;
    delete doc[t];
  }
}

/* ---- the log ------------------------------------------------------------ */

/**
 * Queue one message's tokens: a counter increment and one small append to
 * the current log segment. The first message of a segment also creates the
 * next segment ahead of time (so appends there never fall back to a
 * read-modify-write) and folds the segment completed two segments ago: the
 * one just completed may still have an append in flight.
 */
async function enqueue(wsId, tokens, posting) {
  const entry = { p: posting, t: tokens };
  let meta = null;
  try {
    meta = await kv().incr(metaKey(wsId), { c: 1 });
  } catch {
    meta = null;
  }
  if (!meta || typeof meta !== 'object' || !Number(meta.c)) {
    // A store that does not hand the document back, or has no meta yet.
    meta = await searchMeta(wsId);
    if (!Number(meta.c)) {
      meta = { ...meta, c: 1, folded: foldedOf(meta), failed: Number(meta.failed) || 0, months: meta.months || {} };
      await kv().set(metaKey(wsId), meta).catch(() => {});
    }
  }
  const c = Number(meta.c) || 0;
  if (!c) {
    // Nothing will count for us here: the shards get this message directly.
    await writeEntries(wsId, [entry], meta.months || null);
    return;
  }
  const s = segmentOf(c);
  if (foldedOf(meta) !== foldedOf(meta, s)) {
    // The pointer is ahead of the counter (see foldedOf): folding starts over.
    await kv().update(metaKey(wsId), { folded: -1 }).catch(() => {});
    meta = { ...meta, folded: -1 };
  }
  try {
    await appendLog(KEYS.searchLog(wsId, s), entry);
  } catch {
    // The entry is lost (the message itself is stored); count it where an
    // admin can see it, like a shard write that failed.
    await noteFailure(wsId);
    return;
  }
  if ((c - 1) % SEARCH_FOLD_EVERY !== 0) return;
  await ensureLog(KEYS.searchLog(wsId, s + 1));
  if (s >= 2) await foldSegments(wsId, meta, s - 2);
}

async function appendLog(key, entry) {
  try {
    await kv().add(key, { p: [entry] });
  } catch {
    const cur = await kv().get(key);
    const p = Array.isArray(cur?.p) ? cur.p.slice() : [];
    p.push(entry);
    await kv().set(key, { p });
  }
}

/** Create an empty log segment if it does not exist yet. Best effort; never throws. */
async function ensureLog(key) {
  try {
    if (!(await kv().get(key))) await kv().set(key, { p: [] });
  } catch {
    /* the append path has its own fallback */
  }
}

/**
 * Fold completed log segments into the month shards, oldest first, up to
 * `upTo`. `meta.folded` is the last segment folded and always advances: a
 * shard write that failed is counted, not retried, so a shard that is stuck
 * cannot make every later fold write the same postings again. A segment is
 * deleted once folded; a query reads the ones that are not yet.
 */
async function foldSegments(wsId, meta, upTo) {
  const from = foldedOf(meta) + 1;
  const to = Math.min(upTo, from + FOLD_SEGMENTS - 1);
  let known = meta.months || {};
  for (let k = from; k <= to; k++) {
    const key = KEYS.searchLog(wsId, k);
    const log = await kv().get(key);
    const entries = Array.isArray(log?.p) ? log.p : [];
    if (entries.length) {
      await writeEntries(wsId, entries, known);
      known = null; // writeEntries noted the months; a second note is harmless
    }
    await kv().update(metaKey(wsId), { folded: k });
    await kv().del(key).catch(() => {});
  }
}

/* ---- entry points -------------------------------------------------------- */

/** Index one freshly posted message. Best effort; the message is already stored. */
export async function indexMessage(wsId, conv, { s, t, ts, a, u }) {
  const tokens = indexTokens(t, { attachments: a?.length || 0, author: u, conv });
  if (!tokens.length) return;
  await enqueue(wsId, tokens, encodePosting(conv, s, ts));
}

/** After an edit, index only the words that are new. */
export async function indexEdit(wsId, conv, { s, ts, a }, oldText, newText) {
  const before = new Set(indexTokens(oldText, { attachments: a?.length || 0, conv }));
  const tokens = indexTokens(newText, { attachments: a?.length || 0, conv }).filter((x) => !before.has(x));
  if (!tokens.length) return;
  await enqueue(wsId, tokens, encodePosting(conv, s, ts));
}

/**
 * One index entry for a stored message (mergeBlock shape), or null when
 * there is nothing to index. Only what a person or an app posted: a system
 * line is nobody's words, and a reminder's line in a member's own space is
 * a note the worker wrote for them, which the delivery does not index
 * either, so a rebuild (or a move) does not make it findable where the live
 * index never did.
 */
function entryFor(conv, m) {
  if (!m || (m.kind && m.kind !== 'msg') || m.deleted) return null;
  const tokens = indexTokens(m.text, { attachments: (m.attachments || []).length, author: m.user, conv });
  return tokens.length ? { p: encodePosting(conv, m.seq, m.ts), t: tokens } : null;
}

/**
 * Index stored messages straight into their month shards, skipping the log:
 * for history arriving in bulk (an import, the backfill), where one call
 * carries many messages already. `list` is [{ conv, message }] with messages
 * in mergeBlock shape. Best effort; never throws.
 */
export async function indexBatch(wsId, list) {
  const entries = [];
  for (const { conv, message } of list) {
    const e = entryFor(conv, message);
    if (e) entries.push(e);
  }
  if (entries.length) await writeEntries(wsId, entries, null);
}

/**
 * Index whole conversations held in memory (the sample workspace): every
 * shard is written once with set, since nothing exists yet.
 */
export async function writeIndexFor(wsId, convs) {
  const entries = [];
  for (const { id, messages } of convs) {
    for (const m of messages) {
      const e = entryFor(id, m);
      if (e) entries.push(e);
    }
  }
  const months = groupEntries(entries);
  const writes = [];
  for (const [b, shards] of months) for (const [n, doc] of shards) writes.push([KEYS.searchBucket(wsId, b, n), trimShard(doc)]);
  for (let i = 0; i < writes.length; i += 12) {
    await Promise.all(writes.slice(i, i + 12).map(([k, doc]) => kv().set(k, doc)));
  }
  await kv().set(metaKey(wsId), { c: 0, folded: -1, failed: 0, months: Object.fromEntries([...months.keys()].map((b) => [b, 1])) });
}

/**
 * Every key the index of a workspace may hold, given its meta document.
 * `legacy`: the shards of the layout before month buckets, which an index
 * built on the current layout cannot have (nothing has written one since;
 * the rebuild that brought an index to this layout took them down).
 */
function indexKeys(wsId, meta, { months = true, meta: withMeta = true, legacy = true } = {}) {
  const keys = [];
  if (legacy) for (let n = 0; n < SEARCH_SHARDS; n++) keys.push(KEYS.searchShard(wsId, n));
  if (months) for (const b of monthsOf(meta)) for (let n = 0; n < SEARCH_SHARDS; n++) keys.push(KEYS.searchBucket(wsId, b, n));
  const c = Number(meta?.c) || 0;
  const s = segmentOf(Math.max(1, c));
  // Unfolded segments plus the one created ahead; a long-stuck fold is bounded here too.
  for (let k = Math.max(0, foldedOf(meta, s) + 1, s - 200); k <= s + 1; k++) keys.push(KEYS.searchLog(wsId, k));
  if (withMeta) keys.push(metaKey(wsId));
  return keys;
}

export async function deleteIndex(wsId) {
  await delMany([...indexKeys(wsId, await searchMeta(wsId)), KEYS.searchWalk(wsId)]);
}

export const indexStamp = () => ({ v: SEARCH_VERSION, built: Date.now() });

/* ------------------------------------------------------------------------ */
/* Querying                                                                  */
/* ------------------------------------------------------------------------ */

/** Newest first; ties broken so the order is total and a cursor can resume it. */
function compareCandidates(a, b) {
  return b.ts - a.ts || (a.conv < b.conv ? -1 : a.conv > b.conv ? 1 : 0) || b.seq - a.seq;
}

/**
 * A cursor is `{posting}|{month}`: skip everything at or newer than the
 * posting, resume reading the months at that one (or, empty, read no more
 * months). A cursor from before months existed is a bare posting; one from
 * when the old index was read as the last month is taken to mean the same.
 */
function decodeCursor(raw) {
  if (!raw) return null;
  const at = String(raw).indexOf('|');
  const p = at < 0 ? String(raw) : String(raw).slice(0, at);
  const src = at < 0 ? null : String(raw).slice(at + 1);
  const after = p ? decodePosting(p) : null;
  if (p && !after) return null;
  if (src !== null && src !== '' && src !== LEGACY && !isBucket(src)) return null;
  return { after, src };
}

const encodeCursor = (at, src) => `${at ? encodePosting(at.conv, at.seq, at.ts) : ''}|${src == null ? '' : src}`;

/** Where in `sources` (newest first) a cursor resumes. */
function resumeIndex(sources, src) {
  // No month named (a bare posting, or the old index named as the last
  // month): every month is read again behind the posting, since the old
  // index's postings for a month only count once that month is read.
  if (src === null || src === LEGACY) return 0;
  if (src === '') return sources.length;
  const exact = sources.indexOf(src);
  if (exact >= 0) return exact;
  // The month is gone (rebuilt meanwhile) or ruled out: the first at or before it.
  const at = sources.findIndex((s) => s <= src);
  return at < 0 ? sources.length : at;
}

/**
 * search(wsId, params, canRead, opts)
 *   params: { words, has, in, from, before, after, cursor }
 *   canRead(conv): may the caller read this conversation?
 *   opts.meta: the meta document, when the caller already read it
 *   opts.legacy: read the index from before month buckets too (a workspace
 *                not yet rebuilt on this layout)
 * Returns { results, hasMore, cursor, terms, failed } where `terms` is what
 * the index was asked for (empty when the query had nothing indexable) and
 * `failed` how many index writes this workspace has lost.
 *
 * Candidates are examined newest first and a cursor resumes behind the last
 * one examined, so a candidate may only enter the pool once no month still
 * unread could hold a newer one. A month's shards hold that month alone, so
 * what they yield enters as they are read, newest month first. The log and
 * the old index hold postings from any month (an edit logs its new words
 * under the message's original timestamp), so both are read first and what
 * they yield waits until the months read have reached its month, or run
 * out. Their words also count toward each month's intersection: a message
 * whose words are split between the log and a shard, or between the old
 * index and a bucket, is still found by a query for all of them.
 */
export async function search(wsId, params, canRead, { meta = null, legacy = true } = {}) {
  const words = params.words || [];
  const terms = words.filter((w) => !isStopword(w)).slice(0, SEARCH_QUERY_TOKENS);
  const scope = params.in || null;
  // Inside one conversation, the pseudo-tokens scoped to it read a list that
  // is about it alone rather than the workspace's list filtered down.
  for (const h of params.has || []) {
    const t = h === 'file' ? TOKEN_FILE : TOKEN_LINK;
    terms.push(scope ? scopedToken(t, scope) : t);
  }
  // "Everything this person sent" reads their own posting list; with words
  // to intersect, the author is checked on the message instead, so indexes
  // built before authors were indexed still answer.
  if (!terms.length && params.from) terms.push(scope ? scopedToken(authorToken(params.from), scope) : authorToken(params.from));
  const m = meta || (await searchMeta(wsId));
  const failed = Number(m.failed) || 0;
  const none = () => ({ results: [], hasMore: false, cursor: null, terms, failed });
  if (!terms.length) return none();

  // The months to read, newest first, less those a date filter rules out
  // whole: a posting's month is its timestamp's, so a month entirely after
  // `before` or entirely before `after` cannot hold a hit.
  const sources = monthsOf(m)
    .filter((b) => (params.before == null || b <= bucketOf(params.before)) && (params.after == null || b >= bucketOf(params.after)))
    .reverse();
  const isSource = new Set(sources);
  const cur = decodeCursor(params.cursor);
  const after = cur?.after || null;
  let srcIdx = resumeIndex(sources, cur ? cur.src : null);

  const accept = (p) => {
    if (params.before != null && p.ts > params.before) return false;
    if (params.after != null && p.ts < params.after) return false;
    if (scope && p.conv !== scope && parentOfThread(p.conv)?.conv !== scope) return false;
    if (after && compareCandidates(p, after) <= 0) return false;
    return canRead(p.conv);
  };
  // `pool`: candidates in newest-first order, examined from `pos` on, each
  // with the index of the month it came from (-1: the log or the old index).
  // `held`: candidates from those two waiting for the months to reach them.
  // `seen` dedupes a posting that several sources hold.
  const pool = [];
  const held = [];
  const seen = new Set();
  const addKeys = (keys, src, into = pool) => {
    for (const k of keys) {
      if (seen.has(k)) continue;
      seen.add(k);
      const p = decodePosting(k);
      if (p && accept(p)) into.push({ ...p, src });
    }
  };
  const intersect = (lists) => {
    if (lists.some((l) => !l.length)) return [];
    lists.sort((a, b) => a.length - b.length);
    let keys = new Set(lists[0]);
    for (const l of lists.slice(1)) {
      const other = new Set(l);
      keys = new Set([...keys].filter((k) => other.has(k)));
      if (!keys.size) break;
    }
    return [...keys];
  };
  // What the log and the old index say about a posting, by month: which of
  // the query's terms each holds it under.
  const spanning = new Map(); // month -> Map(posting -> Set(term))
  const note = (p, t) => {
    const dec = decodePosting(p);
    if (!dec) return;
    const b = bucketOf(dec.ts);
    const byPosting = spanning.get(b) || (spanning.set(b, new Map()), spanning.get(b));
    const have = byPosting.get(p) || (byPosting.set(p, new Set()), byPosting.get(p));
    have.add(t);
  };
  /** One month's posting list per term: its shards' lists plus what the log and the old index hold for that month. */
  const listsFor = (month, byShard) => terms.map((t) => {
    const doc = byShard.get(shardOf(t));
    const list = doc && Object.hasOwn(doc, t) && Array.isArray(doc[t]) ? doc[t] : [];
    const extra = spanning.get(month);
    if (!extra) return list;
    const more = [];
    for (const [p, have] of extra) if (have.has(t)) more.push(p);
    return more.length ? list.concat(more) : list;
  });

  const logKeys = unfoldedSegments(m).map((k) => KEYS.searchLog(wsId, k));
  const legacyTerms = legacy ? [...new Set(terms.map(legacyTerm))] : [];
  const legacyShards = [...new Set(legacyTerms.map(shardOf))];
  const shards = [...new Set(terms.map(shardOf))];
  let spanRead = false;
  const results = [];
  let pos = 0;
  let hops = 0;
  while (results.length < SEARCH_PAGE && hops < QUERY_HOPS) {
    if (pos >= pool.length) {
      if (spanRead && srcIdx >= sources.length) break;
      hops++;
      // One hop: the log and the old index (the first time) and the next months' shards.
      const batch = sources.slice(srcIdx, srcIdx + MONTHS_PER_HOP);
      const reads = [];
      if (!spanRead) {
        for (const k of logKeys) reads.push({ key: k, log: true });
        for (const n of legacyShards) reads.push({ key: KEYS.searchShard(wsId, n), legacy: n });
      }
      batch.forEach((b, j) => {
        for (const n of shards) reads.push({ key: KEYS.searchBucket(wsId, b, n), src: srcIdx + j, n });
      });
      const docs = await getMany(reads.map((r) => r.key));
      if (!spanRead) {
        spanRead = true;
        reads.forEach((r, i) => {
          if (r.log) {
            for (const e of docs[i]?.p || []) {
              if (!e || typeof e.p !== 'string' || !Array.isArray(e.t)) continue;
              for (const t of terms) if (e.t.includes(t)) note(e.p, t);
            }
          } else if (r.legacy != null) {
            const doc = docs[i];
            if (!doc || typeof doc !== 'object') return;
            for (const t of terms) {
              const lt = legacyTerm(t);
              if (shardOf(lt) !== r.legacy || !Object.hasOwn(doc, lt) || !Array.isArray(doc[lt])) continue;
              for (const p of doc[lt]) note(p, t);
            }
          }
        });
        // A posting these alone account for, in a month with no shards to
        // read, is a candidate in its own right; one in a month that has
        // shards is settled when that month is read.
        for (const [b, byPosting] of spanning) {
          if (isSource.has(b)) continue;
          const keys = [];
          for (const [p, have] of byPosting) if (terms.every((t) => have.has(t))) keys.push(p);
          addKeys(keys, -1, held);
        }
      }
      batch.forEach((b, j) => {
        const byShard = new Map();
        reads.forEach((r, i) => { if (r.src === srcIdx + j) byShard.set(r.n, docs[i] || {}); });
        addKeys(intersect(listsFor(b, byShard)), srcIdx + j);
      });
      srcIdx += batch.length;
      // What waited for a month at or before the oldest read so far may enter now; once the months run out, all of it.
      const frontier = srcIdx < sources.length ? batch[batch.length - 1] : null;
      for (let i = held.length - 1; i >= 0; i--) {
        if (frontier === null || bucketOf(held[i].ts) >= frontier) pool.push(held.splice(i, 1)[0]);
      }
      // Everything new is older than everything examined: sorting the tail keeps the order total.
      const tail = pool.splice(pos).sort(compareCandidates);
      pool.push(...tail);
      if (pos >= pool.length) continue;
    }
    hops++;
    // Fetch the messages themselves, a bounded number of blocks per hop, and
    // keep only the ones that still say what the index remembers.
    const blocks = new Map(); // key -> [candidate]
    while (pos < pool.length && (blocks.size < QUERY_BLOCKS || blocks.has(blockKey(pool[pos])))) {
      const c = pool[pos++];
      const key = blockKey(c);
      (blocks.get(key) || (blocks.set(key, []), blocks.get(key))).push(c);
    }
    const keysArr = [...blocks.keys()];
    const read = await getMany(keysArr);
    for (let b = 0; b < keysArr.length; b++) {
      const msgs = new Map(mergeBlock(read[b]).map((x) => [x.seq, x]));
      for (const c of blocks.get(keysArr[b])) {
        const msg = msgs.get(c.seq);
        // Only what was posted (see entryFor): a posting an older rebuild wrote for a reminder's line is passed over here as well.
        if (!msg || msg.deleted || msg.kind !== 'msg') continue;
        if (!matchesWords(msg.text, words)) continue;
        if (params.from && msg.user !== params.from) continue;
        if ((params.has || []).includes('file') && !msg.attachments.length) continue;
        if ((params.has || []).includes('link') && !hasLink(msg.text)) continue;
        results.push({ conv: c.conv, ...msg });
      }
    }
  }
  results.sort(compareCandidates);
  const page = results.slice(0, SEARCH_PAGE);
  // Anything fetched but not returned is examined again next page: the
  // cursor points at the last returned result, or at the last candidate
  // examined when the page came back short, and names the newest month
  // that still has candidates older than that. What is still held is older
  // than that too and comes back from the log and the old index, which the
  // next page reads again. A page that examined nothing (its hops all went
  // on months with no postings) keeps the posting it started from: dropping
  // it would let the log's hits, returned pages ago, in again.
  const overflow = results.length > SEARCH_PAGE;
  const cursorAt = overflow ? page[page.length - 1] : pos > 0 ? pool[pos - 1] : after;
  const remaining = pool.filter((c) => !cursorAt || compareCandidates(c, cursorAt) > 0);
  const hasMore = remaining.length > 0 || held.length > 0 || srcIdx < sources.length;
  let resumeAt = srcIdx;
  for (const c of remaining) if (c.src >= 0 && c.src < resumeAt) resumeAt = c.src;
  return {
    results: page,
    hasMore,
    cursor: hasMore ? encodeCursor(cursorAt, resumeAt < sources.length ? sources[resumeAt] : '') : null,
    terms,
    failed,
  };
}

const blockKey = (c) => KEYS.block(c.conv, blockIndexOf(c.seq));

/* ------------------------------------------------------------------------ */
/* Backfill                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * One step of indexing a workspace's history. `state` is null to start
 * (the old index's small keys are dropped, its counters reset, its months
 * queued for dropping, and the conversation list gathered) and otherwise
 * whatever the previous step returned. Each step drops a few months of the
 * old index or walks a bounded number of blocks, writes what it found
 * straight into the month shards, and returns the next state; the caller
 * loops until `done`. Threads are discovered as their parents are walked
 * and appended to the list. Messages posted meanwhile reach the shards
 * through the log as always; a posting written twice is harmless.
 *
 * A month stays listed in the meta document until its shards are actually
 * gone: the list is the only record of which shards exist, so a rebuild
 * abandoned midway (the dialog closed, the network gone) leaves months the
 * next rebuild still finds, drops, and does not double.
 */
export async function reindexStep(wsId, ws, memberDocs, state) {
  if (!state) {
    const meta = await searchMeta(wsId);
    const months = monthsOf(meta);
    // The old index's small keys: its log segments, and, for an index from
    // before month buckets, its sixty-four shards. Taken down whatever the
    // layout, as they used to be, every rebuild of an index built on the
    // current layout spent six round trips deleting sixty-four keys that
    // could not be there.
    await delMany(indexKeys(wsId, meta, { months: false, meta: false, legacy: !(Number(ws?.search?.v) >= SEARCH_VERSION) }));
    await kv().set(metaKey(wsId), { c: 0, folded: -1, failed: 0, months: Object.fromEntries(months.map((b) => [b, 1])) });
    const convs = new Set(Object.keys(ws.channels || {}));
    const dms = new Set();
    for (const d of memberDocs) for (const c of Object.keys(d?.dms || {})) dms.add(c);
    for (const c of dms) convs.add(c);
    // The direct messages this walk may read, kept on the worker: the list
    // of conversations travels with the client between steps, and what
    // comes back is held to the workspace's own channels and to these.
    await kv().set(KEYS.searchWalk(wsId), { dms: [...dms] });
    state = { convs: [...convs], i: 0, n: 0, messages: 0, drop: months };
  }
  if (state.drop?.length) {
    const take = state.drop.slice(0, REINDEX_DROP_MONTHS);
    const keys = [];
    for (const b of take) for (let n = 0; n < SEARCH_SHARDS; n++) keys.push(KEYS.searchBucket(wsId, b, n));
    await delMany(keys);
    // Unlisted only now that they are gone; a fold that lands a fresh posting
    // in one of them meanwhile lists it again, and the walk re-lists the rest.
    for (const b of take) await kv().remove(metaKey(wsId), `months.${b}`).catch(() => {});
    state = { ...state, drop: state.drop.slice(take.length) };
    if (state.drop.length) return { ...state, done: false };
  }
  const found = [];
  let budget = REINDEX_BLOCKS;
  // The counters a dozen ahead at a time, and so many empty conversations
  // passed over before the step hands back (see counterReader): the walk
  // goes on from where it stopped, and the client loops until `done`.
  const counterOf = counterReader(state.convs);
  let passed = 0;
  while (budget > 0 && state.i < state.convs.length && passed < REINDEX_SKIP_CONVS) {
    const conv = state.convs[state.i];
    const seq = await counterOf(state.i);
    if (!seq) {
      state.i++;
      state.n = 0;
      passed++;
      continue;
    }
    const head = blockIndexOf(seq);
    const to = Math.min(head, state.n + budget - 1);
    const keys = [];
    for (let n = state.n; n <= to; n++) keys.push(KEYS.block(conv, n));
    const blocks = await getMany(keys);
    for (const block of blocks) {
      for (const message of mergeBlock(block)) {
        if (message.replyCount > 0) {
          const t = threadConvId(conv, message.seq);
          if (!state.convs.includes(t)) {
            if (state.convs.length < REINDEX_MAX_CONVS) state.convs.push(t);
            else state.skipped = (state.skipped || 0) + 1;
          }
        }
        if (message.kind !== 'msg' || message.deleted) continue;
        found.push({ conv, message });
        state.messages++;
      }
    }
    budget -= keys.length;
    state.n = to + 1;
    if (state.n > head) {
      state.i++;
      state.n = 0;
    }
  }
  await indexBatch(wsId, found);
  const done = state.i >= state.convs.length;
  if (done) await kv().del(KEYS.searchWalk(wsId)).catch(() => {});
  return { ...state, drop: [], done };
}
