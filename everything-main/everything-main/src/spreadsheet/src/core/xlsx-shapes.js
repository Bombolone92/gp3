/** Render DrawingML geometry and text without embedding workbook XML. */
import { pictureGeometry, readPictureRect } from './picture-geometry.js';
import { drawingGeometry, drawingArc } from './drawingml-geometry.js';
import { drawingText } from './drawingml-text.js';
import { drawingmlColor } from './drawingml-color.js';

const child = (node, name) => node?.children.find(n => n.name === name);
const number = (node, key, fallback = null) => {
  const value = node?.attrs[key];
  return value != null && String(value).trim() !== '' && Number.isFinite(+value) && Math.abs(+value) <= 1e12 ? +value : fallback;
};
const flag = (node, key) => ['1', 'true'].includes(node?.attrs[key]);

function curvePoints(points) {
  const ts = new Set([0, 1]);
  for (const axis of [0, 1]) {
    const [p0, p1, p2, p3] = points.map(p => p[axis]);
    if (points.length === 3) {
      const d = p0 - 2 * p1 + p2;
      if (d) ts.add((p0 - p1) / d);
    } else {
      const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
      if (Math.abs(a) < 1e-10) { if (b) ts.add(-c / b); }
      else if (b * b - 4 * a * c >= 0) {
        const d = Math.sqrt(b * b - 4 * a * c);
        ts.add((-b + d) / (2 * a)); ts.add((-b - d) / (2 * a));
      }
    }
  }
  return [...ts].filter(t => t >= 0 && t <= 1).map(t => [0, 1].map(axis => {
    const p = points.map(p => p[axis]), s = 1 - t;
    return p.length === 3 ? s * s * p[0] + 2 * s * t * p[1] + t * t * p[2]
      : s ** 3 * p[0] + 3 * s * s * t * p[1] + 3 * s * t * t * p[2] + t ** 3 * p[3];
  }));
}

export function drawingShapeImage(root, fill, { presets = {}, font, picture, textSize } = {}) {
  let budget = 10000;
  let pictureBytes = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, valid = true;
  const record = ([x, y]) => {
    if (![x, y].every(Number.isFinite)) valid = false;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  const transform = node => child(child(node, node.name === 'grpSp' ? 'grpSpPr' : 'spPr'), 'xfrm');
  const bounds = t => {
    const off = child(t, 'off'), ext = child(t, 'ext');
    return { x: number(off, 'x', 0), y: number(off, 'y', 0), w: number(ext, 'cx'), h: number(ext, 'cy') };
  };
  const render = (node, depth = 0, parent = (x, y) => [x, y]) => {
    if (depth > 16 || --budget < 0) return null;
    const t = transform(node), { x, y, w, h } = bounds(t);
    if (!(w >= 0 && h >= 0) || (!['sp', 'cxnSp'].includes(node.name) && !(w > 0 && h > 0))) return null;
    // The outer object's transform is applied by the sheet image renderer.
    const rotate = depth ? number(t, 'rot', 0) / 60000 : 0;
    const fx = depth && flag(t, 'flipH') ? -1 : 1, fy = depth && flag(t, 'flipV') ? -1 : 1;
    const sin = Math.sin(rotate * Math.PI / 180), cos = Math.cos(rotate * Math.PI / 180);
    const project = (px, py) => {
      px = (px - w / 2) * fx; py = (py - h / 2) * fy;
      return parent(x + w / 2 + px * cos - py * sin, y + h / 2 + px * sin + py * cos);
    };
    let content;
    if (node.name === 'grpSp') {
      const off = child(t, 'chOff'), ext = child(t, 'chExt'), cw = number(ext, 'cx'), ch = number(ext, 'cy');
      if (!(cw > 0 && ch > 0) || ![w / cw, h / ch].every(Number.isFinite)) return null;
      const items = node.children.filter(n => !['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(n.name));
      const rendered = items.map(n => render(n, depth + 1,
        (px, py) => project((px - number(off, 'x', 0)) * w / cw, (py - number(off, 'y', 0)) * h / ch)));
      if (!items.length || rendered.some(s => s == null)) return null;
      content = `<g transform="scale(${w / cw} ${h / ch}) translate(${-number(off, 'x', 0)} ${-number(off, 'y', 0)})">${rendered.join('')}</g>`;
    } else if (['sp', 'cxnSp'].includes(node.name)) {
      const props = child(node, 'spPr'), line = child(props, 'ln');
      const geometry = drawingGeometry(child(props, 'custGeom') || child(props, 'prstGeom'), w, h, presets);
      if (!geometry) return null;
      const referenceFill = name => {
        const ref = child(child(node, 'style'), name);
        return +ref?.attrs.idx > 0 ? fill({ children: [{ name: 'solidFill', children: ref.children }] }) : null;
      };
      const color = fill(props) || referenceFill('fillRef') || 'none', stroke = fill(line) || referenceFill('lnRef') || 'none';
      const rendered = [], outlines = [];
      for (const path of geometry.paths) {
        const commands = [];
        let current = [0, 0], first = current;
        const radius = stroke === 'none' || !path.stroke ? 0 : Math.max(0, number(line, 'w', 9525)) / 2;
        const zero = project(0, 0), diagonal = [project(radius, radius), project(radius, -radius)];
        const pad = [0, 1].map(i => Math.max(...diagonal.map(p => Math.abs(p[i] - zero[i]))));
        const inkPoint = p => { for (const dx of [-pad[0], pad[0]]) for (const dy of [-pad[1], pad[1]]) record([p[0] + dx, p[1] + dy]); };
        for (const [kind, ...args] of path.commands) {
          if (--budget < 0) return null;
          if (kind === 'A') {
            const arc = drawingArc(...current, ...args, project);
            commands.push(...arc.commands.map(cmd => cmd[0] + cmd.slice(1).join(' ')));
            arc.points.map(p => project(...p)).forEach(inkPoint);
            current = arc.commands.at(-1)?.slice(-2) || current;
            continue;
          }
          const points = [];
          for (let i = 0; i < args.length; i += 2) points.push([args[i], args[i + 1]]);
          if (kind === 'C' || kind === 'Q') curvePoints([current, ...points].map(p => project(...p))).forEach(inkPoint);
          else points.map(p => project(...p)).forEach(inkPoint);
          if (kind === 'M') first = points[0];
          current = kind === 'Z' ? first : points.at(-1) || current;
          commands.push(kind + args.join(' '));
        }
        const tint = { lighten: ['tint', 60000], lightenLess: ['tint', 80000], darken: ['shade', 60000], darkenLess: ['shade', 80000] }[path.fill];
        const ink = path.fill === 'none' ? 'none' : tint && color !== 'none' ? drawingmlColor(color, [{ name: tint[0], attrs: { val: tint[1] } }]) + color.slice(7) : color;
        const edge = path.stroke ? stroke : 'none';
        const d = commands.join(' ');
        if (ink !== 'none') rendered.push(`<path d="${d}" fill="${ink}"/>`);
        if (edge !== 'none') outlines.push(`<path d="${d}" fill="none" stroke="${edge}" stroke-width="${Math.max(0, number(line, 'w', 9525))}"/>`);
      }
      // DrawingML outlines sit above the complete fill. Chart-marker presets
      // deliberately put their open outline before the filled hit-test rectangle.
      rendered.push(...outlines);
      const text = drawingText(node, geometry.rect, fill, font, textSize);
      if (text == null) return null;
      budget -= Math.ceil(text.length / 128);
      if (budget < 0) return null;
      if (text) {
        rendered.push(text);
        const [l, t, r, b] = geometry.rect;
        [[l, t], [r, t], [r, b], [l, b]].map(p => project(...p)).forEach(record);
      }
      content = rendered.join('');
    } else if (node.name === 'pic') {
      const src = picture?.(node);
      if (typeof src !== 'string' || src.length > 22400000 || !/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[a-z\d+/=]+$/i.test(src)) return null;
      if ((pictureBytes += src.length) > 24 * 1024 * 1024) return null;
      const fillNode = child(node, 'blipFill');
      const g = pictureGeometry({ srcRect: readPictureRect(child(fillNode, 'srcRect')?.attrs),
        fillRect: readPictureRect(child(child(fillNode, 'stretch'), 'fillRect')?.attrs) });
      if (!g) return null;
      [[0, 0], [w, 0], [w, h], [0, h]].map(p => project(...p)).forEach(record);
      const { source: s, fill: f } = g;
      content = `<svg width="${w}" height="${h}" viewBox="0 0 1 1" preserveAspectRatio="none" overflow="hidden"><svg x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" viewBox="${s.x} ${s.y} ${s.w} ${s.h}" preserveAspectRatio="none" overflow="hidden"><image href="${src}" width="1" height="1" preserveAspectRatio="none"/></svg></svg>`;
    } else return null;
    return `<g transform="translate(${x + w / 2} ${y + h / 2}) rotate(${rotate}) scale(${fx} ${fy}) translate(${-w / 2} ${-h / 2})">${content}</g>`;
  };
  const t = transform(root), { x, y, w, h } = bounds(t), content = render(root);
  if (!content || !valid || !Number.isFinite(minX)) return null;
  // Rotated children can extend beyond a group's nominal box. Symmetric padding
  // keeps them visible and preserves the center used for the outer rotation.
  const padX = Math.max(0, x - minX, maxX - x - w), padY = Math.max(0, y - minY, maxY - y - h);
  if ((w > 0 && padX / w > 10) || (h > 0 && padY / h > 10) || !(w + 2 * padX > 0 && h + 2 * padY > 0)) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x - padX} ${y - padY} ${w + 2 * padX} ${h + 2 * padY}" preserveAspectRatio="none">${content}</svg>`;
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { src: `data:image/svg+xml;base64,${btoa(binary)}`, viewport: [x - padX, y - padY, w + 2 * padX, h + 2 * padY], padding: { x: w ? padX / w : 0, y: h ? padY / h : 0 }, frame: { x, y, w, h },
    rotation: number(t, 'rot', 0) / 60000, flipH: flag(t, 'flipH'), flipV: flag(t, 'flipV') };
}
