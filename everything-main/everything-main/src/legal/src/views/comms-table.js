/** Columns and cells for communication logs, shared by the log list and contact pages. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { matterLink, contactLink, userChip } from './common.js';
import { formatDate, formatTime } from '../core/dates.js';
import { formatHoursDecimal } from '../core/duration.js';

export const KIND_META = {
  phone: { label: 'Phone call', icon: 'phone' },
  email: { label: 'Email', icon: 'mail' },
  meeting: { label: 'Meeting', icon: 'users' },
  message: { label: 'Internal message', icon: 'message' },
};

export function kindCell(kind) {
  const k = KIND_META[kind] || KIND_META.phone;
  return h(`span.comm-kind.k-${kind || 'phone'}`, h('span.comm-kind-icon', icon(k.icon, 14)), h('span', k.label));
}

export function directionCell(c) {
  if (c.direction === 'in') return h('span.icon-text', icon('phone-in', 14), 'Incoming');
  if (c.direction === 'out') return h('span.icon-text', icon('phone-out', 14), 'Outgoing');
  return h('span.subtle', c.kind === 'message' ? 'Internal' : '');
}

async function openLog(c) {
  const { openLogDialog } = await import('./dialogs.js');
  openLogDialog({ log: c });
}

/** Who the log is with: a contact, or the colleague an internal message went to. */
export function partyCell(c) {
  if (c.kind === 'message') return c.toUserId ? userChip(c.toUserId) : h('span.subtle', 'Everyone on the matter');
  return c.contactId ? contactLink(c.contactId) : h('span.subtle', 'No contact');
}

const stamp = (c) => `${c.date || ''} ${c.time || ''}`;

/** Column definitions. opts.matter / opts.party toggle those columns. */
export function commColumns({ matter = true, party = true } = {}) {
  return [
    { id: 'kind', label: 'Type', width: '160px', render: (c) => kindCell(c.kind), sort: (c) => KIND_META[c.kind]?.label || '' },
    {
      id: 'subject',
      label: 'Subject',
      fixed: true,
      width: '30%',
      render: (c) => h('button.link-btn.cell-btn.truncate', { type: 'button', onClick: () => openLog(c), title: c.subject }, c.subject || 'Untitled'),
      sort: (c) => c.subject || '',
    },
    matter
      ? { id: 'matter', label: 'Matter', render: (c) => (c.matterId ? matterLink(c.matterId, { short: true }) : h('span.subtle', 'None')), sort: (c) => lookup.matter(c.matterId)?.displayNumber || '' }
      : null,
    party ? { id: 'party', label: 'With', render: partyCell, sort: (c) => (c.kind === 'message' ? lookup.userName(c.toUserId) : lookup.contactName(c.contactId)) } : null,
    { id: 'from', label: 'Logged by', hidden: true, render: (c) => (c.fromUserId ? userChip(c.fromUserId) : ''), sort: (c) => lookup.userName(c.fromUserId) },
    { id: 'direction', label: 'Direction', render: directionCell, sort: (c) => c.direction || '' },
    { id: 'date', label: 'Date', width: '150px', render: (c) => h('span.num', formatDate(c.date), c.time ? h('span.subtle', ` ${formatTime(c.time)}`) : null), sort: stamp },
    { id: 'duration', label: 'Hours', align: 'r', width: '80px', render: (c) => (c.minutes ? h('span.num', formatHoursDecimal(c.minutes, 1)) : h('span.subtle', '')), sort: (c) => c.minutes || 0 },
    {
      id: 'time',
      label: 'Time entry',
      srLabel: 'Time entry',
      width: '100px',
      render: (c) => {
        const a = c.activityId ? app.store.get('activities', c.activityId) : null;
        return a ? h('span.icon-text.text-success', { title: 'Recorded as a time entry' }, icon('clock', 14), 'Recorded') : h('span.subtle', '');
      },
      sort: (c) => (c.activityId ? 1 : 0),
    },
  ].filter(Boolean);
}

/** Compact phone row. */
export function commMobile(c) {
  const k = KIND_META[c.kind] || KIND_META.phone;
  const who = c.kind === 'message' ? lookup.userName(c.toUserId) || 'Internal' : lookup.contactName(c.contactId);
  return h(
    'button.list-item.list-btn',
    { type: 'button', onClick: () => openLog(c) },
    h('span.comm-kind-icon', icon(k.icon, 16)),
    h('span.grow', h('span.title.truncate', c.subject || 'Untitled'), h('span.sub', [formatDate(c.date), who, lookup.matter(c.matterId)?.displayNumber].filter(Boolean).join(' · '))),
    c.minutes ? h('span.num.subtle', `${formatHoursDecimal(c.minutes, 1)} h`) : null,
  );
}
