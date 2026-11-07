/** Communication logs across the firm: calls, emails, meetings, internal messages. */
import '../styles/contacts.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, segmented, searchBox, select, dataTable, emptyState } from '../ui/components.js';
import { setQuery } from '../ui/router.js';
import { openMenu } from '../ui/menu.js';
import { rememberSort, saveSort } from './common.js';
import { commColumns, commMobile, KIND_META } from './comms-table.js';
import { matches, matterLabel } from '../core/format.js';
import { namedRange, RANGE_OPTIONS } from '../core/dates.js';
import { formatHoursDecimal } from '../core/duration.js';
import { downloadCsv } from '../core/csv.js';

const KINDS = ['all', 'phone', 'email', 'meeting', 'message'];

export function render(ctx) {
  const store = app.store;
  const state = {
    kind: KINDS.includes(ctx.query.kind) ? ctx.query.kind : 'all',
    range: RANGE_OPTIONS.some((r) => r.value === ctx.query.range) ? ctx.query.range : 'all',
    user: ctx.query.user || '',
    q: ctx.query.q || '',
  };

  const logBtn = h('button.btn.primary', { type: 'button' }, icon('plus', 16), 'Log communication', icon('chevron-down', 14));
  logBtn.addEventListener('click', async () => {
    const { LOG_KINDS, openLogDialog } = await import('./dialogs.js');
    openMenu(
      logBtn,
      LOG_KINDS.map((k) => ({ label: k.label, icon: k.icon, run: () => openLogDialog({ kind: k.id }) })),
      { align: 'end', label: 'Log communication' },
    );
  });

  const header = pageHeader({
    title: 'Communications',
    subtitle: 'Calls, emails, meetings, and internal messages logged against matters and contacts.',
    actions: [h('button.btn', { type: 'button', 'aria-label': 'Export', onClick: () => exportCsv(table.rows) }, icon('download', 16), h('span.hide-sm', 'Export')), logBtn],
  });

  const kindWrap = h('div');
  const rangeSel = select({ name: 'range', value: state.range, 'aria-label': 'Date range', options: RANGE_OPTIONS });
  rangeSel.addEventListener('change', () => {
    state.range = rangeSel.value;
    setQuery({ range: state.range === 'all' ? '' : state.range });
    table.setRows(rows());
  });
  const userSel = select({
    name: 'user',
    value: state.user,
    'aria-label': 'Firm user',
    options: [{ value: '', label: 'Everyone' }, { value: 'me', label: 'Me' }, ...lookup.activeUsers().map((u) => ({ value: u.id, label: u.name }))],
  });
  userSel.addEventListener('change', () => {
    state.user = userSel.value;
    setQuery({ user: state.user });
    table.setRows(rows());
  });

  const table = dataTable({
    caption: 'Communications',
    columns: commColumns(),
    columnsKey: 'communications',
    sort: rememberSort('communications', { id: 'date', dir: 'desc' }),
    onSort: (v) => saveSort('communications', v),
    mobile: commMobile,
    empty: () =>
      store.all('communications').length
        ? emptyState({ compact: true, icon: 'search', title: 'No matching logs', text: 'Try a different type, date range, or search.', headingLevel: 3 })
        : emptyState({
            icon: 'messages',
            title: 'No communications logged',
            text: 'Log phone calls, emails, and meetings with clients and other parties, and send internal messages about a matter. A logged call can be recorded as billable time in the same step.',
            actions: [h('button.btn.primary', { type: 'button', onClick: () => logBtn.click() }, icon('plus', 16), 'Log communication')],
            headingLevel: 3,
          }),
    footer: (list) => {
      let minutes = 0;
      for (const c of list) minutes += Number(c.minutes) || 0;
      return [h('span', h('strong', String(list.length)), list.length === 1 ? ' log' : ' logs'), minutes ? h('span', 'Time spent ', h('strong', `${formatHoursDecimal(minutes, 1)} h`)) : null];
    },
  });

  function rows() {
    const range = namedRange(state.range, app.today(), app.settings().weekStart);
    const me = app.me()?.id;
    const user = state.user === 'me' ? me : state.user;
    return store.all('communications').filter((c) => {
      if (state.kind !== 'all' && c.kind !== state.kind) return false;
      if (range && (c.date < range[0] || c.date > range[1])) return false;
      if (user && c.fromUserId !== user && c.toUserId !== user) return false;
      if (state.q) {
        const m = lookup.matter(c.matterId);
        const hay = [c.subject, c.body, m ? matterLabel(m) : '', lookup.contactName(c.contactId), lookup.userName(c.toUserId), lookup.userName(c.fromUserId)].join(' ');
        if (!matches(hay, state.q)) return false;
      }
      return true;
    });
  }

  function drawKinds() {
    const all = store.all('communications');
    const count = (k) => all.filter((c) => c.kind === k).length;
    kindWrap.replaceChildren(
      segmented({
        label: 'Communication type',
        value: state.kind,
        items: [{ value: 'all', label: 'All', count: all.length }, ...KINDS.slice(1).map((k) => ({ value: k, label: k === 'message' ? 'Messages' : `${KIND_META[k].label}s`, count: count(k) }))],
        onChange: (v) => {
          state.kind = v;
          setQuery({ kind: v === 'all' ? '' : v });
          table.setRows(rows());
        },
      }),
    );
  }

  function exportCsv(list) {
    const head = ['Type', 'Subject', 'Date', 'Time', 'Matter', 'Contact', 'To (internal)', 'Logged by', 'Direction', 'Hours', 'Details'];
    const out = list.map((c) => [
      KIND_META[c.kind]?.label || c.kind,
      c.subject || '',
      c.date || '',
      c.time || '',
      lookup.matter(c.matterId)?.displayNumber || '',
      lookup.contactName(c.contactId),
      lookup.userName(c.toUserId),
      lookup.userName(c.fromUserId),
      c.direction === 'in' ? 'Incoming' : c.direction === 'out' ? 'Outgoing' : '',
      c.minutes ? formatHoursDecimal(c.minutes) : '',
      c.body || '',
    ]);
    downloadCsv(`communications-${app.today()}.csv`, [head, ...out]);
  }

  const search = searchBox({
    value: state.q,
    placeholder: 'Search logs',
    label: 'Search communications',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      table.setRows(rows());
    },
  });

  function refresh() {
    drawKinds();
    table.setRows(rows());
  }
  refresh();
  ctx.watch(['communications', 'matters', 'contacts', 'users', 'activities'], refresh);

  return {
    title: 'Communications',
    node: h(
      'div.page.fill',
      header,
      h('section.card.list-card', { 'aria-label': 'Communication logs' }, h('div.toolbar', kindWrap, search, h('div.spacer'), rangeSel, userSel, table.columnsButton()), table.node),
    ),
  };
}
