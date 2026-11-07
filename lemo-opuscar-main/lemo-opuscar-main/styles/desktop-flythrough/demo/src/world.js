// Shared world: renderer, sunlit dotted paper, card helper, dot ripples, small builders.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as K from './cards.js';

export const W = 1920, H = 1080, D = .03;   // D: dot spacing; dot centres sit at ((i+.5)D, (k+.5)D)

export function makeWorld(opt = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(W, H); document.body.prepend(renderer.domElement);
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const ANISO = renderer.capabilities.getMaxAnisotropy();
  const scene = new THREE.Scene();
  const HAZE = new THREE.Color(opt.haze || K.COL.paper).multiplyScalar(.97); scene.background = HAZE; scene.fog = new THREE.FogExp2(HAZE, .075);
  const camera = new THREE.PerspectiveCamera(38, W / H, .005, 80);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .25;
  scene.add(new THREE.HemisphereLight(0xc8d6ff, 0xf3e3cc, .7));   // cool sky, warm bounce
  const sun = new THREE.DirectionalLight(0xffdcb4, 3.8);   // early-morning sun: warm, low
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -.0001; sun.shadow.normalBias = .0006;
  scene.add(sun, sun.target);
  const SUNDIR = new THREE.Vector3(-2.2, .92, -1.15).normalize();   // about 20° up from the back-left: long shadows
  const tex = cv => { const x = new THREE.CanvasTexture(cv); x.colorSpace = THREE.SRGBColorSpace; x.anisotropy = ANISO; return x; };
  const t = new THREE.CanvasTexture(K.dotTile()); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ANISO;
  if (!opt.mat) {   // the whole desk is dotted paper
    t.repeat.set(60 / (8 * D), 60 / (8 * D));
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: t, roughness: .92 }));
    desk.rotation.x = -Math.PI / 2; desk.receiveShadow = true; scene.add(desk);
  } else {        // a dotted paper mat (top at y = 0) on a light oak desk
    const [mw, mh] = opt.mat; t.repeat.set(mw / (8 * D), mh / (8 * D));   // mw, mh are multiples of 2D so the printed dots line up with dotPatch
    const mat = new THREE.Mesh(new RoundedBoxGeometry(mw, .003, mh, 2, .0014), [0, 1, 2, 3, 4, 5].map(i => new THREE.MeshStandardMaterial(i === 2 ? { map: t, roughness: .92 } : { color: K.COL.paper, roughness: .92 })));
    mat.position.y = -.0015; mat.receiveShadow = true; mat.castShadow = true; scene.add(mat);
    const wt = new THREE.CanvasTexture(woodTile()); wt.wrapS = wt.wrapT = THREE.RepeatWrapping; wt.repeat.set(30 / 2.4, 30 / 2.4); wt.colorSpace = THREE.SRGBColorSpace; wt.anisotropy = ANISO;
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ map: wt, roughness: .62 }));
    desk.rotation.x = -Math.PI / 2; desk.position.y = -.003; desk.receiveShadow = true; scene.add(desk);
  }
  return { renderer, scene, camera, sun, SUNDIR, ANISO, tex };
}

// light oak: planks 0.3 wide running along x, long soft grain, faint seams (one tile = 2.4 × 2.4 units)
function woodTile(px = 2048) {
  const [c, x] = K.canvas(px, px, 1), plank = px / 8;
  for (let p = 0; p < 8; p++) {
    const y0 = p * plank, hue = (p * 37 % 7) / 7;
    x.fillStyle = `rgb(${222 - hue * 10},${204 - hue * 9},${178 - hue * 8})`; x.fillRect(0, y0, px, plank);
    for (let g = 0; g < 46; g++) {   // grain lines: long low-frequency waves
      const yy = y0 + (g + .5) * plank / 46, a = .025 + ((g * 13 + p * 7) % 9) / 9 * .05, ph = (g * 1.7 + p) % 6.28, amp = 2 + (g % 5);
      x.strokeStyle = `rgba(120,86,52,${a})`; x.lineWidth = 1 + (g % 3) * .6; x.beginPath();
      for (let i = 0; i <= px; i += 32) x.lineTo(i, yy + Math.sin(i / px * 6.28 * (1 + p % 3) + ph) * amp + Math.sin(i / 97 + g) * .8);
      x.stroke();
    }
    x.fillStyle = 'rgba(90,64,40,.18)'; x.fillRect(0, y0, px, 2);
  }
  K.grain(x, px, px, 5, 40000, 'rgba(80,55,30,.04)', 'rgba(255,250,240,.12)');
  return c;
}

// a card lying on the paper: rounded slab + printed top (canvas). group.userData.redraw() re-uploads the canvas
export function card(world, cv, w, h, thick = .005) {
  const g = new THREE.Group(), tex = world.tex(cv);
  const slab = new THREE.Mesh(new RoundedBoxGeometry(w, thick, h, 2, thick * .45), new THREE.MeshStandardMaterial({ color: K.COL.card, roughness: .8 }));
  slab.position.y = thick / 2; slab.castShadow = slab.receiveShadow = true; g.add(slab);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: .85, transparent: true }));
  top.rotation.x = -Math.PI / 2; top.position.y = thick + .0002; top.receiveShadow = true; g.add(top);
  g.userData = { tex, top: thick, redraw: () => { tex.needsUpdate = true; } };
  return g;
}

// Dot patch: real 3D dots over a disc of the paper, so impacts can push a ripple through them.
// ripples: [{t, x, z, amp, speed}] — each a travelling ring that lifts the dots it passes; skip(x, z): leave out dots under cards
export function dotPatch(world, cx, cz, R, ripples, skip = () => false) {
  const pts = [];
  for (let i = Math.floor((cx - R) / D); i <= Math.ceil((cx + R) / D); i++)
    for (let k = Math.floor((cz - R) / D); k <= Math.ceil((cz + R) / D); k++) {
      const x = (i + .5) * D, z = (k + .5) * D; if (Math.hypot(x - cx, z - cz) < R && !skip(x, z)) pts.push([x, z]);
    }
  const geo = new THREE.CylinderGeometry(D * .075, D * .075, .0016, 10);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: K.COL.dot, roughness: .9 }), pts.length);
  mesh.castShadow = true; mesh.receiveShadow = true; world.scene.add(mesh);
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  mesh.update = t => {
    let any = false;
    pts.forEach(([x, z], j) => {
      let y = 0;
      for (const r of ripples) {
        const dt = t - r.t; if (dt < 0 || dt > 1.6) continue;
        const d = Math.hypot(x - r.x, z - r.z), front = dt * (r.speed || 1.1), w = .06;
        y += (r.amp || .03) * Math.exp(-(((d - front) / w) ** 2)) * Math.exp(-dt * 2.2) * Math.exp(-d * 1.2);
      }
      if (y > 1e-4) any = true;
      p.set(x, .0008 + y, z); s.set(1, 1 + y * 120, 1); m4.compose(p, q, s); mesh.setMatrixAt(j, m4);
    });
    mesh.visible = any; mesh.instanceMatrix.needsUpdate = true;
  };
  return mesh;
}

export const rbox = (w, h, d, r = .003) => new RoundedBoxGeometry(w, h, d, 2, r);

// a rounded tag that stands on its own and faces the camera (call .face(camera) each frame). h: world height
export function pill(world, text, { bg = K.COL.accent, fg = '#ffffff', h = .026, size = 40, font = K.MONO, wt = 600, line = null } = {}) {
  const ph = size * 2, pad = size * .8, [, m] = K.canvas(10, 10);
  m.font = `${wt} ${size}px ${font}`; const tw = m.measureText(text).width, pw = Math.ceil(Math.max(tw + pad * 2, ph));
  const [cv, c] = K.canvas(pw + 8, ph + 8, 3);
  if (bg) { c.fillStyle = bg; K.rr(c, 4, 4, pw, ph, ph / 2); c.fill(); }
  if (line) { c.strokeStyle = line; c.lineWidth = 5; K.rr(c, 6.5, 6.5, pw - 5, ph - 5, ph / 2); c.stroke(); }
  K.txt(c, text, 4 + pw / 2, 4 + ph / 2 + 1, { size, wt, col: fg, align: 'center', font });
  const w = h * (pw + 8) / (ph + 8);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: world.tex(cv), transparent: true, alphaTest: .3, side: THREE.DoubleSide, roughness: .7 }));
  mesh.castShadow = true; mesh.face = cam => mesh.quaternion.copy(cam.quaternion); world.scene.add(mesh); mesh.w = w;
  return mesh;
}
