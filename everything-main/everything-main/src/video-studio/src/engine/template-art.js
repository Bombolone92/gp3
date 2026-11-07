/**
 * Generated media for project templates: backdrops (gradients, glows and
 * patterns) and placeholder slots drawn with Canvas 2D, plus sound effects
 * rendered from media/sfx.js. Nothing is downloaded.
 *
 * Art spec (see model/templates.js):
 *   stops: [hex...], angle: degrees | radial: true
 *   glows: [{ x, y, r, color, alpha }]       soft light spots (fractions of the frame)
 *   pattern: { type: 'dots'|'grid'|'stripes'|'rings'|'waves'|'confetti', color, alpha, size, gap, seed, count }
 *   vignette: 0..1, frame: { color, alpha, width }, radius: fraction of the short side (PNG with transparency)
 *   slot: label for a placeholder the user replaces, icon: 'image'|'video'|'product'
 */
import { renderSfx } from '../media/sfx.js';
import { encodeWav } from '../media/wav.js';

const CONFETTI = ['#ffd23f', '#ff5a5f', '#3ec6e0', '#7ee081', '#ffffff', '#ff9ff3', '#b38cff'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgba(hex, a) {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}

function fillBase(g, spec, w, h) {
  const stops = spec.stops?.length ? spec.stops : ['#222222', '#111111'];
  let grad;
  if (spec.radial) {
    grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
  } else {
    const a = (((spec.angle ?? 135) - 90) * Math.PI) / 180;
    const len = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
    const dx = Math.cos(a) * len;
    const dy = Math.sin(a) * len;
    grad = g.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
  }
  stops.forEach((c, i) => grad.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), c));
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
}

function drawGlows(g, glows = [], w, h) {
  const m = Math.max(w, h);
  for (const gl of glows) {
    const r = (gl.r ?? 0.5) * m;
    const grad = g.createRadialGradient(gl.x * w, gl.y * h, 0, gl.x * w, gl.y * h, r);
    grad.addColorStop(0, rgba(gl.color, gl.alpha ?? 0.5));
    grad.addColorStop(1, rgba(gl.color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }
}

function drawPattern(g, p, w, h) {
  if (!p) return;
  const k = Math.max(w, h) / 1920;
  const gap = (p.gap || 40) * k;
  const color = p.color || '#ffffff';
  g.save();
  g.globalAlpha = p.alpha ?? 0.1;
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineWidth = Math.max(1, (p.size || 2) * k);
  switch (p.type) {
    case 'dots': {
      const r = Math.max(1, (p.size || 3) * k);
      for (let y = gap / 2; y < h; y += gap) {
        for (let x = gap / 2; x < w; x += gap) {
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
      }
      break;
    }
    case 'grid':
      g.beginPath();
      for (let x = (w / 2) % gap; x < w; x += gap) {
        g.moveTo(x, 0);
        g.lineTo(x, h);
      }
      for (let y = (h / 2) % gap; y < h; y += gap) {
        g.moveTo(0, y);
        g.lineTo(w, y);
      }
      g.stroke();
      break;
    case 'stripes':
      g.beginPath();
      for (let x = -h; x < w; x += gap) {
        g.moveTo(x, h);
        g.lineTo(x + h, 0);
      }
      g.stroke();
      break;
    case 'rings':
      for (let r = gap; r < Math.hypot(w, h) / 2; r += gap) {
        g.beginPath();
        g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
        g.stroke();
      }
      break;
    case 'waves': {
      const amp = gap * 0.25;
      for (let y = gap / 2; y < h + amp; y += gap) {
        g.beginPath();
        for (let x = 0; x <= w; x += 8 * k) {
          const yy = y + Math.sin((x / w) * Math.PI * 4 + y * 0.02) * amp;
          if (x === 0) g.moveTo(x, yy);
          else g.lineTo(x, yy);
        }
        g.stroke();
      }
      break;
    }
    case 'confetti': {
      const rnd = mulberry32(p.seed || 1);
      const n = p.count || 120;
      for (let i = 0; i < n; i++) {
        g.fillStyle = CONFETTI[Math.floor(rnd() * CONFETTI.length)];
        const x = rnd() * w;
        const y = rnd() * h;
        const s = (6 + rnd() * 16) * k;
        g.save();
        g.translate(x, y);
        g.rotate(rnd() * Math.PI);
        if (rnd() < 0.35) {
          g.beginPath();
          g.arc(0, 0, s * 0.45, 0, Math.PI * 2);
          g.fill();
        } else {
          g.fillRect(-s / 2, -s / 5, s, s / 2.5);
        }
        g.restore();
      }
      break;
    }
    default:
      break;
  }
  g.restore();
}

function drawVignette(g, amount, w, h) {
  if (!amount) return;
  const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(1, `rgba(0, 0, 0, ${amount})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
}

/** Original placeholder glyphs on a 100 unit box. */
function glyph(g, kind, x, y, size, color) {
  const u = size / 100;
  g.save();
  g.translate(x - size / 2, y - size / 2);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 6 * u;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (kind === 'video') {
    roundRect(g, 8 * u, 20 * u, 84 * u, 60 * u, 10 * u);
    g.stroke();
    g.beginPath();
    g.moveTo(42 * u, 38 * u);
    g.lineTo(62 * u, 50 * u);
    g.lineTo(42 * u, 62 * u);
    g.closePath();
    g.fill();
  } else if (kind === 'product') {
    // A gift-box like package.
    roundRect(g, 18 * u, 38 * u, 64 * u, 50 * u, 6 * u);
    g.stroke();
    roundRect(g, 12 * u, 26 * u, 76 * u, 14 * u, 4 * u);
    g.stroke();
    g.beginPath();
    g.moveTo(50 * u, 26 * u);
    g.lineTo(50 * u, 88 * u);
    g.moveTo(50 * u, 26 * u);
    g.bezierCurveTo(40 * u, 8 * u, 26 * u, 16 * u, 38 * u, 26 * u);
    g.moveTo(50 * u, 26 * u);
    g.bezierCurveTo(60 * u, 8 * u, 74 * u, 16 * u, 62 * u, 26 * u);
    g.stroke();
  } else {
    roundRect(g, 8 * u, 16 * u, 84 * u, 68 * u, 10 * u);
    g.stroke();
    g.beginPath();
    g.arc(68 * u, 36 * u, 7 * u, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(14 * u, 76 * u);
    g.lineTo(38 * u, 48 * u);
    g.lineTo(54 * u, 64 * u);
    g.lineTo(64 * u, 54 * u);
    g.lineTo(86 * u, 76 * u);
    g.stroke();
  }
  g.restore();
}

function drawSlot(g, spec, w, h) {
  const m = Math.min(w, h);
  const dark = isDark(spec.stops?.[0] || '#000000');
  const ink = dark ? 'rgba(255, 255, 255, 0.85)' : 'rgba(17, 24, 39, 0.75)';
  const soft = dark ? 'rgba(255, 255, 255, 0.55)' : 'rgba(17, 24, 39, 0.5)';
  // Dashed drop zone.
  const inset = m * 0.07;
  g.save();
  g.setLineDash?.([m * 0.025, m * 0.018]);
  g.lineWidth = Math.max(2, m * 0.006);
  g.strokeStyle = soft;
  roundRect(g, inset, inset, w - inset * 2, h - inset * 2, m * 0.04);
  g.stroke();
  g.restore();
  const gs = m * 0.2;
  glyph(g, spec.icon || 'image', w / 2, h / 2 - m * 0.08, gs, ink);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = ink;
  g.font = `700 ${Math.round(m * 0.07)}px Inter, system-ui, sans-serif`;
  g.fillText(spec.slot, w / 2, h / 2 + m * 0.1);
  g.fillStyle = soft;
  g.font = `400 ${Math.round(m * 0.036)}px Inter, system-ui, sans-serif`;
  g.fillText('Replace this clip with your own', w / 2, h / 2 + m * 0.17);
}

function isDark(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const l = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return l < 150;
}

/** Draw art spec onto a 2D context of size w x h. */
export function drawArt(g, spec, w, h) {
  g.save();
  g.clearRect(0, 0, w, h);
  if (spec.radius) {
    roundRect(g, 0, 0, w, h, spec.radius * Math.min(w, h));
    g.clip();
  }
  fillBase(g, spec, w, h);
  drawGlows(g, spec.glows, w, h);
  drawPattern(g, spec.pattern, w, h);
  drawVignette(g, spec.vignette, w, h);
  if (spec.frame) {
    const fw = (spec.frame.width || 8) * (Math.max(w, h) / 1920);
    g.strokeStyle = rgba(spec.frame.color || '#ffffff', spec.frame.alpha ?? 1);
    g.lineWidth = fw * 2;
    g.strokeRect(0, 0, w, h);
  }
  if (spec.slot) drawSlot(g, spec, w, h);
  g.restore();
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Image file for an art spec: { blob, ext, mime }, or null without a 2D canvas. */
export async function artFile(spec, w, h) {
  const canvas = makeCanvas(w, h);
  const g = canvas?.getContext('2d');
  if (!g) return null;
  drawArt(g, spec, w, h);
  const png = Boolean(spec.radius);
  const mime = png ? 'image/png' : 'image/jpeg';
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: mime, quality: 0.92 })
    : await new Promise((r) => canvas.toBlob(r, mime, 0.92));
  if (!blob) return null;
  return { blob, ext: png ? 'png' : 'jpg', mime };
}

/** WAV file for a sound effect id (mono, 44.1 kHz). */
export function sfxFile(id) {
  return { blob: encodeWav([renderSfx(id, 44100)], 44100), ext: 'wav', mime: 'audio/wav' };
}
