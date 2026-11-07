/**
 * The DMs pane, which takes the sidebar's place when the rail's DMs item is
 * chosen: every direct message, most recent first, with the
 * other person's face, the last line said and by whom, when, and the unread
 * count; a filter box; and an Unreads switch. Picking one opens it beside
 * the pane. Previews come from each conversation's newest page, read once
 * and refreshed only when the activity poll says it moved.
 */
import { el, listKeyNav, clearOnEscape, composing } from './dom.js';
import { icon } from './icons.js';
import { paneBack } from './views.js';
import { avatar, groupAvatar, statusChip, presenceWords } from './avatar.js';
import { store } from '../lib/store.js';
import { navigate, parseHash, buildHash } from '../lib/router.js';
import { previewWords } from './applink.js';
import { relativeShort } from '../lib/time.js';
import { hasDraft, draftKey } from '../lib/drafts.js';
import { newDmDialog } from './dialogs.js';
import { openRowMenu } from './notifymenu.js';
import { pointAnchor } from './menu.js';
import { attachLongPress } from './longpress.js';
import { normalize } from '../shared/search.js';
import { parentOfThread } from '../shared/blocks.js';

const UNREADS_KEY = 'teamchat:dms-unreads';

export function createDmsPane() {
  const root = el('div.pane', { role: 'region', 'aria-label': 'Direct messages' });
  let unreadsOnly = false;
  try { unreadsOnly = localStorage.getItem(UNREADS_KEY) === '1'; } catch { /* ignore */ }
  // The switch sits in the filter's row: in the head beside
  // the compose button it left the title some fifty pixels at the sidebar's
  // narrowest, and "Direct messages" read "Direct me…". Its word goes where
  // the pane is narrower still (see .pane-filter); the label stays for it.
  const toggle = el('button.switch.switch-sm', {
    type: 'button', role: 'switch', 'aria-checked': String(unreadsOnly), 'aria-label': 'Show unreads only', title: 'Show unreads only',
    onclick: () => {
      unreadsOnly = !unreadsOnly;
      toggle.setAttribute('aria-checked', String(unreadsOnly));
      try { localStorage.setItem(UNREADS_KEY, unreadsOnly ? '1' : '0'); } catch { /* ignore */ }
      render();
    },
  }, el('span.switch-text', {}, el('span', {}, 'Unreads')), el('span.switch-track', { 'aria-hidden': 'true' }));
  const compose = el('button.icon-btn.side-head-btn', { type: 'button', html: icon('pencil', 18, 2), 'aria-label': 'New message', title: 'New message', onclick: () => newDmDialog() });
  const head = el('div.pane-head', {}, paneBack(), el('h2.pane-title', {}, 'Direct messages'), compose);
  const filter = el('input.side-filter-input', { type: 'text', placeholder: 'Find a DM…', 'aria-label': 'Find a direct message', autocomplete: 'off', spellcheck: false });
  const list = el('div.pane-list', { role: 'group', 'aria-label': 'Direct messages' });
  // Said aloud as well as shown: that nothing is listed, and why (the words
  // in the box, the Unreads switch, or no conversations yet; see render).
  // The box keeps the keyboard while the list empties under the words
  // typed, so a screen reader heard nothing of it; and nothing is said
  // while rows still match, rather than a count at every letter. One region
  // in place from the start, as the search view has, set only when the
  // words change, so a poll's redraw repeats nothing.
  const status = el('div.visually-hidden', { role: 'status', 'aria-live': 'polite' });
  const say = (text) => { if (status.textContent !== text) status.textContent = text; };
  root.append(head, el('div.side-filter.pane-filter', {}, el('span.side-filter-icon', { html: icon('search', 15, 2) }), filter, toggle), list, status);
  // A keystroke chooses among the rows already built for the store as it
  // stands (see rowCache); a redraw for any other reason starts over.
  filter.addEventListener('input', () => render({ reuse: true }));
  clearOnEscape(filter);
  // The sidebar filter's keys, here too: the bare down arrow goes into the
  // list (held with Alt it is the next-conversation shortcut, and passes),
  // and Enter opens the first match. Nothing typed, or nothing matching,
  // opens nothing: this box finds a direct message, and does not fall back
  // to searching messages as the sidebar's does, whose fallback is the whole
  // workspace's. Enter and the arrows during an IME composition are the
  // composition's (see composing). Rows a layout does not show cannot take
  // the keyboard, so only the rows drawn count.
  const rendered = (n) => n.getClientRects().length > 0;
  const firstRow = () => [...list.querySelectorAll('.pane-row')].find(rendered) || null;
  filter.addEventListener('keydown', (e) => {
    if (composing(e)) return;
    if (e.key === 'ArrowDown' && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      firstRow()?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!filter.value.trim()) return;
      firstRow()?.click();
    }
  });
  let destroyed = false;
  let scheduled = false;

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; render(); });
  }

  /**
   * The newest message of a conversation, from what is loaded; asks for it
   * once when nothing is, and asks for newer ones only when the activity
   * feed says the window is behind. The comparison is against the highest
   * sequence actually loaded, not the message chosen for the preview: when
   * the newest one is deleted or a system line, the two differ, and a
   * comparison against the preview would fetch again after every fetch.
   */
  const asked = new Set();
  const fetchedTo = new Map();
  /**
   * Whether the conversation's worker can be read now, as the store judges
   * it (see store._hostUp): this workspace's own, or a host whose link is
   * up. A direct message on the host of a shared channel is not read while
   * that host is out of reach: each such read waited out the request's
   * whole timeout, once per conversation on the pane's first show, and left
   * the row reading "…" the while. The row is drawn from what the store
   * holds, and the read is made on the first redraw after the host answers.
   */
  const hostUp = (convId) => (typeof store._hostUp === 'function' ? store._hostUp(convId) : !store.hostOf(convId).link || store.hostOf(convId).link.loaded);
  /**
   * Whether a host that cannot be read now is being read for the first
   * time, no read of it having failed yet (its link's first load out, as
   * every host's is for a moment after the workspace opens), as against
   * one whose last read failed: the first is a wait, and the row draws it
   * as the wait ("…"), as the conversation's own column says "Connecting
   * to" then; the second is said as the host being out of reach.
   */
  const hostLoading = (convId) => {
    const { link } = store.hostOf(convId);
    return !!link && !!link.loading && !link.error;
  };
  function lastMessage(convId) {
    const c = store.conv(convId);
    const newest = [...c.messages].reverse();
    const m = newest.find((x) => x.seq != null && x.kind === 'msg' && !x.deleted) || newest.find((x) => x.seq != null) || null;
    const known = c.messages.reduce((n, x) => (x.seq > n ? x.seq : n), c.seq || 0);
    const latest = store.latestSeq(convId);
    if (!hostUp(convId)) return m;
    if (!c.loaded && !c.loading && !asked.has(convId)) {
      asked.add(convId);
      store.loadConversation(convId).then(schedule).catch(() => {});
    } else if (c.loaded && !c.loading && latest > known && !c.hasNewer && fetchedTo.get(convId) !== latest) {
      fetchedTo.set(convId, latest);
      store.fetchNewer(convId).then(schedule).catch(() => {});
    } else if (c.loaded && !c.loading && c.hasNewer && convId !== store.openConv && fetchedTo.get(convId) !== latest) {
      // Left at a permalink, the window stops short of the end and nothing
      // brings it forward (the poll only refreshes what it holds): its
      // newest line would stay the old window's while the badge grew.
      fetchedTo.set(convId, latest);
      store.jumpToLatest(convId).then(schedule).catch(() => {});
    }
    return m;
  }

  function previewOf(dm) {
    const m = lastMessage(dm.id);
    if (!m) return { text: '', mine: false };
    // A reminder line carries the reader's uuid to draw as theirs, but they
    // did not write it: no "You:". Nor did the subject of a line the system
    // wrote (a huddle's end carries its starter, a share line the owner):
    // "Dan: Huddle ended after 5 min" read as Dan saying it, and one with
    // no subject at all was said by a "Former member".
    const who = m.kind === 'rem' || m.kind === 'sys' ? '' : m.user === store.uuid ? 'You' : dm.others.length > 1 ? store.author(m).name.split(' ')[0] : '';
    let body = m.deleted ? 'Message deleted' : previewWords(m.text, 90) || (m.attachments?.length ? `${m.attachments.length} file${m.attachments.length === 1 ? '' : 's'}` : '');
    // A system line's words as written (the preview's cleaner is for a
    // message's markup). Not a deleted one's (an admin may delete a system
    // line): its words are blanked with the deletion, and the row read "No
    // messages yet" over a conversation with a line in it.
    if (m.kind === 'sys' && !m.deleted) body = m.text;
    return { text: who ? `${who}: ${body}` : body };
  }

  /**
   * The rows as built for the store as it stands, by conversation, kept
   * across keystrokes in the box (see render): with hundreds of direct
   * messages every letter typed rebuilt every matching row, its face, status
   * chip and last line among them; a keystroke now only chooses among rows
   * already built, and builds one the first time it matches. A redraw for
   * any other reason (a poll, a message, a route, the Unreads switch) starts
   * over, since a row shows what the store held when it was built.
   */
  let rowCache = new Map(); // dm.id -> row
  function render({ reuse = false } = {}) {
    if (destroyed) return;
    if (!reuse) rowCache = new Map();
    // Names and what was typed are compared as search reads them, lowercase
    // with accents and other marks stripped: "muller" finds Müller. Names
    // are kept without their sigil, so one typed the way the app writes them
    // ("@dan") must still find them, as it does in the sidebar's filter and
    // the Directory's box: the sigil comes off what was typed.
    const q = normalize(filter.value.trim().replace(/^[#@]+/, ''));
    const cur = parseHash(location.hash).conv;
    const rows = [];
    for (const dm of store.dms()) {
      const title = store.dmTitle(dm);
      const unread = store.isMuted(dm.id) ? 0 : store.unreadCount(dm.id);
      if (unreadsOnly && !unread && cur !== dm.id) continue;
      if (q && !normalize(title).includes(q) && !dm.others.some((u) => normalize(store.member(u).username).includes(q))) continue;
      const kept = rowCache.get(dm.id);
      if (kept) {
        rows.push(kept);
        continue;
      }
      const others = dm.others.map((u) => store.member(u));
      const av = others.length === 1 ? avatar(others[0], { size: 'md', state: store.presenceOf(others[0].uuid) })
        : others.length ? groupAvatar(others, { size: 'md' }) : avatar(store.member(store.uuid), { size: 'md' });
      const preview = previewOf(dm);
      const m = lastMessage(dm.id);
      const draft = cur !== dm.id && hasDraft(draftKey(store.wsId, dm.id));
      // How the one person is (their dot, their status chip), said after
      // their name, as the sidebar's row says it: the label names the whole
      // row to a screen reader, so the chip's words and the dot went unheard.
      const how = others.length === 1 ? presenceWords(others[0].uuid) : '';
      const row = el('a.pane-row', {
        // Spelled as navigate() spells the route (the reference encoded), so the two compare equal (see the sidebar's rows).
        href: buildHash({ ws: store.wsId, conv: dm.id, view: 'dms' }),
        className: `pane-row${unread ? ' unread' : ''}${store.isMuted(dm.id) ? ' muted' : ''}`,
        'aria-current': cur === dm.id ? 'page' : null,
        // The pen is decoration: the row's label says there is an unsent message, as the sidebar's rows do.
        'aria-label': `${title}${how ? `, ${how}` : ''}${draft ? ', unsent message' : ''}${unread ? `, ${unread} unread` : ''}`,
      },
      av,
      el('div.pane-row-body', {},
        el('div.pane-row-head', {},
          el('strong.name-line', {}, el('span.name-text', { dir: 'auto' }, title), others.length === 1 && statusChip(others[0].uuid, { compact: true }),
            // Someone from another workspace wears its name, as in the sidebar's row and the conversation's header.
            others.length === 1 && others[0].role === 'external' && el('span.pill.pill-org.pill-inline', { title: `From ${others[0].org?.name || 'another workspace'}` }, others[0].org?.name || 'Another workspace')),
          m && el('time', { datetime: new Date(m.ts).toISOString() }, relativeShort(m.ts))),
        el('div.pane-row-text', {},
          draft ? el('span.pane-draft', { html: icon('pencil', 12, 2.2), title: 'Unsent message', 'aria-hidden': 'true' }) : null,
          // Nothing held for a conversation on a host out of reach: said as
          // that, not as a conversation with no messages; and on a host
          // still being read for the first time, as the wait (see hostLoading).
          el('span', {}, preview.text || (m === null && (store.conv(dm.id).loading || hostLoading(dm.id)) ? '…' : m === null && store.conv(dm.id).error ? 'Could not load'
            : m === null && !hostUp(dm.id) ? `Could not reach ${others[0]?.org?.name || 'their workspace'}` : 'No messages yet')),
          unread ? el('span.badge', {}, String(unread)) : null)));
      const openAt = (e) => openRowMenu(e.clientX || e.clientY ? pointAnchor(e.clientX, e.clientY) : row, dm.id, { onChange: schedule, align: 'start' });
      // A keyboard has no hover kebab here and, on a Mac, no key that fires
      // contextmenu: Shift+F10 and the Menu key open the row's menu from the
      // row, as the sidebar's rows do (on Windows the same press fires
      // contextmenu as well, which must not open it twice).
      let viaKey = 0;
      row.addEventListener('keydown', (e) => {
        if (!((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu')) return;
        e.preventDefault();
        viaKey = Date.now();
        openAt(e);
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (Date.now() - viaKey < 500) return;
        openAt(e);
      });
      attachLongPress(row, openAt, { ignore: 'button' });
      rowCache.set(dm.id, row);
      rows.push(row);
    }
    const scrollTop = list.scrollTop;
    // The row under the keyboard is found again by its link after the redraw
    // (a poll redraws often); one gone from the list (read on another device
    // with Unreads on, its host's link dropped, the conversation removed)
    // hands the keyboard to the row that took its place, or the last, or the
    // filter box, rather than to the page.
    const active = document.activeElement;
    const before = list.contains(active) && active.matches('.pane-row') ? { href: active.getAttribute('href'), index: [...list.querySelectorAll('.pane-row')].indexOf(active) } : null;
    list.replaceChildren(...rows);
    list.scrollTop = scrollTop;
    if (before) (rows.find((r) => r.getAttribute('href') === before.href) || rows[Math.min(before.index, rows.length - 1)] || filter).focus({ preventScroll: true });
    if (!rows.length) {
      // Both the switch and the box narrow the list: said together, or the
      // reader with unread messages from others, none of them called what
      // was typed, read "Nothing unread." and took the switch for the reason.
      const who = filter.value.trim();
      const nothing = unreadsOnly && q ? `Nothing unread from anyone called “${who}”`
        : unreadsOnly ? 'Nothing unread.' : q ? `Nobody called “${who}”` : 'No direct messages yet.';
      list.append(el('p.side-empty', {}, nothing));
      say(nothing);
    } else say('');
  }

  listKeyNav(list, '.pane-row');
  // And back the same way: the bare up arrow pressed on the first row returns
  // to the box. After the list's own keys (listKeyNav, which stops at the
  // first row): run before them, the box took the keyboard and the list's
  // handler, finding nothing of its own focused, put it straight back on the
  // row. Judged by the row the key was pressed on, not by where the keyboard
  // is by now: from the second row the list has just moved it to the first.
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' || e.altKey || e.metaKey || e.ctrlKey || composing(e)) return;
    if (e.target !== firstRow()) return;
    e.preventDefault();
    filter.focus();
  });
  // A message landing in a channel, or a reply in one of its threads, moves
  // nothing here (the rows show the direct messages' own last lines; their
  // counts and dots ride on the activity poll): only a direct message's own
  // news redraws the list, and that of a conversation not known yet, since
  // a new direct message's first message arrives before the document that
  // lists it (see store.convKind). Every message posted anywhere in the
  // workspace used to rebuild every row, its face, chip and last line among
  // them, hundreds of rows in a busy channel several times a minute.
  const onMessages = (d) => {
    const base = d?.conv ? parentOfThread(d.conv)?.conv || d.conv : null;
    if (base && store.channel(base)) return;
    schedule();
  };
  const offs = [store.on('workspace', schedule), store.on('activity', schedule), store.on('messages', onMessages), store.on('profile', schedule)];
  window.addEventListener('hashchange', schedule);
  window.addEventListener('teamchat:drafts', schedule);
  render();
  return {
    el: root,
    destroy() {
      destroyed = true;
      offs.forEach((f) => f());
      window.removeEventListener('hashchange', schedule);
      window.removeEventListener('teamchat:drafts', schedule);
    },
  };
}
