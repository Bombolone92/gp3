/**
 * Hash router. Routes are patterns like '/leases/:id'. The current route
 * is exposed as { path, params, query, name }.
 */
const routes = [];
const listeners = new Set();
let current = null;

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
      // A malformed escape (a mistyped or cut-off link) is a page that does
      // not exist, not a crash that stops the app from starting.
      try {
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      } catch {
        return { path, params: {}, query, name: 'not-found' };
      }
      return { path, params, query, name: r.name };
    }
  }
  return { path, params: {}, query, name: 'not-found' };
}

export function navigate(path, { replace = false } = {}) {
  const hash = path.startsWith('#') ? path : `#${path}`;
  if (replace) {
    history.replaceState(null, '', hash);
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
  history.replaceState(null, '', `#${r.path}${qs ? '?' + qs : ''}`);
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
  current = parse(location.hash);
  for (const fn of listeners) fn(current);
}

export function startRouter() {
  window.addEventListener('hashchange', handle);
  handle();
}

export function back(fallback) {
  if (history.length > 1 && document.referrer !== '' ) history.back();
  else navigate(fallback);
}
