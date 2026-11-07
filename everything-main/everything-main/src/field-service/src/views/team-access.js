/** Settings > Team: let teammates sign in with their own Puter accounts. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { select, field, textInput, emptyState } from '../ui/components.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import * as team from '../team.js';
import { formatDate } from '../core/dates.js';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Team member' };

export function teamAccessCard() {
  const card = h('section.card', { 'aria-labelledby': 'team-access-title' });
  const head = (extra) => h('div.card-head', h('h2.grow#team-access-title', 'Team sign-in'), extra || null);

  if (app.demo) {
    card.append(head(), h('div.card-body', h('p.muted', 'In your own account, you can invite your crew to sign in with their own Puter accounts and work on the same clients, jobs and schedule. This is not available in the demo.')));
    return card;
  }

  const t = app.team;
  if (!t) {
    const status = h('p.subtle', { 'aria-live': 'polite' });
    const btn = h('button.btn.primary', { type: 'button' }, icon('users', 16), 'Turn on team sign-in');
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Turn on team sign-in?',
        message:
          'A small server (a Puter worker) is created in your own Puter account to share this business with people you invite. Your data is copied to it and stays in your account. This may take a minute.',
        confirmLabel: 'Turn on',
      });
      if (!ok) return;
      btn.disabled = true;
      // A blocking dialog: nothing may change while the data is copied, or
      // the change would be left behind in the old storage.
      const progress = h('p', { role: 'status', 'aria-live': 'polite' }, 'Starting...');
      const dlg = h('dialog.dialog.narrow', { 'aria-label': 'Turning on team sign-in' }, h('div.dialog-body', { style: { padding: '24px' } }, h('div.row', icon('loader', 20, 'spin'), h('strong', 'Turning on team sign-in')), h('p.muted', { style: { margin: '8px 0' } }, 'Keep this tab open. This can take a minute.'), progress));
      dlg.addEventListener('cancel', (e) => e.preventDefault());
      document.body.append(dlg);
      dlg.showModal();
      try {
        await app.store.flush();
        const { own, skipped } = await team.enableTeam({ store: app.store, onProgress: (text) => (progress.textContent = text) });
        const ws = { ...app.workspaces, own, current: 'own' };
        try {
          await team.saveWorkspaces(globalThis.puter.kv, ws);
        } catch (err) {
          // Nothing points at the new server: remove it, or a retry would leave
          // a second one behind in the owner's account.
          try {
            await globalThis.puter.workers.delete(own.name);
          } catch {}
          throw new Error(`Team sign-in could not be turned on, so nothing was changed. Check your connection and try again. ${err?.message || ''}`.trim());
        }
        app.workspaces = ws; // this device switches by reloading, not by noticing it later
        progress.textContent = skipped.length ? `Done. ${skipped.length} file${skipped.length === 1 ? ' was' : 's were'} left behind: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '...' : ''}. Reloading...` : 'Done. Reloading...';
        setTimeout(() => {
          location.hash = '#/settings/team';
          location.reload();
        }, skipped.length ? 4000 : 800);
      } catch (err) {
        dlg.close();
        dlg.remove();
        btn.disabled = false;
        status.textContent = '';
        toast(err.message || 'Team sign-in could not be turned on.', { type: 'error', duration: 9000 });
      }
    });
    card.append(
      head(),
      h(
        'div.card-body.stack',
        h('p', 'Invite your office staff and field crew to sign in with their own Puter accounts. Everyone sees the same clients, schedule and jobs, and changes sync between devices.'),
        h('ul.welcome-points', [
          ['shield', 'Your data stays in your Puter account. You can remove anyone at any time.'],
          ['users', 'Admins can invite people and manage the team. Team members can do everything else.'],
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
  body.append(h('p.muted', t.role === 'owner' ? 'People you invite sign in with their own Puter account and work in this business.' : `You are signed in to ${t.business || 'this business'} as ${ROLE_LABEL[t.role] === 'Admin' ? 'an admin' : 'a team member'}.`));

  if (!manage) {
    body.append(
      h(
        'div.row',
        h(
          'button.btn',
          {
            type: 'button',
            onClick: async () => {
              if (await confirmDialog({ title: `Leave ${t.business || 'this business'}?`, message: 'You will need a new invitation to come back.', confirmLabel: 'Leave', danger: true })) team.leaveWorkspace(t.url);
            },
          },
          icon('log-out', 16),
          'Leave this business',
        ),
      ),
    );
    return card;
  }

  const list = h('div.stack', { style: { gap: '16px' } }, h('p.subtle', 'Loading team...'));
  body.append(
    h('div.row', { style: { flexWrap: 'wrap' } }, h('button.btn.primary', { type: 'button', onClick: () => inviteDialog(refresh) }, icon('user-plus', 16), 'Invite someone')),
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
                  h('div.grow', h('div.title', m.username || 'Unknown'), h('div.meta', `Joined ${formatDate(new Date(m.joinedAt).toISOString())}`)),
                  select({
                    value: m.role,
                    cls: 'sm',
                    'aria-label': `Role for ${m.username}`,
                    style: { width: 'auto' },
                    options: [
                      { value: 'member', label: 'Team member' },
                      { value: 'admin', label: 'Admin' },
                    ],
                    onChange: async (e) => {
                      const sel = e.target;
                      const role = sel.value;
                      try {
                        await team.call(t.url, 'setRole', { uuid: m.uuid, role });
                        m.role = role;
                        toast('Role updated');
                      } catch (err) {
                        // Show the role they still have, not the one that failed.
                        sel.value = m.role;
                        toast(err.message, { type: 'error' });
                      }
                    },
                  }),
                  h(
                    'button.icon-btn.sm',
                    {
                      type: 'button',
                      'aria-label': `Remove ${m.username}`,
                      title: 'Remove from business',
                      onClick: async () => {
                        if (!(await confirmDialog({ title: `Remove ${m.username}?`, message: 'They lose access to this business right away.', confirmLabel: 'Remove', danger: true }))) return;
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
                ),
              ),
            ),
          ),
          !members.length ? h('p.subtle', { style: { marginTop: '8px' } }, 'Nobody has joined yet. Invite your crew to get started.') : null,
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
                      h('div.grow', h('div.title', inv.label || 'Invitation link'), h('div.meta', `${ROLE_LABEL[inv.role]} · expires ${formatDate(new Date(inv.expiresAt).toISOString())}`)),
                      h(
                        'button.btn.sm.ghost',
                        {
                          type: 'button',
                          onClick: async () => {
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
      list.replaceChildren(h('div.notice.danger', icon('alert'), h('span', err.message)));
    }
  }
  refresh();
  return card;
}

function inviteDialog(onDone) {
  const t = app.team;
  const label = textInput({ placeholder: 'e.g. Jordan, field crew' });
  const role = select({ value: 'member', options: [{ value: 'member', label: 'Team member' }, { value: 'admin', label: 'Admin (can manage the team)' }] });
  const out = h('div');
  openDialog({
    title: 'Invite someone',
    body: h(
      'div.stack',
      h('p.muted', 'Create a link and send it to the person you want to invite. It works once, for 7 days. They sign in with their own Puter account to join.'),
      h('div.form-grid', field('Who is it for?', label, { hint: 'Only you see this' }), field('Role', role)),
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
