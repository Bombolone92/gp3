import { el } from '../lib/dom.js';
import { parseRoute, projectHash } from '../lib/routes.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { openTaskSearch } from './search.js';
import { openQuickAdd } from './quickadd.js';
import { openProjectForm } from './projectform.js';
import { undoProject, redoProject } from './history.js';

/**
 * Keyboard shortcuts.
 *
 * Rules that matter more than the bindings themselves: nothing fires while
 * focus is in a text field or an IME composition is open, nothing fires
 * while a dialog or menu is up (the page behind them is inert), and every
 * binding is listed in the `?` dialog so none of it is folklore.
 *
 * Views that can do better than the generic behaviour register an action —
 * the board takes over `n` so it opens the composer in the right column
 * rather than a dialog.
 */

const isMac = typeof navigator !== 'undefined'
  && /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '');

export const MOD_KEY = isMac ? '⌘' : 'Ctrl';

export const SHORTCUT_GROUPS = [
  {
    title: 'Anywhere',
    items: [
      { keys: [MOD_KEY, 'K'], label: 'Command palette' },
      { keys: [MOD_KEY, 'Z'], label: 'Undo the last change in this project' },
      { keys: ['Shift', MOD_KEY, 'Z'], label: 'Redo it' },
      { keys: ['/'], label: 'Find a task' },
      { keys: ['n'], label: 'New task' },
      { keys: ['Shift', 'N'], label: 'New project' },
      { keys: ['?'], label: 'This list of shortcuts' },
      { keys: ['Esc'], label: 'Close the dialog or menu on top' },
    ],
  },
  {
    title: 'Go to',
    // A prefix, not a chord: press g, release, then the second key.
    sequence: true,
    items: [
      { keys: ['g', 'b'], label: 'Board' },
      { keys: ['g', 'l'], label: 'List' },
      { keys: ['g', 't'], label: 'Timeline' },
      { keys: ['g', 'm'], label: 'Milestones' },
    ],
  },
  {
    title: 'With tasks on screen',
    items: [
      { keys: ['j'], label: 'Focus the next task' },
      { keys: ['k'], label: 'Focus the previous task' },
      { keys: ['e'], label: 'Open the focused task' },
      { keys: ['Alt', '←→↑↓'], label: 'Move the focused card on the board' },
      { keys: ['Alt', '←→'], label: 'Reschedule the focused bar on the timeline' },
      { keys: ['Alt', '↑↓'], label: 'Move the focused project in the sidebar' },
    ],
  },
];

const TABS = { b: 'board', l: 'list', t: 'timeline', m: 'milestones' };
const PREFIX_MS = 1500;

/**
 * Whatever the current view offers as its list of tasks, in visual order.
 *
 * The timeline's bars and its unscheduled chips belong here too: the `?`
 * dialog offers j/k "with tasks on screen" and then, in the same breath,
 * Alt+arrows on "the focused bar" — so walking to a bar has to be one of the
 * things j and k can do, rather than something only Tab reaches.
 */
const ITEM_SELECTOR = '.card[data-task-id], .list-title, .agenda-main,'
  + ' .tl-bar[data-task-id], .tl-unscheduled-item[data-task-id]';

/** Views register the actions they can do better than the default. */
const actions = new Map();

export function registerShortcutAction(name, fn) {
  actions.set(name, fn);
  return () => { if (actions.get(name) === fn) actions.delete(name); };
}

const isTyping = (target) => !!target?.closest?.(
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])');

const layerOpen = () => !!document.querySelector('.modal-root:not(.closing), .menu');

function items() {
  return [...(document.querySelector('.view-wrap')?.querySelectorAll(ITEM_SELECTOR) ?? [])];
}

function moveFocus(step) {
  const all = items();
  if (!all.length) return false;
  // Focus may sit on a child of the item (a title button inside a row).
  const from = all.findIndex((n) => n === document.activeElement
    || n.contains(document.activeElement));
  const next = from < 0
    ? (step > 0 ? 0 : all.length - 1)
    : (from + step + all.length) % all.length;
  all[next].focus();
  all[next].scrollIntoView({ block: 'nearest' });
  return true;
}

function openFocused() {
  const all = items();
  const current = all.find((n) => n === document.activeElement || n.contains(document.activeElement));
  (current ?? all[0])?.click();
  return !!(current ?? all[0]);
}

export function initShortcuts() {
  let prefix = null;
  let prefixTimer = null;

  const clearPrefix = () => {
    clearTimeout(prefixTimer);
    prefix = null;
  };

  function onKeyDown(e) {
    if (e.isComposing || e.defaultPrevented) return;

    // The palette is the one binding that has to work from a text field,
    // but not from on top of another dialog.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      if (layerOpen()) return;
      e.preventDefault();
      // Imported lazily: the palette pulls in half the app's dialogs, and
      // this module is loaded during boot.
      import('./palette.js').then((m) => m.openCommandPalette());
      return;
    }

    /* Undo and redo for the open project. Never from inside a text field:
       there the browser's own undo is the right one, and stealing it would
       make typing feel broken. */
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      // Not from a text field (the browser's own undo belongs there), and not
      // from on top of a dialog — the board behind it is inert for a reason.
      if (isTyping(e.target) || layerOpen()) return;
      const here = parseRoute(location.hash);
      if (here.name !== 'project') return;
      e.preventDefault();
      if (e.shiftKey) redoProject(here.id);
      else undoProject(here.id);
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTyping(e.target) || layerOpen()) return;

    const route = parseRoute(location.hash);

    if (prefix === 'g') {
      clearPrefix();
      const tab = TABS[e.key.toLowerCase()];
      if (!tab) return;
      e.preventDefault();
      if (route.name !== 'project') {
        toast('Open a project first', { icon: 'board' });
        return;
      }
      location.hash = projectHash(route.id, tab);
      return;
    }

    switch (e.key) {
      case 'g':
        e.preventDefault();
        prefix = 'g';
        prefixTimer = setTimeout(clearPrefix, PREFIX_MS);
        return;
      case '/':
        e.preventDefault();
        openTaskSearch();
        return;
      case '?':
        e.preventDefault();
        openShortcuts();
        return;
      case 'n':
        e.preventDefault();
        if (!actions.get('new-task')?.()) {
          openQuickAdd({ projectId: route.name === 'project' ? route.id : null });
        }
        return;
      case 'N':
        e.preventDefault();
        openProjectForm({});
        return;
      case 'j':
      case 'k':
        if (moveFocus(e.key === 'j' ? 1 : -1)) e.preventDefault();
        return;
      case 'e':
        if (openFocused()) e.preventDefault();
        return;
      default:
    }
  }

  window.addEventListener('keydown', onKeyDown);
  return {
    destroy() {
      clearPrefix();
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}

/** The `?` dialog — also reachable from Settings, so it is discoverable. */
export function openShortcuts() {
  const content = el('div.shortcut-doc', {},
    SHORTCUT_GROUPS.map((group) => el('section.shortcut-group', {},
      el('h3.shortcut-title', {}, group.title),
      el('dl.shortcut-list', {}, group.items.flatMap((item) => [
        el('dt.shortcut-keys', {},
          item.keys.flatMap((k, i) => [
            i ? el('span.shortcut-plus', { 'aria-hidden': 'true' },
              group.sequence ? 'then' : '+') : null,
            el('kbd', {}, k),
          ])),
        el('dd.shortcut-what', {}, item.label),
      ]))
    )),
    el('p.form-hint', {},
      'Shortcuts stay out of the way while you are typing, and while a dialog '
      + 'or menu is open.')
  );
  return openModal({ title: 'Keyboard shortcuts', content, dismissOnBack: true });
}

