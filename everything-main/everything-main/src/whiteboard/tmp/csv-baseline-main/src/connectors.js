import { textStyle, wrapText, richTextLayout, listTextLayout } from "./text.js";

// Paths stay inside the endpoint rectangle, including reversed/vertical lines.
// Rendering uses exact Béziers; hit testing uses adaptive subdivision.
export function connectorPath(i) {
  const a = { x: i.x, y: i.y },
    b = { x: i.x + i.w, y: i.y + i.h };
  if (!i.lineType || i.lineType === "straight") return [a, b];
  return (i.routeAxis ? i.routeAxis === "x" : Math.abs(i.w) >= Math.abs(i.h))
    ? [a, { x: a.x + i.w / 2, y: a.y }, { x: a.x + i.w / 2, y: b.y }, b]
    : [a, { x: a.x, y: a.y + i.h / 2 }, { x: b.x, y: a.y + i.h / 2 }, b];
}
export function connectorSegments(i, tolerance = 1) {
  const path = connectorPath(i);
  if (i.lineType !== "curved") return path;
  const result = [path[0]];
  const middle = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  function split(a, b, c, d, depth) {
    const dx = d.x - a.x,
      dy = d.y - a.y;
    const length = Math.hypot(dx, dy);
    const deviation = length
      ? Math.max(
          Math.abs(dy * (b.x - a.x) - dx * (b.y - a.y)),
          Math.abs(dy * (c.x - a.x) - dx * (c.y - a.y)),
        ) / length
      : Math.max(
          Math.hypot(b.x - a.x, b.y - a.y),
          Math.hypot(c.x - a.x, c.y - a.y),
        );
    if (depth >= 12 || deviation <= Math.max(0.01, tolerance)) {
      result.push(d);
      return;
    }
    const ab = middle(a, b),
      bc = middle(b, c),
      cd = middle(c, d);
    const abc = middle(ab, bc),
      bcd = middle(bc, cd),
      center = middle(abc, bcd);
    split(a, ab, abc, center, depth + 1);
    split(center, bcd, cd, d, depth + 1);
  }
  split(...path, 0);
  return result;
}

let measurement;
let labels = new WeakMap();
export function connectorLabel(i) {
  const style = textStyle(i);
  const text = i.text || "";
  const key = `${style.font}\n${text}`;
  let metrics = labels.get(i);
  if (
    metrics?.key !== key ||
    metrics?.runs !== i.textRuns ||
    metrics?.blocks !== i.textBlocks
  ) {
    if (!measurement && globalThis.document) {
      measurement = document.createElement("canvas").getContext("2d");
      document.fonts?.ready.then(() => {
        labels = new WeakMap();
      });
    }
    const ctx = measurement || {
      measureText: (s) => ({ width: Array.from(s).length * style.size * 0.6 }),
    };
    ctx.font = style.font;
    const width = Math.max(
      64,
      Math.min(
        280,
        Math.max(
          ...(i.textBlocks?.length
            ? listTextLayout(i, ctx, Infinity).map(
                (line) => line.width + (line.indent || 0),
              )
            : i.textRuns?.length
              ? richTextLayout(i, ctx, Infinity).map((line) => line.width)
              : text.split("\n").map((line) => ctx.measureText(line).width)),
        ) + 16,
      ),
    );
    const lines = i.textBlocks?.length
      ? listTextLayout(i, ctx, width - 16).map((line) => line.text)
      : i.textRuns?.length
        ? richTextLayout(i, ctx, width - 16).map((line) => line.text)
        : wrapText(ctx, text, width - 16);
    metrics = {
      key,
      runs: i.textRuns,
      blocks: i.textBlocks,
      lines,
      w: width,
      h: Math.max(
        style.size * 1.35 + 16,
        lines.length * style.size * 1.35 + 16,
      ),
    };
    labels.set(i, metrics);
  }
  return {
    ...metrics,
    x: i.x + i.w / 2 - metrics.w / 2,
    y: i.y + i.h / 2 - metrics.h / 2,
  };
}
export function clearConnectorLabelCache() {
  labels = new WeakMap();
}

export function connectorEndpointHit(i, p, zoom = 1) {
  if (Math.hypot(p.x - i.x, p.y - i.y) <= 10 / zoom) return "start";
  if (Math.hypot(p.x - i.x - i.w, p.y - i.y - i.h) <= 10 / zoom) return "end";
  return null;
}

export function setConnectorEnd(i, end, point, target) {
  const opposite = end === "start" ? "endId" : "startId";
  if (target?.id === i[opposite]) target = null;
  if (end === "start") {
    const x = i.x + i.w,
      y = i.y + i.h;
    i.x = point.x;
    i.y = point.y;
    i.w = x - point.x;
    i.h = y - point.y;
  } else {
    i.w = point.x - i.x;
    i.h = point.y - i.y;
  }
  if (target) i[`${end}Id`] = target.id;
  else delete i[`${end}Id`];
}
