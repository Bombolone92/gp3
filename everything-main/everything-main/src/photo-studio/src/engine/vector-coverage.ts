// Integrate filled scanline spans over pixel areas. Unlike multisampling or a
// mean-winding fold, this also handles several nested boundaries in one pixel.
// Curve flattening has a geometric error bound below byte coverage precision;
// original editable curves never pass through this disposable representation.
type Edge = {
  x: number;
  y: number;
  end: number;
  slope: number;
  winding: number;
};
const flatness = 1 / (255 * 16);
const segmentBudget = 1_000_000;
export function vectorCoverage(
  commands: number[][],
  width: number,
  height: number,
  rule: CanvasFillRule,
): Float32Array {
  const edges: Edge[] = [];
  let x = 0,
    y = 0,
    startX = 0,
    startY = 0,
    segments = 0,
    contour = false;
  const line = (ex: number, ey: number) => {
    if (++segments > segmentBudget)
      throw new Error("Vector scan conversion exceeds the segment budget.");
    if (ey !== y) {
      const low = Math.min(y, ey),
        high = Math.max(y, ey);
      if (high > 0 && low < height)
        edges.push({
          x: y < ey ? x : ex,
          y: low,
          end: high,
          slope: (ex - x) / (ey - y),
          winding: y < ey ? 1 : -1,
        });
      if (edges.length > segmentBudget)
        throw new Error("Vector scan conversion exceeds the segment budget.");
    }
    x = ex;
    y = ey;
  };
  const cubic = (p: number[], depth = 0) => {
    const dx = p[6] - p[0],
      dy = p[7] - p[1],
      length = Math.hypot(dx, dy);
    const error = length
      ? Math.max(
          Math.abs((p[2] - p[0]) * dy - (p[3] - p[1]) * dx),
          Math.abs((p[4] - p[0]) * dy - (p[5] - p[1]) * dx),
        ) / length
      : Math.max(
          Math.hypot(p[2] - p[0], p[3] - p[1]),
          Math.hypot(p[4] - p[0], p[5] - p[1]),
        );
    // A collinear overshooting curve is not its chord. Require both controls
    // to lie within the anchor interval before accepting a flat segment.
    const within = [2, 4].every(
      (i) =>
        (p[i] - p[0]) * dx + (p[i + 1] - p[1]) * dy >= 0 &&
        (p[i] - p[0]) * dx + (p[i + 1] - p[1]) * dy <= length * length,
    );
    const extent = Math.max(
      length,
      Math.hypot(p[2] - p[0], p[3] - p[1]),
      Math.hypot(p[4] - p[0], p[5] - p[1]),
    );
    // Scale the error bound down for subpixel geometry; a small closed lobe
    // must retain coverage rather than disappear under an absolute tolerance.
    if (error <= Math.min(flatness, extent / 1024) && within) {
      line(p[6], p[7]);
      return;
    }
    if (depth >= 24)
      throw new Error(
        "Vector curve cannot be flattened within the precision budget.",
      );
    const a = [(p[0] + p[2]) / 2, (p[1] + p[3]) / 2],
      b = [(p[2] + p[4]) / 2, (p[3] + p[5]) / 2],
      c = [(p[4] + p[6]) / 2, (p[5] + p[7]) / 2];
    const d = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      e = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2],
      m = [(d[0] + e[0]) / 2, (d[1] + e[1]) / 2];
    cubic([p[0], p[1], ...a, ...d, ...m], depth + 1);
    cubic([...m, ...e, ...c, p[6], p[7]], depth + 1);
  };
  // Skia uses rational quadratics for circular caps and joins. Subdivide in
  // homogeneous coordinates: polynomial quadratic/cubic substitution would
  // change the circle. Positive weights retain a convex-hull error bound.
  const conic = (a: number[], b: number[], c: number[], depth = 0) => {
    const ax = a[0] / a[2],
      ay = a[1] / a[2],
      bx = b[0] / b[2],
      by = b[1] / b[2],
      cx = c[0] / c[2],
      cy = c[1] / c[2],
      dx = cx - ax,
      dy = cy - ay,
      length = Math.hypot(dx, dy),
      extent = Math.max(length, Math.hypot(bx - ax, by - ay)),
      error = length
        ? Math.abs((bx - ax) * dy - (by - ay) * dx) / length
        : extent,
      dot = (bx - ax) * dx + (by - ay) * dy;
    if (
      error <= Math.min(flatness, extent / 1024) &&
      dot >= 0 &&
      dot <= length * length
    ) {
      line(cx, cy);
      return;
    }
    if (depth >= 24)
      throw new Error(
        "Vector conic cannot be flattened within the precision budget.",
      );
    const ab = a.map((v, i) => (v + b[i]) / 2),
      bc = b.map((v, i) => (v + c[i]) / 2),
      mid = ab.map((v, i) => (v + bc[i]) / 2);
    conic(a, ab, mid, depth + 1);
    conic(mid, bc, c, depth + 1);
  };
  for (const command of commands) {
    if (command[0] === 0) {
      if (contour) line(startX, startY);
      x = startX = command[1];
      y = startY = command[2];
      contour = true;
    } else if (command[0] === 1) line(command[1], command[2]);
    else if (command[0] === 2) {
      const cx = command[1],
        cy = command[2],
        ex = command[3],
        ey = command[4];
      cubic([
        x,
        y,
        x + (2 * (cx - x)) / 3,
        y + (2 * (cy - y)) / 3,
        ex + (2 * (cx - ex)) / 3,
        ey + (2 * (cy - ey)) / 3,
        ex,
        ey,
      ]);
    } else if (command[0] === 3) {
      const weight = command[5];
      if (!Number.isFinite(weight) || weight <= 0)
        throw new Error("Invalid vector conic weight.");
      conic(
        [x, y, 1],
        [command[1] * weight, command[2] * weight, weight],
        [command[3], command[4], 1],
      );
    } else if (command[0] === 4) cubic([x, y, ...command.slice(1)]);
    else if (command[0] === 5) line(startX, startY);
    else throw new Error("Unsupported resolved vector curve command.");
  }
  // Filling implicitly closes open contours without changing their editable
  // open/closed metadata or adding a segment to an eventual stroke.
  if (contour) line(startX, startY);
  const starts = new Map<number, Edge[]>();
  for (const edge of edges) {
    const row = Math.max(0, Math.floor(edge.y));
    const bucket = starts.get(row) ?? [];
    bucket.push(edge);
    starts.set(row, bucket);
  }
  const result = new Float32Array(width * height),
    area = new Float64Array(width);
  let active: Edge[] = [];
  const at = (edge: Edge, y: number) => edge.x + (y - edge.y) * edge.slope;
  const integral = (a: number, b: number, h: number) => {
    const low = Math.min(a, b),
      high = Math.max(a, b);
    if (high <= 0) return 0;
    if (low >= 1) return h;
    if (low === high) return Math.max(0, Math.min(1, low)) * h;
    const p = Math.max(0, low),
      q = Math.min(1, high);
    const partial = q > p ? ((q - p) * (q + p)) / 2 : 0,
      full = Math.max(0, high - Math.max(1, low));
    return (h * (partial + full)) / (high - low);
  };
  for (let row = 0; row < height; row++) {
    area.fill(0);
    active = active.filter((e) => e.end > row);
    for (const edge of starts.get(row) ?? []) active.push(edge);
    const cuts = [row, row + 1];
    for (const e of active) {
      if (e.y > row && e.y < row + 1) cuts.push(e.y);
      if (e.end > row && e.end < row + 1) cuts.push(e.end);
    }
    cuts.sort((a, b) => a - b);
    const bands: [number, number][] = [];
    for (let i = 1; i < cuts.length; i++)
      if (cuts[i] > cuts[i - 1]) bands.push([cuts[i - 1], cuts[i]]);
    let steps = 0;
    while (bands.length) {
      if (++steps > segmentBudget)
        throw new Error(
          "Vector intersections exceed the scan-conversion budget.",
        );
      const [top, bottom] = bands.pop()!,
        mid = (top + bottom) / 2;
      const order = active
        .filter((e) => e.y < mid && e.end > mid)
        .sort((a, b) => at(a, mid) - at(b, mid));
      const crossing: number[] = [];
      for (let i = 1; i < order.length; i++) {
        const a = order[i - 1],
          b = order[i],
          d = a.slope - b.slope;
        if (d !== 0) {
          const yy = top + (at(b, top) - at(a, top)) / d;
          if (
            yy > top &&
            yy < bottom &&
            (at(a, top) > at(b, top) || at(a, bottom) > at(b, bottom))
          )
            crossing.push(yy);
        }
      }
      if (crossing.length) {
        crossing.push(top, bottom);
        crossing.sort((a, b) => a - b);
        for (let i = 1; i < crossing.length; i++)
          if (crossing[i] > crossing[i - 1])
            bands.push([crossing[i - 1], crossing[i]]);
        continue;
      }
      const span = (left: Edge, right: Edge) => {
        const l0 = at(left, top),
          l1 = at(left, bottom),
          r0 = at(right, top),
          r1 = at(right, bottom),
          h = bottom - top;
        const first = Math.max(0, Math.floor(Math.min(l0, l1))),
          last = Math.min(width, Math.ceil(Math.max(r0, r1)));
        const fullStart = Math.max(first, Math.ceil(Math.max(l0, l1))),
          fullEnd = Math.min(last, Math.floor(Math.min(r0, r1)));
        for (let col = first; col < last; col++) {
          if (col >= fullStart && col < fullEnd) area[col] += h;
          else
            area[col] += Math.max(
              0,
              integral(r0 - col, r1 - col, h) - integral(l0 - col, l1 - col, h),
            );
        }
      };
      if (rule === "evenodd") {
        for (let i = 1; i < order.length; i += 2) span(order[i - 1], order[i]);
      } else {
        let winding = 0,
          left: Edge | undefined;
        for (const edge of order) {
          const before = winding;
          winding += edge.winding;
          if (before === 0 && winding !== 0) left = edge;
          else if (before !== 0 && winding === 0 && left) span(left, edge);
        }
      }
    }
    for (let col = 0; col < width; col++)
      result[row * width + col] = Math.max(0, Math.min(1, area[col]));
  }
  return result;
}
