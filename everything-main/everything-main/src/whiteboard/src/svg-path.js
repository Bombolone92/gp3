// Draws lucide icon nodes with plain Canvas 2D calls. Path2D is unavailable in
// some environments, and these icons only use a small, well-defined subset.
// A cursor reads numbers lazily so packed arc flags ("a1 1 0 012 2") parse.
function reader(d) {
  let n = 0;
  const number = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
  const skip = () => {
    while (n < d.length && /[\s,]/.test(d[n])) n++;
  };
  return {
    done: () => (skip(), n >= d.length),
    command() {
      skip();
      return /[MmLlHhVvCcSsQqTtAaZz]/.test(d[n]) ? d[n++] : null;
    },
    number() {
      skip();
      number.lastIndex = n;
      const m = number.exec(d);
      if (!m) throw Error("Invalid path data.");
      n = number.lastIndex;
      return Number(m[0]);
    },
    flag() {
      skip();
      if (d[n] !== "0" && d[n] !== "1") throw Error("Invalid path data.");
      return Number(d[n++]);
    },
  };
}
function arc(ctx, x1, y1, rx, ry, angle, large, sweep, x2, y2) {
  if (!rx || !ry) return ctx.lineTo(x2, y2);
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (angle * Math.PI) / 180,
    cos = Math.cos(phi),
    sin = Math.sin(phi);
  const dx = (x1 - x2) / 2,
    dy = (y1 - y2) / 2,
    px = cos * dx + sin * dy,
    py = -sin * dx + cos * dy;
  const scale = px ** 2 / rx ** 2 + py ** 2 / ry ** 2;
  if (scale > 1) {
    rx *= Math.sqrt(scale);
    ry *= Math.sqrt(scale);
  }
  const sign = large === sweep ? -1 : 1,
    numerator = rx ** 2 * ry ** 2 - rx ** 2 * py ** 2 - ry ** 2 * px ** 2,
    factor =
      sign *
      Math.sqrt(
        Math.max(0, numerator / (rx ** 2 * py ** 2 + ry ** 2 * px ** 2)),
      );
  const cxp = (factor * rx * py) / ry,
    cyp = (-factor * ry * px) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2,
    cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const vector = (ux, uy, vx, vy) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = vector(1, 0, (px - cxp) / rx, (py - cyp) / ry);
  let delta = vector(
    (px - cxp) / rx,
    (py - cyp) / ry,
    (-px - cxp) / rx,
    (-py - cyp) / ry,
  );
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  ctx.ellipse(cx, cy, rx, ry, phi, start, start + delta, !sweep);
}
export function tracePath(ctx, d) {
  const read = reader(d);
  let command = "",
    x = 0,
    y = 0,
    startX = 0,
    startY = 0,
    controlX = 0,
    controlY = 0,
    previous = "";
  const next = () => read.number(),
    flag = () => read.flag();
  while (!read.done()) {
    const explicit = read.command();
    if (explicit) command = explicit;
    else if (!command || /[Zz]/.test(command))
      throw Error("Invalid path data.");
    const relative = command === command.toLowerCase(),
      ox = relative ? x : 0,
      oy = relative ? y : 0;
    switch (command.toUpperCase()) {
      case "M":
        x = ox + next();
        y = oy + next();
        ctx.moveTo(x, y);
        startX = x;
        startY = y;
        // Further coordinate pairs after a move are implicit line segments.
        command = relative ? "l" : "L";
        break;
      case "L":
        x = ox + next();
        y = oy + next();
        ctx.lineTo(x, y);
        break;
      case "H":
        x = ox + next();
        ctx.lineTo(x, y);
        break;
      case "V":
        y = oy + next();
        ctx.lineTo(x, y);
        break;
      case "C": {
        const x1 = ox + next(),
          y1 = oy + next();
        controlX = ox + next();
        controlY = oy + next();
        x = ox + next();
        y = oy + next();
        ctx.bezierCurveTo(x1, y1, controlX, controlY, x, y);
        break;
      }
      case "S": {
        const reflect = "CS".includes(previous.toUpperCase());
        const x1 = reflect ? 2 * x - controlX : x,
          y1 = reflect ? 2 * y - controlY : y;
        controlX = ox + next();
        controlY = oy + next();
        x = ox + next();
        y = oy + next();
        ctx.bezierCurveTo(x1, y1, controlX, controlY, x, y);
        break;
      }
      case "Q":
        controlX = ox + next();
        controlY = oy + next();
        x = ox + next();
        y = oy + next();
        ctx.quadraticCurveTo(controlX, controlY, x, y);
        break;
      case "T": {
        const reflect = "QT".includes(previous.toUpperCase());
        controlX = reflect ? 2 * x - controlX : x;
        controlY = reflect ? 2 * y - controlY : y;
        x = ox + next();
        y = oy + next();
        ctx.quadraticCurveTo(controlX, controlY, x, y);
        break;
      }
      case "A": {
        const rx = next(),
          ry = next(),
          angle = next(),
          large = flag(),
          sweep = flag(),
          x2 = ox + next(),
          y2 = oy + next();
        arc(ctx, x, y, rx, ry, angle, large, sweep, x2, y2);
        x = x2;
        y = y2;
        break;
      }
      case "Z":
        ctx.closePath();
        x = startX;
        y = startY;
        break;
    }
    previous = command;
  }
}
const points = (value) =>
  String(value)
    .trim()
    .split(/[\s,]+/)
    .map(Number);
// Strokes an icon node (an array of [tag, attributes]) into a size-pixel
// square at x, y. Icons use a 24-unit view box and round stroke caps.
export function drawIconNode(
  ctx,
  node,
  { x = 0, y = 0, size = 24, color = "#30342f", lineWidth = 2 } = {},
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash?.([]);
  for (const [tag, a] of node) {
    ctx.beginPath();
    const n = (key, fallback = 0) => Number(a[key] ?? fallback);
    if (tag === "path") tracePath(ctx, a.d);
    else if (tag === "circle")
      ctx.arc(n("cx"), n("cy"), n("r"), 0, Math.PI * 2);
    else if (tag === "ellipse")
      ctx.ellipse(n("cx"), n("cy"), n("rx"), n("ry"), 0, 0, Math.PI * 2);
    else if (tag === "rect") {
      const r = Math.min(n("rx", a.ry ?? 0), n("width") / 2, n("height") / 2);
      ctx.roundRect(n("x"), n("y"), n("width"), n("height"), r);
    } else if (tag === "line") {
      ctx.moveTo(n("x1"), n("y1"));
      ctx.lineTo(n("x2"), n("y2"));
    } else if (tag === "polyline" || tag === "polygon") {
      const p = points(a.points);
      for (let k = 0; k + 1 < p.length; k += 2)
        k ? ctx.lineTo(p[k], p[k + 1]) : ctx.moveTo(p[k], p[k + 1]);
      if (tag === "polygon") ctx.closePath();
    } else continue;
    ctx.stroke();
  }
  ctx.restore();
}
