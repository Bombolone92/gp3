/**
 * The schedule's filter bar and its "filtered" flag. State lives in the
 * session UI object (see scheduleFilterState) and is never persisted: a
 * filter is how you are looking at the week right now, not a setting.
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { EMPTY_FILTER, describeFilter, isFiltered, normalizeFilter } from '../core/filters.js';
import { avatar } from './components.js';

/** The live filter object, created on first use. */
export function scheduleFilterState(ui) {
  if (!ui.scheduleFilter) ui.scheduleFilter = { ...EMPTY_FILTER };
  return ui.scheduleFilter;
}

export function scheduleSearch(ui) {
  return String(ui.scheduleSearch ?? '');
}

/** True when an employee is a hit for the current search text. */
export function matchesSearch(employee, query) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    employee.name.toLowerCase().includes(q) ||
    String(employee.role ?? '').toLowerCase().includes(q)
  );
}

export function clearScheduleFilter(ctx) {
  ctx.ui.scheduleFilter = { ...EMPTY_FILTER };
  ctx.ui.scheduleSearch = '';
  ctx.refresh();
}

/**
 * The flag that rides along with the week label. It prints: a filtered
 * schedule handed out as a whole week is the one mistake this feature
 * could cause, so the page has to say so. The clear button does not.
 */
export function filterFlag(ctx) {
  const { ui, store } = ctx;
  const filter = scheduleFilterState(ui);
  if (!isFiltered(filter)) return null;
  return el(
    'span',
    { class: 'filter-flag' },
    icon('filter', 12),
    el('span', {}, `Filtered: ${describeFilter(filter, store.state)}`),
    el(
      'button',
      {
        class: 'filter-flag-clear print-hidden',
        title: 'Clear the filter',
        'aria-label': 'Clear the filter',
        onClick: () => clearScheduleFilter(ctx),
      },
      icon('x', 12)
    )
  );
}

/** Roles worth offering: the managed list, plus labels only shifts carry. */
function filterableRoles(state) {
  const roles = [...(state.settings.roles ?? [])];
  const known = new Set(roles.map((r) => r.name.toLowerCase()));
  for (const shift of state.shifts) {
    const name = String(shift.role ?? '').trim();
    if (name && !known.has(name.toLowerCase())) {
      known.add(name.toLowerCase());
      roles.push({ id: `raw:${name}`, name, color: null });
    }
  }
  return roles.sort((a, b) => a.name.localeCompare(b.name));
}

function toggleChip({ label, pressed, onToggle, color = null, iconName = null, focusKey }) {
  return el(
    'button',
    {
      type: 'button',
      class: 'filter-chip',
      'aria-pressed': String(pressed),
      dataset: { focusKey },
      onClick: onToggle,
    },
    color ? el('span', { class: 'filter-dot', style: { '--emp': color } }) : null,
    iconName ? icon(iconName, 14) : null,
    label
  );
}

/**
 * The collapsible bar under the schedule header: search, roles, people,
 * and the two toggles. Every control writes to session state and
 * re-renders the view, which is also what hands focus back (each one
 * carries a stable focus key; see render() in app.js).
 */
export function filterBar(ctx) {
  const { ui, store } = ctx;
  const state = store.state;
  const filter = scheduleFilterState(ui);
  const employees = state.employees.filter((e) => e.active);
  const roles = filterableRoles(state);

  const toggleIn = (list, value) => {
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    return next;
  };

  const searchInput = el('input', {
    class: 'input',
    type: 'search',
    value: scheduleSearch(ui),
    placeholder: 'Find someone',
    'aria-label': 'Find someone on the schedule',
    dataset: { focusKey: 'sched:search' },
    // Input rather than change: the row is highlighted and scrolled to
    // as the name is typed, which is the whole point of the box.
    onInput: (e) => {
      ui.scheduleSearch = e.target.value;
      ctx.refresh();
    },
  });

  const group = (label, children) =>
    el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, label), children);

  return el(
    'div',
    { class: 'card filter-bar print-hidden' },
    el(
      'div',
      { class: 'filter-search' },
      icon('search', 15),
      searchInput,
      scheduleSearch(ui)
        ? el(
            'button',
            {
              class: 'btn btn-ghost btn-sm btn-icon',
              'aria-label': 'Clear the search',
              title: 'Clear the search',
              onClick: () => {
                ui.scheduleSearch = '';
                ctx.refresh();
              },
            },
            icon('x', 14)
          )
        : null
    ),
    roles.length > 0
      ? group(
          'Roles',
          el(
            'div',
            { class: 'filter-chips', role: 'group', 'aria-label': 'Filter by role' },
            roles.map((role) =>
              toggleChip({
                label: role.name,
                color: role.color,
                pressed: filter.roles.includes(role.name),
                focusKey: `sched:filter:role:${role.name}`,
                onToggle: () => {
                  filter.roles = toggleIn(filter.roles, role.name);
                  ctx.refresh();
                },
              })
            )
          )
        )
      : null,
    employees.length > 0
      ? group(
          'People',
          el(
            'div',
            { class: 'filter-chips', role: 'group', 'aria-label': 'Filter by person' },
            employees.map((employee) =>
              el(
                'button',
                {
                  type: 'button',
                  class: 'emp-pill',
                  'aria-pressed': String(filter.employees.includes(employee.id)),
                  dataset: { focusKey: `sched:filter:emp:${employee.id}` },
                  onClick: () => {
                    filter.employees = toggleIn(filter.employees, employee.id);
                    ctx.refresh();
                  },
                },
                avatar(employee, 'avatar-sm'),
                employee.name
              )
            )
          )
        )
      : null,
    group(
      'Show',
      el(
        'div',
        { class: 'filter-chips', role: 'group', 'aria-label': 'Narrow what is shown' },
        toggleChip({
          label: 'Open shifts only',
          iconName: 'user',
          pressed: filter.openOnly,
          focusKey: 'sched:filter:open',
          onToggle: () => {
            filter.openOnly = !filter.openOnly;
            ctx.refresh();
          },
        }),
        toggleChip({
          label: 'Understaffed days only',
          iconName: 'warning',
          pressed: filter.understaffedOnly,
          focusKey: 'sched:filter:gaps',
          onToggle: () => {
            filter.understaffedOnly = !filter.understaffedOnly;
            ctx.refresh();
          },
        }),
        isFiltered(filter) || scheduleSearch(ui)
          ? el(
              'button',
              {
                class: 'btn btn-sm',
                dataset: { focusKey: 'sched:filter:clear' },
                onClick: () => clearScheduleFilter(ctx),
              },
              icon('x', 14),
              'Clear all'
            )
          : null
      )
    )
  );
}

/**
 * The filter as a plain object for the published snapshot. Which days
 * are understaffed is a planning question, so that toggle is dropped
 * here: a page handed to staff with three of its days missing would
 * raise more questions than it answers.
 */
export function filterForSnapshot(ui) {
  return { ...normalizeFilter(ui?.scheduleFilter), understaffedOnly: false };
}
