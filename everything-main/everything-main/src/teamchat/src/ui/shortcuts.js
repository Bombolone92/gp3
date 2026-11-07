/**
 * Keyboard shortcuts beyond a single view, and the panel that lists them
 * all (Cmd/Ctrl+/): a search box, then groups of rows with the keys drawn
 * as caps.
 *
 * The bindings here move between conversations and views; the ones that
 * act on a message (U, L, P, S, R, E, Delete) live in message.js and the
 * composer's formatting keys in formatting.js. All of them are listed.
 */
import { el, composing, clearOnEscape, enterSends } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { confirmDialog } from './modal.js';
import { closeMenu } from './menu.js';
import { store } from '../lib/store.js';
import { navigate, parseHash } from '../lib/router.js';
import { newDmDialog, settingsDialog } from './dialogs.js';
import { joinHuddleFlow } from './huddle.js';
import { normalize } from '../shared/search.js';

const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = mac ? '⌘' : 'Ctrl';
const ALT = mac ? '⌥' : 'Alt';
const SHIFT = mac ? '⇧' : 'Shift';

/**
 * The list the panel shows: groups of [description, keys...]. Read when the
 * panel is drawn, not once: what sends a message and what breaks the line
 * follow the Enter preference (Settings: "Enter sends"), and on a touch
 * screen Enter always breaks the line (see enterSends), so a fixed list
 * said Shift+Enter for a new line to a reader whose Enter already was one,
 * and never said how a message is sent at all.
 */
export function shortcutGroups() {
  const sends = enterSends(store.profile?.prefs);
  return [
  ['Basics', [
    ['Search, or jump to a conversation', [MOD, 'K']],
    ['New message', [SHIFT, MOD, 'K']],
    ['Back in history', [MOD, '[']],
    ['Forward in history', [MOD, ']']],
    ['Edit your last message (in an empty box)', ['↑']],
    ['Close the side panel, a menu, or a dialog', ['Esc']],
    ['Mark every conversation read', [SHIFT, 'Esc']],
    ['Set a status', [SHIFT, MOD, 'Y']],
    ['Start, join, or leave the huddle here', [SHIFT, MOD, 'H']],
    ['Toggle this panel', [MOD, '/']],
  ]],
  ['Navigation', [
    ['Previous conversation', [ALT, '↑']],
    ['Next conversation', [ALT, '↓']],
    ['Previous unread conversation', [ALT, SHIFT, '↑']],
    ['Next unread conversation', [ALT, SHIFT, '↓']],
    ['Threads', [SHIFT, MOD, 'T']],
    ['Activity', [SHIFT, MOD, 'M']],
    ['Later', [SHIFT, MOD, 'S']],
    ['Direct messages', [SHIFT, MOD, 'D']],
    ['Menu for a conversation in the sidebar (its row focused)', [SHIFT, 'F10']],
    ['Close the side panel', [MOD, '.']],
  ]],
  ['Messages (focused or under the pointer)', [
    ['Previous message (a message focused)', ['↑']],
    ['Next message', ['↓']],
    ['First loaded message', ['Home']],
    ['Last message', ['End']],
    ['Reply in thread', ['R']],
    ['Mark unread from here', ['U']],
    ['Copy link', ['L']],
    ['Pin or unpin', ['P']],
    ['Save for later or remove', ['S']],
    ['Edit your message', ['E']],
    ['Delete your message', ['Delete']],
  ]],
  ['Formatting and sending (in the composer)', [
    ['Bold', [MOD, 'B']],
    ['Italic', [MOD, 'I']],
    ['Strikethrough', [MOD, SHIFT, 'X']],
    ['Code', [MOD, SHIFT, 'C']],
    ['Code block', [MOD, SHIFT, ALT, 'C']],
    ['Quote', [MOD, SHIFT, '9']],
    ['Link', [MOD, SHIFT, 'U']],
    // Cmd/Ctrl+Enter sends either way (see composer.js); the bare Enter is
    // the one the preference decides.
    ['Send message', sends ? ['Enter'] : [MOD, 'Enter']],
    ['New line', sends ? [SHIFT, 'Enter'] : ['Enter']],
  ]],
  ];
}

/** The list as it stands when the module loads (the panel reads shortcutGroups() afresh). */
export const SHORTCUT_GROUPS = shortcutGroups();

/* ---- moving around --------------------------------------------------- */

/**
 * The order the sidebar shows: its rows as drawn (Starred, the reader's own
 * sections, External connections, Channels, Direct messages, sorted by name
 * or by activity and with muted rows hidden as they chose), archived
 * channels left out, so the step lands where the eye expects. Only while
 * a filter is typed is the full list not on the page; then the default
 * arrangement stands in: starred, channels, direct messages.
 */
function ordered() {
  if (!store.ws) return [];
  const shown = [...document.querySelectorAll('.side-row > .side-item[href]:not(.archived)')]
    .map((a) => parseHash(a.getAttribute('href')).conv)
    .filter(Boolean);
  if (shown.length) return [...new Set(shown)];
  const stars = store.starred();
  const chans = store.joinedChannels().filter((c) => !c.archived).map((c) => c.id);
  const dms = store.dms().map((d) => d.id);
  const rest = [...chans, ...dms].filter((id) => !stars.includes(id));
  return [...stars.filter((id) => chans.includes(id) || dms.includes(id)), ...rest];
}

function unreadOf(id) {
  return !store.isMuted(id) && (store.unreadCount(id) > 0 || store.mentionCount(id) > 0);
}

/** Step to the previous or next conversation, optionally only unread ones. */
function step(dir, { unreadOnly = false } = {}) {
  const all = ordered();
  const list = unreadOnly ? all.filter(unreadOf) : all;
  if (!list.length) {
    if (unreadOnly) toast('Nothing unread');
    return;
  }
  const cur = parseHash(location.hash).conv;
  const at = all.indexOf(cur);
  let next;
  if (at === -1) next = dir > 0 ? list[0] : list[list.length - 1];
  else if (unreadOnly) {
    // The nearest unread row on that side of the current one, wrapping.
    const after = all.slice(at + 1).find(unreadOf);
    const before = [...all.slice(0, at)].reverse().find(unreadOf);
    next = dir > 0 ? after ?? before ?? list[0] : before ?? after ?? list[list.length - 1];
  } else next = all[(at + dir + all.length) % all.length];
  if (next && next !== cur) navigate({ ws: store.wsId, conv: next, view: null });
}

async function markAllRead() {
  // Archived channels too: stepping skips them, but what was unread in one
  // when it was archived stays bold and counted in the tab title until read.
  const all = [...store.joinedChannels().map((c) => c.id), ...store.dms().map((d) => d.id)];
  const ids = all.filter((id) => store.unreadCount(id) > 0 || store.mentionCount(id) > 0);
  if (!ids.length) {
    toast('Nothing unread');
    return;
  }
  const ok = await confirmDialog({ title: 'Mark all messages as read?', message: `${ids.length} conversation${ids.length === 1 ? '' : 's'} will stop showing as unread.`, confirmLabel: 'Mark as read', danger: false });
  if (!ok) return;
  for (const id of ids) {
    const latest = store.latestSeq(id);
    if (latest) {
      store.markRead(id, latest);
      store.me.reads[id] = latest;
    }
  }
  store.emit('activity');
  toast('Everything marked as read', { icon: 'checkCheck' });
}

/**
 * Install the global bindings. `hooks.toggleShortcuts()` shows the panel;
 * `hooks.closePanel()` closes whatever is in the side panel;
 * `hooks.openPane(kind)` shows a pane (Direct messages, Activity, Later) in
 * the sidebar's place, keeping a conversation already open beside that very
 * pane as the rail's item does. Nothing fires while a dialog is open, and
 * the plain letters never fire from a field.
 */
/** Cmd/Ctrl+Shift+H: toggle the huddle of the open conversation. */
function toggleHuddle() {
  const r = parseHash(location.hash);
  if (!r.conv || !store.wsId) return;
  if (store.inHuddle(r.conv)) store.leaveHuddle().catch(() => {});
  else if (store.canHuddle(r.conv)) joinHuddleFlow(r.conv);
  else toast('A huddle cannot be started here', { icon: 'alert' });
}

export function installShortcuts(hooks) {
  document.addEventListener('keydown', (e) => {
    // A key pressed mid-composition belongs to the IME (Escape cancels the
    // word being composed, an arrow picks among its candidates), not to
    // the app; Firefox and Safari deliver it with the key's own name.
    if (e.defaultPrevented || composing(e) || !store.wsId) return;
    const dialog = document.querySelector('.modal-root:not(.closing)');
    const mod = mac ? e.metaKey : e.ctrlKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // A menu standing open goes first: the keyboard is leaving it for what
    // the shortcut opens, and a menu does not close on its own when the
    // keyboard moves away (a route closes it; a dialog, the shortcuts list
    // and the huddle do not route). Left standing, a row's menu stayed drawn
    // over the New message dialog (a menu floats above a dialog's scrim)
    // and over the shortcuts list, until a click somewhere took it down, and
    // its Escape then handed the keyboard back to its kebab behind the
    // dialog, out of the dialog's reach.
    const run = (fn) => { e.preventDefault(); closeMenu(); fn(); };
    // Nothing while a dialog is open: the app behind it is inert, so the
    // shortcuts panel would open unseen and unfocusable behind the scrim.
    if (dialog) return undefined;
    if (mod && !e.altKey && key === '/') return run(() => hooks.toggleShortcuts());
    if (mod && e.shiftKey && !e.altKey) {
      if (key === 'k') return run(() => newDmDialog());
      if (key === 't') return run(() => navigate({ ws: store.wsId, view: 'threads' }));
      if (key === 'm') return run(() => hooks.openPane('activity'));
      if (key === 's') return run(() => hooks.openPane('later'));
      if (key === 'd') return run(() => hooks.openPane('dms'));
      if (key === 'y') return run(() => settingsDialog({ section: 'status' }));
      if (key === 'h') return run(() => toggleHuddle());
    }
    if (mod && !e.shiftKey && !e.altKey) {
      if (key === '[') return run(() => history.back());
      if (key === ']') return run(() => history.forward());
      if (key === '.') return run(() => hooks.closePanel());
    }
    if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      return run(() => step(e.key === 'ArrowDown' ? 1 : -1, { unreadOnly: e.shiftKey }));
    }
    if (e.key === 'Escape' && e.shiftKey && !mod && !e.altKey) return run(markAllRead);
    return undefined;
  });
}

/* ---- the panel ------------------------------------------------------- */

const cap = (k) => el('kbd.key-cap', {}, k);

/**
 * The keys in words, for a screen reader and for the panel's search: the
 * caps show the Mac's glyphs (⌘ ⌥ ⇧) and arrows, which a screen reader
 * reads by their character names ("place of interest sign") or not at all,
 * and which nobody types into the search box; "cmd", "command", "option",
 * "shift" and "escape" found nothing. Said as "Shift Command K", found by
 * any of the words, and by the abbreviations people use for them.
 */
const KEY_WORDS = { '⌘': 'Command', '⌥': 'Option', '⇧': 'Shift', '↑': 'Up arrow', '↓': 'Down arrow', Esc: 'Escape', Ctrl: 'Control' };
const KEY_ALIASES = { '⌘': 'cmd', '⌥': 'alt', Esc: 'esc', Ctrl: 'ctrl' };
const keyWords = (keys) => keys.map((k) => KEY_WORDS[k] || k).join(' ');
// The sequence three ways (the glyphs, the words, the short forms), each
// whole, so "command k" and "cmd k" both find ⌘ K.
const keySearchWords = (keys) => [keys.join(' '), keyWords(keys), keys.map((k) => KEY_ALIASES[k] || KEY_WORDS[k] || k).join(' ')].join(' | ');

/** Render the shortcuts list into the side panel; returns { destroy }. */
export function renderShortcutsPanel(panel, { onClose }) {
  const search = el('input.input.shortcuts-search', { type: 'search', placeholder: 'Search keyboard shortcuts', 'aria-label': 'Search keyboard shortcuts', autocomplete: 'off' });
  const body = el('div.panel-body.shortcuts-body');
  // Said aloud as well as shown: that the words in the box match no
  // shortcut. The box keeps the keyboard while the list empties under the
  // words typed, so a screen reader heard nothing of it; and nothing is
  // said while rows still match, rather than a count at every letter. One
  // region in place from the start, as the sidebar's and the Directory's
  // boxes have, set only when the words change.
  const status = el('div.visually-hidden', { role: 'status', 'aria-live': 'polite' });
  const say = (text) => { if (status.textContent !== text) status.textContent = text; };
  const draw = () => {
    // Compared as search reads them, lowercase with accents and other marks
    // stripped on both sides, as the sidebar's, the Direct messages list's
    // and the Directory's boxes compare: a reader whose keyboard writes
    // "rép" finds "Reply in thread".
    const q = normalize(search.value.trim());
    body.replaceChildren();
    body.append(el('p.shortcuts-hint', {}, cap(MOD), cap('/'), el('span', {}, ' to toggle this panel')));
    let any = false;
    for (const [title, rows] of shortcutGroups()) {
      const hits = rows.filter(([what, keys]) => !q || normalize(what).includes(q) || normalize(keySearchWords(keys)).includes(q));
      if (!hits.length) continue;
      any = true;
      body.append(el('h3.shortcuts-title', {}, title),
        el('div.shortcuts-list', {}, ...hits.map(([what, keys]) => el('div.shortcut-row', {},
          el('span.shortcut-what', {}, what),
          el('span.shortcut-keys', { role: 'img', 'aria-label': keyWords(keys) }, ...keys.map(cap))))));
    }
    const nothing = `No shortcut matches “${search.value.trim()}”`;
    if (!any) body.append(el('p.side-empty', {}, nothing));
    say(any ? '' : nothing);
  };
  search.addEventListener('input', draw);
  // Escape with words in the box clears them; the panel closes on the next one.
  clearOnEscape(search);
  panel.replaceChildren(
    el('div.panel-head', {},
      el('h2', {}, 'Keyboard shortcuts'),
      el('button.icon-btn', { type: 'button', html: icon('x', 20), 'aria-label': 'Close panel', onclick: onClose })),
    el('div.shortcuts-search-row', {}, el('span.side-filter-icon', { html: icon('search', 15, 2) }), search),
    body,
    status);
  draw();
  setTimeout(() => search.focus(), 0);
  return { destroy() {} };
}
