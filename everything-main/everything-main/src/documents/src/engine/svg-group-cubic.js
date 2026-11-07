// Original bounded cubic subdivision and half-open 8x4 coverage for solid SVG groups.
// Native controls verify the supported intrinsic-coordinate subset; source SVG stays intact.
const SCALE = 262144;
const snap = value => Math.ceil(Math.fround(value) * 16) / 16;
const half = value => Math.floor(value / 2);

export function flattenSvgGroupCubic(input) {
  if (input.length !== 4 || input.some(point => point.length !== 2 || point.some(value => !Number.isFinite(value) || Math.abs(value) > 1e7))) return null;
  const p = input.map(point => point.map(value => snap(value) * SCALE));
  let position = [...p[0]], delta = p[3].map((v, k) => v - p[0][k]);
  let e2 = p[0].map((v, k) => 3 * (v - 2 * p[1][k] + p[2][k]));
  let e3 = p[1].map((v, k) => 3 * (v - 2 * p[2][k] + p[3][k]));
  let t = 0, step = 1;
  const result = [position.map(v => v / SCALE)];
  const error = (a, b) => Math.max(...a.map(Math.abs), ...b.map(Math.abs));
  const threshold = 196608;
  while (t < 1) {
    while (error(e2, e3) > threshold) {
      e3 = e2.map((v, k) => Math.floor((v + e3[k]) / 8));
      delta = delta.map((v, k) => half(v) - e3[k]);
      e2 = e2.map(v => Math.floor(v / 4));
      step /= 2;
      if (step < 1 / 65536) return null;
    }
    while (step < 1 && t % (2 * step) === 0 && t + 2 * step <= 1) {
      const next2 = e2.map(v => 4 * v), next3 = e3.map((v, k) => 8 * v - 4 * e2[k]);
      if (error(next2, next3) > threshold) break;
      delta = delta.map((v, k) => 2 * v + 2 * e3[k]);
      e2 = next2; e3 = next3; step *= 2;
    }
    position = position.map((v, k) => v + delta[k]);
    delta = delta.map((v, k) => v + 2 * e3[k]);
    [e2, e3] = [e3, e3.map((v, k) => 2 * v - e2[k])];
    t += step;
    result.push(position.map(v => Math.floor(v / 16384 + .5) / 16));
    if (result.length > 4096) return null;
  }
  return result;
}


export function svgGroupCubicContours(d) {
 const token=/[MLCZ]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g;
 if(d.replace(token,'').replace(/[\s,]/g,'')||!d.includes('C'))return null;
 const tokens=d.match(token)||[];
 if(tokens.length>16384)return null;
 const contours=[];let at=0,current=null,contour=null,command=null,points=0;
 while(at<tokens.length){
  if(/^[MLCZ]$/.test(tokens[at]))command=tokens[at++];
  if(!command||command!=='M'&&!current)return null;
  if(command==='Z'){current=null;command=null;continue;}
  const count={M:2,L:2,C:6}[command];
  if(at+count>tokens.length)return null;
  const values=tokens.slice(at,at+count).map(Number);at+=count;
  if(!values.every(Number.isFinite))return null;
  if(command==='M'){
   current=values;contour=[current.map(snap)];contours.push(contour);command='L';points++;
  }else if(command==='L'){
   current=values;contour.push(current.map(snap));points++;
  }else{
   const end=values.slice(4),flat=flattenSvgGroupCubic([current,values.slice(0,2),values.slice(2,4),end]);
   if(!flat)return null;
   contour.push(...flat.slice(1));points+=flat.length-1;current=end;
  }
  if(points>4096)return null;
 }
 return contours;
}
export function svgGroupCoverageCounts(contours, box, rule = 'nonzero') {
  const {x: originX, y: originY, width, height} = box;
  const counts = new Uint8Array(width * height);
  const edges = contours.flatMap(points => points.map((a, n) => [a, points[(n + 1) % points.length]]));
  for (let row = 0; row < height; row++) for (let sy = 0; sy < 4; sy++) {
    const y = originY + row + sy / 4, events = [];
    for (const [a, b] of edges) {
      if (a[1] <= y && y < b[1]) events.push([a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]), 1]);
      else if (b[1] <= y && y < a[1]) events.push([a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]), -1]);
    }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let winding = 0, start;
    for (const [x, change] of events) {
      const before = rule === 'evenodd' ? Math.abs(winding) % 2 : winding !== 0;
      winding += change;
      const after = rule === 'evenodd' ? Math.abs(winding) % 2 : winding !== 0;
      if (!before && after) start = x;
      else if (before && !after) {
        const left = Math.max(0, Math.ceil((start - originX) * 8));
        const right = Math.min(width * 8, Math.ceil((x - originX) * 8));
        if (right <= left) continue;
        const first = Math.floor(left / 8), last = Math.floor((right - 1) / 8), offset = row * width;
        if (first === last) counts[offset + first] += right - left;
        else {
          counts[offset + first] += 8 - left % 8;
          counts[offset + last] += (right - 1) % 8 + 1;
          for (let column = first + 1; column < last; column++) counts[offset + column] += 8;
        }
      }
    }
  }
  return counts;
}
