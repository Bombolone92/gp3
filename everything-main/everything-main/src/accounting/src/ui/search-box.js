/** The top-bar search: type to find transactions, contacts, accounts, reports, and pages. */
import { el, debounce, nextId } from './dom.js';
import { icon } from './icons.js';
import { navigate } from './router.js';
import { search } from '../lib/search.js';
import { store } from '../lib/store.js';
import { formatMoney } from '../lib/money.js';

const KIND_ICON = { txn: 'invoice', contact: 'user', account: 'bank', item: 'item', report: 'reports', page: 'arrowR', create: 'plus' };

export function mountSearch() {
  const listId = nextId('search-list');
  const input = el('input.search-input', {
    type: 'search', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': listId, 'aria-autocomplete': 'list',
    'aria-label': 'Search', placeholder: 'Navigate. Find transactions, contacts, reports, and more.', autocomplete: 'off', spellcheck: false,
  });
  const results = el('div.search-results', { id: listId, role: 'listbox', 'aria-label': 'Search results', hidden: true });
  const root = el('div.topbar-search', { role: 'search' },
    el('span.search-ico', { html: icon('search', 18) }),
    input,
    el('kbd.search-kbd.hide-mobile', { 'aria-hidden': 'true' }, '/'),
    results);
  let flat = [];
  let active = -1;
  let painted = null; // the text the results were found for
  let closeCb = () => {};

  function close() {
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
    painted = null;
  }

  function pick(item) {
    close();
    input.value = '';
    input.blur();
    closeCb();
    navigate(item.route);
  }

  function paint() {
    painted = input.value;
    const groups = search(store, input.value);
    results.replaceChildren();
    flat = [];
    if (!input.value.trim()) { close(); return; }
    if (!groups.length) {
      results.append(el('div.combo-empty', {}, `No results for "${input.value.trim()}"`));
    }
    for (const g of groups) {
      const gid = nextId('sg');
      const group = el('div', { role: 'group', 'aria-labelledby': gid }, el('div.combo-group', { id: gid }, g.group));
      for (const item of g.items) {
        const i = flat.length;
        flat.push(item);
        const opt = el('div.result', { role: 'option', id: `${listId}-${i}`, 'aria-selected': 'false' },
          el('span.result-ico', { html: icon(KIND_ICON[item.kind] || 'arrowR', 15) }),
          el('span.grow.truncate', {}, el('div.truncate', {}, item.label), item.sub && el('div.result-sub.truncate', {}, item.sub)),
          item.amount !== undefined && el('span.money', {}, formatMoney(item.amount)));
        opt.addEventListener('mousedown', (e) => { e.preventDefault(); pick(item); });
        group.append(opt);
      }
      results.append(group);
    }
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = flat.length ? 0 : -1;
    mark();
  }

  function mark() {
    results.querySelectorAll('.result').forEach((n, i) => n.setAttribute('aria-selected', String(i === active)));
    const node = results.querySelector(`#${CSS.escape(`${listId}-${active}`)}`);
    if (node) { input.setAttribute('aria-activedescendant', node.id); node.scrollIntoView({ block: 'nearest' }); }
  }

  const run = debounce(paint, 90);
  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (input.value.trim()) paint(); });
  input.addEventListener('keydown', (e) => {
    // Results are found a moment after typing stops; a key that acts on them
    // (Enter right after typing, an arrow) finds them for the current text first.
    if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key) && input.value !== painted && input.value.trim()) paint();
    if (e.key === 'ArrowDown' && flat.length) { e.preventDefault(); active = (active + 1) % flat.length; mark(); }
    else if (e.key === 'ArrowUp' && flat.length) { e.preventDefault(); active = (active - 1 + flat.length) % flat.length; mark(); }
    else if (e.key === 'Enter' && active >= 0 && flat[active]) { e.preventDefault(); pick(flat[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); input.value = ''; close(); input.blur(); closeCb(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { close(); if (!input.value) closeCb(); }, 150));

  return {
    root,
    focus() { input.focus(); input.select(); },
    onClose(fn) { closeCb = fn; },
  };
}
