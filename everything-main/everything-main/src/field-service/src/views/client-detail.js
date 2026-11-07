/** Client profile: contact details, properties, work and billing history. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { pageHeader, statusPill, tabs, emptyState, avatar, moreButton } from '../ui/components.js';
import { openMenu } from '../ui/menu.js';
import { confirmDialog } from '../ui/dialog.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { clientName, clientSecondary, formatAddress, telHref, directionsUrl, pluralize } from '../core/format.js';
import { clientStatus, requestStatus, quoteStatus, jobStatus, invoiceStatus, invoiceBalance } from '../core/status.js';
import { computeTotals } from '../core/totals.js';
import { formatDate, formatTimeRange, relativeDay, localDate } from '../core/dates.js';
import { clientBalance, clientLifetimeValue, clientRecords, deleteClientCascade } from '../core/workflow.js';
import { agendaItems } from '../core/agenda.js';
import { money, notesCard, teamAvatars } from './common.js';
import { tagInput } from './client-form.js';
import { PAYMENT_METHODS } from '../core/settings.js';
import { attachmentsCard } from './attachments.js';
import { deleteAttachments } from '../files.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  // An unknown tab in the link would leave no tab selected, or reachable with Tab.
  let tab = ['active', 'requests', 'quotes', 'jobs', 'invoices'].includes(ctx.query.tab) ? ctx.query.tab : 'active';

  const page = h('div.page');
  const draw = () => {
    const client = store.get('clients', id);
    if (!client) {
      return emptyState({ icon: 'users', title: 'Client not found', headingLevel: 1, text: 'This client may have been deleted.', actions: [h('a.btn.primary', { href: '#/clients' }, 'Back to clients')] });
    }
    const jobs = store.all('jobs');
    const invoices = store.all('invoices');
    const status = clientStatus(client, { jobs, invoices });
    const header = pageHeader({
      title: h('span.row', { style: { gap: '12px', flexWrap: 'wrap' } }, clientName(client), statusPill(status)),
      crumbs: [{ label: 'Clients', href: '#/clients' }],
      subtitle: clientSecondary(client) || null,
      actions: [
        moreButton((btn) => moreMenu(btn, client)),
        h('a.btn', { href: `#/clients/${client.id}/edit` }, icon('pencil', 16), 'Edit'),
        h('button.btn.primary', { type: 'button', onClick: (e) => createMenu(e.currentTarget, client) }, icon('plus', 16), 'Create', icon('chevron-down', 14)),
      ],
    });
    return [header, h('div.detail', h('div.detail-main', propertiesCard(client), workCard(client), scheduleCard(client), billingCard(client), attachmentsCard('clients', client)), h('div.detail-aside', contactCard(client), valueCard(client), tagsCard(client), notesCard('clients', client)))];
  };

  const body = ctx.live(draw, ['clients', 'requests', 'quotes', 'jobs', 'invoices', 'payments', 'events', 'team']);
  page.append(body);

  function workCard(client) {
    const today = app.today();
    const rec = clientRecords(store, client.id);
    const invoices = store.all('invoices');
    const payments = store.all('payments');
    const rows = {
      requests: rec.requests.map((r) => ({ href: `#/requests/${r.id}`, title: `Request #${r.number || ''}`, sub: r.title, date: localDate(r.createdAt), status: requestStatus(r, today), amount: null })),
      quotes: rec.quotes.map((q) => ({ href: `#/quotes/${q.id}`, title: `Quote #${q.number}`, sub: q.title, date: localDate(q.createdAt), status: quoteStatus(q), amount: computeTotals(q).total })),
      jobs: rec.jobs.map((j) => ({ href: `#/jobs/${j.id}`, title: `Job #${j.number}`, sub: j.title, date: j.schedule?.start || localDate(j.createdAt), status: jobStatus(j, today, invoices), amount: computeTotals(j).total })),
      invoices: rec.invoices.map((i) => ({ href: `#/invoices/${i.id}`, title: `Invoice #${i.number}`, sub: i.subject, date: i.issueDate, status: invoiceStatus(i, today, payments), amount: computeTotals(i).total })),
    };
    const closed = new Set(['archived', 'converted', 'completed', 'paid', 'bad_debt']);
    rows.active = [...rows.requests, ...rows.quotes, ...rows.jobs, ...rows.invoices].filter((r) => !closed.has(r.status));
    for (const k of Object.keys(rows)) rows[k].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const items = [
      { id: 'active', label: 'Active work', count: rows.active.length },
      { id: 'requests', label: 'Requests', count: rows.requests.length },
      { id: 'quotes', label: 'Quotes', count: rows.quotes.length },
      { id: 'jobs', label: 'Jobs', count: rows.jobs.length },
      { id: 'invoices', label: 'Invoices', count: rows.invoices.length },
    ];
    const list = rows[tab] || rows.active;
    const content = list.length
      ? h(
          'ul.list',
          list.map((r) =>
            h(
              'li',
              h(
                'a.list-item',
                { href: r.href },
                h('div.grow', { style: { minWidth: '0' } }, h('div.title.truncate', r.title, r.sub ? h('span.subtle', { style: { fontWeight: '400' } }, ` · ${r.sub}`) : null), h('div.meta', r.date ? formatDate(r.date) : '')),
                h('div', { style: { textAlign: 'right' } }, statusPill(r.status), r.amount !== null ? h('div.meta.money', { style: { marginTop: '4px' } }, money(r.amount)) : null),
              ),
            ),
          ),
        )
      : emptyState({
          compact: true,
          icon: 'clipboard',
          title: tab === 'active' ? 'No active work' : `No ${tab} yet`,
          text: 'Use Create to add a request, quote, job, or invoice for this client.',
          headingLevel: 3,
        });
    return h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Work overview')),
      h(
        'div',
        { style: { padding: '0 10px' } },
        tabs({
          label: 'Work type',
          items,
          selected: tab,
          onSelect: (t) => {
            tab = t;
            body.redraw();
            body.querySelector(`#tab-${t}`)?.focus();
          },
        }),
      ),
      h('div.card-body.flush', { role: 'tabpanel', 'aria-labelledby': `tab-${tab}` }, content),
    );
  }

  const found = store.get('clients', id);
  return { node: page, title: found ? clientName(found) : 'Client not found' };
}

function propertiesCard(client) {
  const props = client.properties || [];
  return h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Properties', h('span.count', ` ${props.length}`)), h('a.btn.sm', { href: `#/clients/${client.id}/edit` }, icon('plus', 14), 'Add property')),
    h(
      'div.card-body.flush',
      props.length
        ? props.map((p) => {
            const dir = directionsUrl(p);
            return h(
              'div.property-item',
              icon('pin', 18),
              h('div.grow', { style: { whiteSpace: 'pre-line' } }, formatAddress(p, { multiline: true })),
              dir ? h('a.btn.sm', { href: dir, target: '_blank', rel: 'noopener noreferrer' }, icon('navigation', 14), 'Directions') : null,
            );
          })
        : h('div.section-empty', h('span', 'No property address yet.'), h('a.btn.sm', { href: `#/clients/${client.id}/edit` }, 'Add address')),
    ),
  );
}

function scheduleCard(client) {
  const today = app.today();
  const items = agendaItems(app.store, { from: today }).filter((i) => i.clientId === client.id && !i.completed).slice(0, 6);
  return h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Upcoming visits')),
    h(
      'div.card-body.flush',
      items.length
        ? h(
            'ul.list',
            items.map((it) =>
              h(
                'li',
                h(
                  'a.list-item',
                  { href: it.jobId ? `#/jobs/${it.jobId}` : it.requestId ? `#/requests/${it.requestId}` : '#/schedule' },
                  h('span.subtle.nowrap', { style: { width: '110px', flex: 'none' } }, relativeDay(it.date, today)),
                  h('div.grow', { style: { minWidth: '0' } }, h('div.title.truncate', it.title), h('div.meta', formatTimeRange(it.start, it.end))),
                  teamAvatars(it.assignees),
                ),
              ),
            ),
          )
        : h('div.section-empty', h('span', 'Nothing scheduled for this client.')),
    ),
  );
}

function billingCard(client) {
  const store = app.store;
  const payments = store.all('payments');
  const invoices = store.all('invoices').filter((i) => i.clientId === client.id && i.sentAt);
  const rows = [
    ...invoices.map((i) => ({ date: i.issueDate, kind: 'invoice', label: `Invoice #${i.number}`, href: `#/invoices/${i.id}`, amount: computeTotals(i).total })),
    ...payments.filter((p) => p.clientId === client.id && !p.voided).map((p) => ({ date: p.date, kind: 'payment', label: `Payment, ${PAYMENT_METHODS.find((m) => m.id === p.method)?.label || 'Other'}`, href: p.invoiceId ? `#/invoices/${p.invoiceId}` : '#/payments', amount: -p.amount })),
    // A written-off balance is no longer owed, as in the current balance.
    ...invoices
      .filter((i) => i.badDebt && invoiceBalance(i, payments) > 0)
      .map((i) => ({ date: localDate(i.badDebtAt) || i.dueDate || i.issueDate, kind: 'writeoff', label: `Written off, invoice #${i.number}`, href: `#/invoices/${i.id}`, amount: -invoiceBalance(i, payments) })),
  ].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  let running = 0;
  for (const r of rows) {
    running += r.amount;
    r.balance = running;
  }
  rows.reverse();
  return h(
    'section.card',
    h(
      'div.card-head',
      h('h2.grow', 'Billing history'),
      h(
        'button.btn.sm',
        {
          type: 'button',
          onClick: () => import('./payments.js').then((m) => m.recordPaymentDialog({ clientId: client.id })),
        },
        icon('wallet', 14),
        'Record payment',
      ),
    ),
    h(
      'div.card-body.flush',
      rows.length
        ? h(
            'div.table-wrap',
            { tabindex: '0', role: 'region', 'aria-label': 'Billing history' },
            h(
              'table.table',
              h('thead', h('tr', h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col' }, 'Item'), h('th.r', { scope: 'col' }, 'Amount'), h('th.r', { scope: 'col' }, 'Balance'))),
              h(
                'tbody',
                rows.slice(0, 20).map((r) =>
                  h(
                    'tr',
                    h('td.nowrap', formatDate(r.date)),
                    h('td', h('a', { href: r.href }, r.label)),
                    h('td.r.money', { style: r.kind === 'payment' ? { color: 'var(--success)' } : r.kind === 'writeoff' ? { color: 'var(--text-2)' } : null }, r.amount < 0 ? `-${money(-r.amount)}` : money(r.amount)),
                    h('td.r.money', money(r.balance)),
                  ),
                ),
              ),
            ),
          )
        : h('div.section-empty', h('span', 'No invoices or payments yet.')),
    ),
  );
}

function contactCard(client) {
  const p = client.phones || [];
  const e = client.emails || [];
  return h(
    'section.card',
    h('div.card-body.stack', h('div.client-hero', avatar(clientName(client), { size: 'lg' }), h('div.grow', h('div', { style: { fontWeight: '700', fontSize: '16px' } }, clientName(client)), clientSecondary(client) ? h('div.subtle', clientSecondary(client)) : null))),
    h(
      'div.card-body.contact-list',
      { style: { borderTop: '1px solid var(--border)' } },
      p.map((x) => h('div.row', icon('phone', 16), h('a', { href: telHref(x.number) }, x.number), h('span.subtle', { style: { fontSize: '12px' } }, x.label))),
      e.map((x) => h('div.row', icon('mail', 16), h('a.truncate', { href: `mailto:${x.address}` }, x.address), h('span.subtle', { style: { fontSize: '12px' } }, x.label))),
      !p.length && !e.length ? h('span.subtle', 'No phone or email yet.') : null,
      h(
        'dl.kv',
        { style: { marginTop: '6px' } },
        h('dt', 'Lead source'),
        h('dd', client.leadSource || 'Not specified'),
        h('dt', 'Client since'),
        h('dd', formatDate(client.createdAt)),
        client.billingSame === false && client.billing?.street1 ? [h('dt', 'Billing address'), h('dd', { style: { whiteSpace: 'pre-line' } }, formatAddress(client.billing, { multiline: true }))] : null,
      ),
    ),
  );
}

function valueCard(client) {
  const store = app.store;
  const balance = clientBalance(store, client.id);
  return h(
    'section.card',
    h(
      'div.card-body',
      h(
        'div.stats',
        { style: { gridTemplateColumns: '1fr 1fr' } },
        h('div', h('div.subtle', { style: { fontSize: '13px' } }, 'Lifetime value'), h('div.big-number', { style: { fontSize: '22px' } }, money(clientLifetimeValue(store, client.id)))),
        h('div', h('div.subtle', { style: { fontSize: '13px' } }, 'Current balance'), h('div.big-number', { style: { fontSize: '22px', color: balance > 0 ? 'var(--warning)' : null } }, money(balance))),
      ),
    ),
  );
}

function tagsCard(client) {
  const tags = [...(client.tags || [])];
  const editor = tagInput(tags);
  const save = () => {
    if (JSON.stringify(tags) !== JSON.stringify(client.tags || [])) app.store.patch('clients', client.id, { tags: [...tags] });
  };
  editor.addEventListener('focusout', () => setTimeout(save, 0));
  // Save each tag as it is added or removed, so a redraw cannot drop it.
  editor.addEventListener('keydown', (e) => ['Enter', ',', 'Backspace'].includes(e.key) && setTimeout(save, 0));
  editor.addEventListener('click', (e) => e.target.closest('button') && setTimeout(save, 0));
  return h('section.card', h('div.card-head', h('h2.grow', 'Tags')), h('div.card-body', editor));
}

function createMenu(anchor, client) {
  openMenu(anchor, [
    { label: 'Request', icon: 'inbox', run: () => navigate(`/requests/new?client=${client.id}`) },
    { label: 'Quote', icon: 'file-pen', run: () => navigate(`/quotes/new?client=${client.id}`) },
    { label: 'Job', icon: 'hammer', run: () => navigate(`/jobs/new?client=${client.id}`) },
    { label: 'Invoice', icon: 'receipt-text', run: () => navigate(`/invoices/new?client=${client.id}`) },
    { separator: true },
    { label: 'Record payment', icon: 'wallet', run: () => import('./payments.js').then((m) => m.recordPaymentDialog({ clientId: client.id })) },
    { label: 'Task or event', icon: 'calendar-plus', run: () => import('./schedule.js').then((m) => m.eventDialog({ clientId: client.id })) },
  ], { align: 'end', label: 'Create for this client' });
}

function moreMenu(anchor, client) {
  const store = app.store;
  openMenu(
    anchor,
    [
      client.archived
        ? { label: 'Unarchive client', icon: 'unarchive', run: () => (store.patch('clients', client.id, { archived: false }), toast('Client restored')) }
        : {
            label: 'Archive client',
            icon: 'archive',
            description: 'Hide from lists, keep all history',
            run: () => {
              store.patch('clients', client.id, { archived: true });
              toast('Client archived', { action: { label: 'Undo', run: () => store.patch('clients', client.id, { archived: false }) } });
            },
          },
      { separator: true },
      {
        label: 'Delete client',
        icon: 'trash',
        danger: true,
        run: async () => {
          const rec = clientRecords(store, client.id);
          const n = Object.values(rec).reduce((s, l) => s + l.length, 0);
          const ok = await confirmDialog({
            title: `Delete ${clientName(client)}?`,
            message: n
              ? `This also permanently deletes ${pluralize(n, 'linked record')} (requests, quotes, jobs, invoices and payments). Archiving keeps the history instead.`
              : 'This permanently deletes the client.',
            confirmLabel: 'Delete client',
            danger: true,
          });
          if (!ok) return;
          deleteClientCascade(store, client.id);
          deleteAttachments([client, ...Object.values(rec).flat()]);
          navigate('/clients');
          toast('Client deleted');
        },
      },
    ],
    { align: 'end' },
  );
}

export { invoiceBalance };
