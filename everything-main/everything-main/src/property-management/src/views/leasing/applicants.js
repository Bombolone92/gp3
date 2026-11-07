/** Applicants: a pipeline board by status, or a sortable list. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, chips, dataTable, emptyState, searchBox, statusPill } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { setQuery } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { money, date, rememberSort, saveSort } from '../common.js';
import { personName, matches } from '../../core/format.js';
import { statusLabel } from '../../core/status.js';
import { incomeRatio, ratioTone, BOARD_STATUSES, screeningProgress } from './shared.js';
import { viewToggle, filterSelect, propertyOptions } from '../maintenance/shared.js';

const VIEW_KEY = 'pm.applicants.view';
const ACTIVE = ['new', 'screening', 'approved'];

export function applicantRent(a) {
  const u = lookup.unit(a.unitId);
  return u ? u.listing?.rent || u.marketRent || 0 : 0;
}

export function applicantUnitLabel(a) {
  return a.unitId ? lookup.unitLabel(a.unitId) : lookup.property(a.propertyId)?.name || 'No unit chosen';
}

export function ratioBadge(a) {
  const r = incomeRatio(a.income, applicantRent(a));
  if (r === null) return null;
  const tone = ratioTone(r);
  return h(`span.ratio.ratio-${tone}`, { title: 'Monthly income compared to monthly rent' }, `${r}x rent`);
}

/** Status changes allowed from a given status, as menu items. */
export function statusActions(a) {
  const set = (status, msg) => () => {
    const prev = a.status;
    app.store.patch('applicants', a.id, { status, decidedOn: ['approved', 'rejected'].includes(status) ? app.today() : a.decidedOn || null });
    toast(msg, { action: { label: 'Undo', run: () => app.store.patch('applicants', a.id, { status: prev }) } });
  };
  return [
    a.status === 'new' ? { label: 'Start screening', icon: 'clipboard-check', run: set('screening', 'Screening started') } : null,
    ['new', 'screening'].includes(a.status) ? { label: 'Approve', icon: 'check', run: set('approved', 'Applicant approved') } : null,
    ['new', 'screening', 'approved'].includes(a.status) ? { label: 'Decline', icon: 'x', run: set('rejected', 'Applicant declined') } : null,
    ['new', 'screening', 'approved'].includes(a.status) ? { label: 'Mark withdrawn', icon: 'user-x', run: set('withdrawn', 'Marked as withdrawn') } : null,
    ['rejected', 'withdrawn'].includes(a.status) ? { label: 'Reopen', icon: 'undo', run: set('new', 'Applicant reopened') } : null,
  ].filter(Boolean);
}

export function render(ctx) {
  const store = app.store;
  const state = {
    view: (() => {
      try {
        return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board';
      } catch {
        return 'board';
      }
    })(),
    property: ctx.query.property || '',
    unit: ctx.query.unit || '',
    q: ctx.query.q || '',
    filter: ctx.query.status || 'active',
    sort: rememberSort('applicants', { id: 'applied', dir: 'desc' }),
  };

  const search = searchBox({
    value: state.q,
    placeholder: 'Search name, email or phone',
    label: 'Search applicants',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      body.redraw();
    },
  });

  const body = ctx.live(() => {
    const all = store.all('applicants');
    const base = all.filter((a) => (!state.property || a.propertyId === state.property) && (!state.unit || a.unitId === state.unit) && (!state.q || matches(`${personName(a)} ${a.email || ''} ${a.phone || ''}`, state.q)));
    const unit = state.unit ? lookup.unit(state.unit) : null;
    const toolbar = h(
      'div.toolbar',
      search,
      filterSelect({
        label: 'Property',
        value: state.property,
        options: propertyOptions(),
        onChange: (v) => {
          state.property = v;
          state.unit = '';
          setQuery({ property: v, unit: '' });
          body.redraw();
        },
      }),
      unit ? h('button.chip', { type: 'button', 'aria-pressed': 'true', onClick: () => ((state.unit = ''), setQuery({ unit: '' }), body.redraw()) }, `Unit: ${lookup.unitLabel(unit.id)}`, icon('x', 13)) : null,
      h('div.grow'),
      viewToggle({
        label: 'Layout',
        value: state.view,
        items: [
          { value: 'board', label: 'Board', icon: 'grid' },
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
    );
    if (!all.length) {
      return h(
        'section.card',
        emptyState({ icon: 'contact', title: 'No applicants yet', text: 'Track rental applications from first contact to signed lease.', headingLevel: 2, actions: [h('a.btn.primary', { href: '#/applicants/new' }, icon('plus', 16), 'New applicant')] }),
      );
    }
    if (state.view === 'board') return h('div', h('section.card.list-card', { 'aria-label': 'Filters' }, toolbar), board(base));
    const filters = [
      { id: 'active', label: 'Active', match: (a) => ACTIVE.includes(a.status) },
      { id: 'rejected', label: 'Declined', match: (a) => a.status === 'rejected' },
      { id: 'withdrawn', label: 'Withdrawn', match: (a) => a.status === 'withdrawn' },
      { id: 'converted', label: 'Lease created', match: (a) => a.status === 'converted' },
      { id: 'all', label: 'All', match: () => true },
    ];
    const f = filters.find((x) => x.id === state.filter) || filters[0];
    const rows = base.filter(f.match);
    return h(
      'section.card.list-card',
      { 'aria-label': 'Applicants' },
      toolbar,
      h(
        'div.toolbar.sub-toolbar',
        chips({
          label: 'Status',
          selected: f.id,
          onSelect: (id) => {
            state.filter = id;
            setQuery({ status: id === 'active' ? '' : id });
            body.redraw();
          },
          items: filters.map((x) => ({ id: x.id, label: x.label, count: base.filter(x.match).length })),
        }),
      ),
      dataTable({
        caption: 'Applicants',
        rows,
        sort: state.sort,
        onSort: (s) => {
          state.sort = s;
          saveSort('applicants', s);
          body.redraw();
        },
        rowHref: (a) => `#/applicants/${a.id}`,
        columns: [
          { id: 'name', label: 'Name', cls: 'primary-cell', sort: (a) => personName(a).toLowerCase(), render: (a) => h('span', personName(a), h('span.sub', { style: { display: 'block' } }, a.email || a.phone || '')) },
          { id: 'unit', label: 'Unit', sort: (a) => applicantUnitLabel(a), render: (a) => applicantUnitLabel(a) },
          { id: 'applied', label: 'Applied', sort: (a) => a.appliedOn || '', render: (a) => h('span.nowrap', date(a.appliedOn)) },
          { id: 'income', label: 'Monthly income', align: 'r', sort: (a) => a.income || 0, render: (a) => h('span.ratio-cell', a.income ? h('span.num', money(a.income)) : h('span.subtle', 'Not given'), ratioBadge(a)) },
          { id: 'status', label: 'Status', sort: (a) => a.status, render: (a) => statusPill(a.status) },
        ],
        mobile: (a) => h('a.mobile-row', { href: `#/applicants/${a.id}` }, h('div.grow', { style: { minWidth: '0' } }, h('div.m-title', personName(a)), h('div.m-sub', `${applicantUnitLabel(a)} · ${date(a.appliedOn)}`)), h('div.m-end', statusPill(a.status), ratioBadge(a))),
        empty: emptyState({ compact: true, icon: 'search', title: 'No matching applicants', text: 'Try a different search or filter.', headingLevel: 3 }),
      }),
    );
  }, ['applicants', 'units', 'properties']);

  return {
    node: h('div.page', pageHeader({ title: 'Applicants', actions: [h('a.btn.primary', { href: `#/applicants/new${state.unit ? `?unitId=${state.unit}` : ''}` }, icon('plus', 16), 'New applicant')] }), body),
    title: 'Applicants',
  };
}

function board(list) {
  return h(
    'div.board',
    { role: 'list', 'aria-label': 'Applicants by status' },
    BOARD_STATUSES.map((status) => {
      const items = list.filter((a) => a.status === status).sort((a, b) => ((a.appliedOn || '') < (b.appliedOn || '') ? 1 : -1));
      return h(
        'section.board-col',
        { role: 'listitem', 'aria-label': `${statusLabel(status)}, ${items.length}` },
        h('header.board-head', statusPill(status), h('span.board-count', String(items.length))),
        items.length ? h('ul.board-list', items.map((a) => h('li', applicantCard(a)))) : h('p.board-empty', 'None'),
      );
    }),
  );
}

function applicantCard(a) {
  const prog = screeningProgress(a);
  return h(
    'article.board-card',
    h(
      'div.board-card-top',
      h('a.board-card-title', { href: `#/applicants/${a.id}` }, personName(a)),
      statusActions(a).length
        ? h('button.icon-btn.sm', { type: 'button', 'aria-label': `Change status for ${personName(a)}`, onClick: (e) => openMenu(e.currentTarget, statusActions(a)) }, icon('more', 16))
        : null,
    ),
    h('div.board-card-sub', applicantUnitLabel(a)),
    h(
      'div.board-card-meta',
      h('span', { title: 'Applied' }, icon('calendar', 13), date(a.appliedOn, { month: 'short', day: 'numeric' })),
      a.income ? h('span', { title: 'Monthly income' }, icon('wallet', 13), money(a.income)) : null,
      ratioBadge(a),
      a.status === 'screening' ? h('span', { title: 'Screening checks done' }, icon('clipboard-check', 13), `${prog.done}/${prog.total}`) : null,
    ),
  );
}
