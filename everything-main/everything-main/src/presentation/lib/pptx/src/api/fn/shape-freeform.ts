// Freeform shapes: custom geometry written from paths, the same form used
// for scribbles, freeforms and ink converted to shapes.

import {
  NS,
  type XmlElement,
  attr,
  elem,
  qname,
} from "../../internal/xml/index.ts";
import { SHAPE_SNAPSHOT, type SlideShapeData } from "../_internal-symbols.ts";
import { commitAndRefresh, requireSpPr } from "./_helpers.ts";

/** One segment of a freeform path, in the path's own coordinates. */
export type FreeformCommand =
  | { readonly type: "moveTo"; readonly x: number; readonly y: number }
  | { readonly type: "lineTo"; readonly x: number; readonly y: number }
  | {
      readonly type: "cubicTo";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: "close" };

/** A path whose coordinates run from 0 to `w` and `h`; the shape's box maps
 * onto that space. `fill: false` draws the outline only (ink, scribbles). */
export interface FreeformPath {
  readonly w: number;
  readonly h: number;
  readonly fill?: boolean;
  readonly stroke?: boolean;
  readonly commands: readonly FreeformCommand[];
}

const a = (name: string) => qname("a", name, NS.dml);
const v = (name: string, value: string | number) =>
  attr(qname("", name, ""), String(Math.round(Number(value))));
const pt = (x: number, y: number) =>
  elem(a("pt"), { attrs: [v("x", x), v("y", y)] });

const buildPath = (path: FreeformPath): XmlElement => {
  const attrs = [v("w", Math.max(1, path.w)), v("h", Math.max(1, path.h))];
  if (path.fill === false) attrs.push(attr(qname("", "fill", ""), "none"));
  if (path.stroke === false) attrs.push(attr(qname("", "stroke", ""), "0"));
  const children = path.commands.map((c) =>
    c.type === "moveTo"
      ? elem(a("moveTo"), { children: [pt(c.x, c.y)] })
      : c.type === "lineTo"
        ? elem(a("lnTo"), { children: [pt(c.x, c.y)] })
        : c.type === "cubicTo"
          ? elem(a("cubicBezTo"), {
              children: [pt(c.x1, c.y1), pt(c.x2, c.y2), pt(c.x, c.y)],
            })
          : elem(a("close")),
  );
  return elem(a("path"), { attrs, children });
};

/**
 * Replaces the shape's geometry with custom paths. The shape keeps its fill,
 * line, effects and text.
 */
export const setShapeFreeformPaths = (
  shape: SlideShapeData,
  paths: readonly FreeformPath[],
): void => {
  if (shape[SHAPE_SNAPSHOT].kind !== "shape")
    throw new Error("freeform paths need a shape");
  if (!paths.length) throw new Error("a freeform needs at least one path");
  const spPr = requireSpPr(shape);
  const geometry = elem(a("custGeom"), {
    children: [
      elem(a("avLst")),
      elem(a("gdLst")),
      elem(a("ahLst")),
      elem(a("cxnLst")),
      elem(a("rect"), {
        attrs: [
          attr(qname("", "l", ""), "l"),
          attr(qname("", "t", ""), "t"),
          attr(qname("", "r", ""), "r"),
          attr(qname("", "b", ""), "b"),
        ],
      }),
      elem(a("pathLst"), { children: paths.map(buildPath) }),
    ],
  });
  const at = spPr.children.findIndex(
    (c) =>
      c.kind === "element" &&
      c.name.namespaceURI === NS.dml &&
      (c.name.localName === "prstGeom" || c.name.localName === "custGeom"),
  );
  if (at >= 0) spPr.children[at] = geometry;
  else {
    const xfrm = spPr.children.findIndex(
      (c) =>
        c.kind === "element" &&
        c.name.namespaceURI === NS.dml &&
        c.name.localName === "xfrm",
    );
    spPr.children.splice(xfrm + 1, 0, geometry);
  }
  commitAndRefresh(shape);
};
