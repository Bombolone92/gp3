/** Page scaffolding shared by every view. */
import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openMenu } from '../ui/menu.js';
import { href } from '../ui/router.js';

/** Header with breadcrumbs, the page title (focused on navigation), and actions. */
export function pageHead({ title, crumbs = [], actions = [], sub = null }) {
  return el('div.page-top', {},
    crumbs.length ? el('nav.crumbs', { 'aria-label': 'Breadcrumb' }, crumbs.map(([label, to], i) => [
      to ? el('a', { href: href(to) }, label) : el('span', {}, label),
      i < crumbs.length - 1 ? el('span', { 'aria-hidden': 'true' }, '/') : null,
    ])) : null,
    el('div.page-head', {},
      el('h1.page-title', { tabIndex: -1 }, title),
      sub,
      actions.length ? el('div.page-actions', {}, actions) : null));
}

/** A primary button with a caret menu of alternatives, like "New transaction". */
export function splitButton(label, onClick, items, { primary = true } = {}) {
  const main = el(`button.btn${primary ? '.btn-primary' : ''}`, { type: 'button', onclick: onClick }, label);
  const caret = el(`button.btn${primary ? '.btn-primary' : ''}`, { type: 'button', 'aria-label': `More ${label.toLowerCase()} options`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', html: icon('chevDown', 16) });
  caret.addEventListener('click', () => openMenu(caret, items, { align: 'end' }));
  return el('div.split', {}, main, caret);
}

/** A button that opens a menu. */
export function menuButton(label, items, { className = 'btn', iconName = 'chevDown', ariaLabel = null } = {}) {
  const b = el(`button.${className.split(' ').join('.')}`, { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': ariaLabel }, label, iconName ? el('span', { html: icon(iconName, 16) }) : null);
  b.addEventListener('click', () => openMenu(b, typeof items === 'function' ? items() : items, { align: 'end' }));
  return b;
}

export function iconButton(name, label, onClick, opts = {}) {
  return el('button.icon-btn', { type: 'button', 'aria-label': label, title: label, html: icon(name, opts.size || 18), onclick: onClick });
}

export function searchBox({ value = '', placeholder = 'Search', onInput, label = 'Search' }) {
  const input = el('input.input', { type: 'search', value, placeholder, 'aria-label': label });
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => onInput(input.value), 120); });
  return el('div.search-box', {}, el('span', { html: icon('search', 16) }), input);
}

export function emptyState({ iconName = 'inbox', title, text, action = null }) {
  return el('div.empty', {},
    el('div.empty-icon', { html: icon(iconName, 26) }),
    el('h2', {}, title),
    text ? el('p', {}, text) : null,
    action);
}

/** Tabs that update the URL query and re-render. */
export function tabs(items, active, onSelect, { label = 'Views' } = {}) {
  const list = el('div.tabs', { role: 'tablist', 'aria-label': label });
  items.forEach(([key, text, count]) => {
    const b = el('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(key === active), tabIndex: key === active ? 0 : -1, dataset: { key } }, text, count !== undefined && count !== null ? el('span.count', {}, `(${count})`) : null);
    b.addEventListener('click', () => onSelect(key));
    b.addEventListener('keydown', (e) => {
      const i = items.findIndex((x) => x[0] === key);
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      const next = items[(to + items.length) % items.length][0];
      onSelect(next, true);
      // The page re-renders with a new tab list: keep focus on the selected tab.
      document.querySelector(`[role="tablist"][aria-label="${CSS.escape(label)}"] [data-key="${CSS.escape(next)}"]`)?.focus();
    });
    list.append(b);
  });
  return list;
}

/**
 * The query of a route the first time it is rendered, and {} after. A link
 * like #/report/gl?accounts=1 sets a filter once; the page re-renders on every
 * change to the books with the same route, and must not put the filter back
 * after the user has changed it.
 */
const seenRoutes = new WeakSet();
export function freshQuery(route) {
  if (!route || seenRoutes.has(route)) return {};
  seenRoutes.add(route);
  return route.query || {};
}

/**
 * Unsaved input on a page (a form not yet saved), kept for as long as the
 * user stays on the page. A page re-renders on every change to the books,
 * including changes from another tab or device; without this, whatever the
 * user had typed would be wiped. A new visit to the page starts afresh.
 */
const drafts = new WeakMap();
export function pageDraft(route, key, make) {
  if (!route) return make();
  let forRoute = drafts.get(route);
  if (!forRoute) drafts.set(route, (forRoute = new Map()));
  if (!forRoute.has(key)) forRoute.set(key, make());
  return forRoute.get(key);
}
export function clearDraft(route, key) {
  drafts.get(route)?.delete(key);
}

/** Keep per-view UI state (filters, tabs) across re-renders. */
const states = new Map();
export function viewState(key, defaults) {
  if (!states.has(key)) states.set(key, { ...defaults });
  return states.get(key);
}
