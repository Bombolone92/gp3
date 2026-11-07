/** Command palette: search records and jump anywhere. Opens with / or Ctrl+K. */
import { h, uniqueId, debounce } from './dom.js';
import { icon } from './icons.js';
import { openDialog } from './dialog.js';
import { app } from '../app.js';
import { createSearchIndex } from '../core/search.js';
import { normalize } from '../core/format.js';
import { navigate } from './router.js';
import { createActions } from '../views/create.js';

let index = null;

const JUMPS = [
  { label: 'Dashboard', href: '#/', icon: 'dashboard' },
  { label: 'Calendar', href: '#/calendar', icon: 'calendar' },
  { label: 'Tasks', href: '#/tasks', icon: 'list-checks' },
  { label: 'Matters', href: '#/matters', icon: 'briefcase' },
  { label: 'Matter stages board', href: '#/matters/stages', icon: 'kanban' },
  { label: 'Contacts', href: '#/contacts', icon: 'contact' },
  { label: 'Activities', href: '#/activities', icon: 'clock' },
  { label: 'Billing', href: '#/billing', icon: 'receipt-text' },
  { label: 'Outstanding balances', href: '#/billing/outstanding', icon: 'coins' },
  { label: 'Accounts and trust', href: '#/accounts', icon: 'landmark' },
  { label: 'Documents', href: '#/documents', icon: 'folder' },
  { label: 'Document templates', href: '#/documents/templates', icon: 'wand' },
  { label: 'Communications', href: '#/communications', icon: 'messages' },
  { label: 'Reports', href: '#/reports', icon: 'chart' },
  { label: 'Settings', href: '#/settings', icon: 'settings' },
  { label: 'Firm users', href: '#/settings/users', icon: 'users' },
  { label: 'Practice areas and stages', href: '#/settings/practice', icon: 'scale' },
  { label: 'Task lists', href: '#/settings/tasks', icon: 'list-todo' },
];

export function openSearch(initial = '') {
  if (document.querySelector('dialog.palette')) return;
  index ??= createSearchIndex(app.store);
  const listId = uniqueId('results');
  const input = h('input.input', {
    type: 'search',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    'aria-label': 'Search',
    placeholder: 'Search matters, contacts, bills, documents, or jump to a page',
    autocomplete: 'off',
    spellcheck: 'false',
    value: initial,
  });
  const results = h('div.palette-results', { id: listId, role: 'listbox', 'aria-label': 'Results' });
  const live = h('div.sr-only', { role: 'status', 'aria-live': 'polite' });
  let options = [];
  let active = 0;
  let renderedFor = null;

  const api = openDialog({
    label: 'Search',
    size: 'wide',
    cls: 'palette',
    body: () => h('div.palette-body', h('div.input-affix.palette-input', icon('search', 18), input, h('kbd.palette-esc', 'Esc')), results, live),
  });

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
    renderedFor = input.value;
    const q = input.value.trim();
    options = [];
    results.replaceChildren();
    const groups = q ? index(q) : [];
    let count = 0;
    for (const g of groups) {
      results.append(h('div.palette-group', { role: 'presentation' }, g.label, g.total > g.items.length ? h('span.subtle', ` ${g.total}`) : null));
      for (const it of g.items) {
        results.append(option({ ...it, ic: g.icon }));
        count++;
      }
    }
    const nq = normalize(q);
    const creates = createActions().filter((a) => a.label && (!nq || normalize(`new ${a.label} create`).includes(nq)));
    const jumps = JUMPS.filter((j) => !nq || normalize(j.label).includes(nq));
    if (creates.length && (q || !groups.length)) {
      results.append(h('div.palette-group', { role: 'presentation' }, 'Create'));
      for (const a of creates.slice(0, q ? 4 : 6)) results.append(option({ title: `New ${a.label.toLowerCase()}`, ic: a.icon, run: a.run }));
    }
    if (jumps.length) {
      results.append(h('div.palette-group', { role: 'presentation' }, 'Go to'));
      for (const j of jumps.slice(0, q ? 5 : 18)) results.append(option({ title: j.label, href: j.href, ic: j.icon }));
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

  const rerender = debounce(render, 50);
  input.addEventListener('input', rerender);
  input.addEventListener('keydown', (e) => {
    // Keys pressed right after typing act on results for what was typed.
    if ((e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') && input.value !== renderedFor) {
      rerender.cancel();
      render();
    }
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
      // A search field would otherwise only clear itself on the first Escape.
      e.preventDefault();
      api.close();
    }
  });
  render();
  input.focus();
}
