/** Vendors: who does the work, what is open with them, and what you owe. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app } from '../../app.js';
import { pageHeader, chips, dataTable, emptyState, searchBox } from '../../ui/components.js';
import { setQuery } from '../../ui/router.js';
import { money, date, rememberSort, saveSort, exportCSV, personAvatar, csvMoney } from '../common.js';
import { displayName, secondaryName, primaryEmail, primaryPhone, matches } from '../../core/format.js';
import { isOpenWorkOrder, insuranceState } from './shared.js';

export function insuranceCell(v, today) {
  if (!v.insuranceExpires) return h('span.subtle', 'Not on file');
  const st = insuranceState(v, today);
  return h(`span.nowrap${st === 'expired' ? '.overdue' : st === 'soon' ? '.due-soon' : ''}`, st ? icon('warning', 13) : null, st === 'expired' ? `Expired ${date(v.insuranceExpires, { month: 'short', day: 'numeric', year: 'numeric' })}` : date(v.insuranceExpires, { month: 'short', day: 'numeric', year: 'numeric' }));
}

export function render(ctx) {
  const store = app.store;
  const state = { q: ctx.query.q || '', category: ctx.query.category || 'all', showInactive: ctx.query.inactive === '1', sort: rememberSort('vendors', { id: 'name', dir: 'asc' }) };
  const search = searchBox({
    value: state.q,
    placeholder: 'Search name, category, phone or email',
    label: 'Search vendors',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      body.redraw();
    },
  });

  const body = ctx.live(() => {
    const today = app.today();
    const ledger = app.ledger();
    const all = store.all('vendors');
    const openCount = new Map();
    for (const w of store.all('workOrders')) if (w.vendorId && isOpenWorkOrder(w)) openCount.set(w.vendorId, (openCount.get(w.vendorId) || 0) + 1);
    if (!all.length) {
      return h('section.card', emptyState({ icon: 'truck', title: 'No vendors yet', text: 'Add the plumbers, electricians, cleaners and suppliers you work with.', headingLevel: 2, actions: [h('a.btn.primary', { href: '#/vendors/new' }, icon('plus', 16), 'New vendor')] }));
    }
    const visible = all.filter((v) => state.showInactive || v.active !== false);
    const cats = [...new Set(visible.map((v) => v.category).filter(Boolean))].sort();
    const rows = visible.filter((v) => (state.category === 'all' || v.category === state.category) && (!state.q || matches(`${displayName(v)} ${secondaryName(v)} ${v.category || ''} ${(v.emails || []).join(' ')} ${(v.phones || []).join(' ')}`, state.q)));
    const inactive = all.length - all.filter((v) => v.active !== false).length;
    return h(
      'section.card.list-card',
      { 'aria-label': 'Vendors' },
      h(
        'div.toolbar',
        search,
        h('div.grow'),
        inactive
          ? h('label.check', h('input', { type: 'checkbox', checked: state.showInactive, onChange: (e) => ((state.showInactive = e.target.checked), setQuery({ inactive: e.target.checked ? '1' : '' }), body.redraw()) }), `Show inactive (${inactive})`)
          : null,
      ),
      cats.length > 1
        ? h(
            'div.toolbar.sub-toolbar',
            chips({
              label: 'Category',
              selected: state.category,
              onSelect: (id) => {
                state.category = id;
                setQuery({ category: id === 'all' ? '' : id });
                body.redraw();
              },
              items: [{ id: 'all', label: 'All', count: visible.length }, ...cats.map((c) => ({ id: c, label: c, count: visible.filter((v) => v.category === c).length }))],
            }),
          )
        : null,
      h('div.sr-only', { role: 'status' }, `${rows.length} vendors`),
      dataTable({
        caption: 'Vendors',
        rows,
        sort: state.sort,
        onSort: (s) => {
          state.sort = s;
          saveSort('vendors', s);
          body.redraw();
        },
        rowHref: (v) => `#/vendors/${v.id}`,
        columns: [
          { id: 'name', label: 'Name', cls: 'primary-cell', sort: (v) => displayName(v).toLowerCase(), render: (v) => h('span.person-cell', personAvatar({ firstName: displayName(v) }, { size: 'sm' }), h('span', displayName(v), v.active === false ? h('span.pill', { style: { marginLeft: '6px' } }, 'Inactive') : null, secondaryName(v) ? h('span.sub', { style: { display: 'block' } }, secondaryName(v)) : null)) },
          { id: 'category', label: 'Category', sort: (v) => v.category || '', render: (v) => v.category || h('span.subtle', 'None') },
          { id: 'phone', label: 'Phone', render: (v) => primaryPhone(v) || h('span.subtle', 'None') },
          { id: 'email', label: 'Email', render: (v) => (primaryEmail(v) ? h('span.truncate.email-cell', primaryEmail(v)) : h('span.subtle', 'None')) },
          { id: 'open', label: 'Open work', align: 'r', sort: (v) => openCount.get(v.id) || 0, render: (v) => (openCount.get(v.id) ? String(openCount.get(v.id)) : h('span.subtle', '0')) },
          { id: 'owed', label: 'Owed', align: 'r', sort: (v) => ledger.vendorOwed(v.id), render: (v) => (ledger.vendorOwed(v.id) ? h('span.num', money(ledger.vendorOwed(v.id))) : h('span.subtle.num', money(0))) },
          { id: 'insurance', label: 'Insurance', sort: (v) => v.insuranceExpires || '', render: (v) => insuranceCell(v, today) },
        ],
        mobile: (v) =>
          h(
            'a.mobile-row',
            { href: `#/vendors/${v.id}` },
            h('div.grow', { style: { minWidth: '0' } }, h('div.m-title', displayName(v)), h('div.m-sub', [v.category, primaryPhone(v)].filter(Boolean).join(' · '))),
            h('div.m-end', ledger.vendorOwed(v.id) ? h('span.num', money(ledger.vendorOwed(v.id))) : null, insuranceState(v, today) ? h('span.overdue', icon('warning', 13), 'Insurance') : null),
          ),
        empty: emptyState({ compact: true, icon: 'search', title: 'No matching vendors', text: 'Try a different search or category.', headingLevel: 3 }),
      }),
    );
  }, ['vendors', 'workOrders', 'transactions']);

  const exportBtn = h(
    'button.icon-btn.bordered',
    {
      type: 'button',
      'aria-label': 'Export vendors to CSV',
      title: 'Export to CSV',
      onClick: () => {
        const ledger = app.ledger();
        exportCSV('vendors', [
          { label: 'Name', value: (v) => displayName(v) },
          { label: 'Contact', value: (v) => secondaryName(v) },
          { label: 'Category', value: (v) => v.category || '' },
          { label: 'Phone', value: (v) => primaryPhone(v) },
          { label: 'Email', value: (v) => primaryEmail(v) },
          { label: 'Insurance expires', value: (v) => v.insuranceExpires || '' },
          { label: 'Owed', value: (v) => csvMoney(ledger.vendorOwed(v.id)) },
        ], store.all('vendors'));
      },
    },
    icon('download'),
  );
  return { node: h('div.page', pageHeader({ title: 'Vendors', actions: [exportBtn, h('a.btn.primary', { href: '#/vendors/new' }, icon('plus', 16), 'New vendor')] }), body), title: 'Vendors' };
}
