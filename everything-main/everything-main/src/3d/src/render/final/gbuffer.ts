// Geometry buffers: world normal + view depth (data passes, denoiser guides) and albedo.
import {
  ShaderMaterial,
  DoubleSide,
  WebGLRenderTarget,
  FloatType,
  HalfFloatType,
  RGBAFormat,
  NearestFilter,
  LinearFilter,
  Mesh,
  type Camera,
  type Scene,
  type WebGLRenderer,
  type Material,
  type MeshPhysicalMaterial,
  Color,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { albedoMaterial } from './ptmaterial';

/** rgb = world-space normal, a = view distance along -Z (0 = background). */
export const normalDepthMaterial = new ShaderMaterial({
  side: DoubleSide,
  vertexShader: /* glsl */ `
    #include <common>
    #include <batching_pars_vertex>
    varying vec3 vNormalV;
    varying float vDepth;
    void main() {
      #include <batching_vertex>
      #include <beginnormal_vertex>
      #include <defaultnormal_vertex>
      #include <begin_vertex>
      #include <project_vertex>
      vNormalV = normalize(transformedNormal);
      vDepth = -mvPosition.z;
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vNormalV;
    varying float vDepth;
    void main() {
      vec3 n = normalize(vNormalV) * (gl_FrontFacing ? 1.0 : -1.0);
      // view → world (viewMatrix is orthonormal: inverse = transpose)
      vec3 nw = normalize((vec4(n, 0.0) * viewMatrix).xyz);
      gl_FragColor = vec4(nw, vDepth);
    }`,
});

export function floatTarget(w: number, h: number, opts: { half?: boolean; linear?: boolean; samples?: number; depth?: boolean } = {}) {
  return new WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: opts.half ? HalfFloatType : FloatType,
    format: RGBAFormat,
    minFilter: opts.linear ? LinearFilter : NearestFilter,
    magFilter: opts.linear ? LinearFilter : NearestFilter,
    depthBuffer: opts.depth !== false,
    samples: opts.samples ?? 0,
    generateMipmaps: false,
  });
}

const black = new Color(0, 0, 0);

/** Render scene meshes with an override material into `target` (background cleared to 0). */
export function renderOverride(renderer: WebGLRenderer, scene: Scene, camera: Camera, target: WebGLRenderTarget, mat: Material | null, perMesh?: (m: Mesh) => Material | Material[]) {
  const bg = scene.background,
    env = scene.environment,
    over = scene.overrideMaterial;
  const cc = renderer.getClearColor(new Color()),
    ca = renderer.getClearAlpha();
  const tm = renderer.toneMapping;
  const saved: [Mesh, Material | Material[]][] = [];
  const hidden: { visible: boolean }[] = [];
  scene.background = null;
  scene.environment = null;
  if (mat) scene.overrideMaterial = mat;
  scene.traverse((o) => {
    if ((o as { isLight?: boolean }).isLight && o.visible) {
      hidden.push(o);
      o.visible = false;
    }
    if (perMesh && (o as Mesh).isMesh) {
      const m = o as Mesh;
      saved.push([m, m.material]);
      m.material = perMesh(m);
    }
  });
  const prevTarget = renderer.getRenderTarget();
  const scissor = renderer.getScissorTest();
  renderer.setScissorTest(false);
  renderer.setRenderTarget(target);
  renderer.setClearColor(black, 0);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
  renderer.setRenderTarget(prevTarget);
  renderer.setScissorTest(scissor);
  renderer.setClearColor(cc, ca);
  renderer.toneMapping = tm;
  for (const [m, mm] of saved) m.material = mm;
  for (const o of hidden) o.visible = true;
  scene.background = bg;
  scene.environment = env;
  scene.overrideMaterial = over;
}

/** Albedo guide for the denoiser (path tracer materials are MeshPhysicalMaterials). */
export function renderAlbedo(renderer: WebGLRenderer, scene: Scene, camera: Camera, target: WebGLRenderTarget) {
  renderOverride(renderer, scene, camera, target, null, (m) => {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const out = mats.map((x) => albedoMaterial(x as MeshPhysicalMaterial));
    return out.length === 1 ? out[0] : out;
  });
}

/** Draw a texture through a material on a full-screen quad into the current target. */
export class Blit {
  quad = new FullScreenQuad();
  draw(renderer: WebGLRenderer, mat: Material, target: WebGLRenderTarget | null) {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    this.quad.material = mat;
    this.quad.render(renderer);
    renderer.setRenderTarget(prev);
  }
}
