/**
 * Hash router. Routes are patterns like '/clients/:id'. The current route
 * is exposed as { path, params, query, name }.
 */
const routes = [];
const listeners = new Set();
let current = null;
// How many app pages this tab has behind the current one, kept on each
// history entry, so going back can tell whether it would leave the app.
let depth = 0;

export function route(pattern, name) {
  const keys = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => {
        keys.push(k);
        return '/([^/]+)';
      }) +
      '/?$',
  );
  routes.push({ pattern, name, re, keys });
}

export function parse(hash) {
  const raw = (hash || '').replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = {};
      try {
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      } catch {
        // A hand-edited or truncated link like #/vehicles/%E0 is not a page.
        break;
      }
      return { path, params, query, name: r.name };
    }
  }
  return { path, params: {}, query, name: 'not-found' };
}

export function navigate(path, { replace = false } = {}) {
  const hash = path.startsWith('#') ? path : `#${path}`;
  if (replace) {
    history.replaceState(history.state, '', hash);
    handle();
  } else if (location.hash === hash) {
    handle();
  } else {
    location.hash = hash;
  }
}

/** Update the query string without re-rendering the view. */
export function setQuery(patch) {
  const r = current || parse(location.hash);
  const q = { ...r.query, ...patch };
  for (const k of Object.keys(q)) if (q[k] === '' || q[k] === null || q[k] === undefined) delete q[k];
  const qs = new URLSearchParams(q).toString();
  history.replaceState(history.state, '', `#${r.path}${qs ? '?' + qs : ''}`);
  current = { ...r, query: q };
}

export function currentRoute() {
  return current || parse(location.hash);
}

export function onRoute(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function handle() {
  const d = history.state?.fleetDepth;
  if (Number.isInteger(d)) depth = d;
  else {
    // A new entry: one deeper than the page it came from, or the first.
    depth = current ? depth + 1 : 0;
    history.replaceState({ ...history.state, fleetDepth: depth }, '');
  }
  current = parse(location.hash);
  for (const fn of listeners) fn(current);
}

export function startRouter() {
  window.addEventListener('hashchange', handle);
  handle();
}

/**
 * Go back to the previous app page, or to `fallback` when there is none
 * (the page was opened from a link or in a new tab), so the app is never
 * left by accident.
 */
export function back(fallback) {
  if (depth > 0) history.back();
  else navigate(fallback);
}
