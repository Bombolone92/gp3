/**
 * Home: the signed-in agent's own work. Their open tickets, the tickets they
 * follow and what they solved recently, with a few numbers for the week and
 * a setup checklist for new desks.
 */
import './home.css';
import { h, clear, preserveFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { avatar, statusBadge, emptyState } from '../ui/components.js';
import { relTime } from '../ui/format.js';
import { go } from '../ui/router.js';
import { bind } from '../ui/shortcuts.js';
import { isUnsolved } from '../shared/model.js';
import { app } from '../app.js';
import { slaBadge } from './ticket-table.js';
import { playQueue } from './views.js';
import { LOCAL } from '../client/api.js';

const LISTS = {
  mine: { label: 'Your tickets', icon: 'inbox', filter: (t, me) => t.assignee === me && isUnsolved(t.status) },
  following: { label: 'Following', icon: 'eye', filter: (t, me) => (t.followers || []).includes(me) && isUnsolved(t.status) },
  unassigned: { label: 'Unassigned', icon: 'user-plus', filter: (t) => !t.assignee && isUnsolved(t.status) },
  solved: { label: 'Solved in the last 30 days', short: 'Last 30 days', icon: 'circle-check', filter: (t, me) => t.assignee === me && (t.status === 'solved' || t.status === 'closed') && Date.now() - (t.solvedAt || 0) < 30 * 86400000 },
};

const SORTS = {
  updated: { label: 'Recently updated', fn: (a, b) => b.updatedAt - a.updatedAt },
  oldest: { label: 'Oldest first', fn: (a, b) => a.createdAt - b.createdAt },
  priority: { label: 'Priority', fn: (a, b) => (rank(b.priority) - rank(a.priority)) || b.updatedAt - a.updatedAt },
};
function rank(p) {
  return { urgent: 4, high: 3, normal: 2, low: 1 }[p] || 0;
}

export function mount(main, { route }) {
  let list = LISTS[route.query.list] ? route.query.list : 'mine';
  let sort = 'updated';
  const side = h('nav.side-nav.home-nav', { 'aria-label': 'Your work' });
  const content = h('section.home-main', { 'aria-labelledby': 'home-title' });
  const aside = h('aside.home-aside', { 'aria-label': 'Overview' });
  main.append(h('div.split-page.home', side, content, aside));

  function visible() {
    const me = app.me?.uuid;
    return app.replica.ticketsFor((t) => !t.deleted && !t.spam && !t.mergedInto && LISTS[list].filter(t, me)).sort(SORTS[sort].fn);
  }

  function paintSide() {
    clear(side);
    const me = app.me?.uuid;
    const counts = Object.fromEntries(Object.keys(LISTS).map((k) => [k, 0]));
    for (const t of app.replica.tickets.values()) {
      if (t.deleted || t.spam || t.mergedInto) continue;
      for (const k of Object.keys(LISTS)) if (LISTS[k].filter(t, me)) counts[k]++;
    }
    side.append(h('div.side-nav-head', h('h2', 'Home')));
    side.append(h('div.side-group', 'Your work'));
    for (const k of ['mine', 'following']) side.append(link(k, counts[k]));
    side.append(h('div.side-group', 'Team'));
    side.append(link('unassigned', counts.unassigned));
    side.append(h('div.side-group', 'Completed'));
    side.append(link('solved', counts.solved));
  }

  function link(k, n) {
    return h('a.side-link', { href: `#/home?list=${k}`, 'aria-current': list === k ? 'page' : undefined }, icon(LISTS[k].icon, { size: 16 }), h('span.ellipsis', LISTS[k].short || LISTS[k].label), h('span.count', String(n)));
  }

  function card(t) {
    const u = app.replica.users.get(t.requester);
    return h('li', h('a.home-card', {
      href: `#/tickets/${t.id}`,
      onclick: () => {
        playQueue.viewId = null;
        playQueue.ids = visible().map((x) => x.id);
      },
    },
    avatar(u?.name || '?'),
    h('div.home-card-main',
      h('div.home-card-top', h('span.home-card-from.ellipsis', h('strong', u?.name || 'Unknown customer'), h('span.subtle', ' · '), h('span', t.subject)), slaBadge(t)),
      h('div.home-card-mid', statusBadge(t.status), h('span.ellipsis.muted', t.preview || t.desc || '')),
      h('div.home-card-meta', h('span', relTime(t.updatedAt)), h('span', `#${t.id}`), t.priority && t.priority !== 'normal' ? h(`span.pri.${t.priority}`, t.priority[0].toUpperCase() + t.priority.slice(1)) : null))));
  }

  function paintMain() {
    clear(content);
    const items = visible();
    const sortBtn = h('button.btn.btn-sm.btn-ghost', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => import('../ui/popover.js').then(({ openMenu }) => openMenu(sortBtn, Object.entries(SORTS).map(([k, s]) => ({ label: s.label, checked: sort === k, run: () => { sort = k; paintMain(); } })), { align: 'end' })) }, icon('arrow-up-down', { size: 14 }), SORTS[sort].label);
    const switchBtn = h('button.view-switch.home-switch', {
      type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `${LISTS[list].label}. Switch list`,
      onclick: () => import('../ui/popover.js').then(({ openMenu }) => openMenu(switchBtn, Object.entries(LISTS).map(([k, l]) => ({ label: l.label, icon: l.icon, checked: k === list, run: () => go(`/home?list=${k}`) })), { label: 'Lists' })),
    }, h('span.ellipsis', LISTS[list].label), icon('chevron-down', { size: 18 }));
    content.append(h('header.home-head', h('div.grow', h('h1#home-title', LISTS[list].label), switchBtn, h('p.page-sub', `${items.length} ticket${items.length === 1 ? '' : 's'}`)), sortBtn));
    if (!items.length) {
      const empties = {
        mine: ['circle-check', 'Nothing assigned to you', 'Tickets assigned to you that still need work will show up here.'],
        following: ['eye', 'You are not following any open tickets', 'Follow a ticket to keep an eye on it without being assigned.'],
        unassigned: ['inbox', 'Every ticket has an owner', 'New requests that nobody has picked up yet will show up here.'],
        solved: ['chart-line', 'No solved tickets yet', 'Tickets you solve will be listed here for 30 days.'],
      }[list];
      content.append(emptyState({ glyph: empties[0], title: empties[1], text: empties[2], action: list === 'mine' ? h('div.row', h('button.btn', { type: 'button', onclick: () => go('/views/sys-unassigned') }, 'See unassigned tickets'), h('button.btn.btn-primary', { type: 'button', onclick: () => go('/tickets/new') }, icon('plus', { size: 14 }), 'New ticket')) : null }));
      return;
    }
    content.append(h('ul.home-list', { 'aria-label': LISTS[list].label }, items.slice(0, 300).map(card)));
  }

  function stat(label, value, sub = '') {
    return h('div.stat', h('div.stat-value', String(value)), h('div.stat-label', label), sub ? h('div.stat-sub', sub) : null);
  }

  function paintAside() {
    clear(aside);
    const me = app.me?.uuid;
    const weekAgo = Date.now() - 7 * 86400000;
    let mineOpen = 0;
    let groupOpen = 0;
    let solvedWeek = 0;
    let good = 0;
    let rated = 0;
    const groups = new Set(app.me?.groups || []);
    for (const t of app.replica.tickets.values()) {
      if (t.deleted || t.spam) continue;
      if (isUnsolved(t.status)) {
        if (t.assignee === me) mineOpen++;
        if (t.group && groups.has(t.group)) groupOpen++;
      }
      if (t.assignee === me && t.solvedAt && t.solvedAt > weekAgo) solvedWeek++;
      if (t.assignee === me && t.csat && t.csat.at > weekAgo) {
        rated++;
        if (t.csat.score === 'good') good++;
      }
    }
    aside.append(h('section.card.home-stats', h('div.card-head', h('h2', 'Your week')),
      h('div.stats', stat('Open, assigned to you', mineOpen), stat('Open in your groups', groupOpen), stat('Solved this week', solvedWeek), stat('Satisfaction', rated ? `${Math.round((good / rated) * 100)}%` : '-', rated ? `${rated} rating${rated === 1 ? '' : 's'}` : 'No ratings yet'))));
    if (app.isAdmin) setupChecklist(aside);
  }

  function setupChecklist(container) {
    const r = app.replica;
    const steps = [
      { done: r.tickets.size > 0, label: 'Create your first ticket', run: () => go('/tickets/new') },
      { done: Object.keys(r.members).length > 1, label: 'Invite your team', run: () => go('/admin/team') },
      { done: !!r.meta?.portal?.enabled && app.server !== LOCAL, label: 'Open your help center', run: () => go('/admin/help-center') },
      { done: [...r.articles.values()].some((a) => a.status === 'published'), label: 'Publish a help article', run: () => go('/kb/new') },
      { done: (r.cfg.macros || []).length > 3, label: 'Add your own macros', run: () => go('/admin/macros') },
    ];
    if (steps.every((s) => s.done)) return;
    const done = steps.filter((s) => s.done).length;
    container.append(h('section.card.setup', h('div.card-head', h('h2', 'Set up your help desk'), h('span.muted', `${done} of ${steps.length}`)),
      h('ul.setup-list', steps.map((s) => h('li', h(`button.setup-step${s.done ? '.done' : ''}`, { type: 'button', onclick: s.run, disabled: s.done },
        h('span.setup-check', s.done ? icon('check', { size: 13 }) : null), h('span', s.label), s.done ? h('span.sr-only', '(done)') : icon('chevron-right', { size: 14 })))))));
  }

  const onChange = (e) => {
    const k = e.detail?.kinds;
    if (!k || k.has('t') || k.has('u') || k.has('m') || k.has('d') || k.has('a') || k.has('c')) {
      preserveFocus(main, () => {
        paintSide();
        paintMain();
        paintAside();
      });
    }
  };
  app.replica.addEventListener('change', onChange);
  const unbind = bind('home', {
    j: () => content.querySelector('.home-card')?.focus(),
  });
  content.addEventListener('keydown', (e) => {
    const cards = [...content.querySelectorAll('.home-card')];
    const i = cards.indexOf(document.activeElement);
    if (i === -1) return;
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); cards[Math.min(cards.length - 1, i + 1)].focus(); }
    if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); cards[Math.max(0, i - 1)].focus(); }
  });
  paintSide();
  paintMain();
  paintAside();
  return () => {
    app.replica.removeEventListener('change', onChange);
    unbind();
  };
}
