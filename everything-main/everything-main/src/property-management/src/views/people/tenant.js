/** Tenant page: contact details, leases, recent ledger activity, messages, notes and files. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, emptyState, moreButton, statusPill } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { navigate } from '../../ui/router.js';
import { personName, telHref, primaryEmail } from '../../core/format.js';
import { leaseStatus, monthlyRent, effectiveEnd } from '../../core/leases.js';
import { kindLabel, leaseEffect } from '../../core/ledger.js';
import { money, balanceCell, date, kvList, notesCard, sectionEmpty, deleteWithUndo, personAvatar } from '../common.js';
import { attachmentsCard } from '../attachments.js';
import { tenantLeases, tenantStatus, primaryLease, TENANT_STATUS, tonePill, tx } from '../properties/shared.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  let title = 'Tenant';

  const body = ctx.live(draw, ['tenants', 'leases', 'transactions', 'units', 'properties', 'messages']);

  function draw() {
    const t = store.get('tenants', id);
    if (!t) return emptyState({ icon: 'users', title: 'Tenant not found', text: 'This tenant may have been deleted.', headingLevel: 1, actions: [h('a.btn.primary', { href: '#/tenants' }, 'Back to tenants')] });
    title = personName(t);
    const status = tenantStatus(t.id);
    const lease = primaryLease(t.id);
    const header = pageHeader({
      title: h('span.row.rn-title', personAvatar(t, { size: 'lg' }), personName(t), tonePill(TENANT_STATUS[status].label, TENANT_STATUS[status].tone)),
      crumbs: [{ label: 'Tenants', href: '#/tenants' }],
      subtitle: lease ? h('span', h('a', { href: `#/leases/${lease.id}` }, lookup.leaseLabel(lease)), t.company && (t.firstName || t.lastName) ? ` · ${t.company}` : null) : t.company || null,
      actions: [
        moreButton((btn) => moreMenu(btn, t)),
        h('a.btn.hide-mobile', { href: `#/tenants/${t.id}/edit` }, icon('pencil', 16), 'Edit'),
        primaryEmail(t) ? h('button.btn', { type: 'button', onClick: () => email(t, lease) }, icon('mail', 16), 'Email') : null,
        lease ? h('button.btn.primary', { type: 'button', onClick: () => tx().then((m) => m.receivePaymentDialog({ leaseId: lease.id })) }, icon('hand-coins', 16), 'Receive payment') : null,
      ],
    });
    return [header, h('div.detail', h('div.detail-main', lease ? ledgerCard(lease) : null, leasesCard(t), messagesCard(t), attachmentsCard('tenants', t, { folder: `files/tenants/${t.id}` })), h('div.detail-aside', contactCard(t), extrasCard(t), notesCard('tenants', t)))];
  }

  function email(t, lease) {
    import('../compose.js').then((m) =>
      m.composeEmail({ to: [{ name: personName(t), email: primaryEmail(t), tenantId: t.id }], subject: '', body: '', related: { leaseId: lease?.id || null, propertyId: lease?.propertyId || null } }),
    );
  }

  function ledgerCard(lease) {
    const info = app.ledger().lease(lease.id);
    const recent = store
      .all('transactions')
      .filter((x) => !x.voided && x.leaseId === lease.id && leaseEffect(x, lease.id))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || '').localeCompare(a.createdAt || '')))
      .slice(0, 5);
    return h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Account'), h('a.btn.sm.ghost', { href: `#/leases/${lease.id}?tab=ledger` }, 'Full ledger')),
      h(
        'div.card-body.stack',
        h(
          'div.rn-lease-summary',
          h('div', h('div.section-title', 'Balance'), h('div.rn-big', balanceCell(info.balance))),
          h('div', h('div.section-title', 'Rent'), h('div.rn-big.num', money(monthlyRent(lease, app.today())))),
          h('div', h('div.section-title', 'Deposits held'), h('div.rn-big.num', money(info.deposits))),
          h('div', h('div.section-title', 'Last payment'), h('div.rn-big', info.lastPayment ? date(info.lastPayment.date) : 'None')),
        ),
      ),
      recent.length
        ? h(
            'ul.list.rn-ledger-mini',
            recent.map((x) => {
              const eff = leaseEffect(x, lease.id);
              return h(
                'li',
                h(
                  'a.list-item',
                  { href: `#/transactions/${x.id}` },
                  h('span.rn-date', date(x.date, { month: 'short', day: 'numeric' })),
                  h('div.grow', h('div.title', x.memo || kindLabel(x.kind)), h('div.meta', kindLabel(x.kind))),
                  h(`span.num${eff < 0 ? '.credit' : ''}`, money(eff)),
                ),
              );
            }),
          )
        : sectionEmpty('No transactions yet.'),
      h(
        'div.rn-card-actions',
        h('button.btn.sm.primary', { type: 'button', onClick: () => tx().then((m) => m.receivePaymentDialog({ leaseId: lease.id })) }, 'Receive payment'),
        h('button.btn.sm', { type: 'button', onClick: () => tx().then((m) => m.chargeDialog({ leaseId: lease.id })) }, 'Enter charge'),
        h('button.btn.sm', { type: 'button', onClick: () => tx().then((m) => m.creditDialog({ leaseId: lease.id })) }, 'Issue credit'),
      ),
    );
  }

  function leasesCard(t) {
    const today = app.today();
    const leases = tenantLeases(t.id);
    const ledger = app.ledger();
    return h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Leases', leases.length ? h('span.count', ` ${leases.length}`) : null), h('a.btn.sm.ghost', { href: `#/leases/new?tenantId=${t.id}` }, icon('plus', 14), 'New lease')),
      leases.length
        ? h(
            'ul.list',
            leases.map((l) => {
              const end = effectiveEnd(l) || (l.type !== 'at-will' ? l.end : null);
              return h(
                'li',
                h(
                  'a.list-item',
                  { href: `#/leases/${l.id}` },
                  h('div.grow', h('div.title', lookup.leaseLabel(l)), h('div.meta', `${date(l.start)}${end ? ` to ${date(end)}` : ', month-to-month'} · ${money(monthlyRent(l, app.today()))}/mo`)),
                  ledger.lease(l.id).balance ? balanceCell(ledger.lease(l.id).balance) : null,
                  statusPill(leaseStatus(l, today)),
                ),
              );
            }),
          )
        : sectionEmpty('Not on any lease yet.', h('a.btn.sm', { href: `#/leases/new?tenantId=${t.id}` }, 'Create lease')),
    );
  }

  function messagesCard(t) {
    const msgs = store
      .all('messages')
      .filter((m) => (m.to || []).some((r) => r.tenantId === t.id))
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 8);
    return h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Messages', msgs.length ? h('span.count', ` ${msgs.length}`) : null), primaryEmail(t) ? h('button.btn.sm.ghost', { type: 'button', onClick: () => email(t, primaryLease(t.id)) }, icon('mail', 14), 'Email') : null),
      msgs.length
        ? h(
            'ul.list',
            msgs.map((m) =>
              h(
                'li',
                h(
                  'div.list-item',
                  h('div.grow', h('div.title', m.subject || '(No subject)'), h('div.meta.truncate', (m.body || '').slice(0, 140))),
                  h('span.rn-when', m.at ? date(m.at) : ''),
                  m.status ? statusPill(m.status) : null,
                ),
              ),
            ),
          )
        : sectionEmpty('No messages yet.'),
    );
  }

  function contactCard(t) {
    const emails = t.emails || [];
    const phones = t.phones || [];
    return h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Contact')),
      h(
        'div.card-body',
        kvList([
          ['Email', emails.length ? h('div.stack.sm', emails.map((e) => h('a', { href: `mailto:${e}` }, e))) : h('span.subtle', 'None')],
          ['Phone', phones.length ? h('div.stack.sm', phones.map((p) => h('a', { href: telHref(p) }, p))) : h('span.subtle', 'None')],
          ['Company', t.company || ''],
          ['Date of birth', t.dob ? date(t.dob) : ''],
        ]),
      ),
    );
  }

  function extrasCard(t) {
    const e = t.emergency || {};
    const vehicles = t.vehicles || [];
    const pets = t.pets || [];
    return h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Household'), h('a.btn.sm.ghost', { href: `#/tenants/${t.id}/edit` }, 'Edit')),
      h(
        'div.card-body.stack',
        h('div', h('div.section-title', 'Emergency contact'), e.name || e.phone ? h('div.rn-line', [e.name, e.relation ? `(${e.relation})` : '', e.phone ? h('a', { href: telHref(e.phone) }, e.phone) : ''].filter(Boolean).flatMap((x, i) => (i ? [' ', x] : [x]))) : h('div.subtle', 'None')),
        h('div', h('div.section-title', 'Vehicles'), vehicles.length ? h('ul.rn-plain', vehicles.map((v) => h('li', [v.color, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle', v.plate ? h('span.subtle', ` · ${v.plate}`) : null))) : h('div.subtle', 'None')),
        h('div', h('div.section-title', 'Pets'), pets.length ? h('ul.rn-plain', pets.map((p) => h('li', [p.name, p.type ? `(${p.type})` : ''].filter(Boolean).join(' ') || 'Pet', p.notes ? h('span.subtle', ` · ${p.notes}`) : null))) : h('div.subtle', 'None')),
      ),
    );
  }

  function moreMenu(btn, t) {
    const onLease = tenantLeases(t.id).length > 0;
    openMenu(btn, [
      { label: 'Edit tenant', icon: 'pencil', href: `#/tenants/${t.id}/edit` },
      { label: 'New lease', icon: 'file-signature', href: `#/leases/new?tenantId=${t.id}` },
      { label: 'New task', icon: 'list-checks', href: `#/tasks/new?tenantId=${t.id}` },
      { separator: true },
      {
        label: 'Delete tenant',
        icon: 'trash',
        danger: true,
        disabled: onLease,
        description: onLease ? 'Tenants on a lease cannot be deleted' : null,
        run: () => deleteWithUndo('tenants', t, { title: `Delete ${personName(t)}?`, label: 'Tenant deleted', after: () => navigate('/tenants') }),
      },
    ]);
  }

  return {
    node: h('div.page', body),
    get title() {
      return title;
    },
  };
}
