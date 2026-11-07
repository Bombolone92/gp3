/**
 * Global search over the main record types. Builds one normalized string
 * per record, cached until that collection changes.
 */
import { displayName, formatAddress, normalize, personName, primaryEmail, primaryPhone } from './format.js';
import { unitLabel, tenantName } from './leases.js';

/** Phone numbers as written and as bare digits, so either form finds them. */
const phones = (list = []) => list.filter(Boolean).flatMap((p) => [p, String(p).replace(/\D/g, '')]);

function types(store) {
  const prop = (id) => store.get('properties', id);
  const unit = (id) => store.get('units', id);
  const tenants = (l) => (l.tenantIds || []).map((id) => tenantName(store.get('tenants', id))).filter(Boolean).join(', ');
  const leaseOf = (tenantId) => store.all('leases').find((l) => (l.tenantIds || []).includes(tenantId));
  return [
    {
      coll: 'properties',
      label: 'Properties',
      icon: 'building',
      text: (r) => [r.name, formatAddress(r.address)].join(' '),
      title: (r) => r.name,
      sub: (r) => formatAddress(r.address),
      href: (r) => `#/properties/${r.id}`,
    },
    {
      coll: 'units',
      label: 'Units',
      icon: 'door',
      text: (r) => [prop(r.propertyId)?.name, r.name, `unit ${r.name}`].join(' '),
      title: (r) => unitLabel(prop(r.propertyId), r),
      sub: (r) => formatAddress(prop(r.propertyId)?.address),
      href: (r) => `#/units/${r.id}`,
    },
    {
      coll: 'tenants',
      label: 'Tenants',
      icon: 'user',
      text: (r) => [personName(r), r.company, ...(r.emails || []), ...phones(r.phones)].join(' '),
      title: (r) => personName(r),
      sub: (r) => {
        const l = leaseOf(r.id);
        return l ? unitLabel(prop(l.propertyId), unit(l.unitId)) : primaryEmail(r) || primaryPhone(r);
      },
      href: (r) => `#/tenants/${r.id}`,
    },
    {
      coll: 'leases',
      label: 'Leases',
      icon: 'file-signature',
      text: (r) => [`lease ${r.number || ''}`, tenants(r), prop(r.propertyId)?.name, unit(r.unitId)?.name].join(' '),
      title: (r) => `${unitLabel(prop(r.propertyId), unit(r.unitId))}`,
      sub: (r) => [tenants(r), r.number ? `Lease ${r.number}` : ''].filter(Boolean).join(' · '),
      href: (r) => `#/leases/${r.id}`,
    },
    {
      coll: 'owners',
      label: 'Rental owners',
      icon: 'briefcase',
      text: (r) => [displayName(r), personName(r), ...(r.emails || []), ...phones(r.phones)].join(' '),
      title: (r) => displayName(r),
      sub: (r) => primaryEmail(r) || primaryPhone(r),
      href: (r) => `#/owners/${r.id}`,
    },
    {
      coll: 'vendors',
      label: 'Vendors',
      icon: 'truck',
      text: (r) => [displayName(r), personName(r), r.category, ...(r.emails || []), ...phones(r.phones)].join(' '),
      title: (r) => displayName(r),
      sub: (r) => r.category || primaryPhone(r),
      href: (r) => `#/vendors/${r.id}`,
    },
    {
      coll: 'workOrders',
      label: 'Work orders',
      icon: 'wrench',
      text: (r) => [`wo-${r.number} work order ${r.number}`, r.title, prop(r.propertyId)?.name, unit(r.unitId)?.name].join(' '),
      title: (r) => `WO-${r.number}: ${r.title}`,
      sub: (r) => unitLabel(prop(r.propertyId), unit(r.unitId)),
      href: (r) => `#/work-orders/${r.id}`,
    },
    {
      coll: 'tasks',
      label: 'Tasks',
      icon: 'list-checks',
      text: (r) => [`tk-${r.number} task ${r.number}`, r.title, prop(r.propertyId)?.name].join(' '),
      title: (r) => r.title,
      sub: (r) => (r.propertyId ? unitLabel(prop(r.propertyId), unit(r.unitId)) : `Task ${r.number}`),
      href: (r) => `#/tasks/${r.id}`,
    },
    {
      coll: 'applicants',
      label: 'Applicants',
      icon: 'user-plus',
      text: (r) => [personName(r), r.email, ...phones([r.phone])].join(' '),
      title: (r) => personName(r),
      sub: (r) => (r.unitId ? unitLabel(prop(r.propertyId), unit(r.unitId)) : r.email),
      href: (r) => `#/applicants/${r.id}`,
    },
  ];
}

export function createSearchIndex(store) {
  const cache = new Map(); // coll -> { list, entries }
  const TYPES = types(store);

  // Search text for units, leases, work orders and tasks includes property,
  // unit and tenant names, so renaming one of those refreshes them too.
  const names = () => ['properties', 'units', 'tenants'].map((c) => store.revision(c)).join('.');

  function entries(type) {
    const list = store.all(type.coll);
    const sig = names();
    const hit = cache.get(type.coll);
    if (hit && hit.list === list && hit.sig === sig) return hit.entries;
    const out = list.map((r) => ({ r, s: normalize(type.text(r)) }));
    cache.set(type.coll, { list, sig, entries: out });
    return out;
  }

  return function search(query, { limit = 6 } = {}) {
    const q = normalize(query).trim();
    if (!q) return [];
    // A phone number typed with other punctuation, or none, matches by its digits.
    const terms = q.split(/\s+/).map((t) => {
      const d = /^[\d()+.\-]+$/.test(t) ? t.replace(/\D/g, '') : '';
      return d.length >= 3 && d !== t ? [t, d] : [t];
    });
    const groups = [];
    for (const type of TYPES) {
      const hits = [];
      for (const e of entries(type)) {
        if (terms.every((alts) => alts.some((t) => e.s.includes(t)))) hits.push({ e, starts: e.s.startsWith(terms[0][0]) ? 1 : 0 });
      }
      if (!hits.length) continue;
      hits.sort((a, b) => b.starts - a.starts || (b.e.r.updatedAt || '').localeCompare(a.e.r.updatedAt || ''));
      groups.push({
        coll: type.coll,
        label: type.label,
        icon: type.icon,
        total: hits.length,
        items: hits.slice(0, limit).map(({ e }) => ({ id: e.r.id, title: type.title(e.r), sub: type.sub(e.r), href: type.href(e.r) })),
      });
    }
    return groups;
  };
}
