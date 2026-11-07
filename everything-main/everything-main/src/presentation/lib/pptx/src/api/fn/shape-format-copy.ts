// Format Painter: one shape's fill, outline, effects and style reference
// copied onto another, as authored XML so theme colours stay theme colours.

import {
  NS,
  type XmlElement,
  firstChildElement,
  qname,
} from "../../internal/xml/index.ts";
import {
  SHAPE_ELEMENT,
  SHAPE_SNAPSHOT,
  type SlideShapeData,
} from "../_internal-symbols.ts";
import { commitAndRefresh, requireSpPr } from "./_helpers.ts";

const FILLS = new Set([
  "noFill",
  "solidFill",
  "gradFill",
  "blipFill",
  "pattFill",
  "grpFill",
]);
const EFFECTS = new Set(["effectLst", "effectDag"]);
const GEOMETRY = new Set(["xfrm", "custGeom", "prstGeom"]);
const NAME_STYLE = qname("p", "style", NS.pml);
const NAME_SP_PR = qname("p", "spPr", NS.pml);

const isDml = (c: XmlElement["children"][number], names: Set<string>) =>
  c.kind === "element" &&
  c.name.namespaceURI === NS.dml &&
  names.has(c.name.localName);

/**
 * Copies the source shape's fill, line and effects (and its `p:style`
 * reference, which supplies whatever the shape does not set itself) onto the
 * target. A picture fill is left alone, since its image belongs to the
 * source's part. Returns false when there was nothing the target can take.
 */
export const copyShapeFormatting = (
  source: SlideShapeData,
  target: SlideShapeData,
): boolean => {
  const kinds = new Set(["shape", "connector", "picture"]);
  if (
    !kinds.has(source[SHAPE_SNAPSHOT].kind) ||
    !kinds.has(target[SHAPE_SNAPSHOT].kind)
  )
    return false;
  const from = firstChildElement(source[SHAPE_ELEMENT], NAME_SP_PR);
  const to = requireSpPr(target);
  const children = (from?.children ?? []).filter(
    (c): c is XmlElement => c.kind === "element",
  );
  const fill = children.find(
    (c) => isDml(c, FILLS) && c.name.localName !== "blipFill",
  );
  const line = children.find((c) => isDml(c, new Set(["ln"])));
  const effects = children.find((c) => isDml(c, EFFECTS));
  const canFill = target[SHAPE_SNAPSHOT].kind === "shape";
  to.children = to.children.filter(
    (c) =>
      !(
        (canFill && isDml(c, FILLS) && !isDml(c, new Set(["blipFill"]))) ||
        isDml(c, new Set(["ln"])) ||
        isDml(c, EFFECTS)
      ),
  );
  // spPr's sequence: geometry, fill, ln, effects, then the rest.
  let at = 0;
  while (at < to.children.length && isDml(to.children[at]!, GEOMETRY)) at++;
  if (canFill) {
    const existing = to.children.findIndex((c) => isDml(c, FILLS));
    if (existing >= 0) at = existing + 1;
  }
  const add = [canFill ? fill : undefined, line, effects].filter(
    (c): c is XmlElement => !!c,
  );
  to.children.splice(at, 0, ...add.map((c) => structuredClone(c)));
  const style = firstChildElement(source[SHAPE_ELEMENT], NAME_STYLE);
  const host = target[SHAPE_ELEMENT];
  const current = host.children.findIndex(
    (c) =>
      c.kind === "element" &&
      c.name.namespaceURI === NS.pml &&
      c.name.localName === "style",
  );
  if (style && target[SHAPE_SNAPSHOT].kind !== "picture") {
    const copy = structuredClone(style);
    if (current >= 0) host.children[current] = copy;
    else {
      const spPrAt = host.children.indexOf(to);
      host.children.splice(spPrAt + 1, 0, copy);
    }
  }
  commitAndRefresh(target);
  return true;
};
