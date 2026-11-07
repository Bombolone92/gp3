/**
 * Search over the local copy. Free text matches ticket subjects, the first
 * message, tags, requester and organization; `field:value` terms narrow it:
 *
 *   status:open  priority:urgent  assignee:me  assignee:none  tag:billing
 *   type:incident  via:email  requester:ana  org:acme  #123 (ticket number)
 */
import { STATUSES, PRIORITIES, TYPES, CHANNELS } from '../shared/model.js';

/** Fields a `field:value` term can narrow by; any other word with a colon is plain text. */
const FILTER_FIELDS = new Set(['status', 'priority', 'type', 'via', 'channel', 'tag', 'tags', 'assignee', 'requester', 'org', 'organization', 'group']);

export function parseQuery(q) {
  const out = { text: [], filters: [], id: null };
  const re = /(\w+):("[^"]*"|\S+)|#(\d+)|"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(q || '')))) {
    if (m[1] && FILTER_FIELDS.has(m[1].toLowerCase())) out.filters.push({ field: m[1].toLowerCase(), value: m[2].replace(/^"|"$/g, '').toLowerCase() });
    else if (m[3]) out.id = Number(m[3]);
    else {
      // "re:refund", "10:30" or a pasted "Error:" are words to find.
      const word = (m[4] || m[5] || m[0]).toLowerCase().replace(/[:;,]+$/, '');
      if (word) out.text.push(word);
    }
  }
  if (!out.id && out.text.length === 1 && /^\d+$/.test(out.text[0])) out.maybeId = Number(out.text[0]);
  return out;
}

const cache = new WeakMap();

/**
 * Lowercased searchable text of a ticket, cached per record object. It
 * includes the customer's and organization's names, so it is rebuilt when
 * either of those records changes (a rename replaces the record).
 */
function haystack(t, replica) {
  const u = replica.users.get(t.requester);
  const o = t.org ? replica.orgs.get(t.org) : null;
  const hit = cache.get(t);
  if (hit && hit.u === u && hit.o === o) return hit.s;
  const s = [t.subject, t.desc, (t.tags || []).join(' '), u?.name, u?.email, o?.name, `#${t.id}`].filter(Boolean).join('\n').toLowerCase();
  cache.set(t, { s, u, o });
  return s;
}

function filterMatch(f, t, replica, me) {
  const v = f.value;
  switch (f.field) {
    case 'status':
      if (v === 'unsolved') return ['new', 'open', 'pending', 'hold'].includes(t.status);
      return STATUSES.includes(v) ? t.status === v : t.status.startsWith(v);
    case 'priority':
      return PRIORITIES.includes(v) ? t.priority === v : (t.priority || '').startsWith(v);
    case 'type':
      return TYPES.includes(v) ? t.type === v : (t.type || '').startsWith(v);
    case 'via':
    case 'channel':
      return CHANNELS.includes(v) ? t.via === v : t.via.startsWith(v);
    case 'tag':
    case 'tags':
      return (t.tags || []).some((x) => x === v || x.startsWith(v));
    case 'assignee': {
      if (v === 'me') return t.assignee === me;
      if (v === 'none') return !t.assignee;
      const m = replica.members[t.assignee];
      return !!m && (m.name.toLowerCase().includes(v) || (m.username || '').toLowerCase().includes(v));
    }
    case 'requester': {
      const u = replica.users.get(t.requester);
      return !!u && (`${u.name} ${u.email || ''}`.toLowerCase().includes(v));
    }
    case 'org':
    case 'organization': {
      const o = t.org ? replica.orgs.get(t.org) : null;
      return !!o && o.name.toLowerCase().includes(v);
    }
    case 'group': {
      const g = (replica.cfg.groups || []).find((x) => x.id === t.group);
      return !!g && g.name.toLowerCase().includes(v);
    }
    default:
      return true;
  }
}

export function searchTickets(replica, q, { limit = 200, includeHidden = false } = {}) {
  const p = parseQuery(q);
  const me = replica.me?.uuid;
  const out = [];
  if (p.id) {
    const t = replica.tickets.get(p.id);
    return t ? [t] : [];
  }
  for (const t of replica.tickets.values()) {
    if (!includeHidden && (t.deleted || t.spam)) continue;
    if (!p.filters.every((f) => filterMatch(f, t, replica, me))) continue;
    if (p.text.length) {
      const hay = haystack(t, replica);
      if (!p.text.every((w) => hay.includes(w))) continue;
    }
    out.push(t);
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  if (p.maybeId) {
    const exact = replica.tickets.get(p.maybeId);
    if (exact && !out.includes(exact)) out.unshift(exact);
  }
  return out.slice(0, limit);
}

/** The words to find, read like a ticket search: "a phrase" stays whole. */
const wordsOf = (q) => parseQuery(q).text;
const byName = new Intl.Collator().compare;

export function searchUsers(replica, q, limit = 100) {
  const words = wordsOf(q);
  const out = [];
  for (const u of replica.users.values()) {
    const hay = `${u.name} ${u.email || ''} ${u.phone || ''} ${(u.tags || []).join(' ')}`.toLowerCase();
    if (words.every((w) => hay.includes(w))) out.push(u);
  }
  // Sorted before cutting, so the first names come first however many match.
  return out.sort((a, b) => byName(a.name, b.name)).slice(0, limit);
}

export function searchOrgs(replica, q, limit = 100) {
  const words = wordsOf(q);
  return [...replica.orgs.values()]
    .filter((o) => {
      const hay = `${o.name} ${(o.domains || []).join(' ')} ${(o.tags || []).join(' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => byName(a.name, b.name))
    .slice(0, limit);
}

export function searchArticles(replica, q, limit = 50) {
  const words = wordsOf(q);
  return [...replica.articles.values()]
    .filter((a) => {
      const hay = `${a.title} ${a.excerpt || ''} ${(a.labels || []).join(' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}
