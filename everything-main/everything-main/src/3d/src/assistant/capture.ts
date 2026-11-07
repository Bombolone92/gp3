// The assistant's eyes and hands on the 3D Viewport: screenshots from any
// viewpoint (the user's view is put back the moment the picture is taken) and
// changes to the user's view when asked.

import { Box3, Vector3 } from 'three';
import { app } from '../app/app';
import { View3D, worldBounds } from '../editors/view3d/view3d';
import { renderContext } from '../render/context';
import { type AssistantUI, type ViewOptions, ToolError } from './tools';

/** Long edge of a screenshot sent to the model. */
const SHOT_EDGE = 1280;
/** A 3/4 view from the front right, a little above (radians). */
const ISO_TILT = 1.13;
const ISO_SPIN = Math.PI / 4;

/** The largest 3D Viewport on screen. */
function targetView(): View3D {
  const views = [...(renderContext?.engine.viewports ?? [])].filter((v): v is View3D => v instanceof View3D && v.visible());
  let best: View3D | null = null;
  let bestArea = 0;
  for (const v of views) {
    const r = v.rect();
    const area = r ? r.width * r.height : 0;
    if (area > bestArea) (best = v), (bestArea = area);
  }
  if (!best) throw new ToolError('No 3D Viewport is open in the current workspace. Ask the user to switch to a workspace with one (e.g. Layout).');
  return best;
}

function frameBox(o: ViewOptions, defaultFrame: 'ALL' | 'NONE'): Box3 | null {
  const frame = o.frame ?? defaultFrame;
  if (frame === 'NONE') return null;
  let ids: string[];
  if (Array.isArray(frame)) {
    const byName = new Map(Object.values(app.doc.objects).map((ob) => [ob.name, ob.id]));
    const missing = frame.filter((name) => !byName.has(name));
    if (missing.length) throw new ToolError(`No object named ${missing.map((m) => JSON.stringify(m)).join(', ')}.`);
    ids = frame.map((name) => byName.get(name)!);
  } else if (frame === 'SELECTED') {
    ids = app.selectedObjects().map((ob) => ob.id);
    if (!ids.length) throw new ToolError('Nothing is selected to frame.');
  } else {
    const visible = [...app.graph.objects.values()].filter((e) => e.visible);
    // Frame the model, not the lights and camera around it, when there is one.
    const solid = visible.filter((e) => e.mesh && e.mesh.positions.length);
    ids = (solid.length ? solid : visible).map((e) => e.id);
  }
  const box = worldBounds(ids);
  if (box.isEmpty()) box.set(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
  return box;
}

/** Points the view as asked; returns the box to frame (null to keep the framing). */
function aim(v: View3D, o: ViewOptions): Box3 | null {
  const view = o.view ?? 'CURRENT';
  if (o.shading) v.shading.type = o.shading as View3D['shading']['type'];
  if (view === 'CAMERA') {
    if (!app.doc.scene.camera || !app.doc.objects[app.doc.scene.camera]) throw new ToolError('The scene has no camera. Add one and set C.scene.camera first.');
    v.cameraView = true;
    v.updateSceneCamera();
    return null;
  }
  if (view === 'CURRENT') return frameBox(o, 'NONE');
  v.leaveCamera();
  if (view === 'ISOMETRIC') {
    v.nav.setFromAngles(ISO_TILT, ISO_SPIN);
    v.nav.view = 'USER';
    v.nav.ortho = false;
    v.nav.wasAutoOrtho = false;
  } else v.nav.setAxisView(view);
  return frameBox(o, 'ALL');
}

function readPixels(v: View3D): string {
  const engine = renderContext!.engine;
  const rect = v.rect();
  if (!rect || rect.width < 8 || rect.height < 8) throw new ToolError('The 3D Viewport is too small to take a screenshot.');
  const base = engine.canvas.getBoundingClientRect();
  const sx = engine.canvas.width / base.width;
  const sy = engine.canvas.height / base.height;
  const w = Math.round(rect.width * sx);
  const h = Math.round(rect.height * sy);
  const scale = Math.min(1, SHOT_EDGE / Math.max(w, h));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * scale));
  out.height = Math.max(1, Math.round(h * scale));
  const g = out.getContext('2d');
  if (!g) throw new ToolError('Could not take a screenshot in this browser.');
  g.imageSmoothingQuality = 'high';
  g.drawImage(engine.canvas, Math.round((rect.left - base.left) * sx), Math.round((rect.top - base.top) * sy), w, h, 0, 0, out.width, out.height);
  const url = out.toDataURL('image/jpeg', 0.85);
  out.width = out.height = 0;
  return url;
}

const describe = (o: ViewOptions, v: View3D) => {
  const view = o.view && o.view !== 'CURRENT' ? `the ${o.view === 'CAMERA' ? 'camera' : o.view.toLowerCase()} view` : 'the same view';
  const f = o.frame;
  const framed = Array.isArray(f) ? `, framed on ${f.map((x) => JSON.stringify(x)).join(', ')}` : f === 'SELECTED' ? ', framed on the selection' : (f === 'ALL' || (!f && o.view && o.view !== 'CURRENT' && o.view !== 'CAMERA')) ? ', framed on the whole scene' : '';
  return `The viewport shows ${view}${framed}, in ${v.shading.type.toLowerCase()} shading.`;
};

export const viewportUI: AssistantUI = {
  async capture(o) {
    if (!renderContext || renderContext.engine.lost) throw new ToolError('The 3D view is not available (no graphics context).');
    if (app.hasPending) app.flush();
    const v = targetView();
    const saved = { nav: v.nav.serialize(), wasAutoOrtho: v.nav.wasAutoOrtho, shading: { ...v.shading }, cameraView: v.cameraView };
    try {
      const box = aim(v, o);
      if (box) v.nav.frame(box.getCenter(new Vector3()), Math.max(box.getSize(new Vector3()).length() / 2, 0.05));
      // Drawn and read in one go, so the user never sees the other viewpoint.
      const engine = renderContext.engine;
      engine.drawAll();
      engine.drawAll();
      return readPixels(v);
    } finally {
      v.nav.load(saved.nav);
      v.nav.wasAutoOrtho = saved.wasAutoOrtho;
      Object.assign(v.shading, saved.shading);
      v.cameraView = saved.cameraView;
      v.updateSceneCamera();
      renderContext.engine.drawAll();
      renderContext.engine.requestDraw();
    }
  },

  setView(o) {
    const v = targetView();
    const box = aim(v, o);
    if (box) v.frameBox(box);
    v.drawUI();
    app.changed('view', 'ui');
    renderContext?.engine.requestDraw();
    return describe(o, v);
  },
};
