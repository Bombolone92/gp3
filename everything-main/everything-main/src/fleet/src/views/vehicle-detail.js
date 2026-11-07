import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, canEdit } from '../app.js';
import { setQuery } from '../ui/router.js';
import { openMenu } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { navigate } from '../ui/router.js';
import { vehicleName, vehicleDescription, contactName, formatEconomy, formatDecimal, formatDuration } from '../core/format.js';
import { formatDate, relativeDays, addDays, diffDays, lastMonths, monthShort, formatTime } from '../core/dates.js';
import { OWNERSHIP, statusMeta, issueOverdue } from '../core/status.js';
import { reminderState, renewalState, describeSchedule } from '../core/reminders.js';
import { docTotals } from '../core/totals.js';
import { fuelDerivedAll, fuelSummary } from '../core/fuel.js';
import { costLines, monthlyCosts, sumBy } from '../core/costs.js';
import { activeAssignment } from '../core/actions.js';
import { pill, statusPill } from '../ui/components.js';
import { columnChart } from '../ui/chart.js';
import { formatMoneyShort } from '../core/money.js';
import {
  money,
  dash,
  dateCell,
  vehicleThumb,
  vehicleStatusPill,
  meterText,
  contactCell,
  vendorCell,
  detailHeader,
  kvList,
  sectionCard,
  miniEmpty,
  attachmentsPanel,
  commentsPanel,
  viewTabs,
  simpleTable,
  emptyPage,
  moreMenuButton,
  deletedNotice,
  operatorOf,
  dueText,
  sourceLink,
} from './common.js';
import { confirmArchive } from './vehicles.js';
import { openMeterDialog } from './meters.js';
import { openExpenseDialog } from './expenses.js';
import { openRenewalDialog } from './renewals.js';
import { openAssignmentDialog } from './assignments.js';
import { recallsCard } from './recalls.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'service', label: 'Service' },
  { id: 'inspections', label: 'Inspections' },
  { id: 'work-orders', label: 'Work orders' },
  { id: 'issues', label: 'Issues' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'fuel', label: 'Fuel' },
  { id: 'meters', label: 'Meters' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'files', label: 'Files' },
];

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  if (!store.get('vehicles', id)) return emptyPage('Vehicle not found', 'It may have been deleted or you followed an old link.');
  let tab = TABS.some((t) => t.id === ctx.query.tab) ? ctx.query.tab : 'overview';
  const v = () => store.get('vehicles', id);

  const tabsHolder = ctx.live(() => viewTabs(TABS.map((t) => ({ ...t, count: countFor(t.id) })), tab, select, 'Vehicle sections'), ['issues', 'workOrders', 'reminders', 'renewals']);
  const body = h('div.tab-panel', { role: 'tabpanel' });
  const header = ctx.live(() => drawHeader(), ['vehicles', 'contacts', 'settings', 'assignments']);

  function select(t) {
    tab = t;
    setQuery({ tab: t === 'overview' ? '' : t });
    tabsHolder.redraw();
    drawBody();
    tabsHolder.querySelector(`#tab-${t}`)?.focus();
  }

  function countFor(t) {
    if (t === 'issues') return store.all('issues').filter((i) => i.vehicleId === id && i.status === 'open').length || null;
    if (t === 'work-orders') return store.all('workOrders').filter((w) => w.vehicleId === id && w.status !== 'completed' && w.status !== 'cancelled').length || null;
    return null;
  }


  function drawHeader() {
    const veh = v();
    // Deleted while open: say so, and drop the tabs and their content.
    tabsHolder.hidden = !veh;
    if (!veh) return (body.replaceChildren(), deletedNotice('vehicle', { href: '#/vehicles', label: 'Back to vehicles' }));
    const editable = canEdit('vehicles');
    return detailHeader({
      back: { label: 'Vehicles', href: '#/vehicles' },
      thumb: vehicleThumb(veh, 'lg'),
      title: vehicleName(veh),
      sub: [veh.type, vehicleDescription(veh), veh.vin, veh.plate].filter(Boolean).join(' · '),
      meta: [
        veh.meter != null ? h('button.link-btn.meter-link', { type: 'button', onClick: () => select('meters') }, icon('gauge', 14), meterText(veh.meter, veh)) : h('span.subtle', 'No meter reading'),
        vehicleStatusPill(veh.status, { dot: true }),
        veh.groupId ? h('span.row.gap-4', icon('layers', 14), lookup.groupName(veh.groupId)) : null,
        operatorOf(veh) ? h('span.row.gap-4', icon('user', 14), contactCell(operatorOf(veh))) : h('span.subtle.row.gap-4', icon('user', 14), 'Unassigned'),
        veh.archived ? pill('Archived', 'gray') : null,
        ...(veh.labels || []).map((l) => h('span.mini-tag', l)),
      ],
      actions: [
        editable ? h('a.btn', { href: `#/vehicles/${id}/edit` }, icon('pencil', 15), 'Edit') : null,
        h('button.btn.primary', { type: 'button', onClick: (e) => addMenu(e.currentTarget) }, icon('plus', 16), 'Add', icon('chevron-down', 15)),
        editable
          ? moreMenuButton([
              { label: veh.archived ? 'Restore vehicle' : 'Archive vehicle', icon: veh.archived ? 'unarchive' : 'archive', run: async () => (await confirmArchive(veh)) && (store.patch('vehicles', id, { archived: !veh.archived }), toast(veh.archived ? 'Vehicle restored' : 'Vehicle archived')) },
              { label: 'Delete vehicle', icon: 'trash', danger: true, run: () => deleteVehicle(veh) },
            ])
          : null,
      ],
    });
  }

  function addMenu(anchor) {
    const items = [
      { coll: 'fuel', label: 'Fuel entry', icon: 'fuel', run: () => navigate(`/fuel/new?vehicle=${id}`) },
      { coll: 'inspections', label: 'Inspection', icon: 'clipboard-check', run: () => navigate(`/inspections/start?vehicle=${id}`) },
      { coll: 'issues', label: 'Issue', icon: 'warning', run: () => navigate(`/issues/new?vehicle=${id}`) },
      { coll: 'meters', label: 'Meter reading', icon: 'gauge', run: () => openMeterDialog({ vehicleId: id }) },
      { coll: 'workOrders', label: 'Work order', icon: 'clipboard', run: () => navigate(`/work-orders/new?vehicle=${id}`) },
      { coll: 'serviceEntries', label: 'Service entry', icon: 'wrench', run: () => navigate(`/service/new?vehicle=${id}`) },
      { coll: 'reminders', label: 'Service reminder', icon: 'bell', run: () => navigate(`/reminders/new?vehicle=${id}`) },
      { coll: 'renewals', label: 'Renewal reminder', icon: 'calendar-clock', run: () => openRenewalDialog({ kind: 'vehicle', vehicleId: id }) },
      { coll: 'expenses', label: 'Expense', icon: 'receipt', run: () => openExpenseDialog({ vehicleId: id }) },
      { coll: 'assignments', label: 'Assignment', icon: 'user-plus', run: () => openAssignmentDialog({ vehicleId: id }) },
    ].filter((i) => canEdit(i.coll));
    openMenu(anchor, items, { label: 'Add to this vehicle', align: 'end' });
  }

  async function deleteVehicle(veh) {
    const related = ['fuel', 'meters', 'issues', 'serviceEntries', 'workOrders', 'inspections', 'reminders', 'renewals', 'expenses', 'assignments'];
    const counts = related.map((c) => [c, store.all(c).filter((r) => r.vehicleId === id).length]).filter(([, n]) => n);
    const total = counts.reduce((s, [, n]) => s + n, 0);
    const ok = await confirmDialog({
      title: 'Delete this vehicle?',
      message: total ? `${vehicleName(veh)} and its ${total} related records (fuel, service, issues, inspections, and more) will be permanently deleted. Archive it instead to keep its history.` : `${vehicleName(veh)} will be permanently deleted.`,
      confirmLabel: 'Delete permanently',
      danger: true,
    });
    if (!ok) return;
    for (const [c] of counts) store.bulkRemove(c, store.all(c).filter((r) => r.vehicleId === id).map((r) => r.id));
    store.bulkRemove('comments', store.all('comments').filter((r) => r.parentType === 'vehicles' && r.parentId === id).map((r) => r.id));
    // Programs list their vehicles; a deleted one would stay as a bare id.
    for (const p of store.all('servicePrograms')) if ((p.vehicleIds || []).includes(id)) store.patch('servicePrograms', p.id, { vehicleIds: p.vehicleIds.filter((x) => x !== id) });
    store.remove('vehicles', id);
    toast('Vehicle deleted');
    navigate('/vehicles');
  }

  // ---- Tab bodies ----------------------------------------------------------------

  function drawBody() {
    const map = { overview, service, inspections, 'work-orders': workOrders, issues, reminders, fuel, meters, expenses, assignments, files };
    body.setAttribute('aria-labelledby', `tab-${tab}`);
    body.replaceChildren(map[tab]());
  }

  function overview() {
    const veh = v();
    const s = app.settings();
    const today = app.today();
    const left = h(
      'div.col',
      sectionCard(
        'Details',
        kvList([
          ['Name', vehicleName(veh)],
          ['Meter', veh.meter != null ? `${meterText(veh.meter, veh)}${veh.meterDate ? ` (${formatDate(veh.meterDate)})` : ''}` : null],
          ['Status', vehicleStatusPill(veh.status)],
          ['Group', lookup.groupName(veh.groupId)],
          ['Operator', operatorOf(veh) ? contactCell(operatorOf(veh)) : null],
          ['Type', veh.type],
          ['Fuel type', veh.fuelType],
          ['VIN or serial', veh.vin ? h('span.mono', veh.vin) : null],
          ['License plate', veh.plate],
          ['Year', veh.year],
          ['Make', veh.make],
          ['Model', veh.model],
          ['Trim', veh.trim],
          ['Registration', veh.registrationState],
          ['Color', veh.color],
          ['Ownership', OWNERSHIP.find((o) => o.id === veh.ownership)?.label],
        ]),
      ),
      sectionCard(
        'Lifecycle and purchase',
        kvList([
          ['In service', veh.inServiceDate ? `${formatDate(veh.inServiceDate)}${veh.inServiceMeter != null ? ` at ${meterText(veh.inServiceMeter, veh)}` : ''}` : null],
          ['Age', veh.inServiceDate ? `${formatDecimal(diffDays(veh.inServiceDate, today) / 365.25, 1)} years` : null],
          ['Service life', [veh.estServiceLifeMonths ? `${veh.estServiceLifeMonths} months` : '', veh.estServiceLifeMeter ? meterText(veh.estServiceLifeMeter, veh) : ''].filter(Boolean).join(' or ')],
          ['Life remaining', lifeRemaining(veh, today)],
          ['Resale value', veh.estResaleValue != null ? money(veh.estResaleValue) : null],
          ['Purchased', veh.purchase?.date ? `${formatDate(veh.purchase.date)}${veh.purchase.vendorName ? ` from ${veh.purchase.vendorName}` : ''}` : veh.purchase?.vendorName],
          ['Purchase price', veh.purchase?.price != null ? money(veh.purchase.price) : null],
          ['Loan or lease', veh.purchase?.monthlyPayment ? `${money(veh.purchase.monthlyPayment)} per month${veh.purchase.endDate ? ` until ${formatDate(veh.purchase.endDate)}` : ''}` : null],
          ['Out of service', veh.outOfServiceDate ? formatDate(veh.outOfServiceDate) : null],
        ]),
      ),
      specsCard(veh),
      veh.notes ? sectionCard('Notes', h('p.pre-wrap', veh.notes)) : null,
    );

    // Right column: what needs doing and what it costs.
    const issues = store.all('issues').filter((i) => i.vehicleId === id && i.status === 'open');
    const overdueIssues = issues.filter((i) => issueOverdue(i, today, veh));
    const rems = store.all('reminders').filter((r) => r.vehicleId === id && !r.archived).map((r) => ({ r, st: reminderState(r, veh, today, s) }));
    const remOver = rems.filter((x) => x.st.status === 'overdue');
    const remSoon = rems.filter((x) => x.st.status === 'due_soon');
    const rens = store.all('renewals').filter((r) => r.kind === 'vehicle' && r.vehicleId === id && !r.done).map((r) => ({ r, st: renewalState(r, today, s) }));
    const wos = store.all('workOrders').filter((w) => w.vehicleId === id && w.status !== 'completed' && w.status !== 'cancelled');
    const lines = costLines({ fuel: store.all('fuel').filter((f) => f.vehicleId === id), serviceEntries: store.all('serviceEntries').filter((e) => e.vehicleId === id), expenses: store.all('expenses').filter((e) => e.vehicleId === id) });
    const months = lastMonths(today, 6);
    const series = monthlyCosts(lines, months);
    const yearStart = `${today.slice(0, 4)}-01-01`;

    const right = h(
      'div.col',
      sectionCard(
        'Open issues',
        h(
          'div',
          h('div.metric-pair', metric('Open', issues.length, issues.length ? 'orange' : null, () => select('issues')), metric('Overdue', overdueIssues.length, overdueIssues.length ? 'red' : null, () => select('issues'))),
          issues.length
            ? h(
                'ul.widget-list',
                issues.slice(0, 4).map((i) => h('li', h('a.widget-row', { href: `#/issues/${i.id}` }, statusPill('priority', i.priority), h('span.grow.truncate', `#${i.number} ${i.summary}`), h('span.subtle.nowrap', relativeDays(i.reportedDate, today))))),
              )
            : null,
        ),
        { actions: canEdit('issues') ? h('a.btn.sm.ghost', { href: `#/issues/new?vehicle=${id}` }, icon('plus', 15), 'Add issue') : null },
      ),
      sectionCard(
        'Service reminders',
        h(
          'div',
          h('div.metric-pair', metric('Overdue', remOver.length, remOver.length ? 'red' : null, () => select('reminders')), metric('Due soon', remSoon.length, remSoon.length ? 'orange' : null, () => select('reminders'))),
          rems.length
            ? h(
                'ul.widget-list',
                rems
                  .sort((a, b) => order(a.st) - order(b.st))
                  .slice(0, 5)
                  .map(({ r, st }) => h('li', h('a.widget-row', { href: `#/reminders/${r.id}` }, statusPill('reminder', st.status), h('span.grow.truncate', lookup.taskName(r.taskId) || 'Service'), h('span.subtle.nowrap', dueText(st, veh, today))))),
              )
            : miniEmpty('No service reminders yet.'),
        ),
        { actions: canEdit('reminders') ? h('a.btn.sm.ghost', { href: `#/reminders/new?vehicle=${id}` }, icon('plus', 15), 'Add') : null },
      ),
      sectionCard(
        'Renewals',
        rens.length
          ? h(
              'ul.widget-list',
              rens.sort((a, b) => String(a.r.dueDate).localeCompare(String(b.r.dueDate))).map(({ r, st }) => h('li', h('div.widget-row', statusPill('reminder', st.status), h('span.grow.truncate', r.type), h('span.subtle.nowrap', r.dueDate ? `${formatDate(r.dueDate)}, ${relativeDays(r.dueDate, today)}` : '')))),
            )
          : miniEmpty('No registration, insurance, or inspection renewals tracked.'),
        { actions: canEdit('renewals') ? h('button.btn.sm.ghost', { type: 'button', onClick: () => openRenewalDialog({ kind: 'vehicle', vehicleId: id }) }, icon('plus', 15), 'Add') : null },
      ),
      sectionCard(
        'Open work orders',
        wos.length
          ? h('ul.widget-list', wos.map((w) => h('li', h('a.widget-row', { href: `#/work-orders/${w.id}` }, statusPill('workOrder', w.status), h('span.grow.truncate', `Work order #${w.number}`), h('span.money.nowrap', money(docTotals(w).total))))))
          : miniEmpty('No work orders in progress.'),
        { actions: canEdit('workOrders') ? h('a.btn.sm.ghost', { href: `#/work-orders/new?vehicle=${id}` }, icon('plus', 15), 'Add') : null },
      ),
      recallsCard(id),
      sectionCard(
        'Costs',
        h(
          'div',
          h('div.metric-row', metric('Last 30 days', money(sumBy(lines, addDays(today, -30), today))), metric('This year', money(sumBy(lines, yearStart, today))), metric('Cost per ' + (veh.meterUnit || s.units.distance), costPerMeter(lines, veh, yearStart, today))),
          columnChart({
            title: 'Costs by month',
            categories: months.map((m, i) => ({ label: monthShort(m).split(' ')[0], full: monthShort(m), values: [series.fuel[i], series.service[i], series.other[i]] })),
            series: [
              { name: 'Fuel', color: 'var(--series-1)' },
              { name: 'Service', color: 'var(--series-2)' },
              { name: 'Other', color: 'var(--series-3)' },
            ],
            stacked: true,
            height: 190,
            format: (c) => money(c),
            short: (c) => formatMoneyShort(c),
          }),
        ),
      ),
    );
    return h('div.two-col', left, right);
  }

  function costPerMeter(lines, veh, from, to) {
    const readings = store.all('meters').filter((m) => m.vehicleId === veh.id && !m.void && m.date >= from && m.date <= to).map((m) => Number(m.value));
    const before = store.all('meters').filter((m) => m.vehicleId === veh.id && !m.void && m.date < from).map((m) => Number(m.value));
    const start = before.length ? Math.max(...before) : readings.length ? Math.min(...readings) : null;
    const end = readings.length ? Math.max(...readings) : null;
    const dist = start != null && end != null ? end - start : 0;
    if (!(dist > 0)) return '-';
    return money(Math.round(sumBy(lines, from, to) / dist));
  }

  function specsCard(veh) {
    const sp = veh.specs || {};
    const pairs = [
      ['Fuel tank', sp.fuelCapacity ? `${sp.fuelCapacity} ${app.settings().units.volume === 'L' ? 'L' : 'gal'}` : null],
      ['Engine', sp.engine],
      ['Transmission', sp.transmission],
      ['Oil capacity', sp.oilCapacity],
      ['Tire size', sp.tireSize],
      ['Curb weight', sp.curbWeight],
      ['GVWR', sp.gvwr],
      ['Towing capacity', sp.towing],
    ].filter(([, val]) => val);
    return pairs.length ? sectionCard('Specifications', kvList(pairs)) : null;
  }

  function service() {
    const rows = store.all('serviceEntries').filter((e) => e.vehicleId === id);
    return listCard('Service history', canEdit('serviceEntries') ? h('a.btn.sm', { href: `#/service/new?vehicle=${id}` }, icon('plus', 15), 'Add service entry') : null, simpleTable({
      rows,
      caption: 'Service history',
      defaultSort: { id: 'date', dir: 'desc' },
      rowHref: (e) => `#/service/${e.id}`,
      empty: 'No service recorded yet.',
      columns: [
        { id: 'date', label: 'Completed', render: (e) => dateCell(e.date), sort: (e) => e.date },
        { id: 'tasks', label: 'Work done', render: (e) => h('span.truncate', (e.lineItems || []).map((li) => lookup.taskName(li.taskId) || li.description).filter(Boolean).join(', ') || '-') },
        { id: 'meter', label: 'Meter', align: 'r', render: (e) => meterText(e.meter, v()) || dash(), sort: (e) => Number(e.meter) || null },
        { id: 'vendor', label: 'Vendor', render: (e) => vendorCell(e.vendorId) },
        { id: 'total', label: 'Total', align: 'r', render: (e) => h('span.money', money(docTotals(e).total)), sort: (e) => docTotals(e).total },
      ],
    }));
  }

  function inspections() {
    const rows = store.all('inspections').filter((e) => e.vehicleId === id);
    return listCard('Inspections', canEdit('inspections') ? h('a.btn.sm', { href: `#/inspections/start?vehicle=${id}` }, icon('clipboard-check', 15), 'Start inspection') : null, simpleTable({
      rows,
      caption: 'Inspections',
      defaultSort: { id: 'date', dir: 'desc' },
      rowHref: (e) => `#/inspections/${e.id}`,
      empty: 'No inspections submitted yet.',
      columns: [
        { id: 'date', label: 'Submitted', render: (e) => h('span.nowrap', `${formatDate(e.date)}${e.startedAt ? `, ${localTime(e.startedAt)}` : ''}`), sort: (e) => e.submittedAt || e.date },
        { id: 'form', label: 'Form', render: (e) => e.formName },
        { id: 'by', label: 'Inspector', render: (e) => e.by || dash() },
        { id: 'duration', label: 'Duration', render: (e) => (e.startedAt && e.submittedAt ? formatDuration((new Date(e.submittedAt) - new Date(e.startedAt)) / 1000) : dash()) },
        { id: 'failed', label: 'Result', render: (e) => (e.failed ? pill(`${e.failed} failed`, 'red') : pill('Passed', 'green')), sort: (e) => e.failed },
      ],
    }));
  }

  function workOrders() {
    const rows = store.all('workOrders').filter((e) => e.vehicleId === id);
    return listCard('Work orders', canEdit('workOrders') ? h('a.btn.sm', { href: `#/work-orders/new?vehicle=${id}` }, icon('plus', 15), 'Add work order') : null, simpleTable({
      rows,
      caption: 'Work orders',
      defaultSort: { id: 'number', dir: 'desc' },
      rowHref: (e) => `#/work-orders/${e.id}`,
      empty: 'No work orders yet.',
      columns: [
        { id: 'number', label: 'Number', render: (w) => `#${w.number}`, sort: (w) => w.number },
        { id: 'status', label: 'Status', render: (w) => statusPill('workOrder', w.status), sort: (w) => w.status },
        { id: 'issued', label: 'Issued', render: (w) => dateCell(w.issueDate), sort: (w) => w.issueDate },
        { id: 'assignee', label: 'Assigned to', render: (w) => (w.assigneeId ? contactCell(w.assigneeId) : dash()) },
        { id: 'total', label: 'Total', align: 'r', render: (w) => h('span.money', money(docTotals(w).total)), sort: (w) => docTotals(w).total },
      ],
    }));
  }

  function issues() {
    const today = app.today();
    const rows = store.all('issues').filter((e) => e.vehicleId === id);
    return listCard('Issues', canEdit('issues') ? h('a.btn.sm', { href: `#/issues/new?vehicle=${id}` }, icon('plus', 15), 'Add issue') : null, simpleTable({
      rows,
      caption: 'Issues',
      defaultSort: { id: 'number', dir: 'desc' },
      rowHref: (e) => `#/issues/${e.id}`,
      empty: 'No issues reported.',
      columns: [
        { id: 'number', label: 'Issue', render: (i) => h('span', h('strong', `#${i.number}`), ` ${i.summary}`), sort: (i) => i.number },
        { id: 'priority', label: 'Priority', render: (i) => statusPill('priority', i.priority) },
        { id: 'status', label: 'Status', render: (i) => (issueOverdue(i, today, v()) ? pill('Overdue', 'red') : statusPill('issue', i.status)), sort: (i) => i.status },
        { id: 'reported', label: 'Reported', render: (i) => dateCell(i.reportedDate), sort: (i) => i.reportedDate },
      ],
    }));
  }

  function reminders() {
    const veh = v();
    const today = app.today();
    const s = app.settings();
    const rows = store.all('reminders').filter((r) => r.vehicleId === id && !r.archived).map((r) => ({ ...r, _st: reminderState(r, veh, today, s) }));
    const rens = store.all('renewals').filter((r) => r.kind === 'vehicle' && r.vehicleId === id).map((r) => ({ ...r, _st: renewalState(r, today, s) }));
    return h(
      'div.stack',
      listCard('Service reminders', canEdit('reminders') ? h('a.btn.sm', { href: `#/reminders/new?vehicle=${id}` }, icon('plus', 15), 'Add service reminder') : null, simpleTable({
        rows,
        caption: 'Service reminders',
        defaultSort: { id: 'status', dir: 'asc' },
        rowHref: (r) => `#/reminders/${r.id}`,
        empty: 'No service reminders. Add one, or apply a service program.',
        columns: [
          { id: 'task', label: 'Service task', render: (r) => lookup.taskName(r.taskId) || dash(), sort: (r) => lookup.taskName(r.taskId) },
          { id: 'status', label: 'Status', render: (r) => statusPill('reminder', r._st.status), sort: (r) => order(r._st) },
          { id: 'schedule', label: 'Schedule', render: (r) => describeSchedule(r, veh.meterUnit) },
          { id: 'due', label: 'Next due', render: (r) => dueText(r._st, veh, today) || dash() },
          { id: 'last', label: 'Last completed', render: (r) => (r.lastDate ? `${formatDate(r.lastDate)}${r.lastMeter != null ? `, ${meterText(r.lastMeter, veh)}` : ''}` : dash()), sort: (r) => r.lastDate },
        ],
      })),
      listCard('Renewal reminders', canEdit('renewals') ? h('button.btn.sm', { type: 'button', onClick: () => openRenewalDialog({ kind: 'vehicle', vehicleId: id }) }, icon('plus', 15), 'Add renewal') : null, simpleTable({
        rows: rens,
        caption: 'Renewal reminders',
        defaultSort: { id: 'due', dir: 'asc' },
        empty: 'No renewals tracked.',
        columns: [
          { id: 'type', label: 'Renewal', render: (r) => h('button.link-btn', { type: 'button', onClick: () => openRenewalDialog(r) }, r.type), sort: (r) => r.type },
          { id: 'status', label: 'Status', render: (r) => (r.done ? pill('Done', 'green') : statusPill('reminder', r._st.status)) },
          { id: 'due', label: 'Due', render: (r) => (r.dueDate ? `${formatDate(r.dueDate)} (${relativeDays(r.dueDate, today)})` : dash()), sort: (r) => r.dueDate },
        ],
      })),
    );
  }

  function fuel() {
    const veh = v();
    const s = app.settings();
    const rows = store.all('fuel').filter((f) => f.vehicleId === id);
    const charge = veh.fuelType === 'Electric';
    const volUnit = charge ? 'kWh' : s.units.volume;
    const unitOf = (f) => (f.kind === 'charge' ? 'kWh' : s.units.volume);
    // Fill-ups and charging are measured separately (plug-in hybrids have both).
    const derived = fuelDerivedAll(rows, () => veh, s.units.volume);
    const main = rows.filter((f) => (f.kind === 'charge') === charge);
    const sum = fuelSummary(main, derived, { meterUnit: veh.meterUnit || s.units.distance, volumeUnit: volUnit });
    return h(
      'div.stack',
      h('div.metric-row.card.pad', metric('Total cost', money(rows.reduce((a, f) => a + (Number(f.total) || 0), 0))), metric(charge ? 'Energy' : 'Volume', `${formatDecimal(sum.volume, 1)} ${volUnit}`), metric('Average economy', sum.avgEconomy ? formatEconomy(sum.avgEconomy, veh.meterUnit || s.units.distance, volUnit) : '-'), metric('Average price', sum.avgPrice ? `${money(Math.round(sum.avgPrice * 100))}/${volUnit}` : '-')),
      listCard('Fuel history', canEdit('fuel') ? h('a.btn.sm', { href: `#/fuel/new?vehicle=${id}` }, icon('plus', 15), 'Add fuel entry') : null, simpleTable({
        rows,
        caption: 'Fuel history',
        defaultSort: { id: 'date', dir: 'desc' },
        rowHref: (f) => `#/fuel/${f.id}`,
        empty: 'No fuel entries yet.',
        columns: [
          { id: 'date', label: 'Date', render: (f) => dateCell(f.date), sort: (f) => `${f.date} ${f.time || ''}` },
          { id: 'meter', label: 'Meter', align: 'r', render: (f) => meterText(f.meter, veh) || dash(), sort: (f) => Number(f.meter) || null },
          { id: 'usage', label: 'Usage', align: 'r', render: (f) => (derived.get(f.id)?.usage != null ? meterText(derived.get(f.id).usage, veh) : dash()) },
          { id: 'volume', label: 'Volume', align: 'r', render: (f) => (f.volume != null && f.volume !== '' ? `${formatDecimal(f.volume, 3)} ${unitOf(f)}${f.partial ? ' (partial)' : ''}` : dash()), sort: (f) => Number(f.volume) },
          { id: 'total', label: 'Total', align: 'r', render: (f) => h('span.money', money(f.total)), sort: (f) => Number(f.total) },
          { id: 'economy', label: 'Economy', align: 'r', render: (f) => (derived.get(f.id)?.economy ? formatEconomy(derived.get(f.id).economy, veh.meterUnit || s.units.distance, unitOf(f)) : dash()) },
        ],
      })),
    );
  }

  function meters() {
    const veh = v();
    const rows = store.all('meters').filter((m) => m.vehicleId === id);
    return listCard('Meter history', canEdit('meters') ? h('button.btn.sm', { type: 'button', onClick: () => openMeterDialog({ vehicleId: id }) }, icon('plus', 15), 'Add reading') : null, simpleTable({
      rows,
      caption: 'Meter history',
      defaultSort: { id: 'date', dir: 'desc' },
      empty: 'No meter readings yet.',
      columns: [
        { id: 'date', label: 'Date', render: (m) => dateCell(m.date), sort: (m) => `${m.date}${String(m.value).padStart(12, '0')}` },
        { id: 'value', label: 'Reading', align: 'r', render: (m) => h(`span.num${m.void ? '.struck' : ''}`, meterText(m.value, veh)), sort: (m) => Number(m.value) },
        { id: 'source', label: 'Source', render: (m) => sourceLink(m) },
        { id: 'note', label: 'Note', render: (m) => (m.void ? pill('Void', 'gray') : m.note || '') },
        canEdit('meters') ? { id: 'edit', label: '', render: (m) => (!m.source ? h('button.link-btn', { type: 'button', onClick: () => openMeterDialog(m) }, 'Edit') : '') } : null,
      ].filter(Boolean),
    }));
  }

  function expenses() {
    const rows = store.all('expenses').filter((e) => e.vehicleId === id);
    return listCard('Expenses', canEdit('expenses') ? h('button.btn.sm', { type: 'button', onClick: () => openExpenseDialog({ vehicleId: id }) }, icon('plus', 15), 'Add expense') : null, simpleTable({
      rows,
      caption: 'Expenses',
      defaultSort: { id: 'date', dir: 'desc' },
      empty: 'No other expenses recorded.',
      columns: [
        { id: 'date', label: 'Date', render: (e) => h('button.link-btn', { type: 'button', onClick: () => openExpenseDialog(e) }, formatDate(e.date)), sort: (e) => e.date },
        { id: 'type', label: 'Type', render: (e) => e.type, sort: (e) => e.type },
        { id: 'vendor', label: 'Vendor', render: (e) => vendorCell(e.vendorId) },
        { id: 'notes', label: 'Notes', render: (e) => e.notes || '' },
        { id: 'amount', label: 'Amount', align: 'r', render: (e) => h('span.money', money(e.amount)), sort: (e) => Number(e.amount) },
      ],
    }));
  }

  function assignments() {
    const today = app.today();
    const rows = store.all('assignments').filter((a) => a.vehicleId === id);
    const active = activeAssignment(store, id, today);
    return listCard('Assignments', canEdit('assignments') ? h('button.btn.sm', { type: 'button', onClick: () => openAssignmentDialog({ vehicleId: id }) }, icon('user-plus', 15), 'Assign operator') : null, simpleTable({
      rows,
      caption: 'Assignments',
      defaultSort: { id: 'start', dir: 'desc' },
      empty: 'This vehicle has never been assigned.',
      columns: [
        { id: 'contact', label: 'Operator', render: (a) => contactCell(a.contactId), sort: (a) => contactName(lookup.contact(a.contactId)) },
        { id: 'start', label: 'Start', render: (a) => dateCell(a.start), sort: (a) => a.start },
        { id: 'end', label: 'End', render: (a) => (a.end ? formatDate(a.end) : active?.id === a.id ? pill('Current', 'green') : dash()), sort: (a) => a.end || '9999' },
        { id: 'notes', label: 'Notes', render: (a) => a.notes || '' },
        canEdit('assignments') ? { id: 'edit', label: '', render: (a) => h('button.link-btn', { type: 'button', onClick: () => openAssignmentDialog(a) }, 'Edit') } : null,
      ].filter(Boolean),
    }));
  }

  // Built once: the panels keep themselves up to date while the page is open.
  let filesNode = null;
  function files() {
    filesNode ||= h('div.two-col', h('div.col', attachmentsPanel('vehicles', id)), h('div.col', commentsPanel('vehicles', id)));
    return filesNode;
  }

  drawBody();
  const redrawBody = () => {
    // Files and comments keep themselves up to date.
    if (!v() || tab === 'files') return;
    const focus = document.activeElement;
    const keep = body.contains(focus) && focus.matches('textarea, input');
    if (!keep) drawBody();
  };
  let t = null;
  ctx.onDispose(
    store.subscribe((c) => {
      if (c.has('sync') && c.size === 1) return;
      clearTimeout(t);
      t = setTimeout(redrawBody, 40);
    }),
  );

  return { node: h('div.page.detail-page', header, tabsHolder, body), title: vehicleName(v()) };
}

// ---- Helpers ----------------------------------------------------------------------

function listCard(title, action, content) {
  return h('section.card.panel', { 'aria-label': title }, h('div.card-head', h('h2.grow', title), action), h('div.card-body.flush', content));
}

export function metric(label, value, tone = null, onClick = null) {
  const tag = onClick ? 'button' : 'div';
  return h(`${tag}.metric${tone ? '.tone-' + tone : ''}`, { type: onClick ? 'button' : null, onClick }, h('span.metric-label', label), h('span.metric-value', String(value)));
}

const ORDER = { overdue: 0, due_soon: 1, snoozed: 2, upcoming: 3 };
function order(st) {
  return ORDER[st.status] ?? 9;
}

/** Clock time of a timestamp in the viewer's time zone (submissions store UTC). */
function localTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : formatTime(`${d.getHours()}:${d.getMinutes()}`);
}

function lifeRemaining(veh, today) {
  const out = [];
  if (veh.estServiceLifeMonths && veh.inServiceDate) {
    const left = Math.round(veh.estServiceLifeMonths - diffDays(veh.inServiceDate, today) / 30.44);
    out.push(left >= 0 ? `${left} months` : `${-left} months past`);
  }
  if (veh.estServiceLifeMeter && veh.meter != null) {
    const left = veh.estServiceLifeMeter - (veh.meter - (veh.inServiceMeter || 0));
    out.push(left >= 0 ? `${meterText(left, veh)}` : `${meterText(-left, veh)} past`);
  }
  return out.join(' or ');
}

export { statusMeta };
// Now in common.js, so other screens need not load this one to use them.
export { dueText, sourceLink };
