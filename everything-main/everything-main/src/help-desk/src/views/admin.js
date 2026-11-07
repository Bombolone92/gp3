/**
 * Admin: settings for the whole help desk. A grouped section list on the
 * left (a section picker on phones) and the chosen section on the right.
 * Workflow sections (macros, views, triggers, fields, service levels) live
 * in admin-rules.js and load on demand.
 */
import './admin.css';
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openMenu } from '../ui/popover.js';
import { emptyState, spinner } from '../ui/components.js';
import { go } from '../ui/router.js';
import { app } from '../app.js';

export const SECTIONS = [
  { group: 'Settings', items: [
    { id: 'general', label: 'General', icon: 'sliders-horizontal', load: () => import('./admin-settings.js'), fn: 'renderGeneral' },
    { id: 'team', label: 'Team', icon: 'users', load: () => import('./admin-team.js'), fn: 'renderTeam' },
    { id: 'groups', label: 'Groups', icon: 'users-round', load: () => import('./admin-team.js'), fn: 'renderGroups' },
    { id: 'help-center', label: 'Help center', icon: 'globe', load: () => import('./admin-settings.js'), fn: 'renderHelpCenter' },
    { id: 'email', label: 'Email', icon: 'mail', load: () => import('./admin-settings.js'), fn: 'renderEmail' },
  ] },
  { group: 'Workflow', items: [
    { id: 'macros', label: 'Macros', icon: 'zap', rules: true },
    { id: 'views', label: 'Views', icon: 'layout-list', rules: true },
    { id: 'triggers', label: 'Triggers', icon: 'workflow', rules: true },
    { id: 'fields', label: 'Ticket fields', icon: 'text-cursor-input', rules: true },
    { id: 'sla', label: 'Service levels', icon: 'timer', rules: true },
  ] },
  { group: 'Account', items: [
    { id: 'data', label: 'Data', icon: 'archive', load: () => import('./admin-data.js'), fn: 'renderData' },
  ] },
];

const ALL = SECTIONS.flatMap((g) => g.items);

// Resolved at build time: an empty object until admin-rules.js exists.
const RULES = import.meta.glob('./admin-rules.js');

export function sectionById(id) {
  return ALL.find((s) => s.id === id) || null;
}

export function mount(main, ctx) {
  if (!app.isAdmin) {
    main.append(h('div.page', h('div.page-inner', emptyState({
      glyph: 'shield',
      title: 'Only administrators can change settings',
      text: 'Ask an administrator of this help desk if something needs to change.',
      action: h('button.btn', { type: 'button', onclick: () => go('/home') }, 'Back to Home'),
    }))));
    return null;
  }
  const current = sectionById(ctx.sub) || ALL[0];
  if (!ctx.sub) history.replaceState(null, '', `#/admin/${current.id}`);

  const nav = h('nav.side-nav.admin-nav', { 'aria-label': 'Admin sections' },
    h('div.side-nav-head', h('h2', 'Admin')),
    SECTIONS.map((g) => [
      h('div.side-group', g.group),
      h('div', g.items.map((s) => h('a.side-link', { href: `#/admin/${s.id}`, 'aria-current': s.id === current.id ? 'page' : undefined }, icon(s.icon, { size: 16 }), h('span.ellipsis', s.label)))),
    ]));

  const picker = h('button.select-btn.admin-picker', {
    type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Admin section: ${current.label}`,
    onclick: () => openMenu(picker, SECTIONS.flatMap((g) => [
      { heading: g.group },
      ...g.items.map((s) => ({ label: s.label, icon: s.icon, checked: s.id === current.id, run: () => go(`/admin/${s.id}`) })),
    ]), { label: 'Admin sections' }),
  }, icon(current.icon, { size: 16 }), h('span.value', current.label), icon('chevron-down', { size: 16 }));

  const body = h('div.admin-body', { 'aria-labelledby': 'admin-title' });
  const scroller = h('section.admin-main', h('div.admin-mobile-bar', picker), body);
  main.append(h('div.split-page.admin', nav, scroller));
  document.title = `${current.label} - Admin - Help Desk`;

  let cleanup = null;
  let gone = false;
  body.append(h('div.admin-loading', spinner('Loading')));
  (async () => {
    let render = null;
    let failed = false;
    try {
      if (current.rules) {
        const loader = RULES['./admin-rules.js'];
        if (loader) {
          const mod = await loader();
          render = (el) => mod.renderSection(el, { section: current.id, route: ctx.route });
        }
      } else {
        const mod = await current.load();
        render = (el) => mod[current.fn](el, { route: ctx.route, section: current.id });
      }
    } catch (e) {
      console.error(e);
      failed = true;
    }
    if (gone) return;
    clear(body);
    if (failed) {
      // Offline, or the app was updated and its old files are gone.
      body.append(emptyState({
        glyph: 'triangle-alert', title: `${current.label} could not be loaded`,
        text: 'Check your connection, then reload the page.',
        action: h('button.btn', { type: 'button', onclick: () => location.reload() }, icon('rotate-ccw', { size: 14 }), 'Reload'),
      }));
      return;
    }
    if (!render) {
      body.append(emptyState({ glyph: current.icon, title: `${current.label} is not available yet`, text: 'This part of Admin is still being built. Check back soon.' }));
      return;
    }
    cleanup = render(body) || null;
  })();

  return () => {
    gone = true;
    document.title = 'Help Desk';
    if (typeof cleanup === 'function') cleanup();
  };
}
