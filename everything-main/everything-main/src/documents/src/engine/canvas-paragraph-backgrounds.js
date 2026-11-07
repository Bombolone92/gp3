import { paintColor } from './colors.js';
import { borderInkPolygon } from './border-ink.js';

// Only bridge a gap when opaque, matching single-border ink covers all of it.
// Corner polygons and cell clips constrain the coverage just as in the painter.
function borderBridge(a, b, borders) {
  const x = Math.max(a.x, b.x), right = Math.min(a.x + a.width, b.x + b.width);
  const y = a.y + a.height, bottom = b.y;
  if (right <= x || bottom <= y) return null;
  let covered = y;
  const ink = [];
  for (const stroke of borders) {
    if (!stroke.horizontal || stroke.border.style !== 'single' || paintColor(stroke.border.color, stroke.background).toUpperCase() !== a.color.toUpperCase()) continue;
    const top = Math.max(stroke.y, stroke.cellClip?.top ?? -Infinity), end = Math.min(bottom, stroke.y + stroke.height, stroke.cellClip?.bottom ?? Infinity);
    if (top > covered + 1e-7 || end <= covered || x < (stroke.cellClip?.left ?? -Infinity) || right > (stroke.cellClip?.right ?? Infinity)) continue;
    const polygon = borderInkPolygon(stroke.clip, stroke, stroke.cellClip);
    if (polygon.length < 3) continue;
    const area = polygon.reduce((sum,p,i) => { const q=polygon[(i+1)%polygon.length]; return sum+p[0]*q[1]-q[0]*p[1]; },0);
    const corners = [[x,covered],[right,covered],[right,end],[x,end]];
    if (!area || !corners.every(p => polygon.every((v,i) => {
      const w=polygon[(i+1)%polygon.length];
      return Math.sign(area)*((w[0]-v[0])*(p[1]-v[1])-(w[1]-v[1])*(p[0]-v[0])) >= -1e-7;
    }))) continue;
    ink.push({ stroke, rect:{x,y:covered,width:right-x,height:end-covered} });
    covered = end;
    if (covered >= bottom - 1e-7) return { rect:{ x, y, width:right-x, height:bottom-y }, ink };
  }
  return null;
}

/** Paint continuous opaque material in one path so abutting fractional edges
 * do not independently blend with the page and leave a lighter hairline.
 * Logical paragraph shading bounds, border geometry and paint order stay intact. */
export function paintParagraphBackgrounds(ctx, rectangles, borders) {
  rectangles = [...rectangles];
  const orderedBorders = borders.filter(b => b.horizontal && b.border.style === 'single').sort((a,b)=>a.y-b.y);
  const verticalBorders = borders.filter(b => !b.horizontal && b.border.style === 'single');
  const paintedInk = new Map();
  let previous = null;
  for (const rect of rectangles) {
    if (!previous || previous.color.toUpperCase() !== rect.color.toUpperCase()) {
      if (previous) ctx.fill();
      ctx.fillStyle = rect.color; ctx.beginPath();
    } else {
      const bridge = borderBridge(previous, rect, orderedBorders);
      if (bridge) {
        const r=bridge.rect;ctx.rect(r.x,r.y,r.width,r.height);
        for (const {stroke,rect} of bridge.ink) {
          if (!paintedInk.has(stroke)) paintedInk.set(stroke,[]);
          paintedInk.get(stroke).push(rect);
        }
      }
    }
    ctx.rect(rect.x,rect.y,rect.width,rect.height);
    // Adjacent opaque material must share a rasterization pass. Separate
    // source-over fills lighten their common fractional pixel even though
    // their combined coverage is complete. Absorb only the matching vertical
    // band beside this rectangle, retaining its corner and cell clipping.
    for (const stroke of verticalBorders) {
      if (paintColor(stroke.border.color,stroke.background).toUpperCase() !== rect.color.toUpperCase()) continue;
      if (Math.abs(stroke.x - rect.x - rect.width) > 1e-7 && Math.abs(stroke.x + stroke.width - rect.x) > 1e-7) continue;
      const x=Math.max(stroke.x,stroke.cellClip?.left ?? -Infinity), right=Math.min(stroke.x+stroke.width,stroke.cellClip?.right ?? Infinity);
      const y=Math.max(stroke.y,rect.y,stroke.cellClip?.top ?? -Infinity), bottom=Math.min(stroke.y+stroke.height,rect.y+rect.height,stroke.cellClip?.bottom ?? Infinity);
      if (right<=x || bottom<=y) continue;
      // Moving this ink into the shading pass must not change the ordering
      // of an overlapping paragraph with a different color.
      if (rectangles.some(r=>r.color.toUpperCase()!==rect.color.toUpperCase() && r.x<right && r.x+r.width>x && r.y<bottom && r.y+r.height>y)) continue;
      const box={x,y,width:right-x,height:bottom-y}, points=borderInkPolygon(stroke.clip,box);
      if (points.length<3) continue;
      const area=points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p[0]*q[1]-q[0]*p[1];},0);
      if (!area) continue;
      if (area<0) points.reverse();
      ctx.moveTo(...points[0]);for(const point of points.slice(1))ctx.lineTo(...point);ctx.closePath();
      if (!paintedInk.has(stroke)) paintedInk.set(stroke,[]);
      paintedInk.get(stroke).push(box);
    }
    previous = rect;
  }
  if (previous) ctx.fill();
  return paintedInk;
}
