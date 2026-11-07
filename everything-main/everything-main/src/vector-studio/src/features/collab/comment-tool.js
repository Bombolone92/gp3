/**
 * Comment mode: click the canvas to pin a new comment there, or click an
 * object to pin it to that object (the pin then follows it). Escape
 * leaves comment mode. Works in view-only documents for people who may
 * comment.
 */
import { Tool, tol } from '../../tools/tool.js';
import { hitTest } from '../../render/hit.js';

export class CommentTool extends Tool {
  static id = 'comment';
  static label = 'Comment';
  static icon = 'message-square-plus';
  static hint = 'Click an object or the canvas to add a comment. Esc leaves comment mode.';

  constructor(app) {
    super(app);
    this.cursor = 'crosshair';
  }

  activate() {
    this.setCursor('crosshair');
    this.status();
  }

  deactivate() {
    if (this.editor?.hover) {
      this.editor.hover = null;
      this.overlay();
    }
  }

  targetAt(e) {
    const editor = this.editor;
    const hit = hitTest(editor.doc, e.x, e.y, tol(editor, 4));
    return hit ? editor.selectionTarget(hit.id) : null;
  }

  onHover(e) {
    const t = this.targetAt(e);
    const id = t?.id || null;
    if (this.editor.hover !== id) {
      this.editor.hover = id;
      this.overlay();
    }
  }

  onPointerDown(e) {
    const editor = this.editor;
    const comments = this.app.comments;
    if (!comments.canComment(editor)) {
      this.app.notify('You can view this document but not comment on it.', { polite: true });
      return;
    }
    const target = this.targetAt(e);
    comments.startDraft(comments.anchorAt(editor, e.x, e.y, target?.id || null));
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      if (this.app.comments.draft) this.app.comments.cancelDraft();
      else this.app.commands.run('comments.mode');
      return true;
    }
    return false;
  }

  cancel() {
    this.app.comments?.cancelDraft();
  }
}
