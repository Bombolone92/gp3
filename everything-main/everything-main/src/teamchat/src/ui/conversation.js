/**
 * The main column for one conversation: header, message list, composer (or
 * a join bar for channels the user has not joined yet).
 */
import { el, rerenderTabs, keepFocus, composing, pressOnce, coarsePointer, focusables } from './dom.js';
import { icon, channelIcon, isSharedChannel } from './icons.js';
import { avatar, groupAvatar, statusChip } from './avatar.js';
import { sharedSummary, sharedBannerText, sharedPillText } from './shared.js';
import { PRESENCE_LABELS } from '../lib/time.js';
import { toast } from './toast.js';
import { createMessageList } from './messagelist.js';
import { createComposer } from './composer.js';
import { createTypingLine } from './typing.js';
import { createPinBar } from './pins.js';
import { renderBookmarksBar } from './bookmarks.js';
import { createFilesView } from './filesview.js';
import { showMemberCard, editChannelDialog, confirmBroadcast, leaveChannelFlow, leaveOffered, joinFailed, addPeopleToChannelDialog, deleteOrphanChannelFlow } from './dialogs.js';
import { confirmDialog } from './modal.js';
import { openNotifyMenu, notifyMenuItems, notifySummary } from './notifymenu.js';
import { openMenu } from './menu.js';
import { absoluteLink, navigate, parseHash, PANE_VIEWS } from '../lib/router.js';
import { acceptTransferDialog } from './dialogs.js';
import { store } from '../lib/store.js';
import { api } from '../lib/api.js';
import { huddleButton, createHuddleBar } from './huddle.js';
import { copyToClipboard } from './clipboard.js';

export function createConversationView(convId, { onOpenThread, onOpenDetails, focusSeq = null, tab: initialTab = 'messages' }) {
  const root = el('div.main');
  const header = el('div.conv-header');
  const tabs = el('div.conv-tabs', { role: 'tablist', 'aria-label': 'Conversation views' });
  const strips = el('div.conv-strips');
  const body = el('div', { style: { display: 'contents' } });
  root.append(header, tabs, strips, body);
  let list = null;
  let composer = null;
  let typing = null;
  let pinBar = null;
  let huddleBar = null;
  let files = null;
  let destroyed = false;
  let tab = initialTab; // 'messages' | 'files'
  // A join of this channel out to the worker. The foot (or the whole body)
  // is redrawn whenever the workspace changes under it, and a press on Join
  // was held on the button pressed alone: a redraw in the moment the join
  // was out put a fresh Join in its place, one that knew nothing of the
  // press, so it looked live and a second press sent the join again (the
  // worker took it as already done, and the channel was announced as joined
  // twice). The fresh button is drawn busy from this, takes no press until
  // the answer comes, and is freed with it, joined or refused.
  let joinOut = false;
  /** A Join button for this channel: busy while a join is out, and one press at a time (see joinOut). */
  const joinButton = (label, cls, run) => {
    const btn = el(`button.${cls}`, { type: 'button', dataset: { join: convId }, 'aria-busy': joinOut ? 'true' : null }, label);
    const press = pressOnce(btn, async () => {
      joinOut = true;
      try {
        await run();
      } finally {
        joinOut = false;
        // The button a redraw put in this one's place is live again with the answer.
        for (const b of body.querySelectorAll(`[data-join="${convId}"]`)) if (b !== btn) b.removeAttribute('aria-busy');
      }
    });
    btn.addEventListener('click', () => { if (!joinOut) press(); });
    return btn;
  };

  /** Messages and Files & links sit as tabs under the channel name. */
  function renderTabs() {
    const canShow = store.canAccess(convId) && (channel() || dm());
    tabs.hidden = !canShow;
    if (!canShow) return;
    const tabBtn = (key, label, ic) => el('button.conv-tab', {
      type: 'button', role: 'tab', 'aria-selected': String(tab === key), tabindex: tab === key ? 0 : -1,
      onclick: () => navigate({ ws: store.wsId, conv: convId, files: key === 'files' }),
    }, el('span', { html: icon(ic, 15, 2) }), el('span', {}, label));
    rerenderTabs(tabs, tabBtn('messages', 'Messages', 'message'), tabBtn('files', 'Files & links', 'files'));
  }
  // Left and Right step between the two tabs, Home and End go to the first
  // and the last, as on any tab strip. A modified arrow is a shortcut's
  // (Alt+Left/Right), and one during an IME composition is the IME's.
  tabs.addEventListener('keydown', (e) => {
    if (e.altKey || e.metaKey || e.ctrlKey || composing(e)) return;
    let files;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') files = tab !== 'files';
    else if (e.key === 'Home') files = false;
    else if (e.key === 'End') files = true;
    else return;
    e.preventDefault();
    if (files === (tab === 'files')) return;
    navigate({ ws: store.wsId, conv: convId, files });
  });

  function setTab(next) {
    if (tab === next) return;
    tab = next;
    renderTabs();
    renderStrips();
    renderBody();
  }

  /** Bookmarks under the header (channels only) and the pinned bar. */
  function renderStrips() {
    // Redrawn as the workspace changes under it (someone joins the channel,
    // a bookmark is added): the control under the keyboard, the pinned bar's
    // toggle, a huddle bar's Join, a bookmark, is found again in the new
    // strips by its label, or the focus fell to the page body and the next
    // Tab started over from the top of the page.
    keepFocus(strips, drawStrips);
  }
  function drawStrips() {
    huddleBar?.destroy();
    huddleBar = null;
    const ch = channel();
    // The pinned bar keeps its state through a redraw of the strips (a
    // bookmark added, someone joining the channel, a guest invited): built
    // anew with them, it came back folded over the list of pins the reader
    // had just opened. It is taken down only when it has no place here.
    const pins = tab === 'messages' && store.canAccess(convId);
    // The bar kept is taken off the page and put back among the fresh
    // strips, and a browser lets go of a focused control as it leaves the
    // page: the control under the keyboard (an Unpin in the list) takes it
    // back, the same one, rather than keepFocus's guess at its place among
    // the strips' controls, which a bookmark added above the bar had moved
    // along by one, onto the next pin.
    const held = pins && pinBar && pinBar.el.contains(document.activeElement) ? document.activeElement : null;
    strips.replaceChildren();
    if (!pins) {
      pinBar?.destroy();
      pinBar = null;
    }
    if (tab !== 'messages') return;
    // A huddle in progress here that the user is not in: who, since when, Join.
    if (store.canHuddle(convId)) {
      huddleBar = createHuddleBar(convId);
      strips.append(huddleBar.el);
    }
    if (store.ws?.movedTo) {
      strips.append(el('div.guest-banner.moved-banner', { html: icon('refresh', 14, 2.2) },
        el('span', {}, 'This workspace moved to another server and this copy is read-only. '),
        el('a', { href: `#/ws/${encodeURIComponent(store.ws.movedTo)}` }, 'Open the new one')));
    } else if (store.ws?.importing) {
      // Its history is still being written from an archive: the worker takes
      // no writes until it is open, and says so to each one; better said once, here.
      strips.append(el('div.guest-banner.moved-banner', { html: icon('download', 14, 2.2) },
        el('span', {}, 'This workspace is still being imported. Everything here can be read; posting opens when it is done.')));
    } else if (store.ws?.transferTo === store.uuid) {
      strips.append(el('div.guest-banner.moved-banner', { html: icon('refresh', 14, 2.2) },
        el('span', {}, `${store.member(store.ws.owner).name} asked you to take over this workspace. `),
        el('button.btn.btn-sm.btn-primary', { type: 'button', onclick: () => acceptTransferDialog() }, 'Review')));
    }
    if (ch && ch.guests > 0 && !store.isGuest()) {
      strips.append(el('div.guest-banner', { html: icon('users', 14, 2.2) },
        el('span', {}, `This channel includes ${ch.guests} guest${ch.guests === 1 ? '' : 's'} from outside the workspace. What is posted here is not internal-only.`)));
    }
    // A shared channel says which workspaces read it ("N external people
    // are from X"). Not over the gate: what the host last said about
    // who reads the channel is beside the point while it cannot be reached
    // (or will not have the member), and would sit there contradicting it.
    if (ch && isSharedChannel(ch) && store.isJoined(convId) && !ch.lost && !sharedGateReason()) {
      const text = sharedBannerText(ch);
      if (text) strips.append(el('div.guest-banner.shared-banner', { html: icon('shared', 14, 2.2) }, el('span', {}, text)));
    }
    if (ch && (ch.bookmarks?.length || store.isJoined(convId))) strips.append(renderBookmarksBar(ch));
    if (pins) {
      // The bar going with its last pin (unpinned from its own list) hands a
      // keyboard inside it to the newest message, where a box that goes
      // leaves it too (see renderFoot), rather than to the page body.
      pinBar = pinBar || createPinBar(convId, {
        onHide: () => ([...(list?.el.querySelectorAll('.msg') || [])].pop() || header.querySelector('button.conv-title-btn'))?.focus({ preventScroll: true }),
      });
      strips.append(pinBar.el);
      held?.focus({ preventScroll: true });
    }
  }

  const channel = () => store.channel(convId);
  const dm = () => store.me?.dms?.[convId];

  function renderHeader() {
    const ch = channel();
    const d = dm();
    // The header is rebuilt whenever the workspace changes under it (a
    // notification level picked from its bell, a star): the button under the
    // keyboard is found again by its label.
    const active = document.activeElement;
    const focusKey = header.contains(active) && active instanceof HTMLElement ? active.getAttribute('aria-label') || active.textContent : null;
    // A toggle's label and class both change with its press (the star, the
    // bell), which is exactly when the header is redrawn: the button's own
    // class name (conv-star, conv-notify) stands for it then. The huddle
    // toggle is one too: its label counts the people in it and says when
    // the user is one of them, and joining or leaving redraws the header
    // with the button under the keyboard.
    const stem = (n) => (n.className.match(/\b(?:conv-[a-z-]+|huddle-btn)\b/) || [])[0] || null;
    /** The header's button standing for `old` (a button of the header before this redraw): by its label, else by its class name (see stem). */
    const likeOf = (old, key) => [...header.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent) === key || (stem(b) && stem(b) === stem(old))) || null;
    const restore = () => {
      if (!focusKey) return;
      likeOf(active, focusKey)?.focus({ preventScroll: true });
    };
    // A menu standing open from one of the header's buttons (its bell, its
    // More) says so on the button (aria-expanded, see openPopover): the
    // fresh button says so too, and is the menu's opener from then on (a
    // press on it closes the menu, the keyboard comes back to it; see
    // menu.js standIn). Drawn without the word, a press on the fresh button
    // under the open menu closed it and opened a second in its place.
    const expanded = header.querySelector('[aria-expanded="true"]');
    const expandedKey = expanded ? expanded.getAttribute('aria-label') || expanded.textContent : null;
    header.replaceChildren();
    // On a phone the list is a screen of its own: Back returns to the list
    // this conversation was opened from, the DMs, Activity, or Later pane
    // when it was one of those, else the channel list.
    header.append(el('button.icon-btn.back', {
      type: 'button', html: icon('arrowLeft', 20), 'aria-label': 'Back to conversations',
      onclick: () => {
        const cur = parseHash(location.hash);
        navigate(PANE_VIEWS.includes(cur.view) ? { ws: store.wsId, view: cur.view } : { ws: store.wsId });
      },
    }));
    if ((ch && store.isJoined(convId)) || d) {
      const starred = store.isStarred(convId);
      header.append(el('button.icon-btn.conv-star', {
        type: 'button', html: icon('star', 18, 2), 'aria-pressed': String(starred),
        className: `icon-btn conv-star${starred ? ' on' : ''}`,
        'aria-label': starred ? 'Starred. Remove star' : 'Star this conversation', title: starred ? 'Remove star' : 'Star',
        onclick: () => store.toggleStar(convId).then((on) => toast(on ? 'Starred' : 'Star removed', { icon: 'star' })).catch((e) => toast(e.message, { icon: 'alert' })),
      }));
    }
    if (ch && store.canAccess(convId)) {
      header.append(el('button.conv-title-btn', { type: 'button', onclick: onOpenDetails, 'aria-label': `${ch.name}, channel details${ch.postPolicy === 'admins' ? ', only admins post' : ''}` },
        el('span', { html: icon(channelIcon(ch), 18, 2.2), style: { color: 'var(--ink-3)' } }),
        el('h1.conv-title', {}, ch.name),
        ch.archived && el('span.pill', {}, 'Archived'),
        !ch.archived && ch.postPolicy === 'admins' && el('span.pill', { title: 'Only admins can post here' }, 'Admins post'),
        ch.guests > 0 && el('span.pill.pill-guest', { title: 'People from outside the workspace can read this channel' }, `${ch.guests} guest${ch.guests === 1 ? '' : 's'}`),
        isSharedChannel(ch) && el('span.pill.pill-org', { title: sharedSummary(ch) || 'Shared with another workspace' }, el('span', { html: icon('building', 11, 2.2), 'aria-hidden': 'true' }), sharedPillText(ch))));
      // The topic, opening its editor for those who may change it and the
      // details for everyone else; "Add a topic" only to those who can.
      const curator = store.canCurate(convId);
      if (ch.topic || curator) {
        // A topic written right to left reads so, as the message text does.
        header.append(el('button.conv-topic', {
          type: 'button', dir: 'auto', 'aria-label': ch.topic ? `Topic: ${ch.topic}. ${curator ? 'Edit topic' : 'Details'}` : 'Add a topic',
          // The header cuts a long topic with an ellipsis; the whole of it on hover.
          title: ch.topic || null,
          onclick: () => (curator ? editChannelDialog(ch) : onOpenDetails()),
        }, ch.topic || 'Add a topic'));
      } else header.append(el('span.conv-spacer')); // the topic is what pushes the buttons right
      // The member button is a short stack of faces and a count. The
      // faces here are the people who spoke most recently in the loaded
      // window, which costs no extra read; the count is the channel's.
      const recent = [];
      for (const m of [...store.conv(convId).messages].reverse()) {
        if (m.kind !== 'msg' || m.bot || m.deleted || recent.includes(m.user)) continue;
        recent.push(m.user);
        if (recent.length === 3) break;
      }
      header.append(el('button.conv-members-btn', {
        type: 'button', 'aria-label': `${ch.count || 0} member${ch.count === 1 ? '' : 's'}, view details`, title: `${ch.count || 0} member${ch.count === 1 ? '' : 's'}`, onclick: onOpenDetails,
      },
      recent.length ? el('span.face-stack', { 'aria-hidden': 'true' }, ...recent.map((u) => avatar(store.member(u), { size: 'xs' }))) : el('span', { html: icon('users', 15, 2) }),
      el('span.count', {}, String(ch.count || 0))));
    } else if (d) {
      const others = d.members.filter((u) => u !== store.uuid).map((u) => store.member(u));
      const state = others.length === 1 ? store.presenceOf(others[0].uuid) : null;
      const av = others.length === 1 ? avatar(others[0], { size: 'sm', state })
        : others.length ? groupAvatar(others, { size: 'sm' }) : avatar(store.member(store.uuid), { size: 'sm' });
      header.append(el('button.conv-title-btn', { type: 'button', onclick: onOpenDetails, 'aria-label': `${store.dmTitle({ others: others.map((o) => o.uuid) })}, conversation details` },
        av, el('h1.conv-title', {}, store.dmTitle({ others: others.map((o) => o.uuid) })),
        // Someone from another workspace wears its name here as in a channel's header and the sidebar.
        others.length === 1 && others[0].role === 'external' && el('span.pill.pill-org', { title: `From ${others[0].org?.name || 'another workspace'}, a workspace you share a channel with` },
          el('span', { html: icon('building', 11, 2.2), 'aria-hidden': 'true' }), others[0].org?.name || 'Another workspace'),
        others.length === 1 && statusChip(others[0].uuid),
        others.length === 1 && state !== 'offline' && el('span.small.muted', { style: { marginLeft: '4px' } }, PRESENCE_LABELS[state])));
      header.append(el('span.conv-spacer'));
    } else {
      // A channel that cannot be opened (a private one nobody is left in,
      // listed to admins only so it can be deleted): its name, and no way
      // into details or a topic the worker would refuse.
      header.append(el('h1.conv-title', { style: { padding: '0 8px' } }, ch ? ch.name : 'Conversation'));
      header.append(el('span.conv-spacer'));
    }
    // The huddle toggle: headphones at the right of the header.
    const huddle = huddleButton(convId);
    if (huddle) header.append(huddle);
    if ((ch && store.isJoined(convId)) || d) {
      const muted = store.isMuted(convId);
      header.append(el('button.icon-btn', {
        type: 'button', html: icon(muted ? 'bellOff' : 'bell', 19), 'aria-haspopup': 'menu',
        'aria-label': `Notifications: ${muted ? 'muted' : store.notifySetting(convId).level}. Change`,
        title: muted ? 'Muted' : 'Notifications',
        className: `icon-btn conv-notify${muted ? ' active' : ''}`,
        onclick: (e) => openNotifyMenu(e.currentTarget, convId, { onChange: renderHeader }),
      }));
    }
    if (store.canAccess(convId) && (ch || d)) {
      header.append(el('button.icon-btn.conv-search', {
        type: 'button', html: icon('search', 19), 'aria-label': ch ? 'Search in channel' : 'Search in conversation', title: ch ? 'Search in channel' : 'Search in conversation',
        onclick: () => navigate({ ws: store.wsId, query: searchScope() }),
      }));
    }
    if (store.canAccess(convId) && (ch || d)) {
      header.append(el('button.icon-btn', {
        type: 'button', html: icon('more', 19), 'aria-label': 'More', title: 'More', 'aria-haspopup': 'menu',
        onclick: (e) => openHeaderMenu(e.currentTarget),
      }));
    }
    if (expanded) likeOf(expanded, expandedKey)?.setAttribute('aria-expanded', 'true');
    restore();
  }

  /** The `in:` filter that scopes search to this conversation. */
  function searchScope() {
    const ch = channel();
    if (ch) return `in:#${ch.name} `;
    const others = dm()?.members.filter((u) => u !== store.uuid) || [];
    return others.length === 1 ? `in:@${store.member(others[0]).username} ` : '';
  }

  /** The header's kebab: the usual conversation actions, minus what this app has no equivalent for. */
  function openHeaderMenu(anchor) {
    const ch = channel();
    const d = dm();
    const joined = ch ? store.isJoined(convId) : !!d;
    const starred = store.isStarred(convId);
    const copy = (text, done) => copyToClipboard(text).then(() => toast(done)).catch(() => toast('Could not copy', { icon: 'alert' }));
    const items = [
      { label: ch ? 'Channel details' : 'Conversation details', icon: 'info', onSelect: onOpenDetails },
      { label: 'Copy link', icon: 'link', onSelect: () => copy(absoluteLink({ ws: store.wsId, conv: convId }), 'Link copied') },
      ch && { label: 'Copy name', icon: 'copy', onSelect: () => copy(`#${ch.name}`, 'Name copied') },
      'sep',
      joined && {
        label: starred ? 'Remove star' : ch ? 'Star channel' : 'Star conversation', icon: starred ? 'starOff' : 'star',
        onSelect: () => store.toggleStar(convId).then((on) => toast(on ? 'Starred' : 'Star removed', { icon: 'star' })).catch((e) => toast(e.message, { icon: 'alert' })),
      },
      joined && {
        label: 'Notifications', icon: store.isMuted(convId) ? 'bellOff' : 'bell', sub: notifySummary(convId),
        onSelect: () => openMenu(anchor, notifyMenuItems(convId, { onChange: renderHeader }), { align: 'end', label: 'Notifications' }),
      },
      ch && store.canCurate(convId) && { label: 'Edit channel', icon: 'pencil', sub: 'Name and topic', onSelect: () => editChannelDialog(ch) },
      // Not offered to a guest whose only channel this is (see leaveOffered).
      leaveOffered(ch) && 'sep',
      leaveOffered(ch) && { label: 'Leave channel', icon: 'doorOpen', danger: true, onSelect: () => leaveChannelFlow(ch) },
    ];
    openMenu(anchor, items, { align: 'end', label: 'Conversation menu' });
  }

  function intro() {
    const ch = channel();
    const d = dm();
    if (ch) {
      const creator = store.member(ch.createdBy);
      const about = ch.description || ch.topic || `${creator.name} created this channel on ${new Date(ch.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}.${ch.private ? ' It is private: only invited people can see it.' : ''}`;
      const sharedNote = ch.shared ? `${/[.!?]$/.test(about) ? '' : '.'} It is hosted by ${ch.shared.host || 'another workspace'} and shared with ${store.ws?.name || 'your workspace'}.` : '';
      return el('div.conv-intro', {},
        el('div.conv-intro-icon', { html: icon(channelIcon(ch), 26, 2) }),
        el('h2', {}, `This is the very beginning of #${ch.name}`),
        // The description is the channel's own words, in their own direction.
        el('p', { dir: 'auto' }, about + sharedNote),
        el('div.row', {},
          el('button.btn.btn-sm.btn-outline', { type: 'button', html: icon('info', 15), onclick: onOpenDetails }, ' Details'),
          // A fresh channel wants people in it (the first hint card);
          // shared entries and archives manage membership elsewhere. For
          // someone in the channel: an admin (or the channel's creator) may
          // curate it from outside, but the worker refuses an add from
          // anyone not in it ("Join the channel to add people to it").
          !ch.shared && !ch.archived && store.canCurate(convId) && store.isJoined(convId)
            && el('button.btn.btn-sm.btn-outline', { type: 'button', html: icon('userPlus', 15), onclick: () => addPeopleToChannelDialog(ch) }, ' Add people'),
          !ch.description && store.canCurate(convId) && el('button.btn.btn-sm.btn-outline', { type: 'button', html: icon('pencil', 15), onclick: () => editChannelDialog(ch) }, ' Add a description')));
    }
    if (d) {
      const others = d.members.filter((u) => u !== store.uuid).map((u) => store.member(u));
      if (!others.length) {
        return el('div.conv-intro', {}, el('div.conv-intro-icon', { html: icon('messageText', 26, 2) }),
          el('h2', {}, 'This is your space'), el('p', {}, 'Draft messages, keep notes, or park links here. Nobody else can see this conversation.'));
      }
      return el('div.conv-intro', {},
        el('div.row', { style: { gap: '6px', marginBottom: '12px' } }, ...others.map((m) => avatar(m, { size: 'lg' }))),
        el('h2', {}, others.length === 1 ? others[0].name : others.map((m) => m.name).join(', ')),
        el('p', {}, others.length === 1
          ? `${others[0].title ? `${others[0].title}. ` : ''}This conversation is just between the two of you.`
          : `A group conversation with ${others.length} other people.`));
    }
    return null;
  }

  let footEl = null; // what stands under the list: the message box, or the note in its place (see renderFoot)

  /**
   * Build the body afresh: the files view, the page for a conversation that
   * cannot be opened, a shared channel's gate, or the message list with the
   * foot under it. `fresh` when the reader asked for it (opening the
   * conversation, switching tabs), and the box then takes the keyboard as
   * it always has; not when a change elsewhere brought it, since the reader
   * may be typing somewhere else (see renderFoot), unless the keyboard was
   * in the body that goes, or on nothing at all (a shared channel's Join
   * gives way to a gate with nothing to hold it while the host answers).
   */
  function renderBody({ fresh = true } = {}) {
    const had = !fresh && (body.contains(document.activeElement) || document.activeElement === document.body);
    if (fresh) landTouch();
    list?.destroy();
    list = null;
    composer?.destroy();
    composer = null;
    typing?.destroy();
    typing = null;
    files?.destroy();
    files = null;
    footEl = null;
    lastFrame = frameState();
    body.replaceChildren();
    // A page in the messages' place (below) takes the keyboard that was in
    // the body that went, or on nothing: its first control (Back to
    // channels, Delete channel, Try again, Leave channel, Join), or, with
    // nothing to press (the wait for a shared channel's host), the page
    // itself, so the box that follows takes it from there. It used to fall
    // to the page body with the box that went, where the next Tab started
    // over from the top of the window; the list's own rule is renderFoot's.
    const settle = (page) => {
      body.append(page);
      if (!had) return;
      const control = page.querySelector('button, a[href]');
      if (control) control.focus({ preventScroll: true });
      else {
        page.setAttribute('tabindex', '-1');
        page.focus({ preventScroll: true });
      }
    };
    if (tab === 'files' && store.canAccess(convId)) {
      files = createFilesView(convId);
      body.append(files.el);
      return;
    }
    if (!store.canAccess(convId)) {
      const ch = channel();
      if (ch?.orphan) {
        // Listed to the admin so that it can be deleted, and for nothing
        // else (an old link led here): said so, with the one action there is.
        settle(el('div.empty', { style: { flex: 1, justifyContent: 'center' } },
          el('div.empty-icon', { html: icon('lock', 24) }),
          el('h3', {}, `Nobody is left in #${ch.name}`),
          el('p', {}, `Its last member left the workspace, so nobody can open it or post in it.${store.isAdmin() ? ' As an admin you can delete it, messages and files included.' : ''}`),
          el('div.row.mt', { style: { justifyContent: 'center', gap: '10px' } },
            store.isAdmin() && el('button.btn.btn-danger', {
              type: 'button',
              // One press at a time, busy rather than disabled: a disabled
              // button under the keyboard hands its focus to the page body,
              // and a Cancel in the question that follows left the keyboard
              // on nothing.
              onclick: async (e) => {
                const btn = e.currentTarget;
                if (btn.getAttribute('aria-busy') === 'true') return;
                btn.setAttribute('aria-busy', 'true');
                try {
                  const gone = await deleteOrphanChannelFlow(ch);
                  if (gone) navigate({ ws: store.wsId }, { replace: true });
                } finally {
                  btn.removeAttribute('aria-busy');
                }
              },
            }, 'Delete channel'),
            el('button.btn', { type: 'button', onclick: () => navigate({ ws: store.wsId }) }, 'Back to channels'))));
        return;
      }
      settle(el('div.empty', { style: { flex: 1, justifyContent: 'center' } },
        el('div.empty-icon', { html: icon('lock', 24) }),
        el('h3', {}, 'Conversation not found'),
        el('p', {}, 'It may be private, deleted, or in another workspace.'),
        el('button.btn.mt', { type: 'button', onclick: () => navigate({ ws: store.wsId }) }, 'Back to channels')));
      return;
    }
    // A channel hosted elsewhere has nothing to show until the member is in
    // it there and the host has answered; the gate says which it is.
    const shared = sharedGateReason();
    if (shared) {
      settle(sharedGate(channel(), shared));
      return;
    }
    list = createMessageList({
      convId,
      focusSeq,
      renderIntro: intro,
      onOpenThread,
      onShowMember: showMemberCard,
    });
    focusSeq = null; // only the first list opens on the linked message
    body.append(list.el);
    // "Ana is typing" sits under the composer, in its bottom margin:
    // above it, the line's reserved height read as padding
    // and cut the last message off short of the box.
    typing = createTypingLine(convId);
    body.append(typing.el);
    renderFoot({ fresh: fresh || had });
  }

  /**
   * Where the keyboard lands on a touch screen once the reader has asked for
   * this conversation (see renderBody). Elsewhere the message box takes it
   * (see the composer's autofocus), but not under a finger, where it would
   * raise the phone's keyboard, so on a phone it landed nowhere: the sidebar
   * row that was tapped is hidden with the sidebar the moment the
   * conversation shows, the browser drops the focus from a control no longer
   * drawn to the page body, and a screen reader's next step started from the
   * top of the window. The column's first control that is not a text box
   * takes it (Back to the conversations, the way out: the shell's own rule
   * for a view taking the column), or the column itself while it has none.
   * Only when the keyboard is on nothing, or on something no longer drawn:
   * a control still on screen (a tablet's sidebar row beside the column, a
   * tab of this column) keeps it. After the column is on the page: the view
   * is built before the shell shows it.
   */
  function landTouch() {
    if (!coarsePointer()) return;
    setTimeout(() => {
      if (destroyed || !root.isConnected) return;
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected && active.getClientRects().length > 0) return;
      const control = focusables(root).find((n) => !/^(input|textarea)$/.test(n.localName));
      if (control) control.focus({ preventScroll: true });
      else {
        root.setAttribute('tabindex', '-1');
        root.focus({ preventScroll: true });
      }
    }, 0);
  }

  /**
   * The message box, or the note standing where it would, under the list.
   * Redrawn on its own when only it is concerned (a posting or thread rule
   * changed, the channel archived or unarchived, the member joined it or
   * changed role, a move of the workspace begun or done): the list used to
   * be built again with it, so a reader scrolled up in the history was
   * thrown back to the bottom, and the new box took the keyboard from
   * wherever it was, the thread's reply box or the search box included.
   * The list stands now, and the keyboard moves only when it was in the old
   * foot: into the new box, caret and all, or, when a note takes the box's
   * place, onto the newest message rather than the page body. `fresh` when
   * the reader asked for the body (see renderBody): the box takes the
   * keyboard as it always did.
   */
  function renderFoot({ fresh = false } = {}) {
    const active = document.activeElement;
    const inFoot = !fresh && !!footEl && footEl.contains(active);
    // A keyboard on nothing at all is nobody's, and a box that appears
    // takes it, as the box does when the conversation is opened: Join in
    // the preview bar disables itself while the worker answers, which drops
    // the keyboard to the page body, and the box that follows the join used
    // to pick it up there. Never from a control elsewhere (a reply being
    // typed in the thread, the search box), and not on a touch screen,
    // where a box taking the keyboard raises it over the page (the box's
    // own rule for autofocus).
    const idle = !fresh && active === document.body;
    const caret = inFoot && composer && active === composer.textarea && typeof active.selectionStart === 'number'
      ? { start: active.selectionStart, end: active.selectionEnd } : null;
    // A control of the old foot under the keyboard (Join in the preview bar),
    // found again in the new foot by its name when it has one.
    const labelOf = (n) => n.getAttribute('aria-label') || n.textContent;
    const held = inFoot && active instanceof HTMLElement && active !== composer?.textarea ? labelOf(active) : null;
    composer?.destroy();
    composer = null;
    const old = footEl;
    const foot = (node) => {
      if (old?.isConnected) old.replaceWith(node);
      else list.el.after(node); // under the list, above the typing line
      footEl = node;
      if (!inFoot) return;
      if (composer) {
        composer.textarea.focus({ preventScroll: true });
        if (caret) composer.textarea.setSelectionRange(caret.start, caret.end);
        return;
      }
      const same = held && [...node.querySelectorAll('button, a[href]')].find((n) => labelOf(n) === held);
      (same || [...list.el.querySelectorAll('.msg')].pop())?.focus({ preventScroll: true });
    };
    const ch = channel();
    if (ch && ch.archived) {
      foot(el('div.composer-wrap', {}, el('div.composer-blocked', { html: icon('archive', 16) },
        el('span', {}, 'This channel is archived. Nobody can post here.'))));
      return;
    }
    if (store.ws?.movedTo) {
      foot(el('div.composer-wrap', {}, el('div.composer-blocked', { html: icon('refresh', 16) },
        el('span', {}, 'Read-only: this workspace moved. '), el('a', { href: `#/ws/${encodeURIComponent(store.ws.movedTo)}` }, 'Continue there'))));
      return;
    }
    if (store.ws?.importing) {
      foot(el('div.composer-wrap', {}, el('div.composer-blocked', { html: icon('download', 16) },
        el('span', {}, 'Read-only while this workspace is being imported. Posting opens when it is done.'))));
      return;
    }
    // The workspace this conversation lives on is being moved to another
    // server (postAccess says so for as long as its worker takes no writes):
    // the words of the strip at the top, in the box's place.
    if (store.postAccess(convId).reason === 'transferring') {
      foot(el('div.composer-wrap', {}, el('div.composer-blocked', { html: icon('refresh', 16) },
        el('span', {}, 'This workspace is being moved to another server. You can read, but nothing can be posted for a few minutes.'))));
      return;
    }
    // A direct message on the host of a shared channel, after that host
    // moved: the copy it lives on is read-only, and the copy at the new
    // address does not know this workspace's people, so there is nowhere to
    // continue. (A shared channel of that host is behind its gate by now.)
    const hostLink = store.hostOf(convId).link;
    if (hostLink?.ws?.movedTo) {
      foot(el('div.composer-wrap', {}, el('div.composer-blocked', { html: icon('refresh', 16) },
        el('span', {}, `Read-only: ${hostLink.ws.name || 'the workspace this conversation is on'} moved to a new address. What you wrote each other stays.`))));
      return;
    }
    // A direct message with people who have all since left the workspace
    // (someone removed, or from a connected workspace that was disconnected)
    // is read, not written into: nothing posted here would reach them, and
    // the worker would keep it all the same.
    const away = departed();
    if (away.length) {
      const people = away.map((u) => store.member(u));
      const names = people.map((m) => m.name);
      const list = names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
      const org = people.length === 1 && people[0].org?.name;
      foot(el('div.composer-wrap', {}, el('div.composer-blocked.read-only', {},
        el('span', { html: icon('doorOpen', 18, 2), style: { color: 'var(--ink-3)' } }),
        el('span.read-only-text', {},
          el('strong', {}, `${list} ${people.length === 1 ? 'is' : 'are'} no longer in ${store.ws?.name || 'this workspace'}`),
          el('span', {}, org
            ? `${org} is no longer connected to this workspace, or they left the channel shared with it. Messages sent here would not reach them; what you wrote each other stays.`
            : `Messages sent here would not reach ${people.length === 1 ? 'them' : 'anyone'}; what you wrote each other stays.`)))));
      return;
    }
    const access = store.postAccess(convId);
    if (ch && access.reason === 'read_only') {
      // Not an apology: the channel is meant to be read, and there are still
      // two ways to take part.
      const threads = store.postAccess(convId, { thread: true });
      foot(el('div.composer-wrap', {}, el('div.composer-blocked.read-only', {},
        el('span', { html: icon('megaphone', 18, 2), style: { color: 'var(--ink-3)' } }),
        el('span.read-only-text', {},
          el('strong', {}, `Only admins can post in #${ch.name}`),
          el('span', {}, threads.ok ? 'You can react to messages and reply in threads.'
            : threads.reason === 'threads_admins' ? 'You can react to messages; thread replies are for admins too.'
              : 'You can react to messages.')))));
      return;
    }
    if (ch && !store.isJoined(convId)) {
      const joinBtn = joinButton(`Join #${ch.name}`, 'btn.btn-primary', async () => {
        try {
          await store.joinChannel(convId);
          toast(`Joined #${ch.name}`);
        } catch (e) {
          joinFailed(ch, e);
        }
      });
      foot(el('div.composer-wrap', {}, el('div.composer-blocked', {},
        el('span', {}, 'You are previewing this channel.'), joinBtn)));
      return;
    }
    composer = createComposer({
      // One's own space is not messaged: what is typed there is kept.
      placeholder: ch ? `Message #${ch.name}` : dm()?.members.every((u) => u === store.uuid) ? 'Jot something down' : `Message ${store.convTitle(convId)}`,
      autofocus: fresh || idle,
      draftKey: `${store.wsId}:${convId}`,
      convId,
      typingConv: convId,
      beforeSend: (text) => confirmBroadcast(convId, text),
      onSend: (text, attachments, files = []) => store.send(convId, { text, attachments, files }),
      onSendLater: async (text, attachments, dueAt) => {
        if (!(await confirmBroadcast(convId, text))) throw Object.assign(new Error('Not scheduled'), { code: 'cancelled' });
        return store.schedule(convId, { text, attachments, dueAt });
      },
      // The keyboard comes back to this box when the edit closes (see
      // startInlineEdit's `back`).
      onEditLast: () => {
        const m = list.lastOwnMessage();
        return !!m && list.editMessage(m, { back: composer.textarea });
      },
    });
    renderNotes();
    foot(composer.el);
  }

  /**
   * The people a direct message is with, when every one of them has left
   * the workspace: those the workspace remembers by name as having left
   * (`former`), so that someone merely hidden from view (a guest's
   * conversation partner they share no channel with any more) is not
   * mistaken for gone. Empty while anyone is still here.
   */
  function departed() {
    const d = dm();
    if (!d) return [];
    const others = d.members.filter((u) => u !== store.uuid);
    const gone = others.filter((u) => !!store.ws?.former?.[u]);
    return others.length && gone.length === others.length ? gone : [];
  }

  /** Why the gate stands in for a shared channel's messages just now (see sharedGate), or null when they show. */
  function sharedGateReason() {
    const ch = channel();
    if (!ch?.shared) return null;
    const reason = store.postAccess(convId).reason;
    return ['not_joined', 'shared_loading', 'shared_unreachable', 'shared_refused', 'shared_lost'].includes(reason) ? reason : null;
  }

  /**
   * What stands in for the messages of a shared channel the member cannot
   * read yet: an invitation to join it (as with any public channel, but
   * saying where it lives), a wait while the host answers, a host that
   * could not be reached or that would not take the member in (both tried
   * again on their own, or on request), or the news that the connection has
   * ended, with the way to tidy up for admins.
   */
  function sharedGate(ch, reason) {
    const host = ch.shared?.host || 'another workspace';
    const wrap = el('div.empty', { style: { flex: 1, justifyContent: 'center' } }, el('div.empty-icon', { html: icon('shared', 24) }));
    if (reason === 'shared_loading') {
      wrap.append(el('h3', {}, `Connecting to ${host}`), el('p', {}, 'This channel is hosted there; its messages are on their way.'),
        el('div.skeleton', { style: { height: '12px', width: '180px', marginTop: '8px' } }));
    } else if (reason === 'shared_unreachable' || reason === 'shared_refused') {
      // Out of reach and refusing are told apart: a host that does not
      // answer is a matter of waiting; a refusal came with a reason, and
      // that is what to act on (or wait out, since the app keeps asking).
      // The refusal may be either worker's (this workspace would not vouch
      // for a guest; the host would not take an attestation), so the words
      // blame neither.
      const why = store.hostOf(convId).link?.error?.message;
      const retry = el('button.btn.mt', { type: 'button' }, 'Try again');
      retry.addEventListener('click', pressOnce(retry, () => store.retryLink(convId).catch(() => {})));
      wrap.append(
        reason === 'shared_refused'
          ? el('h3', {}, `You are not in this channel on ${host} just now`)
          : el('h3', {}, `${host} cannot be reached right now`),
        reason === 'shared_refused'
          ? el('p', {}, `This channel is hosted there, and getting in takes ${store.ws?.name || 'your workspace'}'s word for you, which did not go through this time. Nothing is lost: the app asks again on its own, and the channel opens as soon as it does.`)
          : el('p', {}, 'This channel is hosted there. Nothing is lost; the app keeps trying, and the channel opens as soon as it answers.'),
        why && el('p.small.muted', {}, why),
        retry);
    } else if (reason === 'shared_lost' && ch.lost?.code === 'removed') {
      // The connection stands for everyone else: this is personal, and the
      // only tidying up is taking the channel out of one's own sidebar.
      wrap.append(el('h3', {}, `An admin of ${host} removed you from this channel`),
        el('p', {}, 'What was said there stays with them, and the channel has nothing more to show you unless they let you back in.'),
        el('button.btn.mt', { type: 'button', onclick: () => leaveChannelFlow(ch) }, 'Leave channel'));
    } else if (reason === 'shared_lost') {
      if (ch.lost?.code === 'moved') {
        // The host was transferred: the copy this entry points at is read-only
        // for good, and the copy at its new address starts unshared.
        wrap.append(el('h3', {}, `${host} moved to a new address`),
          el('p', {}, `The channel is not shared from its new home yet; the admins of ${host} can share it again from there, with a new link. What was said here stays with them.`));
      } else {
        wrap.append(el('h3', {}, 'This channel is no longer shared with your workspace'),
          el('p', {}, `${host} ended the connection, or removed the channel. What was said there stays with them.`));
      }
      // Admins take the entry out of the workspace (out of everyone's
      // sidebar here, so it is asked about first, and the button waits while
      // the host and this workspace are told); anyone else can at least take
      // it out of their own sidebar.
      if (!store.isAdmin()) {
        wrap.append(el('button.btn.mt', { type: 'button', onclick: () => leaveChannelFlow(ch) }, 'Leave channel'));
      } else {
        const remove = el('button.btn.mt', { type: 'button' }, 'Remove it from this workspace');
        remove.addEventListener('click', pressOnce(remove, async () => {
          const ok = await confirmDialog({
            title: `Remove #${ch.name} from ${store.ws?.name || 'this workspace'}?`,
            message: `${host} keeps the channel and everything said in it; the entry leaves everyone's sidebar here. Their admin can share it again later.`,
            confirmLabel: 'Remove',
          });
          if (!ok) return;
          try {
            await store.disconnectShared(convId);
            toast('Shared channel removed');
            navigate({ ws: store.wsId });
          } catch (e) {
            toast(e.message, { icon: 'alert' });
          }
        }));
        wrap.append(remove);
      }
    } else {
      const join = joinButton(`Join #${ch.name}`, 'btn.btn-primary.mt', async () => {
        try {
          await store.joinChannel(convId);
          toast(`Joined #${ch.name}`);
        } catch (e) {
          // Joined here with the host out of reach, or refused (see joinFailed).
          joinFailed(ch, e);
        }
      });
      wrap.append(el('h3', {}, `#${ch.name} is shared with ${store.ws?.name || 'your workspace'} by ${host}`),
        el('p', {}, ch.topic ? `${ch.topic}. ` : '', 'Join to read the conversation and take part. People there see what you post, labelled with your workspace.'),
        join);
    }
    return wrap;
  }

  /**
   * The quiet notes above the composer: the other person has notifications
   * paused, or an admins-only channel and how many people a post reaches.
   * Redrawn on their own when they change, so the list and the composer
   * (scroll position, focus, an edit in progress) stay where they are.
   */
  function renderNotes() {
    if (!composer) return;
    for (const n of composer.el.querySelectorAll(':scope > .composer-note')) n.remove();
    const ch = channel();
    const notes = [];
    const dmOther = dm()?.members.filter((u) => u !== store.uuid);
    if (dmOther && dmOther.length === 1 && store.presenceOf(dmOther[0]) === 'dnd') {
      // A quiet hint, not a block: they will see it when they are back.
      notes.push(el('div.composer-note', { html: icon('bellOff', 14, 2) },
        el('span', {}, `${store.member(dmOther[0]).name} has notifications paused. Your message will wait for them.`)));
    }
    if (ch && ch.postPolicy === 'admins') {
      // Admins keep the composer and a reminder of how far a message travels.
      const n = ch.count || 0;
      notes.push(el('div.composer-note', { html: icon('megaphone', 14, 2) },
        el('span', {}, `Only admins post here. Your message reaches ${n} ${n === 1 ? 'person' : 'people'}.`)));
    }
    composer.el.prepend(...notes);
  }

  /** Everything the body's shape depends on, so it re-renders only when one changes. */
  const bodyState = () => {
    const ch = channel();
    return JSON.stringify([store.isJoined(convId), !!ch?.archived, ch?.postPolicy || 'members', ch?.threadPolicy || 'everyone',
      store.isAdminIn(convId), store.canAccess(convId), store.ws?.movedTo || null, !!store.ws?.importing, store.isTransferring(convId), ch?.shared ? store.postAccess(convId).reason : null, !!ch?.lost, departed().join(',')]);
  };
  /** What only the notes depend on. */
  const noteState = () => {
    const ch = channel();
    const others = dm()?.members.filter((u) => u !== store.uuid) || [];
    return JSON.stringify([ch?.postPolicy === 'admins' ? ch?.count : 0, others.length === 1 ? store.presenceOf(others[0]) === 'dnd' : false]);
  };
  /**
   * What the body's frame is built for (see renderBody): which tab, whether
   * the conversation can be opened at all and what its page offers when it
   * cannot, a shared channel's gate. The rest of the body's state is the
   * foot's alone (see renderFoot).
   */
  // Whether the reader is an admin matters to the frame only on the page for
  // a private channel nobody is left in (its Delete): counted for every
  // frame, a change of role rebuilt the list of messages too.
  const frameState = () => JSON.stringify([tab, store.canAccess(convId), !!channel()?.orphan, channel()?.orphan ? store.isAdmin() : null, sharedGateReason()]);
  let lastFrame = frameState();
  let lastBodyState = bodyState();
  let lastNoteState = noteState();
  /** Rebuild the body for a structural change (the foot alone while the frame stands); refresh the notes alone for the rest. */
  function syncBody() {
    const next = bodyState();
    const notes = noteState();
    if (next !== lastBodyState) {
      lastBodyState = next;
      lastNoteState = notes;
      if (frameState() !== lastFrame) renderBody({ fresh: false });
      else if (list) renderFoot();
    } else if (notes !== lastNoteState) {
      lastNoteState = notes;
      renderNotes();
    }
  }
  // Whether the bookmark bar offers its pencil depends on membership and
  // archiving too, so joining or leaving redraws it like a bookmark change.
  const stripsState = () => JSON.stringify([channel()?.bookmarks || null, channel()?.guests || 0, store.ws?.movedTo, !!store.ws?.importing, store.ws?.transferTo, store.isJoined(convId), store.canCurate(convId), !!channel()?.archived,
    channel()?.connections || null, channel()?.shared?.host || null, channel()?.count || 0, !!channel()?.lost, sharedGateReason()]);
  let bookmarksState = stripsState();
  const offWorkspace = store.on('workspace', () => {
    if (destroyed) return;
    renderHeader();
    renderTabs();
    const bm = stripsState();
    if (bm !== bookmarksState) {
      bookmarksState = bm;
      renderStrips();
    }
    syncBody();
  });
  const offActivity = store.on('activity', () => {
    if (destroyed || !dm()) return;
    renderHeader();
    syncBody();
  });

  const offProfile = store.on('profile', () => { if (!destroyed) renderHeader(); });
  // The headphones show who is in the huddle and whether the user is: redrawn as that moves.
  let huddleState = '';
  const offHuddle = store.on('huddle', () => {
    if (destroyed) return;
    const next = JSON.stringify([store.huddleMembers(convId), store.inHuddle(convId)]);
    if (next === huddleState) return;
    huddleState = next;
    renderHeader();
  });
  let faces = '';
  const offMessages = store.on('messages', (ev) => {
    if (destroyed || ev.conv !== convId || !channel()) return;
    const next = store.conv(convId).messages.slice(-12).map((m) => m.user).join(',');
    if (next !== faces) {
      faces = next;
      renderHeader();
    }
  });

  // Files dragged over any part of the conversation (its messages, the
  // widest target there is, its header) are the message box's, as they are
  // dragged over the box itself: the box lights up as they pass and takes
  // them where they are let go. The page-wide guard (see main.js) kept such
  // a drop from opening the file in the app's place, and left it at that,
  // so a file let go over the messages did nothing, without a word. A drop
  // into the box itself is the box's own (it says so by handling it first).
  // Nothing where there is no box (a channel previewed, an archived one):
  // the drop stays inert there.
  const overFiles = (e) => !!composer && !e.defaultPrevented && !!e.dataTransfer?.types?.includes('Files') && !composer.el.contains(e.target);
  root.addEventListener('dragover', (e) => {
    if (!overFiles(e)) return;
    e.preventDefault();
    composer.hintDrop(true);
  });
  root.addEventListener('dragleave', (e) => {
    // Left the column (not moved between two of its parts): the box goes dark.
    if (composer && !(e.relatedTarget instanceof Node && root.contains(e.relatedTarget))) composer.hintDrop(false);
  });
  root.addEventListener('drop', (e) => {
    if (!overFiles(e)) return;
    composer.dropFiles(e);
  });

  renderHeader();
  renderTabs();
  renderStrips();
  renderBody();

  return {
    el: root,
    renderHeader,
    tab: () => tab,
    setTab,
    focusComposer: () => composer?.focus(),
    highlight: (seq) => list?.highlight(seq),
    jumpTo: (seq) => list?.jumpTo(seq),
    destroy() {
      destroyed = true;
      offWorkspace();
      offActivity();
      offProfile();
      offMessages();
      offHuddle();
      list?.destroy();
      composer?.destroy();
      typing?.destroy();
      pinBar?.destroy();
      huddleBar?.destroy();
      files?.destroy();
    },
  };
}
