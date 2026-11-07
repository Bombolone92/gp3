/**
 * The public help center of one help desk, at #/help/<server>/<desk>/...
 * Customers search and read published articles, send requests, and follow
 * up on them. No Puter account is needed; requests sent from this device are
 * remembered here, and visitors signed in to Puter also see the requests
 * linked to their account.
 *
 *   /                    home: search, promoted articles, categories
 *   /search?q=           article search
 *   /sections/<id>       articles in a section
 *   /articles/<id>       one article
 *   /new                 submit a request
 *   /requests            my requests
 *   /requests/<id>?key=  one request: conversation, reply, solve, rate
 */
import { openBlob } from '../ui/files.js';
import './portal.css';
import { h, clear, uid, debounce, announce, preserveFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openMenu } from '../ui/popover.js';
import { toast, toastError } from '../ui/toast.js';
import { spinner } from '../ui/components.js';
import { applyTheme, savedTheme } from '../ui/theme.js';
import { relTime, fullDate, shortDate, fileSize } from '../ui/format.js';
import { onRoute, go, parse } from '../ui/router.js';
import { sanitizeHtml } from '../shared/html.js';
import { initials, isEmail, LIMITS } from '../shared/model.js';
import { PortalApi, PortalError, savedRequests, saveRequest, keyFor, searchArticles } from '../client/portal-api.js';
import { sdk, isSignedIn, currentUser, signIn } from '../client/puter.js';

export const PUBLIC_STATUS = {
  open: { label: 'Open', hint: 'We are working on it' },
  pending: { label: 'Awaiting your reply', hint: 'We need more information from you' },
  solved: { label: 'Solved', hint: 'Reply if you still need help' },
  closed: { label: 'Closed', hint: 'Replying opens a follow-up request' },
};

const ME_KEY = 'help-desk:portal:me';
const VOTE_KEY = 'help-desk:portal:votes';

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* blocked or full */
  }
}

function rgbOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const toHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** Readable text color for a brand background: whichever of white and near-black contrasts more. */
export function onColor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#ffffff';
  const bg = rgbOf(hex);
  return contrast(bg, [255, 255, 255]) >= contrast(bg, rgbOf('#14161a')) ? '#ffffff' : '#14161a';
}

/**
 * The brand mixed with the text color, starting at `start` brand and moving
 * toward the text color until it contrasts `ratio`:1 with every background
 * it is drawn on: the page, surfaces, and the soft brand fill (12% brand,
 * as --accent-soft in portal.css) behind pills, tags and current links.
 */
function brandMix(hex, { bg, text, surface = bg }, start, ratio) {
  const brand = rgbOf(hex);
  const ink = rgbOf(text);
  const page = rgbOf(bg);
  const soft = brand.map((c, i) => c * 0.12 + page[i] * 0.88);
  const backs = [page, rgbOf(surface), soft];
  for (let w = start; w > 0; w -= 0.04) {
    const mix = brand.map((c, i) => c * w + ink[i] * (1 - w));
    if (backs.every((b) => contrast(mix, b) >= ratio)) return toHex(mix);
  }
  return text;
}

/** Brand-tinted text (links, highlights) that stays readable: 4.5:1. */
export function brandText(hex, theme) {
  return brandMix(hex, theme, 0.78, 4.5);
}

/** A brand-tinted focus ring that stays visible: 3:1, as WCAG asks. */
export function brandFocus(hex, theme) {
  return brandMix(hex, theme, 0.8, 3);
}

export function statusLabel(s) {
  return PUBLIC_STATUS[s]?.label || 'Open';
}

export function mountPortal(root, route) {
  const [, server, desk] = route.path;
  clear(root);
  root.classList.add('hc-root');
  if (!/^[a-z0-9_-]{3,63}$/.test(server || '') || !/^[a-z0-9]{6,24}$/.test(desk || '')) {
    root.append(h('main.hc-fatal', h('div.hc-fatal-card', h('h1', 'This help center link is not valid'), h('p', 'Check the address and try again.'))));
    return;
  }
  const api = new PortalApi(server, desk);
  const baseHash = `#/help/${server}/${desk}`;
  const link = (p = '') => `${baseHash}${p}`;
  const nav = (p = '', opts) => go(`/help/${server}/${desk}${p}`, opts);

  let info = null;
  let articles = null;
  let articlesPromise = null;
  let cleanup = null;

  /* ----------------------------------------------------------- frame */
  const brandEl = h('a.hc-brand', { href: link() });
  const navEl = h('nav.hc-nav', { 'aria-label': 'Help center' });
  const themeBtn = h('button.icon-btn.hc-theme', { type: 'button', 'aria-label': 'Appearance', title: 'Appearance', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openThemeMenu() }, icon('sun', { size: 18 }));
  const menuBtn = h('button.icon-btn.hc-menu-btn', { type: 'button', 'aria-label': 'Menu', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openMobileMenu() }, icon('menu', { size: 20 }));
  const header = h('header.hc-header', h('div.hc-header-inner', brandEl, h('span.spacer'), navEl, themeBtn, menuBtn));
  const main = h('main#main.hc-main', { tabindex: '-1' });
  // Each page renders into its own container in main. A page still loading
  // when the visitor moves on keeps writing to its own, now detached one,
  // instead of adding itself to the next page.
  let view = main;
  const footer = h('footer.hc-footer');
  root.append(h('a.skip-link', { href: '#main', onclick: (e) => { e.preventDefault(); main.focus(); } }, 'Skip to content'), header, main, footer);

  function paintTheme() {
    const t = savedTheme();
    clear(themeBtn);
    themeBtn.append(icon(t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'monitor', { size: 18 }));
  }

  /** The Appearance menu. On phones its button is hidden, and it opens from Menu instead. */
  function openThemeMenu(anchor = themeBtn) {
    const t = savedTheme();
    openMenu(anchor, [
      { heading: 'Appearance' },
      { label: 'System', icon: 'monitor', checked: t === 'system', run: () => { applyTheme('system'); paintTheme(); } },
      { label: 'Light', icon: 'sun', checked: t === 'light', run: () => { applyTheme('light'); paintTheme(); } },
      { label: 'Dark', icon: 'moon', checked: t === 'dark', run: () => { applyTheme('dark'); paintTheme(); } },
    ], { align: 'end', label: 'Appearance' });
  }

  function openMobileMenu() {
    openMenu(menuBtn, [
      { label: 'Help center home', icon: 'house', run: () => nav('') },
      { label: 'Submit a request', icon: 'send', run: () => nav('/new') },
      { label: 'My requests', icon: 'inbox', run: () => nav('/requests') },
      { separator: true },
      { label: 'Appearance', icon: 'monitor', run: () => setTimeout(() => openThemeMenu(menuBtn), 0) },
    ], { align: 'end', label: 'Menu' });
  }

  function paintChrome(current) {
    clear(brandEl);
    const name = info?.portal?.title || info?.name || 'Help center';
    brandEl.append(h('span.hc-mark', { 'aria-hidden': 'true' }, initials(info?.name || 'Help')), h('span.hc-brand-name', name));
    brandEl.setAttribute('aria-label', `${name} home`);
    clear(navEl);
    const navLink = (href, label, key, glyph) => h('a.hc-nav-link', { href: link(href), 'aria-current': current === key ? 'page' : undefined }, icon(glyph, { size: 16 }), label);
    navEl.append(navLink('/requests', 'My requests', 'requests', 'inbox'), h('a.btn.btn-primary.hc-cta', { href: link('/new'), 'aria-current': current === 'new' ? 'page' : undefined }, 'Submit a request'));
    clear(footer);
    footer.append(h('div.hc-footer-inner',
      h('span', info?.name ? `${info.name} help center` : 'Help center'),
      h('span.spacer'),
      h('a', { href: `${location.pathname}${location.search}#/home` }, 'Agent sign in'),
      h('span.subtle', '·'),
      h('span', 'Powered by ', h('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Puter'))));
    paintTheme();
  }

  function applyBrand() {
    const color = info?.portal?.color;
    if (color && /^#[0-9a-f]{6}$/i.test(color)) {
      root.style.setProperty('--hc-brand', color);
      root.style.setProperty('--hc-on-brand', onColor(color));
      // The page, surface and text colors of each theme (see tokens.css).
      const light = { bg: '#ffffff', surface: '#ffffff', text: '#1d2126' };
      const dark = { bg: '#15171a', surface: '#1b1e22', text: '#e8eaed' };
      root.style.setProperty('--hc-brand-text-light', brandText(color, light));
      root.style.setProperty('--hc-brand-text-dark', brandText(color, dark));
      root.style.setProperty('--hc-focus-light', brandFocus(color, light));
      root.style.setProperty('--hc-focus-dark', brandFocus(color, dark));
      root.classList.add('hc-branded');
    } else {
      root.style.removeProperty('--hc-brand');
      root.style.removeProperty('--hc-on-brand');
      root.style.removeProperty('--hc-brand-text-light');
      root.style.removeProperty('--hc-brand-text-dark');
      root.style.removeProperty('--hc-focus-light');
      root.style.removeProperty('--hc-focus-dark');
      root.classList.remove('hc-branded');
    }
  }

  function setTitle(out, t) {
    if (out && !out.isConnected) return;
    const site = info?.portal?.title || info?.name || 'Help center';
    document.title = t ? `${t} - ${site}` : site;
  }

  function focusHeading() {
    const h1 = main.querySelector('h1');
    if (h1) {
      h1.setAttribute('tabindex', '-1');
      h1.focus({ preventScroll: true });
    }
    // The help center's root is what scrolls (the page body does not).
    root.scrollTop = 0;
  }

  /* ----------------------------------------------------------- data */
  function loadArticles() {
    if (articles) return Promise.resolve(articles);
    articlesPromise ||= api.articles().then((r) => {
      articles = r.articles || [];
      return articles;
    }).catch((e) => {
      articlesPromise = null;
      throw e;
    });
    return articlesPromise;
  }

  function sectionsOf(categoryId) {
    return (info?.kb?.sections || []).filter((s) => s.categoryId === categoryId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  function categories() {
    return [...(info?.kb?.categories || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  function pathOf(sectionId) {
    const section = (info?.kb?.sections || []).find((s) => s.id === sectionId) || null;
    const category = section ? (info?.kb?.categories || []).find((c) => c.id === section.categoryId) || null : null;
    return { section, category };
  }

  /* ----------------------------------------------------- shared bits */
  function searchForm({ value = '', large = false, label = 'Search the help center' } = {}) {
    const id = uid('hc-q');
    const input = h(`input#${id}.hc-search-input`, { type: 'search', name: 'q', value, placeholder: 'Search for answers', autocomplete: 'off', 'aria-label': label });
    return h(`form.hc-search${large ? '.large' : ''}`, {
      role: 'search',
      onsubmit: (e) => {
        e.preventDefault();
        const q = input.value.trim();
        if (q) nav(`/search?q=${encodeURIComponent(q)}`);
        else input.focus();
      },
    }, icon('search', { size: large ? 20 : 16 }), input, h('button.btn.btn-primary', { type: 'submit' }, 'Search'));
  }

  function crumbs(items) {
    return h('nav.hc-crumbs', { 'aria-label': 'Breadcrumb' }, h('ol', items.map((it, i) =>
      h('li', i ? icon('chevron-right', { size: 12 }) : null, it.href ? h('a', { href: it.href }, it.label) : h('span', { 'aria-current': 'page' }, it.label)))));
  }

  function articleItem(a, { excerpt = false, current = false } = {}) {
    return h('li', h(`a.hc-article-link${current ? '.current' : ''}`, { href: link(`/articles/${a.id}`), 'aria-current': current ? 'page' : undefined },
      icon('file-text', { size: 15 }),
      h('span.hc-article-text', h('span.hc-article-title', a.title), excerpt && a.excerpt ? h('span.hc-article-excerpt', a.excerpt) : null)));
  }

  function needHelp() {
    return h('section.hc-help-cta', { 'aria-labelledby': 'hc-cta-title' },
      h('div.hc-help-cta-icon', icon('life-buoy', { size: 22 })),
      h('div.grow', h('h2#hc-cta-title', 'Still need help?'), h('p', 'Send us a request and our team will get back to you.')),
      h('a.btn.btn-primary', { href: link('/new') }, 'Submit a request'));
  }

  function loading() {
    return h('div.hc-loading', spinner('Loading'));
  }

  function errorView(e) {
    const status = e?.status;
    const title = status === 404 ? 'We could not find that page' : status === 403 ? 'This link is not valid' : status === 429 ? 'Please slow down' : status === 0 ? 'You seem to be offline' : 'Something went wrong';
    const text = status === 403
      ? 'The request link may be incomplete or out of date. Open the latest link from your email, or check My requests.'
      : e?.message || 'Please try again in a moment.';
    return h('div.hc-container.hc-narrow', h('div.hc-error',
      h('div.hc-error-icon', icon(status === 0 ? 'wifi-off' : status === 403 ? 'lock' : 'circle-question-mark', { size: 24 })),
      h('h1', title), h('p', text),
      h('div.row', h('a.btn', { href: link() }, 'Help center home'), status === 403 ? h('a.btn', { href: link('/requests') }, 'My requests') : null)));
  }

  /* ----------------------------------------------------------- pages */

  async function pageHome() {
    const out = view;
    setTitle(out, '');
    const hero = h('section.hc-hero', h('div.hc-container',
      h('h1', info.portal?.title || info.name),
      info.portal?.intro ? h('p.hc-hero-intro', info.portal.intro) : null,
      searchForm({ large: true })));
    const body = h('div.hc-container.hc-home', loading());
    out.append(hero, body);
    const list = await loadArticles();
    clear(body);
    const promoted = list.filter((a) => a.promoted);
    if (promoted.length) {
      body.append(h('section.hc-block', { 'aria-labelledby': 'hc-promoted' },
        h('h2#hc-promoted.hc-block-title', 'Popular articles'),
        h('ul.hc-promoted', promoted.slice(0, 6).map((a) => h('li', h('a.hc-promo-card', { href: link(`/articles/${a.id}`) },
          h('span.hc-promo-title', a.title), a.excerpt ? h('span.hc-promo-excerpt', a.excerpt) : null, h('span.hc-promo-more', 'Read article', icon('chevron-right', { size: 14 }))))))));
    }
    const cats = categories();
    const grid = h('div.hc-cats');
    for (const c of cats) {
      const sections = sectionsOf(c.id).map((s) => ({ s, items: list.filter((a) => a.section === s.id) })).filter((x) => x.items.length);
      if (!sections.length) continue;
      grid.append(h('section.hc-cat', { 'aria-labelledby': `cat-${c.id}` },
        h('h2.hc-cat-title', { id: `cat-${c.id}` }, c.name),
        c.desc ? h('p.hc-cat-desc', c.desc) : null,
        sections.map(({ s, items }) => h('div.hc-sec',
          h('h3', h('a', { href: link(`/sections/${s.id}`) }, s.name)),
          h('ul.hc-article-list', items.slice(0, 5).map((a) => articleItem(a))),
          items.length > 5 ? h('a.hc-see-all', { href: link(`/sections/${s.id}`) }, `See all ${items.length} articles`, icon('chevron-right', { size: 13 })) : null))));
    }
    const loose = list.filter((a) => !pathOf(a.section).section);
    if (loose.length) {
      grid.append(h('section.hc-cat', { 'aria-labelledby': 'cat-more' }, h('h2#cat-more.hc-cat-title', cats.length ? 'More articles' : 'Articles'), h('ul.hc-article-list', loose.slice(0, 10).map((a) => articleItem(a)))));
    }
    if (grid.childElementCount) body.append(h('section.hc-block', { 'aria-label': 'Browse by topic' }, grid));
    if (!list.length) {
      body.append(h('div.hc-empty', icon('book-open', { size: 22 }), h('h2', 'No articles yet'), h('p', 'Our team has not published any help articles yet. Send us a request and we will answer you directly.')));
    }
    body.append(needHelp());
  }

  async function pageSearch(q) {
    const out = view;
    setTitle(out, q ? `Search: ${q}` : 'Search');
    const results = h('div.hc-results', loading());
    out.append(h('section.hc-hero.compact', h('div.hc-container', searchForm({ value: q }))), h('div.hc-container.hc-narrow', results));
    const list = await loadArticles();
    const found = searchArticles(list, q);
    clear(results);
    results.append(h('h1.hc-results-title', found.length ? `${found.length} result${found.length === 1 ? '' : 's'} for "${q}"` : `No results for "${q}"`));
    announce(found.length ? `${found.length} results` : 'No results');
    if (found.length) {
      results.append(h('ul.hc-result-list', found.map((a) => {
        const { section, category } = pathOf(a.section);
        return h('li', h('a.hc-result', { href: link(`/articles/${a.id}`) },
          h('span.hc-result-title', a.title),
          a.excerpt ? h('span.hc-result-excerpt', a.excerpt) : null,
          section ? h('span.hc-result-path', [category?.name, section.name].filter(Boolean).join(' / ')) : null));
      })));
    } else {
      results.append(h('p.hc-muted', 'Try fewer or different words, or browse the topics on the home page.'));
    }
    results.append(needHelp());
  }

  async function pageSection(id) {
    const out = view;
    const list = await loadArticles();
    const { section, category } = pathOf(id);
    if (!section) {
      out.append(errorView({ status: 404 }));
      setTitle(out, 'Not found');
      return;
    }
    setTitle(out, section.name);
    const items = list.filter((a) => a.section === id);
    out.append(h('div.hc-container.hc-narrow.hc-page',
      crumbs([{ label: 'Help center', href: link() }, category ? { label: category.name } : null, { label: section.name }].filter(Boolean)),
      h('h1', section.name),
      section.desc ? h('p.hc-lead', section.desc) : null,
      items.length ? h('ul.hc-article-list.spacious', items.map((a) => articleItem(a, { excerpt: true }))) : h('p.hc-muted', 'There are no articles in this section yet.'),
      needHelp()));
  }

  async function pageArticle(id) {
    const out = view;
    let res;
    try {
      [res] = await Promise.all([api.article(id), loadArticles().catch(() => [])]);
    } catch (e) {
      out.append(errorView(e));
      setTitle(out, 'Not found');
      return;
    }
    const a = res.article;
    setTitle(out, a.title);
    const { section, category } = pathOf(a.section);
    const siblings = (articles || []).filter((x) => x.section && x.section === a.section);
    const related = (articles || []).filter((x) => x.id !== a.id && x.section !== a.section && (x.labels || []).some((l) => (a.labels || []).includes(l))).slice(0, 5);
    const body = h('div.prose.hc-body');
    body.innerHTML = sanitizeHtml(res.body || '');
    const votes = readJson(VOTE_KEY, {});
    const voteKey = `${server}/${desk}/${a.id}`;
    const voteBox = h('section.hc-vote', { 'aria-labelledby': 'hc-vote-q' });
    const paintVote = (done) => {
      clear(voteBox);
      if (done) {
        voteBox.append(h('p#hc-vote-q', { role: 'status' }, icon('circle-check', { size: 16 }), done === 'up' ? 'Thanks for your feedback.' : 'Thanks. We will use your feedback to improve this article.'),
          done === 'down' ? h('a.btn.btn-sm', { href: link('/new') }, 'Ask our team') : '');
        return;
      }
      const vote = async (up) => {
        voteBox.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        try {
          await api.vote(a.id, up);
        } catch (e) {
          if (e.status !== 429) {
            toastError(e);
            voteBox.querySelectorAll('button').forEach((b) => { b.disabled = false; });
            return;
          }
        }
        votes[voteKey] = up ? 'up' : 'down';
        writeJson(VOTE_KEY, votes);
        paintVote(votes[voteKey]);
      };
      voteBox.append(h('p#hc-vote-q', 'Was this article helpful?'),
        h('div.row', h('button.btn.btn-sm', { type: 'button', onclick: () => vote(true) }, icon('thumbs-up', { size: 14 }), 'Yes'),
          h('button.btn.btn-sm', { type: 'button', onclick: () => vote(false) }, icon('thumbs-down', { size: 14 }), 'No')));
    };
    paintVote(votes[voteKey]);
    out.append(h('div.hc-container.hc-page',
      crumbs([{ label: 'Help center', href: link() }, category ? { label: category.name } : null, section ? { label: section.name, href: link(`/sections/${section.id}`) } : null, { label: a.title }].filter(Boolean)),
      h('div.hc-article-grid',
        h('article.hc-article', { 'aria-labelledby': 'hc-article-title' },
          h('h1#hc-article-title', a.title),
          h('p.hc-article-meta', { title: fullDate(a.updatedAt) }, `Updated ${shortDate(a.updatedAt)}`),
          body,
          voteBox,
          needHelp()),
        h('aside.hc-article-side', { 'aria-label': 'More articles' },
          siblings.length > 1 ? h('section', h('h2', section ? `In ${section.name}` : 'In this section'), h('ul.hc-article-list.compact', siblings.slice(0, 12).map((x) => articleItem(x, { current: x.id === a.id })))) : null,
          related.length ? h('section', h('h2', 'Related articles'), h('ul.hc-article-list.compact', related.map((x) => articleItem(x)))) : null))));
  }

  async function pageNew() {
    const out = view;
    setTitle(out, 'Submit a request');
    // The server refuses requests from visitors who are not signed in when
    // the desk asks for it, so offer the sign-in instead of a form that
    // cannot be sent.
    if (info.portal?.signInRequired && !isSignedIn()) {
      const btn = h('button.btn.btn-primary.btn-lg', { type: 'button', disabled: !sdk()?.auth }, 'Sign in with Puter');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await signIn();
          if (isSignedIn()) render(parse());
        } catch {
          /* closed the sign-in window */
        }
        btn.disabled = false;
      });
      out.append(h('div.hc-container.hc-narrow.hc-page',
        crumbs([{ label: 'Help center', href: link() }, { label: 'Submit a request' }]),
        h('h1', 'Submit a request'),
        h('div.hc-card.hc-signin',
          h('p.hc-lead', 'Sign in with your free Puter account to send a request. Your requests and our replies will then be with you on any device.'),
          btn)));
      return;
    }
    const me = readJson(ME_KEY, {});
    let user = null;
    if (isSignedIn()) user = await currentUser().catch(() => null);
    const ids = { name: uid('n'), email: uid('e'), subject: uid('s'), desc: uid('d') };
    const errs = {};
    const errEl = (k) => (errs[k] = h('p.field-error', { id: `${ids[k] || k}-err`, role: 'alert' }));
    const name = h(`input#${ids.name}.input`, { autocomplete: 'name', maxlength: 120, value: me.name || '' });
    const email = h(`input#${ids.email}.input`, { type: 'email', autocomplete: 'email', maxlength: 254, required: true, value: me.email || user?.email || '', 'aria-describedby': `${ids.email}-err` });
    const subject = h(`input#${ids.subject}.input`, { maxlength: LIMITS.subject, required: true, 'aria-describedby': `${ids.subject}-err` });
    const desc = h(`textarea#${ids.desc}.textarea`, { rows: 7, required: true, maxlength: 20000, 'aria-describedby': `${ids.desc}-hint ${ids.desc}-err` });
    const suggest = h('section.hc-suggest', { hidden: true, 'aria-live': 'polite', 'aria-label': 'Suggested articles' });
    const custom = (info.fields || []).map((f) => customControl(f));
    const submitBtn = h('button.btn.btn-primary.btn-lg', { type: 'submit' }, 'Submit request');
    const formEl = h('form.hc-form', { noValidate: true, onsubmit: (e) => { e.preventDefault(); send(); } },
      h('div.hc-form-row',
        h('div.field', h('label.field-label', { for: ids.name }, 'Your name'), name),
        h('div.field', h('label.field-label', { for: ids.email }, 'Your email', h('span.req', { 'aria-hidden': 'true' }, '*')), email, errEl('email'))),
      h('div.field', h('label.field-label', { for: ids.subject }, 'Subject', h('span.req', { 'aria-hidden': 'true' }, '*')), subject, errEl('subject')),
      suggest,
      h('div.field', h('label.field-label', { for: ids.desc }, 'Description', h('span.req', { 'aria-hidden': 'true' }, '*')), desc,
        h('p.field-hint', { id: `${ids.desc}-hint` }, 'Include as much detail as you can: what you tried, what you expected, and any error messages.'), errEl('desc')),
      custom.map((c) => c.el),
      h('div.hc-form-foot', h('p.hc-muted', 'Fields marked with * are required.'), submitBtn));
    const wrap = h('div.hc-container.hc-narrow.hc-page',
      crumbs([{ label: 'Help center', href: link() }, { label: 'Submit a request' }]),
      h('h1', 'Submit a request'),
      h('p.hc-lead', 'Tell us what you need and we will get back to you by email.'),
      h('div.hc-card', formEl));
    out.append(wrap);

    const runSuggest = debounce(async () => {
      const q = `${subject.value} ${desc.value.slice(0, 200)}`.trim();
      if (q.length < 4) {
        suggest.hidden = true;
        return;
      }
      const list = await loadArticles().catch(() => []);
      // Only suggest articles whose title matches, so the hints stay relevant.
      const found = searchArticles(list, q, 3, { minScore: 3 });
      clear(suggest);
      suggest.hidden = !found.length;
      if (found.length) {
        suggest.append(h('h2', icon('sparkles', { size: 15 }), 'These articles might answer your question'),
          h('ul.hc-article-list.compact', found.map((a) => h('li', h('a.hc-article-link', { href: link(`/articles/${a.id}`), target: '_blank', rel: 'noopener' }, icon('file-text', { size: 15 }), h('span.hc-article-text', h('span.hc-article-title', a.title)), icon('external-link', { size: 13 }))))));
      }
    }, 400);
    subject.addEventListener('input', runSuggest);
    desc.addEventListener('input', runSuggest);

    function customControl(f) {
      const id = uid(`f-${f.id}`);
      let control;
      let get;
      if (f.type === 'dropdown') {
        control = h(`select#${id}.input`, h('option', { value: '' }, 'Choose'), (f.options || []).map((o) => h('option', { value: o.value }, o.label)));
        get = () => control.value;
      } else if (f.type === 'checkbox') {
        control = h(`input#${id}`, { type: 'checkbox' });
        get = () => (control.checked ? true : '');
        const err = h('p.field-error', { role: 'alert' });
        return {
          f, get, err, control,
          el: h('div.field', h('label.checkbox', control, f.title, f.required ? h('span.req', { 'aria-hidden': 'true' }, '*') : null), f.desc ? h('p.field-hint', f.desc) : null, err),
        };
      } else if (f.type === 'textarea') {
        control = h(`textarea#${id}.textarea`, { rows: 3 });
        get = () => control.value.trim();
      } else {
        control = h(`input#${id}.input`, { type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text' });
        get = () => control.value.trim();
      }
      const err = h('p.field-error', { role: 'alert' });
      return {
        f, get, err, control,
        el: h('div.field', h('label.field-label', { for: id }, f.title, f.required ? h('span.req', { 'aria-hidden': 'true' }, '*') : null), control, f.desc ? h('p.field-hint', f.desc) : null, err),
      };
    }

    function setErr(key, input, msg) {
      errs[key].textContent = msg || '';
      if (msg) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }

    async function send() {
      const em = email.value.trim().toLowerCase();
      setErr('email', email, isEmail(em) ? '' : 'Enter a valid email address so we can reply');
      setErr('subject', subject, subject.value.trim() ? '' : 'Add a short subject');
      setErr('desc', desc, desc.value.trim() ? '' : 'Describe your request');
      let firstBad = [email, subject, desc].find((x) => x.getAttribute('aria-invalid') === 'true');
      const fields = {};
      for (const c of custom) {
        const v = c.get();
        if (c.err) {
          c.err.textContent = c.f.required && !v ? `${c.f.title} is required` : '';
          if (c.f.required && !v) {
            c.control.setAttribute('aria-invalid', 'true');
            firstBad ||= c.control;
          } else c.control.removeAttribute('aria-invalid');
        }
        if (v !== '' && v !== undefined) fields[c.f.id] = c.f.type === 'number' ? Number(v) : v;
      }
      if (firstBad) {
        firstBad.focus();
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending';
      try {
        const res = await api.submit({ name: name.value.trim(), email: em, subject: subject.value.trim(), description: desc.value, fields });
        writeJson(ME_KEY, { name: name.value.trim(), email: em });
        if (res.id && res.key) saveRequest(server, desk, { id: res.id, key: res.key, subject: subject.value.trim() });
        clear(wrap);
        wrap.append(h('div.hc-card.hc-success', { role: 'status' },
          h('div.hc-success-icon', icon('circle-check', { size: 28 })),
          h('h1', 'Your request was received'),
          res.id ? h('p', `Request #${res.id}. We will reply to ${em}. You can also follow it here at any time.`) : h('p', 'Thank you. Our team will get back to you by email.'),
          h('div.row.hc-success-actions',
            res.id ? h('a.btn.btn-primary', { href: link(`/requests/${res.id}?key=${res.key}`) }, 'View your request') : null,
            h('a.btn', { href: link() }, 'Back to the help center'))));
        focusHeading();
      } catch (e) {
        if (e.status === 400 && /email/i.test(e.message)) setErr('email', email, e.message);
        toastError(e);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit request';
      }
    }
  }

  async function pageRequests() {
    const out = view;
    setTitle(out, 'My requests');
    const listEl = h('div.hc-req-list', loading());
    out.append(h('div.hc-container.hc-narrow.hc-page',
      crumbs([{ label: 'Help center', href: link() }, { label: 'My requests' }]),
      h('div.hc-page-head', h('h1', 'My requests'), h('a.btn.btn-primary', { href: link('/new') }, icon('plus', { size: 15 }), 'New request')),
      listEl));
    const local = savedRequests(server, desk);
    const rows = new Map();
    for (const r of local) rows.set(r.id, { id: r.id, key: r.key, subject: r.subject, createdAt: r.at, status: null, updatedAt: null, local: true });
    let signedInNote = null;
    if (isSignedIn()) {
      try {
        const res = await api.mine();
        for (const r of res.requests || []) rows.set(r.id, { ...rows.get(r.id), ...r });
      } catch {
        /* show what this device knows */
      }
    } else {
      signedInNote = h('p.hc-note', icon('info', { size: 14 }), 'Requests you sent from this device are listed here. Open the link in your emails to see a request from another device.');
    }
    clear(listEl);
    const list = [...rows.values()].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    if (!list.length) {
      listEl.append(h('div.hc-empty', icon('inbox', { size: 22 }), h('h2', 'No requests yet'), h('p', 'When you send a request from this device it will show up here.'), h('a.btn.btn-primary', { href: link('/new') }, 'Submit a request')));
      return;
    }
    const ul = h('ul.hc-requests');
    for (const r of list) {
      const statusEl = h('span.hc-status-slot');
      const metaEl = h('span.hc-req-meta', r.updatedAt ? `Updated ${relTime(r.updatedAt)}` : r.createdAt ? `Sent ${relTime(r.createdAt)}` : '');
      const titleEl = h('span.hc-req-subject', r.subject || `Request #${r.id}`);
      if (r.status) statusEl.append(statusPill(r.status));
      ul.append(h('li', h('a.hc-req', { href: link(`/requests/${r.id}${r.key ? `?key=${r.key}` : ''}`) },
        h('span.hc-req-main', titleEl, h('span.hc-req-sub', `#${r.id}`, h('span', '·'), metaEl)), statusEl, icon('chevron-right', { size: 16 }))));
      if (!r.status && r.key) {
        api.request(r.id, r.key).then((res) => {
          clear(statusEl);
          statusEl.append(statusPill(res.ticket.status));
          titleEl.textContent = res.ticket.subject;
          metaEl.textContent = `Updated ${relTime(res.ticket.updatedAt)}`;
        }).catch(() => {
          clear(statusEl);
          statusEl.append(h('span.hc-pill.muted', 'Unavailable'));
        });
      }
    }
    listEl.append(ul, signedInNote || '');
  }

  function statusPill(s) {
    return h(`span.hc-pill.st-${s}`, statusLabel(s));
  }

  async function pageRequest(id, keyParam) {
    const out = view;
    const key = keyParam || keyFor(server, desk, id);
    let data;
    try {
      data = await api.request(id, key);
    } catch (e) {
      out.append(errorView(e));
      setTitle(out, 'Request');
      return;
    }
    if (key && !keyFor(server, desk, id)) saveRequest(server, desk, { id, key, subject: data.ticket.subject });
    const wrap = h('div.hc-container.hc-narrow.hc-page');
    out.append(wrap);
    let poll = null;
    // What the customer is typing survives a redraw (a new reply arriving,
    // marking it solved, changing the rating).
    const typed = { reply: '', rating: '' };

    function paint() {
      const t = data.ticket;
      setTitle(out, t.subject);
      clear(wrap);
      const status = PUBLIC_STATUS[t.status] || PUBLIC_STATUS.open;
      wrap.append(
        crumbs([{ label: 'Help center', href: link() }, { label: 'My requests', href: link('/requests') }, { label: `#${t.id}` }]),
        h('header.hc-req-head',
          h('div.grow', h('h1', t.subject), h('p.hc-req-info', `Request #${t.id}`, h('span', '·'), h('span', { title: fullDate(t.createdAt) }, `Opened ${shortDate(t.createdAt)}`), h('span', '·'), h('span', `Updated ${relTime(t.updatedAt)}`))),
          h('div.hc-req-status', statusPill(t.status), h('span.hc-muted', status.hint))),
      );
      if (t.followUp) {
        wrap.append(h('p.hc-banner', icon('info', { size: 15 }), 'This request was closed and continued in ', h('a', { href: link(`/requests/${t.followUp}${keyFor(server, desk, t.followUp) ? `?key=${keyFor(server, desk, t.followUp)}` : ''}`) }, `request #${t.followUp}`), '.'));
      }
      const thread = h('ol.hc-thread', { 'aria-label': 'Conversation' });
      const requesterName = data.requester?.name || 'You';
      for (const e of data.events) {
        const agent = e.by?.type === 'agent';
        const who = agent ? e.by.name || 'Support' : e.by?.name || requesterName;
        const body = h('div.prose.hc-msg-body');
        body.innerHTML = sanitizeHtml(e.html || '');
        thread.append(h(`li.hc-msg${agent ? '.agent' : '.customer'}`,
          h('span.hc-avatar', { 'aria-hidden': 'true' }, initials(who)),
          h('div.hc-msg-main',
            h('div.hc-msg-head', h('strong', who), agent ? h('span.hc-tag', 'Support') : null, h('time', { datetime: new Date(e.at).toISOString(), title: fullDate(e.at) }, relTime(e.at))),
            body,
            e.attachments?.length ? h('div.hc-atts', e.attachments.map((att) => h('button.hc-att', { type: 'button', onclick: () => openFile(att) }, icon('paperclip', { size: 13 }), h('span.ellipsis', att.name), h('span.hc-muted', fileSize(att.size))))) : null)));
      }
      wrap.append(thread);
      if (t.csatEnabled && (t.status === 'solved' || t.status === 'closed')) wrap.append(ratingBox(t));
      wrap.append(replyBox(t));
    }

    async function openFile(att) {
      try {
        openBlob(await api.file(att.id, id, key), att.name);
      } catch (e) {
        toastError(e);
      }
    }

    function ratingBox(t) {
      const box = h('section.hc-card.hc-rate', { 'aria-labelledby': 'hc-rate-title' });
      let score = t.csat?.score || null;
      let editing = !t.csat;
      const draw = () => {
        clear(box);
        if (!editing) {
          box.append(h('div.hc-rate-done',
            icon(score === 'good' ? 'thumbs-up' : 'thumbs-down', { size: 18 }),
            h('p#hc-rate-title', `You rated this support ${score === 'good' ? 'Good' : 'Bad'}. Thank you for the feedback.`),
            h('button.link-btn', { type: 'button', onclick: () => {
              // Sending again replaces the comment: start from the one sent.
              typed.rating = data.ticket?.csat?.comment || '';
              editing = true;
              draw();
              box.querySelector('.hc-rate-btn.selected, .hc-rate-btn')?.focus();
            } }, 'Change rating')));
          return;
        }
        const commentId = uid('rate-c');
        const comment = h(`textarea#${commentId}.textarea`, { rows: 2, maxlength: 2000, placeholder: 'Tell us more (optional)', oninput: () => { typed.rating = comment.value; } });
        comment.value = typed.rating;
        const choice = (val, label, glyph) => h(`button.hc-rate-btn${score === val ? '.selected' : ''}`, {
          type: 'button', 'aria-pressed': String(score === val),
          onclick: () => { score = val; draw(); box.querySelector('textarea')?.focus(); },
        }, icon(glyph, { size: 18 }), label);
        const send = h('button.btn.btn-primary', {
          type: 'button', disabled: !score,
          onclick: async () => {
            send.disabled = true;
            try {
              const res = await api.rate(id, key, score, comment.value.trim());
              data.ticket = res.ticket;
              typed.rating = '';
              editing = false;
              draw();
              box.querySelector('.link-btn')?.focus();
              announce('Rating sent');
            } catch (e) {
              toastError(e);
              send.disabled = false;
            }
          },
        }, 'Send rating');
        box.append(h('h2#hc-rate-title', 'How would you rate the support you received?'),
          h('div.hc-rate-choices', { role: 'group', 'aria-label': 'Rating' }, choice('good', 'Good, I am satisfied', 'thumbs-up'), choice('bad', 'Bad, I am unsatisfied', 'thumbs-down')),
          score ? h('div.field', h('label.sr-only', { for: commentId }, 'Comment'), comment) : '',
          score ? h('div.row', send) : '');
      };
      draw();
      return box;
    }

    function replyBox(t) {
      const box = h('section.hc-card.hc-reply', { 'aria-labelledby': 'hc-reply-title' });
      const textId = uid('reply');
      const text = h(`textarea#${textId}.textarea`, { rows: 4, maxlength: 20000, placeholder: t.status === 'closed' ? 'Write a follow-up' : 'Write a reply' });
      const sendBtn = h('button.btn.btn-primary', { type: 'button', disabled: true }, t.status === 'closed' ? 'Send follow-up' : 'Send reply');
      text.value = typed.reply;
      sendBtn.disabled = !text.value.trim();
      text.addEventListener('input', () => {
        typed.reply = text.value;
        sendBtn.disabled = !text.value.trim();
      });
      text.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && text.value.trim()) {
          e.preventDefault();
          sendBtn.click();
        }
      });
      sendBtn.addEventListener('click', async () => {
        const body = text.value.trim();
        if (!body) return;
        sendBtn.disabled = true;
        let res;
        try {
          res = await api.reply(id, key, body);
        } catch (e) {
          toastError(e);
          sendBtn.disabled = false;
          return;
        }
        // Sent: clear the box at once, so a failed refresh below cannot
        // invite sending the same reply again.
        text.value = '';
        typed.reply = '';
        if (res.followUp) {
          saveRequest(server, desk, { id: res.followUp.id, key: res.followUp.key, subject: t.subject });
          toast(`Your follow-up was sent as request #${res.followUp.id}.`, { kind: 'success' });
          nav(`/requests/${res.followUp.id}?key=${res.followUp.key}`);
          return;
        }
        toast('Reply sent.', { kind: 'success' });
        try {
          data = await api.request(id, key);
          paint();
          wrap.querySelector('.hc-thread li:last-child')?.scrollIntoView({ block: 'nearest' });
          // Back in the (redrawn) reply box, ready for another message.
          wrap.querySelector('.hc-reply textarea')?.focus({ preventScroll: true });
        } catch {
          /* the reply is saved; the next refresh shows it */
        }
      });
      const solveBtn = ['open', 'pending'].includes(t.status) ? h('button.btn', {
        type: 'button',
        onclick: async () => {
          solveBtn.disabled = true;
          try {
            const res = await api.solve(id, key);
            data.ticket = res.ticket;
            paint();
            // The button is gone: on to rating the support, or the reply box.
            wrap.querySelector('.hc-rate-btn, .hc-reply textarea')?.focus();
            toast('Marked as solved. Thank you!', { kind: 'success' });
          } catch (e) {
            toastError(e);
            solveBtn.disabled = false;
          }
        },
      }, icon('circle-check', { size: 15 }), 'Mark as solved') : null;
      const note = t.status === 'closed'
        ? h('p.hc-note', icon('info', { size: 14 }), 'This request is closed. Your message will open a new follow-up request.')
        : t.status === 'solved' ? h('p.hc-note', icon('info', { size: 14 }), 'This request is solved. Replying will reopen it.') : null;
      box.append(h('h2#hc-reply-title', t.status === 'closed' ? 'Need more help?' : 'Add a reply'), note || '', h('label.sr-only', { for: textId }, 'Your reply'), text,
        h('div.hc-reply-foot', solveBtn, h('span.spacer'), h('span.hc-muted.hc-kbd-hint', 'Ctrl+Enter to send'), sendBtn));
      return box;
    }

    paint();
    poll = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const active = document.activeElement;
      if (active && active.tagName === 'TEXTAREA' && active.value) return;
      try {
        const next = await api.request(id, key);
        if (next.ticket.updatedAt !== data.ticket.updatedAt || next.events.length !== data.events.length) {
          data = next;
          preserveFocus(wrap, paint);
          announce('The request was updated');
        }
      } catch {
        /* keep the current view */
      }
    }, 30000);
    return () => clearInterval(poll);
  }

  /* --------------------------------------------------------- routing */
  let token = 0;
  async function render(r) {
    if (r.path[0] !== 'help' || r.path[1] !== server || r.path[2] !== desk) return;
    const my = ++token;
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    const [page, arg] = r.path.slice(3);
    const current = page === 'new' ? 'new' : page === 'requests' ? 'requests' : null;
    paintChrome(current);
    clear(main);
    main.dataset.page = page || 'home';
    view = h('div.hc-view');
    main.append(view);
    // Pages load their data before drawing anything: show that something is
    // happening if it takes a moment, until the page adds its content.
    const spin = loading();
    spin.hidden = true;
    view.append(spin);
    const showSpin = setTimeout(() => { spin.hidden = false; }, 150);
    new MutationObserver((_, watch) => {
      if (view.childElementCount > 1 || !spin.isConnected) {
        clearTimeout(showSpin);
        spin.remove();
        watch.disconnect();
      }
    }).observe(view, { childList: true });
    try {
      let result;
      if (!page) result = await pageHome();
      else if (page === 'search') result = await pageSearch(String(r.query.q || '').trim());
      else if (page === 'sections' && arg) result = await pageSection(arg);
      else if (page === 'articles' && Number(arg) > 0) result = await pageArticle(Number(arg));
      else if (page === 'new') result = await pageNew();
      else if (page === 'requests' && Number(arg) > 0) result = await pageRequest(Number(arg), r.query.key || null);
      else if (page === 'requests') result = await pageRequests();
      else view.append(errorView({ status: 404 }));
      if (my !== token) {
        if (typeof result === 'function') result();
        return;
      }
      if (typeof result === 'function') cleanup = result;
      focusHeading();
    } catch (e) {
      if (my !== token) return;
      clear(main);
      main.append(errorView(e));
    }
  }

  async function boot() {
    main.append(loading());
    paintChrome(null);
    try {
      info = await api.info();
    } catch (e) {
      clear(main);
      if (e.status === 404) {
        main.append(h('div.hc-container.hc-narrow', h('div.hc-error',
          h('div.hc-error-icon', icon('life-buoy', { size: 24 })),
          h('h1', 'This help center is not available'),
          h('p', 'It may have been turned off or moved. If you were sent here by a support team, contact them another way.'))));
      } else main.append(errorView(e));
      setTitle(null, 'Help center');
      return;
    }
    applyBrand();
    onRoute(render);
    render(parse());
  }

  // When the SDK arrives after the first paint (slow networks), signed-in
  // state can change what "My requests" shows; the next visit picks it up.
  boot();
  return { api, navigate: nav, sdk };
}

export { PortalError, go, onColor as readableOn };
