import { appendEllipseArc } from './cloud-geometry.js';

// Original evaluation of ECMA-376's ribbon2 preset. All coordinates below
// describe the standard's panel, tails and folded-back faces.
export function ribbonGeometry(w, h, adj1 = 16667, adj2 = 50000) {
  if (![w, h, adj1, adj2].every(Number.isFinite) || w <= 0 || h <= 0) throw new Error('Invalid ribbon geometry.');
  const a1 = Math.max(0, Math.min(33333, adj1)), a2 = Math.max(25000, Math.min(75000, adj2));
  const rx = w / 32, ry = h * a1 / 400000;
  const x2 = w / 2 - w * a2 / 200000, x9 = w - x2;
  const x3 = x2 + rx, x8 = x9 - rx, x5 = x2 + w / 8, x6 = x9 - w / 8;
  const x4 = x5 - rx, x7 = x6 + rx, x10 = w * 7 / 8;
  const y1 = h - 2 * ry, y2 = h - 4 * ry, y4 = 4 * ry;
  const y3 = (y4 + h) / 2, y6 = h - ry, y7 = y1 - ry;
  function path(fill, stroke, draw, fillMode) {
    const points = []; let x = 0, y = 0;
    const m = (a, b) => { points.push(['M', a, b]); x = a; y = b; };
    const l = (a, b) => { points.push(['L', a, b]); x = a; y = b; };
    const arc = (start, sweep) => {
      if (ry) [x, y] = appendEllipseArc(points, x, y, rx, ry, start * 60000, sweep * 60000);
      else {
        // At the adjustment limit the elliptical folds flatten into lines.
        const cosine = a => Math.round(Math.cos(a * Math.PI / 180));
        l(x + rx * (cosine(start + sweep) - cosine(start)), y);
      }
    };
    const close = () => points.push(['Z']);
    draw(m, l, arc, close);
    return { width: w, height: h, points, fill, stroke, ...(fillMode ? { fillMode } : {}) };
  }
  const body = path(true, false, (m,l,a,z) => {
    m(0,h); l(x4,h); a(90,-180); l(x3,y1); a(90,180);
    l(x8,y2); a(270,180); l(x7,y1); a(270,-180);
    l(w,h); l(x10,y3); l(w,y4); l(x9,y4); l(x9,ry); a(0,-90);
    l(x3,0); a(270,-90); l(x2,y4); l(0,y4); l(w/8,y3); z();
  });
  const folds = path(true, false, (m,l,a,z) => {
    m(x5,y6); a(0,-90); l(x3,y1); a(90,180); l(x5,y2); z();
    m(x6,y6); a(180,90); l(x8,y1); a(90,-180); l(x6,y2); z();
  }, 'darkenLess');
  const outline = path(false, true, (m,l,a,z) => {
    m(0,h); l(w/8,y3); l(0,y4); l(x2,y4); l(x2,ry); a(180,90);
    l(x8,0); a(270,90); l(x9,y4); l(w,y4); l(x10,y3); l(w,h);
    l(x7,h); a(90,180); l(x8,y1); a(90,-180); l(x3,y2);
    a(270,-180); l(x4,y1); a(270,180); z();
    m(x5,y2); l(x5,y6); m(x6,y6); l(x6,y2);
    m(x2,y7); l(x2,y4); m(x9,y4); l(x9,y7);
  });
  return { paths: [body, folds, outline], textRect: { left: x2/w, top: 0, right: x9/w, bottom: y2/h } };
}
