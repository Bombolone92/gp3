/**
 * Global search across matters, contacts, bills, tasks, events, documents,
 * and notes. Each collection's searchable text is built once per change of
 * that collection, or of the collections its text borrows from (a matter is
 * found by its client's name), memoized on the store's list arrays, so
 * typing in the palette only runs substring checks over prepared strings.
 */
import { contactName, matterLabel, normalize, primaryEmail, primaryPhone, padNumber } from './format.js';
import { formatDate } from './dates.js';

const prepared = new WeakMap();

function prep(list, textOf, deps) {
  let p = prepared.get(list);
  if (!p || p.deps.some((d, i) => d !== deps[i])) {
    p = { deps, items: list.map((r) => ({ r, t: normalize(textOf(r)) })) };
    prepared.set(list, p);
  }
  return p.items;
}

export function createSearchIndex(store) {
  const contact = (id) => store.get('contacts', id);
  const matter = (id) => store.get('matters', id);
  const GROUPS = [
    {
      coll: 'matters',
      deps: ['contacts'],
      label: 'Matters',
      icon: 'briefcase',
      text: (m) => [m.displayNumber, m.description, contactName(contact(m.clientId)), m.clientRef, (m.tags || []).join(' ')].join(' '),
      item: (m) => ({
        title: matterLabel(m),
        sub: [contactName(contact(m.clientId)), m.status === 'closed' ? 'Closed' : m.status === 'pending' ? 'Pending' : ''].filter(Boolean).join(' · '),
        href: `#/matters/${m.id}`,
      }),
      rank: (m) => (m.status === 'closed' ? 1 : 0),
    },
    {
      coll: 'contacts',
      label: 'Contacts',
      icon: 'contact',
      text: (c) => [contactName(c), c.companyName, c.jobTitle, ...(c.emails || []).map((e) => e.address), ...(c.phones || []).map((p) => p.number)].join(' '),
      item: (c) => ({ title: contactName(c), sub: [c.type === 'company' ? 'Company' : c.jobTitle, primaryEmail(c) || primaryPhone(c)].filter(Boolean).join(' · '), href: `#/contacts/${c.id}` }),
    },
    {
      coll: 'bills',
      deps: ['matters', 'contacts'],
      label: 'Bills',
      icon: 'receipt-text',
      text: (b) => `bill ${b.number} #${b.number} ${padNumber(b.number)} ${matter(b.matterId)?.displayNumber || ''} ${contactName(contact(b.clientId))}`,
      item: (b) => ({ title: `Bill #${b.number}`, sub: [contactName(contact(b.clientId)), formatDate(b.issueDate)].join(' · '), href: `#/bills/${b.id}` }),
    },
    {
      coll: 'tasks',
      label: 'Tasks',
      icon: 'square-check',
      text: (t) => `${t.name} ${t.description || ''}`,
      item: (t) => ({
        title: t.name,
        sub: [t.done ? 'Completed' : t.dueDate ? `Due ${formatDate(t.dueDate)}` : '', matter(t.matterId)?.displayNumber].filter(Boolean).join(' · '),
        href: t.matterId ? `#/matters/${t.matterId}?tab=tasks` : '#/tasks',
      }),
      rank: (t) => (t.done ? 1 : 0),
    },
    {
      coll: 'events',
      label: 'Calendar',
      icon: 'calendar',
      text: (e) => `${e.title} ${e.location || ''}`,
      item: (e) => ({ title: e.title, sub: formatDate(e.date), href: `#/calendar?date=${e.date}` }),
    },
    {
      coll: 'documents',
      label: 'Documents',
      icon: 'file',
      text: (d) => `${d.name} ${d.category || ''} ${d.description || ''}`,
      item: (d) => ({ title: d.name, sub: matter(d.matterId)?.displayNumber || d.category || '', href: d.matterId ? `#/matters/${d.matterId}?tab=documents` : '#/documents' }),
    },
    {
      coll: 'notes',
      label: 'Notes',
      icon: 'sticky-note',
      text: (n) => `${n.subject || ''} ${n.body || ''}`,
      item: (n) => ({ title: n.subject || 'Note', sub: formatDate(n.date), href: n.matterId ? `#/matters/${n.matterId}?tab=notes` : n.contactId ? `#/contacts/${n.contactId}` : '#/' }),
    },
  ];

  /** Grouped results: [{ label, icon, total, items: [{ title, sub, href }] }]. */
  return function search(query, { perGroup = 5 } = {}) {
    const q = normalize(query).trim();
    if (!q) return [];
    const tokens = q.split(/\s+/);
    const out = [];
    for (const g of GROUPS) {
      const hits = [];
      for (const { r, t } of prep(store.all(g.coll), g.text, (g.deps || []).map((d) => store.all(d)))) {
        if (tokens.every((tok) => t.includes(tok))) hits.push({ r, starts: t.startsWith(tokens[0]) ? 0 : 1 });
      }
      if (!hits.length) continue;
      hits.sort((a, b) => (g.rank ? g.rank(a.r) - g.rank(b.r) : 0) || a.starts - b.starts);
      out.push({ label: g.label, icon: g.icon, total: hits.length, items: hits.slice(0, perGroup).map((h) => g.item(h.r)) });
    }
    return out;
  };
}
