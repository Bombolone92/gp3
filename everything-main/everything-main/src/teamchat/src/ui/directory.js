/**
 * The Directory: everyone in
 * the workspace as cards under People, and every channel you can see under
 * Channels, both searchable, in the main column. People open their profile
 * card (with a Message button); channels open, or are joined first.
 */
import { el, append, listKeyNav, rerenderTabs, keepFocus, clearOnEscape, composing, pressOnce } from './dom.js';
import { icon, channelIcon } from './icons.js';
import { avatar, statusChip, rolePill, personLabel } from './avatar.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { showMemberCard, openDmWith, inviteDialog, createChannelDialog, joinFailed } from './dialogs.js';
import { normalize } from '../shared/search.js';

const TABS = [['people', 'People'], ['channels', 'Channels']];

export function createDirectoryView() {
  let tab = 'people';
  let destroyed = false;
  // Channels whose join is out to the worker: the list is redrawn whenever
  // the poll brings the workspace's document, and the button a redraw puts
  // in a pressed one's place must be drawn busy as that one was, and take
  // no press until the answer comes (see the Join button below).
  const joining = new Set();
  const search = el('input.input.dir-search', { type: 'search', placeholder: 'Search people', 'aria-label': 'Search the directory', autocomplete: 'off' });
  const tabs = el('div.conv-tabs.dir-tabs', { role: 'tablist', 'aria-label': 'Directory' });
  const body = el('div.view-body.dir-body', { role: 'region', 'aria-label': 'Directory' });
  const header = el('div.conv-header.view-header', {},
    el('button.icon-btn.back', {
      type: 'button', html: icon('arrowLeft', 20), 'aria-label': 'Back to conversations',
      onclick: () => navigate({ ws: store.wsId, view: null }),
    }),
    el('div.view-title', {}, el('h1.conv-title', {}, 'Directory'), el('span.view-sub', {}, 'Everyone here, and every channel you can see')));
  // Said aloud as well as shown: that nobody, or no channel, matches the
  // words in the box (see applyFilter). The box keeps the keyboard while
  // the list empties under the words typed, so a screen reader heard
  // nothing of it; and nothing is said while cards still match, rather
  // than a count at every letter. One region in place from the start, as
  // the search view has, set only when the words change.
  const status = el('div.visually-hidden', { role: 'status', 'aria-live': 'polite' });
  const say = (text) => { if (status.textContent !== text) status.textContent = text; };
  const root = el('div.main.list-view.dir-view', {}, header, tabs, el('div.dir-tools', {}, el('span.side-filter-icon', { html: icon('search', 16, 2) }), search), body, status);

  function renderTabs() {
    const counts = { people: Object.keys(store.ws?.members || {}).length, channels: channels().length };
    rerenderTabs(tabs, ...TABS.map(([key, label]) => el('button.conv-tab', {
      type: 'button', role: 'tab', 'aria-selected': String(tab === key), tabindex: tab === key ? 0 : -1,
      onclick: () => setTab(key),
    }, el('span', {}, label), el('span.dir-tab-n', {}, String(counts[key])))));
  }
  tabs.addEventListener('keydown', (e) => {
    // Only the bare arrows are the tablist's: held with Alt, Cmd or Ctrl an
    // arrow is the browser's (Back and Forward) or a shortcut's, and passes,
    // as it does the lists and the radiogroups; one during an IME
    // composition is the IME's.
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.metaKey || e.ctrlKey || composing(e)) return;
    e.preventDefault();
    setTab(tab === 'people' ? 'channels' : 'people');
    tabs.querySelector('[aria-selected="true"]')?.focus();
  });
  function setTab(next) {
    tab = next;
    search.placeholder = tab === 'people' ? 'Search people' : 'Search channels';
    renderTabs();
    render();
  }

  /**
   * Channels the reader may see: joined ones, and public ones they could
   * join. Not an entry for a channel hosted elsewhere whose connection is
   * over, unless they are in it: the host refuses everyone this workspace
   * sends, so its Join only went round to the host and came back refused
   * (the store's browsableChannels leaves it out for the same reason).
   */
  function channels() {
    const joined = new Set(store.me?.channels || []);
    return Object.values(store.ws?.channels || {})
      .filter((c) => joined.has(c.id) || (!c.private && !c.lost && !store.isGuest()))
      .sort((a, b) => (a.archived !== b.archived ? (a.archived ? 1 : -1) : a.name.localeCompare(b.name)));
  }

  /** Who is shown and how they are: a redraw on a poll is only worth it when this changes. */
  function presenceSig() {
    return Object.keys(store.ws?.members || {}).map((u) => `${u}:${store.presenceOf(u)}`).join(',');
  }
  let lastSig = null;

  /**
   * Everything the cards (or the channel rows) show, as one string: the
   * workspace's document moves for many reasons no card shows (a channel's
   * topic, a message's pin, a section made or a channel starred, which move
   * the reader's own document), and each moved rebuilt every card, its
   * face, status chip and role pill, some hundreds of them, and the card
   * under the pointer with them. Compared before a rebuild (see the
   * listeners below): the same words, the same cards.
   */
  function cardSig() {
    if (tab === 'people') {
      const rows = Object.entries(store.ws?.members || {})
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([uuid, m]) => [uuid, m.name, m.username, m.title || '', m.role || '', m.avatar || '', m.color || 0, m.org?.name || '', store.presenceOf(uuid), store.statusOf(uuid) || null]);
      return JSON.stringify(['people', store.uuid, store.isAdmin(), rows]);
    }
    const joined = new Set(store.me?.channels || []);
    const rows = channels().map((c) => [c.id, c.name, !!c.archived, !!c.lost, !!c.private, !!c.shared, c.postPolicy || '', c.count || 0, c.topic || '', c.description || '', joined.has(c.id), joining.has(c.id)]);
    return JSON.stringify(['channels', store.isGuest(), rows]);
  }
  let lastCardSig = null;

  /**
   * The cards (or the channel rows) as built, each with what the filter
   * looks at in it. A keystroke in the box puts the ones that match into the
   * list and takes the others out (see applyFilter) rather than building
   * the Directory over: with a few hundred members every letter typed
   * rebuilt every card, its face, status chip and role pill, and the box
   * lagged behind the typing. Built when the Directory opens or when what
   * the cards show changes (see render).
   */
  let built = []; // [{ node, hays: [string] }], in the order they list
  let listNode = null; // the grid or the list
  let emptyNode = null; // "Nobody matches" / "No channels match", shown when the filter leaves nothing
  let footNode = null; // Invite people / Create a channel

  /**
   * Compared as search reads them, lowercase with accents and other marks
   * stripped on both sides: "jose" finds José, as the search view's People
   * tab does. Names are kept without their sigil, so one typed the way the
   * app writes them ("@dan", "#ops") must still find them, as it does in
   * the sidebar's filter: the sigil comes off what was typed.
   */
  function applyFilter() {
    const q = normalize(search.value.trim().replace(/^[#@]+/, ''));
    const hit = (s) => normalize(s || '').includes(q);
    const shown = built.filter(({ hays }) => !q || hays.some(hit)).map(({ node }) => node);
    if (listNode) {
      listNode.replaceChildren(...shown);
      listNode.hidden = !shown.length;
    }
    if (footNode) footNode.hidden = !shown.length;
    const nothing = tab === 'people' ? 'Nobody matches' : q ? 'No channels match' : 'No channels yet';
    if (emptyNode) {
      emptyNode.hidden = shown.length > 0;
      emptyNode.querySelector('h3').textContent = nothing;
    }
    say(shown.length ? '' : nothing);
  }

  function render() {
    if (destroyed) return;
    lastSig = presenceSig();
    lastCardSig = cardSig();
    body.replaceChildren();
    built = [];
    if (tab === 'people') {
      const people = Object.entries(store.ws?.members || {})
        .map(([uuid, m]) => ({ uuid, ...m }))
        .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.name.localeCompare(b.name)));
      const grid = el('div.dir-grid', { role: 'list' });
      for (const m of people) {
        const isMe = m.uuid === store.uuid;
        const card = el('div.dir-card', { role: 'listitem' });
        // Named with how the person is (their dot, their status chip): the
        // label names the whole card to a screen reader, so the chip's words
        // and the dot went unheard (see personLabel). The profile hangs from
        // the button, not the card: the popover hands the keyboard back to
        // what it hung from when it closes, and a card is no control to hand
        // it to, so Escape on a profile opened from the keyboard dropped the
        // keyboard to the page (the search results' People tab hangs it from
        // its button already).
        const open = el('button.dir-card-main', { type: 'button', 'aria-label': personLabel(m.name, m.uuid, '. Profile'), onclick: () => showMemberCard(m.uuid, open) },
          avatar(m, { size: 'lg', state: store.presenceOf(m.uuid) }),
          el('span.dir-card-name', {}, el('span', { dir: 'auto' }, m.name, isMe ? ' (you)' : ''), statusChip(m.uuid, { compact: true })),
          el('span.dir-card-sub', {}, m.title || `@${m.username}`),
          rolePill(m.uuid));
        card.append(open);
        if (!isMe) {
          card.append(el('button.btn.btn-sm.btn-outline.dir-card-action', {
            type: 'button', 'aria-label': `Message ${m.name}`, onclick: () => openDmWith(m.uuid).catch((e) => toast(e.message, { icon: 'alert' })),
          }, 'Message'));
        }
        grid.append(card);
        built.push({ node: card, hays: [m.name, m.username, m.title] });
      }
      listNode = grid;
      emptyNode = el('div.empty', { style: { paddingTop: '48px' } }, el('div.empty-icon', { html: icon('users', 24) }), el('h3', {}, 'Nobody matches'), el('p', {}, 'Names, usernames, and titles are searched.'));
      footNode = store.isAdmin()
        ? el('div.dir-foot', {}, el('button.btn.btn-outline', { type: 'button', html: icon('userPlus', 16), onclick: () => inviteDialog() }, ' Invite people'))
        : null;
      append(body, [grid, emptyNode, footNode]);
      applyFilter();
      return;
    }
    const joined = new Set(store.me?.channels || []);
    const all = channels();
    const list = el('div.dir-list', { role: 'list' });
    for (const c of all) {
      const isIn = joined.has(c.id);
      // An archived channel is entered by nobody (the worker refuses the
      // join), but a public one is still there to read: it opens instead.
      const opens = isIn || c.archived;
      const action = el(`button.btn.btn-sm.${opens ? 'btn-ghost' : 'btn-outline'}`, {
        type: 'button', 'aria-label': `${opens ? 'Open' : 'Join'} #${c.name}`,
        // Drawn busy from the start when this row's join is already out (see joining).
        dataset: opens ? null : { join: c.id }, 'aria-busy': !opens && joining.has(c.id) ? 'true' : null,
      }, opens ? 'Open' : 'Join');
      // One press at a time while the worker answers, said with aria-busy
      // rather than by disabling the button (see pressOnce): disabled, the
      // focused button dropped the keyboard on the page, and a join refused
      // (the channel archived meanwhile, the network gone) came back with
      // the button live and nobody on it.
      const join = pressOnce(action, async () => {
        joining.add(c.id);
        // The workspace the join is for, taken before the wait: switched to
        // another meanwhile, the reader stays where they went, since the
        // channel's id under the other workspace's reference names nothing
        // there (the join has gone through all the same, and says so).
        const ws = store.wsId;
        try {
          await store.joinChannel(c.id);
          toast(`Joined #${c.name}`);
          if (store.wsId !== ws) return;
          navigate({ ws, conv: c.id, view: null });
        } catch (e) {
          // Joined here all the same when the channel's host did not answer
          // (the store keeps such a join): said as that, not as the
          // network's "Failed to fetch" over a row now reading Open.
          joinFailed(c, e);
        } finally {
          joining.delete(c.id);
          // The button a redraw put in this one's place is live again with the answer.
          for (const b of body.querySelectorAll(`[data-join="${c.id}"]`)) if (b !== action) b.removeAttribute('aria-busy');
        }
      });
      action.addEventListener('click', opens ? () => navigate({ ws: store.wsId, conv: c.id, view: null }) : () => { if (!joining.has(c.id)) join(); });
      const row = el('div.dir-row', { role: 'listitem' },
        // A channel hosted elsewhere whose connection is over is said so, as
        // the sidebar's row says it: its icon alone (unplugged) named nothing
        // here, and the row read as any other channel's. So are archived and
        // admins-only: the row's name stands in for everything drawn in it,
        // and the pills that say them reached no screen reader.
        el('button.dir-row-main', { type: 'button', 'aria-label': `#${c.name}${c.archived ? ', archived' : ''}${c.lost ? ', no longer shared' : ''}${c.postPolicy === 'admins' ? ', admins post' : ''}, details`, onclick: () => navigate({ ws: store.wsId, conv: c.id, details: true, view: null }) },
          el('span.dir-row-icon', { html: icon(channelIcon(c), 18, 2) }),
          el('span.dir-row-text', {},
            el('strong', {}, c.name, c.archived && el('span.pill.pill-inline', {}, 'Archived'), c.lost && el('span.pill.pill-inline', {}, 'No longer shared'), c.postPolicy === 'admins' && el('span.pill.pill-inline', {}, 'Admins post')),
            el('span', {}, `${c.count || 0} member${c.count === 1 ? '' : 's'}${c.topic ? ` · ${c.topic}` : c.description ? ` · ${c.description}` : ''}`))),
        action);
      list.append(row);
      built.push({ node: row, hays: [c.name, c.topic, c.description] });
    }
    listNode = list;
    emptyNode = el('div.empty', { style: { paddingTop: '48px' } }, el('div.empty-icon', { html: icon('hash', 24) }), el('h3', {}, 'No channels yet'), el('p', {}, 'Names, topics, and descriptions are searched.'));
    footNode = !store.isGuest()
      ? el('div.dir-foot', {}, el('button.btn.btn-outline', { type: 'button', html: icon('plus', 16), onclick: () => createChannelDialog() }, ' Create a channel'))
      : null;
    append(body, [list, emptyNode, footNode]);
    applyFilter();
  }

  // The control under the keyboard comes back after a redraw by its label
  // (a card, its Message button, a channel's Join, the footer's button), the
  // way the Later view keeps its.
  const draw = () => keepFocus(body, render);
  search.addEventListener('input', applyFilter);
  clearOnEscape(search);
  listKeyNav(body, '.dir-card-main, .dir-row-main');
  // Presence rides on every poll; the grid is rebuilt only when someone's dot
  // actually changed, so a focused card and an open profile card survive.
  // The workspace's and the reader's own documents move for many reasons
  // too: the grid is rebuilt only when what a card shows has changed (see
  // cardSig); the tabs' counts are cheap and follow every move.
  const offs = [
    store.on('workspace', () => { renderTabs(); if (cardSig() !== lastCardSig) draw(); }),
    store.on('activity', () => { if (presenceSig() !== lastSig) draw(); }),
    store.on('profile', () => { if (cardSig() !== lastCardSig) draw(); }),
  ];
  setTab('people');
  // Not on a touch screen: the keyboard would come up over the list as it opens.
  if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => search.focus(), 0);
  return {
    el: root,
    destroy() {
      destroyed = true;
      offs.forEach((f) => f());
    },
  };
}
