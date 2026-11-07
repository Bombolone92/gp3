/**
 * Comments panel: the document's discussions, numbered like their pins.
 * Add a comment (pinned to the selection, or the view's center) or turn
 * on comment mode and click the canvas; reply, @mention people in the
 * document, edit and delete your own comments, resolve and reopen, and
 * filter by open/resolved and by your own. Everything is reachable from
 * the keyboard; Cmd/Ctrl+Enter sends and Escape cancels a comment.
 */
import { h, announce } from '../../lib/dom.js';
import { Panel, emptyState } from '../../ui/panels/panel.js';
import { icon } from '../../ui/icons.js';
import { formatShortcut } from '../../commands/registry.js';
import { defaultLabel } from '../../model/nodes.js';
import { relativeTime } from '../files/naming.js';
import { messagesOf, splitMentions } from './comments.js';
import { colorFor, initials } from './protocol.js';

let composerCounter = 0;
const esc = (s) => (globalThis.CSS?.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));

/** Usernames that can be @mentioned in the active document. */
function mentionable(app) {
  const ed = app.editor;
  const s = ed?.collab;
  if (!s) return [];
  const names = new Map();
  for (const p of s.participants()) names.set(p.username.toLowerCase(), p.username);
  const cached = app.collab.membersCache.get(s)?.data;
  for (const m of cached?.members || []) names.set(m.username.toLowerCase(), m.username);
  if (s.owner?.username) names.set(s.owner.username.toLowerCase(), s.owner.username);
  names.delete(s.user.username.toLowerCase());
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * A comment text box with @mention suggestions (a listbox the arrow keys,
 * Enter and Tab work in), Send and Cancel.
 */
function composer(app, { key, label, placeholder, initial = '', submitLabel = 'Send', onSubmit, onCancel = null, store }) {
  const id = `cmp-${++composerCounter}`;
  const area = h('textarea.comment-input', { id, rows: 2, placeholder, 'aria-label': label, 'data-focus-key': key, 'aria-autocomplete': 'list', 'aria-controls': `${id}-list`, 'aria-expanded': 'false' });
  area.value = store.get(key) ?? initial;
  const list = h('ul.mention-list', { id: `${id}-list`, role: 'listbox', 'aria-label': 'People to mention', hidden: true });
  let options = [];
  let index = 0;
  let range = null;
  const close = () => {
    list.hidden = true;
    area.setAttribute('aria-expanded', 'false');
    area.removeAttribute('aria-activedescendant');
    options = [];
  };
  const choose = (name) => {
    if (!range) return;
    area.value = `${area.value.slice(0, range.start)}@${name} ${area.value.slice(range.end)}`;
    const caret = range.start + name.length + 2;
    area.setSelectionRange(caret, caret);
    store.set(key, area.value);
    close();
    area.focus();
  };
  const renderList = () => {
    list.replaceChildren(
      ...options.map((name, i) =>
        h('li.mention-option', { id: `${id}-opt-${i}`, role: 'option', 'aria-selected': i === index ? 'true' : 'false', onpointerdown: (e) => (e.preventDefault(), choose(name)) }, h('span.mention-avatar', { style: { background: colorFor(name) }, 'aria-hidden': 'true' }, initials(name)), name),
      ),
    );
    list.hidden = !options.length;
    area.setAttribute('aria-expanded', options.length ? 'true' : 'false');
    if (options.length) area.setAttribute('aria-activedescendant', `${id}-opt-${index}`);
    else area.removeAttribute('aria-activedescendant');
  };
  const suggest = () => {
    const caret = area.selectionStart;
    const before = area.value.slice(0, caret);
    const m = /(^|[^\w@])@([A-Za-z0-9_.-]{0,64})$/.exec(before);
    if (!m) return close();
    const q = m[2].toLowerCase();
    options = mentionable(app)
      .filter((n) => n.toLowerCase().startsWith(q))
      .slice(0, 8);
    index = 0;
    range = { start: caret - m[2].length - 1, end: caret };
    renderList();
  };
  const send = () => {
    const text = area.value.trim();
    if (!text) {
      area.focus();
      return;
    }
    store.delete(key);
    onSubmit(text);
  };
  area.addEventListener('input', () => {
    store.set(key, area.value);
    suggest();
  });
  area.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (options.length && !list.hidden) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        index = (index + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
        renderList();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(options[index]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      store.delete(key);
      onCancel();
    }
  });
  area.addEventListener('blur', () => setTimeout(close, 150));
  const buttons = h(
    'div.composer-actions',
    onCancel ? h('button.btn.small', { type: 'button', onclick: () => (store.delete(key), onCancel()) }, 'Cancel') : null,
    h('button.btn.small.primary', { type: 'button', 'data-tip': `${submitLabel} (${formatShortcut('Mod+Enter')})`, onclick: send }, submitLabel),
  );
  return h('div.composer', h('div.composer-field', area, list), buttons);
}

function messageText(text, known) {
  return splitMentions(text, known).map((part) => (part.mention ? h('span.mention', part.text) : part.text));
}

export class CommentsPanel extends Panel {
  static id = 'comments';
  static title = 'Comments';
  static icon = 'message-square';
  static placement = 'strip';

  build() {
    const app = this.app;
    this.drafts = new Map(); // composer key -> text, kept across re-renders
    this.editing = null; // message id being edited
    this.expanded = new Set();
    this.addBtn = h('button.btn.small', { type: 'button', onclick: () => app.commands.run('comments.add') }, icon('message-square-plus', 14), 'Add Comment');
    this.modeBtn = h('button.icon-btn.comment-mode-btn', { type: 'button', 'aria-label': 'Comment mode', 'aria-pressed': 'false', 'data-tip': 'Comment mode: click the canvas to add a comment', onclick: () => app.commands.run('comments.mode') }, icon('map-pin', 16));
    this.filterSel = h(
      'select.comment-filter',
      { 'aria-label': 'Show', onchange: () => app.comments.setFilter(this.filterSel.value) },
      h('option', { value: 'open' }, 'Open'),
      h('option', { value: 'resolved' }, 'Resolved'),
      h('option', { value: 'all' }, 'All'),
    );
    this.mineBox = h('input', { type: 'checkbox', onchange: () => app.comments.setFilter(app.comments.filter, this.mineBox.checked) });
    this.toolbar = h('div.comments-toolbar', this.addBtn, this.modeBtn, h('span.comments-spacer'), this.filterSel, h('label.comment-mine', this.mineBox, 'Mine'));
    this.note = h('p.comments-note', { hidden: true });
    this.body = h('div.comments-body');
    this.empty = emptyState('No document open.');
    this.el.append(this.empty, this.toolbar, this.note, this.body);
    this.el.addEventListener('keydown', (e) => {
      // Typing in comments never reaches the canvas shortcuts.
      if (e.target.matches?.('textarea, input')) e.stopPropagation();
    });
    app.comments.on('ui', (e) => {
      if (e?.focus === 'thread' && app.comments.active) this.expanded.add(app.comments.active);
      if (this.visible) this.update(e);
    });
    let doc = null;
    let off = null;
    const attach = () => {
      off?.();
      doc = app.editor?.doc || null;
      off = doc ? doc.on('comments', () => this.visible && this.update()) : null;
    };
    app.on('active-editor', () => {
      attach();
      this.editing = null;
      if (this.visible) this.update();
    });
    app.collab.on('change', () => this.visible && this.update());
    attach();
  }

  update(e = null) {
    const app = this.app;
    const ed = app.editor;
    const c = app.comments;
    this.empty.hidden = Boolean(ed);
    this.toolbar.hidden = !ed;
    if (!ed) {
      this.body.replaceChildren();
      this.note.hidden = true;
      return;
    }
    const focusKey = document.activeElement?.dataset?.focusKey;
    const caret = focusKey ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    const may = c.canComment(ed);
    this.addBtn.disabled = !may;
    this.modeBtn.disabled = !may;
    this.modeBtn.setAttribute('aria-pressed', String(app.toolId === 'comment'));
    this.modeBtn.classList.toggle('active', app.toolId === 'comment');
    this.filterSel.value = c.filter;
    this.mineBox.checked = c.mine;
    const session = ed.collab;
    if (!may) {
      this.note.hidden = false;
      this.note.textContent = 'You can read comments on this document but not add any.';
    } else if (!session && !app.user) {
      this.note.hidden = false;
      this.note.textContent = 'Comments are saved with this file. Sign in and share the document to discuss it with others.';
    } else this.note.hidden = true;
    const known = new Set([...mentionable(app).map((n) => n.toLowerCase()), (session?.user.username || '').toLowerCase()].filter(Boolean));
    const parts = [];
    if (c.draft) parts.push(this.renderDraft(ed));
    const listed = c.listed(ed);
    if (!listed.length && !c.draft) {
      const total = c.threads(ed).length;
      parts.push(h('p.panel-empty', total ? 'No comments match this filter.' : may ? 'No comments yet. Select an object and choose Add Comment, or turn on comment mode and click the canvas.' : 'No comments yet.'));
    } else if (listed.length) {
      parts.push(h('ul.comment-threads', { 'aria-label': 'Discussions' }, ...listed.map(({ thread, number }) => this.renderThread(ed, thread, number, known))));
    }
    this.body.replaceChildren(...parts);
    if (focusKey) {
      const el = this.el.querySelector(`[data-focus-key="${esc(focusKey)}"]`);
      if (el) {
        el.focus();
        if (caret && el.setSelectionRange) el.setSelectionRange(caret[0], caret[1]);
      }
    } else if (e?.focus === 'draft') this.el.querySelector('[data-focus-key="draft"]')?.focus();
    else if (e?.focus === 'thread' && c.active) this.el.querySelector(`[data-thread="${esc(c.active)}"] .thread-head`)?.focus();
  }

  renderDraft(ed) {
    const c = this.app.comments;
    const a = c.draft.anchor;
    const node = a.node ? ed.doc.get(a.node) : null;
    const where = node ? `On ${defaultLabel(node).replace(/^<(.*)>$/, '$1')}` : 'On the canvas';
    return h(
      'section.comment-draft',
      { 'aria-label': 'New comment' },
      h('p.comment-where', icon('map-pin', 12), where),
      composer(this.app, {
        key: 'draft',
        label: 'New comment',
        placeholder: 'Add a comment. Type @ to mention someone.',
        submitLabel: 'Comment',
        store: this.drafts,
        onSubmit: (text) => {
          const id = c.addThread(text);
          if (id) {
            this.expanded.add(id);
            announce('Comment added.');
          }
        },
        onCancel: () => c.cancelDraft(),
      }),
    );
  }

  renderThread(ed, thread, number, known) {
    const app = this.app;
    const c = app.comments;
    const msgs = messagesOf(thread);
    const shown = msgs.filter((m) => !m.deleted);
    const first = shown[0];
    const open = this.expanded.has(thread.id) || c.active === thread.id;
    const replies = shown.length - 1;
    const color = thread.resolved ? '#7a7a7a' : colorFor(thread.author?.id);
    const head = h(
      'button.thread-head',
      {
        type: 'button',
        'aria-expanded': String(open),
        onclick: () => {
          if (open) {
            this.expanded.delete(thread.id);
            if (c.active === thread.id) c.active = null;
            this.update();
            ed.emit('overlay');
          } else {
            this.expanded.add(thread.id);
            c.open(thread.id);
          }
        },
      },
      h('span.pin-badge', { style: { background: color }, 'aria-hidden': 'true' }, String(number)),
      h(
        'span.thread-summary',
        h('span.thread-meta', h('strong', first?.author?.name || 'Someone'), ' ', h('time', { datetime: new Date(thread.created).toISOString(), title: new Date(thread.created).toLocaleString() }, relativeTime(thread.created))),
        h('span.thread-preview', first ? first.text : ''),
        h('span.thread-extra', [replies ? `${replies} ${replies === 1 ? 'reply' : 'replies'}` : '', thread.resolved ? 'Resolved' : ''].filter(Boolean).join(' · ')),
      ),
      h('span.sr-only', `Comment ${number}`),
    );
    const li = h(`li.comment-thread${c.active === thread.id ? '.active' : ''}${thread.resolved ? '.resolved' : ''}`, { 'data-thread': thread.id }, head);
    if (!open) return li;
    const may = c.canComment(ed);
    const list = h('ol.comment-messages', { 'aria-label': `Comment ${number} messages` });
    for (const m of msgs) {
      if (m.deleted) {
        list.append(h('li.comment-message.deleted', h('p.comment-text', 'Comment deleted')));
        continue;
      }
      const mine = c.isMine(m, ed);
      const editingThis = this.editing === m.id;
      const actions = mine && may && !editingThis ? h('div.message-actions', h('button.icon-btn', { type: 'button', 'aria-label': 'Edit comment', 'data-tip': 'Edit', onclick: () => ((this.editing = m.id), this.update()) }, icon('pencil', 13)), h('button.icon-btn', { type: 'button', 'aria-label': 'Delete comment', 'data-tip': 'Delete', onclick: () => this.confirmDelete(thread, m) }, icon('trash', 13))) : null;
      list.append(
        h(
          'li.comment-message',
          h('div.message-head', h('span.mention-avatar', { style: { background: colorFor(m.author?.id) }, 'aria-hidden': 'true' }, initials(m.author?.name)), h('strong', m.author?.name || 'Someone'), h('time', { datetime: new Date(m.created).toISOString(), title: new Date(m.created).toLocaleString() }, relativeTime(m.created)), m.edited ? h('span.message-edited', '(edited)') : null, actions),
          editingThis
            ? composer(app, {
                key: `edit-${m.id}`,
                label: 'Edit comment',
                initial: m.text,
                submitLabel: 'Save',
                store: this.drafts,
                onSubmit: (text) => {
                  this.editing = null;
                  c.edit(thread.id, m.id, text);
                },
                onCancel: () => {
                  this.editing = null;
                  this.update();
                },
              })
            : h('p.comment-text', messageText(m.text, known)),
        ),
      );
    }
    const body = h('div.thread-body', list);
    if (may && !thread.resolved) {
      body.append(
        composer(app, {
          key: `reply-${thread.id}`,
          label: `Reply to comment ${number}`,
          placeholder: 'Reply. Type @ to mention someone.',
          submitLabel: 'Reply',
          store: this.drafts,
          onSubmit: (text) => {
            c.reply(thread.id, text);
            announce('Reply sent.');
          },
        }),
      );
    }
    const row = h('div.thread-actions');
    row.append(h('button.btn.small', { type: 'button', onclick: () => c.reveal(thread) }, icon('locate', 13), 'Show on Canvas'));
    if (may) row.append(h('button.btn.small', { type: 'button', onclick: () => (c.resolve(thread.id, !thread.resolved), announce(thread.resolved ? 'Comment reopened.' : 'Comment resolved.')) }, icon(thread.resolved ? 'rotate-ccw' : 'circle-check', 13), thread.resolved ? 'Reopen' : 'Resolve'));
    if (may && (c.isMine(thread, ed) || c.canModerate(ed))) row.append(h('button.btn.small.ghost', { type: 'button', onclick: () => this.confirmDelete(thread, null) }, icon('trash', 13), 'Delete'));
    body.append(row);
    li.append(body);
    return li;
  }

  async confirmDelete(thread, message) {
    const app = this.app;
    const ok = await app.dialogs.confirm({ title: message ? 'Delete Comment' : 'Delete Discussion', message: message ? 'Delete this comment? This cannot be undone.' : 'Delete this discussion and all its replies? This cannot be undone.', okLabel: 'Delete', danger: true });
    if (!ok) return;
    if (message) app.comments.remove(thread.id, message.id);
    else app.comments.removeThread(thread.id);
    announce(message ? 'Comment deleted.' : 'Discussion deleted.');
  }
}
