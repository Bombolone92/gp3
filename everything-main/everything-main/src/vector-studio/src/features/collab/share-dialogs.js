/**
 * File > Invite to Edit and File > Share for Review: sharing a document
 * (after confirming, since it stays shared until stopped), inviting people
 * by Puter username or with a link, roles, managing who has access,
 * review links for people who should only view and comment, and Stop
 * Sharing. Explains what is needed when not signed in or offline.
 */
import { h, announce } from '../../lib/dom.js';
import { icon } from '../../ui/icons.js';
import { openDialog } from '../../ui/dialogs/dialog.js';
import { INVITE_ROLES, ROLE_LABELS, canManage, colorFor, initials } from './protocol.js';
import { roleSentence } from './manager.js';

const ROLE_HELP = { editor: 'Can edit', commenter: 'Can comment', viewer: 'Can view' };

async function copyText(text, input = null) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (input) {
      input.select();
      try {
        return document.execCommand('copy');
      } catch {
        return false;
      }
    }
    return false;
  }
}

/** A dialog that explains what sharing needs; offers sign-in. Resolves true when it can go on. */
export async function sharingNeeds(app, purpose) {
  const reason = app.collab.unavailable();
  if (!reason) return true;
  const canSignIn = !app.collab.identity() && app.onSignIn;
  const res = await openDialog({
    title: purpose,
    body: h('div.collab-explain', h('p.dialog-message', reason), h('p.muted', 'Your own documents keep working without it: you can still save to this computer and export.')),
    buttons: canSignIn ? [{ label: 'Cancel', value: false }, { label: 'Sign In', value: 'signin', primary: true }] : [{ label: 'OK', value: false, primary: true }],
  });
  if (res !== 'signin') return false;
  await app.onSignIn();
  return !app.collab.unavailable();
}

function progressDialog(title) {
  let close = () => {};
  const line = h('p.dialog-message', { role: 'status' }, 'Starting...');
  openDialog({
    title,
    body: h('div.collab-progress', h('span.collab-spinner', { 'aria-hidden': 'true' }, icon('loader', 18)), line),
    onOpen: (d) => (close = () => d.close(null)),
  });
  return { set: (t) => (line.textContent = t), close: () => close() };
}

/** Confirm, then share a personal document. Resolves the session, or null when cancelled or failed. */
export async function shareDocument(app, editor, { review = false } = {}) {
  if (app.collab.sessionOf(editor)) return app.collab.sessionOf(editor);
  if (!(await sharingNeeds(app, review ? 'Share for Review' : 'Invite to Edit'))) return null;
  const ok = await openDialog({
    title: review ? 'Share for Review' : 'Invite to Edit',
    body: h(
      'div.collab-explain',
      h('p.dialog-message', `Share "${editor.name}"?`),
      h(
        'ul.collab-points',
        h('li', 'The document is kept in your Puter account, on a collaboration server that runs in your account.'),
        h('li', review ? 'People with the review link can view it and comment, but not edit.' : 'People you invite open it from a link and see each other’s changes live.'),
        h('li', 'It stays shared until you choose Stop Sharing. You can change or remove anyone’s access at any time.'),
      ),
    ),
    buttons: [
      { label: 'Cancel', value: false },
      { label: 'Share', value: true, primary: true },
    ],
  });
  if (!ok) return null;
  const progress = progressDialog(review ? 'Share for Review' : 'Invite to Edit');
  try {
    const session = await app.collab.share(editor, (t) => progress.set(t));
    progress.close();
    announce(`"${editor.name}" is now shared.`);
    return session;
  } catch (err) {
    progress.close();
    await app.dialogs.alert({ title: 'Sharing Failed', message: err?.message || 'The document could not be shared. Try again.' });
    return null;
  }
}

function roleSelect(value, onChange, { label, roles = INVITE_ROLES, remove = false } = {}) {
  const sel = h('select.collab-role-select', { 'aria-label': label, onchange: () => onChange(sel.value) }, ...roles.map((r) => h('option', { value: r }, ROLE_HELP[r])), remove ? h('option', { value: 'removed' }, 'Remove access') : null);
  sel.value = value;
  return sel;
}

function avatar(name, id) {
  return h('span.collab-person-avatar', { style: { background: colorFor(id || name) }, 'aria-hidden': 'true' }, initials(name));
}

/** File > Invite to Edit. */
export async function inviteDialog(app, editor = app.editor) {
  if (!editor) return;
  let session = app.collab.sessionOf(editor);
  if (!session) {
    session = await shareDocument(app, editor);
    if (!session) return;
  }
  if (!canManage(session.role)) return accessInfoDialog(app, editor, session);
  const status = h('p.collab-status-line', { role: 'status', 'aria-live': 'polite' });
  const say = (t) => (status.textContent = t);

  // Invite by username.
  const nameInput = h('input.collab-username', { type: 'text', placeholder: 'Puter username', 'aria-label': 'Puter username', autocomplete: 'off', spellcheck: 'false' });
  let nameRole = 'editor';
  const nameRoleSel = roleSelect(nameRole, (v) => (nameRole = v), { label: 'Role for this person' });
  const inviteName = async () => {
    const username = nameInput.value.trim().replace(/^@/, '');
    if (!username) {
      say('Enter the Puter username of the person to invite.');
      nameInput.focus();
      return;
    }
    try {
      const res = await app.collab.manage(editor, { op: 'invite-user', username, role: nameRole });
      nameInput.value = '';
      say(res.member ? `${username} now has access: ${ROLE_HELP[nameRole]}.` : `Invited ${username}. Send them the document link below; they can open it once signed in as ${username}.`);
      await renderPeople();
    } catch (err) {
      say(err.message);
    }
  };
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      inviteName();
    }
  });

  // Invite with a link.
  let linkRole = 'editor';
  const linkField = h('input.collab-link', { type: 'text', readonly: true, 'aria-label': 'Invitation link', placeholder: 'Choose who the link is for, then Copy Link' });
  const makeLink = async () => {
    try {
      const url = await app.collab.link(editor, { role: linkRole });
      linkField.value = url;
      const copied = await copyText(url, linkField);
      say(copied ? `Link copied. Anyone who opens it signed in to Puter ${ROLE_HELP[linkRole].toLowerCase()}. It works for 30 days.` : 'Copy the link from the box.');
    } catch (err) {
      say(err.message);
    }
  };
  const docLink = async () => {
    const url = await app.collab.link(editor);
    linkField.value = url;
    const copied = await copyText(url, linkField);
    say(copied ? 'Document link copied. It opens the document for people who already have access.' : 'Copy the link from the box.');
  };

  const people = h('ul.collab-people', { 'aria-label': 'People with access' });
  const renderPeople = async () => {
    let data;
    try {
      data = await app.collab.members(editor, { fresh: true });
    } catch (err) {
      people.replaceChildren(h('li.muted', err.message));
      return;
    }
    const rows = [];
    for (const m of data.members.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.username.localeCompare(b.username)))) {
      const me = m.uuid === session.user.uuid;
      const control =
        m.role === 'owner'
          ? h('span.collab-person-role', 'Owner')
          : roleSelect(m.role, async (v) => {
              try {
                await app.collab.manage(editor, { op: 'role', uuid: m.uuid, role: v });
                say(v === 'removed' ? `${m.username} no longer has access.` : `${m.username} now: ${ROLE_HELP[v]}.`);
                await renderPeople();
              } catch (err) {
                say(err.message);
              }
            }, { label: `Access for ${m.username}`, remove: true });
      rows.push(h('li.collab-person', avatar(m.username, m.uuid), h('span.collab-person-name', m.username, me ? h('span.muted', ' (you)') : null, m.review ? h('span.muted', ' · reviewer') : null), control));
    }
    const memberNames = new Set(data.members.map((m) => m.username.toLowerCase()));
    for (const n of data.named || []) {
      if (memberNames.has(n.username.toLowerCase())) continue;
      rows.push(
        h(
          'li.collab-person.pending',
          avatar(n.username),
          h('span.collab-person-name', n.username, h('span.muted', ` · invited, ${ROLE_HELP[n.role].toLowerCase()}`)),
          h(
            'button.btn.small.ghost',
            {
              type: 'button',
              onclick: async () => {
                await app.collab.manage(editor, { op: 'uninvite-user', username: n.username });
                say(`Invitation for ${n.username} withdrawn.`);
                await renderPeople();
              },
            },
            'Withdraw',
          ),
        ),
      );
    }
    people.replaceChildren(...rows);
    const links = (data.invites || []).length;
    revokeBtn.hidden = !links;
    revokeBtn.textContent = `Withdraw ${links} Link${links === 1 ? '' : 's'}`;
  };
  const revokeBtn = h(
    'button.btn.small.ghost',
    {
      type: 'button',
      hidden: true,
      onclick: async () => {
        await app.collab.manage(editor, { op: 'revoke-invites' });
        linkField.value = '';
        say('Invitation links withdrawn. People who already joined keep their access.');
        await renderPeople();
      },
    },
    'Withdraw Links',
  );

  const body = h(
    'div.collab-share',
    h('section.collab-section', { 'aria-labelledby': 'collab-invite-name' }, h('h3#collab-invite-name', 'Invite by username'), h('div.collab-row', nameInput, nameRoleSel, h('button.btn.primary.small', { type: 'button', onclick: inviteName }, 'Invite'))),
    h(
      'section.collab-section',
      { 'aria-labelledby': 'collab-invite-link' },
      h('h3#collab-invite-link', 'Invite with a link'),
      h('div.collab-row', roleSelect(linkRole, (v) => (linkRole = v), { label: 'People with the link' }), h('button.btn.small', { type: 'button', onclick: makeLink }, icon('link', 13), 'Copy Invitation Link'), h('button.btn.small.ghost', { type: 'button', onclick: docLink }, 'Copy Document Link')),
      linkField,
      revokeBtn,
    ),
    h('section.collab-section', { 'aria-labelledby': 'collab-people' }, h('h3#collab-people', 'People with access'), people),
    status,
  );
  renderPeople();
  const res = await openDialog({
    title: `Share "${editor.name}"`,
    className: 'collab-dialog',
    body,
    buttons: [
      { label: 'Stop Sharing...', value: 'stop', left: true },
      { label: 'Done', value: true, primary: true },
    ],
    initialFocus: () => nameInput,
  });
  if (res === 'stop') await stopSharing(app, editor);
}

/** For people who do not own the document: who it belongs to and their access. */
async function accessInfoDialog(app, editor, session) {
  const list = h('ul.collab-people', { 'aria-label': 'People with access' }, h('li.muted', 'Loading...'));
  app.collab
    .members(editor, { fresh: true })
    .then((data) => list.replaceChildren(...data.members.map((m) => h('li.collab-person', avatar(m.username, m.uuid), h('span.collab-person-name', m.username), h('span.collab-person-role', ROLE_LABELS[m.role] || '')))))
    .catch((err) => list.replaceChildren(h('li.muted', err.message)));
  const field = h('input.collab-link', { type: 'text', readonly: true, 'aria-label': 'Document link', value: await app.collab.link(editor) });
  const res = await openDialog({
    title: `"${editor.name}"`,
    className: 'collab-dialog',
    body: h('div.collab-share', h('p.dialog-message', `Shared by ${session.owner?.username || 'its owner'}: ${roleSentence(session.role)}. Only the owner can invite people or change access.`), h('section.collab-section', h('h3', 'Document link'), field, h('p.muted', 'It opens the document for people who already have access.')), h('section.collab-section', h('h3', 'People with access'), list)),
    buttons: [
      { label: 'Copy Link', value: 'copy' },
      { label: 'Done', value: true, primary: true },
    ],
  });
  if (res === 'copy' && (await copyText(field.value, field))) app.notify('Link copied.', { polite: true });
}

/** File > Share for Review: a link for people who may view and comment, not edit. */
export async function reviewDialog(app, editor = app.editor) {
  if (!editor) return;
  let session = app.collab.sessionOf(editor);
  if (!session) {
    session = await shareDocument(app, editor, { review: true });
    if (!session) return;
  }
  if (!canManage(session.role)) {
    await app.dialogs.alert({ title: 'Share for Review', message: `Only the owner (${session.owner?.username || 'who shared it'}) can create review links for this document.` });
    return;
  }
  let url = '';
  try {
    url = await app.collab.link(editor, { role: 'commenter', review: true });
  } catch (err) {
    await app.dialogs.alert({ title: 'Share for Review', message: err.message });
    return;
  }
  const field = h('input.collab-link', { type: 'text', readonly: true, 'aria-label': 'Review link', value: url });
  const status = h('p.collab-status-line', { role: 'status', 'aria-live': 'polite' });
  const copied = await copyText(url, field);
  status.textContent = copied ? 'Review link copied.' : 'Copy the link from the box.';
  const res = await openDialog({
    title: `Review "${editor.name}"`,
    className: 'collab-dialog',
    body: h(
      'div.collab-share',
      h('p.dialog-message', 'Anyone signed in to Puter who opens this link can view the document, move between artboards, zoom and pan, and add comments. They cannot change the artwork.'),
      h('div.collab-row', field, h('button.btn.small', { type: 'button', onclick: async () => (status.textContent = (await copyText(field.value, field)) ? 'Review link copied.' : 'Copy the link from the box.') }, icon('copy', 13), 'Copy')),
      h('p.muted', 'Reviewers see changes as you make them. The link works for 30 days; withdraw links or remove reviewers from File > Invite to Edit.'),
      status,
    ),
    buttons: [
      { label: 'Manage Access...', value: 'manage', left: true },
      { label: 'Done', value: true, primary: true },
    ],
  });
  if (res === 'manage') await inviteDialog(app, editor);
}

/** Owner: stop sharing after confirming. */
export async function stopSharing(app, editor) {
  const ok = await app.dialogs.confirm({
    title: 'Stop Sharing',
    message: `Stop sharing "${editor.name}"? Everyone else loses access and all invitation links stop working. This tab keeps the document as an unsaved file of your own.`,
    okLabel: 'Stop Sharing',
    danger: true,
  });
  if (!ok) return false;
  try {
    await app.collab.stop(editor);
    app.notify(`"${editor.name}" is no longer shared. Save it to keep a copy.`);
    return true;
  } catch (err) {
    await app.dialogs.alert({ title: 'Stop Sharing', message: err.message });
    return false;
  }
}
