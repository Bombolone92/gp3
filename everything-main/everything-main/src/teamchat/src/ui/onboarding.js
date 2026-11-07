/**
 * First run: the user has no workspace yet. One decision: create one or join
 * one. Closing without choosing leaves an empty home with the same two
 * options, so nothing is lost.
 */
import { el } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { store } from '../lib/store.js';
import { createWorkspaceDialog, joinWorkspaceDialog } from './dialogs.js';

export function shouldOnboard() {
  return store.workspaces.length === 0;
}

function choice({ icon: ic, title, sub, onClick }) {
  return el('button.onboard-choice', { type: 'button', onclick: onClick },
    el('span.onboard-icon', { html: icon(ic, 22) }),
    el('span.onboard-text', {}, el('strong', {}, title), el('span', {}, sub)),
    el('span', { html: icon('chevRight', 18), className: 'chev' }));
}

export function openOnboarding({ onClose } = {}) {
  const name = store.profile?.name || store.profile?.username || 'there';
  const body = el('div', {},
    el('p', { style: { color: 'var(--ink-2)', marginBottom: '16px' } },
      `Hi ${name}. Teamchat keeps your team's conversations in channels, threads, and direct messages. Where would you like to start?`),
    el('div.onboard-choices', {},
      choice({
        icon: 'building', title: 'Create a workspace', sub: 'Start a space for your team and invite people',
        onClick: () => { modal.close(); createWorkspaceDialog(); },
      }),
      choice({
        icon: 'login', title: 'Join with an invite', sub: 'Paste an invite code or link from a teammate',
        onClick: () => { modal.close(); joinWorkspaceDialog(); },
      })),
    el('p.small.muted', { style: { marginTop: '16px', textAlign: 'center' } }, 'You can do any of these later from the workspace menu.'));
  const modal = openModal({ title: 'Welcome to Teamchat', content: body, onClose });
  return modal;
}

/** The empty home screen behind the onboarding modal. */
export function homeEmpty() {
  return el('div.auth-view', {},
    el('div.empty-icon', { html: icon('messages', 28), style: { width: '64px', height: '64px', borderRadius: '18px', background: 'var(--accent-wash)', color: 'var(--accent-strong)' } }),
    el('h1.auth-title', { style: { fontSize: '24px', marginTop: '8px' } }, 'No workspace yet'),
    el('p.auth-sub', {}, 'Create one or join one with an invite.'),
    el('div.onboard-choices', { style: { width: '100%', maxWidth: '420px', textAlign: 'left' } },
      choice({ icon: 'building', title: 'Create a workspace', sub: 'Start a space for your team', onClick: () => createWorkspaceDialog() }),
      choice({ icon: 'login', title: 'Join with an invite', sub: 'Paste a code or link', onClick: () => joinWorkspaceDialog() })),
    el('p.auth-note', {}, 'Powered by ', el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Puter')));
}
