/** Settings > Team members: the people work is assigned to. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app } from '../../app.js';
import { field, textInput, avatar, emptyState } from '../../ui/components.js';
import { formDialog, confirmDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { TEAM_COLORS } from '../../core/format.js';

export function teamSection() {
  const store = app.store;
  const list = [...store.all('team')].sort((a, b) => (a.active === false) - (b.active === false) || String(a.name).localeCompare(String(b.name)));
  return h(
    'div.stack.settings-stack',
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Team members', h('span.count', ` ${list.length}`)), h('button.btn.sm.primary', { type: 'button', onClick: () => memberDialog() }, icon('user-plus', 14), 'Add member')),
      h(
        'div.card-body.flush',
        list.length
          ? h(
              'ul.list',
              list.map((m) =>
                h(
                  'li',
                  h(
                    'div.list-item',
                    avatar(m.name, { color: m.color }),
                    h(
                      'div.grow',
                      { style: { minWidth: '0' } },
                      h('div.title', m.name, m.active === false ? h('span.pill.plain.inline-pill', 'Inactive') : null),
                      h('div.meta.truncate', [m.role, m.email, m.phone].filter(Boolean).join(' · ') || 'No contact details'),
                    ),
                    h('button.btn.sm', { type: 'button', onClick: () => memberDialog(m), 'aria-label': `Edit ${m.name}` }, 'Edit'),
                  ),
                ),
              ),
            )
          : emptyState({ compact: true, icon: 'users', title: 'Add your team', text: 'Assign work orders, tasks and inspections to people, and choose a property manager for each property.', actions: [h('button.btn.primary', { type: 'button', onClick: () => memberDialog() }, icon('user-plus', 16), 'Add member')], headingLevel: 3 }),
      ),
    ),
    h('p.subtle.settings-lead', 'Team members are the people you assign work to. To let them sign in and use the app themselves, turn on team sign-in.', ' ', h('a', { href: '#/settings/access' }, 'Team sign-in')),
  );
}

export function memberDialog(m = null) {
  const store = app.store;
  let color = m?.color || TEAM_COLORS[store.all('team').length % TEAM_COLORS.length];
  const swatches = h(
    'div.color-swatches',
    { role: 'radiogroup', 'aria-label': 'Color' },
    TEAM_COLORS.map((c, i) =>
      h('button', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(c === color),
        'aria-label': `Color ${i + 1}`,
        style: { '--sw': c },
        onClick: (e) => {
          color = c;
          for (const b of swatches.children) b.setAttribute('aria-checked', String(b === e.currentTarget));
        },
      }),
    ),
  );
  return formDialog({
    title: m ? `Edit ${m.name}` : 'Add team member',
    submitLabel: m ? 'Save' : 'Add member',
    body: h(
      'div.form-grid',
      field('Full name', textInput({ name: 'name', value: m?.name || '', required: true, autocomplete: 'name' }), { span2: true }),
      field('Role', textInput({ name: 'role', value: m?.role || '', placeholder: 'e.g. Property manager', list: 'pm-roles' }), { span2: true }),
      h('datalist#pm-roles', ['Owner', 'Property manager', 'Leasing agent', 'Bookkeeper', 'Maintenance coordinator', 'Maintenance technician'].map((r) => h('option', { value: r }))),
      field('Email', textInput({ name: 'email', type: 'email', value: m?.email || '', autocomplete: 'email' })),
      field('Phone', textInput({ name: 'phone', type: 'tel', value: m?.phone || '', autocomplete: 'tel' })),
      h('div.field.span-2', h('span.field-label', 'Color'), swatches),
      m ? h('label.check.span-2', h('input', { type: 'checkbox', name: 'active', checked: m.active !== false }), 'Active (shows in assignment lists)') : null,
    ),
    extraFooter: m
      ? ({ close }) =>
          h(
            'button.btn.ghost.subtle-danger',
            {
              type: 'button',
              onClick: async () => {
                close();
                const ok = await confirmDialog({ title: `Remove ${m.name}?`, message: 'Their open work becomes unassigned. To keep their name on past work, mark them inactive instead.', confirmLabel: 'Remove', danger: true });
                if (!ok) return;
                const removed = store.remove('team', m.id);
                toast(`${m.name} removed`, { action: { label: 'Undo', run: () => store.restore('team', removed) } });
              },
            },
            'Remove',
          )
      : null,
    onSubmit: (fd) => {
      store.put('team', {
        ...(m || {}),
        name: String(fd.get('name')).trim(),
        role: String(fd.get('role') || '').trim(),
        email: String(fd.get('email') || '').trim(),
        phone: String(fd.get('phone') || '').trim(),
        color,
        active: m ? fd.get('active') === 'on' : true,
      });
      toast(m ? 'Team member updated' : 'Team member added');
    },
  });
}
