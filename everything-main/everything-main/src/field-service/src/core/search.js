/**
 * Global search over the main record types. Builds one normalized string
 * per record, cached until that collection changes.
 */
import { clientName, formatAddress, normalize, primaryEmail, primaryPhone } from './format.js';

const TYPES = [
  {
    coll: 'clients',
    label: 'Clients',
    text: (r) => [clientName(r), r.company, ...(r.emails || []).map((e) => e.address), ...(r.phones || []).map((p) => p.number), ...(r.properties || []).map((p) => formatAddress(p)), ...(r.tags || [])].join(' '),
    title: (r) => clientName(r),
    sub: (r) => [primaryEmail(r), primaryPhone(r)].filter(Boolean).join(' · ') || formatAddress(r.properties?.[0]),
    href: (r) => `#/clients/${r.id}`,
    icon: 'user',
  },
  { coll: 'requests', label: 'Requests', prefix: 'Request', icon: 'inbox' },
  { coll: 'quotes', label: 'Quotes', prefix: 'Quote', icon: 'file-pen' },
  { coll: 'jobs', label: 'Jobs', prefix: 'Job', icon: 'hammer' },
  { coll: 'invoices', label: 'Invoices', prefix: 'Invoice', icon: 'receipt-text' },
];

export function createSearchIndex(store) {
  const cache = new Map(); // coll -> { list, entries }

  function entries(type) {
    const list = store.all(type.coll);
    // Documents are found by their client's name too, so a renamed client
    // invalidates them as well.
    const clients = type.coll === 'clients' ? null : store.all('clients');
    const hit = cache.get(type.coll);
    if (hit && hit.list === list && hit.clients === clients) return hit.entries;
    const clientOf = (r) => store.get('clients', r.clientId);
    const text =
      type.text ||
      ((r) => [`${type.prefix} #${r.number || ''}`, `#${r.number || ''}`, r.title, r.subject, clientName(clientOf(r)), r.details].filter(Boolean).join(' '));
    const out = list.map((r) => ({ r, s: normalize(text(r)), t: normalize(type.title ? type.title(r) : r.title || r.subject), n: r.number ? String(r.number) : '' }));
    cache.set(type.coll, { list, clients, entries: out });
    return out;
  }

  return function search(query, { limit = 6 } = {}) {
    const q = normalize(query).trim();
    if (!q) return [];
    const terms = q.split(/\s+/);
    const groups = [];
    for (const type of TYPES) {
      const hits = [];
      for (const e of entries(type)) {
        if (terms.every((t) => e.s.includes(t))) {
          // Rank: the document numbered what was typed ("12", "#12") first,
          // then a prefix match on the title, then most recent.
          const starts = e.n && terms.some((t) => t.replace(/^#/, '') === e.n) ? 2 : e.t.startsWith(terms[0]) ? 1 : 0;
          hits.push({ e, starts });
        }
      }
      hits.sort((a, b) => b.starts - a.starts || (b.e.r.updatedAt || '').localeCompare(a.e.r.updatedAt || ''));
      if (!hits.length) continue;
      groups.push({
        coll: type.coll,
        label: type.label,
        icon: type.icon,
        total: hits.length,
        items: hits.slice(0, limit).map(({ e }) => {
          const r = e.r;
          const client = store.get('clients', r.clientId);
          return {
            id: r.id,
            title: type.title ? type.title(r) : `${type.prefix} #${r.number || ''}${r.title || r.subject ? ': ' + (r.title || r.subject) : ''}`,
            sub: type.sub ? type.sub(r) : clientName(client),
            href: type.href ? type.href(r) : `#/${type.coll}/${r.id}`,
          };
        }),
      });
    }
    return groups;
  };
}
