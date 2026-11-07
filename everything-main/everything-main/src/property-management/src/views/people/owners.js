/** Rental owners: who owns each property, with their share and fees. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app } from '../../app.js';
import { pageHeader, searchBox, dataTable, emptyState, moreButton } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { setQuery } from '../../ui/router.js';
import { displayName, secondaryName, primaryEmail, primaryPhone, matches, telHref, pluralize } from '../../core/format.js';
import { rememberSort, saveSort, exportCSV, personAvatar } from '../common.js';

export function ownedProperties(ownerId) {
  return app.store
    .all('properties')
    .filter((p) => (p.owners || []).some((o) => o.ownerId === ownerId))
    .map((p) => ({ property: p, pct: p.owners.find((o) => o.ownerId === ownerId).pct }));
}

export function render(ctx) {
  const store = app.store;
  const state = { q: ctx.query.q || '', sort: rememberSort('owners', { id: 'name', dir: 'asc' }) };

  const header = pageHeader({
    title: 'Rental owners',
    actions: [moreButton((btn) => openMenu(btn, [{ label: 'Export to CSV', icon: 'download', run: exportAll }])), h('a.btn.primary', { href: '#/owners/new' }, icon('plus', 16), 'New owner')],
  });

  const search = searchBox({
    value: state.q,
    placeholder: 'Search by name, email or property',
    label: 'Search rental owners',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      results.redraw();
    },
  });

  const propsText = (o) =>
    ownedProperties(o.id)
      .map((x) => x.property.name)
      .join(', ');

  const columns = [
    { id: 'name', label: 'Name', sort: displayName, render: (o) => h('span.rn-person', personAvatar({ firstName: displayName(o) }, { size: 'sm' }), h('span', h('span.primary-cell', displayName(o)), secondaryName(o) ? h('span.sub', ` ${secondaryName(o)}`) : null)) },
    {
      id: 'properties',
      label: 'Properties',
      sort: (o) => ownedProperties(o.id).length,
      render: (o) => {
        const list = ownedProperties(o.id);
        if (!list.length) return h('span.subtle', 'None');
        return h('span', list.slice(0, 2).map((x, i) => [i ? ', ' : '', h('a', { href: `#/properties/${x.property.id}` }, x.property.name), x.pct !== 100 ? h('span.subtle', ` (${x.pct}%)`) : null]), list.length > 2 ? h('span.subtle', ` and ${list.length - 2} more`) : null);
      },
    },
    { id: 'fee', label: 'Mgmt fee', align: 'r', sort: (o) => Number(o.managementFee) || 0, render: (o) => (o.managementFee ? h('span.num', `${o.managementFee}%`) : h('span.subtle', 'None')) },
    { id: 'phone', label: 'Phone', render: (o) => (primaryPhone(o) ? h('a', { href: telHref(primaryPhone(o)) }, primaryPhone(o)) : '') },
    { id: 'email', label: 'Email', sort: primaryEmail, render: (o) => (primaryEmail(o) ? h('a.truncate.rn-email', { href: `mailto:${primaryEmail(o)}` }, primaryEmail(o)) : '') },
  ];

  const rows = () => store.all('owners').filter((o) => !state.q || matches(`${displayName(o)} ${secondaryName(o)} ${(o.emails || []).join(' ')} ${(o.phones || []).join(' ')} ${propsText(o)}`, state.q));

  const results = ctx.live(() => {
    const list = rows();
    return [
      h('div.sr-only', { role: 'status' }, `${list.length} rental owners`),
      dataTable({
        caption: 'Rental owners',
        rows: list,
        sort: state.sort,
        onSort: (s) => {
          state.sort = s;
          saveSort('owners', s);
          results.redraw();
        },
        rowHref: (o) => `#/owners/${o.id}`,
        columns,
        mobile: (o) =>
          h(
            'a.mobile-row',
            { href: `#/owners/${o.id}` },
            personAvatar({ firstName: displayName(o) }),
            h('div.grow', h('div.m-title', displayName(o)), h('div.m-sub', propsText(o) || primaryEmail(o) || 'No properties')),
            h('div.m-end', h('span.subtle', pluralize(ownedProperties(o.id).length, 'property', 'properties'))),
          ),
        empty: store.all('owners').length
          ? emptyState({ compact: true, icon: 'search', title: 'No matching owners', text: 'Try a different search.', headingLevel: 3 })
          : emptyState({ icon: 'briefcase', title: 'No rental owners yet', text: 'Add the people or companies who own the properties you manage, then link them on each property.', headingLevel: 3, actions: [h('a.btn.primary', { href: '#/owners/new' }, icon('plus', 16), 'New owner')] }),
      }),
    ];
  }, ['owners', 'properties']);

  function exportAll() {
    exportCSV(
      'rental-owners',
      [
        { label: 'Name', value: displayName },
        { label: 'Contact', value: secondaryName },
        { label: 'Email', value: (o) => (o.emails || []).join('; ') },
        { label: 'Phone', value: (o) => (o.phones || []).join('; ') },
        { label: 'Properties', value: (o) => ownedProperties(o.id).map((x) => `${x.property.name} (${x.pct}%)`).join('; ') },
        { label: 'Management fee %', value: (o) => o.managementFee ?? '' },
        { label: 'Agreement start', value: (o) => o.agreementStart || '' },
        { label: 'Agreement end', value: (o) => o.agreementEnd || '' },
      ],
      rows(),
    );
  }

  return {
    node: h('div.page', header, h('section.card.list-card', { 'aria-label': 'Rental owner list' }, h('div.toolbar', search), results)),
    title: 'Rental owners',
  };
}
