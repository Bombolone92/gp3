import { getAttrValue, qname } from "../xml/index.ts";
import type { DiagramLayoutNode } from "./layout.ts";
import type { DiagramHierarchyNode } from "./hierarchy.ts";

/**
 * Bind drawn shapes to semantic TX results, independently of saved presentation
 * points. A TX node with a shape supplies the final text layout for each of its
 * contributors. In layout order the last supplier wins. Each geometry node
 * takes the supplier of its first contributor, including that supplier's full
 * paragraph list and independent text rectangle.
 *
 * Native controls distinguish these first-source and all-source roles: hidden
 * TX geometry is absorbed when its first contributor already belongs to visible
 * geometry; otherwise its text remains a separate drawing. Shape-less TX nodes
 * do not supply drawing text, and hidden non-TX geometry does not acquire a new
 * independent text drawing. The underlying semantic nodes remain untouched.
 */
export const readDiagramDrawingText = (
  root: DiagramLayoutNode,
): ReadonlyMap<DiagramLayoutNode, DiagramLayoutNode | null> => {
  const nodes: DiagramLayoutNode[] = [],
    pending = [root];
  const suppliers = new Map<DiagramHierarchyNode, DiagramLayoutNode>();
  const visible = new Set<DiagramHierarchyNode>();
  const hidden = new Set<DiagramLayoutNode>();
  while (pending.length) {
    const node = pending.pop()!;
    for (let i = node.children.length - 1; i >= 0; --i)
      pending.push(node.children[i]!);
    const type = node.shape && getAttrValue(node.shape, qname("", "type", ""));
    if (!type || type === "none") continue;
    const raw = (
      getAttrValue(node.shape!, qname("", "hideGeom", "")) ?? "false"
    ).trim();
    if (!["false", "true", "0", "1"].includes(raw))
      throw new Error("invalid diagram shape hideGeom");
    if (raw === "true" || raw === "1") hidden.add(node);
    else for (const contributor of node.contributors) visible.add(contributor);
    nodes.push(node);
    if (
      node.algorithm &&
      getAttrValue(node.algorithm, qname("", "type", "")) === "tx"
    )
      for (const contributor of node.contributors)
        suppliers.set(contributor, node);
  }
  const result = new Map<DiagramLayoutNode, DiagramLayoutNode | null>();
  for (const node of nodes) {
    const first = node.contributors[0],
      supplier = first && suppliers.get(first);
    if (
      hidden.has(node) &&
      (!first ||
        visible.has(first) ||
        !node.algorithm ||
        getAttrValue(node.algorithm, qname("", "type", "")) !== "tx")
    )
      continue;
    result.set(node, supplier ?? null);
  }
  return result;
};
