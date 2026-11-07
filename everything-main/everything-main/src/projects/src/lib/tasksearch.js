/**
 * Cross-project task matching, shared by the search dialog and the command
 * palette so the two can never disagree about what "found" means.
 *
 * Titles were the whole of it, deliberately — back when a task was mostly a
 * title. Since then descriptions became Markdown, comments became threaded,
 * checklists arrived, and attachments got names, which is to say the content
 * of the app moved into exactly the places search could not see. So the set of
 * fields is wider now; everything else about the approach is unchanged.
 *
 * Still a plain `includes()` over documents already in memory: no index, no
 * stemming, no fuzzy matching. At the scale one person's projects reach, the
 * scan is cheaper than any structure that would have to be kept current — and
 * a structure that goes stale answers questions wrongly, which is worse than
 * answering them a millisecond later.
 *
 * The palette stays on titles (`scope: 'titles'`): it is a jump-to, not a
 * research tool.
 */

/** Where a match came from, and how a result says so. */
export const MATCH_LABELS = {
  title: null,
  description: 'in the description',
  checklist: 'in a checklist item',
  comment: 'in a comment',
  attachment: 'in an attachment name',
};

/* Order matters: the first field that matches is the one a result shows, so
   this is a rough "most likely to explain the hit" order. */
const BODY_FIELDS = ['description', 'checklist', 'comment', 'attachment'];

/** Where in the text the query matched, or -1. */
export function matchAt(text, query) {
  return String(text ?? '').toLowerCase().indexOf(query);
}

function firstMatch(strings, query, field) {
  for (const text of strings) {
    const at = matchAt(text, query);
    if (at >= 0) return { field, text: String(text), at };
  }
  return null;
}

/** The strings a task carries in one field. */
function fieldText(task, field) {
  if (field === 'description') return [task.description];
  if (field === 'checklist') {
    return (Array.isArray(task.checklist) ? task.checklist : []).map((i) => i?.text);
  }
  if (field === 'comment') {
    return (Array.isArray(task.comments) ? task.comments : []).map((c) => c?.text);
  }
  if (field === 'attachment') {
    return (Array.isArray(task.attachments) ? task.attachments : []).map((a) => a?.name);
  }
  return [];
}

/**
 * The best match on one task, or null. A title match always wins — it is what
 * the row already shows — and body fields are tried in a fixed order, so the
 * same query always explains itself the same way.
 */
export function matchTask(task, query, { scope = 'all' } = {}) {
  const titleAt = matchAt(task.title, query);
  if (titleAt >= 0) return { field: 'title', text: String(task.title ?? ''), at: titleAt };
  if (scope === 'titles') return null;
  for (const field of BODY_FIELDS) {
    const found = firstMatch(fieldText(task, field), query, field);
    if (found) return found;
  }
  return null;
}

/**
 * searchTasks([{ entry, doc }], 'beta', { scope }) → [{ entry, doc, task, at, match }]
 *
 * Ranking tiers, unchanged apart from the new one for bodies: a title prefix
 * first, then a title match anywhere, then a match in the task's content.
 * Archived projects stay searchable — hiding their work would make it
 * unfindable — but rank after everything live, and the caller says so.
 */
export function searchTasks(docs, rawQuery, { scope = 'all' } = {}) {
  const query = String(rawQuery ?? '').trim().toLowerCase();
  if (!query) return [];
  const found = [];
  for (const { entry, doc } of docs) {
    for (const task of doc.tasks) {
      const match = matchTask(task, query, { scope });
      if (!match) continue;
      const tier = match.field !== 'title' ? 2 : match.at === 0 ? 0 : 1;
      found.push({
        entry,
        doc,
        task,
        match,
        // `at` stays the offset in the title for a title match (what the
        // dialog highlights) and -1 when the title is not what matched.
        at: match.field === 'title' ? match.at : -1,
        rank: (entry.archived ? 3 : 0) + tier,
      });
    }
  }
  found.sort((a, b) => a.rank - b.rank);
  return found;
}

/**
 * A window of text around a match, for a result that has to show *why* it
 * matched. Returns the excerpt, the offset of the match inside it, and
 * whether either end was cut — so the caller can mark the run without
 * counting characters itself.
 *
 * The window is deliberately lopsided: a result is one ellipsized line, so a
 * long run-up would push the highlighted words off the right edge, which is
 * the one thing the snippet exists to show.
 */
export function matchSnippet(text, at, length, { before = 14, after = 70 } = {}) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim();
  // Collapsing whitespace moves the match, so it is found again rather than
  // trusted: one pass over a short string, and it cannot drift.
  const needle = String(text ?? '').substr(at, length).replace(/\s+/g, ' ').trim();
  const found = needle ? source.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  const index = found >= 0 ? found : 0;

  const start = Math.max(0, index - before);
  const end = Math.min(source.length, index + needle.length + after);
  return {
    text: source.slice(start, end),
    at: index - start,
    length: needle.length,
    cutStart: start > 0,
    cutEnd: end < source.length,
  };
}
