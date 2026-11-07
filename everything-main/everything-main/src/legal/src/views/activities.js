/** Activities: every time, expense, and flat fee entry, with filters, totals, and bulk edits. */
import '../styles/billing.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, meId } from '../app.js';
import { pageHeader, segmented, searchBox, select, dataTable, emptyState, textInput, pill, field } from '../ui/components.js';
import { setQuery } from '../ui/router.js';
import { openMenu } from '../ui/menu.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { matterLink, userChip, moneyCell, matterPicker, rememberSort, saveSort } from './common.js';
import { openActivityDialog } from './dialogs.js';
import { activityAmount } from '../core/finance.js';
import { filterActivities, activityTotals, activityBillingState, shiftRange } from '../core/billing-ops.js';
import { formatHoursDecimal } from '../core/duration.js';
import { formatMoney } from '../core/money.js';
import { formatDate, namedRange, RANGE_OPTIONS } from '../core/dates.js';
import { categoryName } from '../core/settings.js';
import { matterLabel } from '../core/format.js';
import { downloadCsv } from '../core/csv.js';

const KIND_ICON = { time: 'clock', expense: 'receipt', flat: 'dollar' };
const KIND_LABEL = { time: 'Time', expense: 'Expense', flat: 'Flat fee' };

export function render(ctx) {
  const store = app.store;
  const s = () => app.settings();
  const q = ctx.query;
  const state = {
    kind: ['time', 'expense', 'flat'].includes(q.kind) ? q.kind : 'all',
    range: q.from || q.to ? 'custom' : q.range || 'month',
    from: q.from || '',
    to: q.to || '',
    user: q.user ?? '',
    billed: ['unbilled', 'billed', 'nonbillable'].includes(q.billed) ? q.billed : 'all',
    matterId: q.matter || '',
    q: q.q || '',
  };
  if (state.range !== 'custom') applyPreset(state.range);

  function applyPreset(name) {
    const r = namedRange(name, app.today(), s().weekStart);
    state.from = r ? r[0] : '';
    state.to = r ? r[1] : '';
  }

  const addBtn = h(
    'div.btn-group',
    h('button.btn.primary', { type: 'button', onClick: () => openActivityDialog({ kind: 'time', matterId: state.matterId }) }, icon('plus', 16), 'Add entry'),
    h('button.btn.primary', { type: 'button', 'aria-label': 'Choose entry type', onClick: (e) => openAddMenu(e.currentTarget) }, icon('chevron-down', 16)),
  );
  function openAddMenu(anchor) {
    openMenu(
      anchor,
      ['time', 'expense', 'flat'].map((k) => ({ label: `${KIND_LABEL[k]} entry`, icon: KIND_ICON[k], run: () => openActivityDialog({ kind: k, matterId: state.matterId }) })),
      { align: 'end', label: 'New entry' },
    );
  }

  const header = pageHeader({ title: 'Activities', actions: [addBtn] });

  // ---- Toolbar ----
  const kindSeg = segmented({
    label: 'Entry type',
    value: state.kind,
    items: [
      { value: 'all', label: 'All' },
      { value: 'time', label: 'Time', icon: 'clock' },
      { value: 'expense', label: 'Expense', icon: 'receipt' },
      { value: 'flat', label: 'Flat fee', icon: 'dollar' },
    ],
    onChange: (v) => {
      state.kind = v;
      setQuery({ kind: v === 'all' ? '' : v });
      refresh();
    },
  });
  const rangeSel = select({ name: 'range', 'aria-label': 'Date range', value: state.range, options: [...RANGE_OPTIONS, { value: 'custom', label: 'Custom range' }] });
  const fromI = textInput({ name: 'from', type: 'date', value: state.from, 'aria-label': 'From date' });
  const toI = textInput({ name: 'to', type: 'date', value: state.to, 'aria-label': 'To date' });
  const prevBtn = h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Previous period', title: 'Previous period', onClick: () => step(-1) }, icon('chevron-left', 16));
  const nextBtn = h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Next period', title: 'Next period', onClick: () => step(1) }, icon('chevron-right', 16));
  rangeSel.addEventListener('change', () => {
    state.range = rangeSel.value;
    if (state.range !== 'custom') applyPreset(state.range);
    syncRange();
    refresh();
  });
  for (const el of [fromI, toI])
    el.addEventListener('change', () => {
      state.range = 'custom';
      state.from = fromI.value;
      state.to = toI.value;
      syncRange();
      refresh();
    });
  function step(dir) {
    const r = shiftRange(state.from, state.to, dir);
    if (!r) return;
    [state.from, state.to] = r;
    state.range = 'custom';
    syncRange();
    refresh();
  }
  function syncRange() {
    rangeSel.value = state.range;
    fromI.value = state.from;
    toI.value = state.to;
    const can = !!(state.from && state.to);
    prevBtn.disabled = !can;
    nextBtn.disabled = !can;
    setQuery(state.range === 'custom' ? { range: '', from: state.from, to: state.to } : { range: state.range === 'month' ? '' : state.range, from: '', to: '' });
  }

  const userSel = select({
    name: 'user',
    'aria-label': 'Firm user',
    value: state.user,
    options: [{ value: '', label: 'Everyone' }, { value: 'me', label: 'Me' }, ...lookup.activeUsers().map((u) => ({ value: u.id, label: u.name }))],
  });
  userSel.addEventListener('change', () => {
    state.user = userSel.value;
    setQuery({ user: state.user });
    refresh();
  });
  const billedSel = select({
    name: 'billed',
    'aria-label': 'Billing status',
    value: state.billed,
    options: [
      { value: 'all', label: 'Any billing status' },
      { value: 'unbilled', label: 'Unbilled' },
      { value: 'billed', label: 'Billed' },
      { value: 'nonbillable', label: 'Non-billable' },
    ],
  });
  billedSel.addEventListener('change', () => {
    state.billed = billedSel.value;
    setQuery({ billed: state.billed === 'all' ? '' : state.billed });
    refresh();
  });
  const matterF = matterPicker({
    name: 'matterFilter',
    value: state.matterId,
    label: 'Filter by matter',
    placeholder: 'All matters',
    onChange: (id) => {
      state.matterId = id;
      setQuery({ matter: id });
      refresh();
    },
  });
  matterF.classList.add('toolbar-picker');
  const search = searchBox({
    value: state.q,
    placeholder: 'Search descriptions',
    label: 'Search activities',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      refresh();
    },
  });

  // ---- Table ----
  const bulk = h('div.bulk-bar', { hidden: true });
  const columns = [
    {
      id: 'type',
      label: 'Type',
      srLabel: 'Type',
      width: '56px',
      fixed: true,
      render: (a) => h('span.kind-icon', { title: KIND_LABEL[a.kind], 'data-kind': a.kind }, icon(KIND_ICON[a.kind] || 'clock', 15), h('span.sr-only', KIND_LABEL[a.kind])),
      sort: (a) => a.kind,
    },
    { id: 'date', label: 'Date', width: '112px', render: (a) => formatDate(a.date), sort: (a) => a.date },
    {
      id: 'hours',
      label: 'Hours',
      align: 'r',
      width: '80px',
      render: (a) => (a.kind === 'time' ? h('span.num', formatHoursDecimal(a.minutes, 1)) : h('span.subtle', '')),
      sort: (a) => (a.kind === 'time' ? a.minutes : -1),
    },
    {
      id: 'description',
      label: 'Description',
      fixed: true,
      width: '28%',
      render: (a) => h('button.cell-btn', { type: 'button', 'data-act': a.id, title: a.description || 'Edit entry' }, a.description || h('span.subtle', 'No description')),
      sort: (a) => a.description || '',
    },
    { id: 'matter', label: 'Matter', render: (a) => (a.matterId ? matterLink(a.matterId) : h('span.subtle', 'No matter')), sort: (a) => lookup.matter(a.matterId)?.displayNumber || '' },
    { id: 'category', label: 'Category', render: (a) => categoryName(s(), a.categoryId), sort: (a) => categoryName(s(), a.categoryId) },
    { id: 'user', label: 'User', render: (a) => userChip(a.userId), sort: (a) => lookup.userName(a.userId) },
    {
      id: 'rate',
      label: 'Rate',
      align: 'r',
      render: (a) => (a.kind === 'time' ? h('span.num', `${formatMoney(a.rateCents)}/h`) : a.kind === 'expense' ? h('span.num', `${a.qty ?? 1} × ${formatMoney(a.priceCents)}`) : ''),
      sort: (a) => a.rateCents || a.priceCents || 0,
    },
    { id: 'amount', label: 'Amount', align: 'r', render: (a) => moneyCell(activityAmount(a)), sort: (a) => activityAmount(a) },
    { id: 'billing', label: 'Billing', render: billingCell, sort: (a) => activityBillingState(a) },
  ];

  const table = dataTable({
    caption: 'Activities',
    columns,
    columnsKey: 'activities',
    sort: rememberSort('activities', { id: 'date', dir: 'desc' }),
    onSort: (v) => saveSort('activities', v),
    selectable: true,
    onSelectionChange: drawBulk,
    mobile: (a) =>
      h(
        'button.list-item.list-btn',
        { type: 'button', onClick: () => openActivityDialog({ activity: a }) },
        h('span.kind-icon', { 'data-kind': a.kind }, icon(KIND_ICON[a.kind], 15)),
        h(
          'span.grow',
          h('span.title.truncate', a.description || KIND_LABEL[a.kind]),
          h('span.sub', [formatDate(a.date), a.kind === 'time' ? `${formatHoursDecimal(a.minutes, 1)} h` : '', lookup.matter(a.matterId)?.displayNumber || ''].filter(Boolean).join(' · ')),
        ),
        h('span.num.strong', formatMoney(activityAmount(a))),
      ),
    empty: () =>
      store.all('activities').length
        ? emptyState({ compact: true, icon: 'search', title: 'No matching entries', text: 'Try a different date range or filter.', headingLevel: 3 })
        : emptyState({
            icon: 'clock',
            title: 'No entries yet',
            text: 'Track every minute and every expense. Use the timer at the top or add an entry.',
            actions: [h('button.btn.primary', { type: 'button', onClick: () => openActivityDialog({ kind: 'time' }) }, icon('plus', 16), 'Add time entry')],
            headingLevel: 3,
          }),
    footer: (rows) => {
      const t = activityTotals(rows);
      return [
        h('span', h('strong', String(t.count)), t.count === 1 ? ' entry' : ' entries'),
        h('span', 'Billable ', h('strong', `${formatHoursDecimal(t.billableMinutes, 1)} h`)),
        h('span', 'Non-billable ', h('strong', `${formatHoursDecimal(t.nonBillableMinutes, 1)} h`)),
        h('span', 'Billable amount ', h('strong', formatMoney(t.billableAmount))),
      ];
    },
  });
  table.node.classList.add('act-table');
  // Clicking anywhere on a row opens the entry.
  table.node.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) return edit(btn.dataset.act);
    if (e.target.closest('a, button, input, label, select')) return;
    const tr = e.target.closest('tbody tr');
    const id = tr?.querySelector('[data-act]')?.dataset.act;
    if (id) edit(id);
  });
  function edit(id) {
    const a = store.get('activities', id);
    if (a) openActivityDialog({ activity: a });
  }

  function billingCell(a) {
    const st = activityBillingState(a);
    if (st === 'nonbillable') return pill('Non-billable', 'neutral');
    if (st === 'unbilled') return pill('Unbilled', 'warning');
    const b = store.get('bills', a.billId);
    return b ? h('a.pill.success.pill-link', { href: `#/bills/${b.id}` }, b.status === 'draft' ? `Draft #${b.number}` : `Bill #${b.number}`) : pill('Billed', 'success');
  }

  function rows() {
    const me = meId();
    return filterActivities(store.all('activities'), {
      kind: state.kind,
      from: state.from,
      to: state.to,
      userId: state.user === 'me' ? me || '__none' : state.user,
      billed: state.billed,
      matterId: state.matterId,
      q: state.q,
      textOf: (a) => `${a.description || ''} ${categoryName(s(), a.categoryId)} ${lookup.matter(a.matterId)?.displayNumber || ''}`,
    });
  }

  function drawBulk(sel) {
    bulk.hidden = !sel.size;
    if (!sel.size) return;
    const chosen = [...sel].map((id) => store.get('activities', id)).filter(Boolean);
    // Redrawn on every refresh, so keep keyboard focus on the same button.
    const focused = bulk.contains(document.activeElement) ? document.activeElement.textContent : null;
    bulk.replaceChildren(
      h('span', `${sel.size} selected`),
      h('div.spacer'),
      h('button.btn.sm', { type: 'button', onClick: () => setBillable(chosen, true) }, 'Mark billable'),
      h('button.btn.sm', { type: 'button', onClick: () => setBillable(chosen, false) }, 'Mark non-billable'),
      h('button.btn.sm', { type: 'button', onClick: () => changeMatter(chosen) }, icon('briefcase', 15), 'Change matter'),
      h('button.btn.sm', { type: 'button', onClick: () => exportCsv(chosen) }, icon('download', 15), 'Export'),
      h('button.btn.sm.danger-text', { type: 'button', onClick: () => bulkDelete(chosen) }, icon('trash', 15), 'Delete'),
      h('button.btn.sm.ghost', { type: 'button', onClick: () => table.clearSelection() }, 'Clear'),
    );
    if (focused !== null) ([...bulk.querySelectorAll('button')].find((x) => x.textContent === focused) || bulk.querySelector('button'))?.focus();
  }

  /** Current copies of the entries, split into unbilled and billed. */
  function splitBilled(list) {
    const cur = list.map((a) => store.get('activities', a.id)).filter(Boolean);
    const free = cur.filter((a) => !a.billId);
    return { free, billed: cur.length - free.length };
  }

  function setBillable(list, billable) {
    const { free, billed } = splitBilled(list);
    for (const a of free) store.patch('activities', a.id, { billable });
    toast(
      `${free.length} ${free.length === 1 ? 'entry' : 'entries'} marked ${billable ? 'billable' : 'non-billable'}${billed ? `. ${billed} already on a bill ${billed === 1 ? 'was' : 'were'} left unchanged.` : ''}`,
    );
    table.clearSelection();
  }

  function changeMatter(list) {
    const { free, billed } = splitBilled(list);
    if (!free.length) return toast('These entries are on bills. Remove them from their bills first.', { type: 'info' });
    const picker = matterPicker({ value: '', required: true });
    openDialog({
      title: `Move ${free.length} ${free.length === 1 ? 'entry' : 'entries'}`,
      subtitle: billed ? `${billed} billed ${billed === 1 ? 'entry stays' : 'entries stay'} on ${billed === 1 ? 'its' : 'their'} current matter.` : null,
      body: h('div.stack', field('New matter', picker, { required: true })),
      footer: ({ close }) => [
        h('div.spacer'),
        h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
        h(
          'button.btn.primary',
          {
            type: 'button',
            onClick: () => {
              if (!picker.value) {
                picker.input.setAttribute('aria-invalid', 'true');
                return picker.input.focus();
              }
              // Entries billed while the dialog was open stay where they are.
              for (const a of splitBilled(free).free) store.patch('activities', a.id, { matterId: picker.value });
              toast(`Moved to ${matterLabel(lookup.matter(picker.value))}`);
              table.clearSelection();
              close();
            },
          },
          'Move entries',
        ),
      ],
    });
  }

  async function bulkDelete(list) {
    const { free, billed } = splitBilled(list);
    if (!free.length) return toast('Entries on bills cannot be deleted here. Remove them from their bills first.', { type: 'info', duration: 6000 });
    const ok = await confirmDialog({
      title: `Delete ${free.length} ${free.length === 1 ? 'entry' : 'entries'}?`,
      message: billed ? `${billed} billed ${billed === 1 ? 'entry' : 'entries'} will be kept. You can undo right after deleting.` : 'You can undo right after deleting.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    // An entry may have been billed while the question was open.
    const { free: now } = splitBilled(free);
    if (!now.length) return;
    store.bulkRemove(
      'activities',
      now.map((a) => a.id),
    );
    table.clearSelection();
    toast(`${now.length} ${now.length === 1 ? 'entry' : 'entries'} deleted`, { action: { label: 'Undo', run: () => now.forEach((a) => store.restore('activities', a)) } });
  }

  function exportCsv(list) {
    const head = ['Date', 'Type', 'Hours', 'Description', 'Matter', 'Client', 'Category', 'User', 'Rate', 'Quantity', 'Price', 'Amount', 'Billable', 'Bill number'];
    const out = list.map((a) => {
      const m = lookup.matter(a.matterId);
      return [
        a.date,
        KIND_LABEL[a.kind],
        a.kind === 'time' ? formatHoursDecimal(a.minutes) : '',
        a.description || '',
        m?.displayNumber || '',
        m ? lookup.contactName(m.clientId) : '',
        categoryName(s(), a.categoryId),
        lookup.userName(a.userId),
        a.kind === 'time' ? (a.rateCents / 100).toFixed(2) : '',
        a.kind === 'expense' ? (a.qty ?? 1) : '',
        a.kind === 'expense' ? (a.priceCents / 100).toFixed(2) : '',
        (activityAmount(a) / 100).toFixed(2),
        a.billable === false ? 'No' : 'Yes',
        store.get('bills', a.billId)?.number ?? '',
      ];
    });
    downloadCsv(`activities-${state.from || 'all'}-${state.to || app.today()}.csv`, [head, ...out]);
  }

  function refresh() {
    table.setRows(rows());
    // Rows a filter hides leave the selection; redraw the bulk bar to match.
    drawBulk(table.selected);
  }
  syncRange();
  refresh();
  ctx.watch(['activities', 'matters', 'bills', 'users', 'settings'], refresh);

  return {
    title: 'Activities',
    node: h(
      'div.page.fill',
      header,
      h(
        'section.card.list-card',
        { 'aria-label': 'Activity entries' },
        h('div.toolbar', kindSeg, h('div.range-group', { role: 'group', 'aria-label': 'Date range' }, prevBtn, rangeSel, fromI, h('span.subtle', { 'aria-hidden': 'true' }, 'to'), toI, nextBtn)),
        h(
          'div.toolbar',
          search,
          matterF,
          userSel,
          billedSel,
          h('div.spacer'),
          table.columnsButton(),
          h('button.btn', { type: 'button', onClick: () => exportCsv(table.rows) }, icon('download', 16), h('span.hide-sm', 'Export')),
        ),
        bulk,
        table.node,
      ),
    ),
  };
}
