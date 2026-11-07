import { PathBuilder, baselineOffset, num } from "../export-layout.js";
import { fontStack } from "../fonts.js";
import { xml } from "../zip.js";
import { taskLayout } from "./task-renderer.js";

// Vector exports draw the same badge operations as the canvas renderer.
const textStyle = (o) => ({
  font: o.font,
  family: "dm-sans",
  size: o.size,
  bold: o.bold,
  italic: false,
  color: o.color,
});
function polyline(points, close) {
  const path = new PathBuilder();
  points.forEach(([x, y], n) => (n ? path.lineTo(x, y) : path.moveTo(x, y)));
  if (close) path.closePath();
  return path.d;
}
function circle(o) {
  const path = new PathBuilder();
  path.arc(o.cx, o.cy, o.r, 0, Math.PI * 2);
  path.closePath();
  return path.d;
}

export function svgTaskBadge(i, ctx) {
  const layout = taskLayout(ctx, i);
  if (!layout?.ops.length) return "";
  const family = xml(fontStack("dm-sans").replaceAll('"', "'"));
  let out = "";
  for (const o of layout.ops) {
    if (o.op === "pill") {
      const path = new PathBuilder();
      path.roundRect(o.x, o.y, o.w, o.h, o.r);
      out += `<path d="${path.d}" fill="${o.fill}" stroke="${o.stroke}" stroke-width="${num(o.width)}"/>`;
    } else if (o.op === "circle")
      out += `<circle cx="${num(o.cx)}" cy="${num(o.cy)}" r="${num(o.r)}" fill="${o.fill || "none"}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${num(o.width)}"` : ""}/>`;
    else if (o.op === "poly")
      out += `<path d="${polyline(o.points, true)}" fill="${o.fill}"/>`;
    else if (o.op === "line")
      out += `<path d="${polyline(o.points)}" fill="none" stroke="${o.stroke}" stroke-width="${num(o.width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    else if (o.op === "text") {
      const y = o.y + baselineOffset(ctx, o.font, "middle");
      out += `<text x="${num(o.x)}" y="${num(y)}"${o.align === "center" ? ' text-anchor="middle"' : ""} font-family="${family}" font-size="${num(o.size)}" font-weight="${o.bold ? 600 : 500}" fill="${o.color}" xml:space="preserve">${xml(o.text)}</text>`;
    }
  }
  return `<g class="task-badge">${out}</g>`;
}

// Strings the PDF renderer must be able to encode with its standard fonts.
export function taskBadgeStrings(i, ctx) {
  const layout = taskLayout(ctx, i);
  return (layout?.ops || [])
    .filter((o) => o.op === "text")
    .map((o) => [o.text, textStyle(o)]);
}

export async function drawTaskBadgePDF(i, context, draw) {
  const layout = taskLayout(context.ctx, i);
  if (!layout?.ops.length) return;
  for (const o of layout.ops) {
    if (o.op === "pill") {
      const path = new PathBuilder();
      path.roundRect(o.x, o.y, o.w, o.h, o.r);
      draw.path(path.d, { fill: o.fill, stroke: o.stroke, width: o.width });
    } else if (o.op === "circle")
      draw.path(circle(o), {
        fill: o.fill || null,
        stroke: o.stroke,
        width: o.width,
      });
    else if (o.op === "poly")
      draw.path(polyline(o.points, true), { fill: o.fill });
    else if (o.op === "line")
      draw.path(polyline(o.points), { stroke: o.stroke, width: o.width });
    else if (o.op === "text") {
      const style = textStyle(o);
      let x = o.x;
      if (o.align === "center") {
        context.ctx.font = o.font;
        x -= context.ctx.measureText(o.text).width / 2;
      }
      const top =
        o.y +
        baselineOffset(context.ctx, o.font, "middle") -
        baselineOffset(context.ctx, o.font);
      await draw.text(o.text, x, top, style);
    }
  }
}
