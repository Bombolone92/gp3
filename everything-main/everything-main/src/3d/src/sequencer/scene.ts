// Scene strips: render the scene through a camera with the realtime raster renderer (preview) and
// convert it with the scene's view transform to display-referred RGBA8 for compositing.
import { Color, Vector4, WebGLRenderTarget, UnsignedByteType, RGBAFormat, NearestFilter, type ShaderMaterial, type WebGLRenderer } from 'three';
import { app } from '../app/app';
import { renderContext } from '../render/context';
import { RenderScene } from '../render/final/renderscene';
import { RasterRenderer, effectsFrom, displayMaterial } from '../render/final/raster';
import { Blit } from '../render/final/gbuffer';
import { VIEW_INDEX, toDisplayRGBA8 } from '../render/final/colormanage';
import { renderCamera } from '../render/final/camera';

export interface RGBA8Image {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  /** rows stored bottom-up (GPU readback) instead of top-down */
  bottomUp?: boolean;
}

let rs: RenderScene | null = null;
const raster = new RasterRenderer(4);
const blit = new Blit();
let display: ShaderMaterial | null = null;
let rt8: WebGLRenderTarget | null = null;

function saveState(renderer: WebGLRenderer) {
  const st = {
    target: renderer.getRenderTarget(),
    scissor: renderer.getScissorTest(),
    viewport: renderer.getViewport(new Vector4()),
    tone: renderer.toneMapping,
    shadows: renderer.shadowMap.enabled,
    clear: renderer.getClearColor(new Color()),
    clearAlpha: renderer.getClearAlpha(),
  };
  return () => {
    renderer.setRenderTarget(st.target);
    renderer.setScissorTest(st.scissor);
    renderer.setViewport(st.viewport);
    renderer.toneMapping = st.tone;
    renderer.shadowMap.enabled = st.shadows;
    renderer.setClearColor(st.clear, st.clearAlpha);
    renderContext?.engine.requestDraw();
  };
}

/** Evaluate the scene at `frame` for the duration of `fn` (restores the current frame afterwards). */
export async function atSceneFrame<T>(frame: number, fn: () => Promise<T> | T): Promise<T> {
  const s = app.doc.scene;
  const prev = s.frame_current,
    prevSub = s.frame_subframe ?? 0;
  const change = frame !== prev || prevSub !== 0;
  if (change) {
    s.frame_current = frame;
    s.frame_subframe = 0;
    app.evaluate();
  }
  try {
    return await fn();
  } finally {
    if (change) {
      s.frame_current = prev;
      s.frame_subframe = prevSub;
      app.evaluate();
    }
  }
}

/** Convert a top-down linear float render to display RGBA8 using the scene's view settings. */
export function displayImage(buf: Float32Array, w: number, h: number): RGBA8Image {
  const r = app.doc.scene.render;
  if (!r.film_transparent) for (let i = 3; i < buf.length; i += 4) buf[i] = 1;
  return { data: toDisplayRGBA8(buf, w, h, r, { keepAlpha: true }), width: w, height: h };
}

/** Realtime render of the scene camera at `frame` (w×h pixels). */
export async function renderScenePreview(frame: number, cameraId: string | null, w: number, h: number): Promise<RGBA8Image | null> {
  const ctx = renderContext;
  if (!ctx) return null;
  const camId = cameraId || app.doc.scene.camera;
  if (!camId || !app.doc.objects[camId]) return null;
  return atSceneFrame(frame, () => {
    const renderer = ctx.engine.renderer;
    const camera = renderCamera(app, w, h, camId);
    if (!camera) return null;
    const restore = saveState(renderer);
    try {
      rs ??= new RenderScene('raster');
      rs.build(app, { mode: 'raster', final: true, filmTransparent: app.doc.scene.render.film_transparent });
      rs.configureShadows(renderer, app.doc);
      const r = app.doc.scene.render;
      const fx = { ...effectsFrom(r), gtao: false };
      const tex = raster.render(renderer, rs.scene, camera, w, h, fx);
      // colour management on the GPU (scene view transform → display sRGB), 8-bit readback
      display ??= displayMaterial.clone();
      const u = display.uniforms;
      u.tMap.value = tex;
      u.uView.value = VIEW_INDEX[r.view_transform] ?? 1;
      u.uExposure.value = Math.pow(2, r.exposure ?? 0);
      u.uInvGamma.value = r.gamma > 0 ? 1 / r.gamma : 1;
      u.uComposite.value = r.film_transparent ? 0 : 1;
      (u.uBg.value as Color).setRGB(0, 0, 0);
      if (!rt8 || rt8.width !== w || rt8.height !== h) {
        rt8?.dispose();
        rt8 = new WebGLRenderTarget(w, h, { type: UnsignedByteType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false, generateMipmaps: false });
      }
      renderer.setScissorTest(false);
      blit.draw(renderer, display, rt8);
      const buf = new Uint8Array(w * h * 4);
      renderer.readRenderTargetPixels(rt8, 0, 0, w, h, buf);
      return { data: buf, width: w, height: h, bottomUp: true };
    } finally {
      restore();
    }
  });
}

export function flipRows(buf: Float32Array, w: number, h: number) {
  const row = w * 4;
  const tmp = new Float32Array(row);
  for (let y = 0; y < h >> 1; y++) {
    const a = y * row,
      b = (h - 1 - y) * row;
    tmp.set(buf.subarray(a, a + row));
    buf.copyWithin(a, b, b + row);
    buf.set(tmp, b);
  }
}
