// A Batch that writes SVG instead of GPU buffers. The scene builders draw
// into it exactly as they draw to the canvas, so printed and exported
// documents match the screen. Units: millimetres, +y down (SVG).

import { Batch } from './batch.js';

const MM = 1 / 1e6;

function rgba(u) {
  const r = u & 255, g = (u >>> 8) & 255, b = (u >>> 16) & 255, a = ((u >>> 24) & 255) / 255;
  return { color: `rgb(${r},${g},${b})`, alpha: a };
}

const n = (v) => (Math.round(v * 1e4) / 1e4).toString();

export class SvgBatch extends Batch {
  constructor({ height, minStroke = 0.12 }) {
    super();
    this.out = [];
    this.H = height * MM;
    this.minStroke = minStroke;
  }

  clear() { this.out = []; this._run = null; }
  touch() {}
  get empty() { return !this.out.length; }

  _x(x) { return n(x * MM); }
  _y(y) { return n(this.H - y * MM); }
  _paint(u, kind) {
    const { color, alpha } = rgba(u);
    return `${kind}="${color}"${alpha < 0.999 ? ` ${kind}-opacity="${n(alpha)}"` : ''}`;
  }
  _w(w) { return n(Math.max(w * MM, this.minStroke)); }

  /**
   * Consecutive lines of one style are merged into a single path, which keeps
   * text-heavy sheets small. Any other primitive flushes the run first so
   * drawing order is preserved.
   */
  line(x1, y1, x2, y2, w, color) {
    const style = `${this._paint(color, 'stroke')} stroke-width="${this._w(w)}"`;
    if (this._run?.style !== style) { this._flush(); this._run = { style, d: [] }; }
    this._run.d.push(`M${this._x(x1)} ${this._y(y1)}L${this._x(x2)} ${this._y(y2)}`);
  }

  _flush() {
    if (!this._run) return;
    this.out.push(`<path d="${this._run.d.join('')}" fill="none" ${this._run.style} stroke-linecap="round" stroke-linejoin="round"/>`);
    this._run = null;
  }

  polyline(pts, w, color, closed = false) {
    this._flush();
    if (pts.length < 4) return;
    let d = '';
    for (let i = 0; i < pts.length; i += 2) d += `${i ? ' ' : ''}${this._x(pts[i])},${this._y(pts[i + 1])}`;
    this.out.push(`<${closed ? 'polygon' : 'polyline'} points="${d}" fill="none" ${this._paint(color, 'stroke')} stroke-width="${this._w(w)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }

  circle(x, y, r, color, inner = 0) {
    this._flush();
    if (inner > 0) {
      // A ring is a stroked circle at the mid radius.
      this.out.push(`<circle cx="${this._x(x)}" cy="${this._y(y)}" r="${n(((r + inner) / 2) * MM)}" fill="none" ${this._paint(color, 'stroke')} stroke-width="${n((r - inner) * MM)}"/>`);
    } else this.out.push(`<circle cx="${this._x(x)}" cy="${this._y(y)}" r="${n(r * MM)}" ${this._paint(color, 'fill')}/>`);
  }

  ring(x, y, r, w, color) {
    this._flush();
    this.out.push(`<circle cx="${this._x(x)}" cy="${this._y(y)}" r="${n(r * MM)}" fill="none" ${this._paint(color, 'stroke')} stroke-width="${this._w(w)}"/>`);
  }

  rect(cx, cy, w, h, rot, radius, color) {
    this._flush();
    const rx = radius ? ` rx="${n(radius * MM)}"` : '';
    const t = rot ? ` transform="rotate(${n(-rot)} ${this._x(cx)} ${this._y(cy)})"` : '';
    this.out.push(`<rect x="${n((cx - w / 2) * MM)}" y="${this._y(cy + h / 2)}" width="${n(w * MM)}" height="${n(h * MM)}"${rx}${t} ${this._paint(color, 'fill')}/>`);
  }

  arc(cx, cy, r, a0, sweep, w, color) {
    this._flush();
    if (sweep >= 360) { this.ring(cx, cy, r, w, color); return; }
    const p = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a0 + sweep);
    // Counter-clockwise in +y up is clockwise on screen: sweep flag 0.
    this.out.push(`<path d="M${this._x(x0)} ${this._y(y0)} A${n(r * MM)} ${n(r * MM)} 0 ${sweep > 180 ? 1 : 0} 0 ${this._x(x1)} ${this._y(y1)}" fill="none" ${this._paint(color, 'stroke')} stroke-width="${this._w(w)}" stroke-linecap="round"/>`);
  }

  poly(rings, color) {
    this._flush();
    let d = '';
    for (const ring of rings) {
      if (ring.length < 6) continue;
      d += `M${this._x(ring[0])} ${this._y(ring[1])}`;
      for (let i = 2; i < ring.length; i += 2) d += `L${this._x(ring[i])} ${this._y(ring[i + 1])}`;
      d += 'Z';
    }
    if (d) this.out.push(`<path d="${d}" fill-rule="evenodd" ${this._paint(color, 'fill')}/>`);
  }

  triangles() {}

  /** Wraps the content in an SVG document of the given size in nm. */
  toSvg(widthNm, heightNm, background) {
    this._flush();
    const w = n(widthNm * MM), h = n(heightNm * MM);
    const bg = background ? `<rect width="${w}" height="${h}" fill="${background}"/>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${bg}${this.out.join('')}</svg>`;
  }
}
