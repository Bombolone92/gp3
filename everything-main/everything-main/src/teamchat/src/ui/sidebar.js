/**
 * The workspace sidebar: switcher, channels, direct messages, and the
 * current user's card. Re-renders on workspace and activity changes.
 */
import { el, listKeyNav, composing } from './dom.js';
import { icon, channelIcon, isSharedChannel } from './icons.js';
import { avatar, groupAvatar, statusChip, workspaceMark, presenceWords } from './avatar.js';
import { openMenu, pointAnchor } from './menu.js';
import { openRowMenu, openPauseMenu } from './notifymenu.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { navigate, parseHash, buildHash } from '../lib/router.js';
import { hasDraft, draftKey, draftCount } from '../lib/drafts.js';
import { createChannelDialog, browseChannelsDialog, newDmDialog, settingsDialog, showMemberCard, sectionNameDialog, addSharedChannelDialog, inviteDialog } from './dialogs.js';
import { confirmDialog } from './modal.js';
import { attachLongPress } from './longpress.js';
import { workspaceMenuItems } from './rail.js';
import { normalize } from '../shared/search.js';

const COLLAPSE_KEY = 'teamchat:collapsed';
const PREFS_KEY = 'teamchat:sidebar';

/** How the lists are shown: sorted by name or by recent activity, with muted rows shown or hidden. */
function sidebarPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {};
    return { sort: p.sort === 'recent' ? 'recent' : 'alpha', showMuted: p.showMuted !== false };
  } catch {
    return { sort: 'alpha', showMuted: true };
  }
}
function setSidebarPrefs(patch) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...sidebarPrefs(), ...patch }));
  } catch {
    /* ignore */
  }
}

function collapsed() {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}');
  } catch {
    return {};
  }
}

function setCollapsed(section, v) {
  const c = collapsed();
  c[section] = v;
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

/**
 * A direct message with someone from another workspace: one that lives on
 * the host of a shared channel (met there), or, from the host's side, one
 * with a person who came here through a shared channel (or did, and left).
 * Both sit under External connections.
 */
function externalDm(dm) {
  return !!dm.host || dm.others.some((u) => store.member(u).role === 'external');
}

export function renderSidebar(container) {
  const header = el('div');
  const scroll = el('div.sidebar-scroll');
  const footer = el('div.side-footer');
  // Pills that point at unread rows scrolled out of view, one per edge.
  const pillUp = el('button.side-unread-pill.up', { type: 'button', hidden: true });
  const pillDown = el('button.side-unread-pill.down', { type: 'button', hidden: true });
  const scrollWrap = el('div.sidebar-scroll-wrap', {}, scroll, pillUp, pillDown);
  // Said aloud as well as shown: that the words in the filter box match
  // nothing (see renderFiltered). The box keeps the keyboard while the list
  // empties under the words typed, so a screen reader heard nothing of it;
  // and nothing is said while rows still match, rather than a count at
  // every letter. One region in place from the start, as the search view
  // has, set only when the words change, so a poll's redraw repeats nothing.
  const filterStatus = el('div.visually-hidden', { role: 'status', 'aria-live': 'polite' });
  const say = (text) => { if (filterStatus.textContent !== text) filterStatus.textContent = text; };
  container.replaceChildren(header, scrollWrap, footer, filterStatus);
  let scheduled = false;

  /**
   * Which unread rows are above or below the visible part of the list, and
   * whether any of them carries a mention; the pills say "Unread mentions"
   * when one does, "Unreads" otherwise, and scroll to the nearest row.
   */
  function updateUnreadPills() {
    const rows = [...scroll.querySelectorAll('.side-item.unread, .side-item:has(.badge:not(.badge-soft))')];
    // Rows sit inside positioned wrappers, so offsets are measured against the box itself.
    const box = scroll.getBoundingClientRect();
    const above = [];
    const below = [];
    for (const r of rows) {
      const rect = r.getBoundingClientRect();
      // A row the layout does not show (the rail's duplicates on a wide
      // screen) has no box at all, and would count as scrolled out above.
      if (!rect.width && !rect.height) continue;
      if (rect.bottom < box.top + 4) above.push(r);
      else if (rect.top > box.bottom - 4) below.push(r);
    }
    const fill = (pill, list, dir) => {
      pill.hidden = !list.length;
      if (!list.length) return;
      const mention = list.some((r) => r.querySelector('.badge:not(.badge-soft)'));
      pill.replaceChildren(el('span', { html: icon(dir === 'up' ? 'arrowUp' : 'arrowDown', 14, 2.4) }), el('span', {}, mention ? 'Unread mentions' : 'Unreads'));
      pill.setAttribute('aria-label', `${mention ? 'Unread mentions' : 'Unread conversations'} ${dir === 'up' ? 'above' : 'below'}. Scroll to them`);
      const target = dir === 'up' ? list[list.length - 1] : list[0];
      // A smooth scroll asked for by name is smooth whatever the stylesheet
      // says (its reduced-motion rule reaches only scrolls left to "auto").
      pill.onclick = () => target.scrollIntoView({ block: dir === 'up' ? 'start' : 'end', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    fill(pillUp, above, 'up');
    fill(pillDown, below, 'down');
  }
  scroll.addEventListener('scroll', updateUnreadPills, { passive: true });
  new ResizeObserver(updateUnreadPills).observe(scroll);

  /* ---- the quick filter ------------------------------------------------- */

  // Built once so what was typed survives the re-render every poll causes.
  const filterInput = el('input.side-filter-input', {
    type: 'text', placeholder: 'Find a conversation\u2026', 'aria-label': 'Find a conversation',
    autocomplete: 'off', spellcheck: false, enterkeyhint: 'go',
  });
  const filterClear = el('button.side-filter-clear', {
    type: 'button', html: icon('x', 14, 2.4), 'aria-label': 'Clear', hidden: true,
    onclick: () => { filterInput.value = ''; filterInput.dispatchEvent(new Event('input')); filterInput.focus(); },
  });
  const filterBox = el('div.side-filter', {}, el('span.side-filter-icon', { html: icon('search', 15, 2) }), filterInput, filterClear);
  const filterQuery = () => filterInput.value.trim().toLowerCase();
  filterInput.addEventListener('input', () => {
    filterClear.hidden = !filterInput.value;
    // A keystroke chooses among the rows already built for the store as it
    // stands (see filterCandidates); a redraw for any other reason starts over.
    keepFilterCands = true;
    try {
      render();
    } finally {
      keepFilterCands = false;
    }
  });
  filterInput.addEventListener('keydown', (e) => {
    // Enter and Escape during an IME composition confirm or cancel the
    // composition; they are not a request to open a match or clear the box.
    if (composing(e)) return;
    // A modified Escape is somebody else's key (Shift+Esc marks everything read): it passes.
    if (e.key === 'Escape' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && filterInput.value) {
      e.preventDefault();
      e.stopPropagation();
      filterInput.value = '';
      filterInput.dispatchEvent(new Event('input'));
    } else if (e.key === 'ArrowDown' && !e.altKey && !e.metaKey && !e.ctrlKey) {
      // The bare arrow goes down into the list; one held with Alt is the
      // next-conversation shortcut, and passes.
      e.preventDefault();
      scroll.querySelector('.side-item')?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Nothing typed: nothing to open (the list is the full one, and its first row is Threads).
      if (!filterQuery()) return;
      // The first match, or a message search when nothing matches.
      const first = scroll.querySelector('.side-item');
      if (first) first.click();
      else if (filterQuery()) navigate({ ws: store.wsId, query: filterInput.value.trim() });
    }
  });

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      render();
    });
  }

  function currentConv() {
    return parseHash(location.hash).conv;
  }

  /**
   * What identifies a sidebar control across a re-render: its link, the
   * section it toggles, its label, or failing those its text.
   */
  function keyOf(node) {
    return node.getAttribute('href') || node.getAttribute('aria-controls')
      || node.getAttribute('aria-label') || node.textContent.trim();
  }

  function render() {
    // A row is being dragged: the redraw would replace it under the pointer,
    // and Chrome fires no dragend for a row that has left the page, so the
    // grabbing cursor and the drag's marks stayed on the list after the drop
    // (a poll or someone typing lands within the second or two a drag takes).
    // The redraw waits for the drag to end.
    if (dragging) {
      renderAfterDrag = true;
      return;
    }
    if (!keepFilterCands) filterCands = null;
    const ws = store.ws;
    // The lists are rebuilt on every activity poll, which throws away the
    // node the user is on: keep the keyboard where it was, and the list
    // where it was scrolled to, so arrowing through channels survives
    // someone else typing.
    const active = container.contains(document.activeElement) ? document.activeElement : null;
    const activeKey = active ? keyOf(active) : null;
    // Its place among the rows the layout shows, for when the row itself is
    // gone (see below); rows a collapsed section or the wide layout hides
    // (the rail's duplicates) are not places the keyboard can be.
    const rendered = (n) => n.getClientRects().length > 0;
    // The row itself, or the row whose kebab holds the keyboard (its menu
    // just closed on Leave channel, or on Mark as read for a muted row the
    // list hides once read): the row going takes the kebab with it, and the
    // keyboard fell from the kebab to the page, where from the row it went
    // to the row that took its place (below).
    const activeRow = active?.classList.contains('side-item') ? active : active?.closest('.side-row')?.querySelector('.side-item') || null;
    const rowIndex = activeRow ? [...container.querySelectorAll('.side-item')].filter(rendered).indexOf(activeRow) : -1;
    // A control in a section's head (its heading, its Options or Add
    // button): the section it belongs to, by the id its list carries (which
    // a rename keeps, where the Options button's label does not), the
    // control's place in the head, and the section's place among the
    // sections, for when the section itself has gone (see below).
    const head = active?.closest('.side-head') || null;
    const headKey = head?.querySelector('.side-title')?.getAttribute('aria-controls') || null;
    const headIndex = head ? [...head.children].indexOf(active) : -1;
    const sectionIndex = head ? [...container.querySelectorAll('.side-section')].indexOf(head.closest('.side-section')) : -1;
    // A control of the footer (the reader's own card, the bell, the gear; on
    // a phone, where the footer shows): its place among the footer's
    // controls, for when its name has changed with the press. The bell's
    // name says whether notifications are paused, and the card's too, so
    // after "For 30 minutes" picked from the bell's menu (which hands the
    // keyboard back to the bell) the redraw that follows the pause found no
    // control of that name, and the keyboard fell to the page.
    const footIndex = active && footer.contains(active) ? [...footer.querySelectorAll('button')].indexOf(active) : -1;
    const scrollTop = scroll.scrollTop;
    renderHeader(ws);
    renderLists(ws);
    renderFooter();
    // A row's menu (or its "Move to…" list) standing open from its kebab: the
    // kebab drawn in its place keeps the menu's mark, which holds it drawn
    // under the menu (see rowWithMenu and menuConv).
    if (menuConv !== null) markKebab(menuConv, true);
    scroll.scrollTop = scrollTop;
    updateUnreadPills();
    if (active && !active.isConnected) {
      // The same control, when the layout shows it: a row of a folded
      // section that has stopped asking for the eye (read, and no longer
      // the open one; see fold) is drawn again but hidden, and a browser
      // will not focus what it does not show, so the keyboard fell to the
      // page from the row Alt+Down or a click had just left.
      const again = [...container.querySelectorAll('a[href], button')].find((n) => keyOf(n) === activeKey);
      if (again && rendered(again)) again.focus({ preventScroll: true });
      else if (rowIndex >= 0) {
        // The row is gone (a channel left, a conversation removed, a muted
        // row hidden once it was read): the keyboard goes to the row that
        // took its place, or the last, or the filter box, not to the page.
        const rows = [...container.querySelectorAll('.side-item')].filter(rendered);
        (rows[Math.min(rowIndex, rows.length - 1)] || filterInput).focus({ preventScroll: true });
      } else if (headKey) {
        // A section's Options button after the section was renamed from its
        // menu (the button's label carries the name, so it is not found by
        // it above): the same button of the same section. The section
        // deleted from that menu: the heading of the section that took its
        // place, or the last. Either way not the page, where the keyboard
        // fell after Rename or Delete pressed from the keyboard.
        const again = container.querySelector(`.side-title[aria-controls="${headKey}"]`)?.closest('.side-head') || null;
        const sections = [...container.querySelectorAll('.side-section')];
        const target = again ? (again.children[headIndex] || again.querySelector('.side-title'))
          : sections[Math.min(sectionIndex, sections.length - 1)]?.querySelector('.side-title');
        if (target && rendered(target)) target.focus({ preventScroll: true });
      } else if (footIndex >= 0) {
        // The same control of the footer by its place (see footIndex).
        const target = [...footer.querySelectorAll('button')][footIndex];
        if (target && rendered(target)) target.focus({ preventScroll: true });
      }
    }
  }

  /* ---- the head row -------------------------------------------------- */

  // Built once and updated in place: rebuilding it on every poll would pull
  // the filter box out of the document mid-keystroke and drop focus.
  const wsName = el('span.ws-name', { dir: 'auto' });
  const wsMark = el('span.ws-mark', { 'aria-hidden': 'true' });
  let markKey = null; // refilled only when the icon or the letter changes, not on every poll
  const wsBtn = el('button.ws-switch', {
    type: 'button', 'aria-haspopup': 'menu',
    onclick: () => openWorkspaceMenu(wsBtn),
  }, wsMark, wsName, el('span', { html: icon('chevDown', 16) }));
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const searchBtn = el('button.icon-btn.side-head-btn', {
    type: 'button', html: icon('search', 18, 2), 'aria-label': 'Search messages', title: `Search messages (${mac ? '\u2318K' : 'Ctrl+K'})`,
    onclick: () => navigate({ ws: store.wsId, query: '' }),
  });
  const composeBtn = el('button.icon-btn.side-head-btn', {
    type: 'button', html: icon('pencil', 18, 2), 'aria-label': 'New message', title: 'New message',
    onclick: () => newDmDialog(),
  });
  // The gear beside the name: how the sidebar sorts and what it hides.
  const prefsBtn = el('button.icon-btn.side-head-btn', {
    type: 'button', html: icon('gear', 18, 2), 'aria-label': 'Manage my sidebar', title: 'Manage my sidebar', 'aria-haspopup': 'menu',
    onclick: (e) => {
      const p = sidebarPrefs();
      const set = (patch) => { setSidebarPrefs(patch); render(); };
      openMenu(e.currentTarget, [
        { header: 'Sort' },
        { label: 'Alphabetically', icon: 'type', checked: p.sort === 'alpha', onSelect: () => set({ sort: 'alpha' }) },
        { label: 'By recent activity', icon: 'clock', checked: p.sort === 'recent', onSelect: () => set({ sort: 'recent' }) },
        'sep',
        { label: p.showMuted ? 'Hide muted conversations' : 'Show muted conversations', icon: p.showMuted ? 'bellOff' : 'bell', sub: p.showMuted ? 'Muted rows leave the lists until they mention you' : 'Muted rows are hidden now', onSelect: () => set({ showMuted: !p.showMuted }) },
        'sep',
        { label: 'Create a new section', icon: 'folderPlus', sub: 'Group channels and people your own way', onSelect: () => createSection() },
        'sep',
        { label: 'Mark everything read', icon: 'checkCheck', key: '⇧Esc', onSelect: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', shiftKey: true, bubbles: true, cancelable: true })) },
      ], { align: 'end', label: 'Manage my sidebar' });
    },
  });
  const headRow = el('div.side-head-row', {}, wsBtn, searchBtn, prefsBtn, composeBtn);
  searchBtn.classList.add('rail-dup'); // the top bar has search on desktop
  const headSkeleton = el('div.side-head-row', {}, el('div.skeleton', { style: { width: '60%', height: '16px', margin: '0 8px' } }));

  function renderHeader(ws) {
    if (!ws) {
      if (header.firstChild !== headSkeleton) header.replaceChildren(headSkeleton);
      return;
    }
    wsName.textContent = ws.name;
    const key = `${store.wsId}|${ws.icon || ''}|${ws.name.trim()[0] || ''}`;
    if (key !== markKey) {
      markKey = key;
      workspaceMark(wsMark, ws);
    }
    wsBtn.setAttribute('aria-label', `${ws.name}. Workspace menu`);
    const searching = parseHash(location.hash).name === 'search';
    searchBtn.classList.toggle('active', searching);
    if (searching) searchBtn.setAttribute('aria-current', 'page');
    else searchBtn.removeAttribute('aria-current');
    if (header.firstChild !== headRow) header.replaceChildren(headRow, filterBox);
  }

  /**
   * The sidebar while a filter is typed: one flat list of what matches, the
   * way a "Find a conversation" box narrows the lists. Channels you are
   * in, then public channels you could join, then people (an existing
   * conversation, or a new one), and finally a way to search messages.
   */
  /**
   * What the filter can match, for the store as it stands: each channel the
   * reader is in, each public channel they could join, each direct message,
   * with what the filter looks at in it, and its row, built the first time
   * it matches and kept for the next keystroke. With hundreds of direct
   * messages every letter typed rebuilt every matching row, its face and
   * status chip among them; a keystroke now only chooses among rows already
   * built. A redraw for any other reason (a poll, a route, a draft) starts
   * over, since a row shows what the store held when it was built (see
   * render and the box's input handler). The rows say what the full list's
   * rows say (private, archived, muted, unread, the mentions): a match is
   * only the same row found by its name.
   */
  let filterCands = null;
  let keepFilterCands = false;
  function filterCandidates() {
    if (filterCands) return filterCands;
    const cur = currentConv();
    const cands = [];
    for (const ch of store.joinedChannels()) cands.push({ hays: [ch.name], node: null, build: () => filteredChannelRow(ch, cur) });
    if (!store.isGuest()) {
      for (const ch of store.browsableChannels()) cands.push({ hays: [ch.name], node: null, build: () => filteredJoinRow(ch) });
    }
    for (const dm of store.dms()) {
      cands.push({ hays: [store.dmTitle(dm), ...dm.others.map((u) => store.member(u).username)], node: null, build: () => filteredDmRow(dm, cur) });
    }
    filterCands = cands;
    return cands;
  }
  function filteredChannelRow(ch, cur) {
    const muted = store.isMuted(ch.id);
    const unread = store.unreadCount(ch.id) && !muted;
    const mentions = store.mentionCount(ch.id);
    return el('a.side-item', {
      href: buildHash({ ws: store.wsId, conv: ch.id }),
      className: `side-item${unread ? ' unread' : ''}${ch.archived ? ' archived' : ''}${muted ? ' muted' : ''}`,
      'aria-current': cur === ch.id ? 'page' : null,
      'aria-label': `${ch.name}${ch.private ? ', private' : ''}${ch.archived ? ', archived' : ''}${muted ? ', muted' : ''}${mentions ? `, ${mentions} mention${mentions === 1 ? '' : 's'}` : unread ? ', unread' : ''}`,
    }, el('span.side-icon', { html: icon(channelIcon(ch), 16, 2) }), el('span.side-label', { dir: 'auto' }, ch.name),
    // The count the label announces, drawn as the full list draws it.
    mentions ? el(`span.badge${muted ? '.badge-soft' : ''}`, {}, String(mentions)) : null);
  }
  function filteredJoinRow(ch) {
    return el('a.side-item.side-item-join', {
      href: buildHash({ ws: store.wsId, conv: ch.id }),
    }, el('span.side-icon', { html: icon(channelIcon(ch), 16, 2) }), el('span.side-label', { dir: 'auto' }, ch.name), el('span.side-sub', {}, 'Join'));
  }
  function filteredDmRow(dm, cur) {
    const title = store.dmTitle(dm);
    const others = dm.others.map((u) => store.member(u));
    const av = others.length === 1 ? avatar(others[0], { size: 'xs', state: store.presenceOf(others[0].uuid) })
      : others.length === 0 ? avatar(store.member(store.uuid), { size: 'xs' }) : groupAvatar(others, { size: 'xs' });
    const muted = store.isMuted(dm.id);
    const unread = store.unreadCount(dm.id);
    // How the one person is (their dot, their status), said after their
    // name, as the full list's row says it (see dmRow).
    const how = others.length === 1 ? presenceWords(others[0].uuid) : '';
    return el('a.side-item', {
      href: buildHash({ ws: store.wsId, conv: dm.id }),
      className: `side-item${unread && !muted ? ' unread' : ''}${muted ? ' muted' : ''}`,
      'aria-current': cur === dm.id ? 'page' : null,
      'aria-label': `${title}${how ? `, ${how}` : ''}${muted ? ', muted' : ''}${unread ? `, ${unread} unread` : ''}`,
    }, av, el('span.side-label', { dir: 'auto' }, title),
    unread ? el(`span.badge${muted ? '.badge-soft' : ''}`, {}, String(unread)) : null);
  }

  function renderFiltered(raw) {
    // Names are stored without their sigil; typing one the way the app itself
    // writes them ("#general", "@ana") must still find them. Both sides are
    // read as search reads them, lowercase with accents and other marks
    // stripped: "muller" finds Müller, as the mention list and the search
    // view's People tab already do.
    const q = normalize(raw.replace(/^[#@]+/, ''));
    // A group, not a list: a listitem role on a link or button would replace its own role, and a screen reader would no longer say it can be activated.
    const list = el('div.side-list.side-results', { role: 'group', 'aria-label': 'Matches' });
    const hit = (name) => normalize(String(name || '')).includes(q);
    let n = 0;
    // Channels the reader is in, then public channels they could join, then
    // direct messages, in the order the candidates were listed (see filterCandidates).
    for (const c of filterCandidates()) {
      if (!c.hays.some(hit)) continue;
      c.node ||= c.build();
      list.append(c.node);
      n++;
    }
    // People without a conversation yet.
    const inDm = new Set(store.dms().filter((d) => d.others.length === 1).map((d) => d.others[0]));
    const people = Object.entries(store.ws.members || {})
      .filter(([uuid, m]) => uuid !== store.uuid && !inDm.has(uuid) && (hit(m.name) || hit(m.username)))
      .slice(0, 6);
    for (const [uuid, m] of people) {
      list.append(el('button.side-item', {
        type: 'button',
        // The name and username the row shows, with how the person is (their
        // dot) between them: the dot itself says nothing to a screen reader.
        'aria-label': [m.name, presenceWords(uuid), `@${m.username}`].filter(Boolean).join(', '),
        onclick: async () => {
          // The box is cleared once the conversation opens, and the list
          // redrawn with it, as picking any match leaves the search behind.
          // Cleared at the press, a refusal (no network, someone who has
          // left) left an empty box over the matches for words no longer in
          // it, and the words to type again for another try.
          let opened;
          const ws = store.wsId;
          try {
            opened = await store.openDmWith(uuid);
          } catch (e) {
            toast(e.message, { icon: 'alert' });
            return;
          }
          // Switched to another workspace meanwhile: the conversation is
          // opened on its own workspace, for the next visit there, and the
          // reader is not pulled back to it.
          if (store.wsId !== ws) return;
          filterInput.value = '';
          filterInput.dispatchEvent(new Event('input'));
          navigate(opened);
        },
      }, avatar({ ...m, uuid }, { size: 'xs', state: store.presenceOf(uuid) }), el('span.side-label', { dir: 'auto' }, m.name), el('span.side-sub', {}, `@${m.username}`)));
      n++;
    }
    const frag = document.createDocumentFragment();
    const nothing = `Nothing called \u201c${filterInput.value.trim()}\u201d`;
    if (!n) frag.append(el('p.side-empty', {}, nothing));
    say(n ? '' : nothing);
    frag.append(list, el('button.side-add.side-search-row', {
      type: 'button',
      onclick: () => navigate({ ws: store.wsId, query: filterInput.value.trim() }),
    }, el('span.side-icon', { html: icon('search', 15, 2.2) }), el('span.side-label', {}, `Search messages for \u201c${filterInput.value.trim()}\u201d`)));
    scroll.replaceChildren(frag);
  }

  function openWorkspaceMenu(anchor) {
    openMenu(anchor, workspaceMenuItems(), { label: 'Workspace menu' });
  }

  // Every row is a link whose address is built the way navigate() builds a
  // route (the reference's @ encoded): the browser keeps a clicked row's
  // address as written, and navigate() to the same place compared it with
  // its own spelling, found them different, and pushed a second, identical
  // history entry for Back to step through.
  function renderLists(ws) {
    if (!ws) {
      say('');
      scroll.replaceChildren(el('div', { style: { padding: '12px 8px', display: 'grid', gap: '10px' } },
        ...Array.from({ length: 6 }, () => el('div.skeleton', { style: { height: '28px' } }))));
      return;
    }
    const q = filterQuery();
    if (q) {
      renderFiltered(q);
      return;
    }
    say('');
    const cur = currentConv();
    const c = collapsed();
    const frag = document.createDocumentFragment();

    /* Threads, Activity, Later */
    const route = parseHash(location.hash);
    const views = el('div.side-list.side-views', { role: 'group', 'aria-label': 'Views' });
    const threadN = store.threadBadge();
    const inboxN = store.inboxUnread();
    const saved = store.savedCount();
    const reminders = store.reminderCount();
    const scheduled = store.scheduledCount();
    const laterN = saved + reminders + scheduled;
    // The Later badge adds up three kinds; its label says each ("2 saved, 1
    // reminder") rather than calling reminders and scheduled messages saved.
    const laterDetail = [saved && `${saved} saved`, reminders && `${reminders} reminder${reminders === 1 ? '' : 's'}`, scheduled && `${scheduled} scheduled`].filter(Boolean).join(', ');
    const draftN = draftCount(store.wsId);
    // Activity and Later also live on the rail; on a phone, where the rail
    // is not shown, they stay here. `detail` is how the badge's number is
    // read: what it counts, not just that it is there.
    const viewRow = (key, label, ic, n, unread, detail = `${n} new`) => el('a.side-item', {
      href: buildHash({ ws: store.wsId, view: key }),
      className: `side-item${unread && n ? ' unread' : ''}${key === 'activity' || key === 'later' ? ' rail-dup' : ''}`,
      'aria-current': route.name === 'view' && route.view === key ? 'page' : null,
      'aria-label': `${label}${n ? `, ${detail}` : ''}`,
    },
    el('span.side-icon', { html: icon(ic, 16, 2) }),
    el('span.side-label', {}, label),
    n ? el(`span.badge${unread ? '' : '.badge-soft'}`, {}, String(n)) : null);
    views.append(
      viewRow('threads', 'Threads', 'messages', threadN, true, `${threadN} new repl${threadN === 1 ? 'y' : 'ies'}`),
      viewRow('activity', 'Activity', 'bell', inboxN, true),
      viewRow('later', 'Later', 'bookmark', laterN, false, laterDetail),
      viewRow('drafts', 'Drafts & sent', 'send', draftN, false, `${draftN} unsent`),
      viewRow('directory', 'Directory', 'contact', 0, false));
    frag.append(views);

    const channelRow = (ch) => {
      const muted = store.isMuted(ch.id);
      const unread = store.unreadCount(ch.id) && !muted;
      const mentions = store.mentionCount(ch.id);
      const draft = cur !== ch.id && hasDraft(draftKey(store.wsId, ch.id));
      return rowWithMenu(el('a.side-item', {
        href: buildHash({ ws: store.wsId, conv: ch.id }),
        className: `side-item${unread ? ' unread' : ''}${ch.archived ? ' archived' : ''}${muted ? ' muted' : ''}`,
        'aria-current': cur === ch.id ? 'page' : null,
        'aria-label': `${ch.name}${ch.private ? ', private' : ''}${ch.archived ? ', archived' : ''}${ch.lost ? ', no longer shared' : ''}${ch.postPolicy === 'admins' ? ', admins post' : ''}${muted ? ', muted' : ''}${store.huddleIn(ch.id) ? ', huddle in progress' : ''}${draft ? ', unsent message' : ''}${mentions ? `, ${mentions} mention${mentions === 1 ? '' : 's'}` : unread ? ', unread' : ''}`,
      },
      el('span.side-icon', { html: icon(channelIcon(ch), 16, 2), title: ch.lost ? 'No longer shared with this workspace' : ch.postPolicy === 'admins' ? 'Only admins post here' : null }),
      el('span.side-label', { dir: 'auto' }, ch.name),
      huddleMark(ch.id),
      draft ? draftMark() : null,
      muted && el('span.side-muted', { html: icon('bellOff', 13, 2), 'aria-hidden': 'true' }),
      !muted && !mentions && store.typingIn(ch.id).length ? typingMark() : null,
      mentions ? el(`span.badge${muted ? '.badge-soft' : ''}`, {}, String(mentions)) : null), ch.id);
    };
    const dmRow = (dm) => {
      const muted = store.isMuted(dm.id);
      const unread = store.unreadCount(dm.id);
      const others = dm.others.map((u) => store.member(u));
      const title = store.dmTitle(dm);
      const av = others.length === 1
        ? avatar(others[0], { size: 'xs', state: store.presenceOf(others[0].uuid) })
        : others.length === 0 ? avatar(store.member(store.uuid), { size: 'xs' }) : groupAvatar(others, { size: 'xs' });
      // Someone from another workspace wears its name beside theirs.
      const org = others.length === 1 && others[0].role === 'external' ? others[0].org?.name : null;
      const draft = cur !== dm.id && hasDraft(draftKey(store.wsId, dm.id));
      // How the one person is (their dot, their status chip), in the row's
      // name after theirs: the label names the whole row to a screen
      // reader, so the chip's own words and the dot were heard by nobody.
      const how = others.length === 1 ? presenceWords(others[0].uuid) : '';
      return rowWithMenu(el('a.side-item', {
        href: buildHash({ ws: store.wsId, conv: dm.id }),
        className: `side-item${unread && !muted ? ' unread' : ''}${muted ? ' muted' : ''}`,
        'aria-current': cur === dm.id ? 'page' : null,
        'aria-label': `${title}${org ? `, from ${org}` : ''}${how ? `, ${how}` : ''}${muted ? ', muted' : ''}${store.huddleIn(dm.id) ? ', huddle in progress' : ''}${draft ? ', unsent message' : ''}${unread ? `, ${unread} unread` : ''}`,
      },
      av,
      el('span.side-label', { dir: 'auto' }, title),
      org && el('span.side-org', { title: `From ${org}` }, org),
      others.length === 1 && statusChip(others[0].uuid, { compact: true }),
      huddleMark(dm.id),
      draft ? draftMark() : null,
      muted && el('span.side-muted', { html: icon('bellOff', 13, 2), 'aria-hidden': 'true' }),
      !muted && !unread && store.typingIn(dm.id).length ? typingMark() : null,
      unread ? el(`span.badge${muted ? '.badge-soft' : ''}`, {}, String(unread)) : null), dm.id);
    };

    /* Starred: channels and conversations the user pinned to the top, out of their own sections. */
    const stars = new Set(store.starred());
    const allDms = store.dms();
    const starredRows = store.starred()
      .map((id) => (store.channel(id) && store.isJoined(id) ? channelRow(store.channel(id)) : allDms.some((d) => d.id === id) ? dmRow(allDms.find((d) => d.id === id)) : null))
      .filter(Boolean);
    // Always there: an empty one invites dragging a row onto it.
    const starList = el('div.side-list', { role: 'list' }, ...starredRows);
    frag.append(section('Starred', 'starred', starList, [],
      starredRows.length ? el('span') : el('p.side-hint', {}, 'Drag and drop important stuff here'),
      { canDrop: (id) => !store.isStarred(id), onDrop: (id) => star(id, true) }));

    /* Custom sections, in the order they were made; each holds channels and conversations the user put there. */
    const placed = new Set();
    for (const sec of store.sections()) {
      const rows = sec.items
        .map((id) => (store.channel(id) && store.isJoined(id) ? channelRow(store.channel(id)) : allDms.some((d) => d.id === id) ? dmRow(allDms.find((d) => d.id === id)) : null))
        .filter(Boolean);
      for (const id of sec.items) placed.add(id);
      const key = `sec-${sec.id}`;
      const list = el('div.side-list', { role: 'list' }, ...rows);
      frag.append(section(sec.name, key, list, [
        { icon: 'more', label: `Options for ${sec.name}`, menu: true, onClick: (btn) => openSectionMenu(btn, sec) },
      ], rows.length ? el('span') : el('p.side-hint', {}, 'Drag conversations here, or use "Move to" on a row'),
      { canDrop: (id) => !sec.items.includes(id), onDrop: (id) => move(id, sec.id) }));
    }

    const prefs = sidebarPrefs();
    const lastTs = (id) => store.act.c[id]?.t || 0;
    // A muted row hidden by preference still shows while it is open or carries a mention.
    const shown = (id) => prefs.showMuted || !store.isMuted(id) || cur === id || store.mentionCount(id) > 0;
    const byRecent = (a, b) => lastTs(b.id) - lastTs(a.id);
    const admin = store.isAdmin();

    /* External connections: channels shared with other workspaces (hosted here or there) and direct messages with people met in them. */
    const sharedChannels = store.joinedChannels().filter((ch) => isSharedChannel(ch) && !stars.has(ch.id) && !placed.has(ch.id) && shown(ch.id));
    const hostDms = allDms.filter((dm) => externalDm(dm) && !stars.has(dm.id) && !placed.has(dm.id) && shown(dm.id));
    if (sharedChannels.length || hostDms.length) {
      const extList = el('div.side-list', { role: 'list' });
      for (const ch of prefs.sort === 'recent' ? [...sharedChannels].sort(byRecent) : sharedChannels) extList.append(channelRow(ch));
      for (const dm of hostDms) extList.append(dmRow(dm));
      frag.append(section('External connections', 'external', extList, admin ? [
        { icon: 'plus', label: 'Add a shared channel', onClick: () => addSharedChannelDialog() },
      ] : [], el('span'), {
        canDrop: (id) => (isSharedChannel(store.channel(id)) || allDms.some((dm) => dm.id === id && externalDm(dm))) && (store.isStarred(id) || !!store.sectionOf(id)),
        onDrop: (id) => move(id, null),
      }));
    }

    /* Channels */
    let channels = store.joinedChannels().filter((ch) => !isSharedChannel(ch) && !stars.has(ch.id) && !placed.has(ch.id) && shown(ch.id));
    if (prefs.sort === 'recent') channels = [...channels].sort((a, b) => (a.archived === b.archived ? byRecent(a, b) : a.archived ? 1 : -1));
    const chList = el('div.side-list', { role: 'list' });
    for (const ch of channels) chList.append(channelRow(ch));
    // Guests neither browse nor create channels: they are shown what they were invited to.
    const guest = store.isGuest();
    const addItems = () => [
      { label: 'Create a new channel', icon: 'plus', onSelect: () => createChannelDialog() },
      { label: 'Browse channels', icon: 'search', onSelect: () => browseChannelsDialog(), sub: store.browsableChannels().length ? `${store.browsableChannels().length} to join` : null },
      admin && { label: 'Add a shared channel', icon: 'shared', sub: 'From a share link another workspace sent you', onSelect: () => addSharedChannelDialog() },
    ];
    frag.append(section('Channels', 'channels', chList, guest ? [] : [
      { icon: 'plus', label: 'Add a channel', menu: true, onClick: (btn) => openMenu(btn, addItems(), { align: 'end', label: 'Add channels' }) },
    ], guest
      ? el('p.side-guest-note', {}, 'You are a guest here: you see the channels you were invited to.')
      : el('button.side-add', {
        type: 'button', 'aria-haspopup': 'menu',
        onclick: (e) => openMenu(e.currentTarget, addItems(), { align: 'start', label: 'Add channels' }),
      }, el('span.side-icon', { html: icon('plus', 15, 2.2) }), 'Add channels'),
    { canDrop: (id) => !!store.channel(id) && !isSharedChannel(store.channel(id)) && (store.isStarred(id) || !!store.sectionOf(id)), onDrop: (id) => move(id, null) }));

    /* Direct messages: most recent first, as the store hands them out. */
    const dms = allDms.filter((dm) => !externalDm(dm) && !stars.has(dm.id) && !placed.has(dm.id) && shown(dm.id));
    const dmList = el('div.side-list', { role: 'list' });
    for (const dm of dms) dmList.append(dmRow(dm));
    frag.append(section('Direct messages', 'dms', dmList, [
      { icon: 'pencil', label: 'New message', onClick: () => newDmDialog() },
    ], el('div', {},
      el('button.side-add', { type: 'button', onclick: () => newDmDialog() },
        el('span.side-icon', { html: icon('plus', 15, 2.2) }), 'New message'),
      // Inviting stays one row away, at the bottom of the sidebar, for
      // admins (who are the ones who can).
      admin && el('button.side-add', { type: 'button', onclick: () => inviteDialog() },
        el('span.side-icon', { html: icon('userPlus', 15, 2.2) }), 'Invite people')),
    // Only a direct message that lists here: one with someone from another
    // workspace goes back to External connections, which takes it itself.
    { canDrop: (id) => allDms.some((dm) => dm.id === id && !externalDm(dm)) && (store.isStarred(id) || !!store.sectionOf(id)), onDrop: (id) => move(id, null) }));

    scroll.replaceChildren(frag);
  }

  function star(id, on) {
    if (store.isStarred(id) === on) return;
    store.toggleStar(id).then(() => toast(on ? 'Starred' : 'Star removed', { icon: 'star' })).catch((e) => toast(e.message, { icon: 'alert' }));
  }

  /* ---- custom sections --------------------------------------------------- */

  /** Put a row in a section, or back where it started (null); a starred row loses its star. */
  function move(id, sectionId) {
    const target = sectionId ? store.sections().find((sec) => sec.id === sectionId) : null;
    if (sectionId && !target) return;
    store.moveToSection(id, sectionId)
      .then(() => toast(target ? `Moved to ${target.name}` : 'Moved back', { icon: 'folder' }))
      .catch((e) => toast(e.message, { icon: 'alert' }));
  }

  async function createSection(convId = null) {
    const name = await sectionNameDialog();
    if (!name) return;
    try {
      const id = await store.createSection(name);
      if (convId) await store.moveToSection(convId, id);
      toast(`Section "${name}" created`, { icon: 'folderPlus' });
    } catch (e) {
      toast(e.message, { icon: 'alert' });
    }
  }

  /**
   * The conversation whose kebab menu, or whose "Move to…" list opened from
   * that menu, stands open: its kebab is held drawn by the menu's mark
   * (aria-expanded, see .side-kebab), and the list is drawn again on every
   * poll, so the mark is carried to the kebab of the same conversation at
   * each redraw (see render) and taken off it when the menu closes. Keyed by
   * the conversation, not by the button the menu opened on: the "Move to…"
   * list opens from that button, which a redraw between the two menus has
   * taken off the page, and marking it alone left the kebab now showing the
   * row undrawn under the list.
   */
  let menuConv = null;
  function markKebab(convId, on) {
    for (const k of container.querySelectorAll('.side-kebab')) if (k.dataset.conv === convId) k.setAttribute('aria-expanded', String(on));
  }
  const menuOff = (convId) => () => {
    if (menuConv === convId) menuConv = null;
    markKebab(convId, false);
  };

  /** "Move to…": the sections, Starred, a new one, and the way back out. */
  function openMoveMenu(anchor, convId) {
    const fromKebab = anchor instanceof Element && anchor.classList.contains('side-kebab');
    const cur = store.sectionOf(convId);
    const items = [{ header: 'Move to…' }];
    items.push({ label: 'Starred', icon: 'star', checked: store.isStarred(convId), onSelect: () => { if (!store.isStarred(convId)) star(convId, true); } });
    for (const sec of store.sections()) {
      items.push({ label: sec.name, icon: 'folder', checked: cur?.id === sec.id, onSelect: () => move(convId, sec.id) });
    }
    items.push('sep', { label: 'New section…', icon: 'folderPlus', onSelect: () => createSection(convId) });
    if (cur || store.isStarred(convId)) {
      const external = isSharedChannel(store.channel(convId)) || store.dms().some((dm) => dm.id === convId && externalDm(dm));
      items.push({ label: external ? 'Back to External connections' : store.channel(convId) ? 'Back to Channels' : 'Back to Direct messages', icon: 'arrowLeft', onSelect: () => move(convId, null) });
    }
    // Opened from the kebab's menu: the mark passes from the menu, which has
    // closed by now (taking the mark off), to this list (see menuConv).
    openMenu(anchor, items, { align: 'start', label: 'Move to', onClose: fromKebab ? menuOff(convId) : undefined });
    if (fromKebab) {
      menuConv = convId;
      markKebab(convId, true);
    }
  }

  function openSectionMenu(anchor, sec) {
    openMenu(anchor, [
      { header: sec.name },
      {
        label: 'Rename section', icon: 'pencil',
        onSelect: async () => {
          const name = await sectionNameDialog({ title: 'Rename section', initial: sec.name, confirmLabel: 'Save', rename: true });
          if (name && name !== sec.name) store.renameSection(sec.id, name).catch((e) => toast(e.message, { icon: 'alert' }));
        },
      },
      {
        label: 'Delete section', icon: 'trash', danger: true, sub: 'What is in it goes back to Channels and Direct messages',
        onSelect: async () => {
          const ok = await confirmDialog({ title: `Delete "${sec.name}"?`, message: 'The channels and conversations in it stay where they were; only the grouping goes.', confirmLabel: 'Delete' });
          if (ok) store.deleteSection(sec.id).then(() => toast('Section deleted', { icon: 'trash' })).catch((e) => toast(e.message, { icon: 'alert' }));
        },
      },
    ], { align: 'end', label: `${sec.name} options` });
  }

  /* ---- dragging rows between sections ----------------------------------- */

  const DRAG_TYPE = 'application/x-teamchat-conv';
  let dragging = null; // conv id being dragged
  let renderAfterDrag = false; // a redraw asked for during the drag, drawn once it ends
  function draggable(link, convId) {
    link.draggable = true;
    link.addEventListener('dragstart', (e) => {
      dragging = convId;
      e.dataTransfer.setData(DRAG_TYPE, convId);
      e.dataTransfer.setData('text/plain', store.convTitle(convId));
      e.dataTransfer.effectAllowed = 'move';
      link.classList.add('dragging');
      scroll.classList.add('drag-active');
    });
    link.addEventListener('dragend', () => {
      dragging = null;
      link.classList.remove('dragging');
      scroll.classList.remove('drag-active');
      for (const n of scroll.querySelectorAll('.drop-target')) n.classList.remove('drop-target');
      if (renderAfterDrag) {
        renderAfterDrag = false;
        schedule();
      }
    });
    return link;
  }

  /** An unsent message waits here: a small pen, the draft mark. The row's own label says it (a name on a span is not read). */
  function draftMark() {
    return el('span.side-draft', { html: icon('pencil', 13, 2.2), title: 'You have an unsent message here', 'aria-hidden': 'true' });
  }

  /** A huddle is in progress here: headphones, filled while the user is in it. */
  function huddleMark(convId) {
    const live = store.huddleIn(convId);
    if (!live) return null;
    const inIt = store.inHuddle(convId);
    const n = Object.keys(live.m || {}).length;
    return el(`span.side-huddle${inIt ? '.on' : ''}`, { html: icon('headphones', 13, 2.4), title: inIt ? 'You are in this huddle' : `Huddle in progress, ${n} in it`, 'aria-hidden': 'true' });
  }

  /** Someone is typing in this conversation: three quiet dots where a badge would be. */
  function typingMark() {
    return el('span.side-typing', { 'aria-hidden': 'true', title: 'Someone is typing' }, el('i'), el('i'), el('i'));
  }

  /** The "Move to…" entry a row's menu carries, opening the section list where the menu was. */
  function moveItems(anchor, convId) {
    const cur = store.sectionOf(convId);
    return [{ label: cur ? `Move from ${cur.name}…` : 'Move to…', icon: 'folderInput', onSelect: () => openMoveMenu(anchor, convId) }];
  }

  /**
   * A sidebar row with its notification menu: a kebab that appears on hover
   * or focus, and the context menu on right-click (long press on touch).
   */
  function rowWithMenu(link, convId) {
    // The list item is this wrapper, so the link inside keeps its own role.
    const wrap = el('div.side-row', { role: 'listitem' });
    // The kebab shows only while its row is under the pointer or holds the
    // keyboard, or while its menu stands (see .side-kebab[aria-expanded]).
    // The list is drawn again on every poll, and a menu is often open
    // across such a redraw: the kebab drawn in this one's place takes the
    // menu's mark (see render, which finds it by the conversation), and the
    // menu closing takes the mark off the kebab now showing the row as well
    // as the one it opened on. Drawn without the mark, the kebab the menu
    // hung from dropped away under the open menu at the first poll; and
    // left with it, it stood drawn for good after the menu had gone.
    const kebab = el('button.side-kebab', {
      type: 'button', html: icon('more', 15, 2.2), 'aria-label': `Options for ${store.convTitle(convId)}`, 'aria-haspopup': 'menu', tabindex: -1,
      dataset: { conv: convId },
      onclick: (e) => {
        e.preventDefault();
        openRowMenu(e.currentTarget, convId, { onChange: schedule, extra: moveItems(e.currentTarget, convId), onClose: menuOff(convId) });
        // After the menu is open: opening it closed any other menu standing, whose own close cleared the mark.
        menuConv = convId;
      },
    });
    const openAt = (e) => {
      const anchor = e.clientX || e.clientY ? pointAnchor(e.clientX, e.clientY) : link;
      openRowMenu(anchor, convId, { onChange: schedule, align: 'start', extra: moveItems(anchor, convId) });
    };
    // A keyboard has no hover to bring the kebab out and, on a Mac, no key
    // that fires contextmenu: Shift+F10 and the Menu key open the row's menu
    // from the link (on Windows the same press fires contextmenu as well,
    // which must not open it twice).
    let viaKey = 0;
    link.addEventListener('keydown', (e) => {
      if (!((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu')) return;
      e.preventDefault();
      viaKey = Date.now();
      openAt(e);
    });
    link.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (Date.now() - viaKey < 500) return;
      openAt(e);
    });
    // Touch screens have neither the hover kebab nor a right click, and iOS
    // fires no contextmenu for a long press on a link: time the press.
    attachLongPress(link, openAt, { ignore: 'button' });
    wrap.append(draggable(link, convId), kebab);
    return wrap;
  }

  /**
   * A folded section keeps showing what asks for the eye:
   * the conversations in it that are unread or carry a mention badge, and
   * the one open; only the read rows fold away, with the section's add row
   * or hint. Hidden whole, the section took the open conversation out of
   * the sidebar with it, and an unread conversation folded away gave no
   * sign of itself but the section's chevron. Judged row by row from what
   * the row shows (its bold, its badge, its current mark), at the draw and
   * at the press; a row that comes to need the eye, or stops, is judged
   * again at the next draw.
   */
  const kept = (row) => !!row.querySelector('.side-item.unread, .side-item[aria-current="page"], .badge');
  function fold(list, addRow, folded) {
    for (const row of list.children) row.hidden = folded && !kept(row);
    addRow.hidden = folded;
  }

  /** A section: its collapsible title, the list, an add row, and a drop zone when `onDrop` is given. */
  function section(title, key, list, actions, addRow, { onDrop = null, canDrop = null } = {}) {
    const c = collapsed();
    const toggle = el('button.side-title', {
      type: 'button', 'aria-expanded': String(!c[key]), 'aria-controls': `side-${key}`,
      onclick: () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!open));
        fold(list, addRow, open);
        setCollapsed(key, open);
        // The rows just hidden (or shown again) count for the pills at the
        // list's edges: folded in place, without a redraw, a section left
        // "Unreads below" standing for a row no longer shown until the next
        // poll drew the list afresh.
        updateUnreadPills();
      },
    // The words in a box of their own, which the stylesheet cuts short with
    // an ellipsis when they are more than the sidebar is wide (see
    // .side-title-text); a section named forty letters or twenty emoji
    // pushed the heading's own buttons off the edge and set the whole list
    // scrolling sideways. Read in their own direction, so a name written
    // right to left is cut at its end, not at its start.
    }, el('span', { html: icon('chevDown', 14, 2.4) }), el('span.side-title-text', { dir: 'auto' }, title));
    list.id = `side-${key}`;
    fold(list, addRow, !!c[key]);
    // A head button that opens a menu (a section's Options, Add a channel)
    // says so (aria-haspopup), as every other menu button does: the menu's
    // mark of being open (aria-expanded, see menu.js) is read against it.
    const node = el('div.side-section', {},
      el('div.side-head', {}, toggle, ...actions.map((a) => el('button.icon-btn', {
        type: 'button', html: icon(a.icon, 16, 2.2), 'aria-label': a.label, title: a.label, 'aria-haspopup': a.menu ? 'menu' : null,
        onclick: (e) => a.onClick(e.currentTarget),
      }))),
      list,
      addRow);
    if (onDrop) {
      // Only a row the section would actually take lights it up: a DM over
      // Channels, or a row already here, must not promise a move that would
      // do nothing.
      const accepts = (e, id) => e.dataTransfer?.types?.includes(DRAG_TYPE) && (!canDrop || !id || canDrop(id));
      node.addEventListener('dragover', (e) => {
        if (!accepts(e, dragging)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        node.classList.add('drop-target');
      });
      node.addEventListener('dragleave', (e) => {
        if (!node.contains(e.relatedTarget)) node.classList.remove('drop-target');
      });
      node.addEventListener('drop', (e) => {
        const id = e.dataTransfer.getData(DRAG_TYPE) || dragging;
        if (!accepts(e, id)) return;
        e.preventDefault();
        node.classList.remove('drop-target');
        if (id) onDrop(id);
      });
    }
    return node;
  }

  function renderFooter() {
    const me = store.profile;
    if (!me) {
      footer.replaceChildren();
      return;
    }
    const m = store.member(me.uuid);
    const paused = store.notificationsPaused();
    const myStatus = store.statusOf(me.uuid);
    // The card opens onto what it shows: on the status when its second line
    // is the reader's status (as "Set a status" in the rail's account menu
    // does), else at the top, on the profile the name and picture stand for.
    // While notifications are paused the line is about the pause, which the
    // bell beside the card handles: the top then too. Read at the press, not
    // at the draw, so a status set or cleared meanwhile counts.
    const meBtn = el('button.side-me', {
      type: 'button', 'aria-label': `Your profile and settings${paused ? '. Notifications paused' : ''}`,
      onclick: () => (store.statusOf(me.uuid) && !store.notificationsPaused() ? settingsDialog({ section: 'status' }) : settingsDialog()),
    },
      avatar({ ...m, uuid: me.uuid }, { size: 'sm', presence: paused ? null : true, paused }),
      el('span.me-text', {}, el('strong.name-line', {}, el('span.name-text', { dir: 'auto' }, m.name), store.isGuest() && el('span.pill.pill-guest.pill-inline', {}, 'Guest')),
        el('span', { dir: 'auto' }, paused ? 'Notifications paused' : myStatus ? `${myStatus.emoji || ''} ${myStatus.text || ''}`.trim() : m.title || `@${m.username}`)));
    const bell = el('button.icon-btn', {
      type: 'button', html: icon(paused ? 'bellOff' : 'bell', 19), 'aria-haspopup': 'menu',
      'aria-label': paused ? 'Notifications paused. Change' : 'Pause notifications', title: paused ? 'Notifications paused' : 'Pause notifications',
      onclick: (e) => openPauseMenu(e.currentTarget, { onChange: schedule }),
    });
    if (paused) bell.classList.add('active');
    // Named for whose settings they are: the gear sits by the reader's own
    // card, and opens the same dialog as the card and the rail's account
    // menu ("Profile and settings"); a bare "Settings" read as the
    // workspace's, which live in the workspace name's menu.
    footer.replaceChildren(
      meBtn,
      bell,
      el('button.icon-btn', { type: 'button', html: icon('gear', 19), 'aria-label': 'Profile and settings', title: 'Profile and settings', onclick: () => settingsDialog() }));
  }

  listKeyNav(scroll, '.side-item');
  // The bare up arrow pressed on the first row returns to the filter box,
  // the way the down arrow from the box goes into the list (see the box's
  // keys), as the Direct messages list's box has it. After the list's own
  // keys (listKeyNav, which stops at the first row): run before them, the
  // box took the keyboard and the list's handler, finding nothing of its own
  // focused, put it straight back on the row. Judged by the row the key was
  // pressed on, not by where the keyboard is by now (from the second row the
  // list has just moved it to the first). One during an IME composition is
  // the composition's, and one held with Alt the previous-conversation
  // shortcut's.
  scroll.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' || e.altKey || e.metaKey || e.ctrlKey || composing(e)) return;
    const first = [...scroll.querySelectorAll('.side-item')].find((n) => n.getClientRects().length > 0) || null;
    if (!first || e.target !== first) return;
    e.preventDefault();
    filterInput.focus();
  });
  // A pause or quiet-hours window ending is not an event anyone sends: look once a minute.
  const tick = setInterval(schedule, 60_000);
  const offs = [store.on('workspace', schedule), store.on('activity', schedule), store.on('profile', schedule), store.on('typing', schedule), store.on('huddle', schedule)];
  window.addEventListener('hashchange', schedule);
  window.addEventListener('teamchat:drafts', schedule);
  render();
  return {
    refresh: schedule,
    destroy() {
      offs.forEach((f) => f());
      clearInterval(tick);
      window.removeEventListener('hashchange', schedule);
      window.removeEventListener('teamchat:drafts', schedule);
    },
  };
}

export { showMemberCard };
