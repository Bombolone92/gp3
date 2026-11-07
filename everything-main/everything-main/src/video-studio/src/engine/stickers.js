/**
 * Stickers: original vector shapes plus outline icons from Lucide (ISC),
 * drawn with Canvas 2D at any resolution. More multi-color and animated
 * graphics live in stickers-extra.js.
 */
import { EXTRA_STICKERS, EXTRA_BY_ID, drawExtra } from './stickers-extra.js';
import {
  Heart, Star, ThumbsUp, Music, Camera, MapPin, Flame, Zap, Sun, Moon, Cloud, Gift, Crown, Check, X, Bell,
  Smile, PartyPopper, Sparkles, Rocket, Trophy, Coffee, Play, MousePointerClick, Hand, Eye, MessageCircle, Laugh,
} from 'lucide';

/** Stickers are laid out on a square of this many project pixels at scale 1. */
export const STICKER_SIZE = 360;

const ICONS = {
  'icon-heart': Heart, 'icon-star': Star, 'icon-thumbs-up': ThumbsUp, 'icon-music': Music, 'icon-camera': Camera,
  'icon-pin': MapPin, 'icon-flame': Flame, 'icon-zap': Zap, 'icon-sun': Sun, 'icon-moon': Moon, 'icon-cloud': Cloud,
  'icon-gift': Gift, 'icon-crown': Crown, 'icon-check': Check, 'icon-x': X, 'icon-bell': Bell, 'icon-smile': Smile,
  'icon-laugh': Laugh, 'icon-party': PartyPopper, 'icon-sparkles': Sparkles, 'icon-rocket': Rocket, 'icon-trophy': Trophy,
  'icon-coffee': Coffee, 'icon-play': Play, 'icon-click': MousePointerClick, 'icon-hand': Hand, 'icon-eye': Eye, 'icon-chat': MessageCircle,
};

export const STICKERS = [
  { id: 'star', label: 'Star', cat: 'shapes' },
  { id: 'heart', label: 'Heart', cat: 'shapes' },
  { id: 'circle', label: 'Circle', cat: 'shapes' },
  { id: 'ring', label: 'Ring', cat: 'shapes' },
  { id: 'square', label: 'Rounded square', cat: 'shapes' },
  { id: 'triangle', label: 'Triangle', cat: 'shapes' },
  { id: 'burst', label: 'Burst', cat: 'shapes' },
  { id: 'sparkle', label: 'Twinkle', cat: 'shapes' },
  { id: 'blob', label: 'Blob', cat: 'shapes' },
  { id: 'arrow-right', label: 'Arrow', cat: 'arrows' },
  { id: 'arrow-left', label: 'Arrow left', cat: 'arrows' },
  { id: 'arrow-up', label: 'Arrow up', cat: 'arrows' },
  { id: 'arrow-down', label: 'Arrow down', cat: 'arrows' },
  { id: 'arrow-curve', label: 'Curved arrow', cat: 'arrows' },
  { id: 'chevrons', label: 'Chevrons', cat: 'arrows' },
  { id: 'bubble', label: 'Speech bubble', cat: 'callouts' },
  { id: 'thought', label: 'Thought bubble', cat: 'callouts' },
  { id: 'banner', label: 'Ribbon', cat: 'callouts' },
  { id: 'tag', label: 'Tag', cat: 'callouts' },
  { id: 'subscribe', label: 'Button', cat: 'callouts' },
  { id: 'underline', label: 'Swoosh', cat: 'callouts' },
  ...Object.keys(ICONS).map((id) => ({ id, label: id.slice(5).replace('-', ' '), cat: 'icons' })),
  ...EXTRA_STICKERS.map(({ id, label, cat, multi, main, anim }) => ({ id, label, cat, ...(multi ? { multi, main } : {}), ...(anim ? { anim } : {}) })),
];

const BY_ID = new Map(STICKERS.map((s) => [s.id, s]));

/** Catalog entry for a sticker id (null when unknown). */
export function stickerInfo(id) {
  return BY_ID.get(id) || null;
}

/** True when the graphic moves over time (it is redrawn per frame). */
export function isAnimatedSticker(id) {
  return Boolean(BY_ID.get(id)?.anim);
}

/** True when the graphic has its own palette ("original colors" mode applies). */
export function isMultiColorSticker(id) {
  return Boolean(BY_ID.get(id)?.multi);
}

/** The color a graphic is drawn with for a clip: its palette's main color in "original" mode. */
export function stickerColor(id, color, colorMode) {
  const info = BY_ID.get(id);
  return info?.multi && colorMode === 'original' ? info.main : color;
}

function starPath(ctx, cx, cy, spikes, outer, inner, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (i * Math.PI) / spikes;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function arrowPath(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(s * 0.08, s * 0.4);
  ctx.lineTo(s * 0.58, s * 0.4);
  ctx.lineTo(s * 0.58, s * 0.2);
  ctx.lineTo(s * 0.94, s * 0.5);
  ctx.lineTo(s * 0.58, s * 0.8);
  ctx.lineTo(s * 0.58, s * 0.6);
  ctx.lineTo(s * 0.08, s * 0.6);
  ctx.closePath();
}

function lucide(ctx, node, color, s) {
  const k = s / 24;
  ctx.save();
  ctx.scale(k, k);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [tag, a] of node) {
    ctx.beginPath();
    if (tag === 'path') ctx.stroke(new Path2D(a.d));
    else if (tag === 'circle') {
      ctx.arc(+a.cx, +a.cy, +a.r, 0, Math.PI * 2);
      ctx.stroke();
    } else if (tag === 'ellipse') {
      ctx.ellipse(+a.cx, +a.cy, +a.rx, +a.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (tag === 'rect') {
      if (ctx.roundRect) ctx.roundRect(+a.x, +a.y, +a.width, +a.height, +(a.rx || 0));
      else ctx.rect(+a.x, +a.y, +a.width, +a.height);
      ctx.stroke();
    } else if (tag === 'line') {
      ctx.moveTo(+a.x1, +a.y1);
      ctx.lineTo(+a.x2, +a.y2);
      ctx.stroke();
    } else if (tag === 'polyline' || tag === 'polygon') {
      const pts = String(a.points).trim().split(/[\s,]+/).map(Number);
      for (let i = 0; i < pts.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, pts[i], pts[i + 1]);
      if (tag === 'polygon') ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Draw sticker id at size s (square) with the given main color. opts.t is
 * the clip-local time in seconds for animated graphics.
 */
export function drawSticker(ctx, id, color, s, { t = 0 } = {}) {
  ctx.clearRect(0, 0, s, s);
  const extra = EXTRA_BY_ID.get(id);
  if (extra) {
    drawExtra(ctx, extra, s, { color, t });
    return;
  }
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  const c = s / 2;
  const icon = ICONS[id];
  if (icon) {
    ctx.save();
    ctx.translate(s * 0.08, s * 0.08);
    lucide(ctx, icon, color, s * 0.84);
    ctx.restore();
    return;
  }
  switch (id) {
    case 'star': starPath(ctx, c, c * 1.05, 5, s * 0.46, s * 0.19); ctx.fill(); break;
    case 'sparkle': starPath(ctx, c, c, 4, s * 0.47, s * 0.09, 0); ctx.fill(); break;
    case 'burst': starPath(ctx, c, c, 14, s * 0.48, s * 0.36); ctx.fill(); break;
    case 'heart': {
      ctx.beginPath();
      ctx.moveTo(c, s * 0.86);
      ctx.bezierCurveTo(s * 0.02, s * 0.5, s * 0.12, s * 0.08, c, s * 0.28);
      ctx.bezierCurveTo(s * 0.88, s * 0.08, s * 0.98, s * 0.5, c, s * 0.86);
      ctx.fill();
      break;
    }
    case 'circle': ctx.beginPath(); ctx.arc(c, c, s * 0.45, 0, Math.PI * 2); ctx.fill(); break;
    case 'ring': ctx.beginPath(); ctx.lineWidth = s * 0.07; ctx.arc(c, c, s * 0.4, 0, Math.PI * 2); ctx.stroke(); break;
    case 'square': ctx.beginPath(); ctx.roundRect ? ctx.roundRect(s * 0.07, s * 0.07, s * 0.86, s * 0.86, s * 0.14) : ctx.rect(s * 0.07, s * 0.07, s * 0.86, s * 0.86); ctx.fill(); break;
    case 'triangle': ctx.beginPath(); ctx.moveTo(c, s * 0.08); ctx.lineTo(s * 0.95, s * 0.88); ctx.lineTo(s * 0.05, s * 0.88); ctx.closePath(); ctx.fill(); break;
    case 'blob': {
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const r = s * (0.38 + 0.06 * Math.sin(a * 3) + 0.03 * Math.cos(a * 5));
        const x = c + Math.cos(a) * r;
        const y = c + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.fill();
      break;
    }
    case 'arrow-right': arrowPath(ctx, s); ctx.fill(); break;
    case 'arrow-left': ctx.save(); ctx.translate(s, 0); ctx.scale(-1, 1); arrowPath(ctx, s); ctx.fill(); ctx.restore(); break;
    case 'arrow-up': ctx.save(); ctx.translate(0, s); ctx.rotate(-Math.PI / 2); arrowPath(ctx, s); ctx.fill(); ctx.restore(); break;
    case 'arrow-down': ctx.save(); ctx.translate(s, 0); ctx.rotate(Math.PI / 2); arrowPath(ctx, s); ctx.fill(); ctx.restore(); break;
    case 'arrow-curve': {
      ctx.lineWidth = s * 0.07;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s * 0.12, s * 0.78);
      ctx.quadraticCurveTo(s * 0.2, s * 0.22, s * 0.74, s * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.9, s * 0.32);
      ctx.lineTo(s * 0.64, s * 0.14);
      ctx.lineTo(s * 0.66, s * 0.48);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'chevrons': {
      ctx.lineWidth = s * 0.09;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const x of [0.18, 0.44, 0.7]) {
        ctx.beginPath();
        ctx.moveTo(s * x, s * 0.25);
        ctx.lineTo(s * (x + 0.16), s * 0.5);
        ctx.lineTo(s * x, s * 0.75);
        ctx.stroke();
      }
      break;
    }
    case 'bubble': {
      ctx.beginPath();
      ctx.ellipse(c, s * 0.42, s * 0.44, s * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s * 0.26, s * 0.62);
      ctx.lineTo(s * 0.16, s * 0.92);
      ctx.lineTo(s * 0.46, s * 0.7);
      ctx.fill();
      break;
    }
    case 'thought': {
      for (const [x, y, r] of [[0.5, 0.4, 0.3], [0.28, 0.46, 0.2], [0.72, 0.46, 0.2], [0.5, 0.56, 0.22], [0.18, 0.8, 0.06], [0.1, 0.92, 0.035]]) {
        ctx.beginPath();
        ctx.arc(s * x, s * y, s * r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'banner': {
      ctx.beginPath();
      ctx.moveTo(s * 0.02, s * 0.36);
      ctx.lineTo(s * 0.98, s * 0.36);
      ctx.lineTo(s * 0.9, s * 0.5);
      ctx.lineTo(s * 0.98, s * 0.64);
      ctx.lineTo(s * 0.02, s * 0.64);
      ctx.lineTo(s * 0.1, s * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'tag': {
      ctx.beginPath();
      ctx.moveTo(s * 0.06, s * 0.3);
      ctx.lineTo(s * 0.7, s * 0.3);
      ctx.lineTo(s * 0.94, s * 0.5);
      ctx.lineTo(s * 0.7, s * 0.7);
      ctx.lineTo(s * 0.06, s * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(s * 0.74, s * 0.5, s * 0.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'subscribe': {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(s * 0.04, s * 0.32, s * 0.92, s * 0.36, s * 0.08);
      else ctx.rect(s * 0.04, s * 0.32, s * 0.92, s * 0.36);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(s * 0.14, s * 0.42);
      ctx.lineTo(s * 0.26, s * 0.5);
      ctx.lineTo(s * 0.14, s * 0.58);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(s * 0.34, s * 0.46, s * 0.5, s * 0.08);
      break;
    }
    case 'underline': {
      ctx.lineWidth = s * 0.06;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s * 0.06, s * 0.58);
      ctx.bezierCurveTo(s * 0.3, s * 0.42, s * 0.6, s * 0.44, s * 0.94, s * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.2, s * 0.66);
      ctx.bezierCurveTo(s * 0.4, s * 0.56, s * 0.66, s * 0.56, s * 0.84, s * 0.6);
      ctx.stroke();
      break;
    }
    default: starPath(ctx, c, c, 5, s * 0.46, s * 0.19); ctx.fill();
  }
}
