/** Invitation links for families and staff (needs staff and family access turned on). */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { navigate } from '../ui/router.js';
import { app, isManager } from '../app.js';
import { personName } from '../core/format.js';
import { call, inviteLink } from '../team.js';

/** Whether invitations can be created right now; explains why not otherwise. */
function ready() {
  if (app.demo) {
    toast('Invitations work once you sign in and turn on staff and family access.', { type: 'info' });
    return false;
  }
  if (!isManager()) {
    toast('Only the director or an admin can invite people.', { type: 'error' });
    return false;
  }
  if (!app.team?.url) {
    openDialog({
      title: 'Turn on staff and family access',
      size: 'narrow',
      body: h('p', 'Families and staff sign in with their own Puter accounts and see your school through a small server in your Puter account. Turn it on once in Settings, then invite people from here.'),
      footer: ({ close }) => [h('button.btn', { type: 'button', onClick: () => close() }, 'Not now'), h('button.btn.primary', { type: 'button', onClick: () => (close(), navigate('/settings/access')) }, 'Go to settings')],
    });
    return false;
  }
  return true;
}

/** Create an invitation and show the link. who: { role, guardianId?, staffId?, name, email? } */
export async function invite({ role, guardianId, staffId, name, email }) {
  if (!ready()) return;
  let res;
  try {
    res = await call(app.team.url, 'invite', { role, guardianId, staffId, label: name });
  } catch (err) {
    toast(err.message || 'The invitation could not be created.', { type: 'error' });
    return;
  }
  const link = inviteLink(app.team.url, res.token);
  const school = app.settings().school.name || 'our school';
  const subject = role === 'parent' ? `Join ${school} on Childcare` : `Join the ${school} team`;
  const bodyText = role === 'parent' ? `Hi ${name.split(' ')[0]},\n\nYou can now see your child's day at ${school}: photos, meals, naps, messages, and statements. Open this link and sign in with a free Puter account:\n\n${link}\n\nThe link works once and expires in 14 days.` : `Hi ${name.split(' ')[0]},\n\nHere is your link to join ${school} on Childcare. Open it and sign in with a free Puter account:\n\n${link}\n\nThe link works once and expires in 14 days.`;
  const field = h('input.input', { value: link, readonly: true, 'aria-label': 'Invitation link', onFocus: (e) => e.target.select() });
  // Without clipboard access (blocked, or an insecure page), select the link to copy by hand.
  const copy = () =>
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(link))
      .then(
        () => toast('Link copied'),
        () => {
          field.focus();
          field.select();
          toast('Press Ctrl+C (⌘C on a Mac) to copy the link.', { type: 'info' });
        },
      );
  openDialog({
    title: `Invite ${name}`,
    body: h(
      'div.stack',
      h('p', role === 'parent' ? `Send this link to ${name}. After signing in they will see only their own children.` : `Send this link to ${name}. They join as ${role === 'admin' ? 'an admin' : 'staff'}.`),
      h('div.row', field, h('button.btn', { type: 'button', onClick: copy }, icon('copy', 16), 'Copy')),
      h('p.subtle.small', 'The link works once and expires in 14 days. Anyone with the link can use it, so send it only to this person.'),
    ),
    footer: ({ close }) => [
      email ? h('a.btn', { href: `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}` }, icon('mail', 16), 'Email it') : null,
      h('span.spacer'),
      h('button.btn.primary', { type: 'button', onClick: () => close() }, 'Done'),
    ],
  });
}

export const inviteGuardian = (g) => invite({ role: 'parent', guardianId: g.id, name: personName(g), email: g.email });
export const inviteStaff = (m, role = 'staff') => invite({ role, staffId: m.id, name: personName(m), email: m.email });
