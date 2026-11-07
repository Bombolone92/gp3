import { rotatedLinePoints } from './drawing-line-rotation.js';
import { markerGeometry } from './drawing-line-ends.js';
// A marker's reach from its end point, as an ellipse for hit testing and bounds (ovals exactly, others by extent).
const markerRadii = (marker, pen) => { const g = markerGeometry(marker, pen); return g.radii || [g.extent, g.extent]; };
import { EMU_PER_PX } from './images.js';

function endpoints(image, width, height) {
  const { rotation, flipH, flipV } = image.flatLine || image.flatGroup;
  return rotatedLinePoints({ width, height, lineRotation: rotation, flipH, flipV }, 1, 1);
}

// Interaction bounds follow the stroke; the zero-area frame still determines
// document flow. A small pointer tolerance keeps a thin line selectable.
export function flatLineContains(image, x, y, width, height, px, py) {
  // Percentage sizing can expand the outer frame of a flat group. It remains
  // an atomic group selection, including the unused area of that new frame.
  if (image.flatGroup && width && height) return px>=x && px<=x+width && py>=y && py<=y+height;
  const [[ax, ay], [bx, by]] = endpoints(image, width, height);
  const dx = bx-ax, dy = by-ay, length = dx*dx+dy*dy;
  const flat = image.flatLine;
  if (flat && length) {
    const cos=dx/Math.sqrt(length),sin=dy/Math.sqrt(length);
    for (const [marker,ex,ey] of [[flat.headEnd,ax,ay],[flat.tailEnd,bx,by]]) if (marker) {
      const [rx,ry]=markerRadii(marker,flat.markerPen ?? flat.strokeWidth).map(v=>v/EMU_PER_PX+1);
      const mx=px-x-ex,my=py-y-ey;
      if (((mx*cos+my*sin)/rx)**2+((-mx*sin+my*cos)/ry)**2<=1) return true;
    }
  }
  const t = length ? Math.max(0,Math.min(1,((px-x-ax)*dx+(py-y-ay)*dy)/length)) : 0;
  return Math.hypot(px-x-ax-t*dx,py-y-ay-t*dy) <= Math.max(3,(image.flatLine || image.flatGroup).strokeWidth/EMU_PER_PX/2);
}

export function flatLineRect(image, x, y, width, height) {
  if (image.flatGroup && width && height) return {x,y,width,height};
  const [[ax, ay], [bx, by]] = endpoints(image, width, height);
  const edge = Math.max(1,(image.flatLine || image.flatGroup).strokeWidth/EMU_PER_PX/2);
  let left=Math.min(ax,bx)-edge,right=Math.max(ax,bx)+edge,top=Math.min(ay,by)-edge,bottom=Math.max(ay,by)+edge;
  const flat=image.flatLine,angle=Math.atan2(by-ay,bx-ax),cos=Math.cos(angle),sin=Math.sin(angle);
  if (flat) for (const [marker,ex,ey] of [[flat.headEnd,ax,ay],[flat.tailEnd,bx,by]]) if (marker) {
    const [rx,ry]=markerRadii(marker,flat.markerPen ?? flat.strokeWidth).map(v=>v/EMU_PER_PX);
    const mx=Math.hypot(rx*cos,ry*sin),my=Math.hypot(rx*sin,ry*cos);
    left=Math.min(left,ex-mx);right=Math.max(right,ex+mx);top=Math.min(top,ey-my);bottom=Math.max(bottom,ey+my);
  }
  return { x:x+left,y:y+top,width:right-left,height:bottom-top };
}
