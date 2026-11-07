/**
 * Helpers shared by views: store-bound pickers, links to records, status
 * pills, and undoable deletes.
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { avatar, pill, recordPicker, select } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { contactName, matterLabel, contactSortName, primaryEmail, colorFor } from '../core/format.js';
import { formatDate, relativeDue, diffDays, toISODate } from '../core/dates.js';
import { formatMoney } from '../core/money.js';
import { BILL_STATUS, matterFinancials } from '../core/finance.js';
import { where } from '../core/derive.js';

// ---- Links and chips ------------------------------------------------------------

export function matterLink(id, { short = false } = {}) {
  const m = lookup.matter(id);
  if (!m) return h('span.subtle', id ? 'Deleted matter' : 'No matter');
  return h('a.rec-link', { href: `#/matters/${m.id}`, title: matterLabel(m) }, short ? m.displayNumber || m.description : matterLabel(m));
}

export function contactLink(id) {
  const c = lookup.contact(id);
  if (!c) return h('span.subtle', id ? 'Deleted contact' : '');
  return h('a.rec-link', { href: `#/contacts/${c.id}` }, contactName(c));
}

export function userChip(id, { size = 'xs', showName = true } = {}) {
  const u = lookup.user(id);
  if (!u) return h('span.subtle', 'Unassigned');
  return h('span.user-chip', avatar(u.name, { color: u.color || colorFor(u.id), size }), showName ? h('span.truncate', u.name) : null);
}

export function moneyCell(cents, { muted = false, tone } = {}) {
  return h(`span.num${muted && !cents ? '.subtle' : ''}${tone ? '.text-' + tone : ''}`, formatMoney(cents));
}

// ---- Status pills ---------------------------------------------------------------------

export function matterStatusPill(status) {
  const map = { open: ['Open', 'success'], pending: ['Pending', 'warning'], closed: ['Closed', 'neutral'] };
  const [label, tone] = map[status] || map.open;
  return pill(label, tone, { dot: true });
}

export function billStatusPill(status) {
  const s = BILL_STATUS[status] || BILL_STATUS.draft;
  return pill(s.label, s.tone);
}

export function priorityPill(p) {
  if (p === 'high') return pill('High', 'danger');
  if (p === 'low') return pill('Low', 'neutral');
  return null;
}

export function dueLabel(task, today) {
  if (!task.dueDate) return h('span.subtle', 'No due date');
  const late = !task.done && task.dueDate < today;
  const soon = !task.done && !late && diffDays(today, task.dueDate) <= 1;
  return h(`span${late ? '.text-danger' : soon ? '.text-warning' : ''}`, { title: formatDate(task.dueDate) }, relativeDue(task.dueDate, today));
}

// ---- Pickers --------------------------------------------------------------------------

/** Matter picker. Open and pending matters first; closed ones are still findable. */
export function matterPicker({
  name = 'matterId',
  value = '',
  required = false,
  onChange,
  label = 'Matter',
  includeClosed = true,
  placeholder = 'Find a matter by number, description, or client',
} = {}) {
  const items = () => {
    const all = app.store.all('matters').filter((m) => includeClosed || m.status !== 'closed' || m.id === value);
    return [...all].sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || (b.number || 0) - (a.number || 0));
  };
  return recordPicker({
    name,
    value,
    required,
    label,
    placeholder,
    getItems: items,
    labelOf: (m) => (m ? matterLabel(m) : ''),
    subOf: (m) => [lookup.contactName(m.clientId), m.status === 'closed' ? 'Closed' : ''].filter(Boolean).join(' · '),
    onChange,
  });
}

/** Contact picker with optional quick-create of a new contact. */
export function contactPicker({ name = 'contactId', value = '', required = false, onChange, label = 'Contact', placeholder = 'Find a contact', allowCreate = true, filter } = {}) {
  const items = () => {
    const list = filter ? app.store.all('contacts').filter(filter) : app.store.all('contacts');
    return [...list].sort((a, b) => contactSortName(a).localeCompare(contactSortName(b)));
  };
  return recordPicker({
    name,
    value,
    required,
    label,
    placeholder,
    getItems: items,
    labelOf: (c) => (c ? contactName(c) : ''),
    subOf: (c) => (c.type === 'company' ? 'Company' : [c.companyName, primaryEmail(c)].filter(Boolean).join(' · ')),
    onChange,
    footerAction: allowCreate
      ? {
          label: (q) => (q ? `Create contact "${q}"` : 'Create a new contact'),
          run: async (q) => {
            const { quickContactDialog } = await import('./dialogs.js');
            return quickContactDialog(q);
          },
        }
      : null,
  });
}

export function userSelect({ name = 'userId', value = '', allowNone = true, noneLabel = 'Unassigned', ...rest } = {}) {
  const users = lookup.activeUsers();
  const cur = value && !users.some((u) => u.id === value) ? lookup.user(value) : null;
  const options = [
    ...(allowNone ? [{ value: '', label: noneLabel }] : []),
    ...users.map((u) => ({ value: u.id, label: u.name })),
    ...(cur ? [{ value: cur.id, label: `${cur.name} (inactive)` }] : []),
  ];
  return select({ name, value: value || '', options, ...rest });
}

export function practiceAreaSelect({ name = 'practiceAreaId', value = '', allowNone = true, ...rest } = {}) {
  const s = app.settings();
  return select({ name, value, options: [...(allowNone ? [{ value: '', label: 'Select a practice area' }] : []), ...s.practiceAreas.map((p) => ({ value: p.id, label: p.name }))], ...rest });
}

export function categorySelect({ name = 'categoryId', value = '', kind = 'time', ...rest } = {}) {
  const cats = app.settings().activityCategories.filter((c) => c.kind === kind || c.id === value);
  return select({ name, value, options: [{ value: '', label: 'No category' }, ...cats.map((c) => ({ value: c.id, label: c.name }))], ...rest });
}

// ---- Money per matter -------------------------------------------------------------------

const finCache = new WeakMap();
/**
 * matterFinancials for one matter using only that matter's records (grouped
 * once per change), memoized until any money collection changes.
 */
export function financialsFor(m) {
  const s = app.store;
  const lists = ['activities', 'bills', 'payments', 'transactions'].map((c) => s.all(c));
  const key = lists[0];
  let cache = finCache.get(key);
  if (!cache || cache.bills !== lists[1] || cache.payments !== lists[2] || cache.tx !== lists[3] || cache.accounts !== s.all('accounts')) {
    cache = { bills: lists[1], payments: lists[2], tx: lists[3], accounts: s.all('accounts'), byMatter: new Map() };
    finCache.set(key, cache);
  }
  let f = cache.byMatter.get(m);
  if (!f) {
    f = matterFinancials(m, {
      activities: where(s, 'activities', 'matterId', m.id),
      bills: where(s, 'bills', 'matterId', m.id),
      payments: where(s, 'payments', 'matterId', m.id),
      transactions: where(s, 'transactions', 'matterId', m.id),
      accounts: cache.accounts,
    });
    cache.byMatter.set(m, f);
  }
  return f;
}

// ---- Actions ----------------------------------------------------------------------------

/** Delete a record with an Undo toast. related: [[coll, record]] removed together. */
export function removeWithUndo(coll, record, label, related = []) {
  const store = app.store;
  store.remove(coll, record.id);
  for (const [c, r] of related) store.remove(c, r.id);
  toast(`${label} deleted`, {
    action: {
      label: 'Undo',
      run: () => {
        store.restore(coll, record);
        for (const [c, r] of related) store.restore(c, r);
      },
    },
  });
}

/** "Last updated" style meta line. */
export function metaLine(rec) {
  if (!rec?.updatedAt) return null;
  return h('span.subtle', `Updated ${formatDate(toISODate(new Date(rec.updatedAt)))}`);
}

/** Column definitions reused by several tables. */
export const cols = {
  date: (get = (r) => r.date, label = 'Date') => ({ id: 'date', label, width: '112px', render: (r) => (get(r) ? formatDate(get(r)) : ''), sort: get }),
  matter: (get = (r) => r.matterId) => ({
    id: 'matter',
    label: 'Matter',
    render: (r) => (get(r) ? matterLink(get(r), { short: false }) : h('span.subtle', 'None')),
    sort: (r) => lookup.matter(get(r))?.displayNumber || '',
  }),
  user: (get = (r) => r.userId, label = 'User') => ({ id: 'user', label, render: (r) => userChip(get(r)), sort: (r) => lookup.userName(get(r)) }),
};

/** Remembered table sort per list, kept in this browser. */
export function rememberSort(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(`legal.sort.${key}`) || 'null') || fallback;
  } catch {
    return fallback;
  }
}

export function saveSort(key, sort) {
  try {
    localStorage.setItem(`legal.sort.${key}`, JSON.stringify(sort));
  } catch {}
}

export function sectionTitle(text, extra) {
  return h('div.section-title', h('h2', text), extra || null);
}

export function iconText(ic, text, cls = '') {
  return h(`span.icon-text${cls ? '.' + cls : ''}`, icon(ic, 15), h('span', text));
}
