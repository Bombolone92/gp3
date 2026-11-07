/**
 * Home: every base, starred ones first, with quick ways to start (blank,
 * template, import) and a trash for deleted bases.
 */
import { h } from '../lib/dom.js';
import { icon, BASE_ICONS, REPO_URL } from '../lib/icons.js';
import { accentColor, BASE_COLORS } from '../lib/colors.js';
import { timeAgo } from '../lib/format.js';
import { openMenu } from './menu.js';
import { openPopover, popoversAnchoredIn } from './popover.js';
import { openDialog, confirmDialog, promptDialog } from './dialog.js';
import { toast } from './toast.js';
import { prefs, setPref } from './prefs.js';
import { TEMPLATES, buildTemplate } from '../data/templates.js';
import { importFileDialog, pickFile } from './importer.js';
import { readBaseJson } from './exporter.js';

/** An element's classes without state ones: a starred star is still the star. */
function kind(el) {
  return String(el.className).replace(/\b(on|active)\b/g, '').trim();
}

export class HomePage {
  constructor(app, mode = 'home') {
    this.app = app;
    this.store = app.store;
    this.mode = mode;
    this.query = '';
    document.title = mode === 'trash' ? 'Trash \u2013 Records' : 'Records';
    this.el = h('div.home');
    this.off = this.store.on('index', () => this.renderList());
    this.render();
  }

  destroy() {
    this.off?.();
  }

  focus() {
    this.main?.focus({ preventScroll: true });
  }

  render() {
    const nav = (label, ic, hash, current) =>
      h('a.home-nav-item', { href: `#/${hash}`, 'aria-current': current ? 'page' : null }, icon(ic, 16), h('span', label));
    const create = h('button.btn.primary.block', { type: 'button', onclick: () => this.createBlank() }, icon('plus', 16), 'Create base');
    this.navEl = h(
      'nav.home-nav',
      { 'aria-label': 'Main' },
      h('div.brand', h('img', { src: './icon-192.png', alt: '', width: 24, height: 24 }), h('span', 'Records')),
      h('div.home-nav-list', nav('Home', 'home', '', this.mode === 'home'), nav('Trash', 'trash', 'trash', this.mode === 'trash')),
      (this.starredNav = h('div.home-nav-starred')),
      h('div.grow'),
      create,
      h('a.repo-link', { href: REPO_URL, target: '_blank', rel: 'noopener', 'aria-label': 'Source code on GitHub (opens in a new tab)' }, icon('github', 14), h('span', 'Open source on GitHub')),
    );
    this.search = h('input.input.home-search', {
      type: 'search',
      placeholder: 'Search bases',
      'aria-label': 'Search bases',
      value: this.query,
      oninput: () => {
        this.query = this.search.value;
        this.renderList();
      },
    });
    const menuBtn = h('button.icon-btn.home-menu-btn', { type: 'button', 'aria-label': 'Menu', onclick: (e) => this.openPhoneMenu(e.currentTarget) }, icon('menu', 18));
    const top = h('header.home-top', menuBtn, h('div.home-search-wrap', icon('search', 16), this.search), h('div.grow'), this.app.accountButton());
    this.listHost = h('div.home-list-host');
    this.main = h('main.home-content', { id: 'main', tabindex: '-1' });
    if (this.mode === 'trash') {
      this.main.append(h('div.home-head', h('h1.home-title', 'Trash'), h('div.grow'), h('button.btn', { type: 'button', onclick: () => this.emptyTrash() }, icon('trash', 16), 'Empty trash')), h('p.home-sub', 'Bases in the trash can be restored. Emptying the trash deletes them and their files for good.'), this.listHost);
    } else {
      const card = (ic, title, text, onclick, color) =>
        h('button.quick-card', { type: 'button', onclick }, h('span.quick-icon', { style: { background: color } }, icon(ic, 18)), h('span.quick-title', title), h('span.quick-text', text));
      this.main.append(
        h('h1.home-title', 'Home'),
        h(
          'div.quick-grid',
          card('plus', 'Start from scratch', 'A blank base with one table.', () => this.createBlank(), accentColor('blue')),
          card('template', 'Start with a template', 'Projects, content, sales, inventory and more.', () => this.openTemplates(), accentColor('purple')),
          card('fileUp', 'Import a spreadsheet', 'Create a base from a CSV file.', () => this.importCsv(), accentColor('green')),
          card('restore', 'Restore a backup', 'Open a base you downloaded as JSON.', () => this.importBackup(), accentColor('orange')),
        ),
        this.listHost,
      );
    }
    this.el.replaceChildren(this.navEl, h('div.home-main', top, this.main));
    this.renderList();
  }

  openPhoneMenu(anchor) {
    openMenu(anchor, [
      { label: 'Home', icon: 'home', onSelect: () => this.app.navigate('') },
      { label: 'Trash', icon: 'trash', onSelect: () => this.app.navigate('trash') },
      { type: 'sep' },
      { label: 'Create base', icon: 'plus', onSelect: () => this.createBlank() },
      { label: 'Start with a template', icon: 'template', onSelect: () => this.openTemplates() },
      { label: 'Import a spreadsheet', icon: 'fileUp', onSelect: () => this.importCsv() },
      { label: 'Restore a backup', icon: 'restore', onSelect: () => this.importBackup() },
      { type: 'sep' },
      { label: 'Open source on GitHub', icon: 'github', onSelect: () => window.open(REPO_URL, '_blank', 'noopener') },
    ]);
  }

  bases() {
    const q = this.query.trim().toLowerCase();
    let list = this.mode === 'trash' ? this.store.trashed() : this.store.bases();
    if (q) list = list.filter((b) => b.name.toLowerCase().includes(q));
    const sort = prefs().homeSort;
    if (this.mode !== 'trash') {
      list = list.slice().sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name, undefined, { numeric: true });
        if (sort === 'created') return (b.createdAt || 0) - (a.createdAt || 0);
        return (b.openedAt || b.updatedAt || 0) - (a.openedAt || a.updatedAt || 0);
      });
    }
    return list;
  }

  renderStarredNav() {
    if (!this.starredNav) return;
    const starred = this.store.bases().filter((b) => b.starred);
    this.starredNav.replaceChildren(...(starred.length ? [h('div.home-nav-title', 'Starred'), ...starred.map((b) => h('a.home-nav-item.base-link', { href: `#/${b.id}` }, h('span.base-icon', { style: { background: accentColor(b.color), width: '20px', height: '20px', borderRadius: '5px' }, 'aria-hidden': 'true' }, icon(b.icon || 'table', 12)), h('span', b.name)))] : []));
  }

  renderList() {
    this.renderStarredNav();
    if (!this.listHost) return;
    const focus = this.focusedControl();
    // A picker opened from a base's button follows the button redrawn.
    const anchored = popoversAnchoredIn(this.listHost).map((p) => [p, this.controlKey(p.anchor)]);
    this.renderListContent();
    this.restoreFocus(focus);
    for (const [p, k] of anchored) {
      const el = this.findControl(k, { exact: true });
      if (el) p.reanchor(el);
    }
  }

  /** What tells a control in the list apart (re-rendering replaces it). */
  controlKey(el) {
    return { base: el.closest('[data-base]')?.dataset.base, section: el.closest('.home-section')?.getAttribute('aria-labelledby'), cls: kind(el), label: el.getAttribute('aria-label') };
  }

  /** Which control in the list has focus. */
  focusedControl() {
    const a = document.activeElement;
    if (!a || !this.listHost.contains(a)) return null;
    return this.controlKey(a);
  }

  /** The same control after re-rendering, or (unless exact) the nearest one left. */
  findControl(f, { exact = false } = {}) {
    const focusable = 'a[href], button:not([disabled])';
    // Controls outside a base's row (layout, sort) are found by their label.
    if (!f.base) return [...this.listHost.querySelectorAll(focusable)].find((x) => f.label && x.getAttribute('aria-label') === f.label) || null;
    const section = this.listHost.querySelector(`[aria-labelledby="${f.section}"]`) || this.listHost;
    const row = section.querySelector(`[data-base="${f.base}"]`) || this.listHost.querySelector(`[data-base="${f.base}"]`);
    const same = row && [...row.querySelectorAll(focusable)].find((x) => kind(x) === f.cls);
    if (exact) return same || null;
    return same || row?.querySelector(focusable) || this.listHost.querySelector(focusable);
  }

  /** Focus the same control after re-rendering, or the nearest one left. */
  restoreFocus(f) {
    if (f) this.findControl(f)?.focus();
  }

  renderListContent() {
    const list = this.bases();
    if (this.mode === 'trash') {
      this.listHost.replaceChildren(
        list.length
          ? h('ul.base-rows', { 'aria-label': 'Bases in the trash' }, list.map((b) => this.trashRow(b)))
          : h('div.empty', h('div.empty-icon', icon('trash', 22)), h('h2', 'The trash is empty'), h('p', 'Bases you delete show up here.')),
      );
      return;
    }
    const layout = prefs().homeLayout;
    const sortLabels = { opened: 'Last opened', name: 'Name', created: 'Date created' };
    const sortBtn = h('button.btn.ghost.small', { type: 'button', 'aria-haspopup': 'menu' }, `Sort: ${sortLabels[prefs().homeSort] || 'Last opened'}`, icon('chevronDown', 14));
    sortBtn.addEventListener('click', () =>
      openMenu(sortBtn, Object.entries(sortLabels).map(([k, label]) => ({ label, checked: prefs().homeSort === k, radio: true, onSelect: () => {
        setPref('homeSort', k);
        this.renderList();
      } }))),
    );
    const layoutToggle = h(
      'div.segmented',
      { role: 'group', 'aria-label': 'Layout' },
      h('button', { type: 'button', 'aria-pressed': String(layout === 'grid'), 'aria-label': 'Grid layout', 'data-tip': 'Grid', onclick: () => this.setLayout('grid') }, icon('vGallery', 14)),
      h('button', { type: 'button', 'aria-pressed': String(layout === 'list'), 'aria-label': 'List layout', 'data-tip': 'List', onclick: () => this.setLayout('list') }, icon('vList', 14)),
    );
    const starred = list.filter((b) => b.starred);
    const sections = [];
    if (starred.length && !this.query) sections.push(this.section('Starred', starred, layout, 'starred'));
    sections.push(this.section(this.query ? 'Results' : 'All bases', list, layout, 'all', h('div.section-tools', sortBtn, layoutToggle)));
    if (!list.length) {
      sections.pop();
      sections.push(
        this.query
          ? h('div.empty', h('div.empty-icon', icon('search', 22)), h('h2', 'No bases match'), h('p', 'Try a different name.'))
          : h('div.empty', h('div.empty-icon', icon('database', 22)), h('h2', 'No bases yet'), h('p', 'Create a base from scratch, start from a template, or import a spreadsheet.'), h('button.btn.primary', { type: 'button', onclick: () => this.createBlank() }, icon('plus', 16), 'Create base')),
      );
    }
    this.listHost.replaceChildren(...sections);
  }

  setLayout(layout) {
    setPref('homeLayout', layout);
    this.renderList();
  }

  section(title, list, layout, key, tools) {
    const headId = `home-sec-${key}`;
    return h(
      'section.home-section',
      { 'aria-labelledby': headId },
      h('div.home-section-head', h('h2.home-section-title', { id: headId }, title), tools || null),
      layout === 'list' ? h('ul.base-rows', list.map((b) => this.baseRow(b))) : h('ul.base-grid', list.map((b) => this.baseCard(b))),
    );
  }

  baseIcon(b, size = 40) {
    return h('span.base-icon', { style: { background: accentColor(b.color), width: `${size}px`, height: `${size}px` }, 'aria-hidden': 'true' }, icon(b.icon || 'table', Math.round(size * 0.5)));
  }

  baseActions(b) {
    const star = h('button.icon-btn', {
      type: 'button',
      'aria-label': b.starred ? `Unstar ${b.name}` : `Star ${b.name}`,
      'aria-pressed': String(!!b.starred),
      'data-tip': b.starred ? 'Unstar' : 'Star',
      class: `icon-btn star-btn${b.starred ? ' on' : ''}`,
      onclick: (e) => {
        e.preventDefault();
        this.store.setStarred(b.id, !b.starred);
      },
    }, icon('star', 16, { fill: b.starred ? 'currentColor' : 'none' }));
    const more = h('button.icon-btn', { type: 'button', 'aria-label': `More actions for ${b.name}`, 'aria-haspopup': 'menu', 'data-tip': 'More' }, icon('more', 16));
    more.addEventListener('click', (e) => {
      e.preventDefault();
      this.openBaseMenu(more, b);
    });
    return h('div.base-actions', star, more);
  }

  baseCard(b) {
    const opened = b.openedAt ? `Opened ${timeAgo(b.openedAt)}` : `Created ${timeAgo(b.createdAt || Date.now())}`;
    const when = b.tables ? `${b.tables} table${b.tables === 1 ? '' : 's'} \u00b7 ${opened.charAt(0).toLowerCase()}${opened.slice(1)}` : opened;
    const link = h('a.base-card-link', { href: `#/${b.id}` }, this.baseIcon(b), h('span.base-card-text', h('span.base-name', b.name), h('span.base-meta', when)));
    const li = h('li.base-card', { dataset: { base: b.id } }, link, this.baseActions(b));
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.openBaseMenu({ x: e.clientX, y: e.clientY }, b);
    });
    return li;
  }

  baseRow(b) {
    const when = b.openedAt ? `Opened ${timeAgo(b.openedAt)}` : '';
    const li = h('li.base-row', { dataset: { base: b.id } }, h('a.base-row-link', { href: `#/${b.id}` }, this.baseIcon(b, 28), h('span.base-name', b.name), h('span.base-meta', when)), this.baseActions(b));
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.openBaseMenu({ x: e.clientX, y: e.clientY }, b);
    });
    return li;
  }

  trashRow(b) {
    return h(
      'li.base-row',
      { dataset: { base: b.id } },
      h('div.base-row-link', this.baseIcon(b, 28), h('span.base-name', b.name), h('span.base-meta', `Deleted ${timeAgo(b.trashedAt)}`)),
      h(
        'div.base-actions.visible',
        h('button.btn.small', { type: 'button', onclick: () => {
          this.store.restoreBase(b.id);
          toast(`Restored ${b.name}`);
        } }, icon('restore', 14), 'Restore'),
        h('button.btn.small.ghost', { type: 'button', onclick: () => this.purge(b) }, 'Delete forever'),
      ),
    );
  }

  openBaseMenu(anchor, b) {
    openMenu(anchor, [
      { label: 'Open', icon: 'arrowUpRight', onSelect: () => this.app.navigate(b.id) },
      { label: 'Rename', icon: 'pencil', onSelect: () => this.rename(b) },
      { label: 'Change color and icon', icon: 'palette', onSelect: () => this.appearance(anchor instanceof Element ? anchor : null, b) },
      { label: b.starred ? 'Unstar' : 'Star', icon: 'star', onSelect: () => this.store.setStarred(b.id, !b.starred) },
      { label: 'Duplicate', icon: 'copy', onSelect: () => this.duplicate(b) },
      { type: 'sep' },
      { label: 'Move to trash', icon: 'trash', danger: true, onSelect: () => this.trash(b) },
    ], { label: b.name });
  }

  async rename(b) {
    const name = await promptDialog({ title: 'Rename base', label: 'Name', value: b.name, validate: (v) => (v ? null : 'Enter a name.') });
    if (name && name !== b.name) await this.store.updateBase(b.id, { name });
  }

  appearance(anchor, b) {
    const panel = appearancePicker(b, (patch) => this.store.updateBase(b.id, patch));
    openPopover(anchor || document.body, panel, { className: 'padded', label: 'Color and icon' });
  }

  async duplicate(b) {
    const t = toast(`Duplicating ${b.name}...`, { timeout: 0 });
    try {
      await this.store.duplicateBase(b.id);
      t.close();
      toast(`Duplicated ${b.name}`);
    } catch {
      t.close();
      toast('Could not duplicate the base.', { error: true });
    }
  }

  trash(b) {
    this.store.trashBase(b.id);
    toast(`Moved ${b.name} to the trash`, { action: { label: 'Undo', onClick: () => this.store.restoreBase(b.id) } });
  }

  async purge(b) {
    const ok = await confirmDialog({ title: `Delete ${b.name} forever?`, message: 'The base, its records and its attachments are deleted from your Puter cloud. This cannot be undone.', confirmLabel: 'Delete forever', danger: true });
    if (ok) await this.store.purgeBase(b.id);
  }

  async emptyTrash() {
    const list = this.store.trashed();
    if (!list.length) return;
    const ok = await confirmDialog({ title: 'Empty the trash?', message: `${list.length} base${list.length === 1 ? '' : 's'} and their files will be deleted for good. This cannot be undone.`, confirmLabel: 'Empty trash', danger: true });
    if (!ok) return;
    for (const b of list) await this.store.purgeBase(b.id);
  }

  /** Create a base and open it; a second click while it is created does nothing. */
  async create(opts) {
    if (this.creating) return;
    this.creating = true;
    try {
      const id = await this.store.createBase(opts);
      this.app.navigate(id);
    } catch (err) {
      console.error(err);
      toast('Could not create the base. Check your connection and try again.', { error: true });
    } finally {
      this.creating = false;
    }
  }

  createBlank() {
    const colors = BASE_COLORS;
    const color = colors[this.store.bases().length % colors.length];
    return this.create({ name: 'Untitled base', color, icon: 'table' });
  }

  openTemplates() {
    let dlg;
    const pick = (tpl) => {
      dlg.close();
      const built = buildTemplate(tpl, { user: this.store.user });
      return this.create({ name: tpl.name, color: tpl.color, icon: tpl.icon, doc: built.doc, records: built.records });
    };
    dlg = openDialog({
      title: 'Start with a template',
      className: 'wide',
      body: h(
        'ul.template-grid',
        TEMPLATES.map((tpl) =>
          h('li', h('button.template-card', { type: 'button', onclick: () => pick(tpl) }, h('span.base-icon', { style: { background: accentColor(tpl.color) }, 'aria-hidden': 'true' }, icon(tpl.icon, 20)), h('span.template-name', tpl.name), h('span.template-desc', tpl.description))),
        ),
      ),
    });
  }

  async importBackup() {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      const data = readBaseJson(await file.text());
      const id = await this.store.createBase({ name: data.doc.name, color: data.doc.color, icon: data.doc.icon, doc: data.doc, records: data.records });
      toast(`Restored ${data.doc.name}`);
      this.app.navigate(id);
    } catch (err) {
      toast(err.message || 'Could not restore that file.', { error: true });
    }
  }

  importCsv() {
    importFileDialog({
      app: this.app,
      onDone: async ({ name, doc, records }) => {
        const id = await this.store.createBase({ name, color: 'green', icon: 'table', doc, records });
        this.app.navigate(id);
      },
    });
  }
}

/** Color and icon pickers for a base. onChange gets { color } or { icon }. */
export function appearancePicker(b, onChange) {
  let current = { color: b.color, icon: b.icon || 'table' };
  const swatches = BASE_COLORS.map((c) => h('button.swatch', { type: 'button', role: 'radio', 'aria-label': c, style: { background: accentColor(c), color: '#fff' }, onclick: () => {
    current = { ...current, color: c };
    onChange({ color: c });
    paint();
  } }));
  const choices = BASE_ICONS.map((name) => h('button.icon-choice', { type: 'button', role: 'radio', 'aria-label': name, onclick: () => {
    current = { ...current, icon: name };
    onChange({ icon: name });
    paint();
  } }, icon(name, 16)));
  const colors = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Color' }, swatches);
  const icons = h('div.icon-grid', { role: 'radiogroup', 'aria-label': 'Icon' }, choices);
  // Marked in place, so the button just chosen keeps focus.
  const paint = () => {
    swatches.forEach((btn, i) => {
      const on = current.color === BASE_COLORS[i];
      btn.setAttribute('aria-checked', String(on));
      btn.replaceChildren(...(on ? [icon('check', 14)] : []));
    });
    choices.forEach((btn, i) => {
      const on = current.icon === BASE_ICONS[i];
      btn.setAttribute('aria-checked', String(on));
      btn.style.background = on ? accentColor(current.color) : '';
      btn.style.color = on ? '#fff' : '';
    });
  };
  paint();
  return h('div.appearance', h('div.popover-title', 'Color'), colors, h('div.popover-title', { style: { marginTop: '12px' } }, 'Icon'), icons);
}
