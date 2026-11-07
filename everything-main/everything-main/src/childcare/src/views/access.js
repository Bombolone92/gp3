/** Settings > Staff and family access: the school server, who has access, and invitations. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { select, field, card, pill } from '../ui/components.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import * as team from '../team.js';
import { personName } from '../core/format.js';
import { sortByName } from '../core/people.js';
import { formatDate, toISODate } from '../core/dates.js';
import { inviteStaff } from './invite.js';

const ROLE_LABEL = { owner: 'Director', admin: 'Admin', staff: 'Staff', parent: 'Family' };

export function accessCard() {
  if (app.demo)
    return card({
      title: 'Staff and family access',
      body: h('p.subtle', 'In your own account, staff and families sign in with their own Puter accounts: teachers log activities from any device, and families see their own children\'s day, message the school, and view statements. This is not available in the demo.'),
    });

  const t = app.team;
  if (!t) return enableCard();

  const manage = t.role === 'owner' || t.role === 'admin';
  const body = h('div.stack');
  body.append(h('p.subtle', t.role === 'owner' ? 'Staff and families sign in with their own Puter accounts and see this school through your school server.' : `You are signed in to ${t.school || 'this school'} as ${ROLE_LABEL[t.role] === 'Admin' ? 'an admin' : ROLE_LABEL[t.role] === 'Family' ? 'a family member' : 'staff'}.`));

  if (!manage) {
    body.append(
      h(
        'div.row',
        h(
          'button.btn',
          {
            type: 'button',
            onClick: async () => {
              if (await confirmDialog({ title: `Leave ${t.school || 'this school'}?`, message: 'You will need a new invitation to come back.', confirmLabel: 'Leave', danger: true })) team.leaveWorkspace(t.url);
            },
          },
          icon('log-out', 16),
          'Leave this school',
        ),
      ),
    );
    return card({ title: 'Your access', body });
  }

  const list = h('div.stack', h('p.subtle', 'Loading people...'));
  body.append(h('div.row', h('button.btn.primary', { type: 'button', onClick: inviteStaffDialog }, icon('user-plus', 16), 'Invite staff'), h('a.btn', { href: '#/families?show=noapp' }, icon('users', 16), 'Invite families')), list);

  async function refresh() {
    try {
      const [{ owner, members }, { invites }] = await Promise.all([team.call(t.url, 'members'), team.call(t.url, 'invites')]);
      const store = app.store;
      const profile = (m) => (m.guardianId ? personName(store.get('guardians', m.guardianId)) : m.staffId ? personName(store.get('staff', m.staffId)) : '');
      const staffish = members.filter((m) => m.role !== 'parent');
      const families = members.filter((m) => m.role === 'parent');
      const row = (m) =>
        h(
          'li',
          h(
            'div.list-item',
            icon(m.role === 'parent' ? 'users' : 'id-card', 18),
            h('div.grow', h('div.title', profile(m) || m.username || 'Unknown'), h('div.meta', `${m.username || ''} · joined ${formatDate(toISODate(new Date(m.joinedAt)))}`)),
            m.role !== 'parent' && t.role === 'owner'
              ? select({
                  value: m.role,
                  cls: 'sm',
                  'aria-label': `Role for ${m.username}`,
                  options: [
                    { value: 'staff', label: 'Staff' },
                    { value: 'admin', label: 'Admin' },
                  ],
                  onChange: async (e) => {
                    const sel = e.target;
                    try {
                      await team.call(t.url, 'setRole', { uuid: m.uuid, role: sel.value });
                      m.role = sel.value;
                      toast('Role updated');
                    } catch (err) {
                      // Show the role they still have.
                      sel.value = m.role;
                      toast(err.message, { type: 'error' });
                    }
                  },
                })
              : pill(ROLE_LABEL[m.role] || m.role, 'plain'),
            h(
              'button.icon-btn.sm',
              {
                type: 'button',
                'aria-label': `Remove ${m.username}`,
                title: 'Remove access',
                onClick: async () => {
                  if (!(await confirmDialog({ title: `Remove ${profile(m) || m.username}?`, message: 'They lose access to this school right away.', confirmLabel: 'Remove access', danger: true }))) return;
                  try {
                    await team.call(t.url, 'removeMember', { uuid: m.uuid });
                    toast('Access removed');
                    app.store.sync({ only: ['staff', 'guardians'] });
                    refresh();
                  } catch (err) {
                    toast(err.message, { type: 'error' });
                  }
                },
              },
              icon('user-x', 16),
            ),
          ),
        );
      list.replaceChildren(
        h('div', h('div.section-title', 'Staff'), h('ul.list.bordered-list', owner ? h('li', h('div.list-item', icon('shield', 18), h('div.grow', h('div.title', owner.username), h('div.meta', 'Director')))) : null, staffish.map(row))),
        h('div', h('div.section-title', `Families (${families.length})`), families.length ? h('ul.list.bordered-list', families.map(row)) : h('p.subtle', 'No families have joined yet. Invite them from the Families page.')),
        invites.length
          ? h(
              'div',
              h('div.section-title', 'Pending invitations'),
              h(
                'ul.list.bordered-list',
                invites.map((i) =>
                  h(
                    'li',
                    h(
                      'div.list-item',
                      icon('mail', 18),
                      h('div.grow', h('div.title', i.label || ROLE_LABEL[i.role]), h('div.meta', `${ROLE_LABEL[i.role]} · expires ${formatDate(toISODate(new Date(i.expiresAt)))}`)),
                      h(
                        'button.btn.sm.ghost',
                        {
                          type: 'button',
                          'aria-label': `Revoke the invitation for ${i.label || ROLE_LABEL[i.role]}`,
                          onClick: async () => {
                            await team.call(t.url, 'revokeInvite', { id: i.id }).catch((err) => toast(err.message, { type: 'error' }));
                            refresh();
                          },
                        },
                        'Revoke',
                      ),
                    ),
                  ),
                ),
              ),
            )
          : null,
      );
    } catch (err) {
      list.replaceChildren(h('p.notice.danger', icon('alert', 16), h('span', err.message || 'Could not load people.')));
    }
  }
  refresh();

  function inviteStaffDialog() {
    const staff = sortByName(app.store.all('staff').filter((m) => m.active !== false && !m.memberUuid));
    if (!staff.length) return toast('Add the staff member on the Staff page first.', { type: 'info' });
    const who = select({ options: staff.map((m) => ({ value: m.id, label: personName(m) })), value: staff[0].id });
    const role = select({ options: [{ value: 'staff', label: 'Staff: classrooms, children, families, messages' }, ...(t.role === 'owner' ? [{ value: 'admin', label: 'Admin: everything, including billing and settings' }] : [])], value: 'staff' });
    openDialog({
      title: 'Invite staff',
      size: 'narrow',
      body: h('div.stack', field('Staff member', who), field('Access', role)),
      footer: ({ close }) => [h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'), h('button.btn.primary', { type: 'button', onClick: () => (close(), inviteStaff(app.store.get('staff', who.value), role.value).then(refresh)) }, 'Create link')],
    });
  }

  return card({ title: 'Staff and family access', actions: pill('On', 'success'), body });
}

function enableCard() {
  const btn = h('button.btn.primary', { type: 'button' }, icon('key', 16), 'Turn on staff and family access');
  btn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Turn on staff and family access?',
      message: 'A small server (a Puter worker) is created in your own Puter account to share this school with people you invite. Your records and photos are copied to it and stay in your account. This can take a minute.',
      confirmLabel: 'Turn on',
    });
    if (!ok) return;
    btn.disabled = true;
    // A blocking dialog: nothing may change while the data is copied.
    const progress = h('p', { role: 'status', 'aria-live': 'polite' }, 'Starting...');
    const dlg = h('dialog.dialog.narrow', { 'aria-label': 'Turning on staff and family access' }, h('div.dialog-body', { style: { padding: '24px' } }, h('div.row', icon('loader', 20, 'spin'), h('strong', 'Setting up your school server')), h('p.subtle', { style: { margin: '8px 0' } }, 'Keep this tab open. This can take a minute.'), progress));
    dlg.addEventListener('cancel', (e) => e.preventDefault());
    document.body.append(dlg);
    dlg.showModal();
    try {
      await app.store.flush();
      const { own, skipped } = await team.enableTeam({ store: app.store, onProgress: (text) => (progress.textContent = text) });
      const ws = { ...app.workspaces, own, current: 'own' };
      await team.saveWorkspaces(globalThis.puter.kv, ws);
      progress.textContent = skipped.length ? `Done. ${skipped.length} file${skipped.length === 1 ? ' was' : 's were'} too large to copy. Reloading...` : 'Done. Reloading...';
      setTimeout(() => {
        location.hash = '#/settings/access';
        location.reload();
      }, skipped.length ? 4000 : 800);
    } catch (err) {
      dlg.close();
      dlg.remove();
      btn.disabled = false;
      toast(err.message || 'Access could not be turned on.', { type: 'error', duration: 9000 });
    }
  });
  return card({
    title: 'Staff and family access',
    body: h(
      'div.stack',
      h('p', 'Let your teachers and families sign in with their own free Puter accounts.'),
      h(
        'ul.welcome-points',
        [
          ['id-card', 'Staff check children in, log activities, and message families from any phone or tablet.'],
          ['users', 'Families see only their own children: the day\'s updates and photos you share, messages, the calendar, and statements.'],
          ['shield', 'Everything stays in your Puter account. You can remove anyone at any time.'],
        ].map(([ic, text]) => h('li', icon(ic), h('span', text))),
      ),
      h('div.row', btn),
    ),
  });
}
