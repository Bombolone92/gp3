/**
 * More original vector graphics: emoji-style faces, badges and labels,
 * frames, doodles, sparkles, social callouts and arrows. All are drawn here
 * with Canvas 2D in a 100 x 100 unit square (the caller scales it), so they
 * are sharp at any size and nothing is copied from elsewhere.
 *
 * A graphic may be:
 *  - multi-color (multi: true): drawn with its own palette; `main` is the
 *    color its main area uses in "original colors" mode, and the user's
 *    color replaces only that main color in "custom color" mode.
 *  - animated (anim: true): drawn at time t (seconds of clip-local time);
 *    every animation is periodic so it loops for any clip length.
 *
 * Entry = { id, label, cat, multi?, main?, anim?, draw(g, { color, t }) }
 */

export const EXTRA_CATEGORIES = [
  { id: 'faces', label: 'Faces' },
  { id: 'badges', label: 'Badges & labels' },
  { id: 'social', label: 'Social' },
  { id: 'sparkles', label: 'Sparkles & shapes' },
  { id: 'frames', label: 'Frames' },
  { id: 'doodles', label: 'Doodles' },
];

const TAU = Math.PI * 2;
const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const INK = '#2b1d14';

/* Helpers ------------------------------------------------------------------------- */

/** A hex color lightened (k > 0) or darkened (k < 0) by k (-1..1). */
export function shade(hex, k) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k)));
  return `#${ch.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('')}`;
}

/** Relative luminance 0..1 of a hex color (for picking readable text). */
function luma(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
const onColor = (hex) => (luma(hex) > 0.62 ? '#1b1b1f' : '#ffffff');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  const k = Math.min(r, w / 2, h / 2);
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
}

function circle(g, x, y, r) {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
}

function star(g, cx, cy, n, ro, ri, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ri : ro;
    const a = rot + (i * Math.PI) / n;
    if (i) g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    else g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
}

function heart(g, cx, cy, w) {
  const k = w / 100;
  g.beginPath();
  g.moveTo(cx, cy + 34 * k);
  g.bezierCurveTo(cx - 52 * k, cy + 4 * k, cx - 40 * k, cy - 46 * k, cx, cy - 22 * k);
  g.bezierCurveTo(cx + 40 * k, cy - 46 * k, cx + 52 * k, cy + 4 * k, cx, cy + 34 * k);
  g.closePath();
}

function fill(g, color) {
  g.fillStyle = color;
  g.fill();
}

function stroke(g, color, w, cap = 'round') {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.lineCap = cap;
  g.lineJoin = 'round';
  g.stroke();
}

/** Centered bold text that shrinks to fit maxW. */
function label(g, text, x, y, size, color, maxW = 90, weight = 800) {
  g.font = `${weight} ${size}px ${FONT}`;
  const w = g.measureText?.(text)?.width || 0;
  if (w > maxW) g.font = `${weight} ${(size * maxW) / w}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, x, y);
}

/** A slightly wobbly polyline through points, as if drawn by hand. */
function handLine(g, pts, seed, wobble = 1.2) {
  const r = rng(seed);
  g.beginPath();
  pts.forEach(([x, y], i) => {
    const jx = x + (r() - 0.5) * wobble;
    const jy = y + (r() - 0.5) * wobble;
    if (i === 0) g.moveTo(jx, jy);
    else {
      const [px, py] = pts[i - 1];
      g.quadraticCurveTo(px + (r() - 0.5) * wobble * 2, py + (r() - 0.5) * wobble * 2, (px + jx) / 2, (py + jy) / 2);
      if (i === pts.length - 1) g.lineTo(jx, jy);
    }
  });
}

/** Points around an ellipse (for hand-drawn loops). */
function ellipsePts(cx, cy, rx, ry, turns = 1, n = 40, start = 0) {
  return Array.from({ length: Math.round(n * turns) + 1 }, (_, i) => {
    const a = start + (i / n) * TAU;
    return [cx + Math.cos(a) * rx * (1 + 0.04 * Math.sin(a * 3)), cy + Math.sin(a) * ry];
  });
}

/** 0..1 smooth pulse at t over period p. */
const pulse = (t, p) => 0.5 - 0.5 * Math.cos((TAU * t) / p);

/* Faces ------------------------------------------------------------------------- */

function faceBase(g, color) {
  circle(g, 50, 50, 44);
  const grad = g.createRadialGradient?.(38, 34, 6, 50, 50, 46);
  if (grad) {
    grad.addColorStop(0, shade(color, 0.25));
    grad.addColorStop(1, color);
    g.fillStyle = grad;
  } else g.fillStyle = color;
  g.fill();
  circle(g, 50, 50, 44);
  stroke(g, shade(color, -0.25), 2.2);
}

function eyes(g, open = 1, y = 42, dx = 15) {
  for (const x of [50 - dx, 50 + dx]) {
    g.beginPath();
    g.ellipse(x, y, 4.2, Math.max(0.6, 7 * open), 0, 0, TAU);
    fill(g, INK);
  }
}

function smileMouth(g, w = 20, y = 60, depth = 12) {
  g.beginPath();
  g.moveTo(50 - w, y);
  g.quadraticCurveTo(50, y + depth * 1.6, 50 + w, y);
  stroke(g, INK, 4);
}

function cheeks(g, alpha = 0.35) {
  g.globalAlpha = alpha;
  for (const x of [27, 73]) {
    g.beginPath();
    g.ellipse(x, 60, 7, 4.5, 0, 0, TAU);
    fill(g, '#ff6b81');
  }
  g.globalAlpha = 1;
}

function openMouth(g, y = 58, w = 22, h = 20) {
  g.beginPath();
  g.moveTo(50 - w, y);
  g.quadraticCurveTo(50, y + h * 2, 50 + w, y);
  g.closePath();
  fill(g, '#5a1f1f');
  g.save();
  g.clip();
  g.beginPath();
  g.ellipse(50, y + h * 1.05, w * 0.6, h * 0.45, 0, 0, TAU);
  fill(g, '#ff6b6b');
  g.fillStyle = '#ffffff';
  g.fillRect(50 - w, y - 1, w * 2, 5);
  g.restore();
}

const FACE = '#ffc93c';

const faces = [
  { id: 'face-smile', label: 'Smile', draw(g, o) { faceBase(g, o.color); eyes(g); smileMouth(g); cheeks(g, 0.25); } },
  { id: 'face-grin', label: 'Grin', draw(g, o) { faceBase(g, o.color); eyes(g, 0.9, 38); openMouth(g, 56, 24, 17); } },
  {
    id: 'face-joy', label: 'Tears of joy',
    draw(g, o) {
      faceBase(g, o.color);
      for (const [x, d] of [[35, 1], [65, -1]]) {
        g.beginPath();
        g.moveTo(x - 7, 40 + 3 * d * 0);
        g.quadraticCurveTo(x, 32, x + 7, 40);
        stroke(g, INK, 3.6);
      }
      openMouth(g, 55, 25, 18);
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(50 + s * 30, 44);
        g.quadraticCurveTo(50 + s * 44, 52, 50 + s * 40, 62);
        g.quadraticCurveTo(50 + s * 34, 56, 50 + s * 30, 44);
        fill(g, '#5cc8ff');
      }
    },
  },
  {
    id: 'face-wink', label: 'Wink',
    draw(g, o) {
      faceBase(g, o.color);
      g.beginPath();
      g.ellipse(35, 42, 4.2, 7, 0, 0, TAU);
      fill(g, INK);
      g.beginPath();
      g.moveTo(58, 43);
      g.quadraticCurveTo(65, 37, 72, 43);
      stroke(g, INK, 3.6);
      g.beginPath();
      g.moveTo(34, 62);
      g.quadraticCurveTo(52, 76, 68, 58);
      stroke(g, INK, 4);
      g.beginPath();
      g.ellipse(62, 66, 5, 6, 0.4, 0, Math.PI);
      fill(g, '#ff6b81');
    },
  },
  {
    id: 'face-love', label: 'Heart eyes',
    draw(g, o) {
      faceBase(g, o.color);
      heart(g, 34, 42, 26);
      fill(g, '#ff3b5c');
      heart(g, 66, 42, 26);
      fill(g, '#ff3b5c');
      openMouth(g, 60, 18, 12);
    },
  },
  {
    id: 'face-cool', label: 'Cool',
    draw(g, o) {
      faceBase(g, o.color);
      g.fillStyle = '#1d1d22';
      rr(g, 20, 34, 26, 16, 6);
      g.fill();
      rr(g, 54, 34, 26, 16, 6);
      g.fill();
      g.fillRect(44, 37, 12, 4);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(24, 37, 8, 3);
      g.fillRect(58, 37, 8, 3);
      g.beginPath();
      g.moveTo(36, 66);
      g.quadraticCurveTo(54, 74, 66, 62);
      stroke(g, INK, 4);
    },
  },
  {
    id: 'face-wow', label: 'Wow',
    draw(g, o) {
      faceBase(g, o.color);
      for (const x of [35, 65]) {
        circle(g, x, 40, 8);
        fill(g, '#ffffff');
        circle(g, x, 41, 4.5);
        fill(g, INK);
      }
      g.beginPath();
      g.ellipse(50, 67, 9, 12, 0, 0, TAU);
      fill(g, '#5a1f1f');
      for (const x of [35, 65]) {
        g.beginPath();
        g.moveTo(x - 8, 27);
        g.quadraticCurveTo(x, 22, x + 8, 27);
        stroke(g, INK, 3);
      }
    },
  },
  {
    id: 'face-sad', label: 'Sad',
    draw(g, o) {
      faceBase(g, o.color);
      eyes(g, 0.8, 44);
      g.beginPath();
      g.moveTo(34, 70);
      g.quadraticCurveTo(50, 58, 66, 70);
      stroke(g, INK, 4);
      g.beginPath();
      g.moveTo(66, 50);
      g.quadraticCurveTo(72, 60, 66, 64);
      g.quadraticCurveTo(60, 60, 66, 50);
      fill(g, '#5cc8ff');
    },
  },
  {
    id: 'face-angry', label: 'Angry',
    draw(g, o) {
      faceBase(g, o.color);
      g.globalAlpha = 0.35;
      circle(g, 50, 50, 44);
      g.save();
      g.clip();
      const grad = g.createLinearGradient?.(0, 6, 0, 60);
      if (grad) {
        grad.addColorStop(0, '#ff3b30');
        grad.addColorStop(1, 'rgba(255,59,48,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 100, 60);
      }
      g.restore();
      g.globalAlpha = 1;
      eyes(g, 0.7, 46);
      g.beginPath();
      g.moveTo(24, 32);
      g.lineTo(43, 40);
      g.moveTo(76, 32);
      g.lineTo(57, 40);
      stroke(g, INK, 4.5);
      g.beginPath();
      g.moveTo(36, 72);
      g.quadraticCurveTo(50, 62, 64, 72);
      stroke(g, INK, 4);
    },
  },
  {
    id: 'face-sleepy', label: 'Sleepy',
    draw(g, o) {
      faceBase(g, o.color);
      for (const x of [35, 65]) {
        g.beginPath();
        g.moveTo(x - 8, 44);
        g.quadraticCurveTo(x, 50, x + 8, 44);
        stroke(g, INK, 3.6);
      }
      g.beginPath();
      g.ellipse(52, 68, 6, 5, 0, 0, TAU);
      fill(g, '#5a1f1f');
      label(g, 'Z', 78, 20, 18, '#7a8bff', 20);
      label(g, 'z', 90, 8, 13, '#7a8bff', 20);
    },
  },
  {
    id: 'face-starry', label: 'Star eyes',
    draw(g, o) {
      faceBase(g, o.color);
      star(g, 34, 42, 5, 11, 4.6);
      fill(g, '#ff9f1a');
      star(g, 66, 42, 5, 11, 4.6);
      fill(g, '#ff9f1a');
      openMouth(g, 60, 20, 13);
    },
  },
  {
    id: 'face-blush', label: 'Shy',
    draw(g, o) {
      faceBase(g, o.color);
      for (const x of [35, 65]) {
        g.beginPath();
        g.moveTo(x - 7, 44);
        g.quadraticCurveTo(x, 37, x + 7, 44);
        stroke(g, INK, 3.6);
      }
      cheeks(g, 0.6);
      smileMouth(g, 10, 64, 6);
    },
  },
  {
    id: 'face-party', label: 'Party',
    draw(g, o) {
      g.save();
      g.translate(0, 6);
      g.scale(0.92, 0.92);
      g.translate(4, 4);
      faceBase(g, o.color);
      eyes(g, 0.9, 44);
      openMouth(g, 60, 18, 12);
      g.restore();
      g.beginPath();
      g.moveTo(56, 2);
      g.lineTo(76, 34);
      g.lineTo(44, 30);
      g.closePath();
      fill(g, '#7c4dff');
      g.save();
      g.clip();
      g.fillStyle = '#ffd23f';
      for (const y of [12, 22]) g.fillRect(40, y, 40, 4);
      g.restore();
      circle(g, 56, 3, 4);
      fill(g, '#ff5a5f');
    },
  },
  {
    id: 'face-blink', label: 'Blinking face', anim: true,
    draw(g, o) {
      faceBase(g, o.color);
      // Blink once every 2.4 s, a quick close and open.
      const ph = (o.t % 2.4) / 2.4;
      const open = ph > 0.9 ? Math.abs(Math.cos(((ph - 0.9) / 0.1) * Math.PI)) : 1;
      eyes(g, open);
      smileMouth(g);
      cheeks(g, 0.25);
    },
  },
].map((f) => ({ ...f, cat: 'faces', multi: true, main: FACE }));

/* Badges & labels ----------------------------------------------------------------- */

const badges = [
  {
    id: 'badge-new', label: 'New badge', main: '#ff3b5c',
    draw(g, o) {
      star(g, 50, 50, 16, 46, 38, 0);
      fill(g, o.color);
      circle(g, 50, 50, 33);
      stroke(g, 'rgba(255,255,255,0.6)', 1.6);
      label(g, 'NEW', 50, 52, 24, onColor(o.color), 56);
    },
  },
  {
    id: 'badge-sale', label: 'Sale tag', main: '#ffd23f',
    draw(g, o) {
      g.save();
      g.translate(50, 50);
      g.rotate(-0.25);
      g.beginPath();
      g.moveTo(-42, -20);
      g.lineTo(26, -20);
      g.lineTo(44, 0);
      g.lineTo(26, 20);
      g.lineTo(-42, 20);
      g.closePath();
      fill(g, o.color);
      circle(g, 27, 0, 4);
      fill(g, '#1b1b1f');
      label(g, 'SALE', -8, 1, 20, onColor(o.color), 54);
      g.restore();
    },
  },
  {
    id: 'badge-live', label: 'Live', main: '#ff2d55', anim: true,
    draw(g, o) {
      rr(g, 8, 32, 84, 36, 18);
      fill(g, o.color);
      const p = pulse(o.t, 1.2);
      g.globalAlpha = 0.35 + 0.65 * (1 - p);
      circle(g, 27, 50, 6 + 4 * p);
      fill(g, '#ffffff');
      g.globalAlpha = 1;
      circle(g, 27, 50, 6);
      fill(g, '#ffffff');
      label(g, 'LIVE', 60, 51, 22, '#ffffff', 46);
    },
  },
  {
    id: 'badge-hot', label: 'Hot', main: '#ff6a00',
    draw(g, o) {
      rr(g, 10, 30, 80, 40, 10);
      fill(g, o.color);
      g.beginPath();
      g.moveTo(26, 62);
      g.bezierCurveTo(14, 54, 20, 42, 26, 36);
      g.bezierCurveTo(26, 44, 32, 44, 32, 40);
      g.bezierCurveTo(38, 48, 38, 58, 26, 62);
      fill(g, '#ffe14d');
      label(g, 'HOT', 60, 51, 22, '#ffffff', 44);
    },
  },
  {
    id: 'badge-off', label: 'Percent off', main: '#00c2a8',
    draw(g, o) {
      star(g, 50, 50, 12, 47, 36, 0);
      fill(g, o.color);
      label(g, '-50%', 50, 47, 24, onColor(o.color), 62);
      label(g, 'OFF', 50, 66, 11, onColor(o.color), 40, 700);
    },
  },
  {
    id: 'badge-seal', label: 'Approved seal', main: '#2f80ed',
    draw(g, o) {
      for (const [x, r] of [[38, -0.35], [62, 0.35]]) {
        g.save();
        g.translate(x, 70);
        g.rotate(r);
        g.beginPath();
        g.moveTo(-8, 0);
        g.lineTo(8, 0);
        g.lineTo(8, 26);
        g.lineTo(0, 20);
        g.lineTo(-8, 26);
        g.closePath();
        fill(g, shade(o.color, -0.3));
        g.restore();
      }
      star(g, 50, 44, 20, 38, 33, 0);
      fill(g, o.color);
      circle(g, 50, 44, 27);
      stroke(g, '#ffffff', 2);
      g.beginPath();
      g.moveTo(38, 44);
      g.lineTo(47, 53);
      g.lineTo(63, 36);
      stroke(g, '#ffffff', 6);
    },
  },
  {
    id: 'badge-ribbon', label: 'Ribbon label', main: '#e63946',
    draw(g, o) {
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(50 + s * 30, 42);
        g.lineTo(50 + s * 48, 42);
        g.lineTo(50 + s * 40, 54);
        g.lineTo(50 + s * 48, 66);
        g.lineTo(50 + s * 30, 66);
        g.closePath();
        fill(g, shade(o.color, -0.3));
      }
      rr(g, 16, 34, 68, 26, 3);
      fill(g, o.color);
      label(g, 'TOP PICK', 50, 48, 13, onColor(o.color), 60);
    },
  },
  {
    id: 'badge-medal', label: 'Medal', main: '#f5b83d',
    draw(g, o) {
      g.beginPath();
      g.moveTo(32, 4);
      g.lineTo(46, 4);
      g.lineTo(56, 40);
      g.lineTo(42, 40);
      g.closePath();
      fill(g, '#3b82f6');
      g.beginPath();
      g.moveTo(68, 4);
      g.lineTo(54, 4);
      g.lineTo(44, 40);
      g.lineTo(58, 40);
      g.closePath();
      fill(g, '#ef4444');
      circle(g, 50, 64, 30);
      fill(g, o.color);
      circle(g, 50, 64, 22);
      stroke(g, shade(o.color, -0.25), 3);
      label(g, '1', 50, 66, 26, shade(o.color, -0.5), 30);
    },
  },
  {
    id: 'label-tape', label: 'Tape strip', main: '#f7e3a1',
    draw(g, o) {
      g.save();
      g.translate(50, 50);
      g.rotate(-0.12);
      g.beginPath();
      const r = rng(5);
      g.moveTo(-46, -14);
      for (let y = -14; y <= 14; y += 4) g.lineTo(-46 + (r() - 0.5) * 4, y);
      for (let y = 14; y >= -14; y -= 4) g.lineTo(46 + (r() - 0.5) * 4, y);
      g.closePath();
      g.globalAlpha = 0.9;
      fill(g, o.color);
      g.globalAlpha = 0.15;
      g.fillStyle = '#ffffff';
      for (let x = -42; x < 46; x += 6) g.fillRect(x, -14, 2, 28);
      g.globalAlpha = 1;
      g.restore();
    },
  },
  {
    id: 'label-free', label: 'Free sticker', main: '#7c4dff',
    draw(g, o) {
      circle(g, 50, 50, 42);
      fill(g, o.color);
      circle(g, 50, 50, 36);
      g.setLineDash?.([4, 4]);
      stroke(g, 'rgba(255,255,255,0.8)', 2);
      g.setLineDash?.([]);
      label(g, 'FREE', 50, 52, 24, onColor(o.color), 56);
    },
  },
].map((b) => ({ ...b, cat: 'badges', multi: true }));

/* Social callouts (generic, no brand marks) ------------------------------------- */

function bell(g, color, swing = 0) {
  g.save();
  g.translate(50, 18);
  g.rotate(swing);
  g.translate(-50, -18);
  g.beginPath();
  g.moveTo(50, 14);
  g.bezierCurveTo(30, 14, 28, 34, 28, 48);
  g.lineTo(22, 64);
  g.lineTo(78, 64);
  g.lineTo(72, 48);
  g.bezierCurveTo(72, 34, 70, 14, 50, 14);
  g.closePath();
  fill(g, color);
  circle(g, 50, 12, 4);
  fill(g, color);
  g.restore();
  g.save();
  g.translate(50, 18);
  g.rotate(-swing * 1.6);
  g.translate(-50, -18);
  circle(g, 50, 71, 7);
  fill(g, shade(color, -0.3));
  g.restore();
}

const social = [
  {
    id: 'social-follow', label: 'Follow button', main: '#ff2d55',
    draw(g, o) {
      rr(g, 6, 32, 88, 36, 18);
      fill(g, o.color);
      g.beginPath();
      g.moveTo(22, 50);
      g.lineTo(34, 50);
      g.moveTo(28, 44);
      g.lineTo(28, 56);
      stroke(g, onColor(o.color), 4);
      label(g, 'Follow', 60, 51, 18, onColor(o.color), 48, 700);
    },
  },
  {
    id: 'social-like', label: 'Like button', main: '#14b8a6',
    draw(g, o) {
      rr(g, 6, 32, 88, 36, 10);
      fill(g, o.color);
      g.save();
      g.translate(16, 37);
      g.scale(1.05, 1.05);
      g.beginPath();
      g.moveTo(2, 10);
      g.lineTo(7, 10);
      g.lineTo(7, 22);
      g.lineTo(2, 22);
      g.closePath();
      g.moveTo(9, 10);
      g.lineTo(13, 2);
      g.quadraticCurveTo(17, 2, 16, 7);
      g.lineTo(15, 10);
      g.lineTo(22, 10);
      g.quadraticCurveTo(25, 11, 24, 14);
      g.lineTo(22, 21);
      g.quadraticCurveTo(21, 22, 19, 22);
      g.lineTo(9, 22);
      g.closePath();
      fill(g, onColor(o.color));
      g.restore();
      label(g, 'Like', 62, 51, 18, onColor(o.color), 40, 700);
    },
  },
  {
    id: 'social-bell', label: 'Ringing bell', main: '#ffc93c', anim: true,
    draw(g, o) {
      const sw = Math.sin(o.t * TAU * 2.2) * 0.35 * (Math.sin(o.t * TAU * 0.5) > 0 ? 1 : 0.15);
      bell(g, o.color, sw);
      g.globalAlpha = Math.abs(sw) * 2.4;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.arc(50, 40, 40, s < 0 ? Math.PI * 1.05 : -Math.PI * 0.25, s < 0 ? Math.PI * 1.25 : -Math.PI * 0.05);
        stroke(g, o.color, 3.5);
      }
      g.globalAlpha = 1;
    },
  },
  {
    id: 'social-comment', label: 'Typing bubble', main: '#ffffff', anim: true,
    draw(g, o) {
      rr(g, 8, 18, 84, 52, 24);
      fill(g, o.color);
      g.beginPath();
      g.moveTo(24, 64);
      g.lineTo(16, 86);
      g.lineTo(40, 68);
      g.closePath();
      fill(g, o.color);
      const dot = onColor(o.color) === '#ffffff' ? 'rgba(255,255,255,0.9)' : '#7a7a85';
      for (let i = 0; i < 3; i++) {
        const y = 44 - 5 * Math.max(0, Math.sin(o.t * TAU * 1.4 - i * 0.9));
        circle(g, 34 + i * 16, y, 5.5);
        fill(g, dot);
      }
    },
  },
  {
    id: 'social-share', label: 'Share button', main: '#00b37e',
    draw(g, o) {
      circle(g, 50, 50, 42);
      fill(g, o.color);
      const c = onColor(o.color);
      g.beginPath();
      g.moveTo(34, 56);
      g.lineTo(62, 40);
      g.moveTo(34, 56);
      g.lineTo(62, 68);
      stroke(g, c, 4);
      for (const [x, y] of [[34, 56], [64, 38], [64, 70]]) {
        circle(g, x, y, 7.5);
        fill(g, c);
      }
    },
  },
  {
    id: 'social-hearts', label: 'Heart count', main: '#ff3b5c', anim: true,
    draw(g, o) {
      rr(g, 6, 30, 88, 40, 20);
      fill(g, '#ffffff');
      const k = 1 + 0.18 * Math.max(0, Math.sin(o.t * TAU * 1.1)) ** 4;
      g.save();
      g.translate(26, 50);
      g.scale(k, k);
      heart(g, 0, 0, 30);
      fill(g, o.color);
      g.restore();
      label(g, '1.2K', 64, 51, 20, '#1b1b1f', 42);
    },
  },
  {
    id: 'social-notify', label: 'Notify me', main: '#7c4dff',
    draw(g, o) {
      rr(g, 6, 32, 88, 36, 18);
      fill(g, o.color);
      g.save();
      g.translate(12, 39);
      g.scale(0.26, 0.26);
      bell(g, onColor(o.color));
      g.restore();
      label(g, 'Notify me', 62, 51, 16, onColor(o.color), 48, 700);
    },
  },
  {
    id: 'social-link', label: 'Link below', main: '#1b1b1f',
    draw(g, o) {
      rr(g, 6, 32, 88, 36, 10);
      fill(g, o.color);
      const c = onColor(o.color);
      g.save();
      g.translate(22, 50);
      g.rotate(-Math.PI / 4);
      rr(g, -11, -5, 13, 10, 5);
      stroke(g, c, 3);
      rr(g, -2, -5, 13, 10, 5);
      stroke(g, c, 3);
      g.restore();
      label(g, 'Link below', 60, 51, 15, c, 52, 700);
    },
  },
].map((b) => ({ ...b, cat: 'social', multi: true }));

/* Sparkles & shapes ---------------------------------------------------------------- */

const sparkles = [
  {
    id: 'sparkle-cluster', label: 'Sparkles', multi: true, main: '#ffd23f',
    draw(g, o) {
      star(g, 42, 52, 4, 34, 7, 0);
      fill(g, o.color);
      star(g, 76, 24, 4, 16, 3.5, 0);
      fill(g, shade(o.color, 0.4));
      star(g, 78, 76, 4, 11, 2.5, 0);
      fill(g, '#ffffff');
    },
  },
  {
    id: 'sparkle-spin', label: 'Spinning sparkle', anim: true,
    draw(g, o) {
      const k = 0.85 + 0.15 * pulse(o.t, 1.6);
      g.save();
      g.translate(50, 50);
      g.rotate(o.t * 1.6);
      g.scale(k, k);
      star(g, 0, 0, 4, 46, 9, 0);
      fill(g, o.color);
      g.restore();
    },
  },
  {
    id: 'confetti-fall', label: 'Confetti', multi: true, main: '#ff5a5f', anim: true,
    draw(g, o) {
      const colors = [o.color, '#ffd23f', '#3ec6e0', '#7ee081', '#b38cff'];
      const r = rng(77);
      for (let i = 0; i < 26; i++) {
        const x0 = r() * 100;
        const speed = 18 + r() * 22;
        const y = ((r() * 100 + o.t * speed) % 110) - 5;
        const x = x0 + Math.sin(o.t * 2 + i) * 4;
        g.save();
        g.translate(x, y);
        g.rotate(o.t * (1 + r() * 3) + i);
        g.fillStyle = colors[i % colors.length];
        if (i % 3 === 0) {
          circle(g, 0, 0, 2.6);
          g.fill();
        } else g.fillRect(-4, -1.6, 8, 3.2);
        g.restore();
      }
    },
  },
  { id: 'hexagon', label: 'Hexagon', draw(g, o) { star(g, 50, 50, 3, 46, 46, 0); fill(g, o.color); } },
  { id: 'diamond', label: 'Diamond', draw(g, o) { g.beginPath(); g.moveTo(50, 4); g.lineTo(92, 50); g.lineTo(50, 96); g.lineTo(8, 50); g.closePath(); fill(g, o.color); } },
  { id: 'pentagon', label: 'Pentagon', draw(g, o) { star(g, 50, 53, 5, 46, 46 * Math.cos(Math.PI / 5)); fill(g, o.color); } },
  {
    id: 'plus-sign', label: 'Plus',
    draw(g, o) {
      rr(g, 38, 8, 24, 84, 8);
      fill(g, o.color);
      rr(g, 8, 38, 84, 24, 8);
      fill(g, o.color);
    },
  },
  { id: 'half-circle', label: 'Half circle', draw(g, o) { g.beginPath(); g.arc(50, 70, 46, Math.PI, 0); g.closePath(); fill(g, o.color); } },
  {
    id: 'zigzag', label: 'Zigzag',
    draw(g, o) {
      g.beginPath();
      for (let i = 0; i <= 8; i++) g[i ? 'lineTo' : 'moveTo'](6 + i * 11, i % 2 ? 36 : 64);
      stroke(g, o.color, 8, 'round');
    },
  },
  {
    id: 'dot-grid', label: 'Dot grid',
    draw(g, o) {
      for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
        circle(g, 14 + x * 18, 14 + y * 18, 4.5);
        fill(g, o.color);
      }
    },
  },
  {
    id: 'flower', label: 'Flower', multi: true, main: '#ff7eb6',
    draw(g, o) {
      for (let i = 0; i < 6; i++) {
        g.save();
        g.translate(50, 50);
        g.rotate((i * TAU) / 6);
        g.beginPath();
        g.ellipse(0, -24, 15, 22, 0, 0, TAU);
        fill(g, o.color);
        g.restore();
      }
      circle(g, 50, 50, 14);
      fill(g, '#ffd23f');
    },
  },
  {
    id: 'sun-rays', label: 'Rays',
    draw(g, o) {
      for (let i = 0; i < 16; i++) {
        g.save();
        g.translate(50, 50);
        g.rotate((i * TAU) / 16);
        g.beginPath();
        g.moveTo(-3, -18);
        g.lineTo(0, -48);
        g.lineTo(3, -18);
        g.closePath();
        fill(g, o.color);
        g.restore();
      }
      circle(g, 50, 50, 14);
      fill(g, o.color);
    },
  },
  {
    id: 'wave-line', label: 'Wave',
    draw(g, o) {
      g.beginPath();
      for (let x = 6; x <= 94; x += 2) g[x === 6 ? 'moveTo' : 'lineTo'](x, 50 + Math.sin(((x - 6) / 88) * TAU * 2) * 14);
      stroke(g, o.color, 7);
    },
  },
  {
    id: 'heart-pulse', label: 'Beating heart', anim: true,
    draw(g, o) {
      // Two quick beats, then a rest.
      const ph = (o.t % 1.1) / 1.1;
      const beat = Math.max(Math.exp(-(((ph - 0.08) / 0.06) ** 2)), 0.7 * Math.exp(-(((ph - 0.3) / 0.06) ** 2)));
      const k = 0.86 + 0.16 * beat;
      g.save();
      g.translate(50, 54);
      g.scale(k, k);
      heart(g, 0, 0, 104);
      fill(g, o.color);
      g.restore();
    },
  },
  {
    id: 'equalizer', label: 'Equalizer', anim: true,
    draw(g, o) {
      for (let i = 0; i < 7; i++) {
        const v = 0.25 + 0.75 * Math.abs(Math.sin(o.t * (2.2 + i * 0.37) + i * 1.3) * Math.cos(o.t * 0.9 + i));
        const hh = 12 + v * 72;
        rr(g, 9 + i * 12, 90 - hh, 9, hh, 3);
        fill(g, o.color);
      }
    },
  },
  {
    id: 'loading-ring', label: 'Loading ring', anim: true,
    draw(g, o) {
      g.beginPath();
      g.arc(50, 50, 36, 0, TAU);
      g.globalAlpha = 0.25;
      stroke(g, o.color, 9);
      g.globalAlpha = 1;
      const a = o.t * TAU * 0.9;
      const len = 0.9 + 0.7 * pulse(o.t, 1.4);
      g.beginPath();
      g.arc(50, 50, 36, a, a + len * Math.PI);
      stroke(g, o.color, 9);
    },
  },
  {
    id: 'typing-dots', label: 'Typing dots', anim: true,
    draw(g, o) {
      for (let i = 0; i < 3; i++) {
        const b = Math.max(0, Math.sin(o.t * TAU * 1.3 - i * 0.8));
        g.globalAlpha = 0.45 + 0.55 * b;
        circle(g, 22 + i * 28, 54 - b * 10, 10);
        fill(g, o.color);
      }
      g.globalAlpha = 1;
    },
  },
  {
    id: 'rec-dot', label: 'Recording', multi: true, main: '#ff3b30', anim: true,
    draw(g, o) {
      g.globalAlpha = Math.floor(o.t / 0.6) % 2 ? 0.25 : 1;
      circle(g, 22, 50, 12);
      fill(g, o.color);
      g.globalAlpha = 1;
      label(g, 'REC', 62, 51, 26, '#ffffff', 56);
    },
  },
  {
    id: 'eyes-blink', label: 'Looking eyes', multi: true, main: '#ffffff', anim: true,
    draw(g, o) {
      const ph = (o.t % 3) / 3;
      const open = ph > 0.92 ? Math.abs(Math.cos(((ph - 0.92) / 0.08) * Math.PI)) : 1;
      const look = Math.sin(o.t * 1.3) * 6;
      for (const x of [30, 70]) {
        g.save();
        g.translate(x, 50);
        g.scale(1, Math.max(0.08, open));
        g.beginPath();
        g.ellipse(0, 0, 18, 26, 0, 0, TAU);
        fill(g, o.color);
        g.lineWidth = 3;
        g.strokeStyle = INK;
        g.stroke();
        circle(g, look, 4, 9);
        fill(g, INK);
        circle(g, look + 3, 0, 3);
        fill(g, '#ffffff');
        g.restore();
      }
    },
  },
  {
    id: 'wave-hand', label: 'Waving hand', multi: true, main: '#ffc93c', anim: true,
    draw(g, o) {
      const a = Math.sin(o.t * TAU * 1.6) * 0.35;
      g.save();
      g.translate(52, 86);
      g.rotate(a);
      g.translate(-52, -86);
      const c = o.color;
      // Palm and four fingers.
      rr(g, 30, 44, 42, 42, 18);
      fill(g, c);
      for (const [x, top] of [[32, 14], [43, 8], [54, 10], [65, 20]]) {
        rr(g, x, top, 10, 48 - top + 10, 5);
        fill(g, c);
      }
      g.save();
      g.translate(30, 62);
      g.rotate(-0.9);
      rr(g, -6, -24, 11, 30, 5.5);
      fill(g, c);
      g.restore();
      rr(g, 30, 44, 42, 42, 18);
      stroke(g, shade(c, -0.3), 2);
      g.restore();
      g.globalAlpha = Math.abs(a) * 2.2;
      for (const r of [10, 18]) {
        g.beginPath();
        g.arc(82, 26, r, -1.2, 0.2);
        stroke(g, shade(c, -0.2), 3);
      }
      g.globalAlpha = 1;
    },
  },
].map((b) => ({ cat: 'sparkles', ...b }));

/* Frames -------------------------------------------------------------------------- */

const frames = [
  { id: 'frame-rounded', label: 'Rounded frame', draw(g, o) { rr(g, 6, 6, 88, 88, 14); stroke(g, o.color, 5); } },
  {
    id: 'frame-polaroid', label: 'Photo frame', multi: true, main: '#fbfaf5',
    draw(g, o) {
      g.save();
      g.translate(50, 50);
      g.rotate(-0.05);
      g.shadowColor = 'rgba(0,0,0,0.25)';
      g.shadowBlur = 6;
      g.shadowOffsetY = 2;
      g.fillStyle = o.color;
      g.fillRect(-40, -44, 80, 88);
      g.shadowColor = 'transparent';
      g.globalCompositeOperation = 'destination-out';
      g.fillRect(-34, -38, 68, 64);
      g.globalCompositeOperation = 'source-over';
      g.restore();
    },
  },
  {
    id: 'frame-film', label: 'Film strip', multi: true, main: '#1b1b1f',
    draw(g, o) {
      g.fillStyle = o.color;
      g.fillRect(4, 14, 92, 72);
      g.globalCompositeOperation = 'destination-out';
      g.fillRect(14, 24, 72, 52);
      for (let x = 7; x < 94; x += 9) {
        rr(g, x, 16.5, 5, 5, 1);
        g.fill();
        rr(g, x, 78.5, 5, 5, 1);
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    },
  },
  {
    id: 'frame-corners', label: 'Viewfinder',
    draw(g, o) {
      g.beginPath();
      for (const [x, y, dx, dy] of [[8, 8, 1, 1], [92, 8, -1, 1], [8, 92, 1, -1], [92, 92, -1, -1]]) {
        g.moveTo(x, y + dy * 18);
        g.lineTo(x, y);
        g.lineTo(x + dx * 18, y);
      }
      stroke(g, o.color, 5, 'square');
      g.beginPath();
      g.moveTo(44, 50);
      g.lineTo(56, 50);
      g.moveTo(50, 44);
      g.lineTo(50, 56);
      stroke(g, o.color, 2);
    },
  },
  {
    id: 'frame-dashed', label: 'Dashed frame',
    draw(g, o) {
      g.setLineDash?.([8, 6]);
      rr(g, 6, 6, 88, 88, 6);
      stroke(g, o.color, 3.5, 'butt');
      g.setLineDash?.([]);
    },
  },
  {
    id: 'frame-double', label: 'Double frame',
    draw(g, o) {
      g.strokeStyle = o.color;
      g.lineWidth = 4;
      g.strokeRect(5, 5, 90, 90);
      g.lineWidth = 1.5;
      g.strokeRect(11, 11, 78, 78);
    },
  },
  { id: 'frame-circle', label: 'Circle frame', draw(g, o) { circle(g, 50, 50, 44); stroke(g, o.color, 5); circle(g, 50, 50, 38); stroke(g, o.color, 1.5); } },
  {
    id: 'frame-scallop', label: 'Scalloped frame',
    draw(g, o) {
      g.beginPath();
      const n = 28;
      for (let i = 0; i <= n * 4; i++) {
        const side = Math.floor(i / n) % 4;
        const f = (i % n) / n;
        const bump = Math.abs(Math.sin(f * Math.PI * 7)) * 3;
        const [x, y] = [[6 + 88 * f, 6 + bump], [94 - bump, 6 + 88 * f], [94 - 88 * f, 94 - bump], [6 + bump, 94 - 88 * f]][side];
        g[i ? 'lineTo' : 'moveTo'](x, y);
      }
      g.closePath();
      stroke(g, o.color, 3);
    },
  },
].map((b) => ({ cat: 'frames', ...b }));

/* Doodles (hand drawn) ------------------------------------------------------------- */

const doodle = (id, label, draw) => ({ id, label, cat: 'doodles', draw });

const doodles = [
  doodle('doodle-scribble', 'Scribble', (g, o) => {
    const r = rng(9);
    const pts = [];
    for (let i = 0; i < 26; i++) pts.push([14 + (i / 25) * 72 + (r() - 0.5) * 6, i % 2 ? 22 + r() * 10 : 70 + r() * 10]);
    handLine(g, pts, 9, 2);
    stroke(g, o.color, 3.5);
  }),
  doodle('doodle-squiggle', 'Squiggle', (g, o) => {
    const pts = Array.from({ length: 30 }, (_, i) => [8 + i * 2.9, 50 + Math.sin(i * 0.9) * 12 + Math.sin(i * 0.31) * 6]);
    handLine(g, pts, 4, 1);
    stroke(g, o.color, 5);
  }),
  doodle('doodle-circle', 'Hand circle', (g, o) => {
    handLine(g, ellipsePts(50, 50, 44, 30, 1.12, 40, -2.2), 12, 1.6);
    stroke(g, o.color, 4);
  }),
  doodle('doodle-underline', 'Scribble underline', (g, o) => {
    handLine(g, [[6, 46], [40, 42], [94, 44], [20, 54], [60, 52], [88, 56]], 21, 1.5);
    stroke(g, o.color, 5);
  }),
  doodle('doodle-star', 'Hand star', (g, o) => {
    // A five-point star in one stroke, corners slightly off as if drawn quickly.
    const r = rng(31);
    g.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
      const x = 50 + Math.cos(a) * 44 + (r() - 0.5) * 4;
      const y = 54 + Math.sin(a) * 44 + (r() - 0.5) * 4;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.lineTo(50 + Math.cos(-Math.PI / 2 + (4 * Math.PI) / 5) * 30, 54 + Math.sin(-Math.PI / 2 + (4 * Math.PI) / 5) * 30);
    stroke(g, o.color, 4);
  }),
  doodle('doodle-spiral', 'Spiral', (g, o) => {
    const pts = Array.from({ length: 90 }, (_, i) => {
      const a = i * 0.22;
      const r = 3 + i * 0.47;
      return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r];
    });
    handLine(g, pts, 2, 0.8);
    stroke(g, o.color, 4);
  }),
  doodle('doodle-cross', 'Cross out', (g, o) => {
    handLine(g, [[12, 14], [50, 52], [88, 88]], 3, 2);
    stroke(g, o.color, 7);
    handLine(g, [[86, 12], [52, 48], [14, 86]], 8, 2);
    stroke(g, o.color, 7);
  }),
  doodle('doodle-exclaim', 'Exclamation', (g, o) => {
    for (const x of [36, 64]) {
      handLine(g, [[x - 2, 10], [x, 40], [x + 1, 62]], x, 1.5);
      stroke(g, o.color, 8);
      circle(g, x + 1, 82, 5.5);
      fill(g, o.color);
    }
  }),
  doodle('doodle-heart', 'Hand heart', (g, o) => {
    const pts = Array.from({ length: 50 }, (_, i) => {
      const a = (i / 49) * TAU * 1.06;
      const x = 16 * Math.sin(a) ** 3;
      const y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
      return [50 + x * 2.6, 46 + y * 2.6];
    });
    handLine(g, pts, 13, 1.4);
    stroke(g, o.color, 4);
  }),
  doodle('doodle-crown', 'Hand crown', (g, o) => {
    handLine(g, [[14, 76], [10, 30], [32, 52], [50, 22], [68, 52], [90, 30], [86, 76], [14, 76]], 17, 1.8);
    stroke(g, o.color, 4);
    for (const [x, y] of [[10, 26], [50, 18], [90, 26]]) {
      circle(g, x, y, 4);
      fill(g, o.color);
    }
  }),
  doodle('doodle-action', 'Action lines', (g, o) => {
    const r = rng(41);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + r() * 0.2;
      const r0 = 24 + r() * 8;
      const r1 = 40 + r() * 8;
      g.beginPath();
      g.moveTo(50 + Math.cos(a) * r0, 50 + Math.sin(a) * r0);
      g.lineTo(50 + Math.cos(a) * r1, 50 + Math.sin(a) * r1);
      stroke(g, o.color, 3.5);
    }
  }),
  doodle('doodle-check', 'Hand check', (g, o) => {
    handLine(g, [[12, 52], [36, 78], [90, 18]], 6, 2);
    stroke(g, o.color, 9);
  }),
  doodle('doodle-arrow', 'Hand arrow', (g, o) => {
    handLine(g, [[10, 80], [30, 40], [62, 30], [84, 34]], 19, 1.5);
    stroke(g, o.color, 5);
    handLine(g, [[70, 18], [86, 34], [68, 48]], 23, 1.2);
    stroke(g, o.color, 5);
  }),
];

/* Arrows ---------------------------------------------------------------------------- */

function arrowHead(g, x, y, ang, size, color) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.beginPath();
  g.moveTo(size, 0);
  g.lineTo(-size * 0.6, -size * 0.75);
  g.lineTo(-size * 0.6, size * 0.75);
  g.closePath();
  fill(g, color);
  g.restore();
}

const arrows = [
  {
    id: 'arrow-dashed', label: 'Dashed arrow',
    draw(g, o) {
      g.setLineDash?.([7, 6]);
      g.beginPath();
      g.moveTo(10, 82);
      g.bezierCurveTo(20, 30, 60, 20, 80, 36);
      stroke(g, o.color, 4.5, 'butt');
      g.setLineDash?.([]);
      arrowHead(g, 82, 38, 0.75, 12, o.color);
    },
  },
  {
    id: 'arrow-double', label: 'Double arrow',
    draw(g, o) {
      rr(g, 20, 44, 60, 12, 2);
      fill(g, o.color);
      arrowHead(g, 84, 50, 0, 16, o.color);
      arrowHead(g, 16, 50, Math.PI, 16, o.color);
    },
  },
  {
    id: 'arrow-bounce', label: 'Bouncing arrow', anim: true,
    draw(g, o) {
      const y = -10 * Math.abs(Math.sin(o.t * Math.PI * 1.6));
      g.save();
      g.translate(0, y + 4);
      rr(g, 40, 6, 20, 46, 4);
      fill(g, o.color);
      g.beginPath();
      g.moveTo(16, 48);
      g.lineTo(84, 48);
      g.lineTo(50, 88);
      g.closePath();
      fill(g, o.color);
      g.restore();
    },
  },
  {
    id: 'arrow-circular', label: 'Circular arrow',
    draw(g, o) {
      g.beginPath();
      g.arc(50, 50, 32, -Math.PI * 0.35, Math.PI * 1.35);
      stroke(g, o.color, 9, 'butt');
      const a = -Math.PI * 0.35;
      arrowHead(g, 50 + Math.cos(a) * 32, 50 + Math.sin(a) * 32, a + Math.PI / 2, 16, o.color);
    },
  },
  {
    id: 'arrow-zigzag', label: 'Zigzag arrow',
    draw(g, o) {
      g.beginPath();
      g.moveTo(8, 70);
      g.lineTo(32, 46);
      g.lineTo(50, 62);
      g.lineTo(76, 36);
      stroke(g, o.color, 7);
      arrowHead(g, 82, 30, -Math.PI / 4, 14, o.color);
    },
  },
  {
    id: 'arrow-chunky', label: 'Bold 3D arrow', multi: true, main: '#ffd23f',
    draw(g, o) {
      const path = (dx, dy) => {
        g.beginPath();
        g.moveTo(8 + dx, 38 + dy);
        g.lineTo(54 + dx, 38 + dy);
        g.lineTo(54 + dx, 20 + dy);
        g.lineTo(90 + dx, 50 + dy);
        g.lineTo(54 + dx, 80 + dy);
        g.lineTo(54 + dx, 62 + dy);
        g.lineTo(8 + dx, 62 + dy);
        g.closePath();
      };
      path(3, 5);
      fill(g, shade(o.color, -0.45));
      path(0, 0);
      fill(g, o.color);
      g.lineWidth = 2;
      g.strokeStyle = shade(o.color, -0.35);
      g.stroke();
    },
  },
].map((b) => ({ cat: 'arrows', ...b }));

export const EXTRA_STICKERS = [...faces, ...badges, ...social, ...sparkles, ...frames, ...doodles, ...arrows];
export const EXTRA_BY_ID = new Map(EXTRA_STICKERS.map((s) => [s.id, s]));

/** Draw an extra graphic into a square of size s with options { color, t }. */
export function drawExtra(g, def, s, { color, t = 0 } = {}) {
  g.save();
  g.scale(s / 100, s / 100);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  def.draw(g, { color, t: Number.isFinite(t) ? Math.max(0, t) : 0 });
  g.restore();
}
