/**
 * Backdrops: original solid colors, gradients and patterns drawn in code
 * with Canvas 2D at any size. Patterns scale with the canvas height so the
 * small tile preview and the full-size image look the same; random parts
 * are seeded so every render matches.
 */

export const BACKDROP_GROUPS = [
  { id: 'solid', label: 'Solid colors' },
  { id: 'gradient', label: 'Gradients' },
  { id: 'pattern', label: 'Patterns' },
];

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

function linear(g, w, hh, stops, angle = 45) {
  const a = (angle * Math.PI) / 180;
  const cx = w / 2;
  const cy = hh / 2;
  const r = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * hh) / 2;
  const grad = g.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  stops.forEach((s, i) => grad.addColorStop(i / (stops.length - 1), s));
  g.fillStyle = grad;
  g.fillRect(0, 0, w, hh);
}

function glow(g, x, y, r, color, alpha = 1) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, color);
  // Fade to the same color at zero alpha so the edge does not darken.
  const n = parseInt(color.slice(1), 16);
  grad.addColorStop(1, `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0)`);
  g.globalAlpha = alpha;
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.globalAlpha = 1;
}

const solid = (id, label, fill) => ({ id, label, group: 'solid', draw: (g, w, hh) => { g.fillStyle = fill; g.fillRect(0, 0, w, hh); } });
const gradient = (id, label, stops, angle = 35) => ({ id, label, group: 'gradient', draw: (g, w, hh) => linear(g, w, hh, stops, angle) });

export const BACKDROPS = [
  solid('black', 'Black', '#000000'),
  solid('white', 'White', '#ffffff'),
  solid('charcoal', 'Charcoal', '#26262b'),
  solid('sky', 'Sky', '#3b82f6'),
  solid('mint', 'Mint', '#2bc48a'),
  solid('sun', 'Sun', '#f5b83d'),
  solid('coral', 'Coral', '#f2645a'),
  solid('grape', 'Grape', '#7c4dff'),
  gradient('dusk', 'Dusk', ['#1e1b4b', '#7c3aed', '#f472b6']),
  gradient('ocean', 'Ocean', ['#0c4a6e', '#0ea5e9', '#a5f3fc']),
  gradient('peach', 'Peach', ['#fb7185', '#fdba74', '#fef3c7']),
  gradient('forest', 'Forest', ['#052e16', '#15803d', '#bef264']),
  gradient('slate', 'Slate', ['#0f172a', '#334155', '#64748b'], 90),
  {
    id: 'spotlight', label: 'Spotlight', group: 'gradient',
    draw(g, w, hh) {
      g.fillStyle = '#16161a';
      g.fillRect(0, 0, w, hh);
      glow(g, w / 2, hh * 0.42, Math.max(w, hh) * 0.6, '#5a5a66', 0.9);
    },
  },
  {
    id: 'aurora', label: 'Aurora', group: 'gradient',
    draw(g, w, hh) {
      linear(g, w, hh, ['#04121f', '#0b2a3a'], 90);
      const r = Math.max(w, hh);
      glow(g, w * 0.2, hh * 0.3, r * 0.5, '#22d3a6', 0.55);
      glow(g, w * 0.6, hh * 0.15, r * 0.45, '#6366f1', 0.5);
      glow(g, w * 0.85, hh * 0.65, r * 0.4, '#a855f7', 0.4);
    },
  },
  {
    id: 'candy', label: 'Candy mesh', group: 'gradient',
    draw(g, w, hh) {
      g.fillStyle = '#fbcfe8';
      g.fillRect(0, 0, w, hh);
      const r = Math.max(w, hh) * 0.6;
      glow(g, 0, 0, r, '#f9a8d4', 0.9);
      glow(g, w, 0, r, '#93c5fd', 0.9);
      glow(g, w, hh, r, '#c4b5fd', 0.9);
      glow(g, 0, hh, r, '#fde68a', 0.9);
    },
  },
  {
    id: 'sunrise', label: 'Sunrise', group: 'gradient',
    draw(g, w, hh) {
      linear(g, w, hh, ['#1e3a8a', '#db2777', '#fb923c', '#fde68a'], 90);
      glow(g, w / 2, hh * 0.95, hh * 0.55, '#fff7cc', 0.8);
    },
  },
  {
    id: 'stripes', label: 'Stripes', group: 'pattern',
    draw(g, w, hh) {
      g.fillStyle = '#1d4ed8';
      g.fillRect(0, 0, w, hh);
      g.save();
      g.fillStyle = '#2563eb';
      const step = hh / 6;
      g.translate(w / 2, hh / 2);
      g.rotate(-Math.PI / 4);
      const span = w + hh;
      for (let x = -span; x < span; x += step * 2) g.fillRect(x, -span, step, span * 2);
      g.restore();
    },
  },
  {
    id: 'dots', label: 'Polka dots', group: 'pattern',
    draw(g, w, hh) {
      g.fillStyle = '#fef3c7';
      g.fillRect(0, 0, w, hh);
      g.fillStyle = '#f59e0b';
      const step = hh / 7;
      const r = step * 0.18;
      for (let y = 0, row = 0; y < hh + step; y += step, row++) {
        for (let x = row % 2 ? step / 2 : 0; x < w + step; x += step) {
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
      }
    },
  },
  {
    id: 'blueprint', label: 'Blueprint', group: 'pattern',
    draw(g, w, hh) {
      g.fillStyle = '#0b3a75';
      g.fillRect(0, 0, w, hh);
      const step = hh / 24;
      for (let i = 0, x = 0; x <= w; x += step, i++) {
        g.fillStyle = i % 4 === 0 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.1)';
        g.fillRect(Math.round(x), 0, Math.max(1, hh / 900), hh);
      }
      for (let i = 0, y = 0; y <= hh; y += step, i++) {
        g.fillStyle = i % 4 === 0 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.1)';
        g.fillRect(0, Math.round(y), w, Math.max(1, hh / 900));
      }
    },
  },
  {
    id: 'paper-grid', label: 'Graph paper', group: 'pattern',
    draw(g, w, hh) {
      g.fillStyle = '#fafaf7';
      g.fillRect(0, 0, w, hh);
      const step = hh / 18;
      g.fillStyle = 'rgba(56, 120, 200, 0.22)';
      for (let x = 0; x <= w; x += step) g.fillRect(Math.round(x), 0, Math.max(1, hh / 1000), hh);
      for (let y = 0; y <= hh; y += step) g.fillRect(0, Math.round(y), w, Math.max(1, hh / 1000));
    },
  },
  {
    id: 'grain', label: 'Film grain', group: 'pattern',
    draw(g, w, hh) {
      linear(g, w, hh, ['#2b2b30', '#1a1a1e'], 90);
      const rnd = rng(7);
      // Specks sized to the canvas, so the grain reads the same at any size.
      const n = Math.round((w * hh) / 60);
      const px = Math.max(1, hh / 540);
      for (let i = 0; i < n; i++) {
        const v = rnd();
        g.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.18})` : `rgba(0,0,0,${(0.5 - v) * 0.3})`;
        g.fillRect(rnd() * w, rnd() * hh, px, px);
      }
    },
  },
  {
    id: 'bokeh', label: 'Bokeh', group: 'pattern',
    draw(g, w, hh) {
      linear(g, w, hh, ['#1a1033', '#3b1d4f', '#7a2e4f'], 60);
      const rnd = rng(21);
      const colors = ['#ffd27a', '#ff9fb2', '#9ad0ff', '#fff3d6'];
      for (let i = 0; i < 26; i++) {
        const r = hh * (0.04 + rnd() * 0.12);
        const x = rnd() * w;
        const y = rnd() * hh;
        g.globalAlpha = 0.12 + rnd() * 0.3;
        g.fillStyle = colors[i % colors.length];
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    },
  },
  {
    id: 'waves', label: 'Waves', group: 'pattern',
    draw(g, w, hh) {
      g.fillStyle = '#e0f2fe';
      g.fillRect(0, 0, w, hh);
      const colors = ['#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0369a1'];
      colors.forEach((c, i) => {
        const base = hh * (0.35 + i * 0.14);
        g.fillStyle = c;
        g.beginPath();
        g.moveTo(0, hh);
        for (let x = 0; x <= w; x += Math.max(2, w / 120)) g.lineTo(x, base + Math.sin((x / w) * Math.PI * 2 * 1.5 + i) * hh * 0.04);
        g.lineTo(w, hh);
        g.closePath();
        g.fill();
      });
    },
  },
  {
    id: 'checker', label: 'Soft checks', group: 'pattern',
    draw(g, w, hh) {
      g.fillStyle = '#f3e8ff';
      g.fillRect(0, 0, w, hh);
      g.fillStyle = '#e9d5ff';
      const step = hh / 8;
      for (let y = 0, r = 0; y < hh; y += step, r++) {
        for (let x = r % 2 ? step : 0; x < w; x += step * 2) g.fillRect(x, y, step, step);
      }
    },
  },
  {
    id: 'halftone', label: 'Halftone', group: 'pattern',
    draw(g, w, hh) {
      g.fillStyle = '#111827';
      g.fillRect(0, 0, w, hh);
      g.fillStyle = '#f43f5e';
      const step = hh / 20;
      for (let y = step / 2; y < hh + step; y += step) {
        for (let x = step / 2; x < w + step; x += step) {
          const k = Math.min(1, Math.hypot(x - w, y - hh) / Math.hypot(w, hh));
          const r = step * 0.48 * (1 - k);
          if (r < 0.3) continue;
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
      }
    },
  },
  {
    id: 'confetti', label: 'Confetti', group: 'pattern',
    draw(g, w, hh) {
      g.fillStyle = '#fffaf0';
      g.fillRect(0, 0, w, hh);
      const rnd = rng(42);
      const colors = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#a855f7'];
      const n = Math.round((w / hh) * 70);
      for (let i = 0; i < n; i++) {
        g.save();
        g.translate(rnd() * w, rnd() * hh);
        g.rotate(rnd() * Math.PI);
        g.fillStyle = colors[i % colors.length];
        const s = hh * (0.012 + rnd() * 0.02);
        g.fillRect(-s, -s / 3, s * 2, (s * 2) / 3);
        g.restore();
      }
    },
  },
];

export const BACKDROPS_BY_ID = new Map(BACKDROPS.map((b) => [b.id, b]));

/** Draw backdrop b (or its id) filling a w x h canvas. */
export function drawBackdrop(g, b, w, hh) {
  const def = typeof b === 'string' ? BACKDROPS_BY_ID.get(b) : b;
  if (!def) throw new Error(`Unknown backdrop ${b}`);
  g.save();
  def.draw(g, w, hh);
  g.restore();
}
