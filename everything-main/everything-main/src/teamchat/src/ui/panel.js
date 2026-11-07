/**
 * The right-hand panel: a thread (root message + replies + composer).
 * Conversation details open as a dialog (see details.js).
 */
import { el, focusables, coarsePointer } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { createMessageList } from './messagelist.js';
import { createComposer } from './composer.js';
import { createTypingLine } from './typing.js';
import { renderMessage } from './message.js';
import { store } from '../lib/store.js';
import { api } from '../lib/api.js';
import { threadConvId } from '../shared/blocks.js';
import { LIMITS } from '../shared/limits.js';
import { absoluteLink } from '../lib/router.js';
import { showMemberCard, confirmBroadcast } from './dialogs.js';

function panelHead(title, sub, onClose, ...extra) {
  return el('div.panel-head', {},
    el('h2', {}, title, sub && el('span.panel-sub', {}, sub)),
    ...extra,
    el('button.icon-btn', { type: 'button', html: icon('x', 20), 'aria-label': 'Close panel', onclick: onClose }));
}

/* ---------------------------------------------------------------------------- */
/* Thread                                                                       */
/* ---------------------------------------------------------------------------- */

export function renderThreadPanel(panel, { convId, seq, focusSeq = null, onClose }) {
  const threadId = threadConvId(convId, seq);
  const body = el('div.panel-body');
  // The root as the parent's window holds it, or, once fetched on its own
  // (see loadRoot), the copy this panel holds. Declared before the bell,
  // which reads it.
  let root = store.conv(convId).messages.find((m) => m.seq === seq) || null;
  // Follow or unfollow: the author and repliers follow by default; anyone
  // else can opt in, and anyone can opt out. Read from the root as this
  // panel holds it (see the store's followsThread `shown`): read from the
  // channel's window alone, a thread opened from a link or the Threads view
  // while the window did not reach its root showed its own author, and
  // anyone who had replied, as not following, so the bell offered to follow
  // what they followed already, and unfollowing took two presses.
  const followBtn = el('button.icon-btn', { type: 'button', 'aria-pressed': 'false', 'aria-haspopup': null });
  const renderFollow = () => {
    const on = store.followsThread(convId, seq, root);
    followBtn.innerHTML = icon(on ? 'bell' : 'bellOff', 18);
    followBtn.setAttribute('aria-pressed', String(on));
    followBtn.setAttribute('aria-label', on ? 'Following this thread. Unfollow' : 'Follow this thread');
    followBtn.title = on ? 'Following: new replies notify you' : 'Follow thread';
    followBtn.classList.toggle('active', on);
  };
  followBtn.addEventListener('click', async () => {
    const next = !store.followsThread(convId, seq, root);
    try {
      await store.followThread(convId, seq, next, root);
      renderFollow();
      toast(next ? 'Following this thread' : 'Unfollowed this thread', { icon: next ? 'bell' : 'bellOff' });
    } catch (e) {
      toast(e.message, { icon: 'alert' });
    }
  });
  renderFollow();
  panel.replaceChildren(panelHead('Thread', store.convTitle(convId), onClose, followBtn), body);
  // The conversation's name under "Thread", and in "Also send to", follow a
  // rename of the channel while the thread stands open (the list of replies
  // follows the workspace on its own; these two lines kept the name from
  // when the thread was opened).
  let title = store.convTitle(convId);
  const retitle = () => {
    // A conversation that is gone (the channel deleted under the open
    // thread) has no name to follow: the last one stands, rather than the
    // word "Conversation" the store has for a conversation it does not know.
    if (!store.channel(convId) && !store.me?.dms?.[convId]) return;
    const next = store.convTitle(convId);
    if (next === title) return;
    title = next;
    const sub = panel.querySelector('.panel-head .panel-sub');
    if (sub) sub.textContent = next;
    const label = panel.querySelector('.also-send span');
    if (label) label.textContent = `Also send to ${next}`;
  };

  let list = null;
  let composer = null;
  let typing = null;
  let destroyed = false;
  // Where the keyboard lands on a touch screen once the reader has asked for
  // this thread. Elsewhere the reply box takes it (see the composer's
  // autofocus), but not under a finger, where it would raise the phone's
  // keyboard, so on a phone it landed nowhere: the panel floats over the
  // column there, and the "N replies" line tapped to open the thread kept the
  // keyboard under it (a browser focuses a tapped button), so the next step
  // of a keyboard or a screen reader went on through the column beneath the
  // panel rather than into the thread. The panel's first control that is not
  // a text box takes it (the follow bell; Close takes it back to the column
  // on the way out, see the shell's closePanel), once the panel is on the
  // page. Not from a control already in the panel.
  if (coarsePointer()) {
    setTimeout(() => {
      if (destroyed || !panel.isConnected || panel.contains(document.activeElement)) return;
      focusables(panel).find((n) => !/^(input|textarea)$/.test(n.localName))?.focus({ preventScroll: true });
    }, 0);
  }
  // What the root's row at the top of the thread is drawn from. The thread
  // is redrawn when it changes (an edit, a reaction, a pin, the reply count
  // moving, a deletion) and not for every message posted in the channel
  // around it: the parent conversation says "messages" for each of those,
  // and an open thread used to be built again, replies and all, per message
  // in a busy channel. Whether the reader has saved it for later is the
  // row's too (its bookmark button reads it), though it is the reader's and
  // not the message's: saving it from this very row says "messages" for
  // the parent and changes nothing on the message, and the button used to
  // keep offering to save what had just been saved.
  const rootKey = (m) => JSON.stringify([m.text, m.editedAt, !!m.deleted, m.replyCount || 0, m.lastReplyAt, m.reactions, !!m.pinned, m.attachments, m.unfurl, m.mentions, m.broadcast, m.user, m.ts, m.kind, store.isSaved(convId, m.seq)]);
  let rootSig = null;
  // The replies the thread's window held at the last drawing of the head,
  // while it held the whole thread (see rootHeader); null when it did not.
  let lastLoaded = null;

  const showMember = (uuid, anchor) => showMemberCard(uuid, anchor);

  function rootHeader() {
    if (!root) return el('div.msg-loader', {}, 'Loading message');
    const node = renderMessage(root, {
      convId, inThread: true, isRoot: true, rootSeq: seq, parentConv: convId, onShowMember: showMember,
      membersByUsername: store.membersByUsername(),
    });
    const wrap = el('div', {}, node);
    // The root's own count, or the replies loaded here when they outnumber
    // it (never fewer: a long thread's older replies are not loaded yet,
    // and the poll may bring the root's count a moment before the thread's
    // own window). A root fetched on its own (the channel's window not
    // reaching it) is brought up to date by nobody: a reply landing bumps
    // the count on the window's copy alone (see the store's _countReply),
    // and the poll's re-read of the window never reaches it, so the line
    // said "1 reply" over a list of four for as long as the thread stood
    // open. The replies are people's messages: a line the worker wrote into
    // the thread (a reply pinned leaves "Ana pinned a message" among them)
    // counts on no root, and counted here as a reply it made the line say
    // "3 replies" over two.
    const t = store.conv(threadId);
    const loaded = t.messages.filter((m) => m.seq != null && m.kind === 'msg' && !m.deleted).length;
    // A reply gone from a thread whose window holds the whole of it (fewer
    // loaded than at the last drawing: deleted here, or by its author and
    // gone with the poll's re-read) comes off the root's count, when the
    // root is this panel's own copy: the store lowers the window's copy as
    // it takes the reply out (see its remove), but a root fetched on its
    // own is out of its reach, and the line stood one too many over the
    // replies left for as long as the thread was open. The window's copy is
    // left to the store, or the deletion would count twice.
    const whole = t.loaded && !t.hasMore && !t.hasNewer;
    if (whole && lastLoaded != null && loaded < lastLoaded && root.replyCount && !store.conv(convId).messages.some((m) => m.seq === seq)) {
      root.replyCount = Math.max(0, root.replyCount - (lastLoaded - loaded));
    }
    lastLoaded = whole ? loaded : null;
    const count = Math.max(root.replyCount || 0, loaded);
    if (count) wrap.append(el('div.thread-count', {}, `${count} repl${count === 1 ? 'y' : 'ies'}`));
    return wrap;
  }

  /**
   * What stands where the reply box would: the worker refuses a reply to a
   * deleted root with 404. `announce` when the note replaces a box that was
   * there a moment ago: a live region says what changed inside it, so the
   * words go in once the note is on the page, and a screen reader hears
   * why the box is gone rather than nothing at all.
   */
  const closedNote = ({ announce = false } = {}) => {
    const words = 'This thread is closed: its message was deleted';
    const blocked = el('div.composer-blocked', announce ? { role: 'status' } : {}, announce ? '' : words);
    if (announce) requestAnimationFrame(() => { blocked.textContent = words; });
    return el('div.composer-wrap', {}, blocked);
  };

  function mount() {
    if (destroyed) return;
    rootSig = rootKey(root);
    // The bell was drawn before the root was known (fetched on its own, see
    // loadRoot): drawn again from it.
    renderFollow();
    list = createMessageList({
      convId: threadId, inThread: true, rootSeq: seq, parentConv: convId, focusSeq,
      onShowMember: showMember,
      header: rootHeader,
    });
    // A root already deleted when the thread opens (from the "N replies"
    // line under "This message was deleted", a Threads card, an Activity
    // entry, a permalink): the replies are there to read, and the box is
    // not, since every reply typed into it would only come back "Message
    // not found". The same note a deletion while the thread is open leaves.
    body.replaceChildren(list.el);
    if (root.deleted) {
      closed = true;
      foot = closedNote();
      panel.append(foot);
      return;
    }
    // A line the worker wrote (someone joined, a pin, a huddle that ended;
    // a reminder) has no thread, and the worker refuses a reply under one:
    // the rows offer no "Reply in thread", but a link to the thread
    // (`/t/<seq>`) opens this panel all the same, and it offered the reply
    // box and the follow bell as under any message. What replies an older
    // server let in are there to read; the box is not.
    if (root.kind === 'sys' || root.kind === 'rem') {
      closed = true;
      // The bell goes: a keyboard on it (landed there on a touch screen, above) moves to Close rather than falling to the page.
      if (document.activeElement === followBtn) panel.querySelector('.panel-head [aria-label="Close panel"]')?.focus({ preventScroll: true });
      followBtn.hidden = true;
      foot = el('div.composer-wrap', {}, el('div.composer-blocked', {}, root.kind === 'rem' ? 'Reminders have no thread' : 'System lines have no thread'));
      panel.append(foot);
      return;
    }
    typing = createTypingLine(threadId);
    renderFoot();
  }

  /**
   * What stands where the reply box would when no reply can go here: the
   * words the conversation column shows where it has them (an archived
   * channel, an import), the thread's own where it does not. `announce`
   * when the note replaces a box that was there a moment ago, as closedNote.
   */
  const blockedNote = (reason, { announce = false } = {}) => {
    const why = {
      archived: ['archive', 'This channel is archived. Nobody can post here.'],
      moved: ['refresh', 'Read-only: this workspace moved to another server. Continue there to reply.'],
      importing: ['download', 'Read-only while this workspace is being imported. Posting opens when it is done.'],
      transferring: ['refresh', 'This workspace is being moved to another server. You can read, but nothing can be posted for a few minutes.'],
      not_joined: [null, 'Join the channel to reply'],
      threads_off: [null, `Replies are turned off in #${store.channel(convId)?.name}`],
      threads_admins: [null, 'Only admins can reply in this channel’s threads'],
    };
    const [ic, words] = why[reason] || [null, 'You cannot reply here'];
    const text = el('span', {}, announce ? '' : words);
    if (announce) requestAnimationFrame(() => { text.textContent = words; });
    return el('div.composer-wrap', {}, el('div.composer-blocked', { html: ic ? icon(ic, 16) : null, role: announce ? 'status' : null }, text));
  };

  // "Also send to #channel" under the reply box: the reply also
  // lands in the conversation, pointing back at the thread. Made afresh
  // with each box (see renderFoot).
  let also = null;
  // The tick as the reader left it, kept through a rebuild of the box (see
  // renderFoot): the box takes its words and caret across such a rebuild,
  // and the row made afresh beside it came back unticked.
  let ticked = false;
  const alsoRow = () => {
    also = el('input', { type: 'checkbox', id: `also-${threadId}`, checked: ticked });
    return el('label.also-send', { for: also.id }, also, el('span', {}, `Also send to ${store.convTitle(convId)}`));
  };

  /**
   * A reply's copy for the channel, pointing back at the thread (the "Also
   * send to" tick): the renderer draws a permalink into this workspace as
   * words — "thread in #general" — so the line reads "Also sent from thread
   * in #general"; where only the address can show, it still reads. The copy
   * must fit the message cap with that line intact (the worker cuts what
   * does not fit from the end, which is the line): a reply that fills the
   * box gives way and ends in an ellipsis, the way a forwarded quote does;
   * the thread has it whole.
   */
  const withThreadLink = (text) => {
    const link = absoluteLink({ ws: store.wsId, conv: convId, thread: seq });
    const tail = `\n\n> Also sent from ${link}`;
    const room = LIMITS.messageText - tail.length;
    const head = text.length > room ? `${text.slice(0, room - 1).replace(/\s+\S*$/, '')}…` : text;
    return `${head}${tail}`;
  };
  /** Whether the tick asks for the copy, and the channel takes one; the tick comes off as the copy goes. */
  const takeAlso = () => {
    if (!also?.checked || !store.postAccess(convId).ok) return false;
    also.checked = false;
    ticked = false;
    return true;
  };

  let foot = null; // the reply box, or the note standing where it would
  let footState = null; // what the foot was last built for, see footKey
  let closed = false; // the root is deleted: no reply can go, whatever the access
  const footKey = () => {
    const a = store.postAccess(convId, { thread: true });
    return JSON.stringify([a.ok, a.reason, store.postAccess(convId).ok]);
  };

  /**
   * The reply box, or the note saying why there is none, for the access of
   * the moment. `redraw` when it replaces one already there: the channel
   * was archived or unarchived, its thread policy changed, the member
   * joined it, while the thread stood open. The conversation column
   * redraws its own box on the same changes; the panel used to keep the
   * box it opened with, and a reply typed into it after the channel was
   * archived only came back refused. A box rebuilt after a note takes the
   * draft the old one left and takes nothing from the keyboard (the change
   * is someone else's, and the reader may be typing elsewhere); a keyboard
   * typing into a box that goes moves to the panel's Close, the way out.
   */
  function renderFoot({ redraw = false } = {}) {
    const access = store.postAccess(convId, { thread: true });
    footState = footKey();
    const active = document.activeElement;
    const typingHere = redraw && !!foot && foot.contains(active);
    // The caret, when the keyboard was in the old box: a box rebuilt around
    // it (the channel's own posting rule changed, and with it whether the
    // "Also send to" row is offered) takes its words back from the draft
    // and its caret from here, rather than dropping the keyboard to the
    // page body as the old box goes.
    const caret = typingHere && composer && active === composer.textarea && typeof active.selectionStart === 'number'
      ? { start: active.selectionStart, end: active.selectionEnd } : null;
    if (also) ticked = also.checked; // the tick as the reader left it goes to the row made anew (see alsoRow)
    composer?.destroy();
    composer = null;
    // The typing line stays under the box, as in a conversation.
    const show = (next) => {
      if (foot) foot.replaceWith(next);
      else panel.append(next, typing.el);
      foot = next;
    };
    if (!access.ok) {
      also = null;
      show(blockedNote(access.reason, { announce: redraw }));
      if (typingHere) panel.querySelector('.panel-head [aria-label="Close panel"]')?.focus({ preventScroll: true });
      return;
    }
    composer = createComposer({
      placeholder: 'Reply',
      autofocus: !redraw,
      draftKey: `${store.wsId}:${threadId}`,
      convId,
      typingConv: threadId,
      // `files` are attachments picked while offline, their bytes still on
      // this device; they go with the reply into the outbox as they do in a
      // conversation, or the reply is posted without them.
      beforeSend: (text) => confirmBroadcast(convId, text),
      onSend: async (text, attachments, files = []) => {
        const sent = await store.send(threadId, { text, attachments, files });
        if (takeAlso()) store.send(convId, { text: withThreadLink(text), attachments, files }).catch((e) => toast(e.message || 'Could not send to the channel too', { icon: 'alert' }));
        return sent;
      },
      onSendLater: async (text, attachments, dueAt) => {
        if (!(await confirmBroadcast(convId, text))) throw Object.assign(new Error('Not scheduled'), { code: 'cancelled' });
        const scheduled = await store.schedule(threadId, { text, attachments, dueAt });
        // The tick holds for a reply sent later as for one sent now: its
        // copy for the channel is scheduled for the same moment, pointing
        // back at the thread. Ticked and scheduled, the reply used to go to
        // the thread alone, the toast saying "Scheduled" and the tick
        // standing, and no copy ever reached the channel.
        if (takeAlso()) await store.schedule(convId, { text: withThreadLink(text), attachments, dueAt }).catch((e) => toast(e.message || 'Could not schedule the copy for the channel', { icon: 'alert' }));
        return scheduled;
      },
      // The keyboard comes back to this box when the edit closes (see
      // startInlineEdit's `back`).
      onEditLast: () => {
        const m = list.lastOwnMessage();
        return !!m && list.editMessage(m, { back: composer.textarea });
      },
    });
    if (store.postAccess(convId).ok) composer.el.append(alsoRow());
    show(composer.el);
    if (typingHere) {
      composer.textarea.focus({ preventScroll: true });
      if (caret) composer.textarea.setSelectionRange(caret.start, caret.end);
    }
  }

  // The root may live outside the loaded window (deep link): fetch just it.
  // A fetch that fails is not a message that is gone: offline, or a worker
  // not answering, the panel says so and offers to try again, rather than
  // telling the reader their message was deleted.
  // `keyboard` when "Try again" was pressed from the keyboard: the button
  // goes with the redraw, and the keyboard fell to the page body with it. The
  // loading line holds it meanwhile, and what comes takes it from there: the
  // thread (its reply box, as a thread opening takes the keyboard; its
  // message where there is no box), the button to try once more, or the
  // panel's Close for a message that is gone. A mouse press leaves the focus
  // where it falls, as before.
  const host = store.hostOf(convId);
  const loadRoot = async (keyboard = false) => {
    let error = null;
    if (!root) {
      const wait = el('div.msg-loader', { tabindex: keyboard ? -1 : null }, 'Loading thread');
      body.replaceChildren(wait);
      if (keyboard) wait.focus({ preventScroll: true });
      try {
        const data = await api.messages(host.ref, host.conv, { from: seq, to: seq });
        root = data.messages[0] || null;
      } catch (e) {
        error = e;
      }
    }
    if (destroyed) return;
    if (root) {
      mount();
      if (keyboard && !panel.contains(document.activeElement)) body.querySelector('.msg')?.focus({ preventScroll: true });
      return;
    }
    if (error && error.status !== 404) {
      const retry = el('button.btn.mt', { type: 'button' }, 'Try again');
      retry.addEventListener('click', (e) => loadRoot(e.currentTarget.matches(':focus-visible')));
      body.replaceChildren(el('div.empty', {},
        el('div.empty-icon', { html: icon('wifiOff', 24) }),
        el('h3', {}, 'Could not load this thread'),
        el('p', {}, error.message || 'The workspace server did not answer.'),
        retry));
      if (keyboard) retry.focus({ preventScroll: true });
      return;
    }
    body.replaceChildren(el('div.empty', {}, el('h3', {}, 'Message not found'), el('p', {}, 'It may have been deleted.')));
    if (keyboard) panel.querySelector('.panel-head [aria-label="Close panel"]')?.focus({ preventScroll: true });
  };
  loadRoot();

  // Files dragged over the thread (its message, its replies) are the reply
  // box's, as over the conversation column (see conversation.js): the box
  // lights up as they pass and takes them where they are let go, rather than
  // the drop doing nothing over the replies.
  const overFiles = (e) => !!composer && !e.defaultPrevented && !!e.dataTransfer?.types?.includes('Files') && !composer.el.contains(e.target);
  panel.addEventListener('dragover', (e) => {
    if (!overFiles(e)) return;
    e.preventDefault();
    composer.hintDrop(true);
  });
  panel.addEventListener('dragleave', (e) => {
    if (composer && !(e.relatedTarget instanceof Node && panel.contains(e.relatedTarget))) composer.hintDrop(false);
  });
  panel.addEventListener('drop', (e) => {
    if (!overFiles(e)) return;
    composer.dropFiles(e);
  });

  // Keep the root fresh (reply counts, edits) as the parent conversation updates.
  const off = store.on('messages', (d) => {
    if (d.conv !== convId || !list) return;
    // The root as the parent's window holds it, or, for a root fetched on
    // its own (the window not reaching it: a thread opened from a link or
    // the Threads view), the copy this panel holds, which a reaction put on
    // it from this very panel flips (see store.react's `shown`). Drawn from
    // the window's copy alone, such a reaction went to the worker and showed
    // nowhere until the thread was opened again.
    const fresh = store.conv(convId).messages.find((m) => m.seq === seq) || root;
    if (fresh) {
      root = fresh;
      const sig = rootKey(fresh);
      if (sig !== rootSig) {
        rootSig = sig;
        list.refresh();
      }
      renderFollow();
      // A root deleted from elsewhere closes its thread (the worker refuses
      // a reply with 404): the reply box (or the note standing for it) gives
      // way to the closed note, rather than taking a reply that would only fail.
      if (fresh.deleted && !closed) {
        closed = true;
        // The box goes from under whoever was typing into it: the keyboard's
        // focus, which would fall to the page body with it, moves to the
        // panel's Close, the way out (the note itself is not a control).
        const typingHere = !!foot && foot.contains(document.activeElement);
        composer?.destroy();
        composer = null;
        const note = closedNote({ announce: true });
        if (foot) foot.replaceWith(note);
        else panel.append(note);
        foot = note;
        typing?.el.remove();
        if (typingHere) panel.querySelector('.panel-head [aria-label="Close panel"]')?.focus({ preventScroll: true });
      }
    }
  });
  // The channel changing under the thread (archived, its thread policy,
  // the member joining or leaving it) redraws the reply box, as the
  // conversation column redraws its own.
  const offWs = store.on('workspace', () => {
    if (destroyed) return;
    renderFollow();
    retitle();
    if (!list || closed || footState === null || footKey() === footState) return;
    renderFoot({ redraw: true });
  });

  return {
    jumpTo(replySeq) {
      focusSeq = replySeq;
      list?.jumpTo(replySeq);
    },
    destroy() {
      destroyed = true;
      off();
      offWs();
      list?.destroy();
      composer?.destroy();
      typing?.destroy();
    },
  };
}
