/** Command palette: search records and jump anywhere. Opens with / or Ctrl+K. */
import { h, uniqueId, debounce } from './dom.js';
import { icon } from './icons.js';
import { openDialog } from './dialog.js';
import { app } from '../app.js';
import { createSearchIndex } from '../core/search.js';
import { normalize } from '../core/format.js';
import { navigate } from './router.js';
import { createActions } from '../views/create.js';
import { NAV } from './shell.js';
import { canEdit } from '../app.js';

let index = null;

// Built lazily: shell.js and this module import each other.
const JUMPS = () => [
  ...NAV.flatMap((n) => (n.children ? n.children.map((c) => ({ label: c.label, href: c.href, icon: n.icon })) : [{ label: n.label, href: n.href, icon: n.icon }])),
  { label: 'Settings', href: '#/settings', icon: 'settings' },
  { label: 'Team access', href: '#/settings/team', icon: 'users' },
  { label: 'Vehicle statuses and types', href: '#/settings/vehicles', icon: 'truck' },
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
    placeholder: 'Search vehicles, issues, work orders, parts, contacts, or jump to a page',
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
    const jumps = JUMPS().filter((j) => !nq || normalize(j.label).includes(nq));
    const creates = createActions().filter((a) => canEdit(a.coll) && (!nq || normalize(`add new ${a.label}`).includes(nq)));
    if (creates.length && (q || !groups.length)) {
      results.append(h('div.palette-group', { role: 'presentation' }, 'Add new'));
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
    }
  }

  const renderSoon = debounce(render, 60);
  let rendered = input.value;
  input.addEventListener('input', renderSoon);
  input.addEventListener('keydown', (e) => {
    // Keys that drive an IME (Japanese, Chinese, Korean) belong to it.
    if (e.isComposing || e.keyCode === 229) return;
    // Typed faster than the results refresh: act on the current text.
    if ((e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') && input.value !== rendered) {
      renderSoon.cancel();
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
      // A search field would only clear itself on the first Escape.
      e.preventDefault();
      api.close();
    }
  });
  render();
  input.focus();
}
