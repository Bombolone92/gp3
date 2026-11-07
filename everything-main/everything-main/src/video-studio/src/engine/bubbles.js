/**
 * Bubbles: original vector shapes drawn behind a text clip (speech and
 * thought bubbles, labels, tags, ribbons, notes, frames). Each shape grows
 * with the text box: the text rectangle is padded into a body, and tails
 * or decorations may reach outside the body by a declared extent so the
 * renderer can reserve room for them.
 *
 * Outlined unions (a body plus a tail) are drawn by stroking every part at
 * twice the outline width and then filling every part on top, which hides
 * the seams between parts.
 */

export const BUBBLES = [
  { id: 'speech', label: 'Speech' },
  { id: 'speech-right', label: 'Speech right' },
  { id: 'speech-up', label: 'Speech up' },
  { id: 'speech-side', label: 'Speech side' },
  { id: 'chat-box', label: 'Chat box' },
  { id: 'speech-oval', label: 'Oval speech' },
  { id: 'thought', label: 'Thought' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'shout', label: 'Shout' },
  { id: 'seal', label: 'Seal' },
  { id: 'pill', label: 'Pill' },
  { id: 'chamfer', label: 'Cut corners' },
  { id: 'tag', label: 'Tag' },
  { id: 'arrow-sign', label: 'Arrow sign' },
  { id: 'ribbon', label: 'Ribbon' },
  { id: 'wave-flag', label: 'Flag' },
  { id: 'ticket', label: 'Ticket' },
  { id: 'sticky', label: 'Sticky note' },
  { id: 'torn', label: 'Torn strip' },
  { id: 'highlight', label: 'Highlighter' },
  { id: 'circle-badge', label: 'Circle' },
  { id: 'hexagon', label: 'Hexagon' },
  { id: 'double-frame', label: 'Frame' },
  { id: 'brackets', label: 'Corners' },
  { id: 'square-brackets', label: 'Brackets' },
];

const clampRadius = (r, w, h) => Math.max(0, Math.min(r, w / 2, h / 2));

function roundRectPath(ctx, x, y, w, hh, r) {
  r = clampRadius(r, w, hh);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + hh - r);
  ctx.quadraticCurveTo(x + w, y + hh, x + w - r, y + hh);
  ctx.lineTo(x + r, y + hh);
  ctx.quadraticCurveTo(x, y + hh, x, y + hh - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function poly(ctx, pts) {
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

/** Darker (k < 0) or lighter (k > 0) version of a hex color. */
export function shade(hex, k) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  const f = (c) => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k);
  const v = (f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255);
  return `#${v.toString(16).padStart(6, '0')}`;
}

/** Stroke all parts at double width, then fill them all (outlined union). */
function union(ctx, parts, o) {
  if (o.lw > 0) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = o.lw * 2;
    ctx.strokeStyle = o.stroke;
    for (const p of parts) {
      ctx.beginPath();
      p();
      ctx.stroke();
    }
  }
  ctx.fillStyle = o.fill;
  for (const p of parts) {
    ctx.beginPath();
    p();
    ctx.fill();
  }
}

/** A tail triangle: base points on the body edge, tip outside. */
const tail = (ctx, a, b, tip) => poly(ctx, [a, b, tip]);

/** Points around an ellipse with radii alternating between outer and inner. */
function spikes(cx, cy, rx, ry, n, inner, wobble = 0) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const k = i % 2 === 0 ? 1 + (wobble ? ((i * 7) % 5) / 5 * wobble : 0) : inner;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}

/** Bumps around an ellipse: circles centered on its outline. */
function bumps(cx, cy, rx, ry, n, r) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, r * (0.85 + 0.3 * (((i * 5) % 3) / 2))]);
  }
  return out;
}

/*
 * Shape definitions.
 *  pad:    [x, y] padding from the text to the body, in font sizes
 *  extent: (body, s) -> how far drawing reaches outside the body { l, t, r, b } in px
 *  draw:   (ctx, body, s, o) with o = { fill, stroke, lw }
 */
const DEFS = {
  speech: {
    pad: [0.55, 0.4],
    extent: (b, s) => ({ l: 0, t: 0, r: 0, b: s * 0.7 }),
    draw(ctx, b, s, o) {
      const r = Math.min(b.h / 2, s * 0.55);
      const x0 = b.x + Math.min(b.w * 0.2, s * 0.9);
      union(ctx, [
        () => roundRectPath(ctx, b.x, b.y, b.w, b.h, r),
        () => tail(ctx, [x0, b.y + b.h - 1], [x0 + s * 0.55, b.y + b.h - 1], [x0 - s * 0.25, b.y + b.h + s * 0.7]),
      ], o);
    },
  },
  'speech-right': {
    pad: [0.55, 0.4],
    extent: (b, s) => ({ l: 0, t: 0, r: 0, b: s * 0.7 }),
    draw(ctx, b, s, o) {
      const r = Math.min(b.h / 2, s * 0.55);
      const x1 = b.x + b.w - Math.min(b.w * 0.2, s * 0.9);
      union(ctx, [
        () => roundRectPath(ctx, b.x, b.y, b.w, b.h, r),
        () => tail(ctx, [x1 - s * 0.55, b.y + b.h - 1], [x1, b.y + b.h - 1], [x1 + s * 0.25, b.y + b.h + s * 0.7]),
      ], o);
    },
  },
  'speech-up': {
    pad: [0.55, 0.4],
    extent: (b, s) => ({ l: 0, t: s * 0.7, r: 0, b: 0 }),
    draw(ctx, b, s, o) {
      const r = Math.min(b.h / 2, s * 0.55);
      const cx = b.x + b.w * 0.35;
      union(ctx, [
        () => roundRectPath(ctx, b.x, b.y, b.w, b.h, r),
        () => tail(ctx, [cx - s * 0.3, b.y + 1], [cx + s * 0.3, b.y + 1], [cx - s * 0.1, b.y - s * 0.7]),
      ], o);
    },
  },
  'speech-side': {
    pad: [0.55, 0.4],
    extent: (b, s) => ({ l: s * 0.75, t: 0, r: 0, b: 0 }),
    draw(ctx, b, s, o) {
      const r = Math.min(b.h / 2, s * 0.5);
      const cy = b.y + b.h * 0.62;
      const half = Math.min(b.h * 0.2, s * 0.3);
      union(ctx, [
        () => roundRectPath(ctx, b.x, b.y, b.w, b.h, r),
        () => tail(ctx, [b.x + 1, cy - half], [b.x + 1, cy + half], [b.x - s * 0.75, cy + half * 1.4]),
      ], o);
    },
  },
  'chat-box': {
    pad: [0.5, 0.38],
    extent: (b, s) => ({ l: 0, t: 0, r: 0, b: s * 0.55 }),
    draw(ctx, b, s, o) {
      const cx = b.x + b.w / 2;
      union(ctx, [
        () => roundRectPath(ctx, b.x, b.y, b.w, b.h, s * 0.12),
        () => tail(ctx, [cx - s * 0.32, b.y + b.h - 1], [cx + s * 0.32, b.y + b.h - 1], [cx, b.y + b.h + s * 0.55]),
      ], o);
    },
  },
  'speech-oval': {
    pad: [0.75, 0.55],
    extent: (b, s) => ({ l: b.w * 0.08, t: b.h * 0.12, r: b.w * 0.08, b: b.h * 0.12 + s * 0.65 }),
    draw(ctx, b, s, o) {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const rx = b.w * 0.58;
      const ry = b.h * 0.62;
      const bx = cx - rx * 0.35;
      union(ctx, [
        () => ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2),
        () => {
          ctx.moveTo(bx - s * 0.25, cy + ry * 0.7);
          ctx.quadraticCurveTo(bx - s * 0.2, cy + ry + s * 0.3, bx - s * 0.6, cy + ry + s * 0.65);
          ctx.quadraticCurveTo(bx + s * 0.35, cy + ry + s * 0.4, bx + s * 0.4, cy + ry * 0.7);
          ctx.closePath();
        },
      ], o);
    },
  },
  thought: {
    pad: [0.75, 0.6],
    extent: (b, s) => ({ l: s * 0.42, t: s * 0.42, r: s * 0.42, b: s * 1.25 }),
    draw(ctx, b, s, o) {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const rx = b.w / 2;
      const ry = b.h / 2;
      const r = Math.min(s * 0.35, Math.min(rx, ry) * 0.7);
      const n = Math.max(8, Math.round((Math.PI * (rx + ry)) / (r * 1.5)));
      const parts = [() => ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)];
      for (const [x, y, rr] of bumps(cx, cy, rx, ry, n, r)) parts.push(() => ctx.arc(x, y, rr, 0, Math.PI * 2));
      union(ctx, parts, o);
      // Trailing dots toward the thinker.
      const tx = b.x + b.w * 0.2;
      union(ctx, [() => ctx.arc(tx, b.y + b.h + s * 0.6, s * 0.2, 0, Math.PI * 2)], o);
      union(ctx, [() => ctx.arc(tx - s * 0.3, b.y + b.h + s * 1.05, s * 0.12, 0, Math.PI * 2)], o);
    },
  },
  cloud: {
    pad: [0.7, 0.55],
    extent: (b, s) => ({ l: s * 0.52, t: s * 0.52, r: s * 0.52, b: s * 0.52 }),
    draw(ctx, b, s, o) {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const rx = b.w / 2;
      const ry = b.h / 2;
      const r = Math.min(s * 0.5, Math.min(rx, ry) * 0.9);
      const n = Math.max(7, Math.round((Math.PI * (rx + ry)) / (r * 1.7)));
      const parts = [() => roundRectPath(ctx, b.x, b.y, b.w, b.h, Math.min(b.h / 2, s * 0.6))];
      for (const [x, y, rr] of bumps(cx, cy, rx, ry, n, r)) parts.push(() => ctx.arc(x, y, Math.min(rr, s * 0.5), 0, Math.PI * 2));
      union(ctx, parts, o);
    },
  },
  shout: {
    pad: [0.6, 0.5],
    extent: (b) => ({ l: b.w * 0.4, t: b.h * 0.65, r: b.w * 0.4, b: b.h * 0.65 }),
    draw(ctx, b, s, o) {
      const pts = spikes(b.x + b.w / 2, b.y + b.h / 2, b.w * 0.82, b.h * 1.05, 14, 0.66, 0.1);
      union(ctx, [() => poly(ctx, pts)], o);
    },
  },
  seal: {
    pad: [0.4, 0.4],
    square: true,
    extent: (b) => ({ l: b.w * 0.12, t: b.h * 0.12, r: b.w * 0.12, b: b.h * 0.12 }),
    draw(ctx, b, s, o) {
      const r = b.w / 2;
      const pts = spikes(b.x + r, b.y + b.h / 2, r * 1.12, (b.h / 2) * 1.12, 22, 0.9);
      union(ctx, [() => poly(ctx, pts)], o);
      if (o.lw > 0) {
        ctx.beginPath();
        ctx.arc(b.x + r, b.y + b.h / 2, r * 0.86, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(1, o.lw * 0.6);
        ctx.strokeStyle = o.stroke;
        ctx.stroke();
      }
    },
  },
  pill: {
    pad: [0.65, 0.3],
    extent: () => ({ l: 0, t: 0, r: 0, b: 0 }),
    draw(ctx, b, s, o) {
      union(ctx, [() => roundRectPath(ctx, b.x, b.y, b.w, b.h, b.h / 2)], o);
    },
  },
  chamfer: {
    pad: [0.6, 0.35],
    extent: () => ({ l: 0, t: 0, r: 0, b: 0 }),
    draw(ctx, b, s, o) {
      const c = Math.min(s * 0.35, b.h / 3);
      union(ctx, [() => poly(ctx, [[b.x + c, b.y], [b.x + b.w - c, b.y], [b.x + b.w, b.y + c], [b.x + b.w, b.y + b.h - c], [b.x + b.w - c, b.y + b.h], [b.x + c, b.y + b.h], [b.x, b.y + b.h - c], [b.x, b.y + c]])], o);
    },
  },
  tag: {
    pad: [0.45, 0.35],
    extent: (b) => ({ l: b.h * 0.55, t: 0, r: 0, b: 0 }),
    draw(ctx, b, s, o) {
      const p = b.h * 0.55;
      const r = Math.min(s * 0.15, b.h * 0.15);
      union(ctx, [() => {
        ctx.moveTo(b.x - p, b.y + b.h / 2);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(b.x + b.w - r, b.y);
        ctx.quadraticCurveTo(b.x + b.w, b.y, b.x + b.w, b.y + r);
        ctx.lineTo(b.x + b.w, b.y + b.h - r);
        ctx.quadraticCurveTo(b.x + b.w, b.y + b.h, b.x + b.w - r, b.y + b.h);
        ctx.lineTo(b.x, b.y + b.h);
        ctx.closePath();
      }], o);
      // Punched hole.
      const hx = b.x - p * 0.35;
      const hy = b.y + b.h / 2;
      const hr = Math.min(s * 0.12, b.h * 0.12);
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (o.lw > 0) {
        ctx.beginPath();
        ctx.arc(hx, hy, hr, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(1, o.lw * 0.75);
        ctx.strokeStyle = o.stroke;
        ctx.stroke();
      }
    },
  },
  'arrow-sign': {
    pad: [0.5, 0.35],
    extent: (b) => ({ l: 0, t: 0, r: b.h * 0.5, b: 0 }),
    draw(ctx, b, s, o) {
      const p = b.h * 0.5;
      union(ctx, [() => poly(ctx, [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w + p, b.y + b.h / 2], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]])], o);
    },
  },
  ribbon: {
    pad: [0.7, 0.3],
    extent: (b, s) => ({ l: s * 0.9, t: 0, r: s * 0.9, b: s * 0.3 }),
    draw(ctx, b, s, o) {
      const d = s * 0.3;
      const e = s * 0.9;
      const back = shade(o.fill, -0.3);
      const fold = shade(o.fill, -0.5);
      // Tails behind the band, dropped a little, with a notch.
      const tails = [
        () => poly(ctx, [[b.x + s * 0.4, b.y + d], [b.x - e, b.y + d], [b.x - e + s * 0.35, b.y + d + b.h / 2], [b.x - e, b.y + d + b.h], [b.x + s * 0.4, b.y + d + b.h]]),
        () => poly(ctx, [[b.x + b.w - s * 0.4, b.y + d], [b.x + b.w + e, b.y + d], [b.x + b.w + e - s * 0.35, b.y + d + b.h / 2], [b.x + b.w + e, b.y + d + b.h], [b.x + b.w - s * 0.4, b.y + d + b.h]]),
      ];
      union(ctx, tails, { ...o, fill: back });
      union(ctx, [
        () => poly(ctx, [[b.x, b.y + b.h], [b.x + s * 0.4, b.y + b.h + d], [b.x + s * 0.4, b.y + b.h]]),
        () => poly(ctx, [[b.x + b.w, b.y + b.h], [b.x + b.w - s * 0.4, b.y + b.h + d], [b.x + b.w - s * 0.4, b.y + b.h]]),
      ], { ...o, fill: fold });
      union(ctx, [() => poly(ctx, [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]])], o);
    },
  },
  'wave-flag': {
    pad: [0.6, 0.45],
    extent: (b, s) => ({ l: 0, t: s * 0.18, r: 0, b: s * 0.18 }),
    draw(ctx, b, s, o) {
      const a = s * 0.16;
      const n = 24;
      union(ctx, [() => {
        for (let i = 0; i <= n; i++) {
          const x = b.x + (b.w * i) / n;
          const y = b.y + Math.sin((i / n) * Math.PI * 2) * a;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        for (let i = n; i >= 0; i--) {
          const x = b.x + (b.w * i) / n;
          ctx.lineTo(x, b.y + b.h + Math.sin((i / n) * Math.PI * 2) * a);
        }
        ctx.closePath();
      }], o);
    },
  },
  ticket: {
    pad: [0.85, 0.42],
    extent: () => ({ l: 0, t: 0, r: 0, b: 0 }),
    draw(ctx, b, s, o) {
      const n = Math.min(s * 0.28, b.h * 0.3);
      const r = Math.min(s * 0.12, b.h * 0.15);
      const cy = b.y + b.h / 2;
      union(ctx, [() => {
        ctx.moveTo(b.x + r, b.y);
        ctx.lineTo(b.x + b.w - r, b.y);
        ctx.quadraticCurveTo(b.x + b.w, b.y, b.x + b.w, b.y + r);
        ctx.lineTo(b.x + b.w, cy - n);
        ctx.arc(b.x + b.w, cy, n, -Math.PI / 2, Math.PI / 2, true);
        ctx.lineTo(b.x + b.w, b.y + b.h - r);
        ctx.quadraticCurveTo(b.x + b.w, b.y + b.h, b.x + b.w - r, b.y + b.h);
        ctx.lineTo(b.x + r, b.y + b.h);
        ctx.quadraticCurveTo(b.x, b.y + b.h, b.x, b.y + b.h - r);
        ctx.lineTo(b.x, cy + n);
        ctx.arc(b.x, cy, n, Math.PI / 2, -Math.PI / 2, true);
        ctx.lineTo(b.x, b.y + r);
        ctx.quadraticCurveTo(b.x, b.y, b.x + r, b.y);
        ctx.closePath();
      }], o);
      // Perforation.
      const px = b.x + Math.min(s * 0.55, b.w * 0.2);
      ctx.save();
      ctx.setLineDash?.([s * 0.08, s * 0.08]);
      ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.strokeStyle = o.lw > 0 ? o.stroke : shade(o.fill, -0.35);
      ctx.beginPath();
      ctx.moveTo(px, b.y + s * 0.1);
      ctx.lineTo(px, b.y + b.h - s * 0.1);
      ctx.stroke();
      ctx.restore();
    },
  },
  sticky: {
    pad: [0.6, 0.6],
    extent: (b, s) => ({ l: s * 0.2, t: s * 0.25, r: s * 0.2, b: s * 0.3 }),
    draw(ctx, b, s, o) {
      const f = Math.min(s * 0.6, b.w * 0.25, b.h * 0.35);
      const body = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h - f], [b.x + b.w - f, b.y + b.h], [b.x, b.y + b.h]];
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
      ctx.shadowBlur = s * 0.18;
      ctx.shadowOffsetY = s * 0.08;
      union(ctx, [() => poly(ctx, body)], o);
      ctx.restore();
      union(ctx, [() => poly(ctx, [[b.x + b.w, b.y + b.h - f], [b.x + b.w - f, b.y + b.h], [b.x + b.w - f * 0.85, b.y + b.h - f * 0.85]])], { ...o, fill: shade(o.fill, -0.18) });
      // A strip of tape.
      ctx.save();
      ctx.translate(b.x + b.w / 2, b.y);
      ctx.rotate(-0.06);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      const tw = Math.min(s * 1.6, b.w * 0.5);
      ctx.fillRect(-tw / 2, -s * 0.2, tw, s * 0.4);
      ctx.restore();
    },
  },
  torn: {
    pad: [0.6, 0.35],
    extent: (b, s) => ({ l: s * 0.06, t: s * 0.14, r: s * 0.06, b: s * 0.14 }),
    draw(ctx, b, s, o) {
      const step = s * 0.22;
      const n = Math.max(4, Math.round(b.w / step));
      const amp = s * 0.12;
      const jag = (i, k) => ((i * 7 + k * 3) % 5) / 4;
      union(ctx, [() => {
        ctx.moveTo(b.x, b.y);
        for (let i = 1; i <= n; i++) ctx.lineTo(b.x + (b.w * i) / n, b.y + (i % 2 ? -amp : amp * 0.4) * jag(i, 1));
        ctx.lineTo(b.x + b.w + s * 0.05, b.y + b.h / 2);
        for (let i = n; i >= 0; i--) ctx.lineTo(b.x + (b.w * i) / n, b.y + b.h + (i % 2 ? amp : -amp * 0.4) * jag(i, 2));
        ctx.lineTo(b.x - s * 0.05, b.y + b.h / 2);
        ctx.closePath();
      }], o);
    },
  },
  highlight: {
    pad: [0.3, 0.12],
    extent: (b, s) => ({ l: s * 0.15, t: s * 0.12, r: s * 0.15, b: s * 0.12 }),
    draw(ctx, b, s, o) {
      const k = s * 0.12;
      union(ctx, [() => {
        ctx.moveTo(b.x + k, b.y + k * 0.6);
        ctx.quadraticCurveTo(b.x + b.w / 2, b.y - k, b.x + b.w + k, b.y + k * 0.2);
        ctx.quadraticCurveTo(b.x + b.w - k * 0.4, b.y + b.h / 2, b.x + b.w + k * 0.6, b.y + b.h - k * 0.4);
        ctx.quadraticCurveTo(b.x + b.w / 2, b.y + b.h + k, b.x - k, b.y + b.h - k * 0.1);
        ctx.quadraticCurveTo(b.x + k * 0.5, b.y + b.h / 2, b.x + k, b.y + k * 0.6);
        ctx.closePath();
      }], { ...o, lw: 0 });
    },
  },
  'circle-badge': {
    pad: [0.35, 0.35],
    square: true,
    extent: () => ({ l: 0, t: 0, r: 0, b: 0 }),
    draw(ctx, b, s, o) {
      union(ctx, [() => ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, 0, Math.PI * 2)], o);
    },
  },
  hexagon: {
    pad: [0.4, 0.45],
    extent: (b) => ({ l: b.h * 0.42, t: 0, r: b.h * 0.42, b: 0 }),
    draw(ctx, b, s, o) {
      const d = b.h * 0.42;
      union(ctx, [() => poly(ctx, [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w + d, b.y + b.h / 2], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h], [b.x - d, b.y + b.h / 2]])], o);
    },
  },
  'double-frame': {
    pad: [0.65, 0.45],
    extent: () => ({ l: 0, t: 0, r: 0, b: 0 }),
    draw(ctx, b, s, o) {
      union(ctx, [() => roundRectPath(ctx, b.x, b.y, b.w, b.h, s * 0.08)], o);
      const i = Math.min(s * 0.16, b.h * 0.15);
      ctx.beginPath();
      roundRectPath(ctx, b.x + i, b.y + i, b.w - i * 2, b.h - i * 2, s * 0.04);
      ctx.lineWidth = Math.max(1, s * 0.035);
      ctx.strokeStyle = o.lw > 0 ? o.stroke : shade(o.fill, -0.4);
      ctx.stroke();
    },
  },
  brackets: {
    pad: [0.5, 0.35],
    lines: true,
    extent: () => ({ l: 0, t: 0, r: 0, b: 0 }),
    draw(ctx, b, s, o) {
      const L = Math.min(s * 0.6, b.w / 3, b.h / 2);
      ctx.lineWidth = o.lw > 0 ? o.lw : Math.max(1, s * 0.07);
      ctx.strokeStyle = o.lw > 0 ? o.stroke : o.fill;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const [x, y, dx, dy] of [[b.x, b.y, 1, 1], [b.x + b.w, b.y, -1, 1], [b.x, b.y + b.h, 1, -1], [b.x + b.w, b.y + b.h, -1, -1]]) {
        ctx.moveTo(x, y + dy * L);
        ctx.lineTo(x, y);
        ctx.lineTo(x + dx * L, y);
      }
      ctx.stroke();
    },
  },
  'square-brackets': {
    pad: [0.45, 0.25],
    lines: true,
    extent: () => ({ l: 0, t: 0, r: 0, b: 0 }),
    draw(ctx, b, s, o) {
      const L = Math.min(s * 0.3, b.w / 4);
      ctx.lineWidth = o.lw > 0 ? o.lw : Math.max(1, s * 0.07);
      ctx.strokeStyle = o.lw > 0 ? o.stroke : o.fill;
      ctx.lineCap = 'square';
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      ctx.moveTo(b.x + L, b.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x, b.y + b.h);
      ctx.lineTo(b.x + L, b.y + b.h);
      ctx.moveTo(b.x + b.w - L, b.y);
      ctx.lineTo(b.x + b.w, b.y);
      ctx.lineTo(b.x + b.w, b.y + b.h);
      ctx.lineTo(b.x + b.w - L, b.y + b.h);
      ctx.stroke();
    },
  },
};

export const hasBubble = (id) => Boolean(id) && Object.hasOwn(DEFS, id);

/**
 * Geometry for a bubble around a text rectangle of size w x h (px) at font
 * size s: the body rectangle relative to the text rectangle's top-left, and
 * how far the drawing reaches beyond the text rectangle on each side
 * (outline included).
 */
export function bubbleGeometry(id, w, h, s, lw = 0) {
  const def = DEFS[id];
  if (!def) return null;
  let px = def.pad[0] * s;
  let py = def.pad[1] * s;
  if (def.square) {
    // Round shapes: a square body whose inscribed circle holds the text box.
    const d = Math.hypot(w + px, h + py);
    px = (d - w) / 2;
    py = (d - h) / 2;
  }
  const body = { x: -px, y: -py, w: w + px * 2, h: h + py * 2 };
  const e = def.extent(body, s);
  const o = def.lines ? lw / 2 + s * 0.04 : lw;
  return {
    body,
    reach: { l: px + e.l + o, t: py + e.t + o, r: px + e.r + o, b: py + e.b + o },
  };
}

/** Draw a bubble behind a text rectangle { x, y, w, h } (px). */
export function drawBubble(ctx, id, rect, { size, fill = '#ffffff', stroke = '#111111', lineWidth = 0 } = {}) {
  const def = DEFS[id];
  if (!def) return;
  const g = bubbleGeometry(id, rect.w, rect.h, size, lineWidth);
  const body = { x: rect.x + g.body.x, y: rect.y + g.body.y, w: g.body.w, h: g.body.h };
  ctx.save();
  def.draw(ctx, body, size, { fill, stroke, lw: lineWidth });
  ctx.restore();
}
