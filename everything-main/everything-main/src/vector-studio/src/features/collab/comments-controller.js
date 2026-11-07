/**
 * Comments for the active document, shared or not: who is writing, what
 * they may do, and the comment actions, applied to doc.comments directly
 * for personal files (saved with the file) or through the document's
 * collaboration session when shared (sent to everyone). Also the state
 * the Comments panel, the comment pins and the Comment tool share: the
 * filter, the open discussion and a new comment's draft position.
 */
import { Emitter } from '../../lib/emitter.js';
import { uid } from '../../lib/ids.js';
import { nodeBounds } from '../../model/geometry.js';
import { applyCommentOps, createThreadOps, deleteMessageOps, deleteThreadOps, editMessageOps, messagesOf, pinPosition, replyOps, resolveOps, visibleThreads } from './comments.js';
import { canEdit } from './protocol.js';

const cid = (kind) => (uid(kind) + Math.random().toString(36).slice(2, 6)).replace(/[^A-Za-z0-9_-]/g, '');

export class CommentsController extends Emitter {
  constructor(app) {
    super();
    this.app = app;
    this.filter = 'open'; // open | resolved | all
    this.mine = false;
    this.active = null; // open discussion id
    this.draft = null; // { anchor } for a new comment
    this.pinsVisible = true;
  }

  get editor() {
    return this.app.editor;
  }

  /** The author record for comments written in `editor`. */
  author(editor = this.editor) {
    const u = this.app.user;
    if (editor?.collab) return { id: editor.collab.user.uuid, name: editor.collab.user.username };
    return u?.uuid ? { id: u.uuid, name: u.username } : { id: 'local', name: 'You' };
  }

  isMine(item, editor = this.editor) {
    const me = this.author(editor);
    return item?.author?.id === me.id || (item?.author?.id === 'local' && !editor?.collab);
  }

  canComment(editor = this.editor) {
    if (!editor) return false;
    return editor.collab ? editor.collab.canComment : !editor.doc.readOnly;
  }

  /** Editors may move or delete anyone's discussion. */
  canModerate(editor = this.editor) {
    return Boolean(editor && (!editor.collab || canEdit(editor.collab.role)));
  }

  apply(ops, editor = this.editor) {
    if (!editor) return;
    if (editor.collab) editor.collab.comment(ops);
    else editor.doc.setComments(applyCommentOps(editor.doc.comments, ops));
    this.emit('ui');
  }

  // ---- reading ----

  threads(editor = this.editor) {
    return visibleThreads(editor?.doc.comments);
  }

  /** Threads the panel lists, with their pin numbers. */
  listed(editor = this.editor) {
    const all = this.threads(editor);
    return all
      .map((t, i) => ({ thread: t, number: i + 1 }))
      .filter(({ thread }) => (this.filter === 'open' ? !thread.resolved : this.filter === 'resolved' ? thread.resolved : true))
      .filter(({ thread }) => !this.mine || this.isMine(thread, editor) || messagesOf(thread).some((m) => !m.deleted && this.isMine(m, editor)));
  }

  thread(id, editor = this.editor) {
    return editor?.doc.comments?.threads?.[id] || null;
  }

  /** Where a discussion's pin is, in document coordinates. */
  pin(thread, editor = this.editor) {
    const doc = editor.doc;
    return pinPosition(thread, (id) => {
      const n = doc.get(id);
      return n ? nodeBounds(doc, n) : null;
    });
  }

  /** An anchor for a document point: on the object there, else on the canvas. */
  anchorAt(editor, x, y, nodeId = null) {
    const doc = editor.doc;
    const node = nodeId ? doc.get(nodeId) : null;
    const b = node ? nodeBounds(doc, node) : null;
    if (b) return { x, y, node: node.id, dx: x - b.x, dy: y - b.y };
    return { x, y };
  }

  /** An anchor for a new comment from the keyboard: the selection's corner, else the view's center. */
  defaultAnchor(editor = this.editor) {
    const ids = editor.topSelection?.() || [];
    const b = ids.length === 1 ? editor.selectionBounds?.(false) : null;
    if (b) return this.anchorAt(editor, b.x + b.w, b.y, ids[0]);
    const r = editor.view.visibleRect();
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  // ---- actions ----

  startDraft(anchor) {
    this.draft = { anchor };
    this.active = null;
    this.emit('ui', { focus: 'draft' });
    this.app.openPanel?.('comments');
    this.editor?.emit('overlay');
  }

  cancelDraft() {
    if (!this.draft) return;
    this.draft = null;
    this.emit('ui');
    this.editor?.emit('overlay');
  }

  addThread(text, anchor = this.draft?.anchor) {
    const editor = this.editor;
    if (!editor || !String(text).trim() || !anchor) return null;
    const id = cid('ct');
    this.apply(createThreadOps({ id, messageId: cid('cm'), author: this.author(editor), text: String(text).trim(), anchor }));
    this.draft = null;
    this.active = id;
    if (this.filter === 'resolved') this.filter = 'open';
    this.emit('ui');
    editor.emit('overlay');
    return id;
  }

  reply(threadId, text) {
    if (!String(text).trim()) return null;
    const id = cid('cm');
    this.apply(replyOps(threadId, { id, author: this.author(), text: String(text).trim() }));
    return id;
  }

  edit(threadId, messageId, text) {
    if (!String(text).trim()) return;
    this.apply(editMessageOps(threadId, messageId, String(text).trim()));
  }

  /** Delete one message; deleting a discussion's only remaining message deletes the discussion. */
  remove(threadId, messageId) {
    const t = this.thread(threadId);
    const left = messagesOf(t).filter((m) => !m.deleted && m.id !== messageId);
    const ops = deleteMessageOps(threadId, messageId);
    if (!left.length && (this.isMine(t) || this.canModerate())) ops.push(...deleteThreadOps(threadId));
    this.apply(ops);
    if (!left.length && this.active === threadId) this.active = null;
    this.editor?.emit('overlay');
  }

  removeThread(threadId) {
    this.apply(deleteThreadOps(threadId));
    if (this.active === threadId) this.active = null;
    this.editor?.emit('overlay');
  }

  resolve(threadId, resolved = true) {
    this.apply(resolveOps(threadId, resolved, resolved ? this.author() : null));
    this.editor?.emit('overlay');
  }

  open(threadId, { reveal = true } = {}) {
    this.active = threadId;
    this.draft = null;
    const t = this.thread(threadId);
    if (t && ((this.filter === 'open' && t.resolved) || (this.filter === 'resolved' && !t.resolved))) this.filter = 'all';
    this.emit('ui', { focus: 'thread' });
    this.app.openPanel?.('comments');
    if (reveal && t) this.reveal(t);
    this.editor?.emit('overlay');
  }

  /** Scroll the canvas so a discussion's pin is in view. */
  reveal(thread) {
    const editor = this.editor;
    if (!editor) return;
    const p = this.pin(thread, editor);
    const r = editor.view.visibleRect(-40);
    if (p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h) return;
    editor.view.centerOn(p.x, p.y);
    editor.viewChanged();
  }

  setFilter(filter, mine = this.mine) {
    this.filter = filter;
    this.mine = mine;
    this.emit('ui');
    this.editor?.emit('overlay');
  }
}
