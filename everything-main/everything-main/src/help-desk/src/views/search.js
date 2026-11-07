/**
 * Search across tickets, customers, organizations and help articles. It
 * runs on the local copy, so results update as you type. Ticket searches
 * accept filters such as status:open or assignee:me.
 */
import './search.css';
import { h, clear, uid, debounce, announce, composing } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { statusBadge, avatar } from '../ui/components.js';
import { relTime, fullDate, plural } from '../ui/format.js';
import { go } from '../ui/router.js';
import { bind } from '../ui/shortcuts.js';
import { app } from '../app.js';
import { searchTickets, searchUsers, searchOrgs, searchArticles, parseQuery } from '../client/search.js';
import { orgMark, segmented } from './people-ui.js';

const RECENT_KEY = 'help-desk:recent-searches';
const TYPES = [
  { id: 'tickets', label: 'Tickets' },
  { id: 'customers', label: 'Customers' },
  { id: 'orgs', label: 'Organizations' },
  { id: 'articles', label: 'Articles' },
];

export const FILTER_HELP = [
  ['status:open', 'Status (new, open, pending, hold, solved, closed, unsolved)'],
  ['assignee:me', 'Assigned to you (or a name, or none)'],
  ['priority:urgent', 'Priority (low, normal, high, urgent)'],
  ['tag:billing', 'Has a tag'],
  ['requester:ana', 'Requester name or email'],
  ['org:acme', 'Organization'],
  ['type:incident', 'Type (question, incident, problem, task)'],
  ['via:email', 'Channel (email, portal, phone, web)'],
  ['#123', 'Ticket number'],
];

export function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function rememberSearch(q) {
  const v = String(q || '').trim();
  if (v.length < 2) return;
  const list = [v, ...loadRecent().filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function forget(q) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(loadRecent().filter((x) => x !== q)));
  } catch {
    /* ignore */
  }
}

/** Run every search for a query and return the result lists. */
export function runSearch(replica, q) {
  const text = q.trim();
  if (!text) return { tickets: [], customers: [], orgs: [], articles: [] };
  // Only real filters (status:open, #123) make it a ticket-only search.
  const parsed = parseQuery(text);
  const hasFilter = parsed.filters.length > 0 || !!parsed.id;
  return {
    tickets: searchTickets(replica, text, { limit: 300 }),
    customers: hasFilter ? [] : searchUsers(replica, text, 100),
    orgs: hasFilter ? [] : searchOrgs(replica, text, 100),
    articles: hasFilter ? [] : searchArticles(replica, text, 60),
  };
}

export function mount(main, { route }) {
  let query = route.query.q || '';
  let type = TYPES.some((t) => t.id === route.query.type) ? route.query.type : 'tickets';
  let results = runSearch(app.replica, query);
  const inputId = uid('search');
  const input = h(`input#${inputId}.search-big-input`, {
    type: 'search', value: query, autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search',
    placeholder: 'Search tickets, customers, organizations and articles',
    'aria-label': 'Search', 'aria-describedby': `${inputId}-hint`, 'aria-controls': `${inputId}-results`,
  });
  const tipsBtn = h('button.btn.btn-ghost.btn-sm.tips-btn', { type: 'button', 'aria-expanded': 'false', 'aria-controls': `${inputId}-tips`, onclick: () => toggleTips() }, icon('circle-question-mark', { size: 15 }), h('span.btn-text', 'Search tips'));
  const tips = h(`div#${inputId}-tips.search-tips`, { hidden: true },
    h('p.muted', 'Narrow ticket results with filters. Combine them with words, for example ', h('code', 'status:open tag:billing refund'), '.'),
    h('ul.tips-list', FILTER_HELP.map(([f, d]) => h('li', h('button.tip-chip', { type: 'button', onclick: () => insertFilter(f), 'aria-label': `Add filter ${f}: ${d}` }, h('code', f)), h('span.muted', d)))));
  const status = h(`p#${inputId}-hint.search-status`, { role: 'status', 'aria-live': 'polite' });
  const seg = segmented({
    label: 'Result type',
    value: type,
    items: TYPES.map((t) => ({ value: t.id, label: t.label, count: 0 })),
    onChange: (v) => {
      type = v;
      syncUrl();
      paintResults();
    },
  });
  const resultsEl = h(`div#${inputId}-results.search-results`);
  main.append(h('div.page.search-page',
    h('div.search-inner',
      h('div.search-bar', icon('search', { size: 20 }), input, tipsBtn),
      tips,
      h('div.search-meta', seg, status),
      resultsEl)));

  function toggleTips(force) {
    const open = force ?? tips.hidden;
    tips.hidden = !open;
    tipsBtn.setAttribute('aria-expanded', String(open));
  }

  function insertFilter(f) {
    const v = input.value.trim();
    input.value = v ? `${v} ${f}` : f;
    input.focus();
    if (f.includes(':')) {
      // Select the example value so typing replaces it.
      const start = input.value.length - f.length + f.indexOf(':') + 1;
      input.setSelectionRange(start, input.value.length);
    }
    run();
  }

  function syncUrl() {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (type !== 'tickets') params.set('type', type);
    const qs = params.toString();
    history.replaceState(null, '', `#/search${qs ? `?${qs}` : ''}`);
  }

  function counts() {
    return { tickets: results.tickets.length, customers: results.customers.length, orgs: results.orgs.length, articles: results.articles.length };
  }

  function paintStatus() {
    if (!query) {
      status.textContent = '';
      return;
    }
    const c = counts();
    const total = c.tickets + c.customers + c.orgs + c.articles;
    status.textContent = total ? `${plural(total, 'result')} for "${query}"` : `No results for "${query}"`;
  }

  function open(href, q = query) {
    rememberSearch(q);
    go(href);
  }

  function row(href, children, label) {
    return h('li', h('a.sr-row', { href, 'aria-label': label, onclick: (e) => { e.preventDefault(); open(href.slice(1)); } }, children));
  }

  function highlight(text, words) {
    const s = String(text || '');
    if (!words.length) return s;
    // Longest first, so "re refund" marks all of "refund", not just "re".
    const re = new RegExp(`(${[...words].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
    const out = [];
    let last = 0;
    s.replace(re, (m, _g, at) => {
      out.push(s.slice(last, at), h('mark', m));
      last = at + m.length;
      return m;
    });
    out.push(s.slice(last));
    return out;
  }

  function textWords() {
    return parseQuery(query).text.filter((w) => w.length > 1);
  }

  function paintRecent() {
    const recent = loadRecent();
    const wrap = h('div.search-empty');
    if (recent.length) {
      wrap.append(h('h2.search-h', 'Recent searches'), h('ul.recent-list', recent.map((r) => h('li.recent-item',
        h('button.recent-btn', { type: 'button', onclick: () => { input.value = r; run(); input.focus(); } }, icon('rotate-ccw-clock', { size: 15 }), h('span.ellipsis', r)),
        h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove "${r}" from recent searches`, onclick: () => { forget(r); paintResults(); } }, icon('x', { size: 13 }))))));
    }
    wrap.append(h('h2.search-h', 'Try a filter'), h('div.tip-row', FILTER_HELP.slice(0, 6).map(([f, d]) => h('button.tip-chip', { type: 'button', title: d, onclick: () => insertFilter(f) }, h('code', f)))));
    resultsEl.append(wrap);
  }

  function paintResults() {
    clear(resultsEl);
    seg.setCounts(counts());
    seg.hidden = !query.trim();
    paintStatus();
    if (!query.trim()) {
      paintRecent();
      return;
    }
    const words = textWords();
    let list;
    if (type === 'tickets') {
      list = results.tickets.map((t) => {
        const u = app.replica.users.get(t.requester);
        return row(`#/tickets/${t.id}`, [
          statusBadge(t.status),
          h('div.sr-main',
            h('div.sr-title', h('span.ellipsis', highlight(t.subject, words)), h('span.subtle.sr-id', `#${t.id}`)),
            h('div.sr-sub.ellipsis', u ? highlight(u.name, words) : 'Unknown customer', t.desc ? h('span.subtle', ' · ', highlight(t.desc.slice(0, 160), words)) : null)),
          h('time.sr-time', { title: fullDate(t.updatedAt) }, relTime(t.updatedAt)),
        ], `Ticket ${t.id}: ${t.subject}`);
      });
    } else if (type === 'customers') {
      list = results.customers.map((u) => {
        const o = u.org ? app.replica.orgs.get(u.org) : null;
        return row(`#/customers/${u.id}`, [
          avatar(u.name, { size: '' }),
          h('div.sr-main', h('div.sr-title', h('span.ellipsis', highlight(u.name, words))), h('div.sr-sub.ellipsis', highlight(u.email || 'No email', words), o ? h('span.subtle', ` · ${o.name}`) : null)),
          u.suspended ? h('span.badge', 'Suspended') : null,
        ], u.name);
      });
    } else if (type === 'orgs') {
      list = results.orgs.map((o) => row(`#/orgs/${o.id}`, [
        orgMark(o.name),
        h('div.sr-main', h('div.sr-title', h('span.ellipsis', highlight(o.name, words))), h('div.sr-sub.ellipsis', (o.domains || []).length ? highlight(o.domains.join(', '), words) : 'No domains')),
      ], o.name));
    } else {
      list = results.articles.map((a) => row(`#/kb/articles/${a.id}`, [
        h('span.sr-doc', icon('file-text', { size: 16 })),
        h('div.sr-main', h('div.sr-title', h('span.ellipsis', highlight(a.title, words)), a.status !== 'published' ? h('span.badge', 'Draft') : null), a.excerpt ? h('div.sr-sub.ellipsis', highlight(a.excerpt, words)) : null),
        h('time.sr-time', { title: fullDate(a.updatedAt) }, relTime(a.updatedAt)),
      ], a.title));
    }
    if (!list.length) {
      const other = TYPES.find((t) => t.id !== type && counts()[t.id] > 0);
      const filtered = /\w+:|#\d+/.test(query) && type !== 'tickets';
      resultsEl.append(h('div.search-none',
        h('p', filtered ? 'Filters only apply to tickets.' : `No ${TYPES.find((t) => t.id === type).label.toLowerCase()} match "${query}".`),
        other ? h('button.btn.btn-sm', { type: 'button', onclick: () => { setType(other.id); syncUrl(); paintResults(); seg.querySelector('.seg[aria-checked="true"]')?.focus(); } }, `Show ${plural(counts()[other.id], other.label.toLowerCase().replace(/s$/, ''), other.label.toLowerCase())}`) : null));
      return;
    }
    resultsEl.append(h('ul.sr-list', { 'aria-label': `${TYPES.find((t) => t.id === type).label} results` }, list));
  }

  /** Switch the kind of results shown, and the tab that says so. */
  function setType(id) {
    type = id;
    const label = TYPES.find((t) => t.id === id).label;
    for (const b of seg.querySelectorAll('.seg')) {
      const on = b.textContent.startsWith(label);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }

  function run() {
    query = input.value;
    results = runSearch(app.replica, query);
    syncUrl();
    // Jump to the first tab with results when the current one is empty.
    if (query.trim() && !counts()[type]) {
      const first = TYPES.find((t) => counts()[t.id] > 0);
      if (first) setType(first.id);
    }
    paintResults();
    if (query.trim()) announce(status.textContent);
  }

  const runSoon = debounce(run, 90);
  const rememberSoon = debounce(() => rememberSearch(input.value), 2500);
  input.addEventListener('input', () => {
    runSoon();
    rememberSoon();
  });

  function items() {
    return [...resultsEl.querySelectorAll('.sr-row, .recent-btn')];
  }

  input.addEventListener('keydown', (e) => {
    if (composing(e)) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items()[0]?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runSoon.cancel();
      run();
      rememberSearch(input.value);
      const first = resultsEl.querySelector('.sr-row');
      if (results.tickets.length === 1 && type === 'tickets' && first) first.click();
    } else if (e.key === 'Escape') {
      if (input.value) {
        e.preventDefault();
        input.value = '';
        run();
      } else if (!tips.hidden) toggleTips(false);
    }
  });
  resultsEl.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (i === -1) return;
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      list[Math.min(list.length - 1, i + 1)].focus();
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      if (i === 0) input.focus();
      else list[i - 1].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      list[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      list[list.length - 1].focus();
    }
  });

  const refresh = debounce(() => {
    results = runSearch(app.replica, query);
    if (!resultsEl.contains(document.activeElement)) paintResults();
    else {
      seg.setCounts(counts());
      paintStatus();
    }
  }, 250);
  app.replica.addEventListener('change', refresh);
  const unbind = bind('search', {
    '/': () => {
      input.focus();
      input.select();
    },
    'mod+k': () => {
      input.focus();
      input.select();
    },
  });
  if (query && !results[type].length) run();
  else paintResults();
  document.title = 'Search - Help Desk';
  requestAnimationFrame(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  return () => {
    app.replica.removeEventListener('change', refresh);
    unbind();
    runSoon.cancel();
    rememberSoon.cancel();
    refresh.cancel();
    document.title = 'Help Desk';
  };
}
