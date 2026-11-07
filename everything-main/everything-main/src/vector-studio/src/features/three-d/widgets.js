/**
 * Interactive controls of the 3D panel: a trackball that turns a preview
 * cube (drag to rotate the object freely, Shift to keep to one axis, arrow
 * keys for steps), a light sphere whose dot is the light's direction, and
 * shaded material swatches.
 */
import { h } from '../../lib/dom.js';
import { rotationMatrix, eulerFromMatrix, trackballRotation, axisAngle, mul3, apply3, normalize } from './math.js';
import { shade, rgbOf } from './shading.js';

const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  for (const k of kids) if (k) el.append(k);
  return el;
}

const CUBE = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];
// Faces wound so their normals point outward; the front face (z+) is marked.
const CUBE_FACES = [
  { v: [4, 5, 6, 7], n: [0, 0, 1], front: true },
  { v: [1, 0, 3, 2], n: [0, 0, -1] },
  { v: [0, 4, 7, 3], n: [-1, 0, 0] },
  { v: [5, 1, 2, 6], n: [1, 0, 0] },
  { v: [0, 1, 5, 4], n: [0, -1, 0] },
  { v: [7, 6, 2, 3], n: [0, 1, 0] },
];

let ids = 0;

/**
 * Trackball. get() -> { x, y, z } angles; onChange({ x, y, z }, { live })
 * fires while dragging (live) and once more on release; keyboard steps
 * commit at once.
 */
export function trackball({ size = 132, label = 'Rotate object', get, onChange, onGesture }) {
  const r = size * 0.42;
  const c = size / 2;
  const hintId = `tb-hint-${++ids}`;
  const faces = svg('g', { class: 'td-cube' });
  const ring = svg('circle', { cx: c, cy: c, r, class: 'td-ball' });
  const equator = svg('ellipse', { cx: c, cy: c, rx: r, ry: r * 0.28, class: 'td-ball-line' });
  const meridian = svg('ellipse', { cx: c, cy: c, rx: r * 0.28, ry: r, class: 'td-ball-line' });
  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, 'aria-hidden': 'true' }, ring, equator, meridian, faces);
  const el = h(
    'div.td-trackball',
    {
      tabindex: '0',
      role: 'group',
      'aria-roledescription': 'trackball',
      'aria-label': label,
      'aria-describedby': hintId,
    },
    root,
    h('span.sr-only', { id: hintId }, 'Drag to turn the object. Arrow keys turn it in steps; with Alt, Left and Right spin it in its plane. Hold Shift for larger steps.'),
  );

  const draw = () => {
    const a = get();
    const R = rotationMatrix(a.x, a.y, a.z);
    const s = r * 0.48;
    const pts = CUBE.map((p) => apply3(R, p));
    const vis = CUBE_FACES.map((f) => ({ f, n: apply3(R, f.n) }))
      .filter((e) => e.n[2] > 1e-6)
      .sort((p, q) => p.n[2] - q.n[2]);
    faces.replaceChildren(
      ...vis.map(({ f, n }) =>
        svg('polygon', {
          points: f.v.map((i) => `${(c + pts[i][0] * s).toFixed(2)},${(c + pts[i][1] * s).toFixed(2)}`).join(' '),
          class: f.front ? 'td-face td-face-front' : 'td-face',
          // Faces turned toward the viewer read lighter.
          'fill-opacity': (0.25 + 0.6 * n[2]).toFixed(3),
        }),
      ),
    );
    el.setAttribute('aria-label', `${label}: X ${Math.round(a.x)}°, Y ${Math.round(a.y)}°, Z ${Math.round(a.z)}°`);
  };

  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.focus();
    const box = el.getBoundingClientRect();
    const a = get();
    drag = { id: e.pointerId, ox: box.left + box.width / 2, oy: box.top + box.height / 2, x0: e.clientX, y0: e.clientY, R0: rotationMatrix(a.x, a.y, a.z), moved: false, scale: size / (box.width || size) };
    el.setPointerCapture?.(e.pointerId);
    onGesture?.('start');
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    let x1 = e.clientX;
    let y1 = e.clientY;
    // Shift keeps to the main direction of the drag (one axis).
    if (e.shiftKey) {
      if (Math.abs(x1 - drag.x0) > Math.abs(y1 - drag.y0)) y1 = drag.y0;
      else x1 = drag.x0;
    }
    const k = drag.scale;
    const T = trackballRotation((drag.x0 - drag.ox) * k, (drag.y0 - drag.oy) * k, (x1 - drag.ox) * k, (y1 - drag.oy) * k, r);
    drag.moved = true;
    onChange(eulerFromMatrix(mul3(T, drag.R0)), { live: true });
    draw();
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    if (moved) onChange(get(), { live: false });
    onGesture?.('end');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 15 : 5;
    let T = null;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) T = axisAngle([0, 0, 1], e.key === 'ArrowRight' ? step : -step);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') T = axisAngle([0, 1, 0], e.key === 'ArrowRight' ? step : -step);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') T = axisAngle([1, 0, 0], e.key === 'ArrowDown' ? step : -step);
    if (!T) return;
    e.preventDefault();
    e.stopPropagation();
    const a = get();
    onChange(eulerFromMatrix(mul3(T, rotationMatrix(a.x, a.y, a.z))), { live: false });
    draw();
  });
  draw();
  return { el, refresh: draw };
}

/**
 * Light sphere: the dot shows where the light comes from (a hollow dot is
 * behind the object). get() -> [x, y, z]; onChange(vector, { live }).
 */
export function lightSphere({ size = 132, label = 'Light direction', get, onChange, onGesture }) {
  const r = size * 0.42;
  const c = size / 2;
  const gid = `td-lg-${++ids}`;
  const hintId = `td-lh-${ids}`;
  const stopA = svg('stop', { offset: '0', 'stop-color': '#ffffff' });
  const stopB = svg('stop', { offset: '1', 'stop-color': '#4a4a4a' });
  const grad = svg('radialGradient', { id: gid, cx: '0.5', cy: '0.5', r: '0.75' }, stopA, stopB);
  const ball = svg('circle', { cx: c, cy: c, r, fill: `url(#${gid})`, class: 'td-light-ball' });
  const ray = svg('line', { x1: c, y1: c, x2: c, y2: c, class: 'td-light-ray' });
  const dot0 = svg('circle', { cx: c, cy: c, r: 7, class: 'td-light-dot' });
  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, 'aria-hidden': 'true' }, svg('defs', {}, grad), ball, ray, dot0);
  const el = h(
    'div.td-lightball',
    { tabindex: '0', role: 'group', 'aria-roledescription': 'light direction control', 'aria-label': label, 'aria-describedby': hintId },
    root,
    h('span.sr-only', { id: hintId }, 'Drag the dot, or use the arrow keys, to move the light.'),
  );
  const draw = () => {
    const [x, y, z] = normalize(get());
    const px = c + x * r;
    const py = c + y * r;
    dot0.setAttribute('cx', px.toFixed(2));
    dot0.setAttribute('cy', py.toFixed(2));
    dot0.classList.toggle('behind', z < 0);
    ray.setAttribute('x2', px.toFixed(2));
    ray.setAttribute('y2', py.toFixed(2));
    // The bright spot of the ball sits under the light.
    grad.setAttribute('cx', (0.5 + x * 0.32).toFixed(3));
    grad.setAttribute('cy', (0.5 + y * 0.32).toFixed(3));
    stopB.setAttribute('stop-color', z < 0 ? '#2a2a2a' : '#4a4a4a');
    el.setAttribute('aria-label', `${label}: ${describeLight([x, y, z])}`);
  };
  const fromPoint = (dx, dy, behind) => {
    let x = dx / r;
    let y = dy / r;
    const l = Math.hypot(x, y);
    if (l > 0.995) {
      x *= 0.995 / l;
      y *= 0.995 / l;
    }
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y)) * (behind ? -1 : 1);
    return [x, y, z];
  };
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.focus();
    const box = el.getBoundingClientRect();
    const k = size / (box.width || size);
    drag = { id: e.pointerId, ox: box.left + box.width / 2, oy: box.top + box.height / 2, k, behind: get()[2] < 0, moved: false };
    el.setPointerCapture?.(e.pointerId);
    onGesture?.('start');
    drag.moved = true;
    onChange(fromPoint((e.clientX - drag.ox) * k, (e.clientY - drag.oy) * k, drag.behind), { live: true });
    draw();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    onChange(fromPoint((e.clientX - drag.ox) * drag.k, (e.clientY - drag.oy) * drag.k, drag.behind), { live: true });
    draw();
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    onChange(get(), { live: false });
    onGesture?.('end');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 0.2 : 0.05;
    const v = normalize(get());
    let [x, y] = v;
    if (e.key === 'ArrowLeft') x -= d;
    else if (e.key === 'ArrowRight') x += d;
    else if (e.key === 'ArrowUp') y -= d;
    else if (e.key === 'ArrowDown') y += d;
    else return;
    e.preventDefault();
    e.stopPropagation();
    onChange(fromPoint(x * r, y * r, v[2] < 0), { live: false });
    draw();
  });
  draw();
  return { el, refresh: draw };
}

/** Words for a light direction ("upper left, in front"). */
export function describeLight([x, y, z]) {
  const v = y < -0.3 ? 'upper' : y > 0.3 ? 'lower' : '';
  const hz = x < -0.3 ? 'left' : x > 0.3 ? 'right' : '';
  const where = [v, hz].filter(Boolean).join(' ') || 'center';
  return `Light from ${where}, ${z < 0 ? 'behind' : 'in front'}`;
}

/** Paint a shaded ball for a material into a canvas (no-op where canvas pixels are unavailable). */
export function paintMaterialBall(canvas, mat, base = '#5b8def', light) {
  const ctx = canvas.getContext?.('2d');
  if (!ctx || typeof ctx.createImageData !== 'function') return;
  const w = canvas.width;
  const img = ctx.createImageData(w, w);
  if (!img?.data) return;
  const col = rgbOf(base);
  const L = light || { dir: normalize([-0.45, -0.6, 0.66]), color: [1, 1, 1], intensity: 0.85, ambient: 0.35 };
  const rr = w / 2 - 1;
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - w / 2) / rr;
      const ny = (y + 0.5 - w / 2) / rr;
      const d2 = nx * nx + ny * ny;
      const k = (y * w + x) * 4;
      if (d2 > 1) continue;
      const n = [nx, ny, Math.sqrt(1 - d2)];
      const c = mat.id === 'wire' ? (Math.abs((Math.atan2(n[1], n[2]) * 6) % 1) < 0.12 ? col : null) : shade(col, n, [0, 0, 1], mat, L, 0);
      if (!c) continue;
      const a = Math.min(1, (1 - Math.sqrt(d2)) * rr) * (mat.opacity ?? 1);
      img.data[k] = Math.round(c[0] * 255);
      img.data[k + 1] = Math.round(c[1] * 255);
      img.data[k + 2] = Math.round(c[2] * 255);
      img.data[k + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
}

