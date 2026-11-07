import {
  Braces,
  BrickWall,
  Container,
  Image,
  Network,
  Search,
  Server,
} from "lucide";
import { drawIconNode } from "./svg-path.js";
import {
  SHAPE_SPECS,
  SHAPE_COLORS,
  shapeBorder,
  shapeOutline,
} from "./shape-specs.js";
import { shapePath, shapeDetail, shapeIcon } from "./shapes.js";
const GLYPHS = {
  braces: Braces,
  "brick-wall": BrickWall,
  container: Container,
  image: Image,
  network: Network,
  search: Search,
  server: Server,
};
function trace(ctx, polygons) {
  ctx.beginPath();
  for (const points of polygons) {
    points.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }
}
// Fills with the current fill style, outlines, then draws details clipped to
// the silhouette. Stacked outlines paint back to front. A border set
// thicker, dashed or dotted is drawn inside the usual outline, and the front
// outline goes over the details, which would cover a thick one's inner half.
export function drawShape(ctx, key, w, h, i = {}, preview = false) {
  const spec = SHAPE_SPECS[key],
    outline = preview ? 2.5 : 1,
    border = preview || spec?.bare ? null : shapeBorder(i, w, h);
  if (border) {
    ctx.save();
    ctx.translate(border.inset, border.inset);
    w -= border.inset * 2;
    h -= border.inset * 2;
  }
  const edge = () => {
    ctx.strokeStyle = SHAPE_COLORS.LINE;
    ctx.lineWidth = border?.width ?? outline;
    if (border) ctx.setLineDash(border.dash);
    ctx.stroke();
  };
  if (!spec) {
    shapePath(ctx, key, w, h);
    if (!preview) ctx.fill();
    edge();
    shapeDetail(ctx, key, w, h);
    if (border) ctx.restore();
    return;
  }
  const polygons = shapeOutline(key, w, h),
    front = border ? polygons.length - 1 : polygons.length;
  polygons.forEach((points, n) => {
    trace(ctx, [points]);
    if (!preview) ctx.fill();
    if (!spec.bare && n < front) edge();
  });
  if (border) {
    // The details draw as they do over the usual border.
    ctx.strokeStyle = SHAPE_COLORS.LINE;
    ctx.lineWidth = outline;
    ctx.setLineDash([]);
  }
  if (spec.detail) {
    ctx.save();
    trace(ctx, polygons);
    ctx.clip();
    spec.detail(ctx, w, h, {
      item: i,
      trace: () => trace(ctx, polygons),
      glyph: (name, x, y, size, color = SHAPE_COLORS.INK) =>
        drawIconNode(ctx, GLYPHS[name], { x, y, size, color, lineWidth: 1.8 }),
    });
    ctx.restore();
  }
  if (border) {
    trace(ctx, [polygons.at(-1)]);
    edge();
    ctx.restore();
  }
}
// Records canvas drawing as SVG so library previews match the renderer.
class SvgContext {
  constructor() {
    this.parts = [];
    this.d = "";
    this.m = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.lineWidth = 1;
    this.strokeStyle = "#000000";
    this.fillStyle = "#000000";
    this.font = "10px sans-serif";
    this.textAlign = "left";
    this.textBaseline = "top";
    this.lineCap = "round";
    this.lineJoin = "round";
  }
  save() {
    this.stack.push([
      this.m.slice(),
      this.lineWidth,
      this.strokeStyle,
      this.fillStyle,
    ]);
  }
  restore() {
    [this.m, this.lineWidth, this.strokeStyle, this.fillStyle] =
      this.stack.pop();
  }
  translate(x, y) {
    const [a, b, c, d, e, f] = this.m;
    this.m = [a, b, c, d, a * x + c * y + e, b * x + d * y + f];
  }
  scale(x, y) {
    const [a, b, c, d, e, f] = this.m;
    this.m = [a * x, b * x, c * y, d * y, e, f];
  }
  point(x, y) {
    const [a, b, c, d, e, f] = this.m;
    return `${+(a * x + c * y + e).toFixed(2)} ${+(b * x + d * y + f).toFixed(2)}`;
  }
  get unit() {
    return Math.sqrt(Math.abs(this.m[0] * this.m[3] - this.m[1] * this.m[2]));
  }
  // The current point and subpath start, before the transform, let
  // quadratic curves be written as the cubic curves PDF draws exactly.
  beginPath() {
    this.d = "";
    this.at = this.start = null;
  }
  moveTo(x, y) {
    this.d += `M${this.point(x, y)}`;
    this.at = this.start = [x, y];
  }
  lineTo(x, y) {
    if (!this.d) this.start = [x, y];
    this.d += `${this.d ? "L" : "M"}${this.point(x, y)}`;
    this.at = [x, y];
  }
  closePath() {
    this.d += "Z";
    this.at = this.start;
  }
  bezierCurveTo(a, b, c, d, x, y) {
    this.d += `C${this.point(a, b)} ${this.point(c, d)} ${this.point(x, y)}`;
    this.at = [x, y];
  }
  quadraticCurveTo(a, b, x, y) {
    const from = this.at;
    this.d += from
      ? `C${this.point(from[0] + ((a - from[0]) * 2) / 3, from[1] + ((b - from[1]) * 2) / 3)} ${this.point(x + ((a - x) * 2) / 3, y + ((b - y) * 2) / 3)} ${this.point(x, y)}`
      : `Q${this.point(a, b)} ${this.point(x, y)}`;
    this.at = [x, y];
  }
  rect(x, y, w, h) {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }
  roundRect(x, y, w, h, r = 0) {
    r = Math.min(Number(r) || 0, Math.abs(w) / 2, Math.abs(h) / 2);
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    this.lineTo(x + w, y + h - r);
    this.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    this.lineTo(x + r, y + h);
    this.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    this.lineTo(x, y + r);
    this.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
    this.closePath();
  }
  arc(cx, cy, r, from, to, ccw = false) {
    this.ellipse(cx, cy, r, r, 0, from, to, ccw);
  }
  ellipse(cx, cy, rx, ry, rotation, from, to, ccw = false) {
    let delta = to - from;
    if (!ccw && delta < 0) delta += Math.PI * 2;
    if (ccw && delta > 0) delta -= Math.PI * 2;
    const full = Math.abs(to - from) >= Math.PI * 2 - 1e-9;
    if (full) delta = ccw ? -Math.PI * 2 : Math.PI * 2;
    const local = (a) => {
      const x = rx * Math.cos(a),
        y = ry * Math.sin(a);
      return [
        cx + x * Math.cos(rotation) - y * Math.sin(rotation),
        cy + x * Math.sin(rotation) + y * Math.cos(rotation),
      ];
    };
    const at = (a) => this.point(...local(a));
    if (!this.d) this.start = local(from);
    this.at = local(from + delta);
    const radii = `${+(rx * this.unit).toFixed(2)} ${+(ry * this.unit).toFixed(2)} ${+((rotation * 180) / Math.PI).toFixed(2)}`;
    this.d += `${this.d ? "L" : "M"}${at(from)}`;
    // Two half arcs describe a full ellipse; SVG cannot close one arc.
    const steps = full ? 2 : 1;
    for (let n = 1; n <= steps; n++)
      this.d += `A${radii} ${Math.abs(delta / steps) > Math.PI ? 1 : 0} ${delta > 0 ? 1 : 0} ${at(from + (delta * n) / steps)}`;
  }
  clip() {}
  setLineDash() {}
  opacity(color) {
    const hex = /^#([\da-f]{6})$/i.exec(color);
    if (!hex) return 1;
    const n = parseInt(hex[1], 16),
      light =
        (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) /
        255;
    return light > 0.97 ? 0 : light > 0.6 ? 0.25 : light > 0.5 ? 0.7 : 1;
  }
  fill(rule) {
    const opacity = this.opacity(this.fillStyle);
    if (!opacity || !this.d) return;
    this.parts.push(
      `<path d="${this.d}" fill="currentColor" fill-opacity="${opacity}" stroke="none"${rule === "evenodd" ? ' fill-rule="evenodd"' : ""}/>`,
    );
  }
  stroke() {
    if (!this.d) return;
    const opacity = this.opacity(this.strokeStyle) || 0.4;
    this.parts.push(
      `<path d="${this.d}" stroke-opacity="${opacity}" stroke-width="${+Math.max(1.2, this.lineWidth * this.unit * 1.5).toFixed(2)}"/>`,
    );
  }
  fillRect(x, y, w, h) {
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
  }
  fillText(text, x, y) {
    const size =
      (parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1]) || 10) * this.unit;
    const [px, py] = this.point(x, y).split(" ");
    this.parts.push(
      `<text x="${px}" y="${py}" font-size="${+size.toFixed(2)}" fill="currentColor" stroke="none" text-anchor="${this.textAlign === "center" ? "middle" : "start"}" dominant-baseline="${this.textBaseline === "middle" ? "middle" : "hanging"}">${text.replace(/[<&>]/g, "")}</text>`,
    );
  }
}
// Records canvas drawing as a list of fills, strokes, clips, and text in
// object pixels, with the drawn colors, widths, and dashes, so vector exports
// reproduce shapes exactly as the board draws them.
class ShapeRecorder extends SvgContext {
  constructor() {
    super();
    this.ops = [];
    this.dash = [];
    this.clips = 0;
  }
  save() {
    super.save();
    this.stack
      .at(-1)
      .push(
        this.dash,
        this.clips,
        this.font,
        this.textAlign,
        this.textBaseline,
        this.lineCap,
        this.lineJoin,
      );
    this.clips = 0;
  }
  restore() {
    const clips = this.clips;
    const frame = this.stack.at(-1);
    [
      this.dash,
      this.clips,
      this.font,
      this.textAlign,
      this.textBaseline,
      this.lineCap,
      this.lineJoin,
    ] = frame.slice(4);
    frame.length = 4;
    super.restore();
    if (clips) this.ops.push({ op: "unclip", count: clips });
  }
  setLineDash(dash) {
    this.dash = dash || [];
  }
  clip() {
    this.ops.push({ op: "clip", d: this.d });
    this.clips++;
  }
  fill(rule) {
    if (this.d)
      this.ops.push({
        op: "fill",
        d: this.d,
        color: this.fillStyle,
        evenodd: rule === "evenodd",
      });
  }
  stroke() {
    if (this.d)
      this.ops.push({
        op: "stroke",
        d: this.d,
        color: this.strokeStyle,
        width: this.lineWidth * this.unit,
        dash: this.dash.map((n) => n * this.unit),
        cap: this.lineCap,
        join: this.lineJoin,
      });
  }
  fillText(text, x, y) {
    const [px, py] = this.point(x, y).split(" ").map(Number);
    const [, weight = "400", size = "10", family = "sans-serif"] =
      /^(?:(\d00)\s+)?(\d+(?:\.\d+)?)px\s+(.+)$/.exec(this.font.trim()) || [];
    this.ops.push({
      op: "text",
      text,
      x: px,
      y: py,
      size: size * this.unit,
      weight,
      family,
      color: this.fillStyle,
      align: this.textAlign,
      baseline: this.textBaseline,
    });
  }
}
// The drawing of a library shape, from its top-left corner, as the board
// draws it with `fill` as the shape color.
export function shapeDrawing(key, w, h, i, fill) {
  const ctx = new ShapeRecorder();
  ctx.fillStyle = fill;
  drawShape(ctx, key, w, h, i);
  return ctx.ops;
}
const attr = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const round = (n) => +n.toFixed(2);
// SVG markup of a library shape drawing. `id` returns a document-unique id
// for each clip.
export function shapeSvg(key, w, h, i, fill, id) {
  let out = "";
  for (const o of shapeDrawing(key, w, h, i, fill)) {
    if (o.op === "fill")
      out += `<path d="${o.d}" fill="${attr(o.color)}"${o.evenodd ? ' fill-rule="evenodd"' : ""}/>`;
    else if (o.op === "stroke")
      out += `<path d="${o.d}" fill="none" stroke="${attr(o.color)}" stroke-width="${round(o.width)}" stroke-linecap="${o.cap}" stroke-linejoin="${o.join}"${o.dash.length ? ` stroke-dasharray="${o.dash.map(round).join(" ")}"` : ""}/>`;
    else if (o.op === "clip") {
      const clip = id();
      out += `<clipPath id="${clip}"><path d="${o.d}"/></clipPath><g clip-path="url(#${clip})">`;
    } else if (o.op === "unclip") out += "</g>".repeat(o.count);
    else if (o.op === "text") {
      const anchor = { center: "middle", right: "end", end: "end" }[o.align];
      const baseline = {
        middle: "middle",
        top: "hanging",
        hanging: "hanging",
        bottom: "text-after-edge",
      }[o.baseline];
      out += `<text x="${round(o.x)}" y="${round(o.y)}" font-family="${attr(o.family)}" font-size="${round(o.size)}"${o.weight !== "400" ? ` font-weight="${o.weight}"` : ""} fill="${attr(o.color)}"${anchor ? ` text-anchor="${anchor}"` : ""}${baseline ? ` dominant-baseline="${baseline}"` : ""}>${attr(o.text)}</text>`;
    }
  }
  return out;
}
const previews = new Map();
// SVG preview for the shape library, fitted to the shape's usual proportions.
export function shapePreview(key) {
  const spec = SHAPE_SPECS[key];
  if (!spec) return shapeIcon(key);
  if (previews.has(key)) return previews.get(key);
  const { w = 100, h = 80 } = spec.defaults || {},
    z = Math.min(100 / w, 80 / h),
    pw = w * z,
    ph = h * z;
  const ctx = new SvgContext();
  ctx.translate((100 - pw) / 2, (80 - ph) / 2);
  drawShape(ctx, key, pw, ph, {}, true);
  const svg = `<svg viewBox="-3 -3 106 86" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">${ctx.parts.join("")}</svg>`;
  previews.set(key, svg);
  return svg;
}
