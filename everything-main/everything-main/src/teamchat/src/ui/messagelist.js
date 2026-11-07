/**
 * A scrolling message list bound to one conversation in the store. Handles
 * day dividers, the "new" divider, author grouping, loading older history at
 * the top (keeping the viewport still), following new messages at the
 * bottom, the jump pill when scrolled up, and marking messages read.
 */
import { el, composing } from './dom.js';
import { icon } from './icons.js';
import { renderMessage, editMessageIn, startInlineEdit, editBackOf } from './message.js';
import { store } from '../lib/store.js';
import { sameDay, dayLabel, isContinuation, relativeLong, startOfDay } from '../lib/time.js';
import { openMenu } from './menu.js';
import { toast } from './toast.js';
import { pickDateDialog } from './dialogs.js';
import { nearBottom, needsRepin, readerMovedUp } from '../lib/scroll.js';

export function createMessageList({
  convId, inThread = false, rootSeq = null, parentConv = null, focusSeq = null,
  onOpenThread, onShowMember, renderIntro, header = null,
}) {
  const list = el('div.msg-list', { role: 'region', 'aria-label': inThread ? 'Replies' : 'Messages' });
  const top = el('div.msg-top');
  const bottom = el('div.msg-bottom');
  const scroller = el('div.msg-scroll', {}, top, list, bottom);
  const live = el('div.visually-hidden', { 'aria-live': 'polite', 'aria-atomic': 'true' });
  // A positioned box of its own, so the jump pill sits above the composer
  // rather than over it.
  const wrap = el('div.msg-wrap', {}, scroller, live);
  // The day at the top of the viewport, a date pill floating over the
  // list, and a way to jump elsewhere in the history.
  const dateFloat = !inThread ? el('button.date-float', {
    type: 'button', hidden: true, 'aria-haspopup': 'menu', 'aria-label': 'Jump to a date',
    onclick: (e) => openJumpMenu(e.currentTarget),
  }) : null;
  if (dateFloat) wrap.append(dateFloat);
  let pill = null;
  let firstUnread = null; // seq of the first unread message at open time
  let unseenCount = 0;
  let destroyed = false;
  let stickToBottom = true;
  // Where the last scroll event — or the last scroll write of our own —
  // left the scroller: what readerMovedUp reads the next event against.
  // Every programmatic write records itself at once: its scroll event only
  // lands next frame, and a reader's wheel in between coalesces into that
  // one event, which read against the stale position would be taken for
  // the layout and undone.
  let lastTop = 0;
  let lastMax = 0;
  const rememberScroll = () => {
    lastTop = scroller.scrollTop;
    lastMax = scroller.scrollHeight - scroller.clientHeight;
  };
  let wantBottom = false; // the next page load was asked for by "Jump to latest"
  // ...or by "The very beginning": the window lands at its top, the intro
  // and the oldest message it holds, whether or not the first message
  // stands. Loaded around message 1 and treated as a link to it, the jump
  // said "That message is no longer here" when that message had been
  // deleted (a direct message's first line, an imported channel's), and
  // scrolled nowhere, so the list stayed where the browser clamped it: at
  // the far end of the oldest page, as far from the beginning as it goes.
  let wantTop = false;
  // The last page of older (or newer) messages could not be fetched: offer
  // to try again. Read before the conversation's own "loading" flag: the
  // store says a page failed from inside the request's failure, a moment
  // before it lets go of the flag, so a redraw at that moment still read
  // "Loading older messages" and the button to ask again never came (until
  // some other change redrew the list).
  let olderFailed = false;
  let newerFailed = false;
  // "Try again" (under "Could not load messages") pressed from the keyboard:
  // the button goes with the redraw that follows, and what comes in its
  // place takes the keyboard (see render), rather than the page body.
  let retryFocus = false;
  let membersByUsername = store.membersByUsername();

  const conv = store.conv(convId);
  const serverRead = store.me?.reads?.[convId] || 0;
  // "Mark unread from here" (a message's menu, the sidebar row's) moves the
  // read cursor back on purpose, and the reader's staying at the bottom must
  // not move it forward again: they asked for the conversation to stay
  // unread. It does until they leave and come back (a fresh
  // list), or a message arrives while they are at the bottom or they jump
  // to the new ones: then they are reading, and what is read is read. The
  // mark shows itself here as messages becoming unread with no new message
  // among them (the store's count, which reads against what was seen on
  // this device as well as the worker's cursor). Not as the worker's cursor
  // alone going back: a workspace document asked for before a read landed
  // there carries the cursor from before it, and the store lays such a
  // document over its own every so often (someone's topic change brings
  // one), so the cursor alone steps back without anyone having marked
  // anything, and taken for a mark it stopped the list marking read until
  // the conversation was opened again.
  let knownUnread = store.unreadCount(convId);
  let knownLatest = store.latestSeq(convId);
  let unreadHeld = false;

  const atBottom = () => nearBottom(scroller);

  /**
   * One frame callback of each kind at a time: the next asked for before
   * the frame comes takes the place of the one waiting (each reads the list
   * as it stands when it runs, so the earlier one had nothing of its own to
   * do). A hidden tab runs no frames at all, and every poll redraws the list
   * (see the 'workspace' listener) and follows the bottom for each message
   * that lands, so a conversation left open in a background tab queued a
   * callback per redraw for hours, all of which ran in the one frame the tab
   * was shown again in. `kind` names the slot; the id is kept to be let go
   * of when the list is taken down (see destroy).
   */
  const frames = new Map(); // kind -> the id of the callback waiting
  const atFrame = (kind, fn) => {
    if (frames.has(kind)) cancelAnimationFrame(frames.get(kind));
    frames.set(kind, requestAnimationFrame(() => {
      frames.delete(kind);
      fn();
    }));
  };

  function ctxFor() {
    return { convId, inThread, rootSeq, parentConv, onOpenThread, onShowMember, membersByUsername };
  }

  /**
   * The row at the top of the viewport and where it stands, for a redraw
   * to put back (see render and keepAnchor). The list is drawn anew as a
   * whole for a change to any one message (a reaction, an edit, a pin, a
   * deletion, the poll's word on the workspace), and a browser's own scroll
   * anchoring cannot follow rows that all leave the page at once: for a
   * reader scrolled up into the history, a change above the viewport (a
   * reactions row appearing under a message they had scrolled past, a tall
   * message deleted to a one-line tombstone, the "New" line of a mark
   * unread) moved what they were reading by its height, redraw after
   * redraw in a busy channel. Nothing for a reader at the bottom, whom the
   * redraws pin there on their own, nor before the messages are drawn.
   */
  function anchorRow() {
    if (!conv.loaded || atBottom()) return null;
    const top = scroller.getBoundingClientRect().top;
    for (const r of list.querySelectorAll('.msg')) {
      const rect = r.getBoundingClientRect();
      if (rect.bottom <= top) continue;
      return { seq: r.dataset.seq, temp: r.dataset.temp, root: r.classList.contains('thread-root'), offset: rect.top - top };
    }
    return null;
  }

  /** The anchored row's replacement back where the row stood (see anchorRow); a row that is gone with the redraw holds nothing. */
  function keepAnchor(a) {
    if (!a) return;
    const row = [...list.querySelectorAll('.msg')].find((r) => (a.seq ? r.dataset.seq === a.seq : a.temp && r.dataset.temp === a.temp) && r.classList.contains('thread-root') === a.root);
    if (!row) return;
    const delta = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - a.offset;
    if (Math.abs(delta) < 1) return;
    scroller.scrollTop += delta;
    rememberScroll();
  }

  function render() {
    if (destroyed) return;
    membersByUsername = store.membersByUsername();
    const frag = document.createDocumentFragment();
    if (conv.error) {
      frag.append(el('div.empty', {},
        el('div.empty-icon', { html: icon('wifiOff', 24) }),
        el('h3', {}, 'Could not load messages'),
        el('p', {}, conv.error.message),
        el('button.btn.mt', {
          type: 'button',
          onclick: (e) => {
            // A mouse press leaves the focus where it falls, as the pill's does (see hidePill).
            retryFocus = e.currentTarget.matches(':focus-visible');
            conv.error = null;
            conv.loaded = false;
            store.loadConversation(convId);
          },
        }, 'Try again')));
    } else if (!conv.loaded) {
      frag.append(skeleton());
    } else {
      if (conv.stale) {
        frag.append(el('div.stale-banner', { role: 'status', html: icon('wifiOff', 14, 2.2) },
          el('span', {}, `You are offline. Showing messages saved on this device ${relativeLong(conv.stale)}; new ones arrive when you are back.`)));
      }
      if (!conv.hasMore && renderIntro) {
        const intro = renderIntro();
        if (intro) frag.append(intro);
      } else if (conv.hasMore) {
        frag.append(el('div.msg-loader', {}, olderFailed ? el('button.btn.btn-sm.btn-ghost', {
          type: 'button',
          onclick: (e) => {
            // Pressed from the keyboard, the button goes with the redraw
            // that follows (the loading line stands in its place), and the
            // keyboard fell to the page body with it: the oldest message
            // loaded takes it, and keeps it when the page lands above (the
            // row is found again by its number below), so the new messages
            // are an arrow away. A mouse press leaves the focus where it
            // falls, as the pill's does (see hidePill).
            const keyboard = e.currentTarget.matches(':focus-visible');
            olderFailed = false;
            store.loadOlder(convId).catch(() => {});
            render();
            if (keyboard) list.querySelector('.msg')?.focus({ preventScroll: true });
          },
        }, 'Load older messages') : conv.loading ? 'Loading older messages' : ''));
      }
      if (header) frag.append(header());
      if (firstUnread === null) {
        const candidate = conv.messages.find((m) => m.seq != null && m.seq > serverRead && m.user !== store.uuid && m.kind !== 'sys');
        firstUnread = candidate ? candidate.seq : 0;
      }
      let prev = null;
      let count = 0;
      for (const msg of conv.messages) {
        let divider = false;
        if (!prev || !sameDay(prev.ts, msg.ts)) {
          // The day it stands for goes on the divider, so its label can be
          // written again when the day changes under it (see relabelDays).
          frag.append(el('div.day-divider', { role: 'separator', 'aria-label': dayLabel(msg.ts), dataset: { ts: String(msg.ts) } }, el('span', {}, dayLabel(msg.ts))));
          divider = true;
        }
        if (firstUnread && msg.seq === firstUnread) {
          frag.append(el('div.new-divider', { role: 'separator' }, 'New'));
          divider = true;
        }
        const continuation = !divider && isContinuation(prev, msg);
        frag.append(renderMessage(msg, { ...ctxFor(), continuation }));
        prev = msg;
        count++;
      }
      if (!count && !renderIntro && !header) {
        frag.append(el('div.empty', {}, el('p', {}, inThread ? 'No replies yet' : 'No messages yet')));
      }
      // Opened around an older message: newer ones load as the reader scrolls on.
      if (conv.hasNewer) {
        frag.append(el('div.msg-loader', {}, newerFailed || !conv.loading ? el('button.btn.btn-sm.btn-ghost', {
          type: 'button',
          onclick: (e) => {
            // As above: the newest message loaded takes a keyboard press, and the page lands below it.
            const keyboard = e.currentTarget.matches(':focus-visible');
            newerFailed = false;
            store.loadNewer(convId).catch(() => {});
            render();
            if (keyboard) [...list.querySelectorAll('.msg')].pop()?.focus({ preventScroll: true });
          },
        }, 'Load newer messages') : 'Loading newer messages'));
      }
    }
    // An edit in progress survives the redraw (a teammate's post or reaction
    // redraws the whole list): the box, what was typed, and the caret move to
    // the row's replacement.
    const editing = list.querySelector('.msg.editing');
    const input = editing?.querySelector('.msg-edit-input');
    const edit = input ? {
      seq: Number(editing.dataset.seq), root: editing.classList.contains('thread-root'),
      index: [...list.querySelectorAll('.msg')].indexOf(editing),
      value: input.value, start: input.selectionStart, end: input.selectionEnd, focused: document.activeElement === input,
      // And the box the edit hands the keyboard back to when it closes (an
      // edit begun with ArrowUp in the composer), so the replacement does too.
      back: editBackOf(editing),
    } : null;
    // So does a focused row (arrowing through the list to press R, E, or
    // Delete): its replacement takes the focus, found by its number. A
    // control inside the row under the keyboard (a reaction pill, a button
    // of the hover bar, whose press is what redraws the list) is found
    // again by its label, else by its place among the row's controls. A row
    // that is gone (its message deleted with the row's own Delete, a queued
    // one discarded) hands the focus to the row now at its place, or the
    // last one when the list shrank under it, as a redrawn list of controls
    // does (see focusMemo); the keyboard used to be left on the page body.
    // Whether or not an edit stands open in the list: the box opened again
    // on the row's replacement takes the keyboard as it opens, and a
    // keyboard that had left the box (Tab to its Save or Cancel, a control
    // of another row) used to be pulled back into it by the redraw, so an
    // Enter meant for Cancel saved the edit, and a Space meant for a button
    // went into the words. Only the box itself is the edit's to put back.
    const active = document.activeElement;
    const row = active instanceof HTMLElement && list.contains(active) && active !== input ? active.closest('.msg') : null;
    // Every control a Tab can reach inside the row: its buttons and links,
    // and what is made a control by its role (a mention chip, the card
    // quoting a linked message, both tabindex 0). Buttons and links alone
    // were looked for, so a keyboard on a chip or a card fell to the row at
    // every redraw, and the poll redraws the list every few seconds.
    const controlsOf = (r) => [...r.querySelectorAll('button, a[href], [tabindex="0"]')];
    const labelOf = (n) => n.getAttribute('aria-label') || n.textContent;
    // The part of the row a control belongs to (the hover bar, the reactions,
    // a link's preview card, the files, the editor, a queued message's line),
    // and its place within it: a control whose label changed with its press
    // (Save for later, a reaction pill the reader joined) is found again by
    // its place among its own kind alone. By its place among all the row's
    // controls, a press that took the control's whole part away (Remove
    // preview, the reader's last reaction on a pill) put the keyboard on
    // whatever stood at that place in the row without it, the hover bar's
    // Reply in thread or a quick reaction, a Space away from pressing it;
    // the row takes it instead.
    const parts = ['.msg-actions', '.reactions', '.unfurl', '.attachments', '.msg-quote', '.thread-link', '.msg-edit', '.msg-queued-row', '.msg-failed-row'];
    const within = (controls, part) => controls.filter((n) => n.closest(part));
    /** A control of row `r`, as it is found again in the row's replacement (see findLike). */
    const keyOf = (n, r) => {
      const part = parts.find((p) => n.closest(p)) || null;
      return { label: labelOf(n), index: controlsOf(r).indexOf(n), part, at: part ? within(controlsOf(r), part).indexOf(n) : -1 };
    };
    /**
     * The control of row `r` that `key` names: by its label within its own
     * part first (the hover bar's Add reaction and the "+" of the reactions
     * row wear one label), by its label anywhere in the row, else by its
     * place within its own part, or, for a control of no part, among the
     * row's controls; null when nothing stands for it.
     */
    const findLike = (r, key) => {
      const controls = controlsOf(r);
      const own = key.part ? within(controls, key.part) : controls;
      return own.find((n) => labelOf(n) === key.label) || controls.find((n) => labelOf(n) === key.label) || own[key.part ? key.at : key.index] || null;
    };
    const held = row ? {
      seq: row.dataset.seq, temp: row.dataset.temp, root: row.classList.contains('thread-root'),
      index: [...list.querySelectorAll('.msg')].indexOf(row),
      sub: active !== row ? keyOf(active, row) : null,
    } : null;
    // A control of the list outside any row under the keyboard (a button of
    // the channel's intro, "Load older messages" at the top): found again by
    // its label among the fresh list's own controls. Only the rows' controls
    // were, and a teammate's post redrawing the list dropped the keyboard
    // from the intro's Details or Add people to the page body, where the
    // next Tab started over from the top of the window.
    const loose = !row && active instanceof HTMLElement && list.contains(active) && active !== input && active.matches('button, a[href]') ? labelOf(active) : null;
    // And a code block unfolded to be read ("Show 180 more lines" on a
    // pasted stack trace) stays open: every block is drawn folded, so a
    // teammate's post or reaction mid-read snapped it shut under the eyes
    // and the list jumped by its height, over and over in a busy channel.
    // A block is named by its row and its place among the row's blocks.
    const blockKey = (more) => {
      const r = more.closest('.msg');
      return `${r.dataset.seq || ''}|${r.dataset.temp || ''}|${r.classList.contains('thread-root')}|${[...r.querySelectorAll('.code-more')].indexOf(more)}`;
    };
    const unfolded = new Set([...list.querySelectorAll('.code-wrap:not(.folded) > .code-more')].map(blockKey));
    // A menu standing open on a row holds the row's hover bar drawn under
    // it, and the row lit, by a class (see .msg.menu-open): the row's
    // replacement takes the class, as it takes the keyboard. Drawn without
    // it, the bar the menu hangs from dropped away, and the row went dark,
    // under a menu still open, each time the poll redrew the list.
    const menuRow = list.querySelector('.msg.menu-open');
    const menuKey = menuRow ? { seq: menuRow.dataset.seq, temp: menuRow.dataset.temp, root: menuRow.classList.contains('thread-root') } : null;
    // And the control the menu hangs from, which says the menu is open
    // (aria-expanded, see openPopover): its replacement says so too, and
    // is the menu's opener from then on (pressing it closes the menu, the
    // keyboard comes back to it; see menu.js standIn). Drawn without the
    // word, a press on the fresh More closed the menu and opened a second
    // one in its place.
    const opener = menuRow?.querySelector('[aria-expanded="true"]');
    const openerKey = opener ? keyOf(opener, menuRow) : null;
    // And the reader's place in the history (see anchorRow), put back once
    // the fresh rows stand as the old ones did: their code blocks unfolded
    // and the editor open again, which are heights of their own.
    const anchor = anchorRow();
    list.replaceChildren(frag);
    if (menuKey) {
      const fresh = [...list.querySelectorAll('.msg')]
        .find((r) => (menuKey.seq ? r.dataset.seq === menuKey.seq : menuKey.temp && r.dataset.temp === menuKey.temp) && r.classList.contains('thread-root') === menuKey.root);
      fresh?.classList.add('menu-open');
      if (fresh && openerKey) findLike(fresh, openerKey)?.setAttribute('aria-expanded', 'true');
    }
    if (unfolded.size) for (const more of list.querySelectorAll('.code-wrap.folded > .code-more')) if (unfolded.has(blockKey(more))) more.click();
    if (edit) restoreEdit(edit, active);
    keepAnchor(anchor);
    if (held) {
      const all = [...list.querySelectorAll('.msg')];
      const again = all.find((r) => (held.seq ? r.dataset.seq === held.seq : held.temp && r.dataset.temp === held.temp) && r.classList.contains('thread-root') === held.root);
      if (again) {
        let target = again;
        // By its label; else by its place within its own part of the row
        // (see `part`: the editor's Save or Cancel when the editor did not
        // come back with the row, its message deleted meanwhile, is nobody's,
        // and the row itself, where the message was, takes the keyboard); a
        // control of no part by its place among the row's controls.
        if (held.sub) target = findLike(again, held.sub) || again;
        // The row first, then the control: the row's hover bar is not drawn
        // until the row is under the pointer or holds the keyboard (see
        // .msg-actions), and a browser will not focus a control that is not
        // drawn, so handed straight to a button of the bar the keyboard
        // fell to the page instead. With the row focused the bar is drawn,
        // and the button takes the focus from it.
        if (target !== again) again.focus({ preventScroll: true });
        target.focus({ preventScroll: true });
      } else all[Math.min(held.index, all.length - 1)]?.focus({ preventScroll: true });
    }
    // The same control by its label, when the redraw brought it back (see
    // loose); a press that takes it away (Load older, Try again) hands the
    // keyboard on itself.
    if (loose !== null) [...list.querySelectorAll('button, a[href]')].find((n) => !n.closest('.msg') && labelOf(n) === loose)?.focus({ preventScroll: true });
    // Try again pressed from the keyboard (see retryFocus): the skeleton
    // holds the keyboard while the messages are fetched, then the newest
    // message takes it (the intro's first button, for a conversation with
    // none), or, the load refused once more, the button to try again.
    if (retryFocus) {
      if (conv.error || conv.loaded) {
        retryFocus = false;
        (conv.error ? list.querySelector('.empty button') : [...list.querySelectorAll('.msg')].pop() || list.querySelector('button'))?.focus({ preventScroll: true });
      } else list.querySelector('[aria-busy="true"]')?.focus({ preventScroll: true });
    }
    atFrame('float', updateDateFloat);
  }

  function restoreEdit(edit, active) {
    const all = [...list.querySelectorAll('.msg')];
    const row = all.find((r) => Number(r.dataset.seq) === edit.seq && r.classList.contains('thread-root') === edit.root);
    if (!row || !startInlineEdit(row, { reveal: false, back: edit.back })) {
      // The box cannot come back: the message was deleted under it (by its
      // author in another tab, by an admin), and its row went with it or
      // stands as a tombstone, or the channel was archived meanwhile. The
      // words typed went with the box, and nothing said so; the keyboard,
      // if it was in the box, fell to the page body. Said now, and the
      // keyboard lands where the message was: its tombstone, or the message
      // now standing at its place.
      // The message is looked for where it lives: a thread's root row
      // belongs to the parent conversation, and its number means nothing
      // among the replies' own numbers.
      const home = edit.root && parentConv ? store.conv(parentConv) : conv;
      const m = home.messages.find((x) => x.seq === edit.seq);
      // Gone for good, or gone from view? A message deleted elsewhere
      // leaves the loaded window with a gap where it stood, or a tombstone;
      // a jump (to a date, to the latest messages, to a linked message)
      // loads another window, which never held it, and the words used to
      // call that a deletion, over a message that stands as it was.
      const seqs = home.messages.filter((x) => x.seq != null).map((x) => x.seq);
      const inWindow = home.loaded && seqs.length > 0 && edit.seq >= seqs[0] && edit.seq <= seqs[seqs.length - 1];
      const words = m?.deleted || (!m && inWindow) ? 'That message was deleted while you were editing it'
        : !m ? 'Editing stopped: the message is out of view now. Nothing was changed'
          : 'Editing stopped: nothing can be changed here now';
      toast(words, { icon: 'alert' });
      if (edit.focused) (row || all[Math.min(Math.max(edit.index, 0), all.length - 1)])?.focus({ preventScroll: true });
      return;
    }
    const input = row.querySelector('.msg-edit-input');
    if (!input) return;
    input.value = edit.value;
    input.dispatchEvent(new Event('input'));
    input.setSelectionRange(edit.start, edit.end);
    // Focus goes back where it was: the box if it was there, else wherever the reader was.
    if (!edit.focused && active && active.isConnected && active !== document.body) active.focus({ preventScroll: true });
  }

  function skeleton() {
    // Able to hold the keyboard (see retryFocus), out of the Tab order.
    const box = el('div', { 'aria-busy': 'true', 'aria-label': 'Loading messages', tabindex: -1, style: { padding: '12px 20px' } });
    for (let i = 0; i < 6; i++) {
      const w = 40 + ((i * 37) % 45);
      box.append(el('div', { style: { display: 'grid', gridTemplateColumns: '36px 1fr', gap: '12px', padding: '8px 0' } },
        el('div.skeleton', { style: { width: '36px', height: '36px', borderRadius: '10px' } }),
        el('div', {},
          el('div.skeleton', { style: { width: '120px', height: '12px', marginBottom: '8px' } }),
          el('div.skeleton', { style: { width: `${w}%`, height: '12px' } }))));
    }
    return box;
  }

  function scrollToBottom() {
    // The bottom of a window opened around an older message is not the end
    // of the conversation: reload the newest page instead.
    if (conv.hasNewer) {
      wantBottom = true;
      wantTop = false; // the latest page lands at its end, whatever was asked for before (see wantTop)
      store.jumpToLatest(convId).catch(() => {});
      return;
    }
    scroller.scrollTop = scroller.scrollHeight;
    rememberScroll();
    stickToBottom = true;
    // Jumping to the new messages the pill announced is reading them.
    if (unseenCount) unreadHeld = false;
    hidePill();
    markSeen();
  }

  function showPill() {
    if (!pill) {
      pill = el('button.jump-pill', { type: 'button', onclick: scrollToBottom });
      scroller.parentElement?.append(pill);
    }
    pill.replaceChildren(
      el('span', { html: icon('arrowDown', 14, 2.4) }),
      el('span', {}, unseenCount ? `${unseenCount} new message${unseenCount === 1 ? '' : 's'}` : 'Jump to latest'));
  }

  /** Scroll one message into view and flash it. False when it is not in the window. */
  function highlight(seq) {
    // In a thread the root row is the parent conversation's message and can
    // carry the same number as a reply; the reply is the one the link means.
    const node = list.querySelector(`.msg:not(.thread-root)[data-seq="${seq}"]`) || list.querySelector(`[data-seq="${seq}"]`);
    if (!node) return false;
    node.scrollIntoView({ block: 'center' });
    rememberScroll();
    node.classList.remove('highlight');
    void node.offsetWidth; // restart the animation when the same message is linked twice
    node.classList.add('highlight');
    node.focus({ preventScroll: true });
    return true;
  }

  /**
   * Bring the place of a message that is not in the window into view: the
   * first message after its number, else the last one before it (the
   * window's end). The top of the window when the message would have been
   * its first (nothing to centre on but the intro above).
   */
  function landNear(seq) {
    const rows = [...list.querySelectorAll('.msg:not(.thread-root)[data-seq]')].filter((r) => r.dataset.seq !== '');
    const after = rows.find((r) => Number(r.dataset.seq) > seq);
    const node = after || rows[rows.length - 1];
    if (!node || node === rows[0]) scroller.scrollTop = 0;
    else node.scrollIntoView({ block: 'center' });
    rememberScroll();
  }

  function hidePill() {
    // Pressed from the keyboard, the pill takes the focus with it as it
    // goes: the newest message, where the pill led, takes it instead, and
    // the next Tab or arrow carries on from there rather than from the top
    // of the page. A mouse press leaves the focus where it falls, as before,
    // so the row under the pointer is the only one lit.
    const had = !!pill && pill.matches(':focus-visible');
    pill?.remove();
    pill = null;
    unseenCount = 0;
    if (had && !destroyed) [...list.querySelectorAll('.msg')].pop()?.focus({ preventScroll: true });
  }

  /** Label the floating pill with the day of the topmost visible divider. */
  function updateDateFloat() {
    if (!dateFloat) return;
    const dividers = list.querySelectorAll('.day-divider');
    if (!dividers.length || !conv.loaded) {
      dateFloat.hidden = true;
      return;
    }
    const top = scroller.getBoundingClientRect().top;
    let label = dividers[0].getAttribute('aria-label');
    let stuck = null;
    for (const d of dividers) {
      const r = d.getBoundingClientRect();
      if (r.top <= top + 12) {
        label = d.getAttribute('aria-label');
        stuck = d;
      } else break;
    }
    // The pill stands in for the divider it covers, so the day is never
    // written twice; the first day's own divider fully on screen floats nothing.
    for (const d of dividers) d.classList.toggle('under-float', d === stuck);
    dateFloat.hidden = !stuck;
    if (stuck) {
      dateFloat.replaceChildren(el('span', {}, label), el('span', { html: icon('chevDown', 14, 2.4) }));
      // The pill reads as the day it shows, then what pressing it does: a
      // label naming only the action hid the day from anyone not looking.
      dateFloat.setAttribute('aria-label', `${label}. Jump to a date`);
    }
  }

  function openJumpMenu(anchor) {
    const now = Date.now();
    const day = startOfDay(now);
    const go = (label, fn) => async () => {
      try {
        await fn();
      } catch (e) {
        toast(e.message || `Could not jump to ${label}`, { icon: 'alert' });
      }
    };
    // Any other jump asked for before the beginning has loaded takes the
    // beginning's word back (see wantTop): the page that jump brings is not
    // to land at its top.
    const toDate = (ts) => go('that date', () => { wantTop = false; return store.jumpToDate(convId, ts); });
    // Calendar days back, at local midnight, rather than multiples of 24
    // hours: the day the clocks change is 23 or 25 hours long, so 24 hours
    // before the Monday after it was 23:00 on the Saturday (the jump landed
    // on Saturday night's messages instead of Sunday's first), or 01:00 on
    // the Sunday (its first hour skipped).
    const daysAgo = (n) => {
      const d = new Date(day);
      d.setDate(d.getDate() - n);
      return d.getTime();
    };
    // This day of the month before, or that month's last day when it has no
    // such day: moving the month back on the 31st used to run over into this
    // month (March 31 became "February 31", which is March 3), so "Last
    // month" landed three days back.
    const lastMonth = () => {
      const d = new Date(day);
      const date = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() - 1);
      d.setDate(Math.min(date, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      return d.getTime();
    };
    openMenu(anchor, [
      { header: 'Jump to\u2026' },
      { label: 'Yesterday', onSelect: toDate(daysAgo(1)) },
      { label: 'Last week', onSelect: toDate(daysAgo(7)) },
      { label: 'Last month', onSelect: toDate(lastMonth()) },
      { label: 'The very beginning', onSelect: go('the beginning', () => { wantTop = true; return store.loadAround(convId, 1); }) },
      'sep',
      { label: 'Jump to a specific date', icon: 'calendar', onSelect: async () => { const t = await pickDateDialog(); if (t) toDate(t)(); } },
      { label: 'Latest messages', icon: 'arrowDown', onSelect: go('the latest messages', () => { wantTop = false; return store.jumpToLatest(convId); }) },
    ], { label: 'Jump to' });
  }

  /** Land on the "New" line if there is one, otherwise the bottom. */
  function land() {
    if (destroyed) return;
    const marker = firstUnread && !wantBottom ? list.querySelector('.new-divider') : null;
    wantBottom = false;
    if (marker) {
      marker.scrollIntoView({ block: 'center' });
      rememberScroll();
      stickToBottom = atBottom();
      if (!stickToBottom) showPill();
    } else {
      scrollToBottom();
    }
    markSeen();
  }

  function markSeen() {
    // Not from a list that is gone: the landing, and the scroll to a message
    // that arrived, are done at the next frame, and a reader who moved on
    // before it (a second navigation in the same moment) had the
    // conversation marked read to its end without its messages ever having
    // been on screen.
    if (destroyed || document.hidden || !conv.loaded || unreadHeld) return;
    const last = [...conv.messages].reverse().find((m) => m.seq != null);
    // At the end of the conversation, what was seen is the counter, not the
    // last message on screen: a deleted newest message is never shown and
    // would otherwise stay one unread forever.
    const seq = Math.max(last?.seq || 0, conv.hasNewer ? 0 : conv.seq || 0);
    if (seq && atBottom()) store.markRead(convId, seq);
  }

  /* ---- store events -------------------------------------------------------- */

  const offMessages = store.on('messages', (d) => {
    if (d.conv !== convId) return;
    if (d.reason === 'older-failed') {
      olderFailed = true;
      render();
      return;
    }
    // The same for a page of newer messages (a window opened around an
    // older message pages forward): the loading line gives way to a button
    // to ask again, where it stood until some other change redrew the list.
    if (d.reason === 'newer-failed') {
      newerFailed = true;
      render();
      return;
    }
    if (d.reason === 'older') olderFailed = false;
    if (d.reason === 'newer-page') newerFailed = false;
    if (d.reason === 'older') {
      const before = scroller.scrollHeight;
      const offset = scroller.scrollTop;
      render();
      scroller.scrollTop = offset + (scroller.scrollHeight - before);
      rememberScroll();
      return;
    }
    if (d.reason === 'newer-page') {
      // Appended below the viewport: nothing on screen moves.
      const offset = scroller.scrollTop;
      render();
      scroller.scrollTop = offset;
      rememberScroll();
      if (!conv.hasNewer) stickToBottom = atBottom();
      return;
    }
    // The reader's own message going out ends the "New" line, and a mark
    // unread: what they posted under,
    // they have read, and the line stood over their own words until the
    // conversation was left. Only a message posted now (`added`): a queued
    // one put back at open, or sent again, posts nothing new.
    if (d.reason === 'local' && d.added?.length) {
      firstUnread = 0;
      unreadHeld = false;
    }
    // A message arriving while the tab is put away (another tab in front,
    // the phone's screen off) is not read as it lands (see markSeen, which
    // reads nothing then), and the reader coming back found it under the
    // ones they had read with nothing to tell the two apart, and marked
    // read at once by their return. The "New" line goes over the first such
    // message from someone else, where the list drew none
    // at open (one standing already marks the older place they left), and
    // stands until the conversation is left, as the line drawn at open does.
    if (d.reason === 'newer' && d.added?.length && document.hidden && firstUnread === 0) {
      const first = d.added.filter((m) => m.seq != null && m.user !== store.uuid && m.kind !== 'sys').sort((a, b) => a.seq - b.seq)[0];
      if (first) firstUnread = first.seq;
    }
    const wasAtBottom = atBottom() || !conv.loaded || d.reason === 'init';
    // A jump that failed to load (see openJumpMenu) asks for nothing more of
    // the page that comes next.
    if (d.reason === 'error') wantTop = false;
    render();
    if (d.reason === 'init') {
      const top = wantTop;
      wantTop = false;
      requestAnimationFrame(() => {
        if (top) {
          // "The very beginning": the top of the window (see wantTop).
          scroller.scrollTop = 0;
          rememberScroll();
          stickToBottom = false;
          if (conv.hasNewer || !atBottom()) showPill();
          markSeen();
          return;
        }
        if (d.focus != null) {
          // A permalink: land on the message itself, or say it is gone and
          // land where it stood, on the message now at its place. The list
          // used to stay where the browser left it, at the top of a window
          // loaded around a message fifty messages further down.
          if (!highlight(d.focus)) {
            live.textContent = 'That message is no longer here';
            landNear(d.focus);
          }
          stickToBottom = false;
          if (conv.hasNewer || !atBottom()) showPill();
          markSeen();
          return;
        }
        land();
      });
      return;
    }
    if (d.reason === 'newer' && d.added?.length) {
      const others = d.added.filter((m) => m.user !== store.uuid);
      if (others.length) live.textContent = `${others.length} new message${others.length === 1 ? '' : 's'}`;
      if (wasAtBottom && stickToBottom) {
        // A message arriving under a reader at the bottom is read as it
        // lands, a conversation marked unread included.
        unreadHeld = false;
        // Rechecked at the frame: a wheel processed between this event and
        // the callback ends the following, and the snap must not force it
        // back on (the same reader-first rule the scroll handler keeps).
        atFrame('follow', () => { if (stickToBottom) scrollToBottom(); });
      } else if (others.length) {
        unseenCount += others.length;
        showPill();
      }
      return;
    }
    // The sender's own message goes to the bottom with them. Its confirmation
    // ('sent': the temporary row replaced by the worker's) does not: it lands
    // where the temporary row already stood, and the reader may have moved up
    // meanwhile (a queued message going out when the network is back, a
    // slow post), so it follows the rule every other change does below, and
    // pins the bottom only for a reader who is there. Nor does any other
    // word about a placeholder ('local' with nothing added: a file of a
    // queued message landing and its card turning into the picture, the
    // message set aside or put back in line, one discarded): each of those
    // pulled a reader who had scrolled up into the history back to the
    // bottom, upload after upload, while the message they had written sat
    // where it was.
    if (d.reason === 'local' && d.added?.length) {
      requestAnimationFrame(scrollToBottom);
      return;
    }
    if (wasAtBottom) atFrame('pin', () => {
      if (!stickToBottom && conv.loaded) return; // the reader moved up meanwhile
      scroller.scrollTop = scroller.scrollHeight;
      rememberScroll();
    });
  });

  // Messages becoming unread while none arrived is a mark-unread (what was
  // seen went back); fewer unread is the conversation read on, here or
  // elsewhere, and the mark is over. A new message is neither: it counts as
  // unread until it is read, and reading it is what the reader does next.
  const offActivity = store.on('activity', () => {
    const unread = store.unreadCount(convId);
    const latest = store.latestSeq(convId);
    if (unread > knownUnread && latest === knownLatest) {
      unreadHeld = true;
      // And the mark shows itself at once: the "New" line
      // moves to the message marked (the first loaded one past the cursor
      // the reader set, their own or a system line included, since it is
      // the one they pointed at), and the list is drawn again around it.
      // The line was placed once, when the list opened, so "Mark unread
      // from here" moved the cursor and the sidebar's count and drew
      // nothing here until the conversation was left and opened again. The
      // row under the keyboard (the one marked, with U) keeps it through
      // the redraw (see render), and the reader at the bottom stays there.
      const cursor = latest - unread;
      const first = conv.loaded ? conv.messages.find((m) => m.seq != null && m.seq > cursor) : null;
      if (first && first.seq !== firstUnread) {
        firstUnread = first.seq;
        const wasAtBottom = atBottom();
        render();
        if (wasAtBottom) {
          scroller.scrollTop = scroller.scrollHeight;
          rememberScroll();
        }
      }
    } else if (unread < knownUnread) unreadHeld = false;
    knownUnread = unread;
    knownLatest = latest;
  });

  const offWorkspace = store.on('workspace', () => {
    membersByUsername = store.membersByUsername();
    if (conv.loaded) {
      const wasAtBottom = atBottom();
      render();
      if (wasAtBottom) {
        scroller.scrollTop = scroller.scrollHeight;
        rememberScroll();
      }
    }
  });

  // Up and Down step from a message to the one before or after it while a
  // message itself holds the keyboard, Home and End to the first and the
  // last loaded, the way a list is walked: every message is a
  // Tab stop, and a reader arrowing through the list had, until now, only
  // Tab, which stops at each row's hover bar and reactions on the way. Only
  // the row itself: a control inside it keeps its own keys (the hover bar's
  // arrows step through its buttons, the edit box's move the caret). A
  // modified arrow is a shortcut's (Alt+Up/Down steps between
  // conversations), and one during an IME composition is the IME's; at the
  // ends the key goes on to the browser, which scrolls the list.
  list.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || composing(e)) return;
    const row = e.target;
    if (!(row instanceof HTMLElement) || !row.classList.contains('msg') || document.activeElement !== row) return;
    const rows = [...list.querySelectorAll('.msg')].filter((r) => r.getClientRects().length > 0);
    const i = rows.indexOf(row);
    if (i < 0) return;
    const next = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : e.key === 'ArrowUp' ? Math.max(0, i - 1) : e.key === 'Home' ? 0 : rows.length - 1;
    if (next === i) return;
    e.preventDefault();
    rows[next].focus();
  });

  // A scroll event is not always the reader (see readerMovedUp): while the
  // list follows the bottom, only the reader moving up past the tolerance
  // ends that; a gap reported for any other reason is the layout having
  // moved the bottom on since the last scroll to it, and is closed at once.
  rememberScroll();
  scroller.addEventListener('scroll', () => {
    const movedUp = readerMovedUp(scroller, lastTop, lastMax);
    rememberScroll();
    if (stickToBottom && !conv.hasNewer) {
      if (movedUp) stickToBottom = atBottom();
      else if (needsRepin(scroller)) {
        scroller.scrollTop = scroller.scrollHeight;
        rememberScroll();
      }
    } else {
      stickToBottom = atBottom() && !conv.hasNewer;
    }
    if (atBottom()) markSeen();
    if (stickToBottom) hidePill();
    updateDateFloat();
  }, { passive: true });

  // The list keeps growing after the scroll to the bottom: a picture
  // replaces its skeleton at its own size, a code block is highlighted, a
  // font arrives. Nothing scrolls, so nothing says the bottom moved, and
  // the last message ends up behind the composer until the reader nudges
  // it. While the reader is at the bottom, follow it; the scroller's own
  // size counts too (a composer growing as one types must not hide the
  // last line, and neither must a resized window). Any gap counts, not
  // the reader's tolerance: a pin bar arriving after its pins load, or an
  // attachment row, takes some 36px, and under the tolerance the list
  // would never be put back.
  const resizeObs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
    if (stickToBottom && !conv.hasNewer && needsRepin(scroller)) {
      scroller.scrollTop = scroller.scrollHeight;
      rememberScroll();
    }
  }) : null;
  resizeObs?.observe(list);
  resizeObs?.observe(scroller);

  // The dividers say "Today" and "Yesterday" as of the moment they were
  // drawn, and a conversation left open overnight still said "Today" over
  // yesterday's messages in the morning, the date pill with it. At the next
  // local midnight the labels are written again where they stand (the rows
  // are not redrawn), and the timer is set for the midnight after. A timer
  // in a background tab drifts, and may not fire at all, so the labels are
  // checked again when the tab is shown or the window takes focus.
  let dayTimer = null;
  function relabelDays() {
    for (const d of list.querySelectorAll('.day-divider')) {
      const label = dayLabel(Number(d.dataset.ts));
      if (d.getAttribute('aria-label') === label) continue;
      d.setAttribute('aria-label', label);
      d.replaceChildren(el('span', {}, label));
    }
    updateDateFloat();
  }
  function armMidnight() {
    clearTimeout(dayTimer);
    const next = new Date(Date.now());
    next.setHours(24, 0, 0, 0); // the coming midnight, local, whatever the clocks do that night
    dayTimer = setTimeout(() => {
      if (destroyed) return;
      relabelDays();
      armMidnight();
    }, Math.max(1000, next.getTime() - Date.now() + 500));
  }
  armMidnight();

  const onVisible = () => {
    if (document.hidden) return;
    relabelDays();
    armMidnight();
    markSeen();
  };
  const onFocus = () => {
    relabelDays();
    armMidnight();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onFocus);
  // Messages rendered before the emoji table loaded show shortcodes as typed.
  const onEmoji = () => { if (conv.loaded) render(); };
  window.addEventListener('teamchat:emoji', onEmoji);

  const observer = new IntersectionObserver((entries) => {
    if (!conv.loaded || conv.loading) return;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      if (e.target === top && conv.hasMore) {
        olderFailed = false;
        store.loadOlder(convId).catch(() => {});
        render();
      } else if (e.target === bottom && conv.hasNewer) {
        newerFailed = false;
        store.loadNewer(convId).catch(() => {});
        render();
      }
    }
  }, { root: scroller, rootMargin: '200px 0px 200px 0px' });
  observer.observe(top);
  observer.observe(bottom);

  // Kick off: a linked message that is not in the window loads a window
  // around it; otherwise the newest page, or what is already loaded — which
  // lands as a fresh page does, on the "New" line when there is one (a
  // window kept in memory since the last visit is no different to the
  // reader from one fetched now).
  render();
  let landing = 0; // the kickoff's landing, still to come: a jump to a message asked for meanwhile cancels it
  const has = (seq) => conv.messages.some((m) => m.seq === seq);
  if (focusSeq != null && !(conv.loaded && has(focusSeq))) store.loadAround(convId, focusSeq);
  else if (!conv.loaded) store.loadConversation(convId);
  else if (focusSeq != null) requestAnimationFrame(() => { highlight(focusSeq); stickToBottom = false; if (!atBottom()) showPill(); });
  else landing = requestAnimationFrame(land);

  return {
    el: wrap,
    scroller,
    refresh: render,
    scrollToBottom,
    /** Own most recent message, for ArrowUp-to-edit. */
    lastOwnMessage: () => [...conv.messages].reverse().find((m) => m.user === store.uuid && m.seq != null && m.kind === 'msg' && !m.deleted) || null,
    /** Open the in-place editor on one of the list's own messages. */
    editMessage: (msg, opts) => editMessageIn(list, msg, opts),
    highlight,
    /** Bring a message into view, loading a window around it when needed. */
    jumpTo(seq) {
      cancelAnimationFrame(landing);
      wantTop = false; // a linked message lands on itself (see wantTop)
      if (conv.loaded && has(seq)) {
        highlight(seq);
        stickToBottom = false;
        if (conv.hasNewer || !atBottom()) showPill();
        return;
      }
      store.loadAround(convId, seq);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(landing);
      for (const id of frames.values()) cancelAnimationFrame(id);
      frames.clear();
      offMessages();
      offActivity();
      offWorkspace();
      observer.disconnect();
      resizeObs?.disconnect();
      clearTimeout(dayTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('teamchat:emoji', onEmoji);
      hidePill();
    },
  };
}
