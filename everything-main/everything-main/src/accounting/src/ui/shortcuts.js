/**
 * Keyboard shortcuts: Ctrl+Alt (Ctrl+Option on a Mac) plus a letter, matched
 * on the physical key (e.code) so they work on every keyboard layout and with
 * Option's dead keys on macOS.
 */
import { el } from './dom.js';
import { isMac } from './dom.js';
import { openDialog, topLayer } from './dialog.js';

const MOD = isMac ? 'Ctrl+Option' : 'Ctrl+Alt';

export const GLOBAL = [
  { id: 'newInvoice', code: 'KeyI', label: 'New invoice' },
  { id: 'newPayment', code: 'KeyR', label: 'Record payment' },
  { id: 'newEstimate', code: 'KeyE', label: 'New estimate' },
  { id: 'newExpense', code: 'KeyX', label: 'New expense' },
  { id: 'newCheck', code: 'KeyW', label: 'New check' },
  { id: 'newBill', code: 'KeyB', label: 'New bill' },
  { id: 'newJournal', code: 'KeyJ', label: 'New journal entry' },
  { id: 'customers', code: 'KeyC', label: 'Customers' },
  { id: 'vendors', code: 'KeyV', label: 'Vendors' },
  { id: 'accounts', code: 'KeyA', label: 'Chart of accounts' },
  { id: 'items', code: 'KeyL', label: 'Products and services' },
  { id: 'banking', code: 'KeyK', label: 'Banking' },
  { id: 'reports', code: 'KeyP', label: 'Reports' },
  { id: 'home', code: 'KeyH', label: 'Home' },
  { id: 'search', code: 'KeyF', label: 'Search transactions' },
  { id: 'help', code: 'Slash', label: 'Show keyboard shortcuts' },
];

export const FORM = [
  { id: 'saveNew', code: 'KeyS', label: 'Save and new' },
  { id: 'saveClose', code: 'KeyD', label: 'Save and close' },
  { id: 'print', code: 'KeyN', label: 'Print' },
  { id: 'addLine', code: 'KeyG', label: 'Add a line' },
];

export function shortcutLabel(id) {
  const s = [...GLOBAL, ...FORM].find((x) => x.id === id);
  if (!s) return '';
  const key = s.code === 'Slash' ? '/' : s.code.replace('Key', '');
  return `${MOD}+${key}`;
}

const handlers = new Map();
const formHandlers = [];

export function onShortcut(id, fn) {
  handlers.set(id, fn);
}

/** A form registers its own handlers while it is open. Returns an unregister function. */
export function pushFormShortcuts(map) {
  formHandlers.push(map);
  return () => {
    const i = formHandlers.indexOf(map);
    if (i >= 0) formHandlers.splice(i, 1);
  };
}

function isTyping(e) {
  const t = e.target;
  return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export function installShortcuts() {
  document.addEventListener('keydown', (e) => {
    // "/" focuses search, like most web apps, when not already typing.
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e) && !topLayer()) {
      e.preventDefault();
      handlers.get('search')?.();
      return;
    }
    if (e.key === '?' && !isTyping(e) && !topLayer()) {
      e.preventDefault();
      showHelp();
      return;
    }
    if (!(e.ctrlKey && e.altKey) || e.metaKey) return;
    // AltGr reports as Ctrl+Alt on Windows; it is a character, not a shortcut.
    if (e.getModifierState?.('AltGraph')) return;
    const form = formHandlers[formHandlers.length - 1];
    // A confirm or picker sitting on top of a form gets the keys, not the form.
    if (form?.layer && topLayer() !== form.layer) return;
    if (form) {
      const f = FORM.find((s) => s.code === e.code);
      if (f && form[f.id]) {
        e.preventDefault();
        form[f.id]();
        return;
      }
    }
    const g = GLOBAL.find((s) => s.code === e.code);
    // Over a form, keys that would change or search the page hidden behind it
    // are left alone: only "new ..." (another form on top) and the shortcut list.
    if (topLayer() && (!form || !g || !(g.id.startsWith('new') || g.id === 'help'))) return;
    if (g && handlers.has(g.id)) {
      e.preventDefault();
      handlers.get(g.id)();
    }
  });
  document.addEventListener('shortcuts:help', showHelp);
}

function table(caption, list) {
  return el('table.grid.shortcut-table', {},
    el('caption', {}, caption),
    el('tbody', {}, list.map((s) => el('tr', {}, el('td', {}, s.label), el('td.num', {}, el('kbd', {}, shortcutLabel(s.id)))))));
}

export function showHelp() {
  openDialog({
    title: 'Keyboard shortcuts',
    wide: true,
    body: el('div.shortcut-grid', {},
      table('Anywhere', GLOBAL),
      el('div', {},
        table('In a transaction', FORM),
        el('table.grid.shortcut-table', {},
          el('caption', {}, 'In a date field'),
          el('tbody', {}, [
            ['Next day / previous day', '+  /  -'], ['Today', 'T'], ['First / last day of week', 'W  /  K'],
            ['First / last day of month', 'M  /  H'], ['First / last day of year', 'Y  /  R'],
          ].map(([a, b]) => el('tr', {}, el('td', {}, a), el('td.num', {}, el('kbd', {}, b)))))),
        el('table.grid.shortcut-table', {},
          el('caption', {}, 'Elsewhere'),
          el('tbody', {}, [['Search', '/'], ['This list', '?'], ['Close a dialog or form', 'Esc']].map(([a, b]) => el('tr', {}, el('td', {}, a), el('td.num', {}, el('kbd', {}, b)))))))),
  });
}
