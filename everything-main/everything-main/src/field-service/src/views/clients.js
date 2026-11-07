/** Clients list: stats, search, status and tag filters, sortable table. */
import { h, keepFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { pageHeader, stat, searchBox, chips, dataTable, statusPill, emptyState, avatar, moreButton, select } from '../ui/components.js';
import { openMenu } from '../ui/menu.js';
import { setQuery } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { clientName, clientSecondary, formatAddress, matches, primaryEmail, primaryPhone, pluralize } from '../core/format.js';
import { clientStatus } from '../core/status.js';
import { addDays, timeAgo, localDate } from '../core/dates.js';
import { money, rememberSort, saveSort } from './common.js';
import { clientBalance } from '../core/workflow.js';
import { downloadText } from '../core/csv.js';
import { importClientsCSV, exportClientsCSV } from '../core/clients-io.js';

export function render(ctx) {
  const store = app.store;
  const paging = {};
  const state = {
    q: ctx.query.q || '',
    status: ctx.query.status || 'current',
    tag: ctx.query.tag || '',
    sort: rememberSort('clients', { id: 'activity', dir: 'desc' }),
  };

  const header = pageHeader({
    title: 'Clients',
    actions: [
      moreButton((btn) =>
        openMenu(btn, [
          { label: 'Import clients from CSV', icon: 'file-up', run: importCSV },
          { label: 'Export clients to CSV', icon: 'file-down', run: exportCSV },
        ]),
      ),
      h('a.btn.primary', { href: '#/clients/new' }, icon('user-plus', 16), 'New client'),
    ],
  });

  const stats = ctx.live(() => {
    const today = app.today();
    const since = addDays(today, -30);
    const jobs = store.all('jobs');
    const invoices = store.all('invoices');
    const clients = store.all('clients');
    const recent = clients.filter((c) => localDate(c.createdAt) >= since);
    const leads = recent.filter((c) => clientStatus(c, { jobs, invoices }) === 'lead').length;
    const active = clients.filter((c) => clientStatus(c, { jobs, invoices }) === 'client_active').length;
    const owed = clients.reduce((s, c) => s + clientBalance(store, c.id), 0);
    return h(
      'div.stats.list-stats',
      stat({ label: 'New leads', value: String(leads), sub: 'Past 30 days', onClick: () => setFilter('lead') }),
      stat({ label: 'New clients', value: String(recent.length), sub: 'Past 30 days' }),
      stat({ label: 'Active clients', value: String(active), sub: 'With jobs or invoices', onClick: () => setFilter('active') }),
      stat({ label: 'Outstanding balance', value: money(owed), sub: 'Across all clients', href: '#/invoices?status=open' }),
    );
  }, ['clients', 'jobs', 'invoices', 'payments']);

  const search = searchBox({
    value: state.q,
    placeholder: 'Search name, email, phone or address',
    label: 'Search clients',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      results.draw();
    },
  });

  const filterRow = h('div');
  function setFilter(s) {
    state.status = s;
    setQuery({ status: s === 'current' ? '' : s });
    keepFocus(filterRow, drawFilters);
    results.draw();
  }

  function drawFilters() {
    const jobs = store.all('jobs');
    const invoices = store.all('invoices');
    const counts = { current: 0, lead: 0, active: 0, archived: 0 };
    const tags = new Set();
    for (const c of store.all('clients')) {
      const s = clientStatus(c, { jobs, invoices });
      if (s === 'archived') counts.archived++;
      else {
        counts.current++;
        if (s === 'lead') counts.lead++;
        else counts.active++;
      }
      for (const t of c.tags || []) tags.add(t);
    }
    // A tag from the link that no client has (any more) still filters, so show it.
    if (state.tag) tags.add(state.tag);
    const tagSel = tags.size
      ? select({
          name: 'tag',
          value: state.tag,
          cls: 'sm',
          'aria-label': 'Filter by tag',
          options: [{ value: '', label: 'All tags' }, ...[...tags].sort().map((t) => ({ value: t, label: t }))],
          onChange: (e) => {
            state.tag = e.target.value;
            setQuery({ tag: state.tag });
            results.draw();
          },
          style: { width: 'auto', minWidth: '130px' },
        })
      : null;
    filterRow.replaceChildren(
      h(
        'div.row',
        { style: { flexWrap: 'wrap', gap: '10px' } },
        chips({
          label: 'Client status',
          selected: state.status,
          onSelect: setFilter,
          items: [
            { id: 'current', label: 'Leads and active', count: counts.current },
            { id: 'lead', label: 'Leads', count: counts.lead },
            { id: 'active', label: 'Active', count: counts.active },
            { id: 'archived', label: 'Archived', count: counts.archived },
          ],
        }),
        tagSel,
      ),
    );
  }
  drawFilters();

  // One live region for the whole visit: screen readers announce changes to
  // a region already on the page, not a new one swapped in with each redraw.
  const count = h('div.sr-only', { role: 'status' });
  const results = { node: h('div') };
  results.draw = () => {
    const jobs = store.all('jobs');
    const invoices = store.all('invoices');
    const rows = store.all('clients').filter((c) => {
      const s = clientStatus(c, { jobs, invoices });
      if (state.status === 'current' && s === 'archived') return false;
      if (state.status === 'lead' && s !== 'lead') return false;
      if (state.status === 'active' && s !== 'client_active') return false;
      if (state.status === 'archived' && s !== 'archived') return false;
      if (state.tag && !(c.tags || []).includes(state.tag)) return false;
      if (state.q) {
        const hay = [clientName(c), c.company, ...(c.emails || []).map((e) => e.address), ...(c.phones || []).map((p) => p.number), ...(c.properties || []).map((p) => formatAddress(p)), ...(c.tags || [])].join(' ');
        if (!matches(hay, state.q)) return false;
      }
      return true;
    });
    const statusOf = (c) => clientStatus(c, { jobs, invoices });
    const total = store.all('clients').length;
    count.textContent = pluralize(rows.length, 'client');
    results.node.replaceChildren(
      dataTable({
        caption: 'Clients',
        rows,
        sort: state.sort,
        onSort: (s) => {
          state.sort = s;
          saveSort('clients', s);
          keepFocus(results.node, results.draw);
        },
        rowHref: (c) => `#/clients/${c.id}`,
        paging,
        pagingKey: JSON.stringify([state.q, state.status, state.tag, state.sort]),
        columns: [
          {
            id: 'name',
            label: 'Name',
            sort: (c) => clientName(c).toLowerCase(),
            cls: 'primary-cell',
            render: (c) =>
              h(
                'span.row',
                { style: { gap: '10px' } },
                avatar(clientName(c), { size: 'sm' }),
                h('span', clientName(c), clientSecondary(c) ? h('span.sub', { style: { display: 'block' } }, clientSecondary(c)) : null),
              ),
          },
          { id: 'address', label: 'Address', sort: (c) => formatAddress(c.properties?.[0]), render: (c) => h('span.truncate', { style: { display: 'block', maxWidth: '320px' } }, formatAddress(c.properties?.[0]) || h('span.subtle', 'No address')) },
          { id: 'contact', label: 'Contact', render: (c) => h('span.sub', primaryPhone(c) || primaryEmail(c) || '') },
          { id: 'tags', label: 'Tags', render: (c) => h('span.tags', (c.tags || []).slice(0, 3).map((t) => h('span.tag', t))) },
          { id: 'status', label: 'Status', sort: (c) => statusOf(c), render: (c) => statusPill(statusOf(c)) },
          { id: 'activity', label: 'Last activity', sort: (c) => c.updatedAt || '', render: (c) => h('span.sub.nowrap', timeAgo(c.updatedAt)) },
        ],
        mobile: (c) =>
          h(
            'a.mobile-row',
            { href: `#/clients/${c.id}` },
            avatar(clientName(c)),
            h('div.grow', { style: { minWidth: '0' } }, h('div.m-title', clientName(c)), h('div.m-sub', formatAddress(c.properties?.[0]) || primaryPhone(c) || primaryEmail(c))),
            h('div.m-end', statusPill(statusOf(c))),
          ),
        empty: total
          ? emptyState({ compact: true, icon: 'search', title: 'No matching clients', text: 'Try a different search or filter.', headingLevel: 3 })
          : emptyState({
              icon: 'users',
              title: 'Add your first client',
              text: 'Clients hold contact details, properties, and the history of every quote, job, and invoice.',
              actions: [h('a.btn.primary', { href: '#/clients/new' }, icon('user-plus', 16), 'New client'), h('button.btn', { type: 'button', onClick: importCSV }, icon('file-up', 16), 'Import CSV')],
              headingLevel: 3,
            }),
      }),
    );
  };
  results.draw();
  const unsub = store.subscribe((c) => {
    if (c.has('clients') || c.has('jobs') || c.has('invoices')) {
      keepFocus(filterRow, drawFilters);
      keepFocus(results.node, results.draw);
    }
  });
  ctx.onDispose(unsub);

  function exportCSV() {
    downloadText(`clients-${app.today()}.csv`, exportClientsCSV(store.all('clients')));
  }

  function importCSV() {
    const input = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      const { clients, skipped } = importClientsCSV(await file.text());
      if (!clients.length) {
        toast('No clients found in that file. Check that it has a header row.', { type: 'error' });
        return;
      }
      store.bulkPut('clients', clients);
      toast(`Imported ${pluralize(clients.length, 'client')}${skipped ? `, skipped ${pluralize(skipped, 'row')} with no name or company` : ''}`);
    });
    document.body.append(input);
    input.click();
  }

  return {
    node: h('div.page', header, stats, h('section.card.list-card', { 'aria-label': 'Client list' }, h('div.toolbar', search, h('div.grow'), filterRow), count, results.node)),
    title: 'Clients',
  };
}
