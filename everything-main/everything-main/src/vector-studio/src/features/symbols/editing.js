/**
 * Editing a symbol in place. The definition (a group of master artwork)
 * moves from the symbol store onto the page, right above the instance it
 * was opened from, and the editor isolates it: every tool works on the
 * master as on any group, and every instance follows each edit live.
 * When opened from an instance, the master is first moved (with every
 * instance compensating, so nothing on the page changes) so that it sits
 * where that instance's registration point is.
 *
 * The store remembers what is being edited (`editing`: a stack of
 * { id, index, via }, so a symbol inside a symbol can be edited too). The
 * editor's mode is derived from that after every change, which keeps undo
 * and redo across entering and leaving consistent: undoing the exit puts
 * the editor back into the symbol.
 */
import { UserError } from '../../lib/errors.js';
import { STORE_ID, symbolStore, getDef, editingStack, instanceRegPoint, rebaseSymbol, masterBounds, isSymbolDef, ensureStore } from './model.js';

/** The symbol being edited in an editor (innermost), or null. */
export function editingSymbol(editor) {
  return editor?.symbolEdit || null;
}

function usableLayer(editor) {
  const doc = editor.doc;
  let t = editor.targetLayer();
  if (t && (doc.isLocked(t.id) || doc.isHidden(t.id) || isSymbolDef(t))) t = null;
  if (!t) t = doc.layers().slice().reverse().find((l) => !l.locked && !l.hidden) || null;
  return t;
}

/**
 * Start editing a symbol. `via` is the instance it was opened from (the
 * master then appears in its place); without one the master opens on the
 * active layer and the view moves to it.
 */
export function enterSymbolEdit(app, editor, symbolId, { via = null } = {}) {
  const doc = editor.doc;
  const def = getDef(doc, symbolId);
  if (!def) return false;
  let stack = editingStack(doc);
  if (stack.some((e) => e.id === symbolId)) return false;
  const viaNode = via ? doc.get(via) : null;
  // Opening a symbol that is not inside the one being edited leaves editing first.
  if (stack.length && !(viaNode && doc.isAncestor(stack[stack.length - 1].id, viaNode.id))) {
    while (editingStack(doc).length) exitSymbolEdit(app, editor, { select: false });
    stack = [];
  }
  let parentId;
  let index;
  if (viaNode) {
    parentId = viaNode.parent;
    index = doc.get(parentId).children.indexOf(viaNode.id) + 1;
  } else {
    const layer = usableLayer(editor);
    if (!layer) throw new UserError('Unlock or show a layer to edit the symbol.');
    parentId = layer.id;
    index = Infinity;
  }
  doc.transact('Edit Symbol', () => {
    ensureStore(doc);
    if (viaNode) {
      const p = instanceRegPoint(doc, viaNode);
      const reg = getDef(doc, symbolId).symbolDef.reg;
      if (Math.hypot(p.x - reg.x, p.y - reg.y) > 1e-9) rebaseSymbol(doc, symbolId, p.x - reg.x, p.y - reg.y);
    }
    const at = symbolStore(doc).children.indexOf(symbolId);
    doc.move(symbolId, parentId, index);
    doc.update(STORE_ID, { editing: [...stack, { id: symbolId, index: at < 0 ? Infinity : at, via: viaNode?.id || null }] });
  });
  syncSymbolEditing(app, editor);
  if (!viaNode) {
    const b = masterBounds(doc, doc.get(symbolId));
    if (b) {
      editor.view.centerOn(b.x + b.w / 2, b.y + b.h / 2);
      editor.viewChanged();
    }
  }
  return true;
}

/** Finish editing the innermost symbol: its master goes back to the store. */
export function exitSymbolEdit(app, editor, { select = true } = {}) {
  const doc = editor.doc;
  const stack = editingStack(doc);
  if (!stack.length) return false;
  const top = stack[stack.length - 1];
  doc.transact('Exit Symbol Editing', () => {
    if (doc.has(top.id)) {
      const store = symbolStore(doc);
      doc.move(top.id, STORE_ID, Math.min(top.index, store.children.length));
    }
    doc.update(STORE_ID, { editing: stack.slice(0, -1) });
  });
  syncSymbolEditing(app, editor);
  if (select && top.via && doc.has(top.via)) editor.select([top.via]);
  return true;
}

/** Bring the editor's mode in line with the document (after any change, undo or redo). */
export function syncSymbolEditing(app, editor) {
  const doc = editor.doc;
  const store = symbolStore(doc);
  const stack = (store?.editing || []).filter((e) => {
    const n = doc.get(e.id);
    return isSymbolDef(n) && n.parent !== STORE_ID;
  });
  const top = stack.length ? stack[stack.length - 1] : null;
  const id = top?.id || null;
  const view = app.views?.get(editor);
  const skip = top?.via && doc.has(top.via) ? new Set([top.via]) : null;
  if (view) {
    const same = (view.skip?.size || 0) === (skip?.size || 0) && (!skip || view.skip.has(top.via));
    if (!same) {
      view.skip = skip;
      view.invalidate?.();
    }
  }
  if (editor.symbolEdit === id) return;
  const was = editor.symbolEdit;
  editor.symbolEdit = id;
  if (id) {
    editor.isolation = id;
    editor.clearSelection();
  } else if (editor.isolation && (editor.isolation === was || !doc.has(editor.isolation) || isSymbolDef(doc.get(editor.isolation)))) {
    editor.isolation = null;
  }
  editor.emit('isolation');
  editor.invalidate();
}
