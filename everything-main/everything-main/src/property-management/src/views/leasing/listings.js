/** Listings: vacant and soon-vacant units, their listing status, and applicants. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app } from '../../app.js';
import { pageHeader, stat, chips, dataTable, emptyState, field, textarea, moneyInput, textInput, statusPill } from '../../ui/components.js';
import { formDialog } from '../../ui/dialog.js';
import { openMenu } from '../../ui/menu.js';
import { setQuery } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { money, date } from '../common.js';
import { unitLabel } from '../../core/leases.js';
import { formatMoneyShort } from '../../core/money.js';
import { listingCandidates, listingStats, listingText } from './shared.js';
import { viewToggle } from '../maintenance/shared.js';

const VIEW_KEY = 'pm.listings.view';

export function render(ctx) {
  const store = app.store;
  const state = { filter: ctx.query.show || 'all', view: savedView() };

  const body = ctx.live(() => {
    const today = app.today();
    const all = listingCandidates({ units: store.all('units'), properties: store.all('properties'), leases: store.all('leases'), applicants: store.all('applicants'), today });
    const s = listingStats(all);
    const rows = all.filter((c) => (state.filter === 'listed' ? c.listed : state.filter === 'unlisted' ? !c.listed : true)).sort((a, b) => (a.state === b.state ? (a.availableFrom < b.availableFrom ? -1 : 1) : a.state === 'vacant' ? -1 : 1));
    return [
      h(
        'div.stats.list-stats',
        stat({ label: 'Vacant units', value: String(s.vacant), sub: s.leaving ? `${s.leaving} more ending soon` : 'Available now', tone: s.vacant ? 'warning' : null }),
        stat({ label: 'Listed', value: String(s.listed), sub: `of ${all.length} available`, onClick: () => setFilter('listed') }),
        stat({ label: 'Average days vacant', value: s.avgDaysVacant === null ? 'None' : String(s.avgDaysVacant), sub: 'Since the last tenant left' }),
        stat({ label: 'Rent not collected', value: formatMoneyShort(s.rentLost), sub: 'Per month across vacant units', tone: s.rentLost ? 'danger' : null }),
      ),
      h(
        'section.card.list-card',
        { 'aria-label': 'Units to lease' },
        h(
          'div.toolbar',
          chips({
            label: 'Listing status',
            selected: state.filter,
            onSelect: setFilter,
            items: [
              { id: 'all', label: 'All', count: all.length },
              { id: 'listed', label: 'Listed', count: all.filter((c) => c.listed).length },
              { id: 'unlisted', label: 'Not listed', count: all.filter((c) => !c.listed).length },
            ],
          }),
          h('div.grow'),
          viewToggle({
            label: 'Layout',
            value: state.view,
            items: [
              { value: 'grid', label: 'Cards', icon: 'grid' },
              { value: 'list', label: 'List', icon: 'list' },
            ],
            onChange: (v) => {
              state.view = v;
              try {
                localStorage.setItem(VIEW_KEY, v);
              } catch {}
              body.redraw();
            },
          }),
        ),
        h('div.sr-only', { role: 'status' }, `${rows.length} units`),
        !rows.length
          ? emptyState({
              compact: !!all.length,
              icon: 'key',
              headingLevel: 2,
              title: all.length ? 'Nothing matches this filter' : 'Every unit is leased',
              text: all.length ? 'Try another listing status.' : 'Units appear here when they are vacant or a tenant is moving out.',
            })
          : state.view === 'grid'
            ? h('ul.listing-grid', rows.map((c) => h('li', listingCard(c, today))))
            : dataTable({
                caption: 'Units to lease',
                rows,
                columns: [
                  { id: 'unit', label: 'Unit', cls: 'primary-cell', render: (c) => h('span', h('a', { href: `#/units/${c.unit.id}` }, unitLabel(c.property, c.unit)), h('span.sub', { style: { display: 'block' } }, specs(c.unit))) },
                  { id: 'status', label: 'Status', render: (c) => h('span.row', { style: { gap: '6px' } }, statusPill(c.state === 'vacant' ? 'vacant' : 'declined'), c.listed ? statusPill('listed') : null) },
                  { id: 'available', label: 'Available', render: (c) => (c.availableFrom <= today ? 'Now' : date(c.availableFrom)) },
                  { id: 'vacant', label: 'Days vacant', align: 'r', render: (c) => (c.daysVacant === null ? h('span.subtle', c.state === 'leaving' ? 'Occupied' : 'None') : String(c.daysVacant)) },
                  { id: 'applicants', label: 'Applicants', align: 'r', render: (c) => (c.applicants ? h('a', { href: `#/applicants?unit=${c.unit.id}` }, String(c.applicants)) : h('span.subtle', '0')) },
                  { id: 'rent', label: 'Rent', align: 'r', render: (c) => h('span.num', money(c.rent)) },
                  { id: 'actions', label: '', srLabel: 'Actions', align: 'r', render: (c) => actionsButton(c) },
                ],
                mobile: (c) => h('div.mobile-row', h('div.grow', { style: { minWidth: '0' } }, h('a.m-title', { href: `#/units/${c.unit.id}` }, unitLabel(c.property, c.unit)), h('div.m-sub', `${money(c.rent)} · ${c.availableFrom <= today ? 'Available now' : 'Available ' + date(c.availableFrom)}`)), h('div.m-end', c.listed ? statusPill('listed') : statusPill(c.state === 'vacant' ? 'vacant' : 'declined'), actionsButton(c))),
              }),
      ),
    ];
  }, ['units', 'leases', 'applicants', 'properties']);

  function setFilter(id) {
    state.filter = id;
    setQuery({ show: id === 'all' ? '' : id });
    body.redraw();
  }

  return {
    node: h('div.page', pageHeader({ title: 'Listings', subtitle: 'Vacant units and units with a tenant moving out' }), body),
    title: 'Listings',
  };
}

function savedView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function specs(unit) {
  return [unit.beds ? `${unit.beds} bd` : null, unit.baths ? `${unit.baths} ba` : null, unit.sqft ? `${unit.sqft.toLocaleString()} sq ft` : null].filter(Boolean).join(' · ') || 'No details yet';
}

function listingCard(c, today) {
  const u = c.unit;
  return h(
    'article.listing-card',
    { 'aria-labelledby': `lc-${u.id}` },
    h(
      'div.listing-top',
      h('div.grow', { style: { minWidth: '0' } }, h('h3.listing-title', { id: `lc-${u.id}` }, h('a', { href: `#/units/${u.id}` }, unitLabel(c.property, u))), h('div.listing-specs', specs(u))),
      actionsButton(c),
    ),
    h('div.listing-rent', h('span.num', money(c.rent)), h('span.subtle', ' / month')),
    h(
      'div.listing-tags',
      c.listed ? statusPill('listed') : h('span.pill', 'Not listed'),
      c.state === 'leaving' ? statusPill('declined') : statusPill('vacant'),
    ),
    h(
      'dl.listing-facts',
      h('div', h('dt', 'Available'), h('dd', c.availableFrom <= today ? 'Now' : date(c.availableFrom, { month: 'short', day: 'numeric' }))),
      h('div', h('dt', 'Days vacant'), h('dd', c.daysVacant === null ? (c.state === 'leaving' ? 'Occupied' : 'None') : String(c.daysVacant))),
      h('div', h('dt', 'Applicants'), h('dd', c.applicants ? h('a', { href: `#/applicants?unit=${u.id}` }, String(c.applicants)) : '0')),
    ),
    h(
      'div.listing-actions',
      c.listed
        ? h('button.btn.sm', { type: 'button', onClick: () => listingDialog(c) }, icon('pencil', 14), 'Edit listing')
        : h('button.btn.sm.primary', { type: 'button', onClick: () => listingDialog(c) }, icon('megaphone', 14), 'List unit'),
      h('a.btn.sm.ghost', { href: `#/applicants/new?unitId=${u.id}` }, icon('user-plus', 14), 'Add applicant'),
    ),
  );
}

function actionsButton(c) {
  return h(
    'button.icon-btn.sm',
    {
      type: 'button',
      'aria-label': `Actions for ${unitLabel(c.property, c.unit)}`,
      onClick: (e) =>
        openMenu(e.currentTarget, [
          c.listed ? { label: 'Edit listing', icon: 'pencil', run: () => listingDialog(c) } : { label: 'List unit', icon: 'megaphone', run: () => listingDialog(c) },
          c.listed ? { label: 'Unlist', icon: 'eye-off', run: () => unlist(c) } : null,
          { label: 'Copy listing text', icon: 'copy', run: () => copyText(c) },
          { separator: true },
          { label: 'View applicants', icon: 'users', href: `#/applicants?unit=${c.unit.id}` },
          { label: 'Add applicant', icon: 'user-plus', href: `#/applicants/new?unitId=${c.unit.id}` },
          { label: 'Open unit', icon: 'door', href: `#/units/${c.unit.id}` },
        ]),
    },
    icon('more', 16),
  );
}

async function listingDialog(c) {
  const u = c.unit;
  const l = u.listing || {};
  const rent = moneyInput({ name: 'rent', cents: l.rent || u.marketRent || 0, required: true });
  const available = textInput({ type: 'date', name: 'available', value: l.available || c.availableFrom });
  const desc = textarea({ name: 'description', rows: 5, value: l.description || '', placeholder: 'Highlights, layout, parking, pets, utilities included' });
  await formDialog({
    title: l.listed ? 'Edit listing' : `List ${unitLabel(c.property, u)}`,
    submitLabel: l.listed ? 'Save listing' : 'List unit',
    body: h('div.form-grid', field('Monthly rent', rent, { required: true }), field('Available from', available), field('Description', desc, { span2: true, hint: 'Shown on the listing and copied with the listing text.' })),
    onSubmit: () => {
      if (!rent.cents) {
        rent.setAttribute('aria-invalid', 'true');
        rent.focus();
        return false;
      }
      app.store.patch('units', u.id, (x) => ((x.listing = { ...(x.listing || {}), listed: true, rent: rent.cents, available: available.value || null, description: desc.value.trim(), listedOn: x.listing?.listed ? x.listing.listedOn : app.today() }), x));
      toast(l.listed ? 'Listing updated' : 'Unit listed');
    },
  });
}

function unlist(c) {
  const before = c.unit.listing;
  app.store.patch('units', c.unit.id, (x) => ((x.listing = { ...(x.listing || {}), listed: false }), x));
  toast('Listing removed', { action: { label: 'Undo', run: () => app.store.patch('units', c.unit.id, { listing: before }) } });
}

async function copyText(c) {
  const text = listingText(c, { money, date });
  try {
    await navigator.clipboard.writeText(text);
    toast('Listing text copied');
  } catch {
    toast('Could not copy to the clipboard', { type: 'error' });
  }
}
