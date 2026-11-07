/** Command palette: find a child, family member, staff member, or room, or jump anywhere. Opens with / or Ctrl+K. */
import { h, uniqueId, debounce } from './dom.js';
import { icon } from './icons.js';
import { openDialog } from './dialog.js';
import { app, isFamily, isManager, myStudents } from '../app.js';
import { normalize, personName } from '../core/format.js';
import { navigate } from './router.js';
import { createActions } from '../views/create.js';

function jumps() {
  if (isFamily())
    return [
      { label: 'Today', href: '#/', icon: 'home' },
      { label: 'Messages', href: '#/messages', icon: 'messages' },
      { label: 'Calendar', href: '#/calendar', icon: 'calendar-days' },
      { label: 'Menus', href: '#/menus', icon: 'utensils' },
      { label: 'Billing', href: '#/billing', icon: 'wallet' },
      { label: 'Settings', href: '#/settings', icon: 'settings' },
    ];
  return [
    { label: 'Home', href: '#/', icon: 'home' },
    { label: 'Check-in', href: '#/attendance', icon: 'user-check' },
    { label: 'Check-in kiosk', href: '#/kiosk', icon: 'tablet' },
    { label: 'Activities', href: '#/activities', icon: 'notebook-pen' },
    { label: 'Messages', href: '#/messages', icon: 'messages' },
    { label: 'Children', href: '#/children', icon: 'baby' },
    { label: 'Families', href: '#/families', icon: 'users' },
    { label: 'Rooms', href: '#/rooms', icon: 'door-open' },
    { label: 'Staff', href: '#/staff', icon: 'id-card' },
    { label: 'Calendar', href: '#/calendar', icon: 'calendar-days' },
    { label: 'Menus', href: '#/menus', icon: 'utensils' },
    ...(isManager() ? [{ label: 'Billing', href: '#/billing', icon: 'wallet' }] : []),
    { label: 'Reports', href: '#/reports', icon: 'chart' },
    { label: 'Settings', href: '#/settings', icon: 'settings' },
    { label: 'Staff and family access', href: '#/settings/access', icon: 'key' },
  ];
}

/** Matching records grouped by kind. */
export function searchRecords(store, query, { limit = 6 } = {}) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hit = (text) => {
    const s = normalize(text);
    return terms.every((t) => s.includes(t));
  };
  const groups = [];
  const add = (label, ic, items) => items.length && groups.push({ label, icon: ic, total: items.length, items: items.slice(0, limit) });
  const roomName = (id) => store.get('rooms', id)?.name || '';
  add(
    'Children',
    'baby',
    myStudents()
      .filter((s) => hit(`${personName(s, { preferred: false })} ${s.preferredName || ''} ${roomName(s.roomId)}`))
      .map((s) => ({ title: personName(s), sub: [roomName(s.roomId), s.status !== 'active' ? s.status : ''].filter(Boolean).join(' · '), href: `#/children/${s.id}` })),
  );
  if (isFamily()) return groups;
  add(
    'Families',
    'users',
    store
      .all('guardians')
      .filter((g) => hit(`${personName(g)} ${g.email || ''} ${g.phone || ''}`))
      .map((g) => {
        const kids = (g.studentIds || []).map((id) => store.get('students', id)).filter(Boolean);
        return { title: personName(g), sub: [g.relation, kids.map((k) => personName(k)).join(', ')].filter(Boolean).join(' of '), href: kids[0] ? `#/children/${kids[0].id}?tab=family` : '#/families' };
      }),
  );
  add(
    'Staff',
    'id-card',
    store
      .all('staff')
      .filter((m) => hit(`${personName(m)} ${m.title || ''} ${m.email || ''}`))
      .map((m) => ({ title: personName(m), sub: m.title || '', href: `#/staff/${m.id}` })),
  );
  add(
    'Rooms',
    'door-open',
    store
      .all('rooms')
      .filter((r) => hit(r.name))
      .map((r) => ({ title: r.name, sub: r.ageRange || '', href: `#/rooms/${r.id}` })),
  );
  return groups;
}

export function openSearch(initial = '') {
  if (document.querySelector('dialog.palette')) return;
  const listId = uniqueId('results');
  const input = h('input.input', {
    type: 'search',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    'aria-label': 'Search',
    placeholder: isFamily() ? 'Search or jump to a page' : 'Search children, families, staff, rooms, or jump to a page',
    autocomplete: 'off',
    spellcheck: 'false',
    value: initial,
  });
  const results = h('div.palette-results', { id: listId, role: 'listbox', 'aria-label': 'Results' });
  const live = h('div.sr-only', { role: 'status', 'aria-live': 'polite' });
  let options = [];
  let active = 0;

  const api = openDialog({
    label: 'Search',
    size: 'wide',
    body: () => h('div.palette', h('div.input-affix.palette-input', icon('search', 18), input), results, live),
  });
  api.dialog.classList.add('palette');

  function option({ title, sub, href, ic, run }) {
    const id = uniqueId('opt');
    const node = h(
      'div.palette-option',
      { role: 'option', id, 'aria-selected': 'false' },
      h('span.palette-icon', icon(ic, 16)),
      h('span.grow.truncate', h('span.palette-title', title), sub ? h('span.palette-sub', sub) : null),
      icon('arrow-right', 15, 'palette-go'),
    );
    const activate = () => {
      api.close();
      if (run) run();
      else navigate(href.slice(1));
    };
    node.addEventListener('click', activate);
    node.addEventListener('mousemove', () => setActive(options.findIndex((o) => o.node === node)));
    options.push({ node, activate });
    return node;
  }

  function render() {
    const q = input.value.trim();
    options = [];
    results.replaceChildren();
    const groups = q ? searchRecords(app.store, q) : [];
    let count = 0;
    for (const g of groups) {
      results.append(h('div.palette-group', { role: 'presentation' }, g.label, g.total > g.items.length ? h('span.subtle', ` (${g.total})`) : null));
      for (const it of g.items) {
        results.append(option({ ...it, ic: g.icon }));
        count++;
      }
    }
    const nq = normalize(q);
    const js = jumps().filter((j) => !nq || normalize(j.label).includes(nq));
    const creates = createActions().filter((a) => !a.separator && (!nq || normalize(a.label).includes(nq)));
    if (creates.length && (q || !groups.length)) {
      results.append(h('div.palette-group', { role: 'presentation' }, 'Log or add'));
      for (const a of creates.slice(0, q ? 4 : 6)) results.append(option({ title: a.label, ic: a.icon, run: a.run }));
    }
    if (js.length) {
      results.append(h('div.palette-group', { role: 'presentation' }, 'Go to'));
      for (const j of js.slice(0, q ? 5 : 16)) results.append(option({ title: j.label, href: j.href, ic: j.icon }));
    }
    if (!options.length) results.append(h('div.palette-empty', `No results for "${q}"`));
    live.textContent = q ? `${count} matching records` : '';
    setActive(0);
  }

  function setActive(i) {
    if (options[active]) options[active].node.setAttribute('aria-selected', 'false');
    active = Math.max(0, Math.min(options.length - 1, i));
    const o = options[active];
    if (o) {
      o.node.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', o.node.id);
      o.node.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  input.addEventListener('input', debounce(render, 60));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      options[active]?.activate();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      api.close();
    }
  });
  render();
  input.focus();
}
