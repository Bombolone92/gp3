/**
 * Conversation details as a dialog with tabs, opened from the channel
 * name: About (what it is, topic, pins, bookmarks, and the way
 * out), Members (searchable, with adding), and Settings (name, posting
 * rules, archive, delete, for those allowed). Direct messages get About and
 * Members. The dialog follows the store while open and closes itself when
 * the conversation disappears.
 */
import { el, fieldId, rerenderTabs, keepFocus, focusMemo, composing, pressOnce } from './dom.js';
import { icon, channelIcon, isSharedChannel } from './icons.js';
import { avatar, statusChip, rolePill } from './avatar.js';
import { toast } from './toast.js';
import { openModal, confirmDialog } from './modal.js';
import { openMenu } from './menu.js';
import { store } from '../lib/store.js';
import { safeHref, graphemes } from '../lib/format.js';
import { downloadAttachment } from '../lib/files.js';
import { joinHuddleFlow } from './huddle.js';
import { api } from '../lib/api.js';
import { navigate, buildHash } from '../lib/router.js';
import { editChannelDialog, addChannelMembersDialog, showMemberCard, guestInviteDialog, leaveChannelFlow, leaveOffered, joinFailed, shareChannelDialog, textDialog } from './dialogs.js';
import { notifyMenuItems, notifySummary } from './notifymenu.js';
import { renderPinList, pinsMoved } from './pins.js';
import { bookmarksDialog } from './bookmarks.js';
import { organizationsOf, sharedSummary, sharedPillText } from './shared.js';
import { cleanChannelName } from '../shared/limits.js';
import { normalize } from '../shared/search.js';
import { fileLabelShort } from './filename.js';
import { copyToClipboard } from './clipboard.js';

export function openDetailsDialog(convId, { onClose } = {}) {
  const channel = () => store.channel(convId);
  const dm = () => store.me?.dms?.[convId];
  const isChannel = !!channel();
  let tab = 'about';
  let destroyed = false;
  let members = null; // uuids, once loaded
  let membersRead = 0; // reads of the list asked for: only the newest one's answer is kept (see renderMembers)
  let membersQuery = ''; // what is typed in the member filter, kept across redraws
  /**
   * What the roster read depends on: who is in the conversation (the count,
   * a private channel's list, the guests, the connected workspaces, whether
   * the reader is in it, who is in the workspace at all). Not a topic, a
   * star, a notification level or a pin: those redraw the tab too, and the
   * roster was read from the worker again for each of them.
   */
  const membersKey = () => {
    const ch = channel();
    if (!ch) return JSON.stringify(dm()?.members || null);
    return JSON.stringify([ch.count || 0, (ch.members || []).join(','), ch.guests || 0, ch.connections || null, store.isJoined(convId), Object.keys(store.ws?.members || {}).length]);
  };
  let membersSig = membersKey();
  let shownPins = null; // the pins the About tab's list was last drawn from (see pinsMoved)
  let pinsStale = false; // a pinned message was edited under it: the next read goes to the worker

  const title = () => (isChannel ? channel()?.name : store.convTitle(convId));

  /* ---- chrome: name, quick actions, tabs ------------------------------- */

  const head = el('div.details-head');
  const tabsEl = el('div.details-tabs', { role: 'tablist', 'aria-label': 'Details' });
  const body = el('div.details-body');
  const content = el('div.details-dialog', {}, head, tabsEl, body);

  function tabList() {
    const list = [['about', 'About'], ['members', isChannel ? `Members` : 'People']];
    const ch = channel();
    // A channel hosted elsewhere has settings of its own here (its name in
    // this workspace, the connection) for this workspace's admins.
    if (ch && (store.isAdmin() || (!ch.shared && ch.createdBy === store.uuid))) list.push(['settings', 'Settings']);
    return list;
  }

  function renderHead() {
    const ch = channel();
    const joined = ch ? store.isJoined(convId) : !!dm();
    const starred = store.isStarred(convId);
    // The head is redrawn by the very presses made in it (the star, a
    // notification level), and each takes the focused button off the page:
    // the button is found again by its own class name stem, its label and
    // state having changed with the press (as the conversation header does).
    const active = document.activeElement;
    const stem = (n) => (n instanceof HTMLElement && n.className.match(/\bdetails-(star|notify)\b/) || [])[0] || null;
    const held = head.contains(active) ? stem(active) : null;
    // The star and the bell are for a conversation the reader is in. Not
    // handed to the DOM as a falsy value when they are not (a channel
    // previewed before joining): unlike el(), which drops one, the DOM's
    // own replaceChildren writes it out as text, and the head read
    // "designfalse" beside the name.
    const quick = joined ? el('div.details-quick', {},
      el('button.btn.btn-sm.btn-outline.details-star', {
        type: 'button', html: icon('star', 15, 2.2), 'aria-pressed': String(starred),
        className: `btn btn-sm btn-outline details-star${starred ? ' on' : ''}`,
        onclick: () => store.toggleStar(convId).then(renderHead).catch((e) => toast(e.message, { icon: 'alert' })),
      }, ` ${starred ? 'Starred' : 'Star'}`),
      el('button.btn.btn-sm.btn-outline.details-notify', {
        type: 'button', html: icon(store.isMuted(convId) ? 'bellOff' : 'bell', 15, 2.2), 'aria-haspopup': 'menu',
        onclick: (e) => openMenu(e.currentTarget, notifyMenuItems(convId, { onChange: renderHead }), { label: 'Notifications' }),
      }, ` ${notifySummary(convId)}`, el('span', { html: icon('chevDown', 14, 2.4) }))) : null;
    head.replaceChildren(
      el('div.details-name', {},
        ch && el('span', { html: icon(channelIcon(ch), 20, 2.2), style: { color: 'var(--ink-3)' } }),
        el('h3', { dir: 'auto' }, title() || 'Conversation'),
        ch?.archived && el('span.pill', {}, 'Archived'),
        ch && isSharedChannel(ch) && el('span.pill.pill-org', { title: sharedSummary(ch) }, el('span', { html: icon('building', 11, 2.2), 'aria-hidden': 'true' }), sharedPillText(ch))),
      ...(quick ? [quick] : []));
    if (held) head.querySelector(`.${held}`)?.focus({ preventScroll: true });
  }

  function renderTabs() {
    const list = tabList();
    if (!list.some(([k]) => k === tab)) tab = 'about';
    rerenderTabs(tabsEl, ...list.map(([key, label]) => el('button.details-tab', {
      type: 'button', role: 'tab', 'aria-selected': String(tab === key), tabindex: tab === key ? 0 : -1,
      onclick: () => { tab = key; renderTabs(); renderBody(); },
    }, label, key === 'members' && (channel()?.count || dm()?.members.length) ? el('span.details-tab-n', {}, String(channel()?.count || dm()?.members.length)) : null)));
  }
  // Left and Right step through the tabs, round at the ends; Home and End
  // go to the first and the last. A modified arrow is a shortcut's, and one
  // during an IME composition is the IME's.
  tabsEl.addEventListener('keydown', (e) => {
    if (e.altKey || e.metaKey || e.ctrlKey || composing(e)) return;
    const list = tabList().map(([k]) => k);
    const i = list.indexOf(tab);
    let next;
    if (e.key === 'ArrowRight') next = list[(i + 1) % list.length];
    else if (e.key === 'ArrowLeft') next = list[(i + list.length - 1) % list.length];
    else if (e.key === 'Home') next = list[0];
    else if (e.key === 'End') next = list[list.length - 1];
    else return;
    e.preventDefault();
    if (next !== tab) {
      tab = next;
      renderTabs();
      renderBody();
    }
    tabsEl.querySelector('[aria-selected="true"]')?.focus();
  });

  /* ---- rows ----------------------------------------------------------- */

  function row({ icon: ic, label, sub, onClick, danger, disabled, action }) {
    // One press at a time: a row's action asks first and then waits on the
    // worker (Join, Archive, Delete, Leave, Disconnect, the huddle), and the
    // row stayed live meanwhile, so a second press put the same question up
    // again and its answer went to the worker a second time ("Channel not
    // found" after "Channel deleted"). Busy, not disabled, so a keyboard's
    // focus stays on the row through the wait.
    let busy = false;
    const press = onClick && (async () => {
      if (busy) return;
      busy = true;
      node.setAttribute('aria-busy', 'true');
      try {
        await onClick();
      } finally {
        busy = false;
        node.removeAttribute('aria-busy');
      }
    });
    const node = el(`${onClick ? 'button' : 'div'}.details-row${danger ? '.danger' : ''}${onClick ? '' : '.static'}`, {
      type: onClick ? 'button' : null, onclick: press, disabled: disabled || null,
    },
    ic && el('span', { html: icon(ic, 18) }),
    // The line under a label is often the channel's own words (its topic,
    // its description, a bookmark's name): laid out in their own direction.
    el('span.details-text', {}, el('strong', {}, label), sub && el('span', { dir: 'auto' }, sub)),
    onClick && !danger && el('span.details-edit', {}, action || 'Edit'));
    return node;
  }

  function copyLink() {
    const url = `${location.origin}${location.pathname}${buildHash({ ws: store.wsId, conv: convId })}`;
    copyToClipboard(url).then(() => toast('Link copied')).catch(() => toast('Could not copy', { icon: 'alert' }));
  }

  function memberRow(uuid) {
    const m = store.member(uuid);
    // In a channel hosted elsewhere, this workspace's roles mean nothing:
    // its owner is one more person from here. Only guests and people from
    // other workspaces wear a label.
    const local = channel()?.shared && (m.role === 'owner' || m.role === 'admin');
    const btn = el('button.member-row', { type: 'button', onclick: () => showMemberCard(uuid, btn) },
      avatar(m, { size: 'sm', state: store.presenceOf(uuid) }),
      el('span.pick-text', {}, el('strong.name-line', {}, el('span.name-text', { dir: 'auto' }, m.name, uuid === store.uuid ? ' (you)' : ''), statusChip(uuid, { compact: true })), el('span', {}, m.title || `@${m.username}`)),
      local ? null : rolePill(uuid));
    return btn;
  }

  /* ---- About ------------------------------------------------------------ */

  function renderAbout() {
    const details = el('div.details');
    const ch = channel();
    // Used by the About card and by the Bookmarks section further down.
    const canEdit = ch ? store.canCurate(ch.id) : false;
    if (ch) {
      const creator = store.member(ch.createdBy);
      const canRename = ch.shared ? store.isAdmin() && !ch.lost : canEdit && (store.isAdmin() || !ch.def);
      const host = ch.shared?.host || 'another workspace';
      details.append(el('section', {}, el('div.details-card', {},
        row({ label: 'Channel name', sub: ch.shared ? `#${ch.name} · only in ${store.ws?.name || 'this workspace'}; ${host} calls it #${ch.hostName || ch.name}` : `#${ch.name}`, onClick: canRename ? () => (ch.shared ? renameShared(ch) : editChannelDialog(ch)) : null }),
        row({ label: 'Topic', sub: ch.topic || (ch.shared ? 'No topic' : 'Add a topic'), onClick: canEdit ? () => editChannelDialog(ch) : null }),
        row({ label: 'Description', sub: ch.description || (ch.shared ? 'No description' : 'Add a description'), onClick: canEdit ? () => editChannelDialog(ch) : null }),
        row({ label: 'Visibility', sub: ch.shared ? `Shared: hosted by ${host} (${ch.hostPrivate ? 'private' : 'public'} there); anyone in ${store.ws?.name || 'this workspace'} can join it here` : ch.private ? 'Private: only invited people can see it' : 'Public: anyone in the workspace can join' }),
        row({ label: 'Created by', sub: `${creator.name} on ${new Date(ch.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}` }))));
      if (ch.guests > 0 && !store.isGuest()) {
        details.append(el('div.guest-banner', { html: icon('users', 14, 2.2) },
          el('span', {}, `This channel includes ${ch.guests} guest${ch.guests === 1 ? '' : 's'} from outside the workspace.`)));
      }
      if (isSharedChannel(ch)) details.append(organizationsSection(ch));
    } else if (dm()) {
      const others = dm().members.filter((u) => u !== store.uuid);
      details.append(el('section', {}, el('div.details-card', {},
        row({ label: others.length === 1 ? 'Direct message' : 'Group conversation', sub: others.length === 1 ? `Just you and ${store.member(others[0]).name}` : others.length ? `${others.length + 1} people` : 'Your own space' }))));
    }

    details.append(pinnedSection());

    if (ch) {
      const bookmarks = ch.bookmarks || [];
      // Drawn when there is something to show, or a way to add one: for a
      // reader who may not curate (a guest, anyone in an archived channel)
      // a channel without bookmarks drew the heading over an empty card.
      if (bookmarks.length || canEdit) {
        details.append(el('section', {}, el('h3', {}, `Bookmarks (${bookmarks.length})`), el('div.details-card', {},
          ...bookmarks.map((b) => (b.file
            // A bookmarked file downloads from here as it does from the bar
            // under the header (the row used to be inert, the one bookmark
            // in the list that did nothing).
            ? row({
              icon: 'file', label: b.label, sub: fileLabelShort(b.name) || 'Attachment', action: 'Download', // the file's name as shown, cut in the middle when long (see fileLabelShort); the download keeps its own
              onClick: () => downloadAttachment(store.hostRef(ch.id), { id: b.file, name: b.name || b.label }).catch(() => toast('Could not download the file', { icon: 'alert' })),
            })
            : el('a.details-row', { href: safeHref(b.url), target: '_blank', rel: 'noopener noreferrer nofollow' },
              el('span', { html: icon('link', 18) }), el('span.details-text', {}, el('strong', {}, b.label), el('span', {}, b.url)), el('span', { html: icon('external', 16), style: { color: 'var(--ink-3)' } })))),
          canEdit && row({ icon: 'bookmarkPlus', label: bookmarks.length ? 'Edit bookmarks' : 'Add a bookmark', onClick: () => bookmarksDialog(ch), action: bookmarks.length ? 'Edit' : 'Add' }))));
      }
    }

    const actions = el('div.details-card');
    actions.append(row({ icon: 'search', label: isChannel ? 'Search in channel' : 'Search this conversation', onClick: () => { modal.close(); navigate({ ws: store.wsId, query: searchScope() }); }, action: 'Open' }));
    actions.append(row({ icon: 'files', label: 'Files & links', onClick: () => { modal.close(); navigate({ ws: store.wsId, conv: convId, files: true }); }, action: 'Open' }));
    actions.append(row({ icon: 'link', label: 'Copy link', onClick: copyLink, action: 'Copy' }));
    if (store.canHuddle(convId)) {
      const live = store.huddleIn(convId);
      const inIt = store.inHuddle(convId);
      const n = live ? Object.keys(live.m || {}).length : 0;
      actions.append(row({
        icon: 'headphones', label: inIt ? 'Leave the huddle' : live ? 'Join the huddle' : 'Start a huddle',
        sub: inIt ? 'You are in it now' : live ? `${n} ${n === 1 ? 'person is' : 'people are'} in it` : 'A live audio call in this conversation; add your camera or screen once in',
        action: inIt ? 'Leave' : live ? 'Join' : 'Start',
        onClick: async () => {
          if (inIt) await store.leaveHuddle();
          else if (await joinHuddleFlow(convId)) modal.close();
        },
      }));
    }
    if (ch && !store.isJoined(convId) && !ch.private && !ch.archived && !ch.lost) {
      // One join at a time (the row takes one press while the worker
      // answers; see row): a second request would land the channel twice on
      // the member document. Busy, not disabled: disabling the row under the
      // keyboard dropped its focus to the page body, and the redraw that
      // follows the join (the row gone from it) had nothing to give the
      // focus back to. The row is redrawn as joined (or comes back) when the
      // answer is in.
      actions.append(row({
        icon: 'login', label: 'Join channel', action: 'Join', sub: ch.shared ? `Hosted by ${ch.shared.host || 'another workspace'}` : null,
        onClick: async () => {
          try {
            await store.joinChannel(convId);
            toast(`Joined #${ch.name}`);
          } catch (e) {
            // Joined here with the host out of reach, or refused (see joinFailed).
            joinFailed(ch, e);
          }
        },
      }));
    }
    // Sharing a channel is the host's admins' call; once shared, the Workspaces card above carries the link.
    if (ch && !ch.shared && !isSharedChannel(ch) && store.isAdmin() && !ch.def && !ch.archived) {
      actions.append(row({ icon: 'shared', label: 'Share with another workspace', sub: 'A link their admin accepts; their people join this channel', action: 'Share', onClick: () => shareChannelDialog(ch) }));
    }
    details.append(el('section', {}, el('h3', {}, 'Actions'), actions));

    // Not offered to a guest whose only channel this is (see leaveOffered);
    // a guest can neither browse channels nor be invited back by the
    // channel's members, so for them the way back is an admin's alone.
    if (leaveOffered(ch)) {
      details.append(el('section', {}, el('div.details-card', {},
        row({ icon: 'doorOpen', label: 'Leave channel', danger: true, sub: store.isGuest() ? 'An admin will have to add you back' : ch.private ? 'You will need an invite to return' : 'You can rejoin anytime', onClick: async () => { if (await leaveChannelFlow(ch)) modal.close(); } }))));
    }
    return details;
  }

  function searchScope() {
    const ch = channel();
    if (ch) return `in:#${ch.name} `;
    const others = dm()?.members.filter((u) => u !== store.uuid) || [];
    return others.length === 1 ? `in:@${store.member(others[0]).username} ` : '';
  }

  /**
   * The workspaces in a shared channel, as an Organizations card: the
   * host ("Channel owner"), then each connected one with how many of its
   * people are here. The host's admins share further and disconnect from
   * here; a partner's admins end their side from Settings.
   */
  function organizationsSection(ch) {
    const orgs = organizationsOf(ch);
    const card = el('div.details-card.org-list');
    for (const o of orgs) {
      // What a connected workspace's people can do here: join the channel
      // themselves and take part in it. They cannot add anyone to it (its
      // host's admins invite guests and share it further), so the card does
      // not say "invite".
      const meta = [o.owner ? 'Channel owner' : 'Members join and post', o.count == null ? null : `${o.count} member${o.count === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
      const line = el('div.org-row', {},
        // The name's first character as the reader sees it (an emoji whole), as the workspace marks have it.
        el('span.org-mark', { 'aria-hidden': 'true' }, (graphemes(String(o.name || '').trim())[0] || 'W').toUpperCase()),
        el('span.org-text', {}, el('strong', {}, o.name, o.us ? ' (this workspace)' : ''), el('span', {}, meta)));
      if (!ch.shared && !o.owner && store.isAdmin()) {
        // One press at a time (see pressOnce), as the rows of this dialog
        // take theirs: the press asks first and then waits on the worker,
        // and the button stayed live meanwhile, so a second press put the
        // same question up again and sent its answer to the worker a second
        // time, for a connection already ended.
        const disconnect = el('button.btn.btn-sm.btn-ghost', { type: 'button', style: { color: 'var(--critical)' } }, 'Disconnect');
        disconnect.addEventListener('click', pressOnce(disconnect, async () => {
          const ok = await confirmDialog({ title: `Disconnect ${o.name}?`, message: `Everyone from ${o.name} leaves #${ch.name} now and their workspace can no longer add people to it. Messages they posted stay.`, confirmLabel: 'Disconnect' });
          if (!ok) return;
          try {
            await api.disconnectPartner(store.wsId, ch.id, o.conn);
            await store.refreshAfterChange();
            toast(`Disconnected ${o.name}`);
          } catch (e) {
            toast(e.message, { icon: 'alert' });
          }
        }));
        line.append(disconnect);
      }
      card.append(line);
    }
    const section = el('section', {}, el('h3', {}, `Workspaces (${orgs.length})`), card);
    if (!ch.shared && store.isAdmin() && !ch.archived && !ch.def) {
      section.append(el('div.row', { style: { marginTop: '8px' } },
        el('button.btn.btn-sm.btn-outline', { type: 'button', html: icon('link', 15), onclick: () => shareChannelDialog(ch) }, ' Share link')));
    }
    return section;
  }

  /** What this workspace calls a channel hosted elsewhere; the host keeps its own name. */
  async function renameShared(ch) {
    const name = await textDialog({ title: `Rename #${ch.name} here`, label: 'Name in this workspace', initial: ch.name, confirmLabel: 'Save', maxlength: 40, hint: `Only ${store.ws?.name || 'this workspace'} sees this name. Lowercase letters, numbers, and hyphens.` });
    if (name == null) return;
    const clean = cleanChannelName(name);
    if (!clean) return toast('Channel names use lowercase letters, numbers, and hyphens', { icon: 'alert' });
    if (clean === ch.name) return undefined;
    try {
      await api.updateChannel(store.wsId, ch.id, { name: clean });
      await store.refreshAfterChange();
      toast(`Renamed to #${clean} here`);
    } catch (e) {
      toast(e.message, { icon: 'alert' });
    }
    return undefined;
  }

  function pinnedSection() {
    const n = store.pinCount(convId);
    const section = el('section.pinned-section', {}, el('h3', {}, `Pinned (${n})`));
    const card = el('div.details-card', {});
    section.append(card);
    if (!n) {
      shownPins = null;
      card.append(el('div.pin-empty', {}, 'Nothing pinned yet. Pin a message from its menu to keep it here.'));
      return section;
    }
    // The list as it last stood stays on show, busy, while the fresh one is
    // read (the tab is built anew, and this section with it, for a change
    // anywhere in the channel): a "Loading" line in its place moved the rest
    // of the tab up for the length of the read, and the keyboard, put back
    // by place among the tab's controls when the tab was rebuilt (see
    // renderBody), landed on whatever control then stood where the Unpin
    // just pressed had been, a row further down the tab. The button under
    // the keyboard is found again at its place in the fresh list instead.
    // On the first draw there is nothing to keep, and the line says so.
    const shown = body.querySelector('.pinned-section .pin-list');
    card.append(shown || el('div.msg-loader', {}, 'Loading'));
    if (shown) card.setAttribute('aria-busy', 'true');
    // An unpin from the list reaches the dialog through the activity the
    // store announces (the pinned count is in its signature, see refresh),
    // which rebuilds the tab and reads the list again; told of it by the
    // row as well, the dialog built the tab a second time and asked the
    // worker for the list a second time before the first answer was in.
    const force = pinsStale;
    pinsStale = false;
    store.loadPins(convId, { force }).then((pins) => {
      if (destroyed) return;
      shownPins = pins;
      const restore = focusMemo(card);
      card.replaceChildren(renderPinList(convId, pins, { onOpen: () => modal.close() }));
      card.removeAttribute('aria-busy');
      restore(card);
    }).catch(() => {
      card.replaceChildren(el('div.msg-loader', {}, 'Could not load pins'));
      card.removeAttribute('aria-busy');
    });
    return section;
  }

  /* ---- Members ---------------------------------------------------------- */

  function renderMembers() {
    const ch = channel();
    const wrap = el('div.details');
    const search = el('input.input', { type: 'search', placeholder: isChannel ? 'Find members' : 'Find people', 'aria-label': 'Find members', autocomplete: 'off', id: fieldId('members'), value: membersQuery });
    const list = el('div.details-card.members-list');
    wrap.append(el('div.field', {}, search), list);

    const adders = [];
    // Adding people and inviting guests is done where the channel lives; an
    // entry for a channel hosted elsewhere offers neither.
    if (ch && !ch.shared && ch.private && store.isJoined(convId) && !store.isGuest() && !ch.archived) {
      adders.push(el('button.member-row.member-add', { type: 'button', onclick: () => addChannelMembersDialog(ch).then(() => { members = null; renderBody(); }) },
        el('span.member-add-icon', { html: icon('userPlus', 18, 2) }), el('span.pick-text', {}, el('strong', {}, 'Add people'))));
    } else if (ch && !ch.shared && !ch.private && store.isAdmin() && store.isJoined(convId) && !ch.archived && Object.values(store.ws?.members || {}).some((m) => m.role === 'guest')) {
      // Only to an admin who is in the channel, and not once it is archived,
      // as the row above is offered: the worker refuses the add otherwise
      // ("Join the channel to add people to it", "This channel is
      // archived"), and the row stood for an admin previewing the channel,
      // whose every pick came back refused.
      // A public channel keeps no member list of its own; the one loaded for this tab says who is already in.
      adders.push(el('button.member-row.member-add', { type: 'button', onclick: () => addChannelMembersDialog(ch, { guestsOnly: true, exclude: members || [] }).then(() => { members = null; renderBody(); }) },
        el('span.member-add-icon', { html: icon('userPlus', 18, 2) }), el('span.pick-text', {}, el('strong', {}, 'Add guests'))));
    }
    if (ch && !ch.shared && store.isAdmin() && !ch.def && !ch.archived) {
      adders.push(el('button.member-row.member-add', { type: 'button', onclick: () => guestInviteDialog(ch) },
        el('span.member-add-icon', { html: icon('link', 18, 2) }), el('span.pick-text', {}, el('strong', {}, ch.guestInvite ? 'Guest invite link' : 'Invite a guest to this channel'))));
    }

    const draw = () => {
      // Read as search reads names (lowercase, accents and other marks
      // stripped): "jose" finds José, as the mention list and the pickers do.
      // And "@ana" finds her as "ana" does: the leading mark is no part of a name (the sidebar's rule).
      const q = normalize(search.value.trim().replace(/^[#@]+/, ''));
      const all = members || [];
      const hit = (u) => { const m = store.member(u); return !q || normalize(m.name).includes(q) || normalize(m.username).includes(q) || normalize(m.org?.name).includes(q); };
      const roleOf = (u) => store.member(u).role;
      const people = all.filter((u) => roleOf(u) !== 'guest' && roleOf(u) !== 'external' && hit(u));
      const externals = all.filter((u) => roleOf(u) === 'external' && hit(u));
      const guests = all.filter((u) => roleOf(u) === 'guest' && hit(u));
      list.replaceChildren(...(q ? [] : adders), ...people.map(memberRow));
      // People from the other workspaces in a shared channel, grouped by theirs.
      const byOrg = new Map();
      for (const u of externals) {
        const name = store.member(u).org?.name || 'Other workspaces';
        if (!byOrg.has(name)) byOrg.set(name, []);
        byOrg.get(name).push(u);
      }
      for (const [name, us] of byOrg) list.append(el('h3.details-subhead', {}, name), ...us.map(memberRow));
      if (guests.length) list.append(el('h3.details-subhead', {}, 'Guests'), ...guests.map(memberRow));
      if (!people.length && !guests.length && !externals.length) list.append(el('div.msg-loader', {}, members ? (q ? 'Nobody matches' : 'No members yet') : 'Loading'));
    };
    search.addEventListener('input', () => { membersQuery = search.value; draw(); });
    draw();
    if (!members) {
      const host = store.hostOf(convId);
      // Only the newest read's answer is kept. The tab is built again, and
      // the list read again, for a change while a read is out (someone
      // joining as it is opened), and the older answer landing after the
      // newer one was taken for the list: the roster it drew went into a tab
      // no longer on the page, but the next letter typed into the filter
      // drew the list from it, without the newcomer.
      const mine = ++membersRead;
      const load = ch ? api.channelMembers(host.ref, host.conv).then((d) => d.members) : Promise.resolve(dm()?.members || []);
      load.then((uuids) => {
        if (destroyed || mine !== membersRead) return;
        members = uuids;
        draw();
      }).catch(() => { if (mine === membersRead) list.replaceChildren(el('div.msg-loader', {}, 'Could not load members')); });
    }
    return wrap;
  }

  /* ---- Settings --------------------------------------------------------- */

  function renderSettings() {
    const ch = channel();
    const details = el('div.details');
    if (!ch) return details;
    if (ch.shared) {
      // The channel is the host's to set up; this workspace decides what it
      // is called here and whether to stay connected.
      const host = ch.shared.host || 'another workspace';
      details.append(el('section', {}, el('div.details-card', {},
        row({ label: 'Channel name', sub: `#${ch.name} · only visible to ${store.ws?.name || 'this workspace'}`, onClick: store.isAdmin() ? () => renameShared(ch) : null }))));
      details.append(organizationsSection(ch));
      details.append(el('section', {}, el('h3', {}, 'Posting permissions'), el('div.details-card', {},
        row({ icon: 'users', label: 'Who can post', sub: `${(ch.postPolicy || 'members') === 'admins' ? `Admins of ${host} only` : 'Everyone in the channel'}. Set by ${host}.` }),
        row({ icon: 'reply', label: 'Thread replies', sub: (ch.threadPolicy || 'everyone') === 'off' ? 'Turned off' : (ch.threadPolicy || 'everyone') === 'admins' ? `Admins of ${host} only` : 'Everyone in the channel' }))));
      if (store.isAdmin()) {
        details.append(el('section', {}, el('div.details-card', {}, row({
          icon: 'unplug', label: 'Remove from this workspace', danger: true, sub: `Ends the connection: everyone here leaves the channel on ${host}. Their messages stay there.`,
          onClick: async () => {
            const ok = await confirmDialog({ title: `Remove #${ch.name} from ${store.ws?.name || 'this workspace'}?`, message: `${host} keeps the channel and everything said in it; nobody here can open it any more. Their admin can share it again later.`, confirmLabel: 'Remove' });
            if (!ok) return;
            try {
              await store.disconnectShared(convId);
              toast('Shared channel removed');
              modal.close();
              navigate({ ws: store.wsId, conv: store.joinedChannels()[0]?.id });
            } catch (e) {
              toast(e.message, { icon: 'alert' });
            }
          },
        }))));
      }
      return details;
    }
    const canArchive = store.isAdmin() || ch.createdBy === store.uuid;
    const policyEdit = store.isAdmin() && !ch.archived ? () => editChannelDialog(ch) : null;
    const postPolicy = ch.postPolicy || 'members';
    const threadPolicy = ch.threadPolicy || 'everyone';
    details.append(el('section', {}, el('div.details-card', {},
      row({ label: 'Channel name', sub: `#${ch.name}`, onClick: !ch.archived && (store.isAdmin() || !ch.def) ? () => editChannelDialog(ch) : null }))));
    details.append(el('section', {}, el('h3', {}, 'Posting permissions'), el('div.details-card', {},
      row({ icon: postPolicy === 'admins' ? 'megaphone' : 'users', label: 'Who can post', sub: postPolicy === 'admins' ? 'Admins only. Everyone can read and react.' : 'Everyone in the channel', onClick: policyEdit }),
      row({ icon: 'bell', label: 'Who can use @channel and @here', sub: (ch.broadcast || (ch.def ? 'admins' : 'everyone')) === 'admins' ? 'Admins only' : 'Everyone in the channel', onClick: policyEdit }),
      row({ icon: threadPolicy === 'off' ? 'messageOff' : 'reply', label: 'Thread replies', sub: threadPolicy === 'off' ? 'Turned off' : threadPolicy === 'admins' ? 'Admins only' : 'Everyone in the channel', onClick: policyEdit }))));
    const danger = el('div.details-card');
    if (canArchive && !ch.def) {
      danger.append(row({
        icon: ch.archived ? 'unarchive' : 'archive', label: ch.archived ? 'Unarchive channel' : 'Archive channel', danger: !ch.archived,
        sub: ch.archived ? 'Members can post again' : 'Keeps history, stops new messages', action: ch.archived ? 'Unarchive' : null,
        onClick: async () => {
          if (!ch.archived) {
            const ok = await confirmDialog({ title: `Archive #${ch.name}?`, message: 'Its history stays readable, but nobody can post, react, or edit there until it is unarchived.', confirmLabel: 'Archive' });
            if (!ok) return;
          }
          try {
            await api.updateChannel(store.wsId, convId, { archived: !ch.archived });
            await store.refreshAfterChange();
            toast(ch.archived ? 'Channel unarchived' : 'Channel archived');
            modal.close();
          } catch (e) {
            toast(e.message, { icon: 'alert' });
          }
        },
      }));
    }
    if (store.isAdmin() && !ch.def) {
      danger.append(row({
        icon: 'trash', label: 'Delete channel', danger: true, sub: 'Removes the channel for everyone',
        onClick: async () => {
          const ok = await confirmDialog({ title: `Delete #${ch.name}?`, message: 'The channel and its messages will no longer be reachable. This cannot be undone.' });
          if (!ok) return;
          try {
            await api.deleteChannel(store.wsId, convId);
            await store.refreshAfterChange();
            toast('Channel deleted', { icon: 'trash' });
            modal.close();
            navigate({ ws: store.wsId, conv: store.joinedChannels()[0]?.id });
          } catch (e) {
            toast(e.message, { icon: 'alert' });
          }
        },
      }));
    }
    if (danger.children.length) details.append(el('section', {}, danger));
    return details;
  }

  function renderBody() {
    if (destroyed) return;
    // A redraw brought by a poll (someone joined, a pin, a huddle) while the
    // member filter is being typed in keeps the caret there, and the words.
    const typing = tab === 'members' && body.contains(document.activeElement) && document.activeElement.matches('input[type="search"]');
    // The keyboard in the pinned section as the tab is rebuilt: when the
    // section it comes back to has no control left (the last pin unpinned,
    // and "Nothing pinned yet" in the list's place), it lands on those words
    // rather than, by place among the tab's controls, on an unrelated row
    // further down (Search in channel, a bookmark).
    const inPins = !!body.querySelector('.pinned-section')?.contains(document.activeElement);
    // And a press that redraws (Join, Unpin, a toggle) keeps the keyboard on its control.
    keepFocus(body, () => body.replaceChildren(tab === 'members' ? renderMembers() : tab === 'settings' ? renderSettings() : renderAbout()));
    if (typing) {
      const s = body.querySelector('input[type="search"]');
      s?.focus({ preventScroll: true });
      s?.setSelectionRange(s.value.length, s.value.length);
    } else if (inPins) {
      const section = body.querySelector('.pinned-section');
      if (section && !section.querySelector('button, a[href], [tabindex]')) {
        const note = section.querySelector('.pin-empty') || section;
        note.setAttribute('tabindex', '-1');
        note.focus({ preventScroll: true });
      }
    }
  }

  /* ---- lifecycle -------------------------------------------------------- */

  const modal = openModal({
    title: isChannel ? 'Channel details' : 'Conversation details',
    label: `${title()} details`,
    content,
    wide: true,
    onClose: () => {
      destroyed = true;
      off();
      offAct();
      offProfile();
      offHuddle();
      offMsgs();
      onClose?.();
    },
  });
  // A pinned message edited while the About tab shows the list (the count
  // stands, so the signature says nothing): the tab is drawn again with the
  // list read from the worker, rather than the words as they were.
  const offMsgs = store.on('messages', (d) => {
    if (destroyed || d.conv !== convId || tab !== 'about' || !shownPins || !pinsMoved(convId, shownPins)) return;
    pinsStale = true;
    renderBody();
  });

  function signature() {
    const ch = channel();
    // The huddle row: who is in it, and whether the user is.
    const huddle = [store.huddleMembers(convId), store.inHuddle(convId)];
    if (ch) {
      return JSON.stringify([ch.name, ch.topic || '', ch.description || '', !!ch.archived, ch.count || 0, !!ch.private, ch.postPolicy || '', ch.threadPolicy || '', ch.broadcast || '',
        (ch.members || []).join(','), store.isJoined(convId), store.isAdmin(), store.notifySetting(convId), store.isStarred(convId), ch.bookmarks || [], store.pinCount(convId), ch.guests || 0, ch.guestInvite || '',
        ch.connections || null, ch.connectInvite || '', ch.shared?.host || '', ch.hostName || '', !!ch.lost, store.postAccess(convId).reason, huddle]);
    }
    return JSON.stringify([dm()?.members || null, store.notifySetting(convId), store.isStarred(convId), store.pinCount(convId), huddle]);
  }
  let sig = signature();
  const refresh = () => {
    if (destroyed) return;
    if (!channel() && !dm()) {
      modal.close();
      return;
    }
    const next = signature();
    if (next === sig) return;
    sig = next;
    // Someone joined, left, or was removed: the list is read again, now
    // while the Members tab is open, else when it is next opened. Only the
    // open tab used to let go of it, so a list loaded on an earlier visit to
    // the tab came back as it was, under a count that had moved on. Let go
    // of only for a change of membership (see membersKey): a star or a new
    // topic redraws the tab with the roster it has.
    const mk = membersKey();
    if (mk !== membersSig) {
      membersSig = mk;
      members = null;
    }
    renderHead();
    renderTabs();
    renderBody();
  };
  const off = store.on('workspace', refresh);
  const offAct = store.on('activity', refresh);
  const offProfile = store.on('profile', renderHead);
  const offHuddle = store.on('huddle', refresh);

  renderHead();
  renderTabs();
  renderBody();
  return { close: modal.close };
}
