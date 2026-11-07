/** Matters list: status tabs, filters, column chooser, bulk actions, export. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, navTabs, segmented, searchBox, select, dataTable, emptyState } from '../ui/components.js';
import { setQuery } from '../ui/router.js';
import { openMenu } from '../ui/menu.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { matterStatusPill, userChip, contactLink, moneyCell, financialsFor, rememberSort, saveSort } from './common.js';
import { matches } from '../core/format.js';
import { formatDate, diffDays } from '../core/dates.js';
import { practiceAreaName, stageName } from '../core/settings.js';
import { downloadCsv } from '../core/csv.js';
import { formatHoursDecimal } from '../core/duration.js';

export function render(ctx) {
  const store = app.store;
  const s = () => app.settings();
  const state = {
    status: ctx.query.status || 'open',
    q: ctx.query.q || '',
    area: ctx.query.area || '',
    resp: ctx.query.resp || '',
  };

  const header = pageHeader({
    title: 'Matters',
    actions: [
      h('button.btn', { type: 'button', 'aria-label': 'Conflict check', onClick: () => import('./dialogs.js').then((m) => m.openConflictCheck()) }, icon('shield-check', 16), h('span.hide-sm', 'Conflict check')),
      h('a.btn.primary', { href: '#/matters/new' }, icon('plus', 16), 'New matter'),
    ],
    tabs: navTabs(
      [
        { href: '#/matters', label: 'Matters', current: true },
        { href: '#/matters/stages', label: 'Stages' },
      ],
      'Matter views',
    ),
  });

  const statusWrap = h('div');
  const bulk = h('div.bulk-bar', { hidden: true });
  const areaSel = select({
    name: 'area',
    value: state.area,
    'aria-label': 'Practice area',
    options: [{ value: '', label: 'All practice areas' }, ...s().practiceAreas.map((p) => ({ value: p.id, label: p.name }))],
  });
  areaSel.addEventListener('change', () => {
    state.area = areaSel.value;
    setQuery({ area: state.area });
    refresh();
  });
  const respSel = select({
    name: 'resp',
    value: state.resp,
    'aria-label': 'Responsible lawyer',
    options: [{ value: '', label: 'Anyone responsible' }, { value: 'me', label: 'Me' }, ...lookup.activeUsers().map((u) => ({ value: u.id, label: u.name }))],
  });
  respSel.addEventListener('change', () => {
    state.resp = respSel.value;
    setQuery({ resp: state.resp });
    refresh();
  });

  const today = app.today();
  const columns = [
    {
      id: 'matter',
      label: 'Matter',
      fixed: true,
      width: '30%',
      render: (m) => h('span.matter-cell', h('span.matter-num', m.displayNumber), h('span.truncate', m.description)),
      sort: (m) => m.number,
    },
    { id: 'client', label: 'Client', render: (m) => contactLink(m.clientId), sort: (m) => lookup.contactName(m.clientId) },
    { id: 'responsible', label: 'Responsible lawyer', render: (m) => userChip(m.responsibleId), sort: (m) => lookup.userName(m.responsibleId) },
    { id: 'originating', label: 'Originating lawyer', hidden: true, render: (m) => (m.originatingId ? userChip(m.originatingId) : ''), sort: (m) => lookup.userName(m.originatingId) },
    { id: 'area', label: 'Practice area', render: (m) => practiceAreaName(s(), m.practiceAreaId), sort: (m) => practiceAreaName(s(), m.practiceAreaId) },
    { id: 'stage', label: 'Stage', render: (m) => stageName(s(), m.practiceAreaId, m.stageId), sort: (m) => stageName(s(), m.practiceAreaId, m.stageId) },
    { id: 'status', label: 'Status', render: (m) => matterStatusPill(m.status), sort: (m) => m.status },
    { id: 'open', label: 'Open date', render: (m) => formatDate(m.openDate), sort: (m) => m.openDate },
    {
      id: 'sol',
      label: 'Limitations date',
      hidden: true,
      render: (m) => {
        if (!m.solDate) return '';
        const d = diffDays(today, m.solDate);
        return m.solSatisfied ? h('span.subtle', 'Satisfied') : h(`span${d <= 30 ? '.text-danger' : ''}`, formatDate(m.solDate));
      },
      sort: (m) => (m.solSatisfied ? '' : m.solDate),
    },
    { id: 'wip', label: 'Unbilled', align: 'r', render: (m) => moneyCell(financialsFor(m).wip, { muted: true }), sort: (m) => financialsFor(m).wip },
    { id: 'outstanding', label: 'Outstanding', align: 'r', render: (m) => moneyCell(financialsFor(m).outstanding, { muted: true }), sort: (m) => financialsFor(m).outstanding },
    {
      id: 'trust',
      label: 'Trust',
      align: 'r',
      render: (m) => {
        const f = financialsFor(m);
        return f.trustLow ? h('span.num.text-warning', { title: 'Below the trust minimum' }, moneyCell(f.trust)) : moneyCell(f.trust, { muted: true });
      },
      sort: (m) => financialsFor(m).trust,
    },
    {
      id: 'tags',
      label: 'Tags',
      hidden: true,
      render: (m) =>
        h(
          'span.tags',
          (m.tags || []).map((t) => h('span.tag.static', t)),
        ),
      sort: (m) => (m.tags || []).join(','),
    },
  ];

  const table = dataTable({
    caption: 'Matters',
    columns,
    columnsKey: 'matters',
    sort: rememberSort('matters', { id: 'matter', dir: 'desc' }),
    onSort: (v) => saveSort('matters', v),
    rowHref: (m) => `#/matters/${m.id}`,
    selectable: true,
    onSelectionChange: drawBulk,
    mobile: (m) =>
      h(
        'a.list-item',
        { href: `#/matters/${m.id}` },
        h(
          'span.grow',
          h('span.title', h('span.matter-num', m.displayNumber), ' ', m.description),
          h('span.sub', [lookup.contactName(m.clientId), practiceAreaName(s(), m.practiceAreaId)].filter(Boolean).join(' · ')),
        ),
        matterStatusPill(m.status),
      ),
    empty: () =>
      store.all('matters').length
        ? emptyState({ compact: true, icon: 'search', title: 'No matching matters', text: 'Try a different search, status, or filter.', headingLevel: 3 })
        : emptyState({
            icon: 'briefcase',
            title: 'No matters yet',
            text: 'A matter holds everything about a client engagement: time, bills, trust funds, tasks, events, and documents.',
            actions: [h('a.btn.primary', { href: '#/matters/new' }, icon('plus', 16), 'New matter')],
            headingLevel: 3,
          }),
    footer: (rows) => {
      let wip = 0;
      let out = 0;
      let trust = 0;
      for (const m of rows) {
        const f = financialsFor(m);
        wip += f.wip;
        out += f.outstanding;
        trust += f.trust;
      }
      return [
        h('span', h('strong', String(rows.length)), rows.length === 1 ? ' matter' : ' matters'),
        h('span', 'Unbilled ', h('strong', moneyCell(wip))),
        h('span', 'Outstanding ', h('strong', moneyCell(out))),
        h('span', 'In trust ', h('strong', moneyCell(trust))),
      ];
    },
  });

  function rows() {
    const me = app.me()?.id;
    return store.all('matters').filter((m) => {
      if (state.status !== 'all' && m.status !== state.status) return false;
      if (state.area && m.practiceAreaId !== state.area) return false;
      if (state.resp && m.responsibleId !== (state.resp === 'me' ? me : state.resp)) return false;
      if (state.q && !matches(`${m.displayNumber} ${m.description} ${lookup.contactName(m.clientId)} ${m.clientRef || ''} ${(m.tags || []).join(' ')}`, state.q)) return false;
      return true;
    });
  }

  function drawStatus() {
    const all = store.all('matters');
    const count = (st) => all.filter((m) => m.status === st).length;
    statusWrap.replaceChildren(
      segmented({
        label: 'Matter status',
        value: state.status,
        items: [
          { value: 'all', label: 'All', count: all.length },
          { value: 'open', label: 'Open', count: count('open') },
          { value: 'pending', label: 'Pending', count: count('pending') },
          { value: 'closed', label: 'Closed', count: count('closed') },
        ],
        onChange: (v) => {
          state.status = v;
          setQuery({ status: v === 'open' ? '' : v });
          table.clearSelection();
          showRows();
        },
      }),
    );
  }

  function drawBulk(sel) {
    bulk.hidden = !sel.size;
    if (!sel.size) return;
    const chosen = () => [...sel].map((id) => store.get('matters', id)).filter(Boolean);
    // Redrawn on every refresh, so keep keyboard focus on the same button.
    const focused = bulk.contains(document.activeElement) ? document.activeElement.textContent : null;
    bulk.replaceChildren(
      h('span', `${sel.size} selected`),
      h('div.spacer'),
      h('button.btn.sm', { type: 'button', onClick: () => exportCsv(chosen()) }, icon('download', 15), 'Export'),
      h(
        'button.btn.sm',
        {
          type: 'button',
          onClick: (e) =>
            openMenu(e.currentTarget, [{ heading: 'Change status' }, ...['open', 'pending', 'closed'].map((st) => ({ label: st[0].toUpperCase() + st.slice(1), run: () => bulkStatus(chosen(), st) }))]),
        },
        'Change status',
        icon('chevron-down', 14),
      ),
      h('button.btn.sm.ghost', { type: 'button', onClick: () => table.clearSelection() }, 'Clear'),
    );
    if (focused !== null) ([...bulk.querySelectorAll('button')].find((x) => x.textContent === focused) || bulk.querySelector('button'))?.focus();
  }

  /** Like closing one matter, say what is still unsettled on the ones being closed. */
  function closeWarning(list) {
    const open = list.filter((m) => m.status !== 'closed');
    const n = (test) => open.filter((m) => test(financialsFor(m))).length;
    const [held, unbilled, owed] = [n((f) => f.trust > 0), n((f) => f.wip > 0), n((f) => f.outstanding > 0)];
    const warn = [
      held ? `${held} ${held === 1 ? 'matter still holds' : 'of these matters still hold'} funds in trust` : '',
      unbilled ? `${unbilled} ${unbilled === 1 ? 'has' : 'have'} unbilled work` : '',
      owed ? `${owed} ${owed === 1 ? 'has' : 'have'} an outstanding balance` : '',
    ].filter(Boolean);
    return warn.length ? `${warn.join(', ')}. You can close them anyway and reopen them later.` : 'Closed matters stay searchable and can be reopened at any time.';
  }

  async function bulkStatus(list, status) {
    if (
      status === 'closed' &&
      !(await confirmDialog({
        title: `Close ${list.length} ${list.length === 1 ? 'matter' : 'matters'}?`,
        message: closeWarning(list),
        confirmLabel: 'Close matters',
      }))
    )
      return;
    const t = app.today();
    for (const m of list) store.patch('matters', m.id, { status, closedDate: status === 'closed' ? m.closedDate || t : '', pendingDate: status === 'pending' ? m.pendingDate || t : m.pendingDate });
    toast(`${list.length} ${list.length === 1 ? 'matter' : 'matters'} updated`);
    table.clearSelection();
  }

  function exportCsv(list) {
    const head = [
      'Matter number',
      'Description',
      'Client',
      'Status',
      'Practice area',
      'Stage',
      'Responsible lawyer',
      'Originating lawyer',
      'Open date',
      'Closed date',
      'Billing method',
      'Unbilled',
      'Unbilled hours',
      'Outstanding',
      'Trust balance',
    ];
    const rowsOut = list.map((m) => {
      const f = financialsFor(m);
      return [
        m.displayNumber,
        m.description,
        lookup.contactName(m.clientId),
        m.status,
        practiceAreaName(s(), m.practiceAreaId),
        stageName(s(), m.practiceAreaId, m.stageId),
        lookup.userName(m.responsibleId),
        lookup.userName(m.originatingId),
        m.openDate,
        m.closedDate || '',
        m.billing?.method || '',
        (f.wip / 100).toFixed(2),
        formatHoursDecimal(f.wipMinutes),
        (f.outstanding / 100).toFixed(2),
        (f.trust / 100).toFixed(2),
      ];
    });
    downloadCsv(`matters-${app.today()}.csv`, [head, ...rowsOut]);
  }

  const search = searchBox({
    value: state.q,
    placeholder: 'Search matters',
    label: 'Search matters',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      showRows();
    },
  });

  // Rows that leave the list also leave the selection, so redraw the bulk bar.
  function showRows() {
    table.setRows(rows());
    drawBulk(table.selected);
  }

  function refresh() {
    drawStatus();
    showRows();
  }
  refresh();
  ctx.watch(['matters', 'contacts', 'activities', 'bills', 'payments', 'transactions', 'users', 'settings'], refresh);

  const exportBtn = h('button.btn', { type: 'button', 'aria-label': 'Export', onClick: () => exportCsv(table.rows) }, icon('download', 16), h('span.hide-sm', 'Export'));

  return {
    title: 'Matters',
    node: h(
      'div.page.fill',
      header,
      h('section.card.list-card', { 'aria-label': 'Matters list' }, h('div.toolbar', statusWrap, search, h('div.spacer'), areaSel, respSel, table.columnsButton(), exportBtn), bulk, table.node),
    ),
  };
}
