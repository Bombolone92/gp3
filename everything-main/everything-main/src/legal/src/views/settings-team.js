/**
 * Team sign-in: let colleagues work in the same firm with their own Puter
 * accounts. Turning it on deploys the firm server in the owner's account
 * (team.js). Owners and admins invite people with single-use links, change
 * roles, and remove members.
 */
import '../styles/settings.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { card, select, textInput, field, spinner, pill, emptyState } from '../ui/components.js';
import { formatDate, toISODate } from '../core/dates.js';
import * as teamModule from '../team.js';

// team.js is already part of the main bundle, so import it directly.
const team = async () => teamModule;

/** Link the signed-in Puter account to one firm user record. */
function whoAmI() {
  const users = app.store.all('users').filter((u) => u.active !== false);
  if (!app.user || !users.length) return null;
  const username = app.user.username;
  const linked = users.find((u) => u.puterUsername?.toLowerCase() === username.toLowerCase());
  const sel = select({ name: 'me', value: linked?.id || '', 'aria-label': 'Your firm user', options: [{ value: '', label: 'Not linked' }, ...users.map((u) => ({ value: u.id, label: u.name }))] });
  sel.addEventListener('change', () => {
    for (const u of app.store.all('users')) if (u.puterUsername?.toLowerCase() === username.toLowerCase() && u.id !== sel.value) app.store.patch('users', u.id, { puterUsername: '' });
    if (sel.value) app.store.patch('users', sel.value, { puterUsername: username });
    toast(sel.value ? `You are now ${app.store.get('users', sel.value).name} in this firm` : 'Unlinked');
  });
  return card({
    title: 'Who you are in this firm',
    body: h('div.stack', h('p.subtle', `Pick the firm user that is you (${username}). New time entries, tasks, and the timer default to this person.`), field('Your firm user', sel)),
  });
}

function copyButton(text) {
  return h(
    'button.btn',
    {
      type: 'button',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast('Link copied');
        } catch {
          toast('Copy the link from the field instead.', { type: 'info' });
        }
      },
    },
    icon('copy', 15),
    'Copy link',
  );
}

async function enableFlow() {
  const ok = await confirmDialog({
    title: 'Turn on team sign-in?',
    message:
      'This sets up a small firm server in your Puter account and copies your firm’s records and documents into it. Everyone you invite then works on the same data with their own Puter account. The data stays in your account, and you pay for its storage.',
    confirmLabel: 'Turn on team sign-in',
  });
  if (!ok) return;
  const status = h('p', { role: 'status', 'aria-live': 'polite' }, 'Starting');
  const dlg = openDialog({ title: 'Setting up your firm server', body: h('div.row.nowrap', spinner(20), status) });
  // Setup cannot stop halfway, and edits made meanwhile would not reach the
  // new server, so the dialog stays open until it is done.
  dlg.dialog.querySelector('.dialog-head .icon-btn')?.remove();
  const hold = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  dlg.dialog.addEventListener('cancel', hold, true);
  dlg.dialog.addEventListener('mouseup', hold, true);
  try {
    const t = await team();
    const res = await t.enableTeam({ store: app.store, onProgress: (text) => (status.textContent = text) });
    const ws = { ...(app.workspaces || { joined: [] }), own: res.own, current: 'own' };
    await t.saveWorkspaces(globalThis.puter.kv, ws);
    dlg.close();
    // The page reloads next, so this must be read before, not as a toast.
    if (res.skipped.length) await skippedNotice(res.skipped);
    toast('Team sign-in is on. Reloading.');
    setTimeout(() => location.reload(), 1200);
  } catch (err) {
    dlg.close();
    toast(err?.message || 'Team sign-in could not be turned on.', { type: 'error', duration: 9000 });
  }
}

function skippedNotice(names) {
  return new Promise((resolve) => {
    openDialog({
      title: names.length === 1 ? '1 document could not be copied' : `${names.length} documents could not be copied`,
      body: h(
        'div.stack',
        h('p', 'These files are still in your own Puter drive but not in the shared firm. Files over 8 MB cannot be stored in a shared firm; upload the others again from Documents.'),
        h(
          'ul.bullets',
          names.map((n) => h('li', n)),
        ),
      ),
      footer: ({ close }) => [h('button.btn.primary', { type: 'button', onClick: () => close() }, 'OK')],
      onClose: resolve,
    });
  });
}

export function teamSection() {
  const wrap = h('div.stack');
  if (app.demo) {
    wrap.append(
      card({
        title: 'Team sign-in',
        body: emptyState({ compact: true, icon: 'users', title: 'Not available in the sample firm', text: 'Sign in with Puter to create your own firm and invite colleagues.', headingLevel: 3 }),
      }),
    );
    return wrap;
  }
  if (!app.team && app.workspaces?.unverified) {
    wrap.append(
      card({
        title: 'Team sign-in',
        body: h('div.notice.warning', { role: 'alert' }, icon('warning', 16), h('span', 'Team sign-in could not be checked because Puter did not answer. Reload the page to try again.')),
      }),
    );
    return wrap;
  }
  if (!app.team) {
    wrap.append(
      card({
        title: 'Team sign-in',
        body: h(
          'div.stack',
          h('p', 'Work with colleagues in the same firm. Each person signs in with their own Puter account, and everyone sees the same matters, time, bills, and documents.'),
          h(
            'ul.bullets',
            h('li', 'Invitations are single-use links that expire after 7 days.'),
            h('li', 'Admins can invite and remove people. Members work on the firm’s records.'),
            h('li', 'Your data stays in your Puter account. You can remove anyone at any time.'),
          ),
          h('div', h('button.btn.primary', { type: 'button', onClick: enableFlow }, icon('users', 16), 'Turn on team sign-in')),
        ),
      }),
    );
    const me = whoAmI();
    if (me) wrap.append(me);
    return wrap;
  }

  const url = app.team.url;
  const role = app.team.role;
  const canManage = role === 'owner' || role === 'admin';
  if (!canManage) {
    wrap.append(
      card({
        title: 'Your membership',
        body: h(
          'div.stack',
          h('p', `You are a member of ${app.team.business || app.settings().firm.name || 'this firm'}. The firm’s owner or an admin manages who has access.`),
          h(
            'div',
            h(
              'button.btn.danger',
              {
                type: 'button',
                onClick: async () => {
                  if (!(await confirmDialog({ title: 'Leave this firm?', message: 'You will lose access to its records until someone invites you again.', confirmLabel: 'Leave firm', danger: true })))
                    return;
                  try {
                    await (await team()).leaveWorkspace(url);
                  } catch (err) {
                    toast(err?.message || 'You could not leave the firm. Try again.', { type: 'error' });
                  }
                },
              },
              icon('log-out', 16),
              'Leave firm',
            ),
          ),
        ),
      }),
    );
    const me = whoAmI();
    if (me) wrap.append(me);
    return wrap;
  }

  // ---- Owner and admins ----
  const membersBody = h('div', h('div.row', spinner(18), h('span.subtle', 'Loading members')));
  const invitesBody = h('div');
  const linkOut = h('div.invite-link', { hidden: true });

  async function load() {
    const t = await team();
    try {
      const [{ owner, members }, { invites }] = await Promise.all([t.call(url, 'members'), t.call(url, 'invites')]);
      drawMembers(owner, members, t);
      drawInvites(invites, t);
    } catch (err) {
      membersBody.replaceChildren(h('div.notice.danger', icon('alert', 16), h('span', err?.message || 'Members could not be loaded.')));
    }
  }

  function firmUserFor(username) {
    return app.store.all('users').find((u) => u.puterUsername?.toLowerCase() === String(username).toLowerCase());
  }

  function linkSelect(username) {
    const users = app.store.all('users').filter((u) => u.active !== false);
    const cur = firmUserFor(username);
    const sel = select({
      name: 'link',
      value: cur?.id || '',
      'aria-label': `Firm user for ${username}`,
      options: [{ value: '', label: 'Not linked' }, ...users.map((u) => ({ value: u.id, label: u.name }))],
    });
    sel.addEventListener('change', () => {
      for (const u of app.store.all('users')) if (u.puterUsername?.toLowerCase() === username.toLowerCase() && u.id !== sel.value) app.store.patch('users', u.id, { puterUsername: '' });
      if (sel.value) app.store.patch('users', sel.value, { puterUsername: username });
      toast(sel.value ? `${username} linked to ${app.store.get('users', sel.value).name}` : `${username} unlinked`);
    });
    return sel;
  }

  function drawMembers(owner, members, t) {
    const rows = [owner ? { uuid: owner.uuid, username: owner.username, role: 'owner' } : null, ...members.sort((a, b) => String(a.username).localeCompare(String(b.username)))].filter(Boolean);
    membersBody.replaceChildren(
      h(
        'div.table-scroll',
        { tabindex: '0', role: 'region', 'aria-label': 'Members' },
        h(
          'table.table-plain.settings-table',
          h('caption.sr-only', 'Firm members'),
          h(
            'thead',
            h(
              'tr',
              h('th', { scope: 'col' }, 'Puter account'),
              h('th', { scope: 'col' }, 'Role'),
              h('th', { scope: 'col' }, 'Firm user'),
              h('th', { scope: 'col' }, 'Joined'),
              h('th', { scope: 'col' }, h('span.sr-only', 'Actions')),
            ),
          ),
          h(
            'tbody',
            rows.map((m) => {
              const isOwner = m.role === 'owner';
              const isMe = m.username === app.user?.username;
              // Only the owner changes or removes admins, admins included themselves.
              const locked = role !== 'owner' && (m.role === 'admin' || isMe);
              let roleCell;
              if (isOwner) roleCell = pill('Owner', 'accent');
              else {
                const sel = select({
                  name: 'role',
                  value: m.role,
                  disabled: locked || null,
                  'aria-label': `Role for ${m.username}`,
                  options: [
                    { value: 'member', label: 'Member' },
                    { value: 'admin', label: 'Admin' },
                  ],
                });
                sel.addEventListener('change', async () => {
                  try {
                    await t.call(url, 'setRole', { uuid: m.uuid, role: sel.value });
                    m.role = sel.value;
                    toast(`${m.username} is now ${sel.value === 'admin' ? 'an admin' : 'a member'}`);
                  } catch (err) {
                    toast(err.message, { type: 'error' });
                    sel.value = m.role;
                  }
                });
                roleCell = sel;
              }
              return h(
                'tr',
                h('td', h('span.mono', m.username), isMe ? h('span.subtle', ' (you)') : null),
                h('td', roleCell),
                h('td', linkSelect(m.username)),
                h('td', m.joinedAt ? formatDate(toISODate(new Date(m.joinedAt))) : ''),
                h(
                  'td.r',
                  isOwner || locked || isMe
                    ? null
                    : h(
                        'button.btn.sm.ghost.danger-text',
                        {
                          type: 'button',
                          onClick: async () => {
                            if (
                              !(await confirmDialog({
                                title: `Remove ${m.username}?`,
                                message: 'They lose access right away. Their past work stays in the firm’s records.',
                                confirmLabel: 'Remove',
                                danger: true,
                              }))
                            )
                              return;
                            try {
                              await t.call(url, 'removeMember', { uuid: m.uuid });
                              toast(`${m.username} removed`);
                              load();
                            } catch (err) {
                              toast(err.message, { type: 'error' });
                            }
                          },
                        },
                        'Remove',
                      ),
                ),
              );
            }),
          ),
        ),
      ),
    );
  }

  function drawInvites(invites, t) {
    invitesBody.replaceChildren(
      invites.length
        ? h(
            'ul.list.invite-list',
            invites.map((iv) =>
              h(
                'li.invite-item',
                icon('link', 16),
                h(
                  'span.grow',
                  h('strong', iv.label || 'Invitation'),
                  h('span.subtle', ` · ${iv.role === 'admin' ? 'Admin' : 'Member'} · expires ${formatDate(toISODate(new Date(iv.expiresAt)))} · by ${iv.createdByName || 'unknown'}`),
                ),
                // Only the owner can call off an invitation to become an admin.
                iv.role === 'admin' && role !== 'owner'
                  ? null
                  : h(
                      'button.btn.sm.ghost',
                      {
                        type: 'button',
                        onClick: async () => {
                          try {
                            await t.call(url, 'revokeInvite', { id: iv.id });
                            toast('Invitation revoked');
                            load();
                          } catch (err) {
                            toast(err.message, { type: 'error' });
                          }
                        },
                      },
                      'Revoke',
                    ),
              ),
            ),
          )
        : h('p.subtle', 'No open invitations.'),
    );
  }

  const roleSel = select({
    name: 'inviteRole',
    value: 'member',
    // Only the owner can bring in more admins.
    options: [{ value: 'member', label: 'Member' }, ...(role === 'owner' ? [{ value: 'admin', label: 'Admin' }] : [])],
  });
  const label = textInput({ name: 'inviteLabel', placeholder: 'Who is it for? (optional)' });
  const createBtn = h(
    'button.btn.primary',
    {
      type: 'button',
      onClick: async () => {
        createBtn.disabled = true;
        try {
          const t = await team();
          const res = await t.call(url, 'invite', { role: roleSel.value, label: label.value.trim() });
          const link = t.inviteLink(url, res.token);
          const input = h('input.input.mono', { type: 'text', readonly: true, value: link, 'aria-label': 'Invitation link' });
          linkOut.replaceChildren(
            h('p.small', h('strong', 'Send this link to your colleague.'), ' It works once and expires in 7 days. It will not be shown again.'),
            h('div.row.nowrap', input, copyButton(link)),
          );
          linkOut.hidden = false;
          input.select();
          label.value = '';
          load();
        } catch (err) {
          toast(err?.message || 'The invitation could not be created.', { type: 'error' });
        } finally {
          createBtn.disabled = false;
        }
      },
    },
    icon('user-plus', 16),
    'Create invitation link',
  );

  wrap.append(
    card({
      title: 'Members',
      actions: h('button.btn.sm.ghost', { type: 'button', onClick: load }, icon('refresh', 15), 'Refresh'),
      body: h('div.stack', h('p.subtle', 'Link each person to their firm user so their time and tasks are attributed correctly.'), membersBody),
    }),
    card({
      title: 'Invite someone',
      body: h('div.stack', h('div.grid-2', field('Role', roleSel), field('Label', label)), h('div', createBtn), linkOut, h('h3.small-head', 'Open invitations'), invitesBody),
    }),
  );
  load();
  return wrap;
}
