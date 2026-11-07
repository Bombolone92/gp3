/**
 * Candidate tags: freeform labels on anyone, in any stage or status.
 *
 * Tags used to exist only inside `candidate.pool`, so an active candidate
 * could not be labelled at all. They live on the candidate now; a pool
 * member's old tags are read as their tags (see `candidateTags`) and
 * consolidated the first time anything writes them, so nothing has to be
 * migrated up front.
 */

export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 30;

/** Case-insensitive identity: "Senior" and "senior" are one tag. */
export const tagKey = (tag) => String(tag ?? '').trim().toLowerCase();

/** Clean a tag list: trimmed, non-empty, deduped, capped, order kept. */
export function normalizeTags(tags) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH);
    const key = tagKey(tag);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * The tags on a candidate, including the ones a talent-pool entry carried
 * before tags moved onto the record itself.
 */
export function candidateTags(candidate) {
  const own = candidate?.tags;
  const pooled = candidate?.pool?.tags;
  if (!Array.isArray(pooled) || pooled.length === 0) return normalizeTags(own);
  return normalizeTags([...(Array.isArray(own) ? own : []), ...pooled]);
}

/** Split a comma-separated entry into tags. */
export function parseTags(text) {
  return normalizeTags(String(text ?? '').split(','));
}

/**
 * Every tag in use with how many candidates carry it, most used first
 * then alphabetical — the vocabulary a filter lists and typeahead offers.
 */
export function tagCounts(candidates) {
  const counts = new Map();
  for (const candidate of candidates ?? []) {
    for (const tag of candidateTags(candidate)) {
      const key = tagKey(tag);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Does this candidate carry the tag? Case-insensitive, '' matches all. */
export function hasTag(candidate, tag) {
  const key = tagKey(tag);
  if (!key) return true;
  return candidateTags(candidate).some((t) => tagKey(t) === key);
}
