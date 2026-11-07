/**
 * The app shell: routes between the home screen and open bases, owns the
 * account menu, the first-run notice, keyboard help and saving on exit.
 *
 * Routes (in the hash, so they work inside the Puter desktop too):
 *   #/                                  home
 *   #/trash                             bases in the trash
 *   #/<baseId>[/<tableId>[/<viewId>[/<recordId>]]]
 */
import { h, modKey } from '../lib/dom.js';
import { icon, REPO_URL } from '../lib/icons.js';
import { accentColor } from '../lib/colors.js';
import { openMenu } from './menu.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';
import { installTooltips } from './tooltip.js';
import { getTheme, setTheme, prefs, setPref } from './prefs.js';
import { HomePage } from './home.js';
import { BasePage } from './basepage.js';
import { importFileDialog } from './importer.js';

export class App {
  constructor(root, { store, user, env, onSignOut }) {
    this.root = root;
    this.store = store;
    this.user = user;
    this.env = env;
    this.onSignOut = onSignOut;
    this.picture = null;
    this.page = null;
    // Account buttons to repaint when the picture arrives. Weak, so pages
    // that were left (and their records) can be freed.
    this.avatars = new Set();
    this.routeToken = 0;
  }

  start() {
    this.root.removeAttribute('aria-busy');
    this.root.replaceChildren(h('a.skip-link', { href: '#main', onclick: (e) => {
      e.preventDefault();
      document.getElementById('main')?.focus();
    } }, 'Skip to content'), (this.host = h('div.app-host')));
    installTooltips();
    this.listeners = [
      [window, 'hashchange', () => this.route()],
      [window, 'beforeunload', (e) => {
        const unsaved = [...this.store.sessions.values()].some((s) => s.hasUnsaved());
        this.store.journalAll();
        // Also writes a base list change still waiting.
        this.store.flushAll();
        if (unsaved) {
          e.preventDefault();
          e.returnValue = '';
        }
      }],
      [document, 'visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.store.journalAll();
          this.store.flushAll();
        } else {
          this.page?.onVisible?.();
        }
      }],
      [document, 'keydown', (e) => this.onKey(e)],
    ];
    for (const [target, type, fn] of this.listeners) target.addEventListener(type, fn);
    this.route();
    if (!prefs().noticeSeen) this.noticeTimer = setTimeout(() => this.showNotice(), 600);
  }

  /** Stop listening and close everything (tests mount several apps). */
  destroy() {
    for (const [target, type, fn] of this.listeners || []) target.removeEventListener(type, fn);
    clearTimeout(this.noticeTimer);
    this.noticeEl?.remove();
    this.destroyPage();
  }

  /* ------------------------------------------------------------ routing */

  parseHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
    if (!parts.length) return { page: 'home' };
    if (parts[0] === 'trash') return { page: 'trash' };
    return { page: 'base', baseId: parts[0], tableId: parts[1] || null, viewId: parts[2] || null, recordId: parts[3] || null };
  }

  navigate(hash, { replace = false } = {}) {
    const url = `${location.pathname}${location.search}#/${hash}`;
    if (`#/${hash}` === location.hash) return;
    if (replace) {
      history.replaceState(null, '', url);
      this.route();
    } else {
      location.hash = `/${hash}`;
    }
  }

  async route() {
    const r = this.parseHash();
    const token = ++this.routeToken;
    if (r.page === 'base') {
      // A base in the trash (Back after moving it there, an old link) is
      // shown in the trash, with a way to restore it.
      const entry = this.store.entry(r.baseId);
      if (entry?.trashedAt) {
        toast(`${entry.name} is in the trash.`, { action: { label: 'Restore', onClick: () => {
          this.store.restoreBase(entry.id);
          this.navigate(entry.id);
        } } });
        this.navigate('trash', { replace: true });
        return;
      }
      if (this.page instanceof BasePage && this.page.baseId === r.baseId) {
        // The address came from history: correcting it (a deleted view)
        // replaces it, so Back keeps working.
        this.page.go(r.tableId, r.viewId, r.recordId, { replace: true });
        return;
      }
      this.destroyPage();
      const page = new BasePage(this, r.baseId);
      this.page = page;
      this.host.replaceChildren(page.el);
      try {
        await page.load(r.tableId, r.viewId, r.recordId);
      } catch (err) {
        if (token !== this.routeToken) return;
        console.error(err);
        this.destroyPage();
        const message = {
          missing: 'That base no longer exists.',
          corrupt: 'Part of this base could not be read, so it was not opened. Nothing was changed.',
        }[err?.code] || 'Could not open the base. Check your connection and try again.';
        toast(message, { error: true });
        this.navigate('', { replace: true });
      }
      return;
    }
    this.destroyPage();
    this.page = new HomePage(this, r.page === 'trash' ? 'trash' : 'home');
    this.host.replaceChildren(this.page.el);
    this.page.focus?.();
  }

  destroyPage() {
    this.page?.destroy?.();
    this.page = null;
  }

  /** Import a CSV file as a new base (files opened from the Puter desktop). */
  importFile(file) {
    importFileDialog({
      file,
      onDone: async ({ name, doc, records }) => {
        const id = await this.store.createBase({ name, color: 'green', icon: 'table', doc, records });
        this.navigate(id);
      },
    });
  }

  /* ------------------------------------------------------------ account */

  setPicture(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return;
    this.picture = dataUrl;
    for (const ref of this.avatars) {
      const btn = ref.deref();
      if (btn) this.paintAvatar(btn);
      else this.avatars.delete(ref);
    }
  }

  paintAvatar(btn) {
    btn.replaceChildren(avatar(this.user?.username || 'You', this.picture));
  }

  /** The avatar button that opens the account menu. */
  accountButton() {
    const name = this.user?.username || 'You';
    const btn = h('button.account-btn', { type: 'button', 'aria-label': `Account: ${name}`, 'aria-haspopup': 'menu', 'data-tip': name });
    this.paintAvatar(btn);
    for (const ref of this.avatars) if (!ref.deref()) this.avatars.delete(ref);
    this.avatars.add(new WeakRef(btn));
    btn.addEventListener('click', () => this.openAccountMenu(btn));
    return btn;
  }

  openAccountMenu(anchor) {
    const theme = getTheme();
    const t = (value, label, ic) => ({ label, icon: ic, checked: theme === value, radio: true, onSelect: () => setTheme(value) });
    const items = [
      { type: 'header', label: this.user?.username ? `Signed in as ${this.user.username}` : 'Records' },
      { label: 'Appearance', icon: 'sun', submenu: () => [t('system', 'System', 'monitor'), t('light', 'Light', 'sun'), t('dark', 'Dark', 'moon')] },
      { label: 'Keyboard shortcuts', icon: 'keyboard', hint: '?', onSelect: () => this.showShortcuts() },
      { label: 'About this preview', icon: 'info', onSelect: () => this.showNotice(true) },
      { label: 'Source code on GitHub', icon: 'github', hint: '\u2197', onSelect: () => window.open(REPO_URL, '_blank', 'noopener') },
    ];
    if (this.env !== 'app' && this.onSignOut) {
      items.push({ type: 'sep' }, { label: 'Sign out', icon: 'logOut', onSelect: () => this.signOut() });
    }
    openMenu(anchor, items, { placement: 'bottom-end', label: 'Account' });
  }

  async signOut() {
    await this.store.flushAll().catch(() => {});
    this.onSignOut?.();
  }

  /* ------------------------------------------------------------ notices */

  /**
   * A small, dismissible notice in the corner on first launch. It does not
   * take focus or block anything.
   */
  showNotice(force = false) {
    if (this.noticeEl?.isConnected) return;
    if (!force && prefs().noticeSeen) return;
    const close = () => {
      setPref('noticeSeen', true);
      this.noticeEl?.remove();
      this.noticeEl = null;
    };
    this.noticeEl = h(
      'aside.notice',
      { role: 'region', 'aria-label': 'Preview notice' },
      h('div.notice-head', h('span.notice-badge', 'Alpha'), h('span.notice-title', 'Early preview'), h('button.icon-btn', { type: 'button', 'aria-label': 'Dismiss notice', onclick: close }, icon('x', 14))),
      h('p', 'Records is in early development. Features may change and data could be lost, so please do not rely on it for important work yet. Export anything you want to keep.'),
      h('div.notice-actions', h('button.btn.small', { type: 'button', onclick: close }, 'Got it')),
    );
    document.body.append(this.noticeEl);
  }

  showShortcuts() {
    const mod = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
    const groups = [
      ['Grid', [
        ['Move between cells', 'Arrow keys'], ['Next or previous cell', 'Tab / Shift+Tab'], ['Edit cell', 'Enter or start typing'],
        ['Stop editing', 'Escape'], ['Expand record', 'Space'], ['Clear cells', 'Delete'], ['Select cells', 'Shift+Arrow keys'],
        ['Jump to edge', `${mod}+Arrow keys`], ['Select all cells', `${mod}+A`], ['Copy, cut, paste', `${mod}+C, ${mod}+X, ${mod}+V`],
        ['Fill down', `${mod}+D`], ['Insert record below', 'Shift+Enter'], ['Check or uncheck', 'Space on a checkbox'],
      ]],
      ['Everywhere', [
        ['Undo', `${mod}+Z`], ['Redo', `${mod}+Shift+Z`], ['Find in view', `${mod}+F`], ['Quick search', `${mod}+K`],
        ['Toggle sidebar', `${mod}+Shift+L`], ['Keyboard shortcuts', '?'],
      ]],
      ['Expanded record', [['Previous or next record', `${mod}+Shift+, / .`], ['Close', 'Escape']]],
    ];
    openDialog({
      title: 'Keyboard shortcuts',
      className: 'wide',
      body: h(
        'div.shortcut-groups',
        groups.map(([title, rows]) => h('section', h('h3.shortcut-title', title), h('dl.shortcuts', rows.map(([label, keys]) => [h('dt', label), h('dd', h('kbd', keys))])))),
      ),
    });
  }

  onKey(e) {
    const t = e.target;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable;
    // A "?" the grid took (typing into a cell) is not a shortcut.
    if (e.key === '?' && !typing && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !document.querySelector('dialog[open], .popover')) {
      e.preventDefault();
      this.showShortcuts();
      return;
    }
    // Only where there is a quick search: elsewhere the key is the browser's.
    if (modKey(e) && e.key.toLowerCase() === 'k' && !e.shiftKey && this.page?.quickSearch && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      this.page.quickSearch();
    }
  }
}

/** A round avatar: the profile picture, or initials on a color. */
export function avatar(name, picture, size = '') {
  if (picture) return h(`img.avatar${size ? `.${size}` : ''}`, { src: picture, alt: '' });
  const initials = String(name || '?').trim().slice(0, 2).toUpperCase();
  const hues = ['blue', 'teal', 'green', 'orange', 'red', 'pink', 'purple', 'cyan'];
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return h(`span.avatar${size ? `.${size}` : ''}`, { 'aria-hidden': 'true', style: { background: accentColor(hues[hash % hues.length]) } }, initials);
}
