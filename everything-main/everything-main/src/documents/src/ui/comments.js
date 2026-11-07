/**
 * Comments sidebar: threads anchored to text, with reply, resolve, edit, and
 * delete. The panel only renders; every action reports back through
 * `onAction(kind, comment, value)` and the editor talks to the engine.
 *
 * createCommentsPanel({ onAction }) -> { el, update({ items, activeIds, canAdd }), open, close, toggle, onToggle, isOpen }
 */

import { el, clear, relativeTime, isComposing } from './dom.js';
import { icon } from './icons.js';

const LS_KEY = 'documents:comments';

/** Group flat comment records into threads: each root with its replies, in order. */
export function threadComments(items = []) {
  const byId = new Map();
  for (const c of items) {
    if (c.trackedChange) continue; // suggestions show as tracked changes, not comments
    byId.set(c.commentId, c);
  }
  // Resolve ancestry before grouping. Deleting a reply from the lookup while
  // visiting it loses its children when imports list replies before parents.
  const rootIds = new Map();
  const rootFor = (id) => {
    const seen = new Set();
    let root = id;
    while (!rootIds.has(root) && !seen.has(root)) {
      seen.add(root);
      const c = byId.get(root);
      const parent = [c.rootCommentId, c.parentCommentId].find((p) => p && p !== root && byId.has(p));
      if (!parent) break;
      root = parent;
    }
    root = rootIds.get(root) ?? root;
    // Memoize each chain, and collapse malformed cycles without dropping text.
    for (const key of seen) rootIds.set(key, root);
    return root;
  };
  const threads = new Map();
  for (const c of byId.values()) {
    const root = rootFor(c.commentId);
    if (!threads.has(root)) threads.set(root, { root: byId.get(root), replies: [] });
    if (root !== c.commentId) threads.get(root).replies.push(c);
  }
  return [...byId.keys()].filter((id) => threads.has(id)).map((id) => threads.get(id));
}

export function commentsRemembered() {
  try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
}

export function createCommentsPanel({ onAction = () => {} } = {}) {
  let threads = [];
  let activeIds = new Set();
  let openThreadReply = null;
  const replyEditors = new Map();

  const addBtn = el('button.btn.btn-primary.btn-sm', { type: 'button', disabled: true, title: 'Select some text, then add a comment', onclick: () => onAction('add') },
    el('span', { html: icon('suggest', 15, 2) }), el('span', {}, 'Add comment'));
  const list = el('div.comments-list', { role: 'list' });
  const empty = el('p.comments-empty', {}, 'Select text and add a comment to start a conversation about it.');
  const countEl = el('span.badge', { hidden: true });
  const root = el('aside.comments', { 'aria-label': 'Comments', hidden: true },
    el('div.comments-head', {}, el('h2.comments-title', {}, 'Comments', countEl),
      el('button.icon-btn', { type: 'button', 'aria-label': 'Close comments', html: icon('x', 18), onclick: () => close() })),
    el('div.comments-actions', {}, addBtn),
    // The list takes the panel's height, so the hint sits above it to stay under the button.
    empty, list);

  const author = (c) => c.creatorName || 'Someone';
  /** The start of a comment for the card's name; the whole text is read inside the card. */
  const clip = (text) => { const words = String(text).trim().replace(/\s+/g, ' '); return words.length > 80 ? `${Array.from(words).slice(0, 79).join('').trimEnd()}…` : words; };
  const when = (c) => (c.createdTime ? relativeTime(c.createdTime) : '');

  function message(c, { reply = false } = {}) {
    return el(`div.comment-msg${reply ? '.reply' : ''}`, { dataset: { commentId: c.commentId } },
      el('div.comment-meta', {}, el('span.comment-author', {}, author(c)), when(c) && el('span.comment-time', {}, when(c))),
      el('div.comment-text', {}, c.text || ''),
      el('div.comment-tools', {},
        el('button.link-btn', { type: 'button', dataset: { action: 'edit' }, onclick: (e) => { e.stopPropagation(); onAction('edit', c); } }, 'Edit'),
        el('button.link-btn.danger', { type: 'button', dataset: { action: 'delete' }, onclick: (e) => { e.stopPropagation(); onAction('delete', c); } }, 'Delete')));
  }

  function replyBox(thread) {
    const id = thread.root.commentId;
    if (replyEditors.has(id)) return replyEditors.get(id);
    const input = el('textarea.input.comment-input', { rows: 2, placeholder: 'Reply', 'aria-label': 'Reply' });
    let sending = false;
    const cancel = () => {
      // A completed request must not dismiss a newer draft or another thread.
      if (replyEditors.get(id) !== box) return;
      replyEditors.delete(id);
      if (openThreadReply === id) { openThreadReply = null; render(); }
    };
    const error = el('p.field-error', { hidden: true, role: 'alert' });
    const send = async () => {
      const v = input.value.trim(); if (!v || sending) return;
      sending = true; submit.disabled = true; input.readOnly = true; error.hidden = true;
      try {
        // Only a confirmed write clears the draft; an unavailable host must not swallow it.
        if (await onAction('reply', thread.root, v) !== true) throw new Error('Could not send the reply. Try again.');
        cancel();
      } catch {
        error.textContent = 'Could not send the reply. Try again.'; error.hidden = false;
      } finally { sending = false; submit.disabled = false; input.readOnly = false; }
    };
    input.addEventListener('keydown', (e) => {
      if (isComposing(e)) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      if (e.key === 'Escape') cancel();
    });
    const submit = el('button.btn.btn-primary.btn-sm', { type: 'button', onclick: send }, 'Reply');
    const box = el('div.comment-reply-box', { onclick: (e) => e.stopPropagation() }, input, error,
      el('div.row.row-end', {},
        el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: cancel }, 'Cancel'), submit));
    replyEditors.set(id, box);
    return box;
  }

  function render() {
    const focused = list.contains(document.activeElement) ? document.activeElement : null;
    const focusedCard = focused?.closest('.comment-card');
    const previousIndex = focusedCard ? [...list.children].indexOf(focusedCard) : -1;
    const commentId = focused?.closest('.comment-msg')?.dataset.commentId;
    clear(list);
    empty.hidden = threads.length > 0;
    const open = threads.filter((t) => t.root.status !== 'resolved').length;
    countEl.hidden = !open;
    countEl.textContent = String(open);
    for (const t of threads) {
      const resolved = t.root.status === 'resolved';
      const active = activeIds.has(t.root.commentId) || t.replies.some((r) => activeIds.has(r.commentId));
      // The card itself is the way to the commented text; a screen reader hears whose comment it is and that Enter goes there.
      const card = el('article.comment-card', {
        role: 'listitem', tabindex: 0, dataset: { id: t.root.commentId },
        className: `comment-card${resolved ? ' resolved' : ''}${active ? ' active' : ''}`,
        'aria-current': active ? 'true' : null,
        'aria-label': `${resolved ? 'Resolved comment' : 'Comment'} by ${author(t.root)}${t.root.anchoredText ? ` on “${t.root.anchoredText}”` : ''}${t.root.text ? `: ${clip(t.root.text)}` : ''}${t.replies.length ? `, ${t.replies.length} ${t.replies.length === 1 ? 'reply' : 'replies'}` : ''}`,
        'aria-description': 'Press Enter to go to the commented text',
        onclick: () => onAction('jump', t.root),
        onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); onAction('jump', t.root); } },
      },
        t.root.anchoredText && el('div.comment-anchor', { title: t.root.anchoredText }, t.root.anchoredText),
        message(t.root),
        t.replies.map((r) => message(r, { reply: true })),
        openThreadReply === t.root.commentId ? replyBox(t) : el('div.comment-foot', {},
          !resolved && el('button.link-btn', { type: 'button', dataset: { action: 'reply' }, onclick: (e) => {
            e.stopPropagation(); openThreadReply = t.root.commentId; render();
            replyEditors.get(openThreadReply)?.querySelector('textarea').focus();
          } }, 'Reply'),
          el('button.link-btn', { type: 'button', dataset: { action: 'status' }, onclick: (e) => { e.stopPropagation(); onAction(resolved ? 'reopen' : 'resolve', t.root); } }, resolved ? 'Reopen' : 'Resolve')));
      list.append(card);
    }
    if (focused) {
      // Reply editors are reused; other controls are rebuilt. Match their
      // identities without interpolating imported comment IDs into selectors.
      const cards = [...list.children];
      const card = cards.find((item) => item.dataset.id === focusedCard?.dataset.id);
      const action = focused.dataset.action;
      const control = action && card && [...card.querySelectorAll('[data-action]')].find((button) =>
        button.dataset.action === action && button.closest('.comment-msg')?.dataset.commentId === commentId);
      const target = (focused.isConnected && focused) || control || card
        || cards[Math.min(previousIndex, cards.length - 1)] || root.querySelector('[aria-label="Close comments"]');
      target.focus({ preventScroll: true });
    }
  }

  function renderActive() {
    for (const [i, thread] of threads.entries()) {
      const card = list.children[i];
      const active = thread && (activeIds.has(thread.root.commentId) || thread.replies.some((r) => activeIds.has(r.commentId)));
      card.classList.toggle('active', !!active);
      if (active) card.setAttribute('aria-current', 'true'); else card.removeAttribute('aria-current');
    }
  }

  // What the cards show of each comment; a refresh that changes none of it leaves the cards in place.
  const signatureOf = (items) => JSON.stringify(items.map((c) => [c.commentId, c.parentCommentId ?? c.parentId ?? null, c.text, c.status, c.creatorName, c.createdTime, c.anchoredText]));
  let signature = null;
  function update({ items = null, activeIds: ids = null, canAdd = null } = {}) {
    let changed = false;
    if (items) {
      const next = signatureOf(items);
      changed = next !== signature;
      signature = next;
      if (changed) {
        threads = threadComments(items);
        const ids = new Set(threads.map((thread) => thread.root.commentId));
        for (const id of replyEditors.keys()) if (!ids.has(id)) replyEditors.delete(id);
        if (!ids.has(openThreadReply)) openThreadReply = null;
      }
    }
    if (ids) activeIds = new Set(ids);
    if (canAdd != null) { addBtn.disabled = !canAdd; addBtn.title = canAdd ? 'Add a comment on the selected text' : 'Select some text, then add a comment'; }
    if (changed) render();
    else if (ids) renderActive();
  }

  const remember = (open) => { try { if (open) localStorage.setItem(LS_KEY, '1'); else localStorage.removeItem(LS_KEY); } catch { /* storage unavailable */ } };
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(!root.hidden); };
  function open() { if (!root.hidden) return; root.hidden = false; remember(true); emit(); }
  function close() { if (root.hidden) return; root.hidden = true; remember(false); emit(); }
  function toggle() { if (root.hidden) open(); else close(); }

  render();
  return { el: root, update, open, close, toggle, onToggle: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, get isOpen() { return !root.hidden; }, get threads() { return threads; } };
}
