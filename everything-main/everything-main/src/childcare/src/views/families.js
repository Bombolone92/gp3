/** Families: every parent, guardian, and approved pickup, with their children and app access. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageHeader, chips, searchBox, dataTable, emptyState, field, textInput, textarea, select, pill } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { app, isManager } from '../app.js';
import { personName, matches, telHref, pluralize } from '../core/format.js';
import { RELATIONS, sortByName, newPin } from '../core/people.js';
import { guardianAvatar, childAvatar, rememberSort, saveSort } from './common.js';
import { inviteGuardian } from './invite.js';

const FILTERS = [
  { id: 'all', label: 'Everyone', match: () => true },
  { id: 'parents', label: 'Parents and guardians', match: (g) => !isPickupOnly(g) },
  { id: 'pickup', label: 'Approved pickups', match: (g) => isPickupOnly(g) },
  { id: 'app', label: 'Using the app', match: (g) => !!g.memberUuid },
  { id: 'noapp', label: 'Not invited', match: (g) => !g.memberUuid && !isPickupOnly(g) },
];

const isPickupOnly = (g) => !!g.pickupOnly;

export function render(ctx) {
  const store = app.store;
  let filter = FILTERS.some((f) => f.id === ctx.query.show) ? ctx.query.show : 'all';
  let q = '';
  let sort = rememberSort('families', { id: 'name', dir: 'asc' });

  const body = ctx.live(() => {
    const all = store.all('guardians');
    const active = new Set(store.all('students').filter((s) => s.status !== 'inactive' && s.status !== 'graduated').map((s) => s.id));
    const list = all.filter((g) => FILTERS.find((f) => f.id === filter).match(g) && matches(`${personName(g)} ${g.email || ''} ${g.phone || ''} ${(g.studentIds || []).map((id) => personName(store.get('students', id))).join(' ')}`, q));
    if (!all.length) return emptyState({ icon: 'users', title: 'No families yet', text: 'Add parents and guardians from a child\'s Family tab, or add one here.', actions: [h('button.btn.primary', { type: 'button', onClick: () => openGuardianForm() }, 'Add family member')] });
    const kids = (g) => (g.studentIds || []).map((id) => store.get('students', id)).filter(Boolean);
    return [
      h(
        'div.toolbar',
        chips({ label: 'Show', items: FILTERS.map((f) => ({ id: f.id, label: f.label, count: all.filter(f.match).length })), selected: filter, onSelect: (v) => ((filter = v), body.redraw()) }),
        h('span.grow'),
        searchBox({ value: q, placeholder: 'Search families', onInput: (v) => ((q = v), body.redraw()) }),
      ),
      dataTable({
        columns: [
          { id: 'name', label: 'Name', render: (g) => h('button.person-link.plain-btn', { type: 'button', onClick: () => openGuardianForm({ guardian: g }) }, guardianAvatar(g, { size: 'sm' }), h('span.person-text', h('span.person-name', personName(g)), h('span.person-sub', g.relation || ''))), sort: (g) => personName(g).toLowerCase() },
          { id: 'kids', label: 'Children', render: (g) => h('span.kid-links', kids(g).map((s) => h('a.person-link', { href: `#/children/${s.id}?tab=family` }, childAvatar(s, { size: 'xs' }), h('span', s.preferredName || s.firstName), !active.has(s.id) ? h('span.subtle.small', ' (former)') : null))), sort: (g) => personName(kids(g)[0]) },
          { id: 'phone', label: 'Phone', render: (g) => (g.phone ? h('a', { href: telHref(g.phone) }, g.phone) : h('span.subtle', '-')) },
          { id: 'email', label: 'Email', render: (g) => (g.email ? h('a.truncate', { href: `mailto:${g.email}` }, g.email) : h('span.subtle', '-')), cls: 'truncate-cell' },
          { id: 'roles', label: 'Can', render: (g) => h('span.flags', g.canPickup ? h('span.flag', 'Pick up') : null, g.emergency ? h('span.flag', 'Emergency') : null, g.billing ? h('span.flag', 'Billing') : null) },
          {
            id: 'app',
            label: 'Family app',
            render: (g) => (isPickupOnly(g) ? h('span.subtle', '-') : g.memberUuid ? pill('Signed up', 'success') : isManager() ? h('button.btn.sm', { type: 'button', onClick: () => inviteGuardian(g) }, icon('send', 14), 'Invite') : pill('Not invited', 'plain')),
            sort: (g) => (g.memberUuid ? 0 : 1),
          },
        ],
        rows: list,
        sort,
        onSort: (s) => ((sort = s), saveSort('families', s), body.redraw()),
        caption: 'Families',
        mobile: (g) => h('button.list-item.plain-btn', { type: 'button', onClick: () => openGuardianForm({ guardian: g }) }, guardianAvatar(g), h('span.grow', h('span.title', personName(g)), h('span.meta', [g.relation, kids(g).map((s) => s.firstName).join(', ')].filter(Boolean).join(' · '))), g.memberUuid ? pill('App', 'success') : null),
        empty: emptyState({ icon: 'search', title: 'Nobody matches', compact: true }),
      }),
      h('p.subtle.small.list-foot', pluralize(list.length, 'person', 'people')),
    ];
  }, ['guardians', 'students']);

  return h('div.page', pageHeader({ title: 'Families', actions: [h('button.btn.primary', { type: 'button', onClick: () => openGuardianForm() }, icon('user-plus', 16), 'Add family member')] }), body);
}

/**
 * Add or edit a family member or approved pickup.
 * opts: { guardian, studentIds, relation, pickupOnly }
 */
export function openGuardianForm({ guardian = null, studentIds = [], relation = 'Mother', pickupOnly = false } = {}) {
  const store = app.store;
  const g = structuredClone(guardian || { firstName: '', lastName: '', relation, phone: '', email: '', studentIds, canPickup: true, emergency: !pickupOnly, primary: false, billing: !pickupOnly, pickupOnly });
  const taken = () => [...store.all('guardians'), ...store.all('staff')].map((x) => x.pin);
  if (!g.pin) g.pin = newPin(taken());
  if (!guardian && !g.lastName && studentIds[0] && !pickupOnly) g.lastName = store.get('students', studentIds[0])?.lastName || '';
  const kids = new Set(g.studentIds || []);
  // Which children a family member who uses the app sees is the director's
  // or an admin's call; the school server keeps the list as it is for staff.
  const kidsLocked = !!guardian?.memberUuid && !isManager();
  const inp = (k, opts = {}) => {
    const i = textInput({ value: g[k] || '', ...opts });
    i.addEventListener('input', () => (g[k] = i.value));
    return i;
  };
  const rel = select({ options: RELATIONS, value: RELATIONS.includes(g.relation) ? g.relation : 'Other' });
  rel.addEventListener('change', () => (g.relation = rel.value));
  const flag = (k, label, hint) => {
    const c = h('input', { type: 'checkbox', checked: !!g[k], onChange: () => (g[k] = c.checked) });
    return h('label.check', c, h('span', label, hint ? h('span.hint', ` ${hint}`) : null));
  };
  const kidList = h(
    'div.kid-check-list',
    sortByName(store.all('students').filter((s) => s.status !== 'graduated' && s.status !== 'inactive')).map((s) => {
      const c = h('input', { type: 'checkbox', checked: kids.has(s.id), disabled: kidsLocked || null, onChange: () => (c.checked ? kids.add(s.id) : kids.delete(s.id)) });
      return h('label.check', c, childAvatar(s, { size: 'xs' }), h('span', personName(s)));
    }),
  );
  const pinOut = h('strong.pin', g.pin);
  const first = inp('firstName', { required: true });

  openDialog({
    title: guardian ? personName(guardian) : pickupOnly ? 'Add an approved pickup' : 'Add a family member',
    size: 'wide',
    body: h(
      'div.stack',
      h('div.form-grid', field('First name', first, { required: true }), field('Last name', inp('lastName')), field('Relationship', rel), field('Phone', inp('phone', { type: 'tel' })), field('Email', inp('email', { type: 'email' }), { span2: true, hint: 'Used to send the family app invitation.' })),
      h('div.field', h('span.field-label', 'Children'), kidList, kidsLocked ? h('span.hint', `${personName(guardian)} uses the family app, so only the director or an admin can change their children.`) : null),
      h('div.check-grid', flag('canPickup', 'Can pick up'), flag('emergency', 'Emergency contact'), !g.pickupOnly ? flag('primary', 'Primary contact') : null, !g.pickupOnly ? flag('billing', 'Receives statements') : null),
      h('div.field', h('span.field-label', 'Kiosk PIN'), h('div.row', pinOut, h('button.btn.sm.ghost', { type: 'button', onClick: () => ((g.pin = newPin(taken())), (pinOut.textContent = g.pin)) }, icon('refresh', 14), 'New PIN')), h('span.hint', 'Used to check children in and out on the kiosk.')),
      field('Notes', (() => {
        const t = textarea({ value: g.notes || '', rows: 2, placeholder: 'Custody notes, language, best time to reach' });
        t.addEventListener('input', () => (g.notes = t.value));
        return t;
      })()),
    ),
    footer: ({ close }) => [
      guardian && !kidsLocked
        ? h(
            'button.btn.ghost.danger-text',
            {
              type: 'button',
              onClick: async () => {
                if (!(await confirmDialog({ title: `Remove ${personName(guardian)}?`, message: 'They are removed from every child they are linked to. If they use the family app, remove their access in Settings too.', confirmLabel: 'Remove', danger: true }))) return;
                store.remove('guardians', guardian.id);
                toast(`${personName(guardian)} removed`);
                close();
              },
            },
            icon('trash', 16),
            'Remove',
          )
        : null,
      guardian && !guardian.memberUuid && !guardian.pickupOnly && isManager() ? h('button.btn', { type: 'button', onClick: () => inviteGuardian(guardian) }, icon('send', 16), 'Invite to app') : null,
      h('span.spacer'),
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            if (!g.firstName.trim()) {
              first.setAttribute('aria-invalid', 'true');
              first.focus();
              return;
            }
            const saved = store.put('guardians', { ...g, firstName: g.firstName.trim(), lastName: (g.lastName || '').trim(), email: (g.email || '').trim(), phone: (g.phone || '').trim(), studentIds: [...kids] });
            toast(guardian ? 'Changes saved' : `${personName(saved)} added`);
            close();
          },
        },
        guardian ? 'Save' : 'Add',
      ),
    ],
  });
}

/** Link a family member who is already on file (a sibling's parent) to this child. */
export function linkExisting(child) {
  const store = app.store;
  // Staff cannot add a child to a family member who uses the app (see openGuardianForm).
  const list = sortByName(store.all('guardians').filter((g) => !(g.studentIds || []).includes(child.id) && (!g.memberUuid || isManager())));
  if (!list.length) return toast('Nobody else on file yet.', { type: 'info' });
  let q = '';
  const results = h('ul.list.link-list');
  const draw = () =>
    results.replaceChildren(
      ...list
        .filter((g) => matches(personName(g), q))
        .slice(0, 40)
        .map((g) =>
          h(
            'li',
            h(
              'button.list-item.plain-btn',
              {
                type: 'button',
                onClick: () => {
                  store.patch('guardians', g.id, { studentIds: [...(g.studentIds || []), child.id] });
                  toast(`${personName(g)} linked`);
                  api.close();
                },
              },
              guardianAvatar(g),
              h('span.grow', h('span.title', personName(g)), h('span.meta', (g.studentIds || []).map((id) => personName(store.get('students', id))).join(', '))),
              icon('link', 16),
            ),
          ),
        ),
    );
  const api = openDialog({ title: 'Link a family member', body: h('div.stack', searchBox({ placeholder: 'Search by name', onInput: (v) => ((q = v), draw()) }), results) });
  draw();
}
