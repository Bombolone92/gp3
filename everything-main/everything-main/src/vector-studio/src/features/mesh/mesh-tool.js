/**
 * Mesh tool (U): click inside a filled path to turn it into a gradient
 * mesh with lines through the click, click inside a mesh to add a mesh
 * point (a row and a column line), click a mesh line to add one line
 * across it, Option-click a point or line to remove its lines, and drag
 * points and handles (Shift slides a point along its line). New points take
 * the current fill color; Shift-click keeps the color already there.
 */
import { Tool, tol } from '../../tools/tool.js';
import { hitTest } from '../../render/hit.js';
import { nearestEdge } from './mesh-model.js';
import { isMesh } from './mesh-live.js';
import { canMesh, convertToMesh, addMeshPoint, removeMeshLines } from './mesh-ops.js';
import { activeMeshes, meshAt, pickPointOrHandle, selectMeshPoints, selectedPoints, pointDrag, handleDrag } from './mesh-edit.js';

/**
 * Feature hooks for other mesh-shaped objects the tool edits (envelope
 * meshes): pointerDown(tool, e) -> a drag handler { move, up, cancel },
 * true when the press was handled without a drag, or null.
 */
export const meshToolHooks = [];

export class MeshTool extends Tool {
  static id = 'mesh';
  static label = 'Mesh Tool';
  static shortcut = 'U';
  static icon = 'tool-mesh';
  static hint = 'Click a filled object or mesh to add mesh lines | Click a mesh line to add one line | Option+Click to remove lines | Drag points and handles | Shift slides along a line';

  constructor(app) {
    super(app);
    this.selectionMode = 'direct';
    this.drag = null;
  }

  activate() {
    this.setCursor('crosshair');
    this.status();
  }

  deactivate() {
    this.cancel();
  }

  /** The current fill color for new points (solid fills only). */
  fillColor() {
    const f = this.editor.style.fill;
    return f && f.type === 'solid' ? f.color : null;
  }

  onHover(e) {
    const editor = this.editor;
    const hit = hitTest(editor.doc, e.x, e.y, tol(editor, 3), { outline: editor.viewOptions.mode === 'outline' });
    const target = hit && (isMesh(hit) || (canMesh(hit) && hit.fill)) ? hit : null;
    const id = target?.id || null;
    if (editor.hover !== id) {
      editor.hover = id;
      this.overlay();
    }
    const meshes = activeMeshes(editor, isMesh(target) ? target : null);
    const onPoint = pickPointOrHandle(editor, e, meshes);
    this.setCursor(onPoint ? 'pointer' : e.alt && target ? 'not-allowed' : target ? 'crosshair' : 'default');
  }

  onPointerDown(e) {
    const editor = this.editor;
    const doc = editor.doc;
    const under = meshAt(editor, e.x, e.y);
    const meshes = activeMeshes(editor, under);
    const color = e.shift ? null : this.fillColor();
    for (const hook of meshToolHooks) {
      const r = hook.pointerDown?.(this, e);
      if (r) {
        this.drag = r === true ? null : r;
        return;
      }
    }

    // Points and handles first.
    const hit = pickPointOrHandle(editor, e, meshes);
    if (hit?.dir) {
      this.drag = handleDrag(editor, hit.mesh, hit.k, hit.dir);
      return;
    }
    if (hit) {
      if (e.alt) {
        doc.transact('Delete Mesh Point', () => removeMeshLines(doc, hit.mesh.id, { k: hit.k }));
        editor.select([hit.mesh.id]);
        return;
      }
      const sel = selectedPoints(editor, hit.mesh.id);
      if (e.shift) selectMeshPoints(editor, hit.mesh.id, [hit.k], { toggle: true });
      else if (!sel.has(hit.k)) selectMeshPoints(editor, hit.mesh.id, [hit.k]);
      if (selectedPoints(editor, hit.mesh.id).has(hit.k)) this.drag = pointDrag(editor, doc.get(hit.mesh.id), hit.k, e);
      return;
    }

    // A mesh line: add one line across it, or remove it with Option.
    for (const m of meshes) {
      const edge = nearestEdge(m, e.x, e.y, tol(editor, 3));
      if (!edge) continue;
      if (e.alt) {
        doc.transact('Delete Mesh Line', () => removeMeshLines(doc, m.id, { edge }));
        editor.select([m.id]);
        return;
      }
      this.#addAndDrag(m.id, e, { tolerance: tol(editor, 3), color });
      return;
    }

    if (e.alt) return;
    if (under) {
      this.#addAndDrag(under.id, e, { color });
      return;
    }

    // A filled path becomes a mesh with lines through the click.
    const obj = hitTest(doc, e.x, e.y, tol(editor, 2), { outline: editor.viewOptions.mode === 'outline' });
    if (obj && canMesh(obj) && obj.fill && !doc.isLocked(obj.id)) {
      const tx = doc.begin('Create Gradient Mesh');
      const mesh = convertToMesh(doc, obj.id);
      if (!mesh) {
        tx.cancel();
        return;
      }
      this.#addAndDrag(mesh.id, e, { color, tx });
      return;
    }
    editor.clearSelection();
  }

  #addAndDrag(id, e, { tolerance = 0, color = null, tx = null } = {}) {
    const editor = this.editor;
    const doc = editor.doc;
    const t = tx || doc.begin('Add Mesh Point');
    const k = addMeshPoint(doc, id, e.x, e.y, { tolerance, color });
    if (k < 0) {
      t.commit();
      return;
    }
    selectMeshPoints(editor, id, [k]);
    this.drag = pointDrag(editor, doc.get(id), k, e, { tx: t });
  }

  onPointerMove(e) {
    this.drag?.move?.(e);
  }

  onPointerUp(e) {
    const d = this.drag;
    this.drag = null;
    d?.up?.(e);
    this.overlay();
  }

  onKeyDown(ev) {
    if (ev.key === 'Escape' && this.drag) {
      this.cancel();
      return true;
    }
    return false;
  }

  cancel() {
    const d = this.drag;
    this.drag = null;
    d?.cancel?.();
    this.overlay();
  }
}
