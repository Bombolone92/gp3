import { paintColor } from './colors.js';
import { borderInkPolygon, containsBorderDot } from './border-ink.js';
import { borderBands } from './border-patterns.js';

/** Original line-pattern painter; geometry and OOXML resolution are upstream. */
export function paintParagraphBorder(ctx, stroke, paintedInk = [], color = paintColor(stroke.border.color, stroke.background)) {
  const { x, width, horizontal, border, clip } = stroke;
  let { y, height } = stroke;
  if (stroke.cellClip) {
    const bottom = Math.min(y + height, stroke.cellClip.bottom);
    const top = Math.max(y, stroke.cellClip.top);
    if (bottom <= top) return;
    if (!horizontal) { y = top; height = bottom - top; }
  }
  const thickness = horizontal ? height : width, length = horizontal ? width : height;
  const path = points => { ctx.beginPath(); ctx.moveTo(...points[0]); for (const point of points.slice(1)) ctx.lineTo(...point); ctx.closePath(); };
  const band = (offset, size, start = 0, extent = length) => {
    const box = horizontal ? { x: x + start, y: y + offset, width: extent, height: size } : { x: x + offset, y: y + start, width: size, height: extent };
    if (stroke.cellClip) { const bottom = Math.min(box.y + box.height, stroke.cellClip.bottom); box.y = Math.max(box.y, stroke.cellClip.top); box.height = bottom - box.y; }
    if (box.width <= 0 || box.height <= 0) return;
    // Matching shading may already contain the interior of a solid band.
    // Subtract that exact geometry instead of blending its fractional coverage
    // twice. Retain the remaining corners and outer edges in their paint order.
    let boxes = [box];
    for (const r of paintedInk) boxes = boxes.flatMap(b => {
      const left=Math.max(b.x,r.x),right=Math.min(b.x+b.width,r.x+r.width);
      const top=Math.max(b.y,r.y),bottom=Math.min(b.y+b.height,r.y+r.height);
      if (right<=left || bottom<=top) return [b];
      return [
        {x:b.x,y:b.y,width:b.width,height:top-b.y},
        {x:b.x,y:bottom,width:b.width,height:b.y+b.height-bottom},
        {x:b.x,y:top,width:left-b.x,height:bottom-top},
        {x:right,y:top,width:b.x+b.width-right,height:bottom-top},
      ].filter(p=>p.width>0&&p.height>0);
    });
    for (const b of boxes) {
      if (clip) { const points = borderInkPolygon(clip, b); if (points.length < 3) continue; path(points); ctx.fill(); }
      else ctx.fillRect(b.x, b.y, b.width, b.height);
    }
  };
  ctx.save(); ctx.fillStyle = color;
  if (stroke.cellClip?.left !== undefined) { const c = stroke.cellClip; ctx.beginPath(); ctx.rect(c.left, c.top, c.right - c.left, c.bottom - c.top); ctx.clip(); }
  const bands = borderBands(border, thickness, stroke.side);
  if (bands) {
    const shift = horizontal ? 0 : stroke.y - y;
    if (stroke.bodyBands) {
      const { first, last } = stroke.bandCaps || {};
      const bodyStart = (first?.at ?? 0) + shift, bodyEnd = (last?.at ?? stroke.height) + shift;
      if (first) for (const [i, [offset, size]] of first.bands.entries()) {
        const start = (stroke.bandEnds?.[i]?.[0] ?? 0) + shift;
        band(offset, size, start, bodyStart - start);
      }
      for (const [offset, size] of stroke.bodyBands) band(offset, size, bodyStart, bodyEnd - bodyStart);
      if (last) for (const [i, [offset, size]] of last.bands.entries()) {
        const end = (stroke.bandEnds?.[i]?.[1] ?? stroke.height) + shift;
        band(offset, size, bodyEnd, end - bodyEnd);
      }
    } else for (const [i, [offset, size]] of bands.entries()) {
      const ends = stroke.bandEnds?.[i];
      band(offset, size, ends ? ends[0] + shift : 0, ends ? ends[1] - ends[0] : length);
    }
  } else if (border.style === 'dotted') {
    const origin = horizontal ? x : y, period = thickness * 2;
    const boundary = borderInkPolygon(clip, { x, y, width, height }, stroke.cellClip);
    if (boundary.length < 3) { ctx.restore(); return; }
    for (let at = Math.floor(origin / period) * period + thickness / 2; at < origin + length + thickness / 2; at += period) {
      const cx = horizontal ? at : x + thickness / 2, cy = horizontal ? y + thickness / 2 : at;
      const clipped = !containsBorderDot(boundary, cx, cy, thickness / 2);
      if (clipped) { ctx.save(); path(boundary); ctx.clip(); }
      ctx.beginPath(); ctx.arc(cx, cy, thickness / 2, 0, 2 * Math.PI); ctx.fill();
      if (clipped) ctx.restore();
    }
  } else {
    const pattern = { dashed: [3, 2], dashSmallGap: [3, 1], dotDash: [3, 1, 1, 1], dotDotDash: [3, 1, 1, 1, 1, 1] }[border.style];
    if (!pattern) band(0, thickness);
    else {
      const origin = horizontal ? x : y, period = pattern.reduce((a, b) => a + b, 0) * thickness;
      for (let base = Math.floor(origin / period) * period; base < origin + length; base += period) {
        let at = base;
        pattern.forEach((size, i) => {
          const end = at + size * thickness, left = Math.max(origin, at), right = Math.min(origin + length, end);
          if (i % 2 === 0 && right > left) band(0, thickness, left - origin, right - left);
          at = end;
        });
      }
    }
  }
  ctx.restore();
}
