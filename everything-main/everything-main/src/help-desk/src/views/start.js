/**
 * Screens shown before the workspace: sign in, create your first help desk,
 * and join one from an invite link.
 */
import { h, clear, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toastError } from '../ui/toast.js';
import { REPO_URL } from './shell.js';

function frame(root, ...content) {
  clear(root);
  const card = h('div.start-card', h('img.start-logo', { src: './icon-192.png', alt: '', width: 48, height: 48 }), ...content);
  root.append(
    h('main.start', { id: 'main' },
      card,
      h('p.start-foot',
        'Free and open source. ',
        h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, 'Source code'),
        ' · Powered by ',
        h('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Puter'))),
  );
  return card;
}

export function signInScreen(root, { onSignIn }) {
  const btn = h('button.btn.btn-primary.btn-lg.btn-block', {
    type: 'button',
    onclick: async () => {
      btn.disabled = true;
      try {
        await onSignIn();
      } catch (e) {
        toastError(e, 'Sign in did not finish. Try again.');
      } finally {
        btn.disabled = false;
      }
    },
  }, 'Sign in');
  frame(root,
    h('h1', 'Help Desk'),
    h('p.start-lead', 'Answer customer requests as a team, with a shared inbox, a help center and reports. Your data stays in your own Puter account.'),
    h('ul.start-points',
      h('li', icon('inbox', { size: 16 }), 'Tickets with public replies and internal notes'),
      h('li', icon('book-open', { size: 16 }), 'A help center where customers find answers'),
      h('li', icon('chart-column', { size: 16 }), 'Views, macros, automations and reports')),
    btn);
  btn.focus();
}

export function createDeskScreen(root, { user, onCreate, onCancel = null }) {
  const nameId = uid('desk-name');
  const agentId = uid('agent-name');
  const err = h('p.field-error', { role: 'alert' });
  const name = h(`input#${nameId}.input`, { required: true, maxlength: 80, placeholder: 'Acme Support', autocomplete: 'organization' });
  const agent = h(`input#${agentId}.input`, { required: true, maxlength: 80, value: user?.username || '', autocomplete: 'name' });
  const submit = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, 'Create help desk');
  const form = h('form.stack', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim()) {
        err.textContent = 'Give your help desk a name';
        name.setAttribute('aria-invalid', 'true');
        name.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Creating';
      try {
        await onCreate({ name: name.value.trim(), agentName: agent.value.trim() || user?.username || 'Owner' });
      } catch (e2) {
        err.textContent = e2?.message || 'Could not create the help desk';
        submit.disabled = false;
        submit.textContent = 'Create help desk';
      }
    },
  },
  h('div.field', h('label.field-label', { for: nameId }, 'Help desk name'), name, h('p.field-hint', 'Usually your company or team name. Customers see it in the help center and emails.')),
  h('div.field', h('label.field-label', { for: agentId }, 'Your name'), agent),
  err,
  submit,
  onCancel ? h('button.btn.btn-ghost.btn-block', { type: 'button', onclick: onCancel }, 'Cancel') : null);
  frame(root,
    h('h1', 'Create your help desk'),
    h('p.start-lead', 'It is ready right away. Invite teammates and open your help center whenever you like.'),
    form,
    h('p.start-note', icon('info', { size: 14 }), 'Joining a team? Open the invite link an administrator sent you.'));
  name.focus();
}

export function joinScreen(root, { user, server, desk, invite = null, onJoin, onCancel }) {
  const nameId = uid('agent-name');
  const err = h('p.field-error', { role: 'alert' });
  const agent = h(`input#${nameId}.input`, { required: true, maxlength: 80, value: user?.username || '', autocomplete: 'name' });
  const submit = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, 'Join help desk');
  const form = h('form.stack', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        await onJoin({ name: agent.value.trim() });
      } catch (e2) {
        err.textContent = e2?.message || 'Could not join';
        submit.disabled = false;
      }
    },
  },
  h('div.field', h('label.field-label', { for: nameId }, 'Your name'), agent, h('p.field-hint', 'Shown to your teammates and on your replies to customers.')),
  err, submit,
  h('button.btn.btn-ghost.btn-block', { type: 'button', onclick: onCancel }, 'Not now'));
  const role = invite?.role === 'admin' ? 'an administrator' : 'an agent';
  frame(root,
    h('h1', invite?.name ? `Join ${invite.name}` : 'You are invited'),
    h('p.start-lead', invite?.by
      ? `${invite.by} invited you to join as ${role}, to answer and organize customer requests together.`
      : `Join this help desk as ${role} to answer and organize its requests.`),
    invite ? null : h('p.start-meta', icon('server', { size: 14 }), h('span.mono', `${server} / ${desk}`)),
    form);
  agent.focus();
}

export function errorScreen(root, { title, message, action = null }) {
  frame(root, h('h1', title), h('p.start-lead', message), action);
}

export function loadingScreen(root, text = 'Loading your help desk') {
  clear(root);
  root.append(h('div.boot', { role: 'status' }, h('img', { src: './icon-192.png', alt: '', width: 48, height: 48 }), h('p', text)));
}
