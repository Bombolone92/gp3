// Original implementation of ECMA-376's cloud/cloudCallout preset equations.
// Coordinates and angles below are geometry constants from the standard.
const rad = Math.PI / 10800000;
const outline = [
  [6753,9190,-11429249,7426832], [5333,7267,-8646143,5396714],
  [4365,5945,-8748475,5983381], [4857,6595,-7859164,7034504],
  [5333,7273,-4722533,6541615], [6775,9220,-2776035,7816140],
  [5785,7867,37501,6842000], [6752,9215,1347096,6910353],
  [7720,10543,3974558,4542661], [4360,5918,-16496525,8804134],
  [4345,5945,-14809710,9151131],
];
const details = [
  [4693,26177,4345,5945,5204520,1585770], [6928,34899,4360,5918,4416628,686848],
  [16478,39090,6752,9215,8257449,844866], [28827,34751,6752,9215,387196,959901],
  [34129,22954,5785,7867,-4217541,4255042], [41798,15354,5333,7273,1819082,1665090],
  [38324,5426,4857,6595,-824660,891534], [29078,3952,4857,6595,-8950887,1091722],
  [22141,4720,4365,5945,-9809656,1061181], [14000,5192,6753,9190,-4002417,739161],
  [4127,15789,6753,9190,9459261,711490],
];

// DrawingML angles describe rays from an ellipse's center, not the ellipse's
// parametric angle. Convert before creating cubic segments (at most 45 degrees).
export function appendEllipseArc(points, x, y, rx, ry, start, sweep) {
  if (![x,y,rx,ry,start,sweep].every(Number.isFinite) || rx <= 0 || ry <= 0 || Math.abs(sweep) > 21600000) throw new Error('Invalid ellipse arc.');
  const parameter = a => Math.atan2(rx * Math.sin(a), ry * Math.cos(a));
  const a = parameter(start * rad);
  let delta = parameter((start + sweep) * rad) - a;
  if (sweep > 0 && delta <= 0) delta += 2 * Math.PI;
  if (sweep < 0 && delta >= 0) delta -= 2 * Math.PI;
  if (!sweep) return [x, y];
  if (Math.abs(sweep) === 21600000) delta = Math.sign(sweep) * 2 * Math.PI;
  const cx = x - rx * Math.cos(a), cy = y - ry * Math.sin(a);
  const count = Math.ceil(Math.abs(delta) / (Math.PI / 4));
  for (let i = 0; i < count; i++) {
    const from = a + delta * i / count, to = a + delta * (i + 1) / count;
    const k = 4 / 3 * Math.tan((to - from) / 4);
    x = cx + rx * Math.cos(to); y = cy + ry * Math.sin(to);
    points.push(['C', cx + rx * (Math.cos(from) - k * Math.sin(from)),
      cy + ry * (Math.sin(from) + k * Math.cos(from)),
      x + rx * k * Math.sin(to), y - ry * k * Math.cos(to), x, y]);
  }
  return [x, y];
}

export function cloudGeometry(width, height, callout, adj1 = -20833, adj2 = 62500) {
  if (![width,height,adj1,adj2].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error('Invalid cloud geometry.');
  const body = [['M',3900,14370]]; let position = [3900,14370];
  for (const arc of outline) position = appendEllipseArc(body, ...position, ...arc);
  body.push(['Z']);
  const paths = [{ width:43200, height:43200, points:body, fill:true, stroke:true }];
  if (callout) {
    const dx = width * adj1 / 100000, dy = height * adj2 / 100000;
    const tipX = width / 2 + dx, tipY = height / 2 + dy;
    const theta = Math.atan2(width * dy, height * dx);
    const vx = width / 2 * Math.cos(theta) - dx, vy = height / 2 * Math.sin(theta) - dy;
    const distance = Math.hypot(vx,vy), ss = Math.min(width,height);
    if (!distance) throw new Error('Degenerate cloud callout position.');
    const gap = (distance - ss * 6600 / 21600) / 3;
    for (const [radius, offset] of [[ss*600/21600,0], [ss*1200/21600,gap+ss*1800/21600], [ss*1800/21600,2*gap+ss*4800/21600]]) {
      const x = tipX + offset * vx / distance, y = tipY + offset * vy / distance;
      const points = [['M',x+radius,y]];
      appendEllipseArc(points,x+radius,y,radius,radius,0,21600000); points.push(['Z']);
      paths.push({width,height,points,fill:true,stroke:true});
    }
  }
  const strokes = [];
  for (const [x,y,...arc] of details) { strokes.push(['M',x,y]); appendEllipseArc(strokes,x,y,...arc); }
  paths.push({width:43200,height:43200,points:strokes,fill:false,stroke:true});
  // All preset fills paint before the strokes, including overlapping
  // bubbles. Keep that order explicit in the immutable drawing scene.
  const painted = [...paths.filter(p => p.fill).map(p => ({...p,stroke:false})),
    ...paths.map(p => ({...p,fill:false}))];
  return {paths:painted,textRect:{left:2977/21600,top:3262/21600,right:17087/21600,bottom:17337/21600}};
}
