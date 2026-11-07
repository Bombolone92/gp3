import { shapePathScale } from './shape-path-scale.js';
import { closedOutlinePath } from './compound-outlines.js';

const size = {sm:2, med:3, lg:5};
// Native reference controls establish a 2pt plateau, reciprocal sizing below
// .24pt, and a separate .24pt base for an explicitly zero-width pen.
export function ovalMarkerRadii(end, pen) {
  const points = pen / 12700;
  const base = (points === 0 ? .24 : Math.max(points, 2, .48 / points)) * 12700 / 2;
  return [base * size[end.length || 'med'], base * size[end.width || 'med']];
}
// Native reference controls (tests/fixtures/arrowheads) fix every marker to the oval's base b and the
// sm/med/lg sizes: a triangle is 2b·len long and b·w half-wide and the line stops b short of its base;
// a stealth adds a notch b·{2,2,4} in front of the base where the line stops; a diamond is centred on
// the end, b·len and b·w from it, as an oval is; an arrow is an open V of pen-width arms b·{4,6,9}
// long and b·{2.5,3.5,5} half-wide whose outer miter meets the end, and the line stops at its apex.
const markerBase = pen => { const points = pen / 12700; return (points === 0 ? .24 : Math.max(points, 2, .48 / points)) * 12700 / 2; };
const stealthNotch = { sm: 2, med: 2, lg: 4 }, arrowLength = { sm: 4, med: 6, lg: 9 }, arrowWidth = { sm: 2.5, med: 3.5, lg: 5 };
export function markerGeometry(end, pen, strokeWidth = pen) {
  const b = markerBase(pen), len = size[end.length || 'med'], wide = size[end.width || 'med'];
  if (end.type === 'triangle' || end.type === 'stealth') {
    const length = 2 * b * len, half = b * wide;
    const notch = end.type === 'stealth' ? length - b * stealthNotch[end.length || 'med'] : length;
    return { type: end.type, polygon: [[0, 0], [-length, half], [-notch, 0], [-length, -half]], stop: end.type === 'stealth' ? notch : length - b, extent: Math.hypot(length, half) };
  }
  if (end.type === 'diamond') {
    const along = b * len, half = b * wide;
    return { type: 'diamond', polygon: [[along, 0], [0, half], [-along, 0], [0, -half]], stop: 0, extent: Math.max(along, half) };
  }
  if (end.type === 'arrow') {
    const length = b * arrowLength[end.length || 'med'], half = b * arrowWidth[end.width || 'med'];
    const apex = strokeWidth / 2 / Math.sin(Math.atan2(half, length));
    return { type: 'arrow', arms: [[-apex - length, half], [-apex, 0], [-apex - length, -half]], width: strokeWidth, stop: apex, extent: Math.hypot(apex + length, half) + strokeWidth / 2 };
  }
  const [rx, ry] = ovalMarkerRadii(end, pen);
  return { type: 'oval', radii: [rx, ry], stop: 0, extent: Math.max(rx, ry) };
}
export function outlinePadding(outline, joins = true, path) {
  if (!outline) return 0;
  let edge = outline.width / 2 * Math.max(outline.cap === 'sq' ? Math.SQRT2 : 1, joins && outline.join === 'miter' ? outline.miterLimit : 1);
  if (path && (outline.headEnd || outline.tailEnd) && closedOutlinePath(path)) return edge;
  for (const name of ['headEnd', 'tailEnd']) if (outline[name]) edge = Math.max(edge, markerGeometry(outline[name], outline.declaredWidth ?? outline.width, outline.width).extent);
  return edge;
}

// Directed tangents for each open subpath, after the physical transform.
// Repeated endpoints/control points use the first surviving derivative.
export function pathLineEnds(path, width, height, matrix, outline, pixelsPerEMU = 1) {
  const sx = shapePathScale(width, path.width), sy = shapePathScale(height, path.height);
  const point = (x,y) => [matrix.a*x*sx+matrix.c*y*sy+matrix.e, matrix.b*x*sx+matrix.d*y*sy+matrix.f];
  const result = [];
  let start, current, first, last, closed = false, segments = [];
  const vector = (a,b) => [b[0]-a[0], b[1]-a[1]];
  const nonzero = v => v[0] !== 0 || v[1] !== 0;
  const flush = () => {
    if (!closed && first && last) {
      const direction = (name,origin,backwards,fallback) => {
        if (!outline?.[name] || !segments.some(s=>s.length>2)) return fallback;
        const radius=ovalMarkerRadii(outline[name],outline.declaredWidth ?? outline.width)[0]*pixelsPerEMU;
        const ordered=backwards ? [...segments].reverse().map(s=>[...s].reverse()) : segments;
        for (const segment of ordered) {
          const exit=circleExit(segment,origin,radius);
          if (exit) return backwards ? vector(exit,origin) : vector(origin,exit);
        }
        const end=ordered.at(-1).at(-1),v=backwards ? vector(end,origin) : vector(origin,end);
        return nonzero(v) ? v : fallback;
      };
      result.push({head:{point:start,vector:direction('headEnd',start,false,first)},tail:{point:current,vector:direction('tailEnd',current,true,last)}});
    }
  };
  for (const command of path.points) {
    const op = command[0];
    if (op === 'M') { flush(); start = current = point(command[1],command[2]); first = last = null; closed = false; segments = []; }
    else if (op === 'Z' || op === 'E') { closed = true; current = start; }
    else if (current) {
      const points = [];
      for (let i=1;i<command.length;i+=2) points.push(point(command[i],command[i+1]));
      const end = points.at(-1);
      segments.push([current,...points]);
      first ||= points.map(p=>vector(current,p)).find(nonzero);
      last = [...points.slice(0,-1).reverse(),current].map(p=>vector(p,end)).find(nonzero) || last;
      current = end;
    }
  }
  flush(); return result;
}

// Curved-path markers aim along the chord reaching half the marker's
// length from its endpoint. Convex-hull rejection and de Casteljau subdivision
// find the first circle crossing without assuming monotonic curve coordinates.
function circleExit(points, origin, radius, depth = 0) {
  const distance = p => Math.hypot(p[0]-origin[0],p[1]-origin[1]);
  if (points.every(p=>distance(p)<=radius)) return null;
  if (points.length === 2 || depth >= 24) {
    const a=points[0],b=points.at(-1),dx=b[0]-a[0],dy=b[1]-a[1],x=a[0]-origin[0],y=a[1]-origin[1];
    const aa=dx*dx+dy*dy,bb=2*(x*dx+y*dy),cc=x*x+y*y-radius*radius,disc=bb*bb-4*aa*cc;
    if (!aa || disc<0) return null;
    const t=(-bb+Math.sqrt(disc))/(2*aa);
    return t>=0 && t<=1 ? [a[0]+t*dx,a[1]+t*dy] : null;
  }
  let level=points;const left=[points[0]],right=[points.at(-1)];
  while(level.length>1){level=level.slice(1).map((p,i)=>[(level[i][0]+p[0])/2,(level[i][1]+p[1])/2]);left.push(level[0]);right.unshift(level.at(-1));}
  return circleExit(left,origin,radius,depth+1) || circleExit(right,origin,radius,depth+1);
}

// Composite stroke and markers once, as one filled outline.
// This prevents darker overlaps when the retained line paint is translucent.
export function markedOutlinePainter(width,height) {
  const surface=new OffscreenCanvas(width,height),ink=surface.getContext('2d');
  return (target,color,draw) => {
    ink.resetTransform();ink.globalCompositeOperation='source-over';ink.clearRect(0,0,width,height);
    draw(ink);
    ink.resetTransform();ink.globalCompositeOperation='source-in';ink.fillStyle=color;ink.fillRect(0,0,width,height);
    target.save();target.resetTransform();target.drawImage(surface,0,0);target.restore();
  };
}

// Each end's outward direction: a head's vector points into the path, a tail's out of it.
const outward = (end, key) => { const [x, y] = end.vector, n = Math.hypot(x, y) || 1; return key === 'head' ? [-x / n, -y / n] : [x / n, y / n]; };

/** Erase the stroke beyond where the line ends under a marker (triangle, stealth and arrow ends). */
export function trimLineEnds(ctx, outline, ends, pixelsPerEMU) {
  ctx.save(); ctx.resetTransform(); ctx.globalCompositeOperation = 'destination-out';
  for (const pair of ends) for (const [name, key] of [['headEnd', 'head'], ['tailEnd', 'tail']]) {
    const marker = outline[name], end = pair[key];
    if (!marker || !end) continue;
    const g = markerGeometry(marker, outline.declaredWidth ?? outline.width, outline.width);
    if (!g.stop) continue;
    const [ux, uy] = outward(end, key), reach = (outline.width * 2 + g.stop) * pixelsPerEMU, half = outline.width * pixelsPerEMU;
    ctx.setTransform(ux, uy, -uy, ux, end.point[0], end.point[1]);
    ctx.fillRect(-g.stop * pixelsPerEMU, -half, reach, half * 2);
  }
  ctx.restore();
}

export function paintLineEnds(ctx, outline, ends, pixelsPerEMU) {
  if (!outline?.headEnd && !outline?.tailEnd) return;
  ctx.save(); ctx.resetTransform(); ctx.fillStyle = outline.color; ctx.strokeStyle = outline.color;
  for (const pair of ends) for (const [name,key] of [['headEnd','head'],['tailEnd','tail']]) {
    const marker = outline[name], end = pair[key];
    if (!marker || !end) continue;
    const g = markerGeometry(marker, outline.declaredWidth ?? outline.width, outline.width);
    if (g.type === 'oval') {
      const [rx,ry] = g.radii;
      ctx.beginPath(); ctx.ellipse(...end.point,rx*pixelsPerEMU,ry*pixelsPerEMU,Math.atan2(end.vector[1],end.vector[0]),0,2*Math.PI); ctx.fill();
      continue;
    }
    const [ux, uy] = outward(end, key);
    ctx.setTransform(ux, uy, -uy, ux, end.point[0], end.point[1]);
    ctx.beginPath();
    const points = g.polygon || g.arms;
    points.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x * pixelsPerEMU, y * pixelsPerEMU));
    if (g.arms) { ctx.lineWidth = g.width * pixelsPerEMU; ctx.lineCap = 'round'; ctx.lineJoin = 'miter'; ctx.miterLimit = 10; ctx.stroke(); }
    else { ctx.closePath(); ctx.fill(); }
    ctx.resetTransform();
  }
  ctx.restore();
}
