/**
 * Hash router. Routes are "name/param?query". Pages render into the main
 * outlet; transaction forms open as overlays above whatever page is there.
 */
const routes = new Map();
const overlays = new Map();
let current = null;
let onRender = null;

export function route(name, render) {
  routes.set(name, render);
}

export function overlay(name, open) {
  overlays.set(name, open);
}

/** A malformed escape (a link cut off mid "%E2%80") is kept as typed, not thrown. */
function decode(part) {
  try { return decodeURIComponent(part); } catch { return part; }
}

export function parse(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decode);
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return { name: parts[0] || 'home', params: parts.slice(1), query, path: raw || 'home' };
}

export function href(path) {
  return `#/${path}`;
}

export function navigate(path, { replace = false } = {}) {
  const target = `#/${path}`;
  // A form is a layer over the page, not a page: opening one from the app adds
  // no history entry, so Back is not spent on an address that never changes.
  const r = parse(target);
  if (current && overlays.has(r.name)) { overlays.get(r.name)(r.params, r.query); return; }
  if (location.hash === target) { render(); return; }
  if (replace) {
    history.replaceState(null, '', target);
    render();
  } else location.hash = target;
}

export function currentRoute() {
  return current;
}

/** Update the query string of the current page without re-rendering. */
export function setQuery(patch) {
  const r = parse();
  const q = { ...r.query, ...patch };
  for (const k of Object.keys(q)) if (q[k] === null || q[k] === undefined || q[k] === '') delete q[k];
  const qs = new URLSearchParams(q).toString();
  history.replaceState(null, '', `#/${r.name}${r.params.length ? `/${r.params.map(encodeURIComponent).join('/')}` : ''}${qs ? `?${qs}` : ''}`);
  if (current) current.query = q;
}

function render() {
  const r = parse();
  if (overlays.has(r.name)) {
    const base = current || { name: 'home', params: [], query: {}, path: 'home' };
    // Put the address back to the page underneath; the overlay is a layer, not a page.
    history.replaceState(null, '', `#/${base.path}`);
    if (!current) onRender?.(base, routes.get(base.name) || routes.get('home'));
    current = base;
    overlays.get(r.name)(r.params, r.query);
    return;
  }
  const view = routes.get(r.name) || routes.get('notfound');
  current = r;
  onRender?.(r, view);
}

export function startRouter(renderPage) {
  onRender = renderPage;
  window.addEventListener('hashchange', render);
  render();
}

export function rerender() {
  if (current) onRender?.(current, routes.get(current.name) || routes.get('notfound'), { refresh: true });
}
