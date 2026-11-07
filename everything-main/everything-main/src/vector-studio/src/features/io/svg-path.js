/**
 * SVG path data: a tolerant parser that turns any `d` string into anchor
 * lists (all commands, quadratics and elliptical arcs converted to cubics),
 * and a writer that emits compact path data from anchor lists.
 *
 * Subpaths are { anchors, closed } with anchors in the model format
 * { x, y, ix, iy, ox, oy } (absolute coordinates, handles equal to the
 * anchor when retracted).
 */
import { segmentCount, segmentPoints, isLine } from '../../model/bezier.js';

const ARG_COUNT = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** Split path data into [command, numbers] pairs. Stops at the first malformed token (like browsers). */
export function tokenizePath(d) {
  const out = [];
  const s = String(d || '');
  let i = 0;
  const n = s.length;
  let cmd = null;
  let args = [];
  const isSep = (c) => c === ' ' || c === ',' || c === '\n' || c === '\r' || c === '\t' || c === '\f';
  const readNumber = () => {
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i, i + 64));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const readFlag = () => {
    while (i < n && isSep(s[i])) i++;
    const c = s[i];
    if (c === '0' || c === '1') {
      i++;
      return c === '1' ? 1 : 0;
    }
    return null;
  };
  const flush = () => {
    if (cmd) out.push([cmd, args]);
    args = [];
  };
  while (i < n) {
    const c = s[i];
    if (isSep(c)) {
      i++;
      continue;
    }
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(c)) {
      flush();
      cmd = c;
      i++;
      continue;
    }
    if (!cmd) break;
    const lc = cmd.toLowerCase();
    if (lc === 'z') break; // numbers after Z without a command are an error
    // Arc flags may be written without separators ("a1 1 0 01 5 5").
    if (lc === 'a') {
      const k = args.length % 7;
      if (k === 3 || k === 4) {
        const f = readFlag();
        if (f === null) break;
        args.push(f);
        continue;
      }
    }
    const v = readNumber();
    if (v === null || !Number.isFinite(v)) break;
    args.push(v);
  }
  flush();
  return out;
}

/** Convert an SVG elliptical arc to cubic segments: returns arrays [c1x, c1y, c2x, c2y, x, y]. */
export function arcToCubics(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  let num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  if (num < 0) num = 0;
  let coef = Math.sqrt(num / (rx2 * y1p * y1p + ry2 * x1p * x1p));
  if (Boolean(largeArc) === Boolean(sweep)) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta1 = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, vx, vy);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / segs;
  const k = (4 / 3) * Math.tan(step / 4);
  const out = [];
  let t = theta1;
  const pt = (a) => {
    const ex = rx * Math.cos(a);
    const ey = ry * Math.sin(a);
    return [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy];
  };
  const deriv = (a) => {
    const ex = -rx * Math.sin(a);
    const ey = ry * Math.cos(a);
    return [cos * ex - sin * ey, sin * ex + cos * ey];
  };
  for (let i = 0; i < segs; i++) {
    const t2 = t + step;
    const p1 = pt(t);
    const p2 = i === segs - 1 ? [x2, y2] : pt(t2);
    const d1 = deriv(t);
    const d2 = deriv(t2);
    out.push([p1[0] + k * d1[0], p1[1] + k * d1[1], p2[0] - k * d2[0], p2[1] - k * d2[1], p2[0], p2[1]]);
    t = t2;
  }
  return out;
}

const EPS = 1e-6;

/**
 * Parse path data into subpaths. Malformed data keeps everything parsed up
 * to the error (SVG error handling), never throws.
 */
export function parsePathData(d) {
  const tokens = tokenizePath(d);
  const subpaths = [];
  let cur = null; // { anchors, closed }
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastC = null; // reflected control for S
  let lastQ = null; // control for T
  let prevCmd = '';
  const start = (px, py) => {
    cur = { anchors: [{ x: px, y: py, ix: px, iy: py, ox: px, oy: py }], closed: false };
    subpaths.push(cur);
  };
  const ensure = () => {
    if (!cur) start(x, y);
  };
  const cubic = (c1x, c1y, c2x, c2y, px, py) => {
    ensure();
    const last = cur.anchors[cur.anchors.length - 1];
    cur.anchors[cur.anchors.length - 1] = { ...last, ox: c1x, oy: c1y };
    cur.anchors.push({ x: px, y: py, ix: c2x, iy: c2y, ox: px, oy: py });
    x = px;
    y = py;
  };
  const line = (px, py) => cubic(x, y, px, py, px, py);
  for (const [cmd, args] of tokens) {
    const lc = cmd.toLowerCase();
    const rel = cmd !== cmd.toUpperCase();
    const count = ARG_COUNT[lc];
    if (lc === 'z') {
      if (cur) {
        closeSubpath(cur);
        x = sx;
        y = sy;
        cur = null;
      }
      lastC = lastQ = null;
      prevCmd = 'z';
      continue;
    }
    const groups = Math.floor(args.length / count);
    if (!groups) continue;
    for (let g = 0; g < groups; g++) {
      const a = args.slice(g * count, g * count + count);
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      let ctype = lc;
      if (lc === 'm' && g > 0) ctype = 'l';
      switch (ctype) {
        case 'm':
          x = a[0] + ox;
          y = a[1] + oy;
          sx = x;
          sy = y;
          start(x, y);
          lastC = lastQ = null;
          break;
        case 'l':
          line(a[0] + ox, a[1] + oy);
          lastC = lastQ = null;
          break;
        case 'h':
          line(a[0] + (rel ? x : 0), y);
          lastC = lastQ = null;
          break;
        case 'v':
          line(x, a[0] + (rel ? y : 0));
          lastC = lastQ = null;
          break;
        case 'c':
          cubic(a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, a[4] + ox, a[5] + oy);
          lastC = [a[2] + ox, a[3] + oy];
          lastQ = null;
          break;
        case 's': {
          const c1 = lastC && 'cs'.includes(prevCmd) ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
          cubic(c1[0], c1[1], a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy);
          lastC = [a[0] + ox, a[1] + oy];
          lastQ = null;
          break;
        }
        case 'q': {
          const qx = a[0] + ox;
          const qy = a[1] + oy;
          const px = a[2] + ox;
          const py = a[3] + oy;
          cubic(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), px + (2 / 3) * (qx - px), py + (2 / 3) * (qy - py), px, py);
          lastQ = [qx, qy];
          lastC = null;
          break;
        }
        case 't': {
          const q = lastQ && 'qt'.includes(prevCmd) ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
          const px = a[0] + ox;
          const py = a[1] + oy;
          cubic(x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y), px + (2 / 3) * (q[0] - px), py + (2 / 3) * (q[1] - py), px, py);
          lastQ = q;
          lastC = null;
          break;
        }
        case 'a': {
          const px = a[5] + ox;
          const py = a[6] + oy;
          const segs = arcToCubics(x, y, a[0], a[1], a[2], a[3], a[4], px, py);
          for (const s of segs) cubic(s[0], s[1], s[2], s[3], s[4], s[5]);
          lastC = lastQ = null;
          break;
        }
        default:
          break;
      }
      prevCmd = ctype;
    }
  }
  return subpaths.filter((sp) => sp.anchors.length > 1 || sp.closed);
}

/** Close a subpath: merge a final anchor that lands on the start into the first one. */
function closeSubpath(sp) {
  const a = sp.anchors;
  if (a.length > 1) {
    const first = a[0];
    const last = a[a.length - 1];
    if (Math.abs(first.x - last.x) < EPS && Math.abs(first.y - last.y) < EPS) {
      a[0] = { ...first, ix: last.ix, iy: last.iy };
      a.pop();
    }
  }
  sp.closed = true;
}

// ---------------------------------------------------------------- writer

/** Number formatter with a fixed number of decimals, trailing zeros removed. */
export function numberFormatter(precision = 3, minify = false) {
  const p = Math.max(0, Math.min(8, precision | 0));
  const f = 10 ** p;
  return (v) => {
    let r = Math.round(v * f) / f;
    if (Object.is(r, -0) || Math.abs(r) < 0.5 / f) r = 0;
    let s = r.toFixed(p);
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (minify) s = s.replace(/^(-?)0\./, '$1.');
    return s;
  };
}

/** Join numbers with the fewest separators (minify) or single spaces. */
function joinNums(nums, minify) {
  if (!minify) return nums.join(' ');
  let out = '';
  let prev = '';
  for (const s of nums) {
    if (!out) out = s;
    else if (s[0] === '-' || (s[0] === '.' && prev.includes('.'))) out += s;
    else out += ' ' + s;
    prev = s;
  }
  return out;
}

/**
 * Path data for subpaths [{ anchors, closed }]. Options: precision,
 * minify (relative commands when shorter, implicit separators), and a
 * `map(x, y)` applied to every point (e.g. moving the artboard to 0,0).
 */
export function pathDataFromSubpaths(subpaths, { precision = 3, minify = false, map = null } = {}) {
  const fmt = numberFormatter(precision, minify);
  const q = (v) => Number(fmt(v));
  const parts = [];
  let cx = 0;
  let cy = 0;
  let lastCmd = '';
  let lastNum = '';
  const emit = (cmdAbs, absNums, relNums) => {
    // absNums / relNums are already-rounded numbers.
    let nums = absNums.map(fmt);
    let cmd = cmdAbs;
    let body = joinNums(nums, minify);
    if (minify && relNums) {
      const rn = relNums.map(fmt);
      const rb = joinNums(rn, minify);
      if (rb.length < body.length) {
        cmd = cmdAbs.toLowerCase();
        body = rb;
        nums = rn;
      }
    }
    if (minify && cmd === lastCmd && cmd !== 'M' && cmd !== 'm') {
      // A leading "." only separates itself after a number that already has a decimal point.
      const sep = body[0] === '-' || (body[0] === '.' && lastNum.includes('.')) ? '' : ' ';
      parts.push(sep + body);
    } else parts.push((minify ? '' : parts.length ? ' ' : '') + cmd + (minify ? '' : body ? ' ' : '') + body);
    lastCmd = cmd === 'M' ? 'L' : cmd === 'm' ? 'l' : cmd;
    lastNum = nums[nums.length - 1] || '';
  };
  for (const sp of subpaths) {
    const anchors = map ? sp.anchors.map((p) => mapAnchor(p, map)) : sp.anchors;
    if (!anchors.length) continue;
    const x0 = q(anchors[0].x);
    const y0 = q(anchors[0].y);
    emit('M', [x0, y0], parts.length ? [x0 - cx, y0 - cy] : null);
    cx = x0;
    cy = y0;
    const n = segmentCount(anchors, sp.closed);
    for (let i = 0; i < n; i++) {
      const c = segmentPoints(anchors, i);
      const closing = sp.closed && i === n - 1;
      const ex = q(c[6]);
      const ey = q(c[7]);
      if (isLine(c)) {
        if (closing) break; // Z draws the closing line
        if (ey === cy && ex !== cx) emit('H', [ex], [ex - cx]);
        else if (ex === cx && ey !== cy) emit('V', [ey], [ey - cy]);
        else if (ex === cx && ey === cy) emit('L', [ex, ey], [0, 0]);
        else emit('L', [ex, ey], [ex - cx, ey - cy]);
      } else {
        const c1x = q(c[2]);
        const c1y = q(c[3]);
        const c2x = q(c[4]);
        const c2y = q(c[5]);
        emit('C', [c1x, c1y, c2x, c2y, ex, ey], [c1x - cx, c1y - cy, c2x - cx, c2y - cy, ex - cx, ey - cy]);
      }
      cx = ex;
      cy = ey;
    }
    if (sp.closed) {
      parts.push(minify ? 'z' : ' Z');
      lastCmd = 'z';
      cx = x0;
      cy = y0;
    }
  }
  return parts.join('').trim();
}

function mapAnchor(p, map) {
  const a = map(p.x, p.y);
  const i = map(p.ix, p.iy);
  const o = map(p.ox, p.oy);
  return { x: a.x, y: a.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y };
}
