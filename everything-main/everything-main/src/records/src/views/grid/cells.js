/**
 * Painting cell values on a canvas. One Painter per grid holds the theme
 * palette and text measurement caches; paintValue draws any field type
 * inside a cell box.
 */
import { chipColors, accentColor } from '../../lib/colors.js';
import { iconImage } from '../../lib/icons.js';
import { toText, valueKind, isEmpty } from '../../data/fields.js';
import { isNum } from '../../lib/format.js';

export const FONT_SIZE = 13;
const PAD = 8;
// Thumbnails kept in memory: more than a screen of attachment cells shows.
const THUMBS_KEPT = 1000;
const CHIP_H = 20;
// Text longer than a cell can show is cut to this many characters.
const FIT_MAX = 1000;
const WRAP_MAX = 2000;
// Text whose first letter is Hebrew or Arabic (or another right-to-left script).
const RTL = /^[^\p{L}]*[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u;
const LINE_H = 18;

function cssVar(style, name, fallback) {
  const v = style.getPropertyValue(name).trim();
  return v || fallback;
}

export function readPalette() {
  const s = getComputedStyle(document.documentElement);
  const font = cssVar(s, '--font', 'system-ui, sans-serif');
  return {
    font,
    bg: cssVar(s, '--bg', '#fff'),
    app: cssVar(s, '--bg-app', '#f7f7f9'),
    subtle: cssVar(s, '--bg-subtle', '#f4f4f6'),
    muted: cssVar(s, '--bg-muted', '#ececf0'),
    hover: cssVar(s, '--bg-hover', 'rgba(0,0,0,0.05)'),
    border: cssVar(s, '--border', '#e2e3e8'),
    borderStrong: cssVar(s, '--border-strong', '#cdd0d7'),
    line: cssVar(s, '--grid-line', '#e4e5ea'),
    header: cssVar(s, '--grid-header', '#f6f6f8'),
    gutter: cssVar(s, '--grid-gutter', '#fff'),
    text: cssVar(s, '--text', '#1d1f25'),
    text2: cssVar(s, '--text-2', '#565b67'),
    text3: cssVar(s, '--text-3', '#6f7480'),
    accent: cssVar(s, '--accent', '#4f4ee6'),
    accentText: cssVar(s, '--accent-text', '#4544d9'),
    accentSoft: cssVar(s, '--accent-soft', '#ececfd'),
    selection: cssVar(s, '--selection', 'rgba(79,78,230,0.1)'),
    danger: cssVar(s, '--danger', '#c42b2b'),
    tintFilter: cssVar(s, '--tint-filter', '#e3f4e6'),
    tintSort: cssVar(s, '--tint-sort', '#fdebd8'),
    tintGroup: cssVar(s, '--tint-group', '#ece4fb'),
    searchHit: cssVar(s, '--search-hit', '#fff1a8'),
    searchCurrent: cssVar(s, '--search-current', '#ffd84d'),
  };
}

export class Painter {
  constructor(ctx, palette, onAsset, readFile) {
    this.ctx = ctx;
    this.p = palette;
    this.onAsset = onAsset;
    this.readFile = readFile;
    this.widths = new Map();
    this.wraps = new Map();
    this.thumbs = new Map();
    this.fontKey = '';
  }

  setPalette(p) {
    this.p = p;
    this.widths.clear();
    this.wraps.clear();
  }

  font(size = FONT_SIZE, weight = 400) {
    const f = `${weight} ${size}px ${this.p.font}`;
    if (this.fontKey !== f) {
      this.ctx.font = f;
      this.fontKey = f;
    }
    return f;
  }

  /** Width of text in the current font, cached. */
  measure(text) {
    const key = `${this.fontKey}|${text}`;
    let w = this.widths.get(key);
    if (w === undefined) {
      w = this.ctx.measureText(text).width;
      if (this.widths.size > 20000) this.widths.clear();
      this.widths.set(key, w);
    }
    return w;
  }

  /** Text cut to fit maxW with an ellipsis. */
  fit(text, maxW) {
    if (maxW <= 0) return '';
    // Far more than a cell shows is cut first: never measured or cached whole.
    const long = text.length > FIT_MAX;
    if (long) text = text.slice(0, FIT_MAX);
    else if (this.measure(text) <= maxW) return text;
    const ell = '…';
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.measure(text.slice(0, mid) + ell) <= maxW) lo = mid;
      else hi = mid - 1;
    }
    // Never cut between the two halves of an emoji (a surrogate pair).
    const code = text.charCodeAt(lo - 1);
    if (code >= 0xd800 && code <= 0xdbff) lo--;
    return lo ? text.slice(0, lo).trimEnd() + ell : '';
  }

  text(str, x, y, maxW, color, align = 'left') {
    const ctx = this.ctx;
    const s = this.fit(str, maxW);
    if (!s) return 0;
    ctx.fillStyle = color;
    const w = this.measure(s);
    const tx = align === 'right' ? x + maxW - w : align === 'center' ? x + (maxW - w) / 2 : x;
    if (RTL.test(s)) {
      // Right-to-left text is laid out as such (its ellipsis on the left),
      // in the same box.
      const { direction, textAlign } = ctx;
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      ctx.fillText(s, tx + w, y);
      ctx.direction = direction;
      ctx.textAlign = textAlign;
    } else ctx.fillText(s, tx, y);
    return w;
  }

  /** Lines of wrapped text (at most maxLines; the last one ellipsized). */
  wrap(str, maxW, maxLines) {
    str = String(str);
    if (str.length > WRAP_MAX) str = `${str.slice(0, WRAP_MAX)}…`;
    const key = `${this.fontKey}|${maxW}|${maxLines}|${str}`;
    let lines = this.wraps.get(key);
    if (lines) return lines;
    lines = [];
    const paragraphs = str.split('\n');
    // Text was cut when words or lines with text are left over.
    const left = (words, wi, pi) => words.slice(wi).some((w) => w.trim()) || paragraphs.slice(pi + 1).some((p) => p.trim());
    let cut = false;
    outer: for (let pi = 0; pi < paragraphs.length; pi++) {
      const words = paragraphs[pi].split(/(\s+)/);
      let line = '';
      for (let wi = 0; wi < words.length; wi++) {
        const word = words[wi];
        const test = line + word;
        if (this.measure(test) <= maxW || !line) {
          line = test;
          // A single long word is cut by fit below.
        } else {
          lines.push(line.trimEnd());
          if (lines.length >= maxLines) {
            cut = left(words, wi, pi);
            break outer;
          }
          line = word.trimStart();
        }
      }
      lines.push(line);
      if (lines.length >= maxLines) {
        cut = left([], 0, pi);
        break;
      }
    }
    if (cut && lines.length) lines[lines.length - 1] = this.fit(`${lines[lines.length - 1]}…`, maxW);
    lines = lines.map((l) => this.fit(l, maxW));
    if (this.wraps.size > 4000) this.wraps.clear();
    this.wraps.set(key, lines);
    return lines;
  }

  roundRect(x, y, w, h, r, fill, stroke) {
    const ctx = this.ctx;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** A pill with a label. Returns its width (0 when it did not fit). */
  chip(label, x, y, maxW, bg, fg, { square = false, border = null } = {}) {
    this.font(12);
    const inner = Math.min(this.measure(label), Math.max(0, maxW - 16));
    const w = inner + 16;
    if (maxW < 28) return 0;
    this.roundRect(x, y, w, CHIP_H, square ? 4 : 10, bg, border);
    this.ctx.fillStyle = fg;
    this.ctx.fillText(this.fit(label, maxW - 16), x + 8, y + CHIP_H / 2 + 0.5);
    this.font();
    return w;
  }

  icon(name, x, y, size, color, opts) {
    const img = iconImage(name, color, size, this.onAsset, opts);
    if (img) this.ctx.drawImage(img, x, y, size, size);
  }

  /**
   * A thumbnail for an attachment (loads lazily). The most recently drawn
   * ones are kept; older bitmaps are closed to free their memory.
   */
  thumb(att) {
    const key = att.thumb || att.path;
    if (!key) return null;
    let entry = this.thumbs.get(key);
    if (entry) {
      // Most recently used last.
      this.thumbs.delete(key);
      this.thumbs.set(key, entry);
    } else {
      entry = { img: null, loading: true };
      this.thumbs.set(key, entry);
      if (this.thumbs.size > THUMBS_KEPT) this.dropThumb(this.thumbs.keys().next().value);
      const isImage = String(att.type || '').startsWith('image/');
      if (!att.thumb && !isImage) {
        entry.loading = false;
        return null;
      }
      Promise.resolve(this.readFile?.(key))
        .then((blob) => (blob ? createImageBitmap(blob) : null))
        .then((bmp) => {
          entry.loading = false;
          if (entry.dropped) {
            bmp?.close?.();
            return;
          }
          entry.img = bmp;
          this.onAsset?.();
        })
        .catch(() => {
          entry.loading = false;
        });
    }
    return entry.img;
  }

  dropThumb(key) {
    const entry = this.thumbs.get(key);
    if (!entry) return;
    entry.dropped = true;
    entry.img?.close?.();
    this.thumbs.delete(key);
  }

  destroy() {
    for (const key of [...this.thumbs.keys()]) this.dropThumb(key);
  }
}

function lines(h) {
  return Math.max(1, Math.floor((h - 10) / LINE_H));
}

/**
 * Draw a value in a cell box. opts: { active, field kind helpers, ctx (compute ctx), table, base, rowH, editing }
 */
export function paintValue(P, field, value, x, y, w, h, opts) {
  const ctx = P.ctx;
  const p = P.p;
  const cx = x + PAD;
  const cw = w - PAD * 2;
  const tall = h > 40;
  const midY = y + Math.min(h, 32) / 2 + 0.5;
  const topY = y + 16;
  const fctx = opts.compute;
  if (value && typeof value === 'object' && !Array.isArray(value) && value.error) {
    P.font();
    P.text(value.error, cx, midY, cw, p.danger);
    return;
  }
  switch (field.type) {
    case 'checkbox': {
      const size = 16;
      const bx = x + (w - size) / 2;
      const by = y + Math.min(h, 32) / 2 - size / 2;
      if (value) {
        P.roundRect(bx, by, size, size, 4, accentColor(field.options?.color || 'green'));
        P.icon('check', bx + 2, by + 2, 12, '#ffffff', { strokeWidth: 3 });
      } else if (opts.active) {
        P.roundRect(bx + 0.5, by + 0.5, size - 1, size - 1, 4, null, p.borderStrong);
      }
      return;
    }
    case 'rating': {
      const max = field.options?.max || 5;
      const size = 14;
      const color = accentColor(field.options?.color || 'yellow');
      const ic = field.options?.icon === 'heart' ? 'heart' : field.options?.icon === 'thumbsUp' ? 'thumbsUp' : field.options?.icon === 'flag' ? 'flag' : 'star';
      for (let i = 0; i < max; i++) {
        const sx = cx + i * (size + 3);
        if (sx + size > x + w - 4) break;
        const on = isNum(value) && i < value;
        if (on) P.icon(ic, sx, midY - size / 2, size, color, { fill: color });
        else if (opts.active || opts.hover) P.icon(ic, sx, midY - size / 2, size, p.borderStrong);
      }
      return;
    }
    case 'singleSelect':
    case 'multipleSelect': {
      const ids = Array.isArray(value) ? value : value ? [value] : [];
      if (!ids.length) return;
      const choices = field.options?.choices || [];
      paintChips(P, ids.map((id) => choices.find((c) => c.id === id)).filter(Boolean).map((c) => ({ label: c.name, colors: chipColors(c.color) })), cx, y, cw, h);
      return;
    }
    case 'link': {
      const ids = Array.isArray(value) ? value : [];
      if (!ids.length) return;
      const tid = field.options?.tableId;
      paintChips(P, ids.slice(0, 50).map((id) => ({ label: fctx.recordName(tid, id) || 'Unnamed record', colors: [p.subtle, p.text], square: true, border: p.border })), cx, y, cw, h);
      return;
    }
    case 'attachment': {
      const atts = Array.isArray(value) ? value : [];
      if (!atts.length) return;
      const size = Math.max(20, Math.min(h - 8, 120));
      let ax = cx;
      const ay = y + (tall ? 6 : (h - size) / 2);
      for (const a of atts) {
        if (ax + size > x + w - 4) break;
        const img = P.thumb(a);
        if (img) {
          const iw = img.width;
          const ih = img.height;
          const s = Math.min(size / ih, (size * 1.6) / iw);
          const dw = Math.max(size * 0.6, iw * s);
          ctx.save();
          P.roundRect(ax, ay, dw, size, 3, null, null);
          ctx.clip();
          ctx.drawImage(img, ax, ay, dw, size);
          ctx.restore();
          P.roundRect(ax + 0.5, ay + 0.5, dw - 1, size - 1, 3, null, p.border);
          ax += dw + 4;
        } else {
          P.roundRect(ax + 0.5, ay + 0.5, size * 0.8, size - 1, 3, p.subtle, p.border);
          const ext = (String(a.name).split('.').pop() || '').slice(0, 4).toUpperCase();
          P.font(size > 30 ? 10 : 8, 600);
          P.text(ext, ax, ay + size / 2, size * 0.8, p.text2, 'center');
          P.font();
          ax += size * 0.8 + 4;
        }
      }
      return;
    }
    case 'button': {
      const label = field.options?.label || 'Open';
      P.font(12, 500);
      const bw = Math.min(cw, P.measure(label) + 20);
      P.roundRect(cx, midY - 11, bw, 22, 5, p.subtle, p.borderStrong);
      P.text(label, cx, midY, bw, p.text, 'center');
      P.font();
      return;
    }
    case 'lookup': {
      const target = fctx.lookupTarget(field);
      if (!Array.isArray(value) || !value.length) return;
      if (target && (target.type === 'singleSelect' || target.type === 'multipleSelect')) {
        const choices = target.options.choices || [];
        const ids = value.flat();
        paintChips(P, ids.map((id) => choices.find((c) => c.id === id)).filter(Boolean).map((c) => ({ label: c.name, colors: chipColors(c.color) })), cx, y, cw, h);
        return;
      }
      if (target && target.type === 'attachment') {
        paintValue(P, target, value.flat(), x, y, w, h, opts);
        return;
      }
      if (target && target.type === 'link') {
        paintValue(P, target, value.flat(), x, y, w, h, opts);
        return;
      }
      if (target && target.type === 'checkbox') {
        P.font();
        P.text(value.map((v) => (v ? '✓' : '')).filter(Boolean).join(', '), cx, midY, cw, p.text);
        return;
      }
      break;
    }
    default:
      break;
  }
  // Text-like values.
  const text = toText(field, value, fctx);
  if (!text) return;
  P.font();
  const kind = valueKind(field, fctx);
  const right = kind === 'number' && field.type !== 'lookup';
  const color = field.type === 'url' || field.type === 'email' ? p.accentText : p.text;
  if (tall && !right) {
    const ls = P.wrap(text, cw, lines(h));
    for (let i = 0; i < ls.length; i++) P.text(ls[i], cx, topY + i * LINE_H, cw, color);
  } else {
    const firstLine = text.includes('\n') ? text.slice(0, text.indexOf('\n')) : text;
    P.text(firstLine, cx, tall ? topY : midY, cw, color, right ? 'right' : 'left');
  }
  if (field.type === 'url' || field.type === 'email') {
    const tw = Math.min(P.measure(P.fit(text.split('\n')[0], cw)), cw);
    ctx.fillStyle = color;
    ctx.fillRect(cx, (tall ? topY : midY) + 7, tw, 1);
  }
}

/** Chips that wrap onto more lines in taller rows. */
function paintChips(P, chips, x, y, w, h) {
  const maxLines = Math.max(1, Math.floor((h - 6) / (CHIP_H + 4)));
  let line = 0;
  let cx = x;
  let cy = y + (maxLines === 1 ? (Math.min(h, 32) - CHIP_H) / 2 : 6);
  for (const c of chips) {
    P.font(12);
    const need = Math.min(P.measure(c.label) + 16, w);
    if (cx > x && cx + need > x + w) {
      line++;
      if (line >= maxLines) break;
      cx = x;
      cy += CHIP_H + 4;
    }
    const used = P.chip(c.label, cx, cy, x + w - cx, c.colors[0], c.colors[1], { square: c.square, border: c.border });
    if (!used) break;
    cx += used + 4;
  }
  P.font();
}

export { isEmpty };
