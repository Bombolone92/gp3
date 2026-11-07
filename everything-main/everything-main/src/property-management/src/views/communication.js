/**
 * Communication: a log of every email, announcement, letter and call note,
 * plus composing new ones. Announcements go to every current tenant of one
 * property or of the whole portfolio.
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, searchBox, chips, dataTable, emptyState, statusPill, field, textInput, textarea, select, segmented } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { openMenu } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { setQuery } from '../ui/router.js';
import { formatDate, timeAgo } from '../core/dates.js';
import { matches, personName, displayName, pluralize } from '../core/format.js';
import { leaseStatus } from '../core/leases.js';
import { newId } from '../core/ids.js';
import { propertySelect, rememberSort, saveSort } from './common.js';
import { composeEmail, logMessage } from './compose.js';
import { sendEmail, mailerAvailable, describeResult, recipientResults, MAX_SUBJECT_CHARS, MAX_BODY_CHARS } from '../mailer.js';

export const MESSAGE_KINDS = [
  { id: 'email', label: 'Email', icon: 'mail' },
  { id: 'announcement', label: 'Announcement', icon: 'megaphone' },
  { id: 'letter', label: 'Letter', icon: 'file' },
  { id: 'note', label: 'Call or note', icon: 'phone' },
];

const kindMeta = (id) => MESSAGE_KINDS.find((k) => k.id === id) || MESSAGE_KINDS[0];

/** Current (and optionally future) tenants with an email address, deduplicated. */
export function announcementAudience(store, { propertyId = null, includeFuture = false, today }) {
  const seen = new Set();
  const out = [];
  let withoutEmail = 0;
  for (const l of store.all('leases')) {
    if (l.draft) continue;
    if (propertyId && l.propertyId !== propertyId) continue;
    const st = leaseStatus(l, today);
    if (!(st === 'active' || (includeFuture && st === 'future'))) continue;
    for (const id of l.tenantIds || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const t = store.get('tenants', id);
      if (!t) continue;
      const email = (t.emails || [])[0];
      if (!email) withoutEmail++;
      out.push({ name: personName(t), email: email || '', tenantId: t.id });
    }
  }
  return { recipients: out, withoutEmail };
}

function recipientSummary(m) {
  const to = m.to || [];
  if (!to.length) return '';
  if (m.kind === 'announcement') return pluralize(to.length, 'recipient');
  const first = to[0].name || to[0].email;
  return to.length > 1 ? `${first} and ${to.length - 1} more` : first;
}

export function render(ctx) {
  const store = app.store;
  const state = {
    q: ctx.query.q || '',
    kind: MESSAGE_KINDS.some((k) => k.id === ctx.query.kind) ? ctx.query.kind : 'all',
    propertyId: ctx.query.property || '',
    sort: rememberSort('messages', { id: 'at', dir: 'desc' }),
  };

  const header = pageHeader({
    title: 'Communication',
    subtitle: 'Emails, announcements, letters and call notes',
    actions: [
      h('button.btn', { type: 'button', onClick: (e) => openMenu(e.currentTarget, [
        { label: 'Announcement', icon: 'megaphone', description: 'Notify every tenant of a property', run: () => announcementDialog() },
        { label: 'Log a letter', icon: 'file', run: () => logDialog({ kind: 'letter' }) },
        { label: 'Log a call or note', icon: 'phone', run: () => logDialog({ kind: 'note' }) },
      ], { label: 'New' }) }, icon('plus', 16), 'New', icon('chevron-down', 14)),
      h('button.btn.primary', { type: 'button', onClick: () => composeEmail() }, icon('send', 16), 'Compose email'),
    ],
  });

  const search = searchBox({
    value: state.q,
    placeholder: 'Search subject, message or recipient',
    label: 'Search messages',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      results.redraw();
    },
  });

  const prop = propertySelect({ value: state.propertyId, empty: 'All properties', 'aria-label': 'Property' });
  prop.addEventListener('change', () => {
    state.propertyId = prop.value;
    setQuery({ property: prop.value });
    results.redraw();
  });

  const filterRow = h('div');
  const results = ctx.live(() => {
    const all = store.all('messages');
    filterRow.replaceChildren(
      chips({
        label: 'Type',
        selected: state.kind,
        onSelect: (id) => {
          state.kind = id;
          setQuery({ kind: id === 'all' ? '' : id });
          results.redraw();
        },
        items: [{ id: 'all', label: 'All', count: all.length }, ...MESSAGE_KINDS.map((k) => ({ id: k.id, label: `${k.label}s`.replace('Call or notes', 'Calls and notes'), count: all.filter((m) => m.kind === k.id).length }))],
      }),
    );
    const rows = all.filter(
      (m) =>
        (state.kind === 'all' || m.kind === state.kind) &&
        (!state.propertyId || m.propertyId === state.propertyId) &&
        (!state.q || matches(`${m.subject} ${m.body} ${(m.to || []).map((r) => `${r.name} ${r.email}`).join(' ')}`, state.q)),
    );
    return [
      h('div.sr-only', { role: 'status' }, pluralize(rows.length, 'message')),
      dataTable({
        caption: 'Messages',
        rows,
        sort: state.sort,
        onSort: (s) => {
          state.sort = s;
          saveSort('messages', s);
          results.redraw();
        },
        columns: [
          {
            id: 'subject',
            label: 'Subject',
            sort: (m) => m.subject || '',
            render: (m) =>
              h(
                'button.link-btn.msg-open',
                { type: 'button', onClick: () => messageDialog(m.id) },
                h('span.msg-kind-icon', { 'aria-hidden': 'true' }, icon(kindMeta(m.kind).icon, 15)),
                h('span.msg-text', h('span.msg-subject', m.subject || '(No subject)'), h('span.msg-snippet', (m.body || '').replace(/\s+/g, ' ').slice(0, 90))),
              ),
          },
          { id: 'kind', label: 'Type', sort: (m) => m.kind, render: (m) => kindMeta(m.kind).label },
          { id: 'to', label: 'To', render: (m) => h('span.truncate', recipientSummary(m)) },
          { id: 'property', label: 'Property', sort: (m) => lookup.property(m.propertyId)?.name || '', render: (m) => (m.propertyId ? lookup.property(m.propertyId)?.name || '' : h('span.subtle', 'All')) },
          { id: 'status', label: 'Status', sort: (m) => m.status, render: (m) => statusPill(m.status || 'logged') },
          { id: 'at', label: 'Date', sort: (m) => m.at || '', render: (m) => h('span.nowrap', { title: m.at ? new Date(m.at).toLocaleString() : '' }, m.at ? formatDate(m.at) : '') },
        ],
        mobile: (m) =>
          h(
            'button.mobile-row.msg-row',
            { type: 'button', onClick: () => messageDialog(m.id) },
            h('span.msg-kind-icon', { 'aria-hidden': 'true' }, icon(kindMeta(m.kind).icon, 16)),
            h('div.grow', { style: { minWidth: '0' } }, h('div.m-title', m.subject || '(No subject)'), h('div.m-sub', recipientSummary(m))),
            h('div.m-end', statusPill(m.status || 'logged'), h('span.subtle', { style: { fontSize: '12px' } }, m.at ? timeAgo(m.at) : '')),
          ),
        empty: all.length
          ? emptyState({ compact: true, icon: 'search', title: 'No matching messages', text: 'Try a different search or filter.', headingLevel: 3 })
          : emptyState({
              icon: 'mail',
              title: 'No messages yet',
              text: 'Email tenants, owners and vendors, send announcements to a whole building, and keep notes of calls and letters.',
              actions: [h('button.btn.primary', { type: 'button', onClick: () => composeEmail() }, icon('send', 16), 'Compose email'), h('button.btn', { type: 'button', onClick: () => announcementDialog() }, icon('megaphone', 16), 'Announcement')],
              headingLevel: 3,
            }),
      }),
    ];
  }, ['messages', 'properties']);

  return {
    node: h(
      'div.page',
      header,
      h('section.card.list-card', { 'aria-label': 'Messages' }, h('div.toolbar', search, prop, h('div.grow'), filterRow), results),
    ),
    title: 'Communication',
  };
}

// ---- Dialogs -------------------------------------------------------------------

/** Read a logged message, with per-recipient results and follow-up actions. */
export function messageDialog(id) {
  const store = app.store;
  const m = store.get('messages', id);
  if (!m) return;
  const results = new Map((m.results || []).map((r) => [r.email, r.status]));
  openDialog({
    title: m.subject || '(No subject)',
    size: 'wide',
    body: h(
      'div.msg-detail',
      h(
        'div.msg-meta',
        h('span.row', icon(kindMeta(m.kind).icon, 16), kindMeta(m.kind).label),
        statusPill(m.status || 'logged'),
        h('span.subtle', [m.at ? new Date(m.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '', m.by].filter(Boolean).join(' · ')),
        m.propertyId ? h('a', { href: `#/properties/${m.propertyId}` }, lookup.property(m.propertyId)?.name || 'Property') : null,
        m.leaseId && store.get('leases', m.leaseId) ? h('a', { href: `#/leases/${m.leaseId}` }, lookup.leaseLabel(store.get('leases', m.leaseId))) : null,
      ),
      m.error ? h('div.notice.danger', icon('alert'), h('span', m.error)) : null,
      h('h3.msg-section', 'To'),
      (m.to || []).length
        ? h(
            'ul.msg-recipients',
            m.to.map((r) =>
              h(
                'li',
                h('span.grow', r.tenantId ? h('a', { href: `#/tenants/${r.tenantId}` }, r.name || r.email) : r.name || r.email, r.email && r.name ? h('span.subtle', ` ${r.email}`) : null, !r.email ? h('span.subtle', ' (no email address)') : null),
                results.get(r.email) ? statusPill(results.get(r.email) === 'skipped' ? 'logged' : results.get(r.email) === 'suppressed' ? 'failed' : results.get(r.email)) : null,
              ),
            ),
          )
        : h('p.subtle', 'No recipients recorded.'),
      h('h3.msg-section', 'Message'),
      h('div.msg-body', m.body || ''),
    ),
    footer: ({ close }) => [
      h(
        'button.btn.subtle-danger',
        {
          type: 'button',
          onClick: async () => {
            const ok = await confirmDialog({ title: 'Delete this message from the log?', message: 'Emails that were sent are not recalled; only the log entry is removed.', confirmLabel: 'Delete', danger: true });
            if (!ok) return;
            const removed = store.remove('messages', m.id);
            close();
            toast('Message deleted', { action: { label: 'Undo', run: () => store.restore('messages', removed) } });
          },
        },
        icon('trash', 16),
        'Delete',
      ),
      h('div.spacer'),
      m.kind === 'email' || m.kind === 'announcement'
        ? h(
            'button.btn',
            {
              type: 'button',
              onClick: () => {
                close();
                // Trying again keeps the message's id, so people who already
                // received it are skipped; sending again is a fresh send.
                const retry = m.status === 'failed' || !!m.error;
                composeEmail({ to: (m.to || []).filter((r) => r.email), subject: m.subject, body: m.body, related: { leaseId: m.leaseId, propertyId: m.propertyId }, title: retry ? 'Try again' : 'Send again', id: retry ? m.id : null, kind: m.kind });
              },
            },
            icon('copy', 16),
            m.status === 'failed' || m.error ? 'Try again' : 'Send again',
          )
        : null,
      h('button.btn.primary', { type: 'button', onClick: () => close() }, 'Done'),
    ],
  });
}

/** Announcement to every current tenant of one property, or of all properties. */
export function announcementDialog({ propertyId = '' } = {}) {
  const store = app.store;
  const prop = propertySelect({ value: propertyId, empty: 'All properties' });
  const future = h('input', { type: 'checkbox', id: 'ann-future' });
  const subject = textInput({ name: 'subject', placeholder: 'e.g. Water shutoff Thursday morning', maxlength: MAX_SUBJECT_CHARS });
  const body = textarea({ name: 'body', rows: 8, placeholder: 'What residents need to know', maxlength: MAX_BODY_CHARS });
  const canEmail = mailerAvailable() && !app.demo;
  const delivery = segmented({
    label: 'Delivery',
    value: canEmail ? 'email' : 'log',
    items: [
      { value: 'email', label: 'Email each tenant', icon: 'mail' },
      { value: 'log', label: 'Log only', icon: 'archive' },
    ],
    onChange: (v) => (deliveryValue = v),
  });
  let deliveryValue = canEmail ? 'email' : 'log';
  const audience = h('p.ann-audience', { role: 'status', 'aria-live': 'polite' });
  const err = h('p.form-error', { role: 'alert' });
  const describe = () => {
    const { recipients, withoutEmail } = announcementAudience(store, { propertyId: prop.value || null, includeFuture: future.checked, today: app.today() });
    audience.textContent = recipients.length
      ? `${pluralize(recipients.length, 'tenant')}${withoutEmail ? `, ${withoutEmail} without an email address` : ''}.`
      : 'No current tenants for this selection.';
  };
  prop.addEventListener('change', describe);
  future.addEventListener('change', describe);
  describe();

  openDialog({
    title: 'New announcement',
    size: 'wide',
    body: h(
      'div.stack',
      h('div.form-grid', field('Send to tenants of', prop), h('div.field.check-field', h('label.check', future, h('span', 'Include future tenants')))),
      audience,
      field('Subject', subject, { required: true }),
      field('Message', body, { required: true }),
      h('div.field', h('span.field-label', 'Delivery'), delivery, !canEmail ? h('span.hint', app.demo ? 'Email is not sent from the sample portfolio.' : 'Email sending is not available right now, so the announcement is logged only.') : null),
      err,
    ),
    footer: ({ close }) => {
      const btn = h('button.btn.primary', { type: 'button' }, icon('megaphone', 16), 'Post announcement');
      const fail = (text, el) => {
        err.textContent = text;
        el?.focus();
      };
      // One id for the whole dialog: posting again after a timeout or an
      // error skips tenants who already received the identical message.
      const id = newId();
      btn.addEventListener('click', async () => {
        if (!subject.value.trim()) return fail('Add a subject.', subject);
        if (!body.value.trim()) return fail('Write a message.', body);
        const { recipients } = announcementAudience(store, { propertyId: prop.value || null, includeFuture: future.checked, today: app.today() });
        if (!recipients.length) return fail('There are no tenants to send this to.', prop);
        const base = { id, kind: 'announcement', subject: subject.value.trim(), body: body.value, to: recipients, propertyId: prop.value || null };
        if (deliveryValue === 'email' && canEmail) {
          const emailable = recipients.filter((r) => r.email);
          if (!emailable.length) return fail('None of these tenants have an email address.');
          btn.disabled = true;
          err.textContent = '';
          audience.textContent = `Sending to ${pluralize(emailable.length, 'tenant')}...`;
          try {
            const out = await sendEmail({ id, kind: 'announcement', to: emailable, subject: base.subject, body: base.body, senderName: app.settings().company?.name || '', replyTo: app.settings().company?.email || '' });
            const summary = describeResult(out);
            logMessage({ ...base, status: summary.ok ? 'sent' : 'failed', results: recipientResults(out), error: summary.ok && !summary.partial ? '' : summary.message });
            close();
            toast(summary.message, { type: !summary.ok ? 'error' : summary.partial ? 'info' : 'success', ...(summary.partial ? { duration: 8000 } : {}) });
          } catch (e) {
            btn.disabled = false;
            err.textContent = e.message;
            logMessage({ ...base, status: 'failed', error: e.message });
          }
          return;
        }
        logMessage({ ...base, status: 'logged' });
        close();
        toast(`Announcement logged for ${pluralize(recipients.length, 'tenant')}`);
      });
      return [h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'), btn];
    },
  });
}

/** Log a letter that was mailed, or a phone call or in-person conversation. */
export function logDialog({ kind = 'note', related = {} } = {}) {
  const store = app.store;
  const people = [
    ...store.all('tenants').map((t) => ({ value: `t:${t.id}`, label: `${personName(t)} (tenant)`, rec: { name: personName(t), email: (t.emails || [])[0] || '', tenantId: t.id } })),
    ...store.all('owners').map((o) => ({ value: `o:${o.id}`, label: `${displayName(o)} (owner)`, rec: { name: displayName(o), email: (o.emails || [])[0] || '', ownerId: o.id } })),
    ...store.all('vendors').map((v) => ({ value: `v:${v.id}`, label: `${displayName(v)} (vendor)`, rec: { name: displayName(v), email: (v.emails || [])[0] || '', vendorId: v.id } })),
  ].sort((a, b) => a.label.localeCompare(b.label));
  const kindSel = select({ name: 'kind', value: kind, options: MESSAGE_KINDS.filter((k) => k.id === 'letter' || k.id === 'note').map((k) => ({ value: k.id, label: k.label })) });
  const who = select({ name: 'who', value: related.tenantId ? `t:${related.tenantId}` : '', options: [{ value: '', label: 'Someone else' }, ...people.map(({ value, label }) => ({ value, label }))] });
  const other = textInput({ name: 'other', placeholder: 'Name' });
  const prop = propertySelect({ value: related.propertyId || '', empty: 'None' });
  const dateIn = textInput({ name: 'date', type: 'date', value: app.today() });
  const subject = textInput({ name: 'subject', placeholder: 'e.g. Discussed payment plan' });
  const body = textarea({ name: 'body', rows: 6 });
  const otherField = field('Name', other);
  const syncOther = () => (otherField.hidden = !!who.value);
  who.addEventListener('change', syncOther);
  syncOther();
  const err = h('p.form-error', { role: 'alert' });
  openDialog({
    title: kind === 'letter' ? 'Log a letter' : 'Log a call or note',
    body: h('div.form-grid', field('Type', kindSel), field('Date', dateIn), field('With', who), otherField, field('Property', prop), h('div'), field('Subject', subject, { span2: true, required: true }), field('Details', body, { span2: true }), err),
    footer: ({ close }) => [
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            if (!subject.value.trim()) {
              err.textContent = 'Add a subject.';
              subject.focus();
              return;
            }
            const person = people.find((p) => p.value === who.value)?.rec || (other.value.trim() ? { name: other.value.trim(), email: '' } : null);
            const at = dateIn.value && dateIn.value !== app.today() ? `${dateIn.value}T12:00:00.000Z` : new Date().toISOString();
            logMessage({ kind: kindSel.value, subject: subject.value.trim(), body: body.value, to: person ? [person] : [], propertyId: prop.value || null, leaseId: related.leaseId || null, at, status: 'logged' });
            close();
            toast('Saved to the communication log');
          },
        },
        'Save',
      ),
    ],
  });
}
