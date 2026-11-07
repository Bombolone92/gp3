/** Renewals: leases ending soon, by renewal decision, plus month-to-month leases. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, statusPill, stat, field, moneyInput, textInput, textarea, dataTable, emptyState } from '../../ui/components.js';
import { formDialog } from '../../ui/dialog.js';
import { openMenu } from '../../ui/menu.js';
import { navigate, setQuery } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { money, date } from '../common.js';
import { addMonths, addDays, diffDays } from '../../core/dates.js';
import { pluralize } from '../../core/format.js';
import { statusLabel } from '../../core/status.js';
import { renewalBuckets, RENEWAL_COLUMNS, raiseRent } from './shared.js';
import { monthlyRent } from '../../core/leases.js';
import { filterSelect } from '../maintenance/shared.js';

const WINDOWS = [60, 90, 120, 180];

export function render(ctx) {
  const store = app.store;
  const state = { window: WINDOWS.includes(Number(ctx.query.days)) ? Number(ctx.query.days) : 120 };

  const body = ctx.live(() => {
    const today = app.today();
    const notice = app.settings().leases?.noticeDays ?? 60;
    const { columns, monthToMonth } = renewalBuckets(store.all('leases'), today, { windowDays: state.window, noticeDays: notice });
    const total = RENEWAL_COLUMNS.reduce((s, c) => s + columns[c].length, 0);
    const urgent = columns['not-started'].filter((r) => r.expiringSoon).length;
    return [
      h(
        'div.stats.list-stats',
        stat({ label: 'Ending soon', value: String(total), sub: `Next ${state.window} days` }),
        stat({ label: 'No decision yet', value: String(columns['not-started'].length), sub: urgent ? `${urgent} within ${notice} days` : 'Offers not sent', tone: urgent ? 'danger' : null }),
        stat({ label: 'Offers out', value: String(columns.offered.length), sub: 'Waiting on tenants' }),
        stat({ label: 'Moving out', value: String(columns.declined.length), sub: columns.declined.length ? 'List these units' : 'None', href: columns.declined.length ? '#/listings' : null }),
      ),
      h(
        'div.toolbar',
        h('h2.section-heading.grow', 'Fixed-term leases'),
        filterSelect({
          label: 'Ending within',
          value: String(state.window),
          options: WINDOWS.map((d) => ({ value: String(d), label: `Ending within ${d} days` })),
          onChange: (v) => {
            state.window = Number(v);
            setQuery({ days: v === '120' ? '' : v });
            body.redraw();
          },
        }),
      ),
      h(
        'div.board.renewal-board',
        { role: 'list', 'aria-label': 'Renewals by status' },
        RENEWAL_COLUMNS.map((status) =>
          h(
            'section.board-col',
            { role: 'listitem', 'aria-label': `${statusLabel(status)}, ${columns[status].length}` },
            h('header.board-head', statusPill(status), h('span.board-count', String(columns[status].length))),
            columns[status].length ? h('ul.board-list', columns[status].map((r) => h('li', renewalCard(r, status, today)))) : h('p.board-empty', 'None'),
          ),
        ),
      ),
      h('h2.section-heading', { style: { marginTop: '28px' } }, 'Month-to-month'),
      h(
        'section.card.list-card',
        { 'aria-label': 'Month-to-month leases' },
        dataTable({
          caption: 'Month-to-month leases',
          rows: monthToMonth,
          rowHref: (r) => `#/leases/${r.lease.id}`,
          columns: [
            { id: 'lease', label: 'Lease', cls: 'primary-cell', render: (r) => h('span', lookup.leaseLabel(r.lease), h('span.sub', { style: { display: 'block' } }, lookup.tenantNames(r.lease) || 'No tenants')) },
            { id: 'since', label: 'Month-to-month since', render: (r) => date(r.since) },
            { id: 'months', label: 'Months', align: 'r', render: (r) => String(Math.max(0, Math.floor(diffDays(r.since, today) / 30.44))) },
            { id: 'rent', label: 'Rent', align: 'r', render: (r) => h('span.num', money(r.rent)) },
            { id: 'act', label: '', srLabel: 'Actions', align: 'r', render: (r) => h('a.btn.sm', { href: `#/leases/new?renews=${r.lease.id}` }, 'Offer a new term') },
          ],
          mobile: (r) => h('a.mobile-row', { href: `#/leases/${r.lease.id}` }, h('div.grow', { style: { minWidth: '0' } }, h('div.m-title', lookup.leaseLabel(r.lease)), h('div.m-sub', `${lookup.tenantNames(r.lease) || 'No tenants'} · since ${date(r.since)}`)), h('div.m-end', h('span.num', money(r.rent)))),
          empty: emptyState({ compact: true, icon: 'repeat', title: 'No month-to-month leases', headingLevel: 3 }),
        }),
      ),
    ];
  }, ['leases', 'tenants', 'settings']);

  return { node: h('div.page', pageHeader({ title: 'Renewals', subtitle: 'Decide early: send offers well before the notice period ends.' }), body), title: 'Renewals' };
}

function renewalCard(r, status, today) {
  const l = r.lease;
  const actions = [];
  if (status === 'not-started') actions.push(h('button.btn.sm.primary', { type: 'button', onClick: () => offerDialog(l) }, 'Send offer'));
  if (status === 'offered') actions.push(h('button.btn.sm.primary', { type: 'button', onClick: () => accept(l) }, 'Accepted'));
  if (status === 'accepted' && !r.renewed) actions.push(h('a.btn.sm.primary', { href: `#/leases/new?renews=${l.id}` }, 'Create renewal lease'));
  if (r.renewed) actions.push(h('a.btn.sm', { href: `#/leases/${r.renewed.id}` }, icon('check', 14), 'Renewal lease'));
  return h(
    `article.board-card${r.expiringSoon && status === 'not-started' ? '.urgent' : ''}`,
    h(
      'div.board-card-top',
      h('a.board-card-title', { href: `#/leases/${l.id}` }, lookup.leaseLabel(l)),
      h('button.icon-btn.sm', { type: 'button', 'aria-label': `Renewal actions for ${lookup.leaseLabel(l)}`, onClick: (e) => openMenu(e.currentTarget, menuItems(l, status, r)) }, icon('more', 16)),
    ),
    h('div.board-card-sub', lookup.tenantNames(l) || 'No tenants'),
    h(
      'div.board-card-meta',
      h(`span${r.expiringSoon ? '.due-soon' : ''}`, { title: status === 'declined' ? 'Move-out date' : 'Lease end' }, icon('calendar-clock', 13), `${date(l.moveOut?.date || l.end, { month: 'short', day: 'numeric' })} (${r.daysLeft === 0 ? 'today' : pluralize(r.daysLeft, 'day')})`),
    ),
    h(
      'div.renewal-rents',
      h('span', h('span.subtle', 'Rent '), h('span.num', money(r.rent))),
      r.offerRent ? h('span', h('span.subtle', 'Offer '), h('span.num', money(r.offerRent)), r.rent ? h('span.subtle', ` (${r.offerRent >= r.rent ? '+' : ''}${(((r.offerRent - r.rent) / r.rent) * 100).toFixed(1)}%)`) : null) : null,
    ),
    l.renewal?.notes ? h('p.board-card-note', l.renewal.notes) : null,
    actions.length ? h('div.board-card-actions', actions) : null,
  );
}

function menuItems(l, status, r) {
  return [
    status !== 'declined' ? { label: status === 'offered' ? 'Edit offer' : 'Send offer', icon: 'send', run: () => offerDialog(l) } : null,
    ['not-started', 'offered'].includes(status) ? { label: 'Mark accepted', icon: 'check', run: () => accept(l) } : null,
    status !== 'declined' && !r.renewed ? { label: 'Mark moving out', icon: 'log-out', run: () => declineDialog(l) } : null,
    status === 'declined' && l.moveOut?.date ? { label: 'Cancel move-out', icon: 'undo', run: () => cancelMoveOut(l) } : null,
    status !== 'not-started' && !r.renewed && !(status === 'declined' && l.moveOut?.date) ? { label: 'Reset', icon: 'undo', run: () => reset(l) } : null,
    { separator: true },
    { label: 'Open lease', icon: 'file-signature', href: `#/leases/${l.id}` },
  ];
}

function setRenewal(l, renewal, msg) {
  const before = { renewal: l.renewal || null, moveOut: l.moveOut || null };
  app.store.patch('leases', l.id, (x) => ((x.renewal = renewal), x));
  toast(msg, { action: { label: 'Undo', run: () => app.store.patch('leases', l.id, before) } });
}

async function offerDialog(l) {
  const rentNow = monthlyRent(l, app.today());
  const cur = l.renewal || {};
  const rent = moneyInput({ name: 'rent', cents: cur.offerRent || raiseRent(rentNow, 3), required: true });
  const pct = textInput({ type: 'number', name: 'pct', step: '0.5', value: rentNow && cur.offerRent ? (((cur.offerRent - rentNow) / rentNow) * 100).toFixed(1) : '3', 'aria-label': 'Increase in percent' });
  pct.addEventListener('input', () => (rent.cents = raiseRent(rentNow, pct.value)));
  rent.addEventListener('input', () => {
    if (rentNow) pct.value = (((rent.cents - rentNow) / rentNow) * 100).toFixed(1);
  });
  const end = textInput({ type: 'date', name: 'end', value: cur.offerEnd || (l.end ? addMonths(l.end, 12) : addDays(addMonths(app.today(), 12), -1)) });
  const notes = textarea({ name: 'notes', rows: 3, value: cur.notes || '', placeholder: 'Terms, incentives, or what the tenant said' });
  await formDialog({
    title: `Renewal offer for ${lookup.leaseLabel(l)}`,
    submitLabel: cur.status === 'offered' ? 'Save offer' : 'Mark offer sent',
    body: h(
      'div.stack',
      h('p.subtle', `Current rent ${money(rentNow)} per month. Lease ends ${date(l.end)}.`),
      h('div.form-grid', field('New monthly rent', rent, { required: true }), field('Change (%)', pct), field('New lease end', end), field('Notes', notes, { span2: true })),
    ),
    onSubmit: () => {
      if (!rent.cents) {
        rent.focus();
        return false;
      }
      setRenewal(l, { ...cur, status: 'offered', offerRent: rent.cents, offerEnd: end.value || null, notes: notes.value.trim(), offeredOn: cur.offeredOn || app.today() }, 'Renewal offer recorded');
    },
  });
}

function accept(l) {
  app.store.patch('leases', l.id, (x) => ((x.renewal = { ...(x.renewal || {}), status: 'accepted', acceptedOn: app.today() }), x));
  toast('Renewal accepted. Set up the new lease term.');
  navigate(`/leases/new?renews=${l.id}`);
}

async function declineDialog(l) {
  const notice = textInput({ type: 'date', name: 'notice', value: app.today() });
  const moveOut = textInput({ type: 'date', name: 'moveOut', value: l.end || addDays(app.today(), 30) });
  const reason = textInput({ name: 'reason', value: l.renewal?.notes || '', placeholder: 'e.g. Buying a home' });
  const record = h('input', { type: 'checkbox', checked: true });
  const fields = h('div.form-grid', field('Notice received', notice), field('Move-out date', moveOut), field('Reason', reason, { span2: true }));
  record.addEventListener('change', () => (fields.hidden = !record.checked));
  await formDialog({
    title: 'Tenant is moving out',
    submitLabel: 'Save',
    body: h('div.stack', h('label.check', record, 'Record the move-out on the lease'), fields, h('p.subtle', { style: { fontSize: '13px' } }, 'Recording a move-out stops rent charges after that date and shows the unit on Listings.')),
    onSubmit: () => {
      const before = { renewal: l.renewal || null, moveOut: l.moveOut || null };
      app.store.patch('leases', l.id, (x) => {
        x.renewal = { ...(x.renewal || {}), status: 'declined', notes: reason.value.trim() || x.renewal?.notes || '' };
        if (record.checked && moveOut.value) x.moveOut = { ...(x.moveOut || {}), date: moveOut.value, noticeDate: notice.value || null, reason: reason.value.trim() };
        return x;
      });
      toast('Marked as moving out', { action: { label: 'Undo', run: () => app.store.patch('leases', l.id, before) } });
    },
  });
}

function reset(l) {
  setRenewal(l, { status: 'not-started' }, 'Renewal reset');
}

function cancelMoveOut(l) {
  const before = { renewal: l.renewal || null, moveOut: l.moveOut || null };
  app.store.patch('leases', l.id, { moveOut: null, renewal: { status: 'not-started' } });
  toast('Move-out cancelled', { action: { label: 'Undo', run: () => app.store.patch('leases', l.id, before) } });
}
