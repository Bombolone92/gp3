import { shapePathScale } from './shape-path-scale.js';
import { drawingLineDash } from './drawing-line-dashes.js';
import { openCompoundPath } from './open-compound-outlines.js';

export const COMPOUND_LINES = ['sng', 'dbl', 'thickThin', 'thinThick', 'tri'];
export function closedOutlinePath(path) {
  let open = false;
  for (const [op] of path.points) {
    if (op === 'M' || op === 'E') { if (open) return false; open = true; }
    else if (op === 'Z') open = false;
    else if (!open) return false;
  }
  return !open;
}

// Closed compound contours are flattened before offsetting/dashing, and
// start at the last unique flattened vertex. Work in physical pixels so group
// transforms do not change the subdivision tolerance (0.03 physical points).
export function compoundContourPoints(path, width, height, matrix, pixelsPerPoint) {
  return compoundContours(path, width, height, matrix, pixelsPerPoint).map(c => c.points);
}

export function compoundContours(path, width, height, matrix, pixelsPerPoint) {
  const contours = [], tolerance = .03 * pixelsPerPoint;
  let points, current, contour;
  const begin = () => { points=[]; contour={points,closed:false,direction:matrix.a*matrix.d-matrix.b*matrix.c < 0 ? -1 : 1};contours.push(contour); };
  const transform = (x, y) => [matrix.a*x+matrix.c*y+matrix.e, matrix.b*x+matrix.d*y+matrix.f];
  const point = (x, y) => transform(x*shapePathScale(width, path.width), y*shapePathScale(height, path.height));
  const add = p => { if (points.length >= 200000) throw new Error('Compound outline subdivision exceeds the drawing limit.'); points.push(p); current = p; };
  const midpoint = (a,b) => [(a[0]+b[0])/2,(a[1]+b[1])/2];
  const cubic = (a,b,c,d,depth=0) => {
    const dx=d[0]-a[0],dy=d[1]-a[1],length=Math.hypot(dx,dy);
    const distance = p => {
      const t=length ? Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(length*length))) : 0;
      return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
    };
    if (depth>=20 || Math.max(distance(b),distance(c))<=tolerance) { add(d); return; }
    const ab=midpoint(a,b),bc=midpoint(b,c),cd=midpoint(c,d),abc=midpoint(ab,bc),bcd=midpoint(bc,cd),middle=midpoint(abc,bcd);
    cubic(a,ab,abc,middle,depth+1);cubic(middle,bcd,cd,d,depth+1);
  };
  for (const [op,...v] of path.points) {
    if (contour?.closed && ['L','C','Q'].includes(op)) { begin();add(current); }
    if (op==='M') { begin();add(point(v[0],v[1])); }
    else if (op==='L') add(point(v[0],v[1]));
    else if (op==='C') cubic(current,point(v[0],v[1]),point(v[2],v[3]),point(v[4],v[5]));
    else if (op==='Q') {
      const b=point(v[0],v[1]),d=point(v[2],v[3]),a=current;
      cubic(a,a.map((x,i)=>x+(b[i]-x)*2/3),d.map((x,i)=>x+(b[i]-x)*2/3),d);
    } else if (op==='E') {
      const x=width/2,y=height/2,k=4*(Math.SQRT2-1)/3;
      begin();add(transform(0,y));
      cubic(current,transform(0,y*(1-k)),transform(x*(1-k),0),transform(x,0));
      cubic(current,transform(x*(1+k),0),transform(width,y*(1-k)),transform(width,y));
      cubic(current,transform(width,y*(1+k)),transform(x*(1+k),height),transform(x,height));
      cubic(current,transform(x*(1-k),height),transform(0,y*(1+k)),transform(0,y));
      contour.closed=true;
    } else if (op==='Z') { contour.closed=true;current=points[0]; }
  }
  return contours.map(c => {
    if (!c.closed) return c;
    const p=c.points;
    if (p.length>1 && Math.hypot(p[0][0]-p.at(-1)[0],p[0][1]-p.at(-1)[1])<1e-7) p.pop();
    return {...c,points:p.length ? [p.at(-1),...p.slice(0,-1)] : p};
  });
}

// Isolated masks preserve artwork beneath transparent gaps. Buffers are
// allocated only for compound outlines and reused within one shape raster.
export function compoundOutlinePainter(width, height) {
  const ink = new OffscreenCanvas(width, height), gap = new OffscreenCanvas(width, height);
  const a = ink.getContext('2d'), b = gap.getContext('2d');
  const reset = c => { c.resetTransform(); c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, width, height); };
  return (target, path, outline, pen, dashed = path, open = []) => {
    for (const c of [a, b]) {
      reset(c); c.strokeStyle = '#000'; c.fillStyle = '#000';
      c.lineCap = { flat: 'butt', rnd: 'round', sq: 'square' }[outline.cap || 'flat'];
      c.lineJoin = outline.join || 'round'; c.miterLimit = outline.miterLimit || 10;
      c.setLineDash([]);
    }
    a.lineWidth = pen; a.stroke(path);
    if (outline.compound === 'dbl') {
      a.globalCompositeOperation = 'destination-out'; a.lineWidth = pen / 3; a.stroke(path);
    } else if (outline.compound === 'tri') {
      a.globalCompositeOperation = 'destination-out'; a.lineWidth = pen * 2 / 3; a.stroke(path);
      a.globalCompositeOperation = 'source-over'; a.lineWidth = pen / 3; a.stroke(path);
    } else {
      // Thick/thin proportions are 3:1:1. The gap is inward for
      // thickThin and outward for thinThick, independent of path direction.
      b.lineWidth = pen * .6; b.stroke(path);
      b.globalCompositeOperation = 'destination-out'; b.lineWidth = pen * .2; b.stroke(path);
      b.globalCompositeOperation = outline.compound === 'thickThin' ? 'destination-in' : 'destination-out'; b.fill(path);
      a.globalCompositeOperation = 'destination-out'; a.drawImage(gap, 0, 0);
    }
    if (open.length) {
      a.globalCompositeOperation = 'source-over';
      a.fill(openCompoundPath(open, outline, pen));
    }
    if (outline.dash) {
      reset(b); b.lineWidth = pen;
      b.setLineDash(drawingLineDash(outline.dash, outline.cap).map(n => n * pen)); b.stroke(dashed);
      a.globalCompositeOperation = 'destination-in'; a.drawImage(gap, 0, 0);
    }
    a.globalCompositeOperation = 'source-in'; a.fillStyle = outline.color; a.fillRect(0, 0, width, height);
    target.save(); target.resetTransform(); target.drawImage(ink, 0, 0); target.restore();
  };
}
