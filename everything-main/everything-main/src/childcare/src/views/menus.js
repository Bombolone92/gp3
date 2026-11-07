/**
 * Menus: what is served each day of the week. Teachers' meal entries are
 * prefilled from it. One record per week, keyed by the Monday.
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageHeader, emptyState } from '../ui/components.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { setQuery } from '../ui/router.js';
import { app, isFamily } from '../app.js';
import { startOfWeek, addDays, formatDate } from '../core/dates.js';

export const MEALS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'amSnack', label: 'AM snack' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'pmSnack', label: 'PM snack' },
  { key: 'dinner', label: 'Dinner' },
];

export function render(ctx) {
  const store = app.store;
  let week = startOfWeek(/^\d{4}-\d{2}-\d{2}$/.test(ctx.query.week || '') ? ctx.query.week : app.today(), 1);
  const days = [1, 2, 3, 4, 5];

  const body = ctx.live(() => {
    const rec = store.get('menus', week);
    const meals = MEALS.filter((m) => (app.settings().mealTypes || []).includes(m.label) || rec?.days && days.some((d) => rec.days[d]?.[m.key]));
    const edit = !isFamily();
    const save = (day, key, value) => {
      const cur = structuredClone(store.get('menus', week) || { id: week, weekStart: week, days: {} });
      cur.days ||= {};
      cur.days[day] = { ...(cur.days[day] || {}), [key]: value };
      store.put('menus', cur);
    };
    const nav = h(
      'div.toolbar',
      h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Previous week', onClick: () => go(-7) }, icon('chevron-left')),
      h('strong.month-label', `Week of ${formatDate(week, { month: 'long', day: 'numeric' })}`),
      h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Next week', onClick: () => go(7) }, icon('chevron-right')),
      week !== startOfWeek(app.today(), 1) ? h('button.btn.sm.ghost', { type: 'button', onClick: () => ((week = startOfWeek(app.today(), 1)), setQuery({ week: null }), body.redraw()) }, 'This week') : null,
      h('span.grow'),
      edit
        ? h(
            'button.btn',
            {
              type: 'button',
              onClick: async () => {
                const prev = store.get('menus', addDays(week, -7));
                if (!prev) return toast('Last week has no menu to copy.', { type: 'info' });
                const target = week;
                const cur = store.get('menus', target);
                const hasMenu = cur && Object.values(cur.days || {}).some((d) => Object.values(d || {}).some(Boolean));
                if (hasMenu && !(await confirmDialog({ title: 'Replace this week\'s menu?', message: 'This week already has a menu. Copying last week replaces it.', confirmLabel: 'Replace' }))) return;
                store.put('menus', { ...structuredClone(prev), id: target, weekStart: target, createdAt: undefined });
                toast('Copied last week\'s menu');
                // Editors do not redraw on menu changes, so show the copy now.
                if (week === target) body.redraw();
              },
            },
            icon('copy', 16),
            'Copy last week',
          )
        : null,
      h('button.btn', { type: 'button', onClick: () => window.print() }, icon('printer', 16), 'Print'),
    );
    if (!rec && !edit) return [nav, emptyState({ icon: 'utensils', title: 'No menu posted for this week', compact: true })];
    return [
      nav,
      h(
        'div.table-wrap.menu-wrap',
        h(
          'table.table.menu-table',
          h('caption.sr-only', `Menu for the week of ${formatDate(week)}`),
          h('thead', h('tr', h('th', { scope: 'col' }, h('span.sr-only', 'Meal')), days.map((d) => h(`th${addDays(week, d - 1) === app.today() ? '.today' : ''}`, { scope: 'col' }, formatDate(addDays(week, d - 1), { weekday: 'short', month: 'short', day: 'numeric' }))))),
          h(
            'tbody',
            meals.map((m) =>
              h(
                'tr',
                h('th', { scope: 'row' }, m.label),
                days.map((d) => {
                  const v = rec?.days?.[d]?.[m.key] || '';
                  if (!edit) return h('td', v || h('span.subtle', '-'));
                  const t = h('textarea.menu-cell', { rows: 2, 'aria-label': `${m.label}, ${formatDate(addDays(week, d - 1), { weekday: 'long' })}`, placeholder: 'Add' });
                  t.value = v;
                  t.addEventListener('change', () => save(d, m.key, t.value.trim()));
                  return h('td', t);
                }),
              ),
            ),
          ),
        ),
      ),
      edit
        ? h('p.subtle.small.mt', 'Changes save as you go. Meal entries for children are prefilled from this menu.')
        : rec?.notes
          ? h('p.mt', rec.notes)
          : null,
    ];
  }, isFamily() ? ['menus', 'settings'] : ['settings']); // Editors redraw on navigation only, so typing never loses focus.

  function go(n) {
    week = addDays(week, n);
    setQuery({ week });
    body.redraw();
  }

  return h('div.page.wide-page', pageHeader({ title: 'Menus' }), body);
}
