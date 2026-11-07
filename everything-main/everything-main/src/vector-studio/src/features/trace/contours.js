/**
 * Shared region boundaries for tracing.
 *
 * Boundaries run along pixel edges on the (w+1) x (h+1) lattice of pixel
 * corners. A lattice point where three or more regions meet (or two meet
 * diagonally) is a junction. The boundary splits into chains: runs of
 * edges between junctions, or closed loops with none. Every chain
 * separates exactly two regions (or a region and the outside), so it is
 * simplified and fitted once and both regions use that same curve, one of
 * them reversed. Neighboring shapes therefore meet exactly, with no gaps
 * or overlaps, whatever the fitting tolerance.
 *
 * Directions: 0 east, 1 south, 2 west, 3 north (y points down).
 * Each region's contours keep the region on their left, which makes outer
 * contours run counterclockwise on screen (negative shoelace area) and
 * holes clockwise.
 */

export const OUTSIDE = -2;
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

export function buildChains(region, w, h) {
  const W1 = w + 1;
  const reg = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? OUTSIDE : region[y * w + x]);
  // Pixels left and right of the edge leaving lattice point (x, y) in direction d.
  const leftOf = (x, y, d) => (d === 0 ? reg(x, y - 1) : d === 1 ? reg(x, y) : d === 2 ? reg(x - 1, y) : reg(x - 1, y - 1));
  const rightOf = (x, y, d) => (d === 0 ? reg(x, y) : d === 1 ? reg(x - 1, y) : d === 2 ? reg(x - 1, y - 1) : reg(x, y - 1));
  const inLattice = (x, y, d) => {
    const nx = x + DX[d];
    const ny = y + DY[d];
    return nx >= 0 && ny >= 0 && nx <= w && ny <= h;
  };
  const isEdge = (x, y, d) => inLattice(x, y, d) && leftOf(x, y, d) !== rightOf(x, y, d);
  const HCOUNT = w * (h + 1);
  const edgeId = (x, y, d) => (d === 0 ? y * w + x : d === 2 ? y * w + x - 1 : d === 1 ? HCOUNT + y * W1 + x : HCOUNT + (y - 1) * W1 + x);
  const edgeChain = new Int32Array(HCOUNT + W1 * h).fill(-1);
  const degree = (x, y) => isEdge(x, y, 0) + isEdge(x, y, 1) + isEdge(x, y, 2) + isEdge(x, y, 3);
  const junction = new Uint8Array(W1 * (h + 1));
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) if (degree(x, y) > 2) junction[y * W1 + x] = 1;

  const chains = [];
  const walk = (x0, y0, d0) => {
    const id = chains.length;
    const pts = [x0, y0];
    let x = x0;
    let y = y0;
    let d = d0;
    const left = leftOf(x0, y0, d0);
    const right = rightOf(x0, y0, d0);
    for (;;) {
      edgeChain[edgeId(x, y, d)] = id;
      x += DX[d];
      y += DY[d];
      pts.push(x, y);
      if (junction[y * W1 + x] || (x === x0 && y === y0)) break;
      // Degree-2 point: continue along the other edge.
      const back = (d + 2) & 3;
      let next = -1;
      for (let k = 0; k < 4; k++) if (k !== back && isEdge(x, y, k)) next = k;
      d = next;
    }
    const closed = x === x0 && y === y0 && !junction[y0 * W1 + x0];
    chains.push({ id, pts, left, right, closed, sx: x0, sy: y0, d0, ex: x, ey: y, d1: d });
  };
  for (let y = 0; y <= h; y++) {
    for (let x = 0; x <= w; x++) {
      if (!junction[y * W1 + x]) continue;
      for (let d = 0; d < 4; d++) if (isEdge(x, y, d) && edgeChain[edgeId(x, y, d)] === -1) walk(x, y, d);
    }
  }
  // Closed loops without junctions (islands): start at their top-left edge.
  for (let y = 0; y <= h; y++) {
    for (let x = 0; x < w; x++) {
      if (isEdge(x, y, 0) && edgeChain[edgeId(x, y, 0)] === -1) walk(x, y, 0);
    }
  }
  return { chains, edgeChain, edgeId, leftOf, rightOf, isEdge, w, h };
}

/**
 * Contours of every region as cycles of half-chains. Returns an array
 * (index = region id) of contour lists; each contour is
 * [{ chain, forward }] in order, keeping the region on the left.
 */
export function regionContours(graph, regionCount) {
  const { chains, edgeChain, edgeId, leftOf, rightOf, isEdge } = graph;
  const out = Array.from({ length: regionCount }, () => []);
  const used = new Uint8Array(chains.length * 2);
  const half = (c, fwd) => c * 2 + (fwd ? 0 : 1);
  for (const c of chains) {
    for (const fwd of [true, false]) {
      if (used[half(c.id, fwd)]) continue;
      const R = fwd ? c.left : c.right;
      if (R === OUTSIDE) {
        used[half(c.id, fwd)] = 1;
        continue;
      }
      const cycle = [];
      let cur = c;
      let f = fwd;
      for (let guard = 0; guard <= chains.length * 2; guard++) {
        used[half(cur.id, f)] = 1;
        cycle.push({ chain: cur.id, forward: f });
        // End point and arrival direction of this half-chain.
        const x = f ? cur.ex : cur.sx;
        const y = f ? cur.ey : cur.sy;
        const d = f ? cur.d1 : (cur.d0 + 2) & 3;
        // Keep R on the left: try a left turn, then straight on, then a right turn.
        let nd = -1;
        for (const k of [(d + 3) & 3, d, (d + 1) & 3]) {
          if (isEdge(x, y, k) && leftOf(x, y, k) === R && rightOf(x, y, k) !== R) {
            nd = k;
            break;
          }
        }
        if (nd === -1) break;
        const next = chains[edgeChain[edgeId(x, y, nd)]];
        const nf = next.sx === x && next.sy === y && next.d0 === nd;
        if (next.id === c.id && nf === fwd) break;
        if (used[half(next.id, nf)]) break;
        cur = next;
        f = nf;
      }
      out[R].push(cycle);
    }
  }
  return out;
}

/** Signed shoelace area of a lattice contour (negative for outer contours). */
export function contourArea(graph, cycle) {
  let a = 0;
  for (const { chain, forward } of cycle) {
    const p = graph.chains[chain].pts;
    const n = p.length / 2;
    for (let i = 0; i < n - 1; i++) {
      const j = forward ? i : n - 1 - i;
      const k = forward ? i + 1 : n - 2 - i;
      a += p[j * 2] * p[k * 2 + 1] - p[k * 2] * p[j * 2 + 1];
    }
  }
  return a / 2;
}
