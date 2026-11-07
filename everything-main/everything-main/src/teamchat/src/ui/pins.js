/**
 * Pinned messages: the bar above a conversation ("3 pinned", expanding to
 * the list) and the list itself, shared with the details panel. Each entry
 * opens the message in place through its permalink route.
 */
import { el, focusMemo } from './dom.js';
import { icon } from './icons.js';
import { avatar } from './avatar.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { previewWords } from './applink.js';
import { relativeLong, fullDateTime } from '../lib/time.js';
import { parentOfThread } from '../shared/blocks.js';

/** Route to a message in a conversation, threads included. */
export function routeFor(convId, seq) {
  const thread = parentOfThread(convId);
  return thread ? { ws: store.wsId, conv: thread.conv, thread: thread.seq, message: seq } : { ws: store.wsId, conv: convId, message: seq };
}

/** The person who pinned it, or an admin where the conversation lives (the host's, for a shared channel). */
export function canUnpin(pin, convId = null) {
  return pin.by === store.uuid || (convId ? store.isAdminIn(convId) : store.isAdmin());
}

/** A list of pins with who pinned and when; `onOpen` runs after navigating. */
export function renderPinList(convId, pins, { onOpen, onChange } = {}) {
  const list = el('div.pin-list', { role: 'list' });
  if (!pins.length) {
    list.append(el('div.pin-empty', {}, 'Nothing pinned yet. Pin a message from its menu to keep it here.'));
    return list;
  }
  for (const p of pins) {
    const by = store.member(p.by);
    const m = p.message;
    const author = m ? store.author(m) : null;
    const open = () => {
      navigate(routeFor(convId, p.seq));
      onOpen?.();
    };
    // One unpin at a time: the row goes when the list is redrawn from the
    // worker's answer, and a second tap before that reached the worker too,
    // which answered "That message is not pinned" over the "Unpinned" toast.
    let unpinning = false;
    // No aria-label on the button: one would replace its content for a screen
    // reader, and the content (who wrote what, when, who pinned it) is what
    // tells one pin from the next; the button's own words are its name.
    const row = el('div.pin-row', { role: 'listitem' },
      el('button.pin-main', { type: 'button', onclick: open },
        author ? avatar(author, { size: 'sm' }) : el('span.pin-icon', { html: icon('pin', 16) }),
        el('span.pin-text', {},
          // Times are <time> elements, the full date in their title, as a message's own is.
          el('span.pin-head', {}, el('strong', {}, author ? author.name : 'Message'), m && el('time.muted', { datetime: new Date(m.ts).toISOString(), title: fullDateTime(m.ts) }, relativeLong(m.ts))),
          // The line reads in its own direction (Hebrew, Arabic), as the message does.
          el('span.pin-body', { dir: 'auto' }, m ? (m.deleted ? 'This message was deleted' : previewWords(m.text, 140) || (m.attachments?.length ? `${m.attachments.length} file${m.attachments.length === 1 ? '' : 's'}` : '')) : 'Open to read'),
          el('span.pin-meta', {}, `Pinned by ${p.by === store.uuid ? 'you' : by.name} `, el('time', { datetime: new Date(p.ts).toISOString(), title: fullDateTime(p.ts) }, relativeLong(p.ts))))),
      canUnpin(p, convId) && el('button.icon-btn.icon-btn-sm', {
        type: 'button', html: icon('pinOff', 15), 'aria-label': 'Unpin', title: 'Unpin',
        onclick: async (e) => {
          if (unpinning) return;
          unpinning = true;
          const btn = e.currentTarget;
          btn.setAttribute('aria-busy', 'true');
          try {
            await store.unpin(convId, p.seq);
            toast('Unpinned');
            onChange?.();
          } catch (err) {
            toast(err.message, { icon: 'alert' });
          } finally {
            unpinning = false;
            btn.removeAttribute('aria-busy');
          }
        },
      }));
    list.append(row);
  }
  return list;
}

/**
 * Has a pinned message been edited under a list drawn from `pins`? Read
 * against the conversation's loaded window (a message outside it cannot have
 * been edited from this device, and what the poll brings of it comes with a
 * change of the count or the overlay stamp). For the bar and the details
 * dialog to read the list again on the conversation's own "messages" word,
 * rather than showing the words as they stood when the list was drawn. A
 * deletion unpins, and moves the count, so it is not read here.
 */
export function pinsMoved(convId, pins) {
  const msgs = store.conv(convId).messages;
  return (pins || []).some((p) => {
    const m = msgs.find((x) => x.seq === p.seq);
    return !!m && !!p.message && !m.deleted && (m.text !== p.message.text || (m.editedAt || 0) !== (p.message.editedAt || 0));
  });
}

/**
 * The collapsible bar above the messages. Present only while something is
 * pinned; the count follows the activity poll, the list loads on expand.
 * `onHide` runs when the bar goes (its last pin unpinned) with the keyboard
 * inside it, for the caller to hand the keyboard on: a bar hidden under the
 * keyboard drops it to the page body, where the next Tab starts over from
 * the top of the window.
 */
export function createPinBar(convId, { onHide = null } = {}) {
  const node = el('div.pin-bar', { hidden: true });
  let open = false;
  let count = -1;

  // One read of the list at a time. An unpin from the bar is heard twice, by
  // the activity listener below and by the row's own onChange, and each
  // asked for the list afresh: the second took the first's loading body off
  // the page before the first's answer had filled it, so the list was read
  // twice for one change and the keyboard, put back by the first into a body
  // no longer on the page, fell to the bar's toggle instead of the pin now
  // standing where the unpinned one was. A read asked for while one is out
  // waits for it, and the list is read once more after it lands (from the
  // store's cache when nothing changed meanwhile; from the worker when the
  // count moved again while the first read was out).
  let loading = null;
  let again = false;
  let dead = false; // destroyed: a read landing after that reads nothing more
  let shown = null; // the pins the list was last drawn from (see pinsMoved)
  let stale = false; // a pinned message was edited under the list: the next read goes to the worker
  async function renderList() {
    if (loading) {
      again = true;
      // Closed and opened again while the read is out: the close took the
      // loading body with it, so the wait is said again rather than the bar
      // standing open and empty until the answer comes.
      if (!node.querySelector('.pin-bar-body')) node.append(el('div.pin-bar-body', {}, el('div.msg-loader', {}, 'Loading')));
      return loading;
    }
    const body = el('div.pin-bar-body');
    body.append(el('div.msg-loader', {}, 'Loading'));
    // An unpin redraws the list from the worker's answer: the button under
    // the keyboard comes back to its place in the new list.
    const restore = focusMemo(node);
    node.querySelector('.pin-bar-body')?.remove();
    node.append(body);
    loading = (async () => {
      try {
        const pins = await store.loadPins(convId, { force: stale });
        stale = false;
        shown = pins;
        body.replaceChildren(renderPinList(convId, pins, { onOpen: () => toggle(false), onChange: () => render() }));
      } catch (e) {
        body.replaceChildren(el('div.msg-loader', {}, e.message || 'Could not load pins'));
      }
    })();
    await loading;
    loading = null;
    restore(node);
    if (again) {
      again = false;
      // Not for a bar that is gone (the conversation left while the read was out): the read once more would be for nobody.
      if (open && !dead) await renderList();
    }
    return undefined;
  }

  function toggle(next = !open) {
    open = next;
    node.classList.toggle('open', open);
    node.querySelector('.pin-bar-toggle')?.setAttribute('aria-expanded', String(open));
    if (open) renderList();
    else node.querySelector('.pin-bar-body')?.remove();
  }

  function render() {
    const n = store.pinCount(convId);
    // Whether the keyboard is in the bar as it goes, read before it is
    // hidden (hiding it is what drops the keyboard).
    const inBar = n === 0 && !node.hidden && node.contains(document.activeElement);
    node.hidden = n === 0;
    if (n === 0) {
      // Closed for good, list included: when a pin comes back the bar must
      // reopen collapsed, not over the list of what was unpinned.
      open = false;
      node.classList.remove('open');
      node.querySelector('.pin-bar-body')?.remove();
      if (inBar) onHide?.();
    }
    if (n === count && node.querySelector('.pin-bar-toggle')) {
      if (open) renderList();
      return;
    }
    count = n;
    // The toggle is drawn anew with the count. Under the keyboard (pressed
    // to open the bar, or reached with Tab) as someone else's pin moves the
    // count, the old one left the page with the focus, which fell to the
    // page body; the new one takes it.
    const old = node.querySelector('.pin-bar-toggle');
    const held = !!old && document.activeElement === old;
    old?.remove();
    const fresh = el('button.pin-bar-toggle', {
      type: 'button', 'aria-expanded': String(open), onclick: () => toggle(),
    },
    el('span', { html: icon('pin', 14, 2.2) }),
    el('span', {}, `${n} pinned`),
    el('span.pin-bar-chev', { html: icon('chevDown', 14, 2.4) }));
    node.prepend(fresh);
    if (held) fresh.focus({ preventScroll: true });
    if (open) renderList();
  }

  const off = store.on('activity', () => {
    if (store.pinCount(convId) !== count) render();
  });
  // A pinned message edited while the list is open (the count stands, so
  // the poll says nothing the bar hears): the list is read again from the
  // worker, rather than showing the words as they were when it was drawn.
  const offMessages = store.on('messages', (d) => {
    if (d.conv !== convId || !open || !shown || !pinsMoved(convId, shown)) return;
    stale = true;
    renderList();
  });
  render();
  return {
    el: node,
    destroy() {
      dead = true;
      off();
      offMessages();
    },
  };
}
