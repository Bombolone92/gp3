/** Unit page: details, current lease, history, listing, maintenance, notes and files. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup, occupancyMap } from '../../app.js';
import { pageHeader, emptyState, moreButton, statusPill } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { confirmDialog } from '../../ui/dialog.js';
import { navigate } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { displayName } from '../../core/format.js';
import { leaseStatus, monthlyRent, effectiveEnd, unitLeases } from '../../core/leases.js';
import { leaseTypeLabel as typeLabel } from '../../core/settings.js';
import { OPEN_WORK_ORDER } from '../../core/counts.js';
import { money, balanceCell, date, kvList, notesCard, sectionEmpty, unitStatus } from '../common.js';
import { attachmentsCard } from '../attachments.js';
import { unitDialog, listingDialog, unlistUnit, tx, recordsUsing, listWords } from './shared.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  let title = 'Unit';

  const body = ctx.live(draw, ['units', 'properties', 'leases', 'tenants', 'transactions', 'workOrders', 'vendors']);

  function draw() {
    const u = store.get('units', id);
    const p = u ? store.get('properties', u.propertyId) : null;
    if (!u || !p) {
      return emptyState({ icon: 'door', title: 'Unit not found', text: 'It may have been deleted.', headingLevel: 1, actions: [h('a.btn.primary', { href: '#/properties' }, 'Back to properties')] });
    }
    title = lookup.unitLabel(u.id);
    const today = app.today();
    const current = occupancyMap().get(u.id) || null;
    const status = unitStatus(u);
    const header = pageHeader({
      title: h('span.row.rn-title', p.singleUnit ? p.name : `Unit ${u.name}`, statusPill(status)),
      crumbs: [{ label: 'Properties', href: '#/properties' }, { label: p.name, href: `#/properties/${p.id}?tab=units` }],
      subtitle: [u.beds !== null && u.beds !== undefined ? `${u.beds} bd` : null, u.baths !== null && u.baths !== undefined ? `${u.baths} ba` : null, u.sqft ? `${u.sqft.toLocaleString()} sq ft` : null].filter(Boolean).join(' · ') || null,
      actions: [
        moreButton((btn) => moreMenu(btn, u)),
        h('button.btn', { type: 'button', onClick: () => unitDialog(u.propertyId, u) }, icon('pencil', 16), 'Edit'),
        current
          ? h('button.btn.primary', { type: 'button', onClick: () => tx().then((m) => m.receivePaymentDialog({ leaseId: current.id })) }, icon('hand-coins', 16), 'Receive payment')
          : h('a.btn.primary', { href: `#/leases/new?unitId=${u.id}` }, icon('plus', 16), 'New lease'),
      ],
    });

    const details = h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Unit details')),
      h(
        'div.card-body',
        kvList([
          ['Property', h('a', { href: `#/properties/${p.id}` }, p.name)],
          ['Bedrooms', u.beds ?? ''],
          ['Bathrooms', u.baths ?? ''],
          ['Size', u.sqft ? `${u.sqft.toLocaleString()} sq ft` : ''],
          ['Market rent', money(u.marketRent || 0)],
          ['Description', u.description || ''],
        ]),
      ),
    );

    return [header, h('div.detail', h('div.detail-main', currentCard(u, current, today), historyCard(u, today), maintenanceCard(u), attachmentsCard('units', u, { folder: `files/units/${u.id}` })), h('div.detail-aside', details, current ? null : listingCard(u), notesCard('units', u)))];
  }

  function currentCard(u, lease, today) {
    if (!lease) {
      const next = unitLeases(store, u.id).find((l) => leaseStatus(l, today) === 'future');
      return h(
        'section.card',
        h('div.card-head', h('h2.grow', 'Current lease')),
        h(
          'div.card-body.stack',
          h('p.subtle', next ? `Vacant now. A lease for ${lookup.tenantNames(next) || 'new tenants'} starts ${date(next.start)}.` : 'This unit is vacant.'),
          h('div.row', next ? h('a.btn', { href: `#/leases/${next.id}` }, 'Open upcoming lease') : null, h('a.btn.primary', { href: `#/leases/new?unitId=${u.id}` }, icon('plus', 16), 'New lease')),
        ),
      );
    }
    const info = app.ledger().lease(lease.id);
    const end = effectiveEnd(lease) || (lease.type !== 'at-will' ? lease.end : null);
    return h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Current lease'), h('a.btn.sm.ghost', { href: `#/leases/${lease.id}` }, 'Open lease')),
      h(
        'div.card-body.stack',
        h(
          'div.rn-lease-summary',
          h('div', h('div.section-title', 'Tenants'), h('div.rn-people', lease.tenantIds.length ? lease.tenantIds.map((t) => h('a', { href: `#/tenants/${t}` }, lookup.tenantNames({ tenantIds: [t] }))) : h('span.subtle', 'None'))),
          h('div', h('div.section-title', 'Rent'), h('div.num.rn-big', money(monthlyRent(lease, app.today()))), h('div.subtle', typeLabel(lease.type))),
          h('div', h('div.section-title', 'Balance'), h('div.rn-big', balanceCell(info.balance)), info.lastPayment ? h('div.subtle', `Last paid ${date(info.lastPayment.date)}`) : h('div.subtle', 'No payments yet')),
          h('div', h('div.section-title', 'Ends'), h('div.rn-big', end ? date(end) : 'Month-to-month'), lease.moveOut?.date ? h('div.subtle', 'Moving out') : null),
        ),
        h(
          'div.row.rn-wrap',
          h('button.btn.sm.primary', { type: 'button', onClick: () => tx().then((m) => m.receivePaymentDialog({ leaseId: lease.id })) }, icon('hand-coins', 14), 'Receive payment'),
          h('button.btn.sm', { type: 'button', onClick: () => tx().then((m) => m.chargeDialog({ leaseId: lease.id })) }, 'Enter charge'),
          h('a.btn.sm', { href: `#/leases/${lease.id}?tab=ledger` }, 'Ledger'),
        ),
      ),
    );
  }

  function historyCard(u, today) {
    const leases = unitLeases(store, u.id);
    const ledger = app.ledger();
    return h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Lease history', leases.length ? h('span.count', ` ${leases.length}`) : null)),
      leases.length
        ? h(
            'ul.list',
            leases.map((l) =>
              h(
                'li',
                h(
                  'a.list-item',
                  { href: `#/leases/${l.id}` },
                  h('div.grow', h('div.title', lookup.tenantNames(l) || 'No tenants'), h('div.meta', `${date(l.start)}${l.end && l.type !== 'at-will' ? ` to ${date(effectiveEnd(l) || l.end)}` : effectiveEnd(l) ? ` to ${date(effectiveEnd(l))}` : ', month-to-month'} · ${money(monthlyRent(l, app.today()))}/mo`)),
                  ledger.lease(l.id).balance ? balanceCell(ledger.lease(l.id).balance) : null,
                  statusPill(leaseStatus(l, today)),
                ),
              ),
            ),
          )
        : sectionEmpty('No leases on this unit yet.'),
    );
  }

  function listingCard(u) {
    const l = u.listing;
    return h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Listing'), l?.listed ? statusPill('listed') : null),
      l?.listed
        ? h(
            'div.card-body.stack',
            kvList([
              ['Asking rent', money(l.rent || 0)],
              ['Available', l.available ? date(l.available) : 'Now'],
              ['Listed', l.listedOn ? date(l.listedOn) : ''],
            ]),
            l.description ? h('p.rn-listing-text', l.description) : null,
            h('div.row', h('button.btn.sm', { type: 'button', onClick: () => listingDialog(u) }, 'Edit listing'), h('button.btn.sm.ghost', { type: 'button', onClick: () => unlistUnit(u) }, 'Remove listing')),
          )
        : h('div.card-body.stack', h('p.subtle', 'Not listed. Listing a vacant unit shows it under Leasing and lets you track applicants for it.'), h('div', h('button.btn.sm.primary', { type: 'button', onClick: () => listingDialog(u) }, icon('megaphone', 14), 'List for rent'))),
    );
  }

  function maintenanceCard(u) {
    const wos = store
      .all('workOrders')
      .filter((w) => w.unitId === u.id)
      .sort((a, b) => Number(OPEN_WORK_ORDER.has(b.status)) - Number(OPEN_WORK_ORDER.has(a.status)) || (b.dueDate || '').localeCompare(a.dueDate || ''));
    return h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Work orders', wos.length ? h('span.count', ` ${wos.length}`) : null), h('a.btn.sm.ghost', { href: `#/work-orders/new?propertyId=${u.propertyId}&unitId=${u.id}` }, icon('plus', 14), 'New')),
      wos.length
        ? h(
            'ul.list',
            wos.slice(0, 10).map((w) =>
              h(
                'li',
                h('a.list-item', { href: `#/work-orders/${w.id}` }, h('div.grow', h('div.title', w.title), h('div.meta', [w.vendorId ? displayName(lookup.vendor(w.vendorId)) : 'No vendor', w.dueDate ? `due ${date(w.dueDate)}` : ''].filter(Boolean).join(' · '))), statusPill(w.status)),
              ),
            ),
          )
        : sectionEmpty('No work orders for this unit.'),
    );
  }

  function moreMenu(btn, u) {
    const uses = recordsUsing({ unitId: u.id });
    const occupied = !!occupancyMap().get(u.id);
    openMenu(btn, [
      { label: 'Edit unit', icon: 'pencil', run: () => unitDialog(u.propertyId, u) },
      { label: 'New lease', icon: 'file-signature', href: `#/leases/new?unitId=${u.id}` },
      { label: 'New work order', icon: 'wrench', href: `#/work-orders/new?propertyId=${u.propertyId}&unitId=${u.id}` },
      occupied ? null : u.listing?.listed ? { label: 'Remove listing', icon: 'eye-off', run: () => unlistUnit(u) } : { label: 'List for rent', icon: 'megaphone', run: () => listingDialog(u) },
      { separator: true },
      {
        label: 'Delete unit',
        icon: 'trash',
        danger: true,
        disabled: uses.length > 0,
        description: uses.length ? `Has ${listWords(uses)}` : null,
        run: async () => {
          const ok = await confirmDialog({ title: `Delete unit ${u.name}?`, message: 'This cannot be undone after you leave this page.', confirmLabel: 'Delete unit', danger: true });
          if (!ok) return;
          const removed = store.remove('units', u.id);
          navigate(`/properties/${u.propertyId}?tab=units`);
          toast(`Unit ${u.name} deleted`, { action: { label: 'Undo', run: () => store.restore('units', removed) } });
        },
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
