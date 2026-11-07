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
  { label: 'Home', href: '#/', icon: 'home' },
  { label: 'Schedule', href: '#/schedule', icon: 'calendar-days' },
  { label: 'Clients', href: '#/clients', icon: 'users' },
  { label: 'Requests', href: '#/requests', icon: 'inbox' },
  { label: 'Quotes', href: '#/quotes', icon: 'file-pen' },
  { label: 'Jobs', href: '#/jobs', icon: 'hammer' },
  { label: 'Invoices', href: '#/invoices', icon: 'receipt-text' },
  { label: 'Payments', href: '#/payments', icon: 'wallet' },
  { label: 'Timesheets', href: '#/timesheets', icon: 'clock' },
  { label: 'Expenses', href: '#/expenses', icon: 'receipt' },
  { label: 'Reports', href: '#/reports', icon: 'chart' },
  { label: 'Settings', href: '#/settings', icon: 'settings' },
  { label: 'Products and services', href: '#/settings/products', icon: 'package' },
  { label: 'Team', href: '#/settings/team', icon: 'users' },
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
    placeholder: 'Search clients, jobs, quotes, invoices, or jump to a page',
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
    rendered = input.value;
    const q = input.value.trim();
    options = [];
    results.replaceChildren();
    const groups = q ? index(q) : [];
    let count = 0;
    for (const g of groups) {
      results.append(h('div.palette-group', { role: 'presentation' }, g.label, g.total > g.items.length ? h('span.subtle', ` (${g.total})`) : null));
      for (const it of g.items) {
        results.append(option({ ...it, ic: g.icon }));
        count++;
      }
    }
    const nq = normalize(q);
    const jumps = JUMPS.filter((j) => !nq || normalize(j.label).includes(nq));
    const creates = createActions().filter((a) => !nq || normalize(a.label).includes(nq));
    if (creates.length && (q || !groups.length)) {
      results.append(h('div.palette-group', { role: 'presentation' }, 'Create'));
      for (const a of creates.slice(0, q ? 4 : 8)) results.append(option({ title: a.label, ic: a.icon, run: a.run }));
    }
    if (jumps.length) {
      results.append(h('div.palette-group', { role: 'presentation' }, 'Go to'));
      for (const j of jumps.slice(0, q ? 5 : 14)) results.append(option({ title: j.label, href: j.href, ic: j.icon }));
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
    } else input.removeAttribute('aria-activedescendant'); // No results: nothing to point at.
  }

  let rendered = null; // the text the shown results are for
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
      // Typed or pasted a moment ago: act on results for what is there now.
      if (rendered !== input.value) render();
      options[active]?.activate();
    } else if (e.key === 'Escape') {
      // A search field would only clear itself on the first Escape.
      e.preventDefault();
      api.close();
    }
  });
  render();
  input.focus();
}
