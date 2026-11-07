/** Settings > Team: let teammates sign in with their own Puter accounts. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, reloadApp } from '../app.js';
import { select, field, textInput, emptyState } from '../ui/components.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import * as team from '../team.js';
import { formatDate, toISODate } from '../core/dates.js';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member', driver: 'Driver' };
const ROLE_OPTIONS = [
  { value: 'driver', label: 'Driver' },
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
];
const A = (r) => (r === 'admin' ? 'an admin' : r === 'driver' ? 'a driver' : 'a member');

export function teamAccessCard() {
  const card = h('section.card', { 'aria-labelledby': 'team-access-title' });
  const head = (extra) => h('div.card-head', h('h2.grow#team-access-title', 'Team access'), extra || null);

  if (app.demo) {
    card.append(head(), h('div.card-body', h('p.muted', 'In your own account, you can invite drivers, technicians, and managers to sign in with their own Puter accounts and work on the same fleet. This is not available in the demo.')));
    return card;
  }

  const t = app.team;
  if (!t) {
    const status = h('p.subtle', { 'aria-live': 'polite' });
    const btn = h('button.btn.primary', { type: 'button' }, icon('users', 16), 'Turn on team access');
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Turn on team access?',
        message:
          'A small server (a Puter worker) is created in your own Puter account to share this fleet with people you invite. Your data is copied to it and stays in your account. This may take a minute.',
        confirmLabel: 'Turn on',
      });
      if (!ok) return;
      btn.disabled = true;
      // A blocking dialog: nothing may change while the data is copied, or
      // the change would be left behind in the old storage.
      const progress = h('p', { role: 'status', 'aria-live': 'polite' }, 'Starting...');
      const dlg = h('dialog.dialog.narrow', { 'aria-label': 'Turning on team access' }, h('div.dialog-body', { style: { padding: '24px' } }, h('div.row', icon('loader', 20, 'spin'), h('strong', 'Turning on team access')), h('p.muted', { style: { margin: '8px 0' } }, 'Keep this tab open. This can take a minute.'), progress));
      dlg.addEventListener('cancel', (e) => e.preventDefault());
      document.body.append(dlg);
      dlg.showModal();
      try {
        await app.store.flush();
        const { own, skipped } = await team.enableTeam({ store: app.store, onProgress: (text) => (progress.textContent = text) });
        const ws = { ...app.workspaces, own, current: 'own' };
        await team.saveWorkspaces(globalThis.puter.kv, ws);
        app.workspaces = ws; // this device made the switch; it reloads below
        progress.textContent = skipped.length ? `Done. ${skipped.length} file${skipped.length === 1 ? ' was' : 's were'} not copied: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '...' : ''}. Reloading...` : 'Done. Reloading...';
        setTimeout(() => {
          location.hash = '#/settings/team';
          reloadApp();
        }, skipped.length ? 4000 : 800);
      } catch (err) {
        dlg.close();
        dlg.remove();
        btn.disabled = false;
        status.textContent = '';
        toast(err.message || 'Team access could not be turned on.', { type: 'error', duration: 9000 });
      }
    });
    card.append(
      head(),
      h(
        'div.card-body.stack',
        h('p', 'Invite drivers, technicians, and managers to sign in with their own Puter accounts. Everyone works on the same vehicles, inspections, and service records, and changes sync between devices.'),
        h('ul.welcome-points', [
          ['shield', 'Your data stays in your Puter account. You can remove anyone at any time.'],
          ['users', 'Admins manage the team and settings. Members can do everything else.'],
          ['clipboard-check', 'Drivers see the fleet and can submit inspections, fuel, meter readings, and issues.'],
        ].map(([ic, text]) => h('li', icon(ic), h('span', text)))),
        h('div.row', btn),
        status,
      ),
    );
    return card;
  }

  const manage = t.role === 'owner' || t.role === 'admin';
  const body = h('div.card-body.stack');
  card.append(head(h('span.pill.success', 'On')), body);
  body.append(h('p.muted', t.role === 'owner' ? 'People you invite sign in with their own Puter account and work in this fleet.' : `You are signed in to ${t.business || 'this fleet'} as ${A(t.role)}.`));

  // Everyone but the owner can leave.
  const leaveBtn = () => {
    const btn = h(
      'button.btn',
      {
        type: 'button',
        onClick: async () => {
          if (!(await confirmDialog({ title: `Leave ${t.business || 'this fleet'}?`, message: 'You will need a new invitation to come back.', confirmLabel: 'Leave', danger: true }))) return;
          btn.disabled = true;
          team.leaveWorkspace(t.url).catch((err) => {
            btn.disabled = false;
            toast(`Could not leave this fleet. ${err?.message || 'Try again.'}`, { type: 'error' });
          });
        },
      },
      icon('log-out', 16),
      'Leave this fleet',
    );
    return btn;
  };

  if (!manage) {
    body.append(h('div.row', leaveBtn()));
    return card;
  }

  const list = h('div.stack', { style: { gap: '16px' } }, h('p.subtle', 'Loading team...'));
  body.append(
    h('div.row', { style: { flexWrap: 'wrap' } }, h('button.btn.primary', { type: 'button', onClick: () => inviteDialog(refresh) }, icon('user-plus', 16), 'Invite someone'), t.role !== 'owner' ? leaveBtn() : null),
    list,
  );

  async function refresh() {
    try {
      const [{ owner, members }, { invites }] = await Promise.all([team.call(t.url, 'members'), team.call(t.url, 'invites')]);
      list.replaceChildren(
        h(
          'div',
          h('div.section-title', { style: { marginBottom: '6px' } }, 'People'),
          h(
            'ul.list.bordered-list',
            owner ? h('li', h('div.list-item', icon('user', 18), h('div.grow', h('div.title', owner.username), h('div.meta', 'Owner')))) : null,
            members.map((m) =>
              h(
                'li',
                h(
                  'div.list-item',
                  icon('user', 18),
                  h('div.grow', h('div.title', m.username || 'Unknown', m.uuid === app.user?.uuid ? ' (you)' : ''), h('div.meta', `Joined ${formatDate(toISODate(new Date(m.joinedAt)))}`)),
                  // Your own role and access are not changed from here (that
                  // would lock you out mid-click); use "Leave this fleet".
                  m.uuid === app.user?.uuid
                    ? h('span.subtle', ROLE_LABEL[m.role] || '')
                    : [
                        select({
                          value: m.role,
                          cls: 'sm',
                          'aria-label': `Role for ${m.username}`,
                          style: { width: 'auto' },
                          options: ROLE_OPTIONS,
                          onChange: async (e) => {
                            const sel = e.target;
                            sel.disabled = true;
                            try {
                              await team.call(t.url, 'setRole', { uuid: m.uuid, role: sel.value });
                              m.role = sel.value;
                              toast('Role updated');
                            } catch (err) {
                              // Show the role they really have.
                              sel.value = m.role;
                              toast(err.message, { type: 'error' });
                            } finally {
                              sel.disabled = false;
                            }
                          },
                        }),
                        h(
                          'button.icon-btn.sm',
                          {
                            type: 'button',
                            'aria-label': `Remove ${m.username}`,
                            title: 'Remove from fleet',
                            onClick: async () => {
                              if (!(await confirmDialog({ title: `Remove ${m.username}?`, message: 'They lose access to this fleet right away.', confirmLabel: 'Remove', danger: true }))) return;
                              try {
                                await team.call(t.url, 'removeMember', { uuid: m.uuid });
                                toast(`${m.username} removed`);
                                refresh();
                              } catch (err) {
                                toast(err.message, { type: 'error' });
                              }
                            },
                          },
                          icon('x', 16),
                        ),
                      ],
                ),
              ),
            ),
          ),
          !members.length ? h('p.subtle', { style: { marginTop: '8px' } }, 'Nobody has joined yet. Invite your drivers and technicians to get started.') : null,
        ),
        invites.length
          ? h(
              'div',
              h('div.section-title', { style: { marginBottom: '6px' } }, 'Open invitations'),
              h(
                'ul.list.bordered-list',
                invites.map((inv) =>
                  h(
                    'li',
                    h(
                      'div.list-item',
                      icon('link', 18),
                      h('div.grow', h('div.title', inv.label || 'Invitation link'), h('div.meta', `${ROLE_LABEL[inv.role]} · expires ${formatDate(toISODate(new Date(inv.expiresAt)))}`)),
                      h(
                        'button.btn.sm.ghost',
                        {
                          type: 'button',
                          'aria-label': `Revoke ${inv.label ? `the invitation for ${inv.label}` : 'this invitation'}`,
                          onClick: async () => {
                            if (!(await confirmDialog({ title: 'Revoke this invitation?', message: `The link${inv.label ? ` for ${inv.label}` : ''} stops working right away. You can create a new one at any time.`, confirmLabel: 'Revoke', danger: true }))) return;
                            try {
                              await team.call(t.url, 'revokeInvite', { id: inv.id });
                              toast('Invitation revoked');
                              refresh();
                            } catch (err) {
                              toast(err.message, { type: 'error' });
                            }
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
      const retry = () => {
        list.replaceChildren(h('p.subtle', 'Loading team...'));
        refresh();
      };
      list.replaceChildren(h('div.notice.danger', { role: 'alert' }, icon('alert'), h('span.grow', err.message), h('button.btn.sm', { type: 'button', onClick: retry }, 'Try again')));
    }
  }
  refresh();
  return card;
}

function inviteDialog(onDone) {
  const t = app.team;
  const label = textInput({ placeholder: 'e.g. Jordan, night shift driver' });
  const role = select({ value: 'driver', options: [{ value: 'driver', label: 'Driver (inspections, fuel, issues)' }, { value: 'member', label: 'Member (all fleet records)' }, { value: 'admin', label: 'Admin (also team and settings)' }] });
  const out = h('div');
  openDialog({
    title: 'Invite someone',
    body: h(
      'div.stack',
      h('p.muted', 'Create a link and send it to the person you want to invite. It works once, for 7 days. They sign in with their own Puter account to join.'),
      h('div.form-grid', field('Who is it for?', label, { hint: 'Only the owner and admins see this' }), field('Role', role)),
      out,
    ),
    footer: ({ close }) => {
      const create = h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: async () => {
            create.disabled = true;
            try {
              const res = await team.call(t.url, 'invite', { role: role.value, label: label.value.trim() });
              const link = team.inviteLink(t.url, res.token);
              const input = textInput({ value: link, readonly: true, 'aria-label': 'Invitation link' });
              out.replaceChildren(
                h('div.notice.accent', icon('link'), h('span', 'Copy this link and send it by text or email.')),
                h('div.row', { style: { marginTop: '10px' } }, h('div.grow', input), h('button.btn', { type: 'button', onClick: () => copy(link) }, icon('copy', 16), 'Copy')),
              );
              copy(link, true);
              create.textContent = 'Create another';
              onDone?.();
            } catch (err) {
              toast(err.message, { type: 'error' });
            } finally {
              create.disabled = false;
            }
          },
        },
        icon('link', 16),
        'Create invitation link',
      );
      return [h('button.btn', { type: 'button', onClick: () => close() }, 'Done'), create];
    },
  });
}

async function copy(text, quiet = false) {
  try {
    await navigator.clipboard.writeText(text);
    toast(quiet ? 'Invitation link created and copied' : 'Copied');
  } catch {
    if (!quiet) toast('Select the link and copy it manually.', { type: 'error' });
  }
}

export { emptyState };
