/**
 * The three "what needs me" views that take the main column in place of a
 * conversation: Threads (every thread the user is in, newest activity first,
 * unread replies bolded), Activity (mentions, replies to followed threads,
 * and reactions to the user's messages, filterable), and Later (messages
 * saved for later, with a done toggle). Every row opens the message in
 * context through its permalink route.
 */
import { el, append, listKeyNav, rerender, keepFocus, focusMemo, radioNav } from './dom.js';
import { icon } from './icons.js';
import { avatar } from './avatar.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { api, isOldServer, ApiError } from '../lib/api.js';
import { navigate, parseHash } from '../lib/router.js';
import { previewWords } from './applink.js';
import { relativeLong, fullDateTime } from '../lib/time.js';
import { parentOfThread } from '../shared/blocks.js';
import { emojiFor, canonicalKey, emojiLabel } from '../lib/emoji.js';
import { routeFor } from './pins.js';
import { aroundText, remindPresets, DELIVERY_NOTE } from '../lib/schedule.js';
import { pickTimeDialog, textDialog } from './dialogs.js';
import { openMenu } from './menu.js';
import { confirmDialog } from './modal.js';
import { listDrafts, deleteDraft } from '../lib/drafts.js';
import { renderMessage, startInlineEdit, editBackOf } from './message.js';
import { createComposer } from './composer.js';
import { showMemberCard, confirmBroadcast } from './dialogs.js';
import { threadConvId } from '../shared/blocks.js';
import { LIMITS } from '../shared/limits.js';

const TITLES = {
  threads: ['Threads', 'Every thread you started, replied in, or follow'],
  activity: ['Activity', 'Mentions, replies in threads you follow, reactions, and reminders'],
  later: ['Later', 'Saved messages, reminders, and messages scheduled to send'],
  drafts: ['Drafts & sent', 'What you have not sent yet, what is scheduled, and what you sent'],
};

/**
 * The pane's Back to the channel list, for phones, where the pane fills the
 * screen and the rail that would offer Home is gone: without it, Activity,
 * Later, and the DMs were screens with no way back but the browser's, which
 * an installed app has no chrome for. Hidden from 720px up, where the list
 * and the pane share the sidebar with the rail beside them.
 */
export function paneBack() {
  return el('button.icon-btn.back', {
    type: 'button', html: icon('arrowLeft', 20), 'aria-label': 'Back to channels',
    onclick: () => navigate({ ws: store.wsId }),
  });
}

export function createListView(kind, { pane = false } = {}) {
  const [title, sub] = TITLES[kind];
  // As a pane (beside a conversation, in the sidebar's place) the header is
  // the pane's own; in the main column it is a conversation-style header.
  // On a phone the pane is the screen, and the rail with it is not: the way
  // back to the channel list is a Back of its own (shown there only).
  const header = pane
    ? el('div.pane-head', {}, paneBack(), el('h2.pane-title', {}, title))
    : el('div.conv-header.view-header', {},
      el('button.icon-btn.back', {
        type: 'button', html: icon('arrowLeft', 20), 'aria-label': 'Back to conversations',
        onclick: () => navigate({ ws: store.wsId, view: null }),
      }),
      el('div.view-title', {}, el('h1.conv-title', {}, title), el('span.view-sub', {}, sub)));
  const tools = el('div.view-tools');
  const body = el('div.view-body', { role: 'region', 'aria-label': title });
  // Said aloud as well as shown, once: the words the list stands on when it
  // has no rows ("Nothing saved", "No drafts", "Could not load threads"),
  // as the search and files views say theirs. A filter chosen (Saved,
  // Reminders, Scheduled) keeps the keyboard on its radio while the list
  // empties, so a screen reader heard nothing of it. One region in place
  // from the start, set only when the words change (see draw).
  const status = el('div.visually-hidden', { role: 'status', 'aria-live': 'polite' });
  const say = (text) => { if (status.textContent !== text) status.textContent = text; };
  const root = el(`div.${pane ? 'pane' : 'main'}.list-view${pane ? '.list-pane' : ''}`, {}, header, tools, body, status);
  // Whether the list is before the reader's eyes: the tab in view, and the
  // list drawn by the layout. On a phone the Activity pane stays mounted
  // behind a conversation opened from one of its rows (the sidebar is hidden
  // by the layout, not taken down), and a mention landing then must not be
  // read for a reader who sees only the conversation, any more than one
  // landing in a tab they have left; it is read when the pane is shown
  // again (see readIfSeen).
  const seen = () => !document.hidden && root.getClientRects().length > 0;
  // The list is one workspace's. An action's answer that lands after the
  // reader has switched to another (the shell tears the list down with the
  // switch) says what it did, but must not count this list for the other
  // workspace's badge: the store's counts are the open workspace's, reset
  // and read afresh at the switch (see store.openWorkspace and loadSaved).
  const wsId = store.wsId;
  const here = () => store.wsId === wsId;
  let destroyed = false;
  let filter = kind === 'later' ? 'saved' : kind === 'drafts' ? 'drafts' : 'all';
  let items = [];
  let loading = true;
  let error = null;
  let request = 0;

  if (kind === 'activity' || kind === 'later' || kind === 'drafts') {
    const choices = kind === 'activity'
      ? [['all', 'All'], ['mention', 'Mentions'], ['reply', 'Replies'], ['reaction', 'Reactions'], ['reminder', 'Reminders']]
      : kind === 'drafts' ? [['drafts', 'Drafts'], ['scheduled', 'Scheduled'], ['sent', 'Sent']]
        : [['saved', 'Saved'], ['reminders', 'Reminders'], ['scheduled', 'Scheduled']];
    const seg = el('div.seg.view-seg', { role: 'radiogroup', 'aria-label': 'Show' });
    const rove = radioNav(seg);
    const renderSeg = () => {
      rerender(seg, ...choices.map(([v, label]) => el('button', {
        type: 'button', role: 'radio', 'aria-checked': String(filter === v),
        onclick: () => {
          filter = v;
          renderSeg();
          load();
        },
      }, label)));
      rove();
    };
    renderSeg();
    tools.append(seg);
  }

  async function load(opts) {
    const id = ++request;
    // A reload the reader did not ask for (activity arriving while they are
    // here) keeps what is on screen until the answer lands rather than
    // clearing it for a skeleton: the rows (a caret in a card's reply box
    // went with them, and the reader typed on into nothing), or the words
    // that the list could not load, with Try again (the keyboard on it fell
    // to the page with the words, and a reload that failed as well brought
    // them back with nobody on them). Only a load the reader asked for, or
    // the first, shows the wait.
    const quiet = opts?.quiet === true && (items.length > 0 || !!error);
    // Where the keyboard is in the list before the wait takes its place (on
    // Try again, pressed): the wait has nothing to hold it, so it fell to
    // the page, and a load that failed again brought the words back with
    // nobody on the button. It comes back to the button then, and lands on
    // the list when the load comes. Nothing to note for a quiet reload,
    // which keeps what is on screen, or a load asked for from elsewhere.
    const back = quiet ? null : focusMemo(body);
    loading = true;
    error = null;
    // A page of the Sent list being read belongs to the list this load replaces (see loadMoreSent).
    sentPaging = false;
    sentPageError = null;
    if (!quiet) render();
    // The answer is kept aside until it is known to be the latest one: a
    // request superseded by a quicker click on another filter used to write
    // its rows into `items` all the same, and the next redraw for any other
    // reason (a done toggle, a draft change) drew them through the wrong
    // row renderer.
    let next = [];
    let failed = null;
    let page = { cursor: null, more: false };
    try {
      if (kind === 'threads') next = (await store.loadThreads()).threads;
      else if (kind === 'drafts' && filter === 'drafts') next = listDrafts(store.wsId);
      else if (kind === 'drafts' && filter === 'sent') {
        // The newest page of what the reader wrote; where the next resumes, for Load more (see loadMoreSent).
        const data = await api.search(store.wsId, { from: store.uuid });
        next = data.results;
        page = { cursor: data.cursor || null, more: !!data.hasMore && !!data.cursor };
      } else if (kind === 'activity') next = (await store.loadInbox(filter)).items;
      else if (filter === 'saved') next = await store.loadSaved();
      else {
        const data = await store.loadScheduled();
        next = filter === 'reminders' ? data.reminders : data.scheduled;
      }
    } catch (e) {
      failed = e;
    }
    if (destroyed || id !== request) return;
    // A reload the reader did not ask for that could not be had (the
    // worker down for a moment, the network gone) leaves what is on screen
    // as it was, the rows and the reply half-typed in a card's box with
    // them, as the files view keeps its list when a refresh fails: drawn as
    // a failure, the rows gave way to "Could not load" and Try again, the
    // box and the caret going with them, for news the reader had not asked
    // to see yet. The next poll asks again (see retryQuiet). With nothing on
    // screen to keep (the words that the list could not load), the answer
    // is said as before.
    if (failed && quiet && items.length) {
      loading = false;
      retryQuiet = true;
      return;
    }
    // Opening Activity clears its badge, here and on every other device, but
    // only while the list is seen: the quiet reload that draws news landing
    // while the reader is in another tab, or behind a conversation on a
    // phone, must not read it for them, or the badge went from their phone
    // for a mention nobody had seen. The list is drawn all the same; it is
    // read when it is looked at again (see readIfSeen), as the message list
    // marks its messages seen.
    if (kind === 'activity' && !failed && seen()) store.readInbox().catch(() => {});
    items = next;
    sentPage = page;
    error = failed;
    loading = false;
    // A card's reply box is one element kept across redraws (composerFor)
    // and put back where it was: the caret that was in it returns to it.
    const active = document.activeElement;
    render();
    lastAccess = accessKey();
    if (active instanceof HTMLElement && active !== document.body && active.isConnected && body.contains(active) && document.activeElement !== active) active.focus({ preventScroll: true });
    back?.();
  }

  /**
   * What keeps each thread card from taking replies, if anything (the
   * channel archived, the workspace being moved to another server, the
   * reader not in the channel), as drawn: the thread panel and the
   * conversation column redraw their reply box when this changes under
   * them (see panel.js footKey), and the cards follow the same word. Null
   * where there are no cards.
   */
  const accessKey = () => (kind === 'threads' && !pane
    ? items.map((t) => { const a = store.postAccess(t.conv, { thread: true }); return a.ok ? 'ok' : a.reason || 'no'; }).join(',')
    : null);
  let lastAccess = null;

  // Every action here (done, remove, delete, send now) redraws the list;
  // the control under the keyboard comes back to the same place (a control
  // held busy for its action keeps the keyboard, so the memo finds it; see
  // held).
  function render() {
    if (destroyed) return;
    const restore = focusMemo(body);
    draw();
    restore();
  }

  function draw() {
    // The Threads view's cards, with a list of them standing: the cards are
    // kept and drawn again in place for the fresh entries (see drawCards),
    // rather than the column being emptied and every card built anew. The
    // list is read again, quietly, whenever a reply lands in any followed
    // thread (its count moves; see the 'workspace' listener below), and a
    // card built anew knows nothing of the one it replaces: an edit open on
    // a card, with the words typed into it, an unfolded code block, a menu
    // standing open on a row, and the keyboard on any of them went with the
    // old card at every such reload, which the card's own redraw (see
    // threadCard's draw) had long since been made to keep.
    const standing = kind === 'threads' && !pane && !error && !loading && items.length ? [...body.children].find((n) => n.matches('.view-list.thread-cards')) : null;
    if (standing) {
      say('');
      drawCards(standing);
      return;
    }
    body.replaceChildren();
    if (error) {
      const old = isOldServer(error);
      const heading = old ? 'This needs a newer server' : `Could not load ${title.toLowerCase()}`;
      body.append(el('div.empty', { style: { paddingTop: '48px' } },
        el('div.empty-icon', { html: icon(old ? 'cloud' : 'wifiOff', 24) }),
        el('h3', {}, heading),
        el('p', {}, old ? 'The workspace server updates the next time its owner opens Teamchat.' : error.message),
        !old && el('button.btn.mt', { type: 'button', onclick: load }, 'Try again')));
      say(heading);
      return;
    }
    if (loading) {
      body.append(skeleton());
      return;
    }
    if (!items.length) {
      const empty = emptyState();
      body.append(empty);
      // The index is read a few months at a time, newest first: a first page
      // of the Sent list with nothing in it and older months still to read is
      // not yet "nothing sent" (see loadMoreSent).
      if (filter === 'sent' && sentPage.more) body.append(nextSentPage('Search older months'));
      say(empty.querySelector('h3').textContent);
      return;
    }
    say('');
    const list = el('div.view-list', { role: 'list' });
    if (kind === 'threads' && !pane) {
      list.classList.add('thread-cards');
      drawCards(list);
    } else {
      for (const it of items) {
        list.append(kind === 'threads' ? threadRow(it) : kind === 'activity' ? activityRow(it)
          : filter === 'drafts' ? draftRow(it) : filter === 'sent' ? sentRow(it)
            : filter === 'saved' ? laterRow(it) : filter === 'reminders' ? reminderRow(it) : scheduledRow(it));
      }
    }
    body.append(list);
    // A Snooze menu standing open on a reminder's row: the row drawn in its
    // place keeps the pill lit under the menu (see reminderRow).
    if (menuOn) rowOf(menuOn)?.classList.add('menu-open');
    if (filter === 'sent' && sentPage.more) body.append(nextSentPage('Load more'));
    if (filter === 'scheduled') body.append(el('p.small.muted.view-note', {}, DELIVERY_NOTE));
    if (filter === 'sent') body.append(el('p.small.muted.view-note', {}, 'The newest messages you sent that the search index knows about. Messages from before the index learned who wrote what appear once an admin rebuilds it from Workspace settings.'));
  }

  function emptyState() {
    const copy = {
      threads: ['No threads yet', 'Reply to a message, or follow a thread from its panel, and it shows up here.'],
      activity: [filter === 'all' ? 'Nothing new' : `No ${filter === 'mention' ? 'mentions' : filter === 'reply' ? 'replies' : filter === 'reminder' ? 'reminders' : 'reactions'} yet`, 'Mentions of you, replies in threads you follow, reactions to your messages, and reminders land here.'],
      drafts: filter === 'drafts' ? ['No drafts', 'Start typing in any conversation and leave; what you wrote waits here until you send or delete it.']
        : filter === 'scheduled' ? ['Nothing scheduled', 'Use the arrow next to Send to write something now and send it later.']
          : sentPage.more ? ['Nothing so far', 'Older months have not been searched yet.']
            : ['Nothing sent yet', 'Messages you send show up here, newest first.'],
      later: filter === 'saved' ? ['Nothing saved', 'Choose "Save for later" from a message’s menu to keep it here until you are done with it.']
        : filter === 'reminders' ? ['No reminders', 'Choose "Remind me about this" from a message’s menu and it comes back here, and in Activity, at the time you pick.']
          : ['Nothing scheduled', 'Use the arrow next to Send to write something now and send it later.'],
    }[kind];
    return el('div.empty', { style: { paddingTop: '48px' } },
      el('div.empty-icon', { html: icon(kind === 'threads' ? 'messages' : kind === 'activity' ? 'bell' : kind === 'drafts' ? (filter === 'sent' ? 'send' : filter === 'scheduled' ? 'clock' : 'pencil') : 'bookmark', 24) }),
      el('h3', {}, copy[0]), el('p', {}, copy[1]));
  }

  function skeleton() {
    const box = el('div', { 'aria-busy': 'true', 'aria-label': 'Loading', style: { padding: '12px 20px' } });
    for (let i = 0; i < 5; i++) {
      box.append(el('div', { style: { display: 'grid', gridTemplateColumns: '24px 1fr', gap: '12px', padding: '10px 0' } },
        el('div.skeleton', { style: { width: '24px', height: '24px', borderRadius: '7px' } }),
        el('div', {}, el('div.skeleton', { style: { width: '160px', height: '12px', marginBottom: '8px' } }),
          el('div.skeleton', { style: { width: `${40 + ((i * 31) % 45)}%`, height: '12px' } }))));
    }
    return box;
  }

  /* ---- the Sent list's pages -------------------------------------------- */

  /**
   * The Sent list is a search for what the reader wrote (from:@me), which
   * comes a page at a time as the search results do: where the next page
   * resumes and whether there is one, whether it is being read, and a page
   * that could not be read (the rows already here stand, and the failure is
   * said under them with a Try again; see search.js nextPage). The tab used
   * to read the first page alone, some fifty messages, with no way to the
   * rest. One page at a time; the answer to a page asked for before a
   * fresh load (the tab switched away and back) is let go.
   */
  let sentPage = { cursor: null, more: false };
  let sentPaging = false;
  let sentPageError = null;
  async function loadMoreSent() {
    if (sentPaging || loading || !sentPage.more) return;
    const id = request;
    sentPaging = true;
    render();
    try {
      const data = await api.search(wsId, { from: store.uuid, cursor: sentPage.cursor });
      if (destroyed || id !== request) return;
      const have = new Set(items.map((m) => `${m.conv}:${m.seq}`));
      items = items.concat((data.results || []).filter((m) => !have.has(`${m.conv}:${m.seq}`)));
      sentPage = { cursor: data.cursor || null, more: !!data.hasMore && !!data.cursor };
      sentPageError = null;
    } catch (e) {
      if (destroyed || id !== request) return;
      sentPageError = e;
    } finally {
      if (!destroyed && id === request) {
        sentPaging = false;
        render();
      }
    }
  }

  /**
   * The way to the next page: the button alone, or, after a page that could
   * not be read, why it could not over a Try again that asks for that page
   * again. Busy rather than disabled while the page is read (see pressOnce
   * in dom.js), so the keyboard stays on it.
   */
  function nextSentPage(label) {
    const more = el('div.search-more', {}, el('button.btn.btn-outline', {
      type: 'button', 'aria-busy': sentPaging ? 'true' : null, onclick: () => loadMoreSent(),
    }, sentPaging ? 'Loading' : sentPageError ? 'Try again' : label));
    if (!sentPageError) return more;
    return el('div', {}, el('p.search-more-note.small', {}, `Could not load more. ${sentPageError.message}`), more);
  }

  /* ---- rows -------------------------------------------------------------- */

  function where(conv) {
    const thread = parentOfThread(conv);
    return `${store.convTitle(thread ? thread.conv : conv)}${thread ? ' thread' : ''}`;
  }

  function messageLine(m) {
    if (!m) return 'Open to read';
    if (m.deleted) return 'This message was deleted';
    return previewWords(m.text, 160) || (m.attachments?.length ? `${m.attachments.length} file${m.attachments.length === 1 ? '' : 's'}` : '');
  }

  /**
   * The reminder whose Snooze menu stands open, if any: its row keeps the
   * pill the menu hangs from lit by a class (see .later-row.menu-open), and
   * a redraw while the menu stands (a quiet reload landing) draws the row's
   * replacement with the class too (see draw), as the message list carries
   * its rows' class; the menu closing takes it off both (see reminderRow).
   */
  let menuOn = null;
  const rowOf = (key) => [...body.querySelectorAll('.later-row')].find((n) => n.dataset.entry === key) || null;

  /** Replies shown under a thread's root before "Show more". */
  const THREAD_TAIL = 3;
  const composers = []; // one per thread card, destroyed with the view
  const watched = new Set(); // thread conversations whose changes redraw their card
  const cards = new Map(); // thread conversation -> its card, kept across the list's redraws (see drawCards)

  /**
   * The cards for the threads listed, in the list's order, in `list`. A card
   * already standing for a thread still listed is kept and drawn again for
   * the thread's fresh entry (its count, its root as the worker has it now),
   * which keeps what the card holds (see threadCard's draw: an edit open on
   * a row and its words, an unfolded code block, a menu on a row, the
   * keyboard on any control of it); a card for a thread no longer listed
   * goes. Cards are moved only where the order has changed, and the
   * keyboard, which a browser takes off a control the moment its card is
   * lifted out of the page (even to be put back a step along), is put back
   * on that control before the cards are drawn again, so each card's own
   * redraw finds it where it was and keeps it there.
   */
  function drawCards(list) {
    const active = document.activeElement;
    const keep = new Set();
    const fresh = new Set();
    items.forEach((t, i) => {
      const id = threadConvId(t.conv, t.seq);
      keep.add(id);
      let card = cards.get(id);
      if (!card) {
        card = threadCard(t);
        cards.set(id, card);
        fresh.add(id);
      }
      if (list.children[i] !== card) list.insertBefore(card, list.children[i] || null);
    });
    for (const [id, card] of [...cards]) {
      if (keep.has(id)) continue;
      cards.delete(id);
      card.remove();
    }
    if (active instanceof HTMLElement && active !== document.body && active.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
    for (const t of items) {
      const id = threadConvId(t.conv, t.seq);
      if (!fresh.has(id)) cards.get(id).update(t);
    }
  }

  /**
   * The replies of each card are the thread's own conversation, read once
   * per card: a few reads at a time, in the order the cards stand, rather
   * than one for every card in the same instant. The list runs to sixty
   * threads, and opening it fired sixty reads at once, queued behind one
   * another at the browser and at the worker, the poll waiting its turn
   * among them; the first cards, the ones in view, are read first and drawn
   * as their answers come, the rest as the reads before them finish, each
   * saying "Loading replies" meanwhile. A thread read meanwhile by someone
   * else (its panel opened, another card) is passed over. Nothing more is
   * read for a view that has gone.
   */
  const REPLY_READS_AT_ONCE = 6;
  const replyQueue = [];
  let replyReads = 0;
  function loadReplies(threadId) {
    const c = store.conv(threadId);
    if (c.loaded || c.loading) return;
    if (replyReads >= REPLY_READS_AT_ONCE) {
      replyQueue.push(threadId);
      return;
    }
    replyReads++;
    store.loadConversation(threadId).catch(() => {}).finally(() => {
      replyReads--;
      if (destroyed) return;
      while (replyQueue.length && replyReads < REPLY_READS_AT_ONCE) loadReplies(replyQueue.shift());
    });
  }

  /**
   * A thread as the Threads view shows it: where it is and who is in
   * it, the root message, the newest replies (older ones behind "Show N
   * more replies", which opens the thread), and a reply box of its own.
   * Replies come from the thread's own conversation in the store, so
   * reactions and edits there work as they do anywhere.
   */
  function threadCard(entry) {
    // The thread's entry as the worker last listed it: its count of unread
    // replies, when it last moved, its root. Replaced by the list's redraw
    // for a card kept across it (see drawCards and update below); the
    // thread itself, its conversation and its number, never changes.
    let t = entry;
    const threadId = threadConvId(t.conv, t.seq);
    const card = el('article.thread-card', { role: 'listitem' });
    const open = () => navigate({ ws: store.wsId, conv: t.conv, thread: t.seq, view: null });
    const draw = () => {
      card.classList.toggle('unread', !!t.unread);
      card.setAttribute('aria-label', `Thread in ${store.convTitle(t.conv)}`);
      const c = store.conv(threadId);
      const replies = c.messages.filter((m) => m.seq != null && !m.deleted);
      const root = store.conv(t.conv).messages.find((m) => m.seq === t.seq) || t.root;
      const total = Math.max(root?.replyCount || 0, replies.length);
      const tail = replies.slice(-THREAD_TAIL);
      const hidden = total - tail.length;
      const people = [...new Set([root?.user, ...replies.map((m) => m.user)].filter(Boolean))];
      const names = people.map((u) => (u === store.uuid ? 'you' : store.member(u).name.split(' ')[0]));
      const who = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(names.length === 2 ? ' and ' : ', ');
      const ch = store.channel(t.conv);
      const ctx = (conv, extra) => ({ convId: conv, inThread: true, rootSeq: t.seq, parentConv: t.conv, onShowMember: showMemberCard, membersByUsername: store.membersByUsername(), ...extra });
      // A redraw while the reply box has the caret (someone else's reply
      // landing) must not take it away: the composer is the same element,
      // put back where it was, and gets focus again; a focused message row
      // is found again by its number.
      const active = document.activeElement;
      // An edit standing open on one of the card's rows (Edit message from
      // the row's menu, E on the row) survives the redraw as one in the
      // message list does (see messagelist's restoreEdit): the box, its
      // words, the caret and the keyboard move to the row's replacement.
      // Drawn without it, a reply landing in the thread, or any message
      // landing in the channel (the root's conversation redraws the card
      // too), took the box and the words typed into it away mid-sentence.
      const editRow = card.querySelector('.msg.editing');
      const editInput = editRow?.querySelector('.msg-edit-input');
      const edit = editInput ? {
        seq: editRow.dataset.seq, root: editRow.classList.contains('thread-root'),
        value: editInput.value, start: editInput.selectionStart, end: editInput.selectionEnd,
        focused: active === editInput, back: editBackOf(editRow),
      } : null;
      const held = card.contains(active) && active !== editInput ? active : null;
      // A control of the card outside its rows (the channel's name at the
      // top, Open thread, "Show N more replies"): its classes name it (the
      // words of Show more move with every reply), else its name, else its
      // place among the card's controls outside the rows, noted before the
      // redraw takes the old ones down. Held only by a row's control, the
      // keyboard on any of these fell to the card's first button, the
      // channel's name, with every reply landing in the thread and every
      // message landing in the channel.
      const label = (n) => n.getAttribute('aria-label') || n.textContent;
      const controls = (r) => [...r.querySelectorAll('button, a[href], [tabindex="0"]')];
      const outside = () => controls(card).filter((n) => !n.closest('.msg'));
      const heldOut = held && !held.closest('.msg')
        ? { classes: (held.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean), label: label(held), index: outside().indexOf(held) }
        : null;
      // A menu standing open on one of the card's rows holds that row lit
      // and its hover bar drawn by a class (see .msg.menu-open): the row
      // drawn anew takes the class, as the message list's redraw hands it
      // on. Drawn without it, the bar the menu hung from dropped away under
      // the open menu each time a reply landed in the thread.
      const menuRow = card.querySelector('.msg.menu-open');
      const menuKey = menuRow ? { seq: menuRow.dataset.seq, root: menuRow.classList.contains('thread-root') } : null;
      // And a code block unfolded to be read ("Show 180 more lines" on a
      // pasted stack trace) stays open, as in the message list (see
      // messagelist's blockKey): every block is drawn folded, so a message
      // landing anywhere in the channel snapped it shut under the eyes,
      // over and over in a busy channel. A block is named by its row and
      // its place among the row's blocks.
      const blockKey = (more) => {
        const r = more.closest('.msg');
        return `${r.dataset.seq}|${r.classList.contains('thread-root')}|${[...r.querySelectorAll('.code-more')].indexOf(more)}`;
      };
      const unfolded = new Set([...card.querySelectorAll('.code-wrap:not(.folded) > .code-more')].map(blockKey));
      card.replaceChildren();
      append(card, [
        el('div.thread-card-head', {},
          el('button.thread-card-where', { type: 'button', onclick: () => navigate({ ws: store.wsId, conv: t.conv, view: null }) },
            el('span', { html: icon(ch ? (ch.private ? 'lock' : 'hash') : 'message', 15, 2.2) }), el('strong', {}, store.convTitle(t.conv).replace(/^#/, ''))),
          who && el('span.thread-card-who', { dir: 'auto' }, who),
          t.unread ? el('span.badge', {}, `${t.unread} new`) : null,
          el('button.btn.btn-sm.btn-ghost.thread-card-open', { type: 'button', onclick: open }, 'Open thread')),
        root ? renderMessage(root, ctx(t.conv, { isRoot: true })) : el('div.msg-loader', {}, 'Loading message'),
        c.loaded && hidden > 0 && el('button.thread-card-more', { type: 'button', onclick: open }, `Show ${hidden} more repl${hidden === 1 ? 'y' : 'ies'}`),
        !c.loaded && !c.error ? el('div.msg-loader', {}, 'Loading replies') : null,
        ...tail.map((m) => renderMessage(m, ctx(threadId))),
        composerFor(threadId, t, root)]);
      if (menuKey) [...card.querySelectorAll('.msg')].find((r) => r.dataset.seq === menuKey.seq && r.classList.contains('thread-root') === menuKey.root)?.classList.add('menu-open');
      if (unfolded.size) for (const more of card.querySelectorAll('.code-wrap.folded > .code-more')) if (unfolded.has(blockKey(more))) more.click();
      if (edit) restoreEdit(edit, active);
      if (held) {
        // The keyboard stays where it was, as the message list keeps it: on
        // the same row, found by its number (a thread's root and its first
        // reply share one; the root is told by its class), and on the same
        // control inside it (a reaction pill, a button of the hover bar,
        // the edit's Save or Cancel), found by its name among the fresh
        // row's controls, else by its place among them. From a control
        // inside a row it used to fall to the card's first button, the
        // channel's name at the top, with every reply landing in the thread
        // and every message landing in the channel.
        const heldRow = held.closest('.msg');
        const fresh = heldRow ? [...card.querySelectorAll('.msg')].find((r) => r.dataset.seq === heldRow.dataset.seq && r.classList.contains('thread-root') === heldRow.classList.contains('thread-root')) : null;
        let again = held.isConnected ? held : null;
        if (!again && fresh) {
          if (held === heldRow) again = fresh;
          // The edit's Save or Cancel, when the box did not come back with
          // the row (its message deleted meanwhile, the channel archived;
          // see restoreEdit): the row itself, where the message was, as the
          // message list has it. By place among the row's controls, the
          // keyboard landed on whatever stood at the box's place in the row
          // without it, a reaction pill or the replies line, a Space away
          // from pressing it.
          else if (held.closest('.msg-edit') && !fresh.querySelector('.msg-edit')) again = fresh;
          else again = controls(fresh).find((n) => label(n) === label(held)) || controls(fresh)[controls(heldRow).indexOf(held)] || fresh;
        } else if (!again && heldOut) {
          // Outside the rows (see heldOut): by its classes, else its name, else its place.
          const outs = outside();
          const sel = heldOut.classes.map((c) => `.${c}`).join('');
          again = (sel && outs.find((n) => n.matches(sel))) || outs.find((n) => label(n) === heldOut.label) || outs[heldOut.index] || null;
        }
        // The row first, then the control inside it, as the message list
        // has it: the row's hover bar is drawn only while the row is under
        // the pointer or holds the keyboard (see .msg-actions), and a
        // browser will not focus a control that is not drawn, so handed
        // straight to a button of the bar the keyboard fell to the page.
        // With the row focused the bar is drawn, and the button takes the
        // keyboard from it.
        if (again && fresh && again !== fresh && fresh.contains(again)) fresh.focus({ preventScroll: true });
        (again || card.querySelector('textarea, button'))?.focus({ preventScroll: true });
      }
    };
    /**
     * The edit that stood open before the redraw, opened again on the row's
     * replacement with its words and caret (see draw). `active` is where the
     * keyboard was before the redraw: opening the box puts the keyboard in
     * it, so it goes back where it was when the box did not hold it (as
     * messagelist's restoreEdit has it), the sidebar's filter, another card's
     * reply box, the "Open thread" of this one; left in the box, every
     * message landing in the channel pulled the reader typing elsewhere into
     * an edit they had walked away from, mid-word.
     */
    const restoreEdit = (edit, active) => {
      const row = [...card.querySelectorAll('.msg')].find((r) => r.dataset.seq === edit.seq && r.classList.contains('thread-root') === edit.root);
      const input = row && startInlineEdit(row, { reveal: false, back: edit.back }) ? row.querySelector('.msg-edit-input') : null;
      if (input) {
        input.value = edit.value;
        input.dispatchEvent(new Event('input'));
        input.setSelectionRange(edit.start, edit.end);
        // A control of the card that the redraw took down is put back by
        // its row and its name below (see held); one still standing (the
        // reply box, kept across redraws; anything outside the card) takes
        // the keyboard back here.
        if (!edit.focused && active && active.isConnected && active !== document.body) active.focus({ preventScroll: true });
        return;
      }
      // The box cannot come back: the message was deleted under it (by its
      // author in another tab, by an admin), or nothing can be changed here
      // any more (the channel archived meanwhile). Said, since the words
      // typed went with the box, and the keyboard lands where the message
      // was, if it was in the box.
      const seq = Number(edit.seq);
      const m = edit.root ? store.conv(t.conv).messages.find((x) => x.seq === seq) || t.root : store.conv(threadId).messages.find((x) => x.seq === seq);
      toast(!m || m.deleted ? 'That message was deleted while you were editing it' : 'Editing stopped: nothing can be changed here now', { icon: 'alert' });
      if (edit.focused) (row || card.querySelector('.msg'))?.focus({ preventScroll: true });
    };
    if (!watched.has(threadId)) {
      watched.add(threadId);
      loadReplies(threadId);
    }
    card.redraw = draw;
    /** The card drawn again for the thread's fresh entry (see drawCards). */
    card.update = (next) => {
      t = next;
      draw();
    };
    card.dataset.thread = threadId;
    draw();
    return card;
  }

  /** The card's reply box; built once per thread so a half-written reply survives a redraw. */
  const composerCache = new Map();
  // Why a reply cannot be posted, in the thread panel's words (see panel.js);
  // a reason neither knows (a shared channel's host out of reach) gets the
  // panel's plain line rather than an invitation to join a channel the
  // reader is in.
  const BLOCKED = {
    archived: 'This channel is archived',
    importing: 'Read-only while this workspace is being imported',
    transferring: 'This workspace is being moved to another server. You can read, but nothing can be posted for a few minutes.',
    not_joined: 'Join the channel to reply',
    threads_off: 'Replies are turned off here',
    threads_admins: 'Only admins can reply here',
  };
  function composerFor(threadId, t, root) {
    // As the thread panel has it: the worker refuses a reply under a root
    // that was deleted (404) and under a line it wrote itself, someone
    // joining or a pin, or a reminder (400), so the card offers no box
    // there either. The card used to offer one under both (the list keeps a
    // deleted root while its replies stand, and a thread an older server
    // let in under a system line), and every reply typed into it came back
    // refused. The root is looked at before the channel: a closed thread
    // is closed whatever the channel would take.
    if (root?.deleted) return el('div.thread-card-blocked', {}, 'This thread is closed: its message was deleted');
    if (root?.kind === 'sys' || root?.kind === 'rem') return el('div.thread-card-blocked', {}, root.kind === 'rem' ? 'Reminders have no thread' : 'System lines have no thread');
    const access = store.postAccess(t.conv, { thread: true });
    // Not kept across redraws: the line has nothing to preserve, and a
    // channel that comes to take replies (its host answering, an archive
    // undone, a move complete) gets its box on the next redraw instead of
    // the stale line. Asked before the cache: a card whose box was built
    // while replies could go used to keep the box when they no longer
    // could, and a reply typed into it only came back refused. The box
    // itself stays cached, with what was typed, for when replies can go
    // again.
    if (!access.ok) return el('div.thread-card-blocked', {}, BLOCKED[access.reason] || 'You cannot reply here');
    if (composerCache.has(threadId)) return composerCache.get(threadId).el;
    const composer = createComposer({
      placeholder: 'Reply…',
      draftKey: `${store.wsId}:${threadId}`,
      convId: t.conv,
      typingConv: threadId,
      // As in the thread panel: the @channel question is asked while the
      // reply is still in the box, and attachments picked offline (`files`,
      // their bytes still on this device) go into the outbox with it.
      beforeSend: (text) => confirmBroadcast(t.conv, text),
      onSend: (text, attachments, files = []) => store.send(threadId, { text, attachments, files }),
    });
    composer.el.classList.add('thread-card-composer');
    composers.push(composer);
    composerCache.set(threadId, composer);
    return composer.el;
  }

  /** A row's list item: the wrapper carries the role, so the button inside keeps its own and is announced as one. */
  const item = (row) => el('div.view-item', { role: 'listitem' }, row);

  function threadRow(t) {
    const root = t.root;
    const author = root ? store.author(root) : null;
    return item(el('button.view-row', {
      type: 'button',
      className: `view-row${t.unread ? ' unread' : ''}`,
      'aria-label': `Thread in ${store.convTitle(t.conv)}${t.unread ? `, ${t.unread} new repl${t.unread === 1 ? 'y' : 'ies'}` : ''}`,
      onclick: () => navigate({ ws: store.wsId, conv: t.conv, thread: t.seq }),
    },
    author ? avatar(author, { size: 'sm' }) : el('span.pin-icon', { html: icon('messages', 16) }),
    el('div.view-row-body', {},
      el('div.view-row-head', {},
        el('span.view-where', { html: icon(store.channel(t.conv) ? 'hash' : 'message', 12, 2.2) }, el('span', { dir: 'auto' }, store.convTitle(t.conv).replace(/^#/, ''))),
        el('time', { datetime: new Date(t.at).toISOString(), title: fullDateTime(t.at) }, relativeLong(t.at))),
      el('div.view-row-text', {}, author && el('strong', {}, `${author.name}: `), messageLine(root)),
      el('div.view-row-meta', {},
        root?.replyCount ? `${root.replyCount} repl${root.replyCount === 1 ? 'y' : 'ies'}` : 'Thread',
        t.unread ? el('span.badge', {}, `${t.unread} new`) : null)),
    el('span.search-hit-go', { html: icon('chevRight', 16) })));
  }

  /** In a pane, the row whose message is open beside it. */
  function current(conv, seq) {
    if (!pane) return null;
    const r = parseHash(location.hash);
    const t = parentOfThread(conv);
    const openConv = t ? t.conv : conv;
    return r.conv === openConv && (r.message === seq || (t && r.thread === t.seq)) ? 'page' : null;
  }

  function activityRow(e) {
    const by = store.member(e.by);
    const m = e.message;
    // A reminder come due is the app's, not something the reader did: its
    // row leads with "Reminder" and the note, under the alarm (as the Later
    // view and the line in their own space have it), rather than with the
    // reader's own name and face as if they had said "reminder: call back".
    const reminder = e.k === 'reminder';
    const what = e.k === 'mention'
      ? (e.bc ? `used @${e.bc}` : 'mentioned you')
      : e.k === 'reply' ? 'replied in a thread you follow'
        : reminder ? (e.note ? `: ${e.note}` : '')
          : e.k === 'huddle' ? 'started a huddle'
            : `reacted ${reactionGlyph(e.r)} to your message`;
    const lead = reminder ? 'Reminder' : by.name;
    return item(el('button.view-row', {
      type: 'button', 'aria-current': current(e.c, e.s),
      // Read aloud, a reaction is named rather than shown by its glyph; the other kinds are read as written.
      'aria-label': `${lead}${reminder ? what : ` ${e.k === 'reaction' ? `reacted with ${emojiLabel(e.r)}` : what}`} in ${where(e.c)}, ${relativeLong(e.ts)}`,
      onclick: () => navigate(routeFor(e.c, e.s)),
    },
    reminder ? el('span.pin-icon', { html: icon('alarm', 16) }) : avatar(by, { size: 'sm' }),
    el('div.view-row-body', {},
      el('div.view-row-head', {},
        el('span', {}, el('strong', { dir: 'auto' }, lead), reminder ? what : ` ${what}`),
        el('time', { datetime: new Date(e.ts).toISOString(), title: fullDateTime(e.ts) }, relativeLong(e.ts))),
      el('div.view-row-text', {}, messageLine(m)),
      el('div.view-row-meta', { html: icon(e.k === 'mention' ? 'at' : e.k === 'reply' ? 'reply' : e.k === 'reminder' ? 'alarm' : e.k === 'huddle' ? 'headphones' : 'smilePlus', 12, 2.2) }, el('span', {}, where(e.c)))),
    el('span.search-hit-go', { html: icon('chevRight', 16) })));
  }

  /** An unsent message: where it is for, what it says so far, and a way to drop it. */
  function draftRow(d) {
    const thread = parentOfThread(d.conv);
    const route = thread ? { ws: store.wsId, conv: thread.conv, thread: thread.seq } : { ws: store.wsId, conv: d.conv };
    const known = store.channel(thread ? thread.conv : d.conv) || store.me?.dms?.[thread ? thread.conv : d.conv];
    return el('div.view-row.later-row.sched-row', { role: 'listitem' },
      el('div.later-where', { dir: 'auto' }, known ? where(d.conv) : 'A conversation you no longer see'),
      el('button.view-main', { type: 'button', 'aria-label': `Open your draft in ${where(d.conv)}`, onclick: () => navigate(route) },
        el('div.view-row-body', {},
          el('div.view-row-head', {}, el('span.view-row-kind', { html: icon('pencil', 13, 2.2) }, el('strong', {}, 'Draft'))),
          el('div.view-row-text', {}, previewWords(d.text, 200) || `${d.attachments.length} file${d.attachments.length === 1 ? '' : 's'}`),
          el('div.view-row-meta', {},
            el('time', { datetime: new Date(d.ts).toISOString(), title: fullDateTime(d.ts) }, relativeLong(d.ts)),
            d.attachments.length && d.text ? el('span', {}, `· ${d.attachments.length} file${d.attachments.length === 1 ? '' : 's'}`) : null))),
      el('div.later-actions', {},
        el('button.icon-btn.icon-btn-sm', {
          type: 'button', html: icon('trash', 15), 'aria-label': 'Delete draft', title: 'Delete draft',
          onclick: () => {
            deleteDraft(d.key);
            // The files the draft had already put up are nobody's now: the
            // worker lets their bytes go (see DELETE /files/:id; one a
            // message names by now stays, and is not ours to worry about).
            // Kept, every attachment of a draft dropped sat in the owner's
            // storage for good, with nothing to find it by.
            for (const a of d.attachments) if (a?.id) api.deleteFile(store.hostRef(d.conv), a.id).catch(() => {});
            items = items.filter((x) => x !== d);
            render();
            toast('Draft deleted', { icon: 'trash' });
          },
        })));
  }

  /** A message the user sent: where, when, what; opens it in place. */
  function sentRow(m) {
    const thread = parentOfThread(m.conv);
    return item(el('button.view-row', {
      type: 'button', 'aria-current': current(m.conv, m.seq),
      'aria-label': `Your message in ${where(m.conv)}, ${relativeLong(m.ts)}. Open`,
      onclick: () => navigate(routeFor(m.conv, m.seq)),
    },
    el('span.view-check.static', { 'aria-hidden': 'true', html: icon('send', 14, 2.2) }),
    el('div.view-row-body', {},
      el('div.view-row-head', {},
        el('span.view-where', { html: icon(store.channel(thread ? thread.conv : m.conv) ? 'hash' : 'message', 12, 2.2) }, el('span', { dir: 'auto' }, where(m.conv).replace(/^#/, ''))),
        el('time', { datetime: new Date(m.ts).toISOString(), title: fullDateTime(m.ts) }, relativeLong(m.ts))),
      el('div.view-row-text', {}, messageLine(m)),
      m.attachments?.length ? el('div.view-row-meta', { html: icon('paperclip', 12, 2.2) }, el('span', {}, `${m.attachments.length} file${m.attachments.length === 1 ? '' : 's'}`)) : null),
    el('span.search-hit-go', { html: icon('chevRight', 16) })));
  }

  function laterRow(s) {
    const m = s.message;
    const author = m ? store.author(m) : null;
    // The card: where the message lives as a small
    // label on top, then the author full size with the message under them,
    // and the actions in a pill that floats in on hover (see .later-actions).
    const row = el('div.view-row.later-row', { role: 'listitem', className: `view-row later-row${s.done ? ' done' : ''}` },
      el('div.later-where', { dir: 'auto' }, where(s.c)),
      el('button.view-main', { type: 'button', 'aria-label': `Open saved message in ${where(s.c)}`, 'aria-current': current(s.c, s.s), onclick: () => navigate(routeFor(s.c, s.s)) },
        author && avatar(author),
        el('div.view-row-body', {},
          el('div.view-row-head', {}, author && el('strong', { dir: 'auto' }, author.name)),
          el('div.view-row-text', {}, messageLine(m)),
          el('div.view-row-meta', {}, `saved ${relativeLong(s.ts)}`))),
      el('div.later-actions', {},
        el('button.view-check', {
          type: 'button', role: 'checkbox', 'aria-checked': String(!!s.done), 'aria-label': s.done ? 'Mark not done' : 'Mark done', title: s.done ? 'Mark not done' : 'Mark done',
          onclick: (e) => {
            // The target state is fixed at the click and the button held while
            // it saves: two quick clicks must not send the same state twice and
            // then flip the row back while the server keeps the first.
            const next = !s.done;
            held(e.currentTarget, async () => {
              try {
                await store.saveDone(s, next);
              } catch (err) {
                // No longer saved (removed meanwhile from another tab or
                // device): the list is read again, quietly, so the row goes
                // as the worker has it, and the words are said as any other
                // refusal's are. Remove ends the same way already (the
                // worker takes a remove of what is not there as done).
                if (err?.code === 'not_found') load({ quiet: true });
                throw err;
              }
              s.done = next;
              if (!here()) return;
              store._savedCount = items.filter((x) => !x.done).length;
              store.emit('activity');
              render();
            });
          },
        }, el('span', { html: icon('check', 14, 3) })),
        el('button.icon-btn.icon-btn-sm', {
          type: 'button', html: icon('x', 15), 'aria-label': 'Remove from Later', title: 'Remove',
          onclick: (e) => held(e.currentTarget, async () => {
            await store.unsave(s.c, s.s);
            items = items.filter((x) => x !== s);
            if (here()) {
              // The badge counts what is not done; the store took one off for
              // the removal whatever the item's state, so a done item removed
              // left the count one short of the rows still open. The list here
              // is the whole of it: count it, as the done toggle does.
              store._savedCount = items.filter((x) => !x.done).length;
              store.emit('activity');
              render();
            }
            toast('Removed from Later');
          }),
        })));
    return row;
  }

  function reminderRow(r) {
    const m = r.message;
    const author = m ? store.author(m) : null;
    const key = String(r.id ?? `${r.conv}:${r.seq}`);
    const snooze = (btn) => {
      // The pill only shows on the row's hover or focus-within, and opening
      // the menu moves focus into it \u2014 off the row \u2014 which would hide the
      // pill under its own open menu; the class holds it in place, as the
      // message toolbar's does (see .later-row.menu-open). A redraw while
      // the menu stands carries it to the row's replacement (see draw), and
      // the menu closing takes it off the row now showing the reminder as
      // well as the one it opened on: left on the replacement, it held the
      // pill lit after the menu had gone.
      const row = btn.closest('.later-row');
      row?.classList.add('menu-open');
      menuOn = key;
      openMenu(btn, [
        { header: 'Snooze until' },
        ...remindPresets().map((p) => ({ label: p.label, sub: aroundText(p.at), onSelect: () => reschedule(r, p.at) })),
        'sep',
        { label: 'Custom time\u2026', icon: 'clock', onSelect: async () => { const t = await pickTimeDialog({ title: 'Snooze until', confirmLabel: 'Snooze', verb: 'Reminds you', initial: r.dueAt, note: null }); if (t) reschedule(r, t); } },
      ], {
        align: 'end', label: 'Snooze',
        onClose: () => {
          if (menuOn === key) menuOn = null;
          for (const n of new Set([row, rowOf(key)])) n?.classList.remove('menu-open');
        },
      });
    };
    return el('div.view-row.later-row', { role: 'listitem', dataset: { entry: key } },
      el('div.later-where', { dir: 'auto' }, where(r.conv)),
      el('button.view-main', { type: 'button', 'aria-label': `Open the message this reminder is about, in ${where(r.conv)}`, onclick: () => navigate(routeFor(r.conv, r.seq)) },
        author && avatar(author),
        el('div.view-row-body', {},
          el('div.view-row-head', {}, el('span.view-row-kind', { html: icon('alarm', 13, 2.2) }, el('strong', {}, aroundText(r.dueAt))), r.note && el('span.muted', {}, r.note)),
          el('div.view-row-text', {}, author && el('strong', {}, `${author.name}: `), messageLine(m)))),
      el('div.later-actions', {},
        el('button.view-check', {
          type: 'button', role: 'checkbox', 'aria-checked': 'false', 'aria-label': 'Done, remove reminder', title: 'Done',
          onclick: (e) => held(e.currentTarget, () => removeEntry(r, 'Reminder done')),
        }, el('span', { html: icon('check', 14, 3) })),
        el('button.icon-btn.icon-btn-sm', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'Snooze', title: 'Snooze', html: icon('clock', 15), onclick: (e) => snooze(e.currentTarget) })));
  }

  /**
   * A scheduled message, waiting or, when the server refused it at its time
   * (the channel archived meanwhile, the author no longer allowed to post
   * there), kept in the queue marked `failed` with the reason the post would
   * have answered with. Such a row reads as not sent, says why and when it
   * was to go, and keeps the same ways out: Edit and Reschedule arm it again
   * (an edit alone at its old, past time, which the next sync tries at once),
   * Send now tries it now, Delete lets it go.
   */
  function scheduledRow(e) {
    const failed = e.failed || null;
    const editText = async () => {
      const next = await textDialog({
        title: 'Edit scheduled message', label: 'Message', initial: e.text, confirmLabel: 'Save', multiline: true,
        maxlength: LIMITS.messageText,
        hint: failed
          ? `Not sent to ${where(e.conv)}: ${failed.message}. Saved, it is tried again at the next sync. Enter saves, Shift+Enter for a new line.`
          : `Sends ${aroundText(e.dueAt)} to ${where(e.conv)}. Enter saves, Shift+Enter for a new line.`,
      });
      if (next == null || next === e.text) return;
      try {
        await store.updateScheduled(e, { text: next });
        e.text = next;
        if (e.failed) {
          e.failed = null;
          toast('Saved. It will be tried again at the next sync.');
        }
        render();
      } catch (err) {
        // Being sent this moment, or gone meanwhile (see rereadFor): the list is read again, so the row goes as the worker has it.
        if (rereadFor(err)) load({ quiet: true });
        toast(err.message, { icon: 'alert' });
      }
    };
    return el(`div.view-row.later-row.sched-row${failed ? '.not-sent' : ''}`, { role: 'listitem' },
      el('div.later-where', { dir: 'auto' }, where(e.conv)),
      el('div.view-main.static', {},
        el('div.view-row-body', {},
          el('div.view-row-head', {}, failed
            ? el('span.view-row-kind.not-sent', { html: icon('alert', 13, 2.2) }, el('strong', {}, 'Not sent'))
            : el('span.view-row-kind', { html: icon('clock', 13, 2.2) }, el('strong', {}, `Sends ${aroundText(e.dueAt)}`))),
          failed && el('p.sched-why', {}, `Not sent: ${failed.message}. It was to go ${aroundText(e.dueAt)}.`),
          el('div.view-row-text', {}, previewWords(e.text, 200) || `${(e.attachments || []).length} file${(e.attachments || []).length === 1 ? '' : 's'}`),
          el('div.view-row-actions', {},
            el('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: editText }, 'Edit'),
            el('button.btn.btn-sm.btn-ghost', {
              type: 'button', 'aria-haspopup': 'menu',
              onclick: (ev) => openMenu(ev.currentTarget, [
                { header: 'Reschedule' },
                ...remindPresets().map((p) => ({ label: p.label, sub: aroundText(p.at), onSelect: () => reschedule(e, p.at) })),
                'sep',
                { label: 'Custom time\u2026', icon: 'clock', onSelect: async () => { const t = await pickTimeDialog({ title: 'Reschedule', initial: e.dueAt }); if (t) reschedule(e, t); } },
              ], { align: 'start', label: 'Reschedule' }),
            }, 'Reschedule'),
            el('button.btn.btn-sm.btn-ghost', {
              type: 'button',
              onclick: (ev) => held(ev.currentTarget, async () => {
                try {
                  await store.updateScheduled(e, { sendNow: true });
                } catch (err) {
                  // The post refused as a live one would be (the channel
                  // archived, admins-only now): the worker keeps the entry
                  // marked with that reason, and so does the row, said in a
                  // toast as well; anything else (the network, the server) is
                  // an error like any other. An entry gone meanwhile (deleted
                  // from another tab) is not marked but read again, so the
                  // list shows what the worker holds.
                  if (!(err instanceof ApiError) || err.status < 400 || err.status >= 500) throw err;
                  // So is one a poll is sending this moment (the list here a
                  // poll behind): the worker says so, and marked "Not sent"
                  // with those words the row would have said the opposite of
                  // what was happening; read again, the list shows the
                  // message gone once it is posted (see rereadFor).
                  if (rereadFor(err)) {
                    load({ quiet: true });
                    throw err;
                  }
                  e.failed = { at: Date.now(), code: err.code, message: err.message };
                  render();
                  toast(`Not sent: ${err.message}`, { icon: 'alert' });
                  return;
                }
                items = items.filter((x) => x !== e);
                if (here()) {
                  store._scheduledCount = items.length;
                  store.emit('activity');
                  render();
                }
                toast('Sent');
              }),
            }, 'Send now'),
            el('button.btn.btn-sm.btn-ghost.danger', {
              type: 'button',
              onclick: async () => {
                // Up to 4,000 characters of drafted text, one ghost button away from gone: ask, as every other delete does.
                const ok = await confirmDialog({ title: 'Delete this scheduled message?', message: 'It will not be sent, and the text is not kept.' });
                if (ok) removeEntry(e, 'Scheduled message deleted').catch((err) => toast(err.message, { icon: 'alert' }));
              },
            }, 'Delete')))));
  }

  /**
   * Whether the worker's refusal means the list here is behind what it
   * holds: the entry is gone (deleted meanwhile from another tab or device,
   * or a reminder come due and delivered), or a poll is sending it this
   * moment. The list is then read again, quietly, so the row goes as the
   * worker has it; said with the worker's words as any other refusal is.
   * Send now had this; Done, Delete, Snooze, Reschedule and Edit answered
   * the same refusal with the words alone, and the row stood on, a reminder
   * that read as undone and a message that read as still to go, until the
   * view was opened afresh (this list is not read again on a poll).
   */
  const rereadFor = (err) => (err?.code === 'not_found' && /scheduled/i.test(err?.message || '')) || err?.code === 'sending';

  async function reschedule(e, at) {
    try {
      await store.updateScheduled(e, { dueAt: at });
      e.dueAt = at;
      e.failed = null; // a new time arms an entry that was not sent
      items.sort((a, b) => a.dueAt - b.dueAt);
      render();
      toast(`Moved to ${aroundText(at)}`);
    } catch (err) {
      if (rereadFor(err)) load({ quiet: true });
      toast(err.message, { icon: 'alert' });
    }
  }

  async function removeEntry(e, msg) {
    try {
      await store.deleteScheduled(e);
    } catch (err) {
      if (rereadFor(err)) load({ quiet: true });
      throw err;
    }
    items = items.filter((x) => x !== e);
    if (here()) {
      if (e.kind === 'reminder') store._reminderCount = items.length;
      else store._scheduledCount = items.length;
      store.emit('activity');
      render();
    }
    toast(msg);
  }

  /**
   * One request per button: the control is held while its action runs, so
   * a second click does not send the same removal or delivery again (the
   * worker answers the repeat with "Nothing scheduled with that id", an
   * error toast right after the success). Held busy rather than disabled
   * (see pressOnce in dom.js): a focused control that is disabled hands the
   * keyboard to the page for the whole wait, so a Tab meanwhile started over
   * from the top of the window, and a screen reader lost its place; busy,
   * the keyboard stays on the control. A row that survives the action (a
   * failure) keeps it there; one that succeeded is redrawn, and the keyboard
   * lands where the control stood (the same mark under its new name, or the
   * row that took a removed one's place; see render).
   */
  async function held(btn, action) {
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true');
    try {
      await action();
    } catch (err) {
      toast(err.message, { icon: 'alert' });
    } finally {
      btn.removeAttribute('aria-busy');
    }
  }

  function reactionGlyph(key) {
    if (!key) return '';
    return emojiFor(key) || `:${canonicalKey(key)}:`;
  }

  // A thread's replies arrive (or change) after its card was drawn: redraw that card alone.
  const offMessages = store.on('messages', (d) => {
    if (kind !== 'threads' || destroyed) return;
    for (const card of body.querySelectorAll(`.thread-card[data-thread="${d.conv}"]`)) card.redraw?.();
    // The root lives in the parent conversation; a change there (a reaction, an edit) redraws too.
    for (const card of body.querySelectorAll('.thread-card')) if (card.dataset.thread.startsWith(`${d.conv}_t`)) card.redraw?.();
  });

  // Rows are buttons, or a box holding one (Later, Drafts, Scheduled): only the buttons take focus.
  listKeyNav(body, 'button.view-row, button.view-main');
  // Drafts change as people type elsewhere (another tab, a thread panel).
  const onDrafts = () => { if (kind === 'drafts' && filter === 'drafts') load({ quiet: true }); };
  window.addEventListener('teamchat:drafts', onDrafts);
  // Activity comes before the reader's eyes again, the tab back in view or
  // the pane shown once more by the route (on a phone, back from the
  // conversation opened from it): what was drawn while it was out of sight
  // is seen now, and read (nothing is asked when there is nothing unread; a
  // list still loading or failed reads when it lands).
  const readIfSeen = () => { if (kind === 'activity' && !loading && !error && seen()) store.readInbox().catch(() => {}); };
  // In a pane the open row follows the route; and the route decides whether
  // the pane is on the screen (the shell's own hashchange handler, installed
  // before this one, has laid the page out for it by now).
  const onHash = () => { if (pane && !loading) render(); readIfSeen(); };
  window.addEventListener('hashchange', onHash);
  const onVisible = readIfSeen;
  document.addEventListener('visibilitychange', onVisible);
  // New activity arrives through the member doc refresh; reload quietly. A
  // quiet reload that failed left the list as it stood (see load): the next
  // poll asks again, whether or not the counts moved meanwhile, one request
  // a poll while the answer does not come.
  let lastKey = null;
  let retryQuiet = false;
  const offWs = store.on('workspace', () => {
    const key = kind === 'threads' ? JSON.stringify(store.me?.threads || {}) : kind === 'activity' ? String(store.inboxUnread()) : null;
    // The retry stands for every list, the Later view's too (whose one quiet
    // reload, after a Send now the worker answered "nothing scheduled with
    // that id", is read for what the worker holds now), though only Threads
    // and Activity reload on their counts moving.
    if (retryQuiet || (key !== null && lastKey !== null && key !== lastKey)) {
      retryQuiet = false;
      load({ quiet: true });
    } else if (!loading && !error) {
      // The list as it stands, its cards' reply boxes giving way to the
      // reason they cannot reply, or coming back, as the workspace changes
      // under them (a move begun or complete, a channel archived or not,
      // the reader joining it); nothing is asked of the worker for that.
      const access = accessKey();
      if (access !== null && lastAccess !== null && access !== lastAccess) render();
      lastAccess = access;
    }
    lastKey = key;
  });
  load();

  return {
    el: root,
    destroy() {
      destroyed = true;
      offWs();
      offMessages();
      for (const c of composers) c.destroy();
      window.removeEventListener('teamchat:drafts', onDrafts);
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
