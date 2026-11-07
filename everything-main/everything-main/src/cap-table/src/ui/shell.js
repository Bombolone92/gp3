import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { openSecurityForm } from './securityform.js';
import { openOnboarding } from './onboarding.js';
import { openNewCompanyForm } from './companyform.js';
import { openSearch } from './search.js';
import { store, isRefusal } from '../lib/store.js';
import { setCurrency, timeAgo } from '../lib/format.js';
import { isPuterApp } from '../lib/env.js';
import { wipeSampleData } from '../lib/sample.js';
import { attentionItems, dbAsOf } from '../lib/captable.js';
import { todayISO } from '../lib/util.js';
import { LOGO_HTML } from '../views/auth.js';
import { dashboardView } from '../views/dashboard.js';
import { capTableView } from '../views/captable.js';
import { securitiesView } from '../views/securities.js';
import { stakeholdersView } from '../views/stakeholders.js';
import { classesView } from '../views/classes.js';
import { roundsView } from '../views/rounds.js';
import { exitView } from '../views/exit.js';
import { attentionView } from '../views/attention.js';
import { historyView } from '../views/history.js';
import { reportsView } from '../views/reports.js';
import { settingsView, confirmSignOut } from '../views/settings.js';

/* The mobile tab bar holds four destinations plus More; routes marked
   tab: false live in the More sheet there. The desktop sidebar shows all. */
const ROUTES = [
  { hash: '#/', label: 'Home', icon: 'home', view: dashboardView },
  { hash: '#/cap-table', label: 'Cap table', icon: 'table', view: capTableView },
  { hash: '#/securities', label: 'Securities', icon: 'file-text', view: securitiesView },
  { hash: '#/stakeholders', label: 'Stakeholders', icon: 'users', view: stakeholdersView },
  { hash: '#/classes', label: 'Share classes', icon: 'layers', view: classesView, tab: false },
  { hash: '#/rounds', label: 'Round modeling', icon: 'trending-up', view: roundsView, tab: false },
  { hash: '#/exit', label: 'Exit scenarios', icon: 'scale', view: exitView, tab: false },
  { hash: '#/attention', label: 'Needs attention', icon: 'alert', view: attentionView, tab: false },
  { hash: '#/reports', label: 'Reports', icon: 'landmark', view: reportsView, tab: false },
  { hash: '#/history', label: 'History', icon: 'clock', view: historyView, tab: false },
  { hash: '#/settings', label: 'Settings', icon: 'gear', view: settingsView, tab: false },
];

/* One line about each destination, for the More sheet on a phone and for
   search results on every size. */
const ROUTE_SUBS = {
  '#/': 'Ownership, what is coming up, and recent activity',
  '#/cap-table': 'Who owns what, on any date and either share basis',
  '#/securities': 'Every certificate, grant, warrant, SAFE, and note',
  '#/stakeholders': 'Everyone on the cap table',
  '#/classes': 'Common, preferred, and the equity plans',
  '#/rounds': 'Model dilution before you raise',
  '#/exit': 'Who gets what if you sell',
  '#/attention': 'Lapsed grants, matured notes, missed deadlines',
  '#/reports': 'Stock comp expense, Rule 701, and Form 3921',
  '#/history': 'Permanent transaction history, original values, and exports',
  '#/settings': 'Company, appearance, and your data',
};

export function mountShell(appRoot) {
  const sampleBanner = el('div');
  const viewWrap = el('div');
  const topbarTitle = el('h1.topbar-title');
  const inner = el('div.main-inner', {}, sampleBanner, viewWrap);
  const topbar = el('div.topbar', {},
    el('span', { html: LOGO_HTML.replace('width="72" height="72"', 'width="26" height="26"'), style: { display: 'inline-flex' } }),
    topbarTitle,
    el('button.icon-btn', {
      html: icon('search', 20, 2), 'aria-label': 'Search',
      'aria-haspopup': 'dialog',
      onclick: () => openGlobalSearch(),
    }),
    el('button.icon-btn', {
      html: icon('plus', 20, 2), 'aria-label': 'Issue security',
      onclick: () => openSecurityForm(),
    })
  );
  // tabindex so the skip control below can hand focus to the landmark; the
  // outline stays off it in CSS, since ringing the whole scroll region says
  // less than the next Tab landing inside it does.
  const main = el('main.main', { id: 'main', tabindex: -1 }, inner);
  const mainCol = el('div.main-col', {}, topbar, main);

  /* Bypass the nav (WCAG 2.4.1): the desktop sidebar puts a dozen controls
     ahead of the content on every route. A button rather than an <a href>
     pointing at the landmark - the app routes on the hash, so navigating to
     "#main" would match no route and bounce the user to the dashboard. */
  const skipLink = el('button.skip-link', {
    type: 'button',
    onclick: () => {
      main.scrollTop = 0;
      main.focus();
    },
  }, 'Skip to main content');

  /* Where each route was scrolled to when it was left, for the browser's
     Back and Forward: a long stakeholder list opened a holder and came back
     to the top of the list. A navigation the app makes itself - a nav item,
     a search result, a link in a view - is a fresh visit and starts at the
     top; a change of dataset forgets the lot. */
  const scrollMemory = new Map();
  let lastHash = location.hash;
  let freshNavigation = false;
  function navigate(hash) {
    /* Assigning the same hash fires no hashchange, so a jump to the route
       already open would leave the view untouched - which is wrong when the
       hash carries a payload, like the scenario id search sends to the round
       model. Re-render explicitly in that case. */
    if (location.hash === hash) renderView();
    else {
      freshNavigation = true;
      location.hash = hash;
    }
  }
  document.addEventListener('click', (e) => {
    const link = e.target instanceof Element ? e.target.closest('a[href^="#/"]') : null;
    if (link && !e.defaultPrevented) freshNavigation = true;
  });

  function openGlobalSearch() {
    // Never a second search over the first, and never over a form sheet the
    // user is in the middle of filling in.
    if (document.querySelector('.modal-root:not(.closing)')) return;
    /* Nor while a company switch is in flight. The shell is inert for the
       length of the swap, which stops its buttons, but the shortcuts reach
       the document - and a search opened then indexed the company being left
       and offered its records to a store already pointed at the other, so an
       edit saved from it ran against a company that had no such record. */
    if (store.switching) return;
    openSearch({
      navigate,
      routes: ROUTES.map((r) => ({ ...r, sub: ROUTE_SUBS[r.hash] || '' })),
    });
  }

  /**
   * Cmd/Ctrl-K anywhere, and "/" when the keystroke isn't going into a field -
   * the two shortcuts every tool a founder has open already answers to.
   */
  function onGlobalKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      openGlobalSearch();
      return;
    }
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    // A slash typed into a text box is a slash. `isContentEditable` covers
    // nothing in the app today and everything a future rich field would add.
    if (target instanceof HTMLElement
      && (target.isContentEditable
        || target.closest('input, select, textarea'))) return;
    e.preventDefault();
    openGlobalSearch();
  }

  /* A route also owns its sub-paths, so #/stakeholders/:id renders (and
     highlights) the stakeholders route, which reads the id from the hash. */
  function routeFor(hash) {
    const clean = (hash || '#/').split('?')[0];
    return ROUTES.find((r) => r.hash === clean)
      || ROUTES.find((r) => r.hash !== '#/' && clean.startsWith(`${r.hash}/`))
      || ROUTES[0];
  }

  /* Sample-data banner: always visible while exploring, one-tap wipe. */
  function renderSampleBanner() {
    clear(sampleBanner);
    if (!store.settings.sampleData) return;
    sampleBanner.append(el('div.sample-banner', {},
      el('span.sample-banner-ic', { html: icon('sparkle', 14, 2.2) }),
      el('span.grow', {}, 'Sample data: explore freely, nothing here is yours'),
      el('button', {
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Start fresh?',
            message: 'All sample data is removed and you set up your own company from scratch.',
            confirmLabel: 'Wipe sample data',
          });
          if (!ok) return;
          try {
            await wipeSampleData(store);
          } catch (err) {
            console.error(err);
            toast('Couldn’t wipe. Check your connection', { icon: 'wifiOff' });
            return;
          }
          openOnboarding();
        },
      }, 'Start fresh')
    ));
  }

  /* Company switcher: the active company in the sidebar header, and a
     sheet to jump between the account's companies or add one. */
  function openCompanySwitcher() {
    const content = el('div', {},
      store.companies.map((c) => el('button.more-row', {
        onclick: async () => {
          modal.close();
          if (c.id === store.activeCompanyId) return;
          try {
            await store.switchCompany(c.id);
            navigate('#/');
          } catch (err) {
            console.error(err);
            // A company deleted in another tab is a refusal in the store's
            // words, not a connection problem - see isRefusal.
            toast(isRefusal(err) ? err.message : 'Couldn’t switch. Check your connection',
              { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
          }
        },
      },
        el('span.more-ic', { html: icon('building', 18, 1.9) }),
        el('span.grow', {},
          el('div.t', {}, c.label || 'Untitled company'),
          // With its creation time: two companies can carry one name - see the Companies card in Settings.
          el('div.s', {}, [c.id === store.activeCompanyId ? 'Current company' : null, `created ${timeAgo(c.createdAt)}`]
            .filter(Boolean).join(' · '))),
        c.id === store.activeCompanyId
          ? el('span', { html: icon('check', 16, 2.2), style: { display: 'inline-flex', color: 'var(--accent)' } })
          : el('span', { html: icon('chevR', 16, 2), style: { color: 'var(--ink-3)', display: 'inline-flex' } }))),
      el('button.more-row', {
        onclick: () => { modal.close(); openNewCompanyForm({ onCreated: () => navigate('#/') }); },
      },
        el('span.more-ic', { html: icon('plus', 18, 2) }),
        el('span.grow', {},
          el('div.t', {}, 'New company'),
          el('div.s', {}, 'A separate cap table under this account'))));
    const modal = openModal({ title: 'Companies', content });
  }

  /* Sidebar (desktop) */
  const username = store.user?.username || 'Puter user';
  /* The shortcut is on the button, so it is discoverable rather than folklore.
     Cmd on Apple keyboards, Ctrl everywhere else. */
  const searchButton = el('button.sidebar-search', {
    type: 'button',
    'aria-haspopup': 'dialog',
    onclick: () => openGlobalSearch(),
  },
    el('span', { html: icon('search', 16, 2), style: { display: 'inline-flex' } }),
    el('span.grow', {}, 'Search'),
    el('kbd', {}, /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K'));
  const sidebarNav = el('div', { style: { display: 'contents' } });
  const brandCompany = el('button.brand-company', {
    type: 'button',
    'aria-haspopup': 'dialog',
    title: 'Switch company',
    onclick: openCompanySwitcher,
  });
  const sidebar = el('nav.sidebar', { 'aria-label': 'Main navigation' },
    el('div.brand', {},
      el('span', { html: LOGO_HTML.replace('width="72" height="72"', 'width="30" height="30"'), style: { display: 'inline-flex' } }),
      'Cap Table'
    ),
    brandCompany,
    searchButton,
    sidebarNav,
    el('div.sidebar-spacer'),
    el('button.btn.btn-primary.sidebar-add', {
      html: icon('plus', 17, 2.2),
      onclick: () => openSecurityForm(),
    }, ' Issue security'),
    el('div.sidebar-user', {},
      el('span.avatar', {}, username.charAt(0).toUpperCase()),
      el('span.name', { title: username }, username),
      // Inside Puter (env 'app') the platform owns the session - no sign-out.
      isPuterApp() ? null : el('button.icon-btn', {
        html: icon('logout', 18, 2),
        'aria-label': 'Sign out',
        title: 'Sign out',
        onclick: confirmSignOut,
      })
    )
  );

  /* Tab bar (mobile / tablet) */
  const tabbar = el('nav.tabbar', { 'aria-label': 'Main navigation' });

  /* How many records need attention right now. The list lived on its own
     page and on the dashboard, and nowhere else: a note that matured or a
     window that closed while the user was working in Securities went
     unannounced until they next opened Home. The count rides on the nav
     item, the way an inbox carries its unread count, and on the More tab
     that leads to it on a phone. Recomputed with the nav on every store
     change - one pass over the securities, the same the dashboard makes. */
  const openItems = () => {
    const today = todayISO();
    // Today's snapshot, so the pill counts what the list it leads to shows.
    return attentionItems(dbAsOf(store.db, today), { asOf: today }).length;
  };
  const countPill = (open) => el('span.nav-count', { 'aria-hidden': 'true' }, String(open));
  const countedName = (label, open) => (open > 0
    ? `${label}, ${open} ${open === 1 ? 'item' : 'items'} to settle`
    : null);

  function renderNav() {
    const current = routeFor(location.hash);
    const open = openItems();
    /* The nav is rebuilt on every render, taking a focused item with it.
       Pressing the item for the page already open re-renders without a
       hashchange, so neither focus recovery ran and the next Tab started
       over at the skip link; the same after Cmd/Ctrl-Z pressed a toast's
       Undo from a nav item. The item for the same route gets focus back. */
    const active = document.activeElement;
    const focused = sidebarNav.contains(active) || tabbar.contains(active) ? active.dataset.route : null;
    const bar = tabbar.contains(active) ? tabbar : sidebarNav;
    sidebarNav.replaceChildren(...ROUTES.map((r) => {
      const counted = r.hash === '#/attention' && open > 0;
      return el('button.nav-item', {
        html: icon(r.icon, 18, 1.9),
        'aria-current': r === current ? 'page' : null,
        'aria-label': counted ? countedName(r.label, open) : null,
        dataset: { route: r.hash },
        onclick: () => navigate(r.hash),
      }, el('span', {}, r.label), counted ? countPill(open) : null);
    }));

    const tabs = ROUTES.filter((r) => r.tab !== false);
    const moreActive = current.tab === false;
    tabbar.replaceChildren(
      ...tabs.map((r) => el('button.tab-item', {
        html: icon(r.icon, 21, r === current ? 2.2 : 1.8),
        'aria-current': r === current ? 'page' : null,
        dataset: { route: r.hash },
        onclick: () => navigate(r.hash),
      }, el('span', {}, r.label))),
      el('button.tab-item', {
        html: icon('more', 21, moreActive ? 2.2 : 1.8),
        'aria-current': moreActive ? 'page' : null,
        'aria-haspopup': 'dialog',
        'aria-label': open > 0 ? `More, ${open} ${open === 1 ? 'item needs' : 'items need'} attention` : null,
        dataset: { route: 'more' },
        onclick: openMoreSheet,
      }, el('span', {}, 'More'), open > 0 ? el('span.tab-dot', { 'aria-hidden': 'true' }) : null)
    );
    if (focused) bar.querySelector(`[data-route="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }

  function openMoreSheet() {
    const open = openItems();
    const content = el('div', {}, ROUTES.filter((r) => r.tab === false).map((r) => {
      const counted = r.hash === '#/attention' && open > 0;
      return el('button.more-row', {
        'aria-label': counted ? countedName(r.label, open) : null,
        onclick: () => { modal.close(); navigate(r.hash); },
      },
        el('span.more-ic', { html: icon(r.icon, 18, 1.9) }),
        el('span.grow', {},
          el('div.t', {}, r.label, counted ? countPill(open) : null),
          el('div.s', {}, ROUTE_SUBS[r.hash] || '')),
        el('span', { html: icon('chevR', 16, 2), style: { color: 'var(--ink-3)', display: 'inline-flex' } }));
    }));
    const modal = openModal({ title: 'More', content });
  }

  let renderQueued = false;
  function renderView() {
    const route = routeFor(location.hash);
    /* Money is formatted in the active company's currency. Every way that can
       change - editing the profile, importing, switching company - arrives
       here as a render, so this is the one place it has to be set. */
    setCurrency(store.company.currency);
    /* A control that writes to the store re-renders the whole view, taking
       itself with it - and focus lands back at the top of the document, so a
       keyboard user has to tab past the entire sidebar to carry on. Controls
       that stay put across a render say so with a focus key, and get focus
       handed back. */
    const active = document.activeElement;
    const focusKey = viewWrap.contains(active) ? active.dataset?.focusKey : null;
    // The company line lives outside the view, so refresh it here - it must
    // follow renames, switches, and appear the moment onboarding names the
    // company. With several companies it always shows, or the switcher
    // would be unreachable.
    const companyLabel = store.company.name || store.activeCompany?.label;
    /* The visible line is the company's name, and that was the whole of the
       button's name: a screen reader heard "Acme Robotics, Inc., button, has
       popup" with nothing to say the popup switches companies - the tooltip
       is a description, not the name. The name leads so it still matches
       the words on screen. */
    brandCompany.setAttribute('aria-label', `${companyLabel || 'Set up company'}, switch company`);
    brandCompany.replaceChildren(
      el('span.grow', { style: { textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' } },
        companyLabel || 'Set up company'),
      el('span', { html: icon('chevDown', 13, 2.2), style: { display: 'inline-flex', flexShrink: '0' } }));
    brandCompany.style.display = companyLabel || store.companies.length > 1 ? 'flex' : 'none';
    clear(viewWrap);
    const node = route.view({ navigate });
    viewWrap.append(node);
    // A view rendering a specific record (a stakeholder, say) names itself;
    // everything else is titled by its route.
    const label = node.dataset?.viewTitle
      || (route.label === 'Home' ? (store.company.name || 'Cap Table') : route.label);
    document.title = route.hash === '#/' && !node.dataset?.viewTitle ? 'Cap Table' : `${label} · Cap Table`;
    topbarTitle.textContent = label;
    renderNav();
    renderSampleBanner();
    if (focusKey) {
      viewWrap.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
    }
  }

  const shellEl = el('div.shell', {}, sidebar, mainCol, tabbar);

  /* A switch moves the store's pointer to the company being opened before
     that company's data has been read, and until it has, the view on screen
     is still the one being left. Anything in it would compose an edit from
     one company's figures and commit it against the other's keys - pressing
     Edit beside the visible company and saving its profile wrote that
     profile into the company being opened. The view is out of service for
     the length of the swap; the store refuses such a save as well.

     On the shell rather than on #app, which is where openModal parks its own
     inert while a dialog is up: sharing the attribute, whichever of the two
     finished last would take it off for both. */
  store.addEventListener('switching', () => {
    shellEl.toggleAttribute('inert', store.switching);
    /* Taking the shell out of service blurs the control that asked for the
       switch, and the switch itself changes no route - so once the view was
       back, keyboard focus sat on the document body and the next Tab started
       over at the skip link. The landmark is where a navigation puts it. */
    if (!store.switching && (document.activeElement === document.body || document.activeElement === null)) {
      main.focus({ preventScroll: true });
    }
  });

  /* One re-render per store change, coalesced; modals live outside #app
     and are unaffected. */
  let scrollEpoch = store.dataEpoch;
  store.addEventListener('change', () => {
    // Another dataset's pages are other pages: nothing remembered applies.
    if (store.dataEpoch !== scrollEpoch) {
      scrollEpoch = store.dataEpoch;
      scrollMemory.clear();
    }
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => {
      renderQueued = false;
      renderView();
    });
  });

  document.addEventListener('keydown', onGlobalKey);

  window.addEventListener('hashchange', () => {
    scrollMemory.set(lastHash, main.scrollTop);
    renderView();
    main.scrollTop = (freshNavigation ? undefined : scrollMemory.get(location.hash)) ?? 0;
    freshNavigation = false;
    lastHash = location.hash;
    /* The nav is rebuilt with the view, taking the button that was pressed
       with it, so keyboard focus fell to the document body: the next Tab
       started over at the skip link, and a screen reader had nothing to say
       about the page it had just moved to. The landmark is where it belongs
       (the skip link already puts it there). Focus that survived the render
       in a control of the new view, or in a dialog, is left alone - but not
       focus the nav's own recovery handed back to the item just pressed:
       renderNav keeps focus on a nav item across a re-render for the press
       that changes no route, and here it kept a keyboard user on the sidebar
       after every navigation, one Tab away from the next page's link rather
       than on the page they had just chosen. */
    const active = document.activeElement;
    if (active === document.body || active === null || sidebarNav.contains(active) || tabbar.contains(active)) {
      main.focus({ preventScroll: true });
    }
  });

  appRoot.replaceChildren(skipLink, shellEl);
  renderView();
}
