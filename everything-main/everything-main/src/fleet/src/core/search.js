/**
 * Global search over the main record types. Builds one normalized string
 * per record, cached until that collection changes.
 */
import { normalize, vehicleName, vehicleDescription, contactName } from './format.js';

const TYPES = [
  {
    coll: 'vehicles',
    label: 'Vehicles',
    icon: 'truck',
    text: (r) => [vehicleName(r), vehicleDescription(r), r.vin, r.plate, r.type, ...(r.labels || [])].join(' '),
    title: (r) => vehicleName(r),
    sub: (r) => [vehicleDescription(r), r.plate, r.vin].filter(Boolean).join(' · '),
    href: (r) => `#/vehicles/${r.id}`,
  },
  {
    coll: 'issues',
    uses: 'vehicles',
    label: 'Issues',
    icon: 'warning',
    text: (r, s) => [`#${r.number}`, r.summary, r.description, vehicleName(s.get('vehicles', r.vehicleId))].join(' '),
    title: (r) => `#${r.number} ${r.summary}`,
    sub: (r, s) => `${vehicleName(s.get('vehicles', r.vehicleId))} · ${r.status}`,
    href: (r) => `#/issues/${r.id}`,
  },
  {
    coll: 'workOrders',
    uses: 'vehicles',
    label: 'Work orders',
    icon: 'clipboard',
    text: (r, s) => [`work order #${r.number}`, `#${r.number}`, vehicleName(s.get('vehicles', r.vehicleId)), r.notes].join(' '),
    title: (r) => `Work order #${r.number}`,
    sub: (r, s) => vehicleName(s.get('vehicles', r.vehicleId)),
    href: (r) => `#/work-orders/${r.id}`,
  },
  {
    coll: 'contacts',
    label: 'Contacts',
    icon: 'user',
    text: (r) => [contactName(r), r.email, r.phone, r.jobTitle, r.employeeNumber].join(' '),
    title: (r) => contactName(r),
    sub: (r) => [r.jobTitle, r.email].filter(Boolean).join(' · '),
    href: (r) => `#/contacts/${r.id}`,
  },
  {
    coll: 'vendors',
    label: 'Vendors',
    icon: 'store',
    text: (r) => [r.name, r.contactName, r.email, r.phone, r.address].join(' '),
    title: (r) => r.name,
    sub: (r) => r.address || '',
    href: (r) => `#/vendors/${r.id}`,
  },
  {
    coll: 'parts',
    label: 'Parts',
    icon: 'package',
    text: (r) => [r.number, r.description, r.manufacturer, r.mpn, r.category].join(' '),
    title: (r) => r.description || r.number,
    sub: (r) => [r.number, r.manufacturer].filter(Boolean).join(' · '),
    href: (r) => `#/parts/${r.id}`,
  },
  {
    coll: 'serviceTasks',
    label: 'Service tasks',
    icon: 'wrench',
    text: (r) => [r.name, r.category].join(' '),
    title: (r) => r.name,
    sub: (r) => r.category || '',
    href: () => '#/service-tasks',
  },
];

export function createSearchIndex(store) {
  const cache = new Map(); // coll -> { list, dep, entries }

  function entries(type) {
    const list = store.all(type.coll);
    // Issues and work orders are found by their vehicle's name too, so a
    // renamed vehicle rebuilds them.
    const dep = type.uses ? store.all(type.uses) : null;
    const hit = cache.get(type.coll);
    if (hit && hit.list === list && hit.dep === dep) return hit.entries;
    const out = list.map((r) => ({ r, s: normalize(type.text(r, store)) }));
    cache.set(type.coll, { list, dep, entries: out });
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
        if (!terms.every((t) => e.s.includes(t))) continue;
        const words = e.s.split(/\s+/);
        const starts = words.includes(terms[0]) ? 3 : e.s.startsWith(terms[0]) ? 2 : words.some((w) => w.startsWith(terms[0])) ? 1 : 0;
        hits.push({ e, starts, archived: e.r.archived ? 1 : 0 });
      }
      // Rank: active before archived, then a whole-word match ("#5" is
      // issue 5, not 50), a prefix match, a word-start match, then most
      // recent.
      hits.sort((a, b) => a.archived - b.archived || b.starts - a.starts || (b.e.r.updatedAt || '').localeCompare(a.e.r.updatedAt || ''));
      if (!hits.length) continue;
      groups.push({
        coll: type.coll,
        label: type.label,
        icon: type.icon,
        total: hits.length,
        items: hits.slice(0, limit).map(({ e }) => ({ title: type.title(e.r, store), sub: type.sub(e.r, store), href: type.href(e.r) })),
      });
    }
    return groups;
  };
}
