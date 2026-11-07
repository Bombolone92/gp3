import { NS, getAttrValue, qname, type XmlElement } from "../xml/index.ts";
import type { DiagramLayoutNode } from "./layout.ts";
import { readDiagramStyleLabels, type DiagramStyle } from "./styles.ts";

const value = (element: XmlElement | null, name: string): string | null =>
  element && getAttrValue(element, qname("", name, ""));

const defaultLabel = (node: DiagramLayoutNode): string => {
  const source = node.contributors[0] ?? node.context;
  // Implicit style families have four hierarchy levels, even when
  // definitions supply additional numbered labels. The document uses node1;
  // assistants use asst0 independently of depth. Explicit labels are literal.
  const level = Math.max(1, Math.min(4, source.depth));
  if (source.point.type === "asst") return "asst0";
  if (!["parTrans", "sibTrans"].includes(source.point.type))
    return `node${level}`;
  let dimension = "2D";
  if (value(node.algorithm, "type") === "conn") {
    const parameters = node.algorithm!.children.filter(
      (el): el is XmlElement =>
        el.kind === "element" &&
        el.name.namespaceURI === NS.diagram &&
        el.name.localName === "param" &&
        value(el, "type") === "dim",
    );
    if (parameters.length > 1)
      throw new Error("duplicate diagram connector dimension");
    if (parameters.length) dimension = value(parameters[0]!, "val") ?? "";
    if (dimension !== "1D" && dimension !== "2D")
      throw new Error("invalid diagram connector dimension");
  }
  return source.point.type === "sibTrans"
    ? `sibTrans${dimension}1`
    : `parChTrans${dimension}${level}`;
};

/**
 * Resolve style labels/palette positions from executed layout instances, with
 * no dependency on saved presentation points or drawing XML. The native
 * reference counts shapes of each label in layout preorder (not drawing chOrder).
 * Shape-less nodes have no label. hideGeom shapes retain a label and the
 * preceding visible index, but do not advance that label's count.
 */
export const readDiagramLayoutStyles = (
  root: DiagramLayoutNode,
  quickStyle: XmlElement | null,
  colors: XmlElement | null,
): ReadonlyMap<DiagramLayoutNode, DiagramStyle> => {
  const counts = new Map<string, number>();
  const positions = new Map<
    DiagramLayoutNode,
    { label: string | null; index: number | null }
  >();
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    for (let i = node.children.length - 1; i >= 0; i--)
      pending.push(node.children[i]!);
    const type = value(node.shape, "type") ?? "none";
    if (!node.shape || type === "none" || type === "") {
      positions.set(node, { label: null, index: null });
      continue;
    }
    const label = node.styleLabel || defaultLabel(node);
    const hidden = (value(node.shape, "hideGeom") ?? "false").trim();
    if (!["0", "1", "false", "true"].includes(hidden))
      throw new Error("invalid diagram shape hideGeom");
    const count = counts.get(label) ?? 0;
    const advances = hidden === "false" || hidden === "0";
    positions.set(node, {
      label,
      index: advances ? count : Math.max(0, count - 1),
    });
    if (advances) counts.set(label, count + 1);
  }
  const resolve = readDiagramStyleLabels(quickStyle, colors);
  return new Map(
    [...positions].map(([node, { label, index }]) => [
      node,
      resolve(label, index, label === null ? 0 : (counts.get(label) ?? 0)),
    ]),
  );
};
