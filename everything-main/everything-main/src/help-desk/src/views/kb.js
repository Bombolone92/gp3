/**
 * Knowledge base for agents: browse articles by status and section, read
 * them, write and publish them, and (administrators) organize categories
 * and sections. Published articles appear in the public help center.
 *
 *   #/kb                       all articles (?status=, ?section=, ?q=)
 *   #/kb/new                   new article (?section= preselects one)
 *   #/kb/articles/<id>         read an article
 *   #/kb/articles/<id>/edit    edit an article
 */
import './kb.css';
import { h, clear, uid, debounce, announce, composing } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openMenu } from '../ui/popover.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { selectField, tagsInput, emptyState, spinner, avatar } from '../ui/components.js';
import { createEditor } from '../ui/editor.js';
import { toast, toastError } from '../ui/toast.js';
import { relTime, fullDate, plural } from '../ui/format.js';
import { go } from '../ui/router.js';
import { bind } from '../ui/shortcuts.js';
import { sanitizeHtml } from '../shared/html.js';
import { randomId } from '../shared/ids.js';
import { app } from '../app.js';

/* ------------------------------------------------------------ helpers */

export function kbStructure(kb) {
  const categories = [...(kb?.categories || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const sections = [...(kb?.sections || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return categories.map((c) => ({ ...c, sections: sections.filter((s) => s.categoryId === c.id) }));
}

export function sectionPath(kb, sectionId) {
  const section = (kb?.sections || []).find((s) => s.id === sectionId) || null;
  const category = section ? (kb?.categories || []).find((c) => c.id === section.categoryId) || null : null;
  return { section, category };
}

/** Share of helpful votes, or null when nobody voted. */
export function helpfulness(a) {
  const up = a.up || 0;
  const down = a.down || 0;
  return up + down ? Math.round((up / (up + down)) * 100) : null;
}

/** Filter and order article summaries for the list. */
export function filterArticles(list, { status = null, section = null, q = '' } = {}) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return list
    .filter((a) => !status || a.status === status)
    .filter((a) => !section || (section === 'none' ? !a.section : a.section === section))
    .filter((a) => {
      if (!words.length) return true;
      const hay = `${a.title} ${a.excerpt || ''} ${(a.labels || []).join(' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function statusBadge(a) {
  return a.status === 'published' ? h('span.badge.kb-published', 'Published') : h('span.badge.kb-draft', 'Draft');
}

function articleUrl(id) {
  const base = app.helpCenterUrl();
  return base ? `${base}/articles/${id}` : null;
}

function draftKey(id) {
  return `help-desk:kb-draft:${app.ref}:${id ?? 'new'}`;
}

function readDraft(id) {
  try {
    return JSON.parse(localStorage.getItem(draftKey(id)) || 'null');
  } catch {
    return null;
  }
}

function writeDraft(id, value) {
  try {
    if (value) localStorage.setItem(draftKey(id), JSON.stringify(value));
    else localStorage.removeItem(draftKey(id));
  } catch {
    /* storage full or blocked */
  }
}

/* -------------------------------------------------------------- mount */

export function mount(main, ctx) {
  const sub = ctx.sub || [];
  if (sub[0] === 'new') return mountEditor(main, null, ctx.route.query || {});
  if (sub[0] === 'articles' && Number(sub[1]) > 0) {
    if (sub[2] === 'edit') return mountEditor(main, Number(sub[1]), {});
    return mountArticle(main, Number(sub[1]));
  }
  return mountList(main, ctx.route.query || {});
}

/* --------------------------------------------------------------- list */

function sideNav(side, current) {
  clear(side);
  const all = [...app.replica.articles.values()];
  const counts = { all: all.length, draft: 0, published: 0 };
  const bySection = new Map();
  for (const a of all) {
    counts[a.status === 'published' ? 'published' : 'draft']++;
    const k = a.section || 'none';
    bySection.set(k, (bySection.get(k) || 0) + 1);
  }
  const link = (href, label, n, active, glyph) =>
    h('a.side-link', { href, 'aria-current': active ? 'page' : undefined }, glyph ? icon(glyph, { size: 16 }) : null, h('span.ellipsis', label), h('span.count', String(n)));
  side.append(
    h('div.side-nav-head', h('h2', 'Knowledge base'),
      h('button.icon-btn', { type: 'button', 'aria-label': 'New article', title: 'New article', onclick: () => go('/kb/new') }, icon('plus', { size: 16 }))),
    link('#/kb', 'All articles', counts.all, !current.status && !current.section, 'book-open'),
    link('#/kb?status=draft', 'Drafts', counts.draft, current.status === 'draft' && !current.section, 'pencil'),
    link('#/kb?status=published', 'Published', counts.published, current.status === 'published' && !current.section, 'globe'),
  );
  const tree = kbStructure(app.replica.cfg.kb);
  side.append(h('div.side-group.kb-tree-head', h('span', 'Categories'),
    app.isAdmin ? h('button.link-btn', { type: 'button', onclick: () => manageCategories() }, 'Manage') : null));
  if (!tree.length) side.append(h('p.kb-side-empty', 'No categories yet.'));
  for (const c of tree) {
    side.append(h('div.kb-cat', h('span.ellipsis', c.name)));
    for (const s of c.sections) {
      side.append(link(`#/kb?section=${s.id}`, s.name, bySection.get(s.id) || 0, current.section === s.id, null));
    }
  }
  if (bySection.get('none')) side.append(link('#/kb?section=none', 'Not in a section', bySection.get('none'), current.section === 'none', 'folder'));
}

function mountList(main, query) {
  const side = h('nav.side-nav.kb-nav', { 'aria-label': 'Knowledge base' });
  const content = h('section.page.kb-main', { 'aria-labelledby': 'kb-title' });
  main.append(h('div.split-page', side, content));
  const state = { status: ['draft', 'published'].includes(query.status) ? query.status : null, section: query.section || null, q: query.q || '' };

  const searchId = uid('kb-q');
  const search = h(`input#${searchId}.input`, { type: 'search', placeholder: 'Search articles', value: state.q, autocomplete: 'off', 'aria-label': 'Search articles' });
  const body = h('div.kb-list-body');
  const countEl = h('p.page-sub');
  const title = () => {
    if (state.section) {
      if (state.section === 'none') return 'Not in a section';
      return sectionPath(app.replica.cfg.kb, state.section).section?.name || 'Section';
    }
    return state.status === 'draft' ? 'Drafts' : state.status === 'published' ? 'Published articles' : 'All articles';
  };
  const titleEl = h('h1#kb-title');
  const newBtn = h('button.btn.btn-primary', { type: 'button', onclick: () => go(`/kb/new${state.section && state.section !== 'none' ? `?section=${state.section}` : ''}`) }, icon('plus', { size: 15 }), 'New article');
  const hc = app.helpCenterUrl();
  // Phones hide the side navigation, so the same choices live in a select.
  const filterId = uid('kb-filter');
  const filter = h(`select#${filterId}.input.kb-mobile-filter`, {
    'aria-label': 'Show',
    onchange: () => {
      const v = filter.value;
      go(v.startsWith('section:') ? `/kb?section=${v.slice(8)}` : v ? `/kb?status=${v}` : '/kb');
    },
  },
  h('option', { value: '' }, 'All articles'), h('option', { value: 'draft' }, 'Drafts'), h('option', { value: 'published' }, 'Published'),
  kbStructure(app.replica.cfg.kb).map((c) => h('optgroup', { label: c.name }, c.sections.map((s) => h('option', { value: `section:${s.id}` }, s.name)))));
  filter.value = state.section ? `section:${state.section}` : state.status || '';
  content.append(h('div.page-inner',
    h('header.page-head', h('div.grow', titleEl, countEl),
      hc ? h('a.btn', { href: hc, target: '_blank', rel: 'noopener' }, icon('external-link', { size: 14 }), 'Help center') : null,
      newBtn),
    h('div.toolbar.kb-toolbar', h('div.search-input', icon('search', { size: 14 }), search), filter),
    body));

  function paint() {
    const all = [...app.replica.articles.values()];
    const list = filterArticles(all, state);
    titleEl.textContent = title();
    countEl.textContent = plural(list.length, 'article');
    clear(body);
    if (!all.length) {
      body.append(emptyState({
        glyph: 'book-open',
        title: 'Write your first article',
        text: 'Articles answer common questions so customers can help themselves in your help center, and agents can link them in replies.',
        action: h('button.btn.btn-primary', { type: 'button', onclick: () => go('/kb/new') }, icon('plus', { size: 14 }), 'New article'),
      }));
      return;
    }
    if (!list.length) {
      body.append(emptyState({ glyph: 'search', title: 'No matching articles', text: state.q ? 'Try different words or clear the search.' : 'Nothing here yet.' }));
      return;
    }
    const kb = app.replica.cfg.kb;
    const rows = list.map((a) => {
      const { section, category } = sectionPath(kb, a.section);
      const help = helpfulness(a);
      const open = () => go(`/kb/articles/${a.id}`);
      return h('tr', { tabindex: '0', onclick: open, onkeydown: (e) => { if (e.key === 'Enter') open(); } },
        h('td.kb-col-title', h('div.kb-title-cell',
          h('a.kb-title-link', { href: `#/kb/articles/${a.id}`, onclick: (e) => e.stopPropagation() }, a.promoted ? icon('star', { size: 13, label: 'Promoted' }) : null, a.title),
          a.excerpt ? h('span.ellipsis.kb-excerpt', a.excerpt) : null)),
        h('td.kb-col-section', section ? h('span.ellipsis', { title: `${category?.name || ''} / ${section.name}` }, section.name) : h('span.subtle', '-')),
        h('td.kb-col-status', statusBadge(a)),
        h('td.kb-col-updated', h('span', { title: fullDate(a.updatedAt) }, relTime(a.updatedAt))),
        h('td.kb-col-num', String(a.views || 0)),
        h('td.kb-col-num', help === null ? h('span.subtle', '-') : h('span', { title: `${a.up || 0} helpful, ${a.down || 0} not helpful` }, `${help}%`)));
    });
    body.append(h('div.kb-table-wrap', h('table.table.kb-table', { 'aria-label': title() },
      h('thead', h('tr', h('th', 'Title'), h('th.kb-col-section', 'Section'), h('th', 'Status'), h('th.kb-col-updated', 'Updated'), h('th.kb-col-num', 'Views'), h('th.kb-col-num', 'Helpful'))),
      h('tbody', rows))));
  }

  search.addEventListener('input', debounce(() => {
    state.q = search.value.trim();
    paint();
  }, 120));
  const onChange = (e) => {
    const k = e.detail?.kinds;
    if (!k || k.has('a') || k.has('c')) {
      sideNav(side, state);
      paint();
    }
  };
  app.replica.addEventListener('change', onChange);
  const unbind = bind('kb', { n: () => go('/kb/new') });
  sideNav(side, state);
  paint();
  return () => {
    app.replica.removeEventListener('change', onChange);
    unbind();
  };
}

/* ------------------------------------------------------------ article */

function mountArticle(main, id) {
  const side = h('nav.side-nav.kb-nav', { 'aria-label': 'Knowledge base' });
  // Not a live region: it holds the whole article, which screen readers
  // would read out on every repaint. Actions announce themselves in toasts.
  const content = h('section.page.kb-main', { 'aria-label': 'Article' });
  main.append(h('div.split-page', side, content));
  let destroyed = false;
  let body = null;

  function summary() {
    return app.replica.articles.get(id) || null;
  }

  function paint() {
    const a = summary();
    clear(content);
    if (!a) {
      content.append(h('div.page-inner', emptyState({ glyph: 'file-text', title: 'Article not found', text: 'It may have been deleted.', action: h('a.btn', { href: '#/kb' }, 'Back to the knowledge base') })));
      return;
    }
    sideNav(side, { section: a.section });
    const { section, category } = sectionPath(app.replica.cfg.kb, a.section);
    const help = helpfulness(a);
    const url = articleUrl(a.id);
    const moreBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'More article actions', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
      onclick: () => openMenu(moreBtn, [
        url ? { label: 'Copy help center link', icon: 'link', disabled: a.status !== 'published', run: () => copyLink(url) } : null,
        url ? { label: 'View in help center', icon: 'external-link', disabled: a.status !== 'published', run: () => window.open(url, '_blank', 'noopener') } : null,
        { label: a.promoted ? 'Stop promoting' : 'Promote on the help center home', icon: 'star', run: () => save({ promoted: !a.promoted }, a.promoted ? 'No longer promoted.' : 'Promoted.') },
        { separator: true },
        { label: 'Delete article', icon: 'trash', danger: true, run: () => remove(a) },
      ].filter(Boolean), { align: 'end', label: 'Article actions' }) }, icon('ellipsis', { size: 18 }));
    const publishBtn = a.status === 'published'
      ? h('button.btn', { type: 'button', onclick: () => save({ status: 'draft' }, 'Unpublished. It is no longer visible in the help center.') }, 'Unpublish')
      : h('button.btn', {
        type: 'button',
        // Wait for the body, and never publish an empty page (as in the editor).
        disabled: body === null,
        onclick: () => (body ? save({ status: 'published' }, 'Published to the help center.') : toastError({ message: 'Write the article before publishing it.' })),
      }, icon('globe', { size: 14 }), 'Publish');
    const bodyEl = h('div.prose.kb-body');
    if (body === null) bodyEl.append(h('div.kb-loading', spinner('Loading article')));
    else if (!body) bodyEl.append(h('p.muted', 'This article has no content yet.'));
    else bodyEl.innerHTML = sanitizeHtml(body);
    content.append(h('div.page-inner.kb-article',
      h('nav.kb-crumbs', { 'aria-label': 'Breadcrumb' }, h('a', { href: '#/kb' }, 'Knowledge base'),
        category ? [icon('chevron-right', { size: 12 }), h('span', category.name)] : null,
        section ? [icon('chevron-right', { size: 12 }), h('a', { href: `#/kb?section=${section.id}` }, section.name)] : null),
      h('header.kb-article-head',
        h('div.grow', h('h1', a.title),
          h('div.kb-meta',
            statusBadge(a),
            a.promoted ? h('span.kb-meta-item', icon('star', { size: 13 }), 'Promoted') : null,
            h('span.kb-meta-item', avatar(app.memberName(a.author) || 'Agent', { size: 'sm', agent: true }), app.memberName(a.updatedBy || a.author) || 'An agent'),
            h('span.kb-meta-item', { title: fullDate(a.updatedAt) }, `Updated ${relTime(a.updatedAt)}`),
            a.words ? h('span.kb-meta-item', `${Math.max(1, Math.round(a.words / 220))} min read`) : null)),
        h('div.kb-actions', h('a.btn.btn-primary', { href: `#/kb/articles/${a.id}/edit` }, icon('pencil', { size: 14 }), 'Edit'), publishBtn, moreBtn)),
      h('div.kb-article-grid',
        bodyEl,
        h('aside.kb-stats', { 'aria-label': 'Article statistics' },
          h('div.kb-stat', h('span.kb-stat-value', String(a.views || 0)), h('span.kb-stat-label', 'Views')),
          h('div.kb-stat', h('span.kb-stat-value', help === null ? '-' : `${help}%`), h('span.kb-stat-label', 'Found it helpful')),
          h('div.kb-stat', h('span.kb-stat-value', `${a.up || 0} / ${a.down || 0}`), h('span.kb-stat-label', 'Helpful / not helpful')),
          a.labels?.length ? h('div.kb-labels', h('span.kb-stat-label', 'Labels'), h('div.chips', a.labels.map((l) => h('span.chip.static', l)))) : null,
          !url ? h('p.kb-note', icon('info', { size: 13 }), 'Turn on the help center in Admin to share published articles with customers.') : null))));
  }

  async function load() {
    try {
      const res = await app.api.get(`/articles/${id}`);
      if (destroyed) return;
      body = res.body || '';
      if (res.article) app.replica.upsert('a', res.article);
      paint();
    } catch (e) {
      if (destroyed) return;
      if (e.status === 404) {
        app.replica.drop('a', id);
        paint();
        return;
      }
      toastError(e);
    }
  }

  async function save(patch, message) {
    try {
      const res = await app.api.post(`/articles/${id}`, patch);
      app.replica.upsert('a', res.article);
      toast(message, { kind: 'success' });
    } catch (e) {
      toastError(e);
    }
  }

  async function remove(a) {
    const ok = await confirmDialog({ title: 'Delete this article?', message: `"${a.title}" will be removed from the knowledge base${a.status === 'published' ? ' and the help center' : ''}. This cannot be undone.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await app.api.del(`/articles/${a.id}`);
      app.replica.drop('a', a.id);
      writeDraft(a.id, null);
      toast('Article deleted.', { kind: 'success' });
      go('/kb');
    } catch (e) {
      toastError(e);
    }
  }

  const onChange = (e) => {
    const k = e.detail?.kinds;
    if (!k || ((k.has('a') && (!e.detail.ids?.a || e.detail.ids.a.has(id))) || k.has('c'))) paint();
  };
  app.replica.addEventListener('change', onChange);
  const unbind = bind('kb-article', { e: () => go(`/kb/articles/${id}/edit`) });
  sideNav(side, { section: summary()?.section });
  paint();
  load();
  return () => {
    destroyed = true;
    app.replica.removeEventListener('change', onChange);
    unbind();
  };
}

async function copyLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied.');
  } catch {
    toast(url, { title: 'Copy this link', timeout: 10000 });
  }
}

/* ------------------------------------------------------------- editor */

function sectionOptions() {
  const out = [{ value: null, label: 'Not in a section' }];
  for (const c of kbStructure(app.replica.cfg.kb)) {
    for (const s of c.sections) out.push({ value: s.id, label: s.name, group: c.name });
  }
  return out;
}

function mountEditor(main, id, query) {
  const isNew = id === null;
  const existing = isNew ? null : app.replica.articles.get(id) || null;
  let saved = {
    title: existing?.title || '',
    section: existing?.section ?? (query.section || null),
    labels: existing?.labels || [],
    promoted: !!existing?.promoted,
    body: isNew ? '' : null,
  };
  let current = { ...saved };
  let saving = false;
  let destroyed = false;
  let loaded = isNew;

  const titleId = uid('kb-title');
  const titleIn = h(`input#${titleId}.kb-title-input`, { type: 'text', placeholder: 'Article title', maxlength: 200, value: saved.title, 'aria-label': 'Article title', autocomplete: 'off' });
  const editor = createEditor({ article: true, label: 'Article body', placeholder: 'Write the article. Use headings, lists and links to make it easy to scan.', minHeight: 360, onChange: () => changed() });
  const sectionId = uid('kb-sec');
  const sectionBtn = selectField({ id: sectionId, value: saved.section, options: sectionOptions, label: 'Section', onChange: (v) => { current.section = v; changed(); } });
  const labelsId = uid('kb-labels');
  const labels = tagsInput({ id: labelsId, value: saved.labels, label: 'Labels', placeholder: 'Add labels', onChange: (v) => { current.labels = v; changed(); },
    suggestions: () => [...new Set([...app.replica.articles.values()].flatMap((a) => a.labels || []))].sort() });
  const promotedId = uid('kb-prom');
  const promoted = h(`input#${promotedId}.switch`, { type: 'checkbox', role: 'switch', checked: saved.promoted, onchange: () => { current.promoted = promoted.checked; changed(); } });
  const statusEl = h('span.kb-save-state', { role: 'status', 'aria-live': 'polite' });
  const draftBtn = h('button.btn', { type: 'button', onclick: () => save('draft') });
  const publishBtn = h('button.btn.btn-primary', { type: 'button', onclick: () => save('published') });
  const restoreBar = h('div.kb-restore', { hidden: true, role: 'status' });
  const back = isNew ? '#/kb' : `#/kb/articles/${id}`;

  const statusNow = () => (isNew ? 'draft' : app.replica.articles.get(id)?.status || 'draft');

  main.append(h('div.kb-editor',
    h('header.kb-editor-bar',
      h('a.icon-btn', { href: back, 'aria-label': 'Back', title: 'Back' }, icon('arrow-left', { size: 18 })),
      h('div.kb-editor-crumb', h('span.subtle', isNew ? 'New article' : 'Edit article'), isNew ? null : statusBadgeFor(statusNow())),
      statusEl,
      h('span.spacer'),
      draftBtn, publishBtn),
    restoreBar,
    h('div.kb-editor-grid',
      h('div.kb-editor-main', titleIn, editor.el),
      h('aside.kb-editor-side', { 'aria-label': 'Article settings' },
        h('div.field', h('label.field-label', { for: sectionId }, 'Section'), sectionBtn,
          app.isAdmin ? h('button.link-btn.kb-manage', { type: 'button', onclick: () => manageCategories(() => sectionBtn.repaint()) }, 'Manage categories and sections') : null),
        h('div.field', h('label.field-label', { for: labelsId }, 'Labels'), labels, h('p.field-hint', 'Labels help agents and customers find the article in search.')),
        h('div.field.kb-switch-row', h('label.field-label', { for: promotedId }, 'Promote'), promoted, h('p.field-hint', 'Promoted articles are featured on the help center home page.')),
        h('div.kb-tips', h('h3', 'Writing tips'), h('ul',
          h('li', 'Start with the answer, then the details.'),
          h('li', 'Use numbered lists for steps.'),
          h('li', 'Keep each article to one topic.')))))));

  function statusBadgeFor(s) {
    return s === 'published' ? h('span.badge.kb-published', 'Published') : h('span.badge.kb-draft', 'Draft');
  }

  function snapshot() {
    return {
      title: titleIn.value.trim(),
      section: current.section,
      labels: current.labels,
      promoted: current.promoted,
      body: editor.isEmpty() ? '' : editor.getHtml(),
    };
  }

  function isDirty() {
    if (!loaded) return false;
    const s = snapshot();
    return s.title !== saved.title || s.section !== saved.section || JSON.stringify(s.labels) !== JSON.stringify(saved.labels) || s.promoted !== saved.promoted || s.body !== (saved.body || '');
  }

  function paintButtons() {
    const published = statusNow() === 'published';
    draftBtn.textContent = published ? 'Unpublish' : 'Save draft';
    publishBtn.textContent = published ? 'Update' : 'Publish';
    draftBtn.disabled = saving || !loaded;
    publishBtn.disabled = saving || !loaded;
    const dirty = isDirty();
    statusEl.textContent = saving ? 'Saving' : dirty ? 'Unsaved changes' : isNew ? '' : 'All changes saved';
    statusEl.classList.toggle('dirty', dirty && !saving);
  }

  const persistLocal = debounce(() => {
    if (destroyed && !isDirty()) return;
    writeDraft(id, isDirty() ? { ...snapshot(), at: Date.now() } : null);
  }, 400);

  function changed() {
    paintButtons();
    persistLocal();
  }
  titleIn.addEventListener('input', changed);

  async function save(target) {
    // The buttons are disabled meanwhile, but the save shortcut is not: an
    // article still loading would be saved empty, and a second save of a new
    // article would create it twice.
    if (saving || !loaded) return;
    const s = snapshot();
    if (!s.title) {
      titleIn.setAttribute('aria-invalid', 'true');
      titleIn.focus();
      toastError({ message: 'Give the article a title.' });
      return;
    }
    titleIn.removeAttribute('aria-invalid');
    if (target === 'published' && !s.body) {
      toastError({ message: 'Write the article before publishing it.' });
      editor.focus();
      return;
    }
    saving = true;
    paintButtons();
    const payload = { title: s.title, section: s.section, labels: s.labels, promoted: s.promoted, body: s.body, status: target };
    // Read before the save: afterwards the local copy already has the new status.
    const wasLive = !isNew && statusNow() === 'published';
    try {
      const res = isNew ? await app.api.post('/articles', payload) : await app.api.post(`/articles/${id}`, payload);
      app.replica.upsert('a', res.article);
      saved = { ...s };
      writeDraft(id, null);
      announce('Article saved');
      toast(target === 'published' ? (wasLive ? 'Article updated in the help center.' : 'Article published.') : 'Draft saved.', { kind: 'success' });
      if (isNew) {
        destroyed = true;
        go(`/kb/articles/${res.article.id}`, { replace: true });
        return;
      }
      go(`/kb/articles/${id}`);
    } catch (e) {
      toastError(e);
    } finally {
      saving = false;
      if (!destroyed) paintButtons();
    }
  }

  function offerRestore() {
    const d = readDraft(id);
    if (!d) return;
    const differs = d.title !== saved.title || (d.body || '') !== (saved.body || '') || d.section !== saved.section || JSON.stringify(d.labels || []) !== JSON.stringify(saved.labels) || !!d.promoted !== saved.promoted;
    if (!differs) {
      writeDraft(id, null);
      return;
    }
    clear(restoreBar);
    restoreBar.hidden = false;
    restoreBar.append(icon('rotate-ccw-clock', { size: 15 }), h('span', `You have unsaved changes from ${relTime(d.at)}.`),
      h('button.btn.btn-sm', { type: 'button', onclick: () => {
        titleIn.value = d.title || '';
        current = { ...current, section: d.section ?? null, labels: d.labels || [], promoted: !!d.promoted };
        sectionBtn.setValue(current.section);
        labels.setValue(current.labels);
        promoted.checked = current.promoted;
        editor.setHtml(d.body || '');
        restoreBar.hidden = true;
        changed();
      } }, 'Restore'),
      h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => { writeDraft(id, null); restoreBar.hidden = true; } }, 'Discard'));
  }

  async function load() {
    if (isNew) {
      offerRestore();
      paintButtons();
      titleIn.focus();
      return;
    }
    editor.content.setAttribute('aria-busy', 'true');
    try {
      const res = await app.api.get(`/articles/${id}`);
      if (destroyed) return;
      const a = res.article;
      app.replica.upsert('a', a);
      saved = { title: a.title, section: a.section ?? null, labels: a.labels || [], promoted: !!a.promoted, body: '' };
      editor.setHtml(res.body || '');
      saved.body = editor.isEmpty() ? '' : editor.getHtml();
      current = { section: saved.section, labels: saved.labels, promoted: saved.promoted };
      titleIn.value = a.title;
      sectionBtn.setValue(saved.section);
      labels.setValue(saved.labels);
      promoted.checked = saved.promoted;
      loaded = true;
      offerRestore();
      paintButtons();
    } catch (e) {
      if (destroyed) return;
      toastError(e);
      if (e.status === 404) go('/kb', { replace: true });
    } finally {
      editor.content.removeAttribute('aria-busy');
    }
  }

  const beforeUnload = (e) => {
    if (isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforeUnload);
  const unbind = bind('kb-editor', { 'mod+s': () => save(statusNow() === 'published' ? 'published' : 'draft') });
  titleIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !composing(e)) {
      e.preventDefault();
      editor.focus();
    }
  });
  paintButtons();
  load();
  return () => {
    const dirty = isDirty();
    if (dirty) {
      writeDraft(id, { ...snapshot(), at: Date.now() });
      toast('Your unsaved article changes were kept on this device. Open the editor again to restore them.');
    }
    destroyed = true;
    window.removeEventListener('beforeunload', beforeUnload);
    unbind();
  };
}

/* --------------------------------------------- categories and sections */

const nextOrder = (list) => list.reduce((m, x) => Math.max(m, Number(x.order) || 0), -1) + 1;

/** Pure edits on a kb structure, kept separate so they are easy to test. */
export const kbOps = {
  // New ones go last: after the highest order, which after deletions can be
  // more than the count.
  addCategory(kb, name) {
    const categories = [...(kb.categories || [])];
    categories.push({ id: randomId(8), name, desc: '', order: nextOrder(categories) });
    return { ...kb, categories };
  },
  addSection(kb, categoryId, name) {
    const sections = [...(kb.sections || [])];
    const order = nextOrder(sections.filter((s) => s.categoryId === categoryId));
    sections.push({ id: randomId(8), categoryId, name, desc: '', order });
    return { ...kb, sections };
  },
  rename(kb, kind, id, name) {
    const list = kind === 'category' ? 'categories' : 'sections';
    return { ...kb, [list]: kb[list].map((x) => (x.id === id ? { ...x, name } : x)) };
  },
  move(kb, kind, id, delta) {
    const list = kind === 'category' ? 'categories' : 'sections';
    const item = kb[list].find((x) => x.id === id);
    if (!item) return kb;
    const peers = kb[list].filter((x) => kind === 'category' || x.categoryId === item.categoryId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const i = peers.findIndex((x) => x.id === id);
    const j = i + delta;
    if (j < 0 || j >= peers.length) return kb;
    [peers[i], peers[j]] = [peers[j], peers[i]];
    const orders = new Map(peers.map((x, k) => [x.id, k]));
    return { ...kb, [list]: kb[list].map((x) => (orders.has(x.id) ? { ...x, order: orders.get(x.id) } : x)) };
  },
  remove(kb, kind, id) {
    if (kind === 'category') return { ...kb, categories: kb.categories.filter((c) => c.id !== id), sections: kb.sections.filter((s) => s.categoryId !== id) };
    return { ...kb, sections: kb.sections.filter((s) => s.id !== id) };
  },
};

export function manageCategories(onSaved) {
  let kb = structuredClone(app.replica.cfg.kb || { categories: [], sections: [] });
  kb.categories ||= [];
  kb.sections ||= [];
  const articleCount = (sectionId) => [...app.replica.articles.values()].filter((a) => a.section === sectionId).length;
  const list = h('div.kb-manage-list');
  const newCatId = uid('newcat');
  const newCat = h(`input#${newCatId}.input`, { placeholder: 'New category name', maxlength: 100 });

  function nameInput(value, label, onCommit) {
    const input = h('input.input.kb-name-input', { value, maxlength: 100, 'aria-label': label });
    input.addEventListener('change', () => {
      const v = input.value.trim();
      if (v) onCommit(v);
      else input.value = value;
    });
    return input;
  }

  function moveBtns(kind, id, label) {
    return [
      h('button.icon-btn.sm', { type: 'button', 'aria-label': `Move ${label} up`, title: 'Move up', onclick: () => { kb = kbOps.move(kb, kind, id, -1); paint(); } }, icon('arrow-up', { size: 14 })),
      h('button.icon-btn.sm', { type: 'button', 'aria-label': `Move ${label} down`, title: 'Move down', onclick: () => { kb = kbOps.move(kb, kind, id, 1); paint(); } }, icon('arrow-down', { size: 14 })),
    ];
  }

  function paint() {
    clear(list);
    const tree = kbStructure(kb);
    if (!tree.length) list.append(h('p.muted', 'No categories yet. Add one below.'));
    for (const c of tree) {
      const sectionName = h('input.input', { placeholder: 'New section name', maxlength: 100, 'aria-label': `New section in ${c.name}` });
      const addSection = () => {
        const v = sectionName.value.trim();
        if (!v) return;
        kb = kbOps.addSection(kb, c.id, v);
        paint();
        list.querySelector(`[data-cat="${c.id}"] .kb-add-section input`)?.focus();
      };
      sectionName.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !composing(e)) { e.preventDefault(); addSection(); } });
      list.append(h('section.kb-manage-cat', { dataset: { cat: c.id } },
        h('div.kb-manage-row.kb-manage-cat-row',
          icon('folder', { size: 16 }),
          nameInput(c.name, `Category name`, (v) => { kb = kbOps.rename(kb, 'category', c.id, v); }),
          moveBtns('category', c.id, c.name),
          h('button.icon-btn.sm', {
            type: 'button', 'aria-label': `Delete category ${c.name}`, title: c.sections.length ? 'Delete its sections first' : 'Delete category', disabled: c.sections.length > 0,
            onclick: () => { kb = kbOps.remove(kb, 'category', c.id); paint(); },
          }, icon('trash', { size: 14 }))),
        h('ul.kb-manage-sections', c.sections.map((s) => {
          const n = articleCount(s.id);
          return h('li.kb-manage-row',
            nameInput(s.name, 'Section name', (v) => { kb = kbOps.rename(kb, 'section', s.id, v); }),
            h('span.subtle.kb-manage-count', plural(n, 'article')),
            moveBtns('section', s.id, s.name),
            h('button.icon-btn.sm', {
              type: 'button', 'aria-label': `Delete section ${s.name}`, title: n ? 'Move or delete its articles first' : 'Delete section', disabled: n > 0,
              onclick: () => { kb = kbOps.remove(kb, 'section', s.id); paint(); },
            }, icon('trash', { size: 14 })));
        })),
        h('div.kb-add-section', sectionName, h('button.btn.btn-sm', { type: 'button', onclick: addSection }, icon('plus', { size: 13 }), 'Add section'))));
    }
  }

  const addCategory = () => {
    const v = newCat.value.trim();
    if (!v) {
      newCat.focus();
      return;
    }
    kb = kbOps.addCategory(kb, v);
    newCat.value = '';
    paint();
    newCat.focus();
  };
  newCat.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !composing(e)) { e.preventDefault(); addCategory(); } });
  paint();
  openDialog({
    title: 'Categories and sections',
    description: 'Organize articles for the help center. Categories group sections; articles belong to a section.',
    size: 'lg',
    body: h('div.stack', list, h('div.kb-add-cat', h('label.sr-only', { for: newCatId }, 'New category name'), newCat, h('button.btn', { type: 'button', onclick: addCategory }, icon('plus', { size: 14 }), 'Add category'))),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save', primary: true,
        run: async () => {
          try {
            await app.saveConfig('kb', kb);
            toast('Categories saved.', { kind: 'success' });
            onSaved?.();
            return true;
          } catch (e) {
            toastError(e);
            return false;
          }
        },
      },
    ],
  });
}
