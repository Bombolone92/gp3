/**
 * Who matches what is typed after an @ in the composer. Names and usernames
 * are read the way search reads them (lowercase, accents and other marks
 * stripped, see shared/search.js), so "@jose" finds José and "@muller"
 * Müller; the query is typed in ASCII, the mention pattern allows nothing
 * else. Those whose username, or a word of their name, begins with the
 * query come first, then those whose name merely contains it, each group in
 * name order; at most `limit` of them. What is inserted on a pick is the
 * plain username, untouched by any of this.
 */
import { normalize } from '../shared/search.js';

export function matchMembers(members, query, limit = 8) {
  const q = normalize(query);
  const rank = (m) => {
    if (!q) return 1;
    const user = normalize(m.username);
    const name = normalize(m.name);
    if (user.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q))) return 0;
    return name.includes(q) ? 1 : -1;
  };
  return members
    .map((m) => ({ m, r: rank(m) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || String(a.m.name || '').localeCompare(String(b.m.name || '')))
    .slice(0, limit)
    .map((x) => x.m);
}
