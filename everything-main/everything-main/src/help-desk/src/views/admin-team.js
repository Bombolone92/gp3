/** Admin sections: Team (agents, invitations, team access) and Groups. */
import { avatar, selectField, spinner, emptyState } from '../ui/components.js';
import { openMenu, openPicker } from '../ui/popover.js';
import { openDialog, confirmDialog, promptDialog } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { relTime, fullDate, plural } from '../ui/format.js';
import { go } from '../ui/router.js';
import { ROLE_LABEL } from '../shared/model.js';
import { randomId } from '../shared/ids.js';
import { app } from '../app.js';
import { sdk } from '../client/puter.js';
import { LOCAL, request } from '../client/api.js';
import { deployServer, findOwnServer, fetchBundle, updateServer } from '../client/deploy.js';
import { saveServer, rememberDesk, forgetDesk } from '../client/userdoc.js';
import { goOnline, STEPS, friendlyError } from './admin-online.js';
import { h, clear, uid, icon, sectionHead, panel, copyField, copyText, callout } from './admin-common.js';

/** The app's address without query or fragment (Puter may add session parameters to the query). */
export const appBase = () => `${location.origin}${location.pathname}`;
const inviteLink = (code) => `${appBase()}#/join/${app.server}/${app.api.desk}/${code}`;

function groupNames(ids) {
  const groups = app.replica.cfg.groups || [];
  return (ids || []).map((id) => groups.find((g) => g.id === id)?.name).filter(Boolean);
}

async function updateMember(uuid, body) {
  const res = await app.api.post(`/members/${uuid}`, body);
  app.replica.setMembers({ ...app.replica.members, [uuid]: res.member });
  return res.member;
}

/* ---------------------------------------------------------------- Team */

export function renderTeam(container) {
  const local = app.server === LOCAL;
  const isOwner = app.me?.role === 'owner';
  const accessEl = h('div');
  const membersEl = h('div');
  const invitesEl = h('div');
  const suggestEl = h('div');
  const inviteBtn = h('button.btn.btn-primary', { type: 'button', disabled: local, onclick: () => inviteDialog() }, icon('user-plus', { size: 15 }), 'Invite agent');
  container.append(sectionHead('Team', 'The agents who answer requests, and what each of them can do.', inviteBtn), accessEl, membersEl, invitesEl, suggestEl);

  let invites = [];

  function paintAccess() {
    clear(accessEl);
    if (local) accessEl.append(onlinePanel());
    else if (isOwner) serverHealth(accessEl);
  }

  /* Members */
  function paintMembers() {
    clear(membersEl);
    const members = Object.values(app.replica.members).sort((a, b) => (b.role === 'owner') - (a.role === 'owner') || a.name.localeCompare(b.name));
    const table = h('table.table.members-table', { 'aria-label': 'Agents' },
      h('thead', h('tr', h('th', 'Name'), h('th.col-role', 'Role'), h('th.col-groups', 'Groups'), h('th.col-status', 'Status'), h('th.col-actions', h('span.sr-only', 'Actions')))),
      h('tbody', members.map(memberRow)));
    const activeCount = members.filter((m) => m.active).length;
    membersEl.append(panel(`Agents`, `${plural(activeCount, 'active agent')}${members.length > activeCount ? `, ${members.length - activeCount} deactivated` : ''}.`, h('div.table-wrap', table)));
  }

  function memberRow(m) {
    const self = m.uuid === app.me?.uuid;
    const locked = m.role === 'owner' || self;
    const roleId = uid('role');
    const role = locked
      ? h('span.role-badge', { class: m.role }, ROLE_LABEL[m.role] || m.role)
      : selectField({
          id: roleId, value: m.role, label: `Role for ${m.name}`, search: false,
          options: [{ value: 'admin', label: 'Administrator', desc: 'Everything, including Admin' }, { value: 'agent', label: 'Agent', desc: 'Tickets, customers, articles' }],
          onChange: async (v, _o, prev) => {
            try {
              await updateMember(m.uuid, { role: v });
              toast(`${m.name} is now ${v === 'admin' ? 'an administrator' : 'an agent'}.`, { kind: 'success' });
            } catch (e) {
              toastError(e);
              role.setValue(prev);
            }
          },
        });
    const names = groupNames(m.groups);
    const groupsBtn = h('button.chip-btn', {
      type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': `Groups for ${m.name}: ${names.join(', ') || 'none'}`,
      onclick: () => openPicker(groupsBtn, {
        options: (app.replica.cfg.groups || []).map((g) => ({ value: g.id, label: g.name })),
        value: m.groups || [], multi: true, label: `Groups for ${m.name}`, search: (app.replica.cfg.groups || []).length > 7,
        emptyText: 'No groups yet',
        onPick: async (v) => {
          try {
            await updateMember(m.uuid, { groups: v });
          } catch (e) {
            toastError(e);
          }
        },
      }),
    }, names.length ? names.map((n) => h('span.chip.static', n)) : h('span.subtle', 'No groups'), icon('chevron-down', { size: 13 }));
    const more = locked ? null : h('button.icon-btn', {
      type: 'button', 'aria-label': `More actions for ${m.name}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
      onclick: () => openMenu(more, [
        m.active
          ? { label: 'Deactivate', icon: 'ban', desc: 'Keeps their history; they can no longer sign in to this desk', run: () => setActive(m, false) }
          : { label: 'Reactivate', icon: 'circle-check', run: () => setActive(m, true) },
        { separator: true },
        { label: 'Remove from team', icon: 'trash', danger: true, run: () => remove(m) },
      ], { align: 'end', label: `Actions for ${m.name}` }),
    }, icon('ellipsis', { size: 18 }));
    return h(`tr${m.active ? '' : '.inactive'}`,
      h('td', h('div.member-cell', avatar(m.name, { agent: true, username: self ? '' : null }), h('div.member-names', h('span.member-name', m.name, self ? h('span.subtle', ' (you)') : null), h('span.member-user', m.username ? `@${m.username}` : '')))),
      h('td.col-role', role),
      h('td.col-groups', groupsBtn),
      h('td.col-status', m.active ? h('span.state.on', 'Active') : h('span.state', 'Deactivated'), h('span.member-joined', { title: fullDate(m.joinedAt) }, `Joined ${relTime(m.joinedAt)}`)),
      h('td.col-actions', more));
  }

  async function setActive(m, active) {
    try {
      await updateMember(m.uuid, { active });
      toast(active ? `${m.name} can work on tickets again.` : `${m.name} was deactivated.`, { kind: 'success' });
    } catch (e) {
      toastError(e);
    }
  }

  async function remove(m) {
    const assigned = app.replica.ticketsFor((t) => t.assignee === m.uuid && ['new', 'open', 'pending', 'hold'].includes(t.status)).length;
    const ok = await confirmDialog({
      title: `Remove ${m.name}?`,
      message: `${m.name} will lose access to this help desk.${assigned ? ` ${plural(assigned, 'open ticket')} assigned to them will stay assigned until someone reassigns them.` : ''} You can invite them again later.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await app.api.del(`/members/${m.uuid}`);
      const { [m.uuid]: _gone, ...rest } = app.replica.members;
      app.replica.setMembers(rest);
      toast(`${m.name} was removed.`, { kind: 'success' });
    } catch (e) {
      toastError(e);
    }
  }

  /* Invitations */
  async function loadInvites() {
    if (local) return;
    try {
      const res = await app.api.get('/invites');
      invites = (res.invites || []).sort((a, b) => b.at - a.at);
    } catch {
      invites = [];
    }
    paintInvites();
  }

  function paintInvites() {
    clear(invitesEl);
    if (local) return;
    const body = invites.length
      ? h('ul.invite-list', invites.map((inv) => h('li.invite',
          h('span.invite-icon', icon('mail', { size: 16 })),
          h('div.grow', h('div', h('strong', inv.note || 'Invite link'), h('span.muted', ` · ${ROLE_LABEL[inv.role] || inv.role}`)), h('div.invite-meta', `Created by ${inv.byName || app.memberName(inv.by)} ${relTime(inv.at)} · expires ${relTime(inv.expiresAt)}`)),
          h('button.btn.btn-sm', { type: 'button', onclick: () => copyText(inviteLink(inv.code), 'Invite link') }, icon('copy', { size: 13 }), 'Copy link'),
          h('button.btn.btn-sm.btn-ghost', { type: 'button', 'aria-label': `Revoke invite ${inv.note || ''}`, onclick: () => revoke(inv) }, 'Revoke'))))
      : h('p.muted', 'No pending invitations. Each invite link works once and expires after 7 days.');
    invitesEl.append(panel('Pending invitations', null, body));
  }

  async function revoke(inv) {
    try {
      await app.api.del(`/invites/${inv.code}`);
      invites = invites.filter((x) => x.code !== inv.code);
      paintInvites();
      toast('Invitation revoked.');
    } catch (e) {
      toastError(e);
    }
  }

  function inviteDialog(prefill = '') {
    const noteId = uid('note');
    let role = 'agent';
    const note = h(`input#${noteId}.input`, { value: prefill, maxlength: 120, placeholder: 'For example: Jamie, billing team' });
    const roles = h('div.role-choice', { role: 'radiogroup', 'aria-label': 'Role' },
      [['agent', 'Agent', 'Works on tickets, customers and articles'], ['admin', 'Administrator', 'Everything agents can do, plus Admin']].map(([v, label, desc]) =>
        h('label.role-option', h('input', { type: 'radio', name: 'invite-role', value: v, checked: v === role, onchange: () => { role = v; } }), h('span', h('strong', label), h('span.muted', desc)))));
    const result = h('div');
    let created = null;
    const dlg = openDialog({
      title: 'Invite an agent',
      description: 'Create a single-use link and send it to your teammate. They sign in with Puter and join right away.',
      body: h('div.stack', h('div.field', h('label.field-label', { for: noteId }, 'Who is it for?', h('span.subtle', ' (optional)')), note), h('div.field', h('span.field-label', 'Role'), roles), result),
      actions: [
        { label: 'Close' },
        {
          label: 'Create link', primary: true,
          run: async () => {
            if (created) {
              await copyText(inviteLink(created.code), 'Invite link');
              return true;
            }
            try {
              const res = await app.api.post('/invites', { role, note: note.value.trim() });
              created = res.invite;
              invites.unshift(created);
              paintInvites();
              clear(result);
              result.append(callout('success', 'circle-check', h('strong', 'Link ready. '), 'Send it to your teammate. It works once and expires in 7 days.'), copyField(inviteLink(created.code), { label: 'Invite link' }));
              const btn = dlg.el.querySelector('.dialog-foot .btn-primary');
              if (btn) btn.textContent = 'Copy link';
              result.querySelector('input')?.select();
              return false;
            } catch (e) {
              toastError(e);
              return false;
            }
          },
        },
      ],
    });
  }

  /* Puter team suggestions */
  async function loadSuggestions() {
    clear(suggestEl);
    if (local) return;
    const p = sdk();
    if (!p?.teams?.list) return;
    let team = null;
    try {
      [team] = await p.teams.list();
    } catch {
      return;
    }
    if (!team || !team.directoryEnabled) return;
    let people = [];
    try {
      people = await p.teams.listDirectory(team.uid);
    } catch {
      return;
    }
    const known = new Set(Object.keys(app.replica.members));
    const candidates = (people || []).filter((x) => x && !known.has(x.uuid)).slice(0, 50);
    if (!candidates.length) return;
    suggestEl.append(panel(`From your Puter team${team.name ? `: ${team.name}` : ''}`, 'Teammates who are not on this help desk yet. Create a link for one of them and send it.',
      h('ul.suggest-list', candidates.map((x) => h('li.suggest',
        avatar(x.username, { username: x.username }),
        h('span.grow', h('strong', `@${x.username}`)),
        h('button.btn.btn-sm', { type: 'button', onclick: () => inviteDialog(x.username) }, icon('user-plus', { size: 13 }), 'Invite'))))));
  }

  /* Team access (going online) */
  function onlinePanel() {
    const stepsEl = h('ol.online-steps', { 'aria-live': 'polite' });
    const errEl = h('div');
    const start = h('button.btn.btn-primary', { type: 'button', disabled: !isOwner, onclick: () => run() }, icon('cloud', { size: 15 }), 'Turn on team access');
    const intro = h('div.online-intro',
      h('div.online-icon', icon('server', { size: 22 })),
      h('div.grow',
        h('h2', 'This help desk runs only in your account'),
        h('p', 'To invite agents, publish your help center and email customers, turn on team access. This starts a small server (a Puter worker) in your own Puter account. Your data stays in your account and you pay only for what it uses.'),
        isOwner ? null : h('p.muted', 'Only the owner can turn on team access.')),
      start);
    const box = h('section.online-panel', { 'aria-label': 'Team access' }, intro, stepsEl, errEl);
    async function run() {
      start.disabled = true;
      start.textContent = 'Working';
      clear(errEl);
      const state = {};
      const paint = () => {
        clear(stepsEl);
        for (const s of STEPS) {
          const st = state[s.id] || { state: 'pending' };
          stepsEl.append(h(`li.online-step.${st.state}`,
            h('span.step-mark', st.state === 'done' ? icon('check', { size: 13 }) : st.state === 'active' ? h('span.spinner') : st.state === 'error' ? icon('x', { size: 13 }) : st.state === 'skipped' ? icon('minus', { size: 13 }) : null),
            h('span.step-label', s.label), st.detail ? h('span.step-detail', st.detail) : null,
            h('span.sr-only', ` ${st.state}`)));
        }
      };
      paint();
      const deps = {
        kv: sdk().kv,
        request,
        deployServer,
        findOwnServer,
        saveServer: async (s) => {
          await saveServer(s);
          app.doc.server = s;
        },
        rememberDesk,
        forgetDesk,
      };
      try {
        const res = await goOnline(deps, {
          desk: app.api.desk,
          deskName: app.replica.meta?.name,
          known: app.doc?.server || null,
          appUrl: appBase(),
          onStep: (id, s, detail) => {
            state[id] = { state: s, detail };
            paint();
          },
        });
        const desk = app.api.desk;
        delete app.doc.desks[`local/${desk}`];
        app.doc.desks[`${res.server}/${desk}`] = { server: res.server, desk, name: app.replica.meta?.name, role: 'owner', at: Date.now() };
        app.doc.last = `${res.server}/${desk}`;
        toast('Team access is on. You can now invite agents and publish your help center.', { kind: 'success', title: 'You are online' });
        app.emit('switch', { server: res.server, desk });
        // Land back on Team, ready to invite, once the desk reopens.
        go('/admin/team', { replace: true });
      } catch (e) {
        errEl.append(callout('error', 'triangle-alert', h('strong', 'Team access could not be turned on. '), friendlyError(e)));
        start.disabled = false;
        start.textContent = 'Try again';
      }
    }
    return box;
  }

  async function serverHealth(el) {
    let health = null;
    let bundle = null;
    try {
      [health, bundle] = await Promise.all([request(app.server, 'GET', '/health', { retries: 0 }), fetchBundle()]);
    } catch {
      return;
    }
    if (!health?.ok || !bundle || health.build === bundle.build) return;
    if (Number(health.builtAt) > bundle.builtAt) return;
    const btn = h('button.btn.btn-sm', {
      type: 'button',
      onclick: async () => {
        btn.disabled = true;
        btn.textContent = 'Updating';
        const server = app.doc?.server?.name === app.server ? app.doc.server : { name: app.server, path: null };
        const build = await updateServer(server, health);
        if (build) {
          toast('Your server is up to date.', { kind: 'success' });
          await saveServer({ ...server, build }).catch(() => {});
          clear(el);
        } else {
          btn.disabled = false;
          btn.textContent = 'Update server';
          toastError({ message: 'The update did not finish. Try again in a minute.' });
        }
      },
    }, 'Update server');
    el.append(callout('info', 'refresh-cw', h('strong', 'A server update is available. '), 'It brings the latest fixes to everyone on this help desk and takes about a minute. ', btn));
  }

  const onChange = (e) => {
    const k = e.detail?.kinds;
    if (!k || k.has('m') || k.has('c')) paintMembers();
  };
  app.replica.addEventListener('change', onChange);
  paintAccess();
  paintMembers();
  if (!local) {
    invitesEl.append(panel('Pending invitations', null, h('div.admin-loading', spinner('Loading invitations'))));
    loadInvites();
    loadSuggestions();
  }
  return () => app.replica.removeEventListener('change', onChange);
}

/* -------------------------------------------------------------- Groups */

export function renderGroups(container) {
  const listEl = h('div');
  const addBtn = h('button.btn.btn-primary', { type: 'button', onclick: () => addGroup() }, icon('plus', { size: 15 }), 'Add group');
  container.append(sectionHead('Groups', 'Groups route tickets to the right people, like Billing or Technical support. Tickets can be assigned to a group, and agents see their groups’ work on Home.', addBtn), listEl);

  const groups = () => app.replica.cfg.groups || [];
  const membersOf = (gid) => app.replica.agents({ includeInactive: true }).filter((m) => (m.groups || []).includes(gid));

  function paint() {
    clear(listEl);
    if (!groups().length) {
      listEl.append(emptyState({ glyph: 'users-round', title: 'No groups yet', text: 'Add a group to organize agents and route tickets.', action: h('button.btn', { type: 'button', onclick: () => addGroup() }, 'Add group') }));
      return;
    }
    const open = (gid) => app.replica.ticketsFor((t) => t.group === gid && ['new', 'open', 'pending', 'hold'].includes(t.status)).length;
    listEl.append(h('ul.group-list', groups().map((g) => {
      const members = membersOf(g.id);
      const more = h('button.icon-btn', {
        type: 'button', 'aria-label': `More actions for ${g.name}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
        onclick: () => openMenu(more, [
          { label: 'Rename', icon: 'pencil', run: () => rename(g) },
          { label: 'Edit description', icon: 'file-text', run: () => describe(g) },
          { separator: true },
          { label: 'Delete group', icon: 'trash', danger: true, run: () => remove(g) },
        ], { align: 'end', label: `Actions for ${g.name}` }),
      }, icon('ellipsis', { size: 18 }));
      const editMembers = h('button.btn.btn-sm', {
        type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false',
        onclick: () => openPicker(editMembers, {
          options: app.replica.agents().map((a) => ({ value: a.uuid, label: a.name, keywords: a.username, icon: avatar(a.name, { size: 'sm', agent: true }) })),
          value: members.map((m) => m.uuid), multi: true, label: `Agents in ${g.name}`, placeholder: 'Search agents',
          onPick: (v, opt) => toggleMember(g, opt.value, v.includes(opt.value)),
        }),
      }, icon('user-plus', { size: 13 }), 'Agents');
      return h('li.group-card',
        h('div.group-main',
          h('div.group-title', h('h2', g.name), h('span.muted', `${plural(members.length, 'agent')} · ${plural(open(g.id), 'open ticket')}`)),
          g.desc ? h('p.muted.group-desc', g.desc) : null,
          h('div.group-avatars', members.length ? members.slice(0, 8).map((m) => avatar(m.name, { size: 'sm', agent: true, title: m.name })) : h('span.subtle', 'No agents yet'), members.length > 8 ? h('span.muted', `+${members.length - 8}`) : null)),
        h('div.group-actions', editMembers, more));
    })));
  }

  async function toggleMember(g, uuid, on) {
    const m = app.replica.members[uuid];
    if (!m) return;
    const next = on ? [...new Set([...(m.groups || []), g.id])] : (m.groups || []).filter((x) => x !== g.id);
    try {
      await updateMember(uuid, { groups: next });
    } catch (e) {
      toastError(e);
    }
  }

  async function addGroup() {
    const name = await promptDialog({ title: 'Add group', label: 'Group name', placeholder: 'Billing', confirmLabel: 'Add', validate: (v) => (!v ? 'Give the group a name' : groups().some((g) => g.name.toLowerCase() === v.toLowerCase()) ? 'A group with that name already exists' : null) });
    if (!name) return;
    try {
      await app.saveConfig('groups', [...groups(), { id: randomId(8), name, desc: '' }]);
      toast(`Group "${name}" added.`, { kind: 'success' });
    } catch (e) {
      toastError(e);
    }
  }

  async function rename(g) {
    const name = await promptDialog({ title: 'Rename group', label: 'Group name', value: g.name, validate: (v) => (!v ? 'Give the group a name' : groups().some((x) => x.id !== g.id && x.name.toLowerCase() === v.toLowerCase()) ? 'A group with that name already exists' : null) });
    if (!name || name === g.name) return;
    try {
      await app.saveConfig('groups', groups().map((x) => (x.id === g.id ? { ...x, name } : x)));
    } catch (e) {
      toastError(e);
    }
  }

  async function describe(g) {
    const desc = await promptDialog({ title: `Describe ${g.name}`, label: 'Description', value: g.desc || '', validate: () => null });
    if (desc === null) return;
    try {
      await app.saveConfig('groups', groups().map((x) => (x.id === g.id ? { ...x, desc } : x)));
    } catch (e) {
      toastError(e);
    }
  }

  async function remove(g) {
    const tickets = app.replica.ticketsFor((t) => t.group === g.id).length;
    const ok = await confirmDialog({
      title: `Delete ${g.name}?`,
      message: `${tickets ? `${plural(tickets, 'ticket')} in this group will keep it until they are reassigned. ` : ''}Agents are not removed from the help desk.`,
      confirmLabel: 'Delete group',
      danger: true,
    });
    if (!ok) return;
    try {
      await app.saveConfig('groups', groups().filter((x) => x.id !== g.id));
      for (const m of membersOf(g.id)) await updateMember(m.uuid, { groups: (m.groups || []).filter((x) => x !== g.id) }).catch(() => {});
      toast(`Group "${g.name}" deleted.`);
    } catch (e) {
      toastError(e);
    }
  }

  const onChange = (e) => {
    const k = e.detail?.kinds;
    if (!k || k.has('m') || k.has('c')) paint();
  };
  app.replica.addEventListener('change', onChange);
  paint();
  return () => app.replica.removeEventListener('change', onChange);
}

export { go };
