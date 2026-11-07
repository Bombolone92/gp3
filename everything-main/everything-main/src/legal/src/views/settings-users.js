/**
 * Firm users: the lawyers and staff whose time, tasks, and matters the app
 * tracks. A firm user can be linked to a Puter username so the app knows
 * who is signed in.
 */
import '../styles/settings.css';
import { h, uniqueId } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, meId } from '../app.js';
import { formDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { field, textInput, select, moneyInput, checkbox, avatar, pill, card } from '../ui/components.js';
import { openMenu } from '../ui/menu.js';
import { USER_ROLES } from '../core/settings.js';
import { PALETTE, colorFor } from '../core/format.js';
import { formatMoney } from '../core/money.js';

export const roleLabel = (id) => USER_ROLES.find((r) => r.id === id)?.label || 'Staff';

/** How many records point at a firm user (so deleting them would orphan data). */
export function userReferences(store, id) {
  let n = 0;
  for (const m of store.all('matters')) if (m.responsibleId === id || m.originatingId === id || m.staffId === id) n++;
  for (const a of store.all('activities')) if (a.userId === id) n++;
  for (const t of store.all('tasks')) if (t.assigneeId === id || t.completedBy === id) n++;
  for (const e of store.all('events')) if ((e.attendeeIds || []).includes(id)) n++;
  for (const b of store.all('bills')) if ((b.lines || []).some((l) => l.userId === id)) n++;
  for (const x of store.all('notes')) if (x.authorId === id) n++;
  for (const x of store.all('communications')) if (x.fromUserId === id || x.toUserId === id) n++;
  for (const x of store.all('documents')) if (x.authorId === id) n++;
  // Who recorded money in or out is part of the trust and payment audit trail.
  for (const x of store.all('payments')) if (x.recordedBy === id) n++;
  for (const x of store.all('transactions')) if (x.recordedBy === id) n++;
  return n;
}

function colorPicker(value) {
  const name = uniqueId('color');
  return h(
    'div.swatches',
    { role: 'radiogroup', 'aria-label': 'Calendar color' },
    PALETTE.map((c, i) =>
      h('label.swatch', { title: `Color ${i + 1}` }, h('input', { type: 'radio', name, value: c, checked: c === value }), h('span', { style: { background: c } }), h('span.sr-only', `Color ${i + 1}`)),
    ),
  );
}

export function openUserDialog(user = null) {
  const color = colorPicker(user?.color || PALETTE[app.store.all('users').length % PALETTE.length]);
  return formDialog({
    title: user ? 'Edit firm user' : 'Add firm user',
    body: h(
      'div.stack',
      h(
        'div.grid-2',
        field('Full name', textInput({ name: 'name', value: user?.name || '', autofocus: true }), { required: true }),
        field('Email', textInput({ name: 'email', type: 'email', value: user?.email || '' })),
      ),
      h(
        'div.grid-2',
        field('Role', select({ name: 'role', value: user?.role || 'lawyer', options: USER_ROLES.map((r) => ({ value: r.id, label: r.label })) })),
        field('Hourly rate', moneyInput({ name: 'rate', cents: user?.rateCents || 0 }), { hint: 'Used for new time entries unless a matter sets its own rate.' }),
        field('Monthly billable target (hours)', textInput({ name: 'targetHours', type: 'number', min: '0', step: '1', value: String(user?.targetHours ?? ''), cls: 'num' })),
        field('Puter username', textInput({ name: 'puterUsername', value: user?.puterUsername || '', placeholder: 'Optional', autocapitalize: 'off', spellcheck: 'false' }), {
          hint: 'Links this person to their Puter account.',
        }),
      ),
      h('fieldset.field', h('legend', 'Color'), color),
      checkbox({ name: 'active', label: 'Active (can be assigned work)', checked: user ? user.active !== false : true }),
    ),
    submitLabel: user ? 'Save changes' : 'Add user',
    onSubmit: (fd, form) => {
      const username = String(fd.get('puterUsername') || '')
        .trim()
        .replace(/^@/, '');
      const clash = username && app.store.all('users').find((u) => u.id !== user?.id && u.puterUsername?.toLowerCase() === username.toLowerCase());
      if (clash) {
        const el = form.querySelector('[name=puterUsername]');
        el.setAttribute('aria-invalid', 'true');
        el.focus();
        toast(`${clash.name} is already linked to ${username}.`, { type: 'error' });
        return false;
      }
      const rate = form.querySelector('[name=rate]').cents;
      const target = Number(fd.get('targetHours')) || 0;
      const negative = rate < 0 ? 'rate' : target < 0 ? 'targetHours' : null;
      if (negative) {
        const el = form.querySelector(`[name=${negative}]`);
        el.setAttribute('aria-invalid', 'true');
        el.focus();
        toast(negative === 'rate' ? 'The hourly rate cannot be negative.' : 'The monthly target cannot be negative.', { type: 'error' });
        return false;
      }
      const rec = app.store.put('users', {
        ...(user || {}),
        name: String(fd.get('name')).trim(),
        email: String(fd.get('email') || '').trim(),
        role: fd.get('role'),
        rateCents: rate,
        targetHours: target,
        puterUsername: username,
        color: fd.get(color.querySelector('input').name) || user?.color || colorFor(String(fd.get('name'))),
        active: !!fd.get('active'),
      });
      toast(user ? 'User updated' : `${rec.name} added`);
      return rec;
    },
  });
}

async function deleteUser(u) {
  const refs = userReferences(app.store, u.id);
  if (refs) {
    toast(`${u.name} is used by ${refs} ${refs === 1 ? 'record' : 'records'}. Deactivate them instead so their history stays intact.`, { type: 'info', duration: 7000 });
    return;
  }
  const ok = await confirmDialog({
    title: `Delete ${u.name}?`,
    message: 'This firm user has no time, matters, or tasks, so they can be removed completely.',
    confirmLabel: 'Delete user',
    danger: true,
  });
  if (!ok) return;
  app.store.remove('users', u.id);
  toast(`${u.name} deleted`, { action: { label: 'Undo', run: () => app.store.restore('users', u) } });
}

export function usersSection(ctx) {
  const body = h('div');
  function draw() {
    const me = meId();
    const users = [...app.store.all('users')].sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name));
    body.replaceChildren(
      users.length
        ? h(
            'div.table-scroll',
            { tabindex: '0', role: 'region', 'aria-label': 'Firm users' },
            h(
              'table.table-plain.settings-table',
              h('caption.sr-only', 'Firm users'),
              h(
                'thead',
                h(
                  'tr',
                  h('th', { scope: 'col' }, 'Name'),
                  h('th', { scope: 'col' }, 'Role'),
                  h('th.r', { scope: 'col' }, 'Rate'),
                  h('th.r', { scope: 'col' }, 'Target'),
                  h('th', { scope: 'col' }, 'Puter account'),
                  h('th', { scope: 'col' }, 'Status'),
                  h('th', { scope: 'col' }, h('span.sr-only', 'Actions')),
                ),
              ),
              h(
                'tbody',
                users.map((u) =>
                  h(
                    `tr${u.active === false ? '.muted-row' : ''}`,
                    h(
                      'td',
                      h(
                        'span.user-chip',
                        avatar(u.name, { color: u.color || colorFor(u.id), size: 'sm' }),
                        h(
                          'span',
                          h('button.link-btn.user-name', { type: 'button', onClick: () => openUserDialog(u) }, u.name),
                          u.id === me ? h('span.subtle', ' (you)') : null,
                          u.email ? h('span.block.subtle.small', u.email) : null,
                        ),
                      ),
                    ),
                    h('td', roleLabel(u.role)),
                    h('td.r.num', u.rateCents ? `${formatMoney(u.rateCents)}/h` : h('span.subtle', 'Default')),
                    h('td.r.num', u.targetHours ? `${u.targetHours} h` : h('span.subtle', 'None')),
                    h('td', u.puterUsername ? h('span.mono', u.puterUsername) : h('span.subtle', 'Not linked')),
                    h('td', u.active === false ? pill('Inactive', 'neutral') : pill('Active', 'success')),
                    h(
                      'td.r',
                      h(
                        'button.icon-btn.sm',
                        {
                          type: 'button',
                          'aria-label': `Actions for ${u.name}`,
                          onClick: (e) =>
                            openMenu(e.currentTarget, [
                              { label: 'Edit', icon: 'pencil', run: () => openUserDialog(u) },
                              u.active === false
                                ? { label: 'Reactivate', icon: 'user-check', run: () => app.store.patch('users', u.id, { active: true }) }
                                : { label: 'Deactivate', icon: 'archive', run: () => app.store.patch('users', u.id, { active: false }) },
                              { separator: true },
                              { label: 'Delete', icon: 'trash', danger: true, run: () => deleteUser(u) },
                            ]),
                        },
                        icon('more', 16),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          )
        : h('p.subtle', 'No firm users yet. Add the lawyers and staff whose time you track.'),
    );
  }
  draw();
  ctx.watch(['users', 'matters', 'activities'], draw);
  return card({
    title: 'Firm users',
    actions: h('button.btn.primary.sm', { type: 'button', onClick: () => openUserDialog() }, icon('user-plus', 15), 'Add user'),
    body: h('div.stack', h('p.subtle', 'People who record time, own matters, and get tasks. Inactive users keep their history but are not offered for new work.'), body),
  });
}
