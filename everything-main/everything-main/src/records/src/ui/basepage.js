/**
 * An open base: top bar, table tabs, view sidebar, view bar and the view
 * itself. Keeps the URL in step with the current table, view and record.
 */
import { h, announce, modKey } from '../lib/dom.js';
import { newId } from '../lib/ids.js';
import { icon } from '../lib/icons.js';
import { accentColor, rowTint } from '../lib/colors.js';
import { openMenu } from './menu.js';
import { openPopover, closeAllPopovers, popoversAnchoredIn } from './popover.js';
import { confirmDialog, promptDialog } from './dialog.js';
import { toast } from './toast.js';
import { prefs, setPref, onThemeChange } from './prefs.js';
import { appearancePicker } from './home.js';
import { VIEW_TYPES, VIEW_ORDER } from '../data/views.js';
import { renderToolbar } from './toolbar.js';
import { openRecordDialog } from './record.js';
import { importFileDialog, addTableFromPlan, appendPlan } from './importer.js';
import { exportCsv, printView, exportBaseJson } from './exporter.js';
import { openQuickSearch } from './search.js';
import { GridView } from '../views/grid/grid.js';
import { KanbanView } from '../views/kanban.js';
import { GalleryView } from '../views/gallery.js';
import { CalendarView } from '../views/calendar.js';
import { FormView } from '../views/form.js';
import { ListView } from '../views/list.js';
import { TimelineView } from '../views/timeline.js';

const VIEW_DESCRIPTIONS = {
  grid: 'Rows and columns, like a spreadsheet',
  calendar: 'Records on a month calendar by date',
  gallery: 'Cards with cover images',
  kanban: 'Cards in stacks you drag between',
  timeline: 'Bars across time, from start to end',
  list: 'A compact list, grouped if you like',
  form: 'A form that adds records',
};

const VIEWS = { grid: GridView, kanban: KanbanView, gallery: GalleryView, calendar: CalendarView, form: FormView, list: ListView, timeline: TimelineView };

export function viewIcon(type, size = 16) {
  return h(`span.view-type-icon.vt-${type}`, icon(VIEW_TYPES[type]?.icon || 'vGrid', size));
}

export class BasePage {
  constructor(app, baseId) {
    this.app = app;
    this.store = app.store;
    this.baseId = baseId;
    this.session = null;
    this.base = null;
    this.tableId = null;
    this.viewId = null;
    this.recordDialog = null;
    this.viewInst = null;
    this.offs = [];
    this.el = h('div.basepage', h('div.loading-view', { role: 'status' }, h('div.spinner', { 'aria-label': 'Opening base' })));
  }

  get table() {
    return this.base?.table(this.tableId) || null;
  }
  get view() {
    return this.table?.view(this.viewId) || null;
  }

  async load(tableId, viewId, recordId) {
    const session = await this.store.openBase(this.baseId);
    // Left before the base finished loading.
    if (this.destroyed) {
      this.store.closeBase(this.baseId);
      return;
    }
    this.session = session;
    this.base = session.base;
    if (session.conflict) {
      toast(session.conflict);
      session.conflict = null;
    }
    this.offs.push(this.base.on('change', (change, op) => this.onChange(change, op)));
    this.offs.push(this.session.on('status', () => this.renderStatus()));
    this.offs.push(onThemeChange(() => {
      this.applyBaseColor();
      this.viewInst?.onTheme?.();
    }));
    this.keyHandler = (e) => this.onKey(e);
    document.addEventListener('keydown', this.keyHandler);
    this.renderShell();
    // Navigation while loading wins over where the load started.
    const target = this.pendingGo || [tableId, viewId, recordId];
    this.pendingGo = null;
    this.go(...target, { replace: true });
  }

  destroy() {
    this.destroyed = true;
    for (const off of this.offs) off();
    this.offs = [];
    // Menus, pickers and Undo toasts act on this base: they go with it.
    closeAllPopovers();
    for (const t of this.undoToasts || []) t.close();
    document.removeEventListener('keydown', this.keyHandler);
    this.viewInst?.destroy();
    this.viewInst = null;
    this.recordDialog?.close({ silent: true });
    this.recordDialog = null;
    this.closed = this.session ? this.store.closeBase(this.baseId) : Promise.resolve();
    return this.closed;
  }

  /* ------------------------------------------------------------ routing */

  go(tableId, viewId, recordId, { replace = false } = {}) {
    if (!this.base) {
      this.pendingGo = [tableId, viewId, recordId];
      return;
    }
    const tables = this.base.tableList();
    if (!tables.length) return;
    let table = this.base.table(tableId) || this.base.table(prefs().lastTables[this.baseId]) || tables[0];
    let view = table.view(viewId) || table.view(prefs().lastViews[table.id]) || table.views[0];
    // A link to a record that was deleted (or is in another table) opens none.
    if (recordId && !table.record(recordId)) {
      toast('That record no longer exists.');
      recordId = null;
      replace = true;
    }
    const changed = table.id !== this.tableId || view?.id !== this.viewId;
    // Panels and pickers act on the view they opened from (and save what
    // they hold as they close, while it is still the current view).
    if (changed) closeAllPopovers();
    this.tableId = table.id;
    this.viewId = view?.id || null;
    setPref('lastTables', { ...prefs().lastTables, [this.baseId]: table.id });
    if (view) setPref('lastViews', { ...prefs().lastViews, [table.id]: view.id });
    const hash = [this.baseId, table.id, view?.id, recordId].filter(Boolean).map(encodeURIComponent).join('/');
    if (location.hash !== `#/${hash}`) {
      if (replace) history.replaceState(null, '', `${location.pathname}${location.search}#/${hash}`);
      else history.pushState(null, '', `${location.pathname}${location.search}#/${hash}`);
    }
    if (changed) {
      this.renderTabs();
      this.renderSidebar();
      this.renderViewbar();
      this.mountView();
      this.updateTitle();
    }
    if (recordId && table.record(recordId)) {
      if (!this.recordDialog || this.recordDialog.recordId !== recordId) this.openRecord(recordId, { fromRoute: true });
    } else if (this.recordDialog && !recordId) {
      this.recordDialog.close({ fromRoute: true });
    }
  }

  navigate(tableId, viewId, recordId) {
    this.go(tableId, viewId, recordId);
  }

  /* ------------------------------------------------------------- render */

  applyBaseColor() {
    const c = this.base?.doc.color || 'blue';
    this.el.style.setProperty('--base-color', accentColor(c));
    this.el.style.setProperty('--base-tint', rowTint(c));
  }

  renderShell() {
    this.applyBaseColor();
    this.el.classList.toggle('sidebar-closed', isOverlaySidebar() ? true : !prefs().sidebarOpen);
    this.topbar = h('header.topbar');
    this.tabsEl = h('nav.tablesbar', { 'aria-label': 'Tables' });
    this.viewbarEl = h('div.viewbar', { role: 'toolbar', 'aria-label': 'View' });
    this.sidebarEl = h('nav.view-sidebar', { 'aria-label': 'Views' });
    this.viewHost = h('div.view-host');
    const scrim = h('div.sidebar-scrim', { onclick: () => this.toggleSidebar(false) });
    this.el.replaceChildren(this.topbar, this.tabsEl, h('main.base-main', { id: 'main', tabindex: '-1' }, this.viewbarEl, h('div.base-body', this.sidebarEl, scrim, this.viewHost)));
    this.renderTopbar();
  }

  renderTopbar() {
    const b = this.base.doc;
    const home = h('button.home-btn', { type: 'button', 'aria-label': 'All bases', 'data-tip': 'All bases', onclick: () => this.app.navigate('') }, h('img', { src: './icon-192.png', alt: '', width: 24, height: 24 }));
    const title = h(
      'button.base-title-btn',
      { type: 'button', 'aria-haspopup': 'menu', 'aria-label': `Base: ${b.name}` },
      h('span.base-icon', { style: { background: accentColor(b.color) }, 'aria-hidden': 'true' }, icon(b.icon || 'table', 15)),
      h('span.base-title-text', b.name),
      icon('chevronDown', 14),
    );
    title.addEventListener('click', () => this.openBaseMenu(title));
    // The color and icon picker stays with the title as it is redrawn.
    for (const p of popoversAnchoredIn(this.topbar)) if (p.anchor.classList.contains('base-title-btn')) p.reanchor(title);
    this.statusEl = h('span.save-status', { role: 'status', 'aria-live': 'polite' });
    this.undoBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Undo', 'data-tip': 'Undo', 'data-kbd': `${modLabel()}Z`, onclick: () => this.undo() }, icon('undo', 16));
    this.redoBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Redo', 'data-tip': 'Redo', 'data-kbd': `${modLabel()}Shift+Z`, onclick: () => this.redo() }, icon('redo', 16));
    // Quick search is the way to other tables, records and bases on phones too.
    const searchBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Quick search', 'data-tip': 'Quick search', 'data-kbd': `${modLabel()}K`, onclick: () => this.quickSearch() }, icon('search', 16));
    const help = h('button.icon-btn.hide-phone', { type: 'button', 'aria-label': 'Keyboard shortcuts', 'data-tip': 'Keyboard shortcuts', 'data-kbd': '?', onclick: () => this.app.showShortcuts() }, icon('help', 16));
    this.topbar.replaceChildren(h('h1.sr-only', b.name), home, title, this.statusEl, h('div.grow'), h('div.topbar-actions', this.undoBtn, this.redoBtn, searchBtn, help), this.app.accountButton());
    this.renderStatus();
    this.renderUndo();
  }

  renderStatus() {
    if (!this.statusEl) return;
    const s = this.session.status;
    const map = {
      saved: ['cloudCheck', 'All changes saved'],
      pending: ['cloud', 'Saving...'],
      saving: ['cloud', 'Saving...'],
      offline: ['cloudOff', 'Offline. Changes are kept on this device.'],
      error: ['alert', 'Not saved. Retrying...'],
    };
    const [ic, text] = map[s] || map.saved;
    this.statusEl.className = `save-status ${s}`;
    this.statusEl.title = this.session.error || text;
    this.statusEl.replaceChildren(icon(ic, 14), h('span.save-text', text));
  }

  renderUndo() {
    if (!this.undoBtn) return;
    this.undoBtn.disabled = !this.base.canUndo();
    this.redoBtn.disabled = !this.base.canRedo();
  }

  renderTabs() {
    const tabs = h('div.table-tabs', { role: 'tablist', 'aria-label': 'Tables' });
    let dragId = null;
    for (const t of this.base.tableList()) {
      const selected = t.id === this.tableId;
      const chevron = h('span.tab-chevron', { 'aria-hidden': 'true' }, icon('chevronDown', 14));
      const tab = h('button.table-tab', { type: 'button', role: 'tab', 'aria-selected': String(selected), tabindex: selected ? '0' : '-1', draggable: 'true', dataset: { id: t.id }, title: selected ? 'Press Enter for table options' : null }, h('span.tab-name', t.name), chevron);
      tab.addEventListener('click', (e) => {
        if (selected && chevron.contains(e.target)) this.openTableMenu(tab, t);
        else if (!selected) this.go(t.id, null);
      });
      tab.addEventListener('dblclick', () => this.renameTable(t));
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.openTableMenu({ x: e.clientX, y: e.clientY }, t);
      });
      tab.addEventListener('keydown', (e) => {
        const all = [...tabs.querySelectorAll('[role=tab]')];
        const i = all.indexOf(tab);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const next = all[(i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
          next.focus();
          this.go(next.dataset.id, null);
          requestAnimationFrame(() => this.tabsEl.querySelector('[aria-selected=true]')?.focus());
        } else if ((e.key === 'Enter' || e.key === 'F2') && selected) {
          e.preventDefault();
          if (e.key === 'F2') this.renameTable(t);
          else this.openTableMenu(tab, t);
        }
      });
      tab.addEventListener('dragstart', (e) => {
        dragId = t.id;
        tab.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', t.name);
      });
      tab.addEventListener('dragend', () => {
        dragId = null;
        tab.classList.remove('dragging');
        tabs.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'));
      });
      tab.addEventListener('dragover', (e) => {
        if (!dragId || dragId === t.id) return;
        e.preventDefault();
        tabs.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'));
        tab.classList.add('drop-before');
      });
      tab.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!dragId || dragId === t.id) return;
        const list = this.base.doc.tables.map((x) => x.id).filter((x) => x !== dragId);
        const index = list.indexOf(t.id);
        this.base.apply({ t: 'table.move', id: dragId, index }, { label: 'Move table' });
      });
      tabs.append(tab);
    }
    const add = h('button.btn.ghost.small.tabs-add', { type: 'button', 'aria-haspopup': 'menu' }, icon('plus', 14), h('span', 'Add or import'));
    add.addEventListener('click', () => this.openAddTableMenu(add));
    this.tabsEl.replaceChildren(tabs, add);
    // Tabs that do not fit scroll sideways with a mouse wheel too.
    tabs.addEventListener('wheel', (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || tabs.scrollWidth <= tabs.clientWidth) return;
      e.preventDefault();
      tabs.scrollLeft += e.deltaY;
    }, { passive: false });
    requestAnimationFrame(() => {
      // A long name cut short shows in full on hover.
      for (const name of tabs.querySelectorAll('.tab-name')) {
        const tab = name.parentElement;
        if (name.scrollWidth > name.clientWidth) tab.title = tab.title ? `${name.textContent}. ${tab.title}` : name.textContent;
      }
      tabs.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  renderSidebar() {
    const table = this.table;
    if (!table) return;
    const filter = h('input.input', { type: 'search', placeholder: 'Find a view', 'aria-label': 'Find a view' });
    const list = h('ul.view-list', { 'aria-label': `Views of ${table.name}` });
    let dragId = null;
    const paint = () => {
      const q = filter.value.trim().toLowerCase();
      list.replaceChildren();
      for (const v of table.views) {
        if (q && !v.name.toLowerCase().includes(q)) continue;
        const current = v.id === this.viewId;
        const more = h('button.icon-btn', { type: 'button', 'aria-label': `${v.name} options`, 'aria-haspopup': 'menu', onclick: (e) => {
          e.stopPropagation();
          this.openViewMenu(more, v);
        } }, icon('more', 14));
        // The type is said once: a view named "Grid view" is not "Grid view, Grid view".
        const type = `${VIEW_TYPES[v.type]?.label} view`;
        const label = [type.toLowerCase(), VIEW_TYPES[v.type]?.label.toLowerCase()].includes(v.name.trim().toLowerCase()) ? type : `${v.name}, ${type}`;
        const link = h('a.view-link', { href: `#/${[this.baseId, table.id, v.id].map(encodeURIComponent).join('/')}`, 'aria-current': current ? 'page' : null, 'aria-label': label, draggable: 'false' }, viewIcon(v.type), h('span.view-name', v.name));
        const li = h('li.view-item', { 'aria-current': current ? 'true' : null, draggable: 'true' }, link, more);
        li.addEventListener('click', (e) => {
          if (e.target.closest('.icon-btn') || e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          this.go(table.id, v.id);
          if (isOverlaySidebar()) this.toggleSidebar(false);
        });
        link.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const items = [...list.querySelectorAll('.view-link')];
            items[(items.indexOf(link) + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
          } else if (e.key === 'F2') {
            e.preventDefault();
            this.renameView(v);
          }
        });
        li.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.openViewMenu({ x: e.clientX, y: e.clientY }, v);
        });
        li.addEventListener('dragstart', (e) => {
          dragId = v.id;
          li.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', v.name);
        });
        li.addEventListener('dragend', () => {
          dragId = null;
          li.classList.remove('dragging');
          list.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'));
        });
        li.addEventListener('dragover', (e) => {
          if (!dragId || dragId === v.id) return;
          e.preventDefault();
          list.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'));
          li.classList.add('drop-before');
        });
        li.addEventListener('drop', (e) => {
          e.preventDefault();
          if (!dragId || dragId === v.id) return;
          const ids = table.views.map((x) => x.id).filter((x) => x !== dragId);
          this.base.apply({ t: 'view.move', table: table.id, id: dragId, index: ids.indexOf(v.id) }, { label: 'Move view' });
        });
        list.append(li);
      }
      if (!list.children.length) list.append(h('li.menu-empty', 'No views match'));
    };
    filter.addEventListener('input', paint);
    paint();
    const create = h('button.view-create-btn', { type: 'button', 'aria-haspopup': 'menu' }, icon('plus', 16), h('span', 'Create view'));
    create.addEventListener('click', () => openMenu(create, VIEW_ORDER.map((type) => ({
      label: VIEW_TYPES[type].label,
      render: () => [viewIcon(type, 18), h('span.menu-label', h('span', VIEW_TYPES[type].label), h('span.menu-desc', VIEW_DESCRIPTIONS[type]))],
      onSelect: () => this.createView(type),
    })), { label: 'Create a view', width: 300 }));
    this.sidebarEl.replaceChildren(h('div.view-side-top', create, h('div.view-search', icon('search', 14), filter)), list);
  }

  renderViewbar() {
    const view = this.view;
    const table = this.table;
    if (!view || !table) {
      this.viewbarEl.replaceChildren();
      return;
    }
    const sidebarOpen = !this.el.classList.contains('sidebar-closed');
    const toggle = h('button.icon-btn', { type: 'button', 'aria-label': sidebarOpen ? 'Hide views' : 'Show views', 'aria-expanded': String(sidebarOpen), 'data-tip': sidebarOpen ? 'Hide views' : 'Show views', 'data-kbd': `${modLabel()}Shift+L`, onclick: () => this.toggleSidebar() }, icon(sidebarOpen ? 'panelLeftClose' : 'panelLeft', 16));
    const sw = h('button.view-switch', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': `View: ${view.name}` }, viewIcon(view.type), h('span.view-switch-name', view.name), icon('chevronDown', 14));
    sw.addEventListener('click', () => this.openViewMenu(sw, view));
    // The toolbar is kept, so a panel open from it stays with its button.
    const toolbar = this.viewbarEl.querySelector(':scope > .toolbar') || h('div.toolbar');
    renderToolbar(toolbar, this, table, view);
    const find = view.type === 'form' ? null : h('button.icon-btn', { type: 'button', 'aria-label': 'Find in view', 'data-tip': 'Find in view', 'data-kbd': `${modLabel()}F`, onclick: () => this.openFind() }, icon('search', 16));
    this.viewbarEl.replaceChildren(toggle, sw, h('div.toolbar-sep'), toolbar, h('div.viewbar-end', find));
  }

  toggleSidebar(open) {
    const next = open ?? this.el.classList.contains('sidebar-closed');
    this.el.classList.toggle('sidebar-closed', !next);
    if (!isOverlaySidebar()) setPref('sidebarOpen', next);
    this.renderViewbar();
    this.viewInst?.resize?.();
    if (next && isOverlaySidebar()) this.sidebarEl.querySelector('.view-link[aria-current=page]')?.focus();
  }

  mountView() {
    // Destroying the old view saves an open cell edit: the change that
    // makes must not mount a view meanwhile.
    if (this.unmounting) return;
    this.unmounting = true;
    try {
      this.viewInst?.destroy();
    } finally {
      this.unmounting = false;
    }
    this.viewInst = null;
    this.closeFind();
    const view = this.view;
    if (!view) {
      this.viewHost.replaceChildren(h('div.empty', h('h2', 'No views'), h('p', 'Create a view from the sidebar.')));
      return;
    }
    const Cls = VIEWS[view.type] || GridView;
    this.viewInst = new Cls(this, this.table, view);
    this.viewHost.replaceChildren(this.viewInst.el);
    this.viewInst.mounted?.();
  }

  /* ------------------------------------------------------------ changes */

  /** The tab's title: where you are, then the app. */
  updateTitle() {
    const parts = [this.view?.name, this.table?.name, this.base?.doc.name].filter(Boolean);
    document.title = [...new Set(parts), 'Records'].join(' \u2013 ');
  }

  onChange(change, op) {
    this.renderUndo();
    if (change.schema) this.updateTitle();
    if (!this.base.table(this.tableId)) {
      // The table went away (deleted or undone): pick another one. Its
      // address is gone, so it is replaced rather than added to history.
      this.tableId = null;
      this.go(null, null, null, { replace: true });
      return;
    }
    if (!this.table.view(this.viewId)) {
      this.viewId = null;
      this.go(this.tableId, null, null, { replace: true });
      return;
    }
    if (change.schema) {
      if (op?.t === 'base.set' || hasOp(op, 'base.set')) this.renderTopbar();
      if (hasOp(op, 'table.') || op?.t === 'batch') this.renderTabs();
      this.renderSidebar();
      this.renderViewbar();
    }
    if (this.viewInst && this.viewInst.view !== this.view) {
      this.mountView();
      return;
    }
    if (this.viewInst?.view?.type !== this.view.type) {
      this.mountView();
      return;
    }
    this.viewInst?.update(change, op);
    this.recordDialog?.update();
    this.find?.refresh();
  }

  async onVisible() {
    // A cell being edited counts as unsaved: reloading would drop it.
    if (!this.session || this.session.hasUnsaved() || this.viewInst?.editor) return;
    if (await this.session.changedElsewhere()) {
      // Another device saved this base; load its copy.
      const { tableId, viewId } = this;
      const recordId = this.recordDialog?.recordId;
      await this.destroy();
      if (this.app.page !== this) return;
      this.app.page = null;
      history.replaceState(null, '', `${location.pathname}${location.search}#/${[this.baseId, tableId, viewId, recordId].filter(Boolean).join('/')}`);
      await this.app.route();
      toast('Updated with changes from another device.');
    }
  }

  /**
   * A toast whose Undo reverses the action it describes, and only while that
   * action is still the latest change.
   */
  toastUndo(message) {
    const step = this.base.undoStack[this.base.undoStack.length - 1];
    this.undoToasts ||= new Set();
    const t = toast(message, {
      action: {
        label: 'Undo',
        onClick: () => {
          if (this.base.undoStack[this.base.undoStack.length - 1] === step) this.undo();
          else toast('Other changes were made since, so this can no longer be undone from here. Use Undo in the top bar.');
        },
      },
    });
    this.undoToasts.add(t);
    // At most three toasts show at a time.
    if (this.undoToasts.size > 3) this.undoToasts.delete(this.undoToasts.values().next().value);
  }

  undo() {
    const step = this.base.undo();
    if (step) announce(`Undid ${step.label || 'change'}`);
  }

  redo() {
    const step = this.base.redo();
    if (step) announce(`Redid ${step.label || 'change'}`);
  }

  onKey(e) {
    // In the expanded record only undo and redo apply; other dialogs take all keys.
    const modal = !!document.querySelector('dialog[open]');
    if (modal && !this.recordDialog) return;
    const t = e.target;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable || t instanceof HTMLSelectElement;
    const mod = modKey(e);
    const key = e.key.toLowerCase();
    if (mod && key === 'z' && !typing && !document.querySelector('.popover')) {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && key === 'y' && !typing && !document.querySelector('.popover')) {
      e.preventDefault();
      this.redo();
      return;
    }
    if (modal) return;
    if (mod && key === 'f' && !e.shiftKey && this.view?.type !== 'form') {
      e.preventDefault();
      this.openFind();
      return;
    }
    if (mod && e.shiftKey && key === 'l') {
      e.preventDefault();
      this.toggleSidebar();
    }
  }

  /* ------------------------------------------------------------- tables */

  openAddTableMenu(anchor) {
    openMenu(anchor, [
      { label: 'Start from scratch', icon: 'table', onSelect: () => this.addTable() },
      { label: 'Import a CSV file', icon: 'fileUp', onSelect: () => this.importTable() },
    ], { label: 'Add a table' });
  }

  addTable() {
    const n = this.base.doc.tables.length + 1;
    let name = `Table ${n}`;
    const names = new Set(this.base.doc.tables.map((t) => t.name.toLowerCase()));
    for (let i = n; names.has(name.toLowerCase()); i++) name = `Table ${i}`;
    const id = this.base.addTable(name);
    this.go(id, null);
    requestAnimationFrame(() => this.renameTable(this.base.table(id)));
  }

  importTable() {
    importFileDialog({
      mode: 'table',
      onDone: ({ plan }) => {
        const id = addTableFromPlan(this.base, plan);
        this.go(id, null);
        toast(`Imported ${plan.rows.length} record${plan.rows.length === 1 ? '' : 's'}`);
      },
    });
  }

  importInto(table) {
    importFileDialog({
      mode: 'append',
      table,
      onDone: ({ plan, mapping }) => {
        const n = appendPlan(this.base, table.id, plan, mapping);
        toast(`Added ${n} record${n === 1 ? '' : 's'} to ${table.name}`);
      },
    });
  }

  openTableMenu(anchor, t) {
    const tables = this.base.tableList();
    openMenu(anchor, [
      { label: 'Rename table', icon: 'pencil', hint: 'F2', onSelect: () => this.renameTable(t) },
      { label: 'Edit table description', icon: 'info', onSelect: () => this.describeTable(t) },
      { label: 'Duplicate table', icon: 'copy', onSelect: () => this.duplicateTable(t) },
      { type: 'sep' },
      { label: 'Import CSV into this table', icon: 'fileUp', onSelect: () => this.importInto(t) },
      { label: 'Export table as CSV', icon: 'download', onSelect: () => exportCsv(this.base, t, null) },
      { type: 'sep' },
      { label: 'Delete table', icon: 'trash', danger: true, disabled: tables.length < 2, title: tables.length < 2 ? 'A base needs at least one table.' : null, onSelect: () => this.deleteTable(t) },
    ], { label: t.name });
  }

  async renameTable(t) {
    if (!t) return;
    const name = await promptDialog({ title: 'Rename table', label: 'Name', value: t.name, validate: (v) => (!v ? 'Enter a name.' : this.base.tableList().some((x) => x.id !== t.id && x.name.toLowerCase() === v.toLowerCase()) ? 'Another table has this name.' : null) });
    if (name && name !== t.name) this.base.apply({ t: 'table.set', id: t.id, patch: { name } }, { label: 'Rename table' });
  }

  async describeTable(t) {
    const text = await promptDialog({ title: `Description of ${t.name}`, label: 'Description', value: t.schema.description || '', placeholder: 'What is this table for?' });
    if (text !== null) this.base.apply({ t: 'table.set', id: t.id, patch: { description: text } }, { label: 'Edit description' });
  }

  duplicateTable(t) {
    const schema = structuredClone(t.schema);
    const idMap = new Map();
    schema.id = newId('tbl');
    schema.name = `${t.name} copy`;
    for (const f of schema.fields) {
      const nid = newId('fld');
      idMap.set(f.id, nid);
      f.id = nid;
    }
    // Links in a copy point the same way but without an inverse side; links
    // to the table itself point at the copy.
    const self = new Set();
    for (const f of schema.fields) {
      if (f.type !== 'link') continue;
      f.options.inverseId = null;
      if (f.options.tableId === t.id) {
        f.options.tableId = schema.id;
        self.add(f.id);
      }
    }
    const remapCond = (g) => {
      if (!g?.conditions) return;
      for (const c of g.conditions) {
        if (c.conditions) remapCond(c);
        else c.fieldId = idMap.get(c.fieldId) || c.fieldId;
      }
    };
    const remapRefs = (src) => String(src || '').replace(/\{(fld\w+)\}/g, (m, id) => (idMap.has(id) ? `{${idMap.get(id)}}` : m));
    for (const f of schema.fields) {
      if (f.type === 'formula') f.options.formula = remapRefs(f.options.formula);
      if (f.type === 'button' && f.options?.url) f.options.url = remapRefs(f.options.url);
      for (const k of ['linkFieldId']) if (f.options?.[k]) f.options[k] = idMap.get(f.options[k]) || f.options[k];
      // Lookups through a link to the table itself read the copy.
      if (f.options?.targetFieldId && self.has(f.options.linkFieldId)) f.options.targetFieldId = idMap.get(f.options.targetFieldId) || f.options.targetFieldId;
    }
    schema.primaryFieldId = idMap.get(schema.primaryFieldId);
    for (const v of schema.views) {
      v.id = newId('viw');
      remapCond(v.filters);
      for (const r of v.color?.rules || []) remapCond(r.filter);
      v.sorts = (v.sorts || []).map((s) => ({ ...s, fieldId: idMap.get(s.fieldId) }));
      v.groups = (v.groups || []).map((s) => ({ ...s, fieldId: idMap.get(s.fieldId) }));
      v.hidden = (v.hidden || []).map((x) => idMap.get(x));
      v.order = v.order ? v.order.map((x) => idMap.get(x)) : null;
      v.widths = Object.fromEntries(Object.entries(v.widths || {}).map(([k, w]) => [idMap.get(k), w]));
      v.summaries = Object.fromEntries(Object.entries(v.summaries || {}).map(([k, w]) => [idMap.get(k), w]));
      for (const k of ['stackFieldId', 'dateFieldId', 'endFieldId', 'coverFieldId']) if (v[k]) v[k] = idMap.get(v[k]) || null;
      if (v.color?.fieldId) v.color.fieldId = idMap.get(v.color.fieldId);
      if (v.form?.fields) v.form.fields = v.form.fields.map((f) => ({ ...f, id: idMap.get(f.id) }));
    }
    delete schema.chunks;
    const recIds = new Map([...t.records.keys()].map((rid) => [rid, newId('rec')]));
    const recs = [...t.records.values()].map((r) => {
      const c = {};
      for (const [k, val] of Object.entries(r.c)) {
        if (!idMap.has(k)) continue;
        const fid = idMap.get(k);
        c[fid] = self.has(fid) && Array.isArray(val) ? val.map((x) => recIds.get(x)).filter(Boolean) : structuredClone(val);
      }
      return { ...r, id: recIds.get(r.id), c };
    });
    // Links in the copy are one-way, so the linked records do not change.
    this.base.apply({ t: 'table.add', schema, recs, index: this.base.doc.tables.findIndex((x) => x.id === t.id) + 1 }, { label: 'Duplicate table' });
    this.go(schema.id, null);
  }

  async deleteTable(t) {
    if (this.base.tableList().length < 2) return;
    const ok = await confirmDialog({ title: `Delete ${t.name}?`, message: `The table and its ${t.records.size} record${t.records.size === 1 ? '' : 's'} are deleted, along with links to it from other tables. You can undo this.`, confirmLabel: 'Delete table', danger: true });
    if (!ok) return;
    this.base.apply({ t: 'table.del', id: t.id }, { label: 'Delete table' });
    this.toastUndo(`Deleted ${t.name}`);
  }

  /* -------------------------------------------------------------- views */

  createView(type) {
    const table = this.table;
    const id = this.base.addView(table.id, type, `${VIEW_TYPES[type].label}`);
    this.go(table.id, id);
    if (isOverlaySidebar()) this.toggleSidebar(false);
  }

  openViewMenu(anchor, v) {
    const table = this.table;
    openMenu(anchor, [
      { label: 'Rename view', icon: 'pencil', onSelect: () => this.renameView(v) },
      { label: 'Edit view description', icon: 'info', onSelect: () => this.describeView(v) },
      { label: 'Duplicate view', icon: 'copy', onSelect: () => {
        const copy = structuredClone(v);
        copy.id = newId('viw');
        copy.name = `${v.name} copy`;
        this.base.apply({ t: 'view.add', table: table.id, view: copy, index: table.views.indexOf(v) + 1 }, { label: 'Duplicate view' });
        this.go(table.id, copy.id);
      } },
      { type: 'sep' },
      v.type !== 'form' ? { label: 'Download CSV', icon: 'download', onSelect: () => exportCsv(this.base, table, v) } : null,
      v.type !== 'form' ? { label: 'Print view', icon: 'printer', onSelect: () => this.printView(v) } : null,
      { type: 'sep' },
      { label: 'Delete view', icon: 'trash', danger: true, disabled: table.views.length < 2, title: table.views.length < 2 ? 'A table needs at least one view.' : null, onSelect: () => this.deleteView(v) },
    ], { label: v.name });
  }

  async renameView(v) {
    const name = await promptDialog({ title: 'Rename view', label: 'Name', value: v.name, validate: (x) => (x ? null : 'Enter a name.') });
    if (name && name !== v.name) this.base.updateView(this.table.id, v.id, { name }, { label: 'Rename view' });
  }

  async describeView(v) {
    const text = await promptDialog({ title: `Description of ${v.name}`, label: 'Description', value: v.description || '' });
    if (text !== null) this.base.updateView(this.table.id, v.id, { description: text });
  }

  deleteView(v) {
    const table = this.table;
    if (table.views.length < 2) return;
    this.base.apply({ t: 'view.del', table: table.id, id: v.id }, { label: 'Delete view' });
    this.toastUndo(`Deleted ${v.name}`);
  }

  printView(v) {
    printView(this.base, this.table, v);
  }

  /* --------------------------------------------------------------- base */

  openBaseMenu(anchor) {
    const b = this.base.doc;
    openMenu(anchor, [
      { label: 'Rename base', icon: 'pencil', onSelect: async () => {
        const name = await promptDialog({ title: 'Rename base', label: 'Name', value: b.name, validate: (v) => (v ? null : 'Enter a name.') });
        if (name && name !== b.name) this.base.apply({ t: 'base.set', patch: { name } }, { label: 'Rename base' });
      } },
      { label: 'Change color and icon', icon: 'palette', onSelect: () => {
        openPopover(anchor, appearancePicker(b, (patch) => this.base.apply({ t: 'base.set', patch }, { label: 'Change base appearance' })), { className: 'padded', label: 'Color and icon' });
      } },
      { label: 'Duplicate base', icon: 'copy', onSelect: async () => {
        await this.session.flush().catch(() => {});
        try {
          const id = await this.store.duplicateBase(this.baseId);
          toast('Base duplicated', { action: { label: 'Open', onClick: () => this.app.navigate(id) } });
        } catch (err) {
          console.error(err);
          toast('Could not duplicate the base.', { error: true });
        }
      } },
      { label: 'Download a backup', icon: 'download', description: 'Every table, record and comment as a JSON file.', onSelect: () => exportBaseJson(this.base) },
      { type: 'sep' },
      { label: 'All bases', icon: 'home', onSelect: () => this.app.navigate('') },
      { label: 'Move to trash', icon: 'trash', danger: true, onSelect: async () => {
        await this.session.flush().catch(() => {});
        this.store.trashBase(this.baseId);
        this.app.navigate('');
        toast(`Moved ${b.name} to the trash`, { action: { label: 'Undo', onClick: () => this.store.restoreBase(this.baseId) } });
      } },
    ], { label: b.name });
  }

  /* ------------------------------------------------------------ records */

  openRecord(recordId, opts = {}) {
    const table = this.table;
    if (!table?.record(recordId)) return;
    if (this.recordDialog) this.recordDialog.close({ silent: true });
    const list = () => this.viewInst?.recordOrder?.() || table.ordered().map((r) => r.id);
    this.recordDialog = openRecordDialog(this, table, recordId, {
      list,
      onNavigate: (id) => this.go(table.id, this.viewId, id),
      onClose: (o) => {
        this.recordDialog = null;
        if (!o?.fromRoute && !o?.silent) this.go(table.id, this.viewId, null);
        this.viewInst?.focus?.();
      },
    });
    if (!opts.fromRoute) this.go(table.id, this.viewId, recordId);
  }

  /** Add a record (from a view's add button) and open it. */
  addRecord(cells = {}, { open = true } = {}) {
    const [id] = this.base.createRecords(this.table.id, [cells]);
    if (open) this.openRecord(id);
    return id;
  }

  /* --------------------------------------------------------------- find */

  openFind() {
    if (!this.viewInst?.setSearch) return;
    if (this.find) {
      this.find.input.focus();
      this.find.input.select();
      return;
    }
    const input = h('input.input', { type: 'search', placeholder: 'Find in view', 'aria-label': 'Find in view' });
    const count = h('span.find-count', { 'aria-live': 'polite' });
    const prev = h('button.icon-btn', { type: 'button', 'aria-label': 'Previous match', onclick: () => step(-1) }, icon('chevronUp', 16));
    const next = h('button.icon-btn', { type: 'button', 'aria-label': 'Next match', onclick: () => step(1) }, icon('chevronDown', 16));
    const close = h('button.icon-btn', { type: 'button', 'aria-label': 'Close find', onclick: () => this.closeFind(true) }, icon('x', 16));
    const bar = h('div.findbar', { role: 'search' }, icon('search', 14), input, count, prev, next, close);
    const paint = (info) => {
      count.textContent = !input.value ? '' : info.total ? `${info.index + 1} of ${info.total}` : 'No matches';
    };
    const step = (d) => paint(this.viewInst.stepSearch(d));
    input.addEventListener('input', () => paint(this.viewInst.setSearch(input.value)));
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        step(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeFind(true);
      }
    });
    this.viewHost.append(bar);
    this.find = { bar, input, refresh: () => input.value && paint(this.viewInst.setSearch(input.value, { keep: true })) };
    input.focus();
  }

  closeFind(focusView = false) {
    if (!this.find) return;
    this.find.bar.remove();
    this.find = null;
    this.viewInst?.setSearch?.('');
    if (focusView) this.viewInst?.focus?.();
  }

  quickSearch() {
    // Not while loading; once open, the shortcut returns to it.
    if (!this.base) return;
    if (this.searchPop && !this.searchPop.closed) {
      this.searchPop.el.querySelector('input')?.focus();
      return;
    }
    this.searchPop = openQuickSearch(this);
  }
}

/** On narrow screens the views sidebar opens over the view (see shell.css). */
function isOverlaySidebar() {
  return typeof matchMedia === 'function' && matchMedia('(max-width: 768px)').matches;
}

function hasOp(op, prefix) {
  if (!op) return false;
  if (op.t?.startsWith(prefix)) return true;
  if (op.ops) return op.ops.some((o) => hasOp(o, prefix));
  return false;
}

function modLabel() {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? '⌘' : 'Ctrl+';
}
