import { getAttrValue, qname } from "../xml/index.ts";
import {
  type DiagramConnection,
  type DiagramDataModel,
  type DiagramPoint,
  diagramModelIdKey,
} from "./data-model.ts";

export type DiagramAxis =
  | "none"
  | "self"
  | "root"
  | "par"
  | "ancst"
  | "ancstOrSelf"
  | "ch"
  | "des"
  | "desOrSelf"
  | "followSib"
  | "precedSib"
  | "follow"
  | "preced";

export interface DiagramHierarchyNode {
  readonly point: DiagramPoint;
  readonly parent: DiagramHierarchyNode | null;
  readonly children: readonly DiagramHierarchyNode[];
  /** The document is level zero. Transitions have their peers' level. */
  readonly depth: number;
  readonly siblingIndex: number;
  /** A sibling transition from the final child back to the first child. */
  readonly closesCycle: boolean;
}

export interface DiagramHierarchy {
  readonly root: DiagramHierarchyNode;
  node(id: string): DiagramHierarchyNode | null;
  /** Axis results are in data order, including ancestors from root to parent. */
  axis(node: DiagramHierarchyNode, axis: DiagramAxis): DiagramHierarchyNode[];
}

const value = (edge: DiagramConnection, name: string): string | null =>
  getAttrValue(edge.element, qname("", name, ""));
const isData = (point: DiagramPoint): boolean =>
  point.type === "doc" || point.type === "node" || point.type === "asst";

/**
 * Read the semantic tree used by DiagramML iterators (ECMA-376 21.4.7.6).
 * parOf edges order data children. Their parTransId/sibTransId points are
 * peers, immediately before/after that child, not extra levels of ancestry.
 * Presentation points and presParOf/presOf edges belong to a separate graph.
 *
 * This is deliberately stricter than the lossless data-model reader: layout
 * requires a tree. Reject an ambiguous/dangling/cyclic semantic hierarchy
 * without altering either the model or the independently usable saved drawing.
 */
export const readDiagramHierarchy = (
  model: DiagramDataModel,
): DiagramHierarchy => {
  const roots = model.points.filter((point) => point.type === "doc");
  if (roots.length !== 1)
    throw new Error("diagram hierarchy requires one document point");
  const byId = new Map<string, DiagramHierarchyNode>();
  const create = (
    point: DiagramPoint,
    parent: DiagramHierarchyNode | null,
    siblingIndex: number,
    closesCycle = false,
  ): DiagramHierarchyNode => {
    const key = diagramModelIdKey(point.id);
    if (byId.has(key))
      throw new Error(`diagram hierarchy repeats point ${point.id}`);
    const node = {
      point,
      parent,
      children: [] as DiagramHierarchyNode[],
      depth: parent ? parent.depth + 1 : 0,
      siblingIndex,
      closesCycle,
    };
    byId.set(key, node);
    return node;
  };
  const root = create(roots[0]!, null, 0);
  const pending = [root];
  for (let index = 0; index < pending.length; index++) {
    const node = pending[index]!;
    const edges = model.outgoing(node.point.id, "parOf");
    const children = node.children as DiagramHierarchyNode[];
    const transition = (
      edge: DiagramConnection,
      type: "parTrans" | "sibTrans",
      last: boolean,
    ): void => {
      const id = value(edge, `${type}Id`);
      // CT_Cxn defaults both optional transition IDs to zero (no transition).
      if (id === null || diagramModelIdKey(id) === "0") return;
      const point = model.point(id);
      if (!point || point.type !== type)
        throw new Error(`diagram connection ${edge.id} has invalid ${type}Id`);
      const connectionId = getAttrValue(point.element, qname("", "cxnId", ""));
      if (
        connectionId !== null &&
        diagramModelIdKey(connectionId) !== diagramModelIdKey(edge.id)
      )
        throw new Error(`diagram transition ${id} has conflicting cxnId`);
      if (model.outgoing(id, "parOf").length)
        throw new Error(`diagram transition ${id} has data children`);
      children.push(create(point, node, children.length, last));
    };
    for (const [at, edge] of edges.entries()) {
      const point = model.point(edge.destinationId);
      if (!point || !isData(point))
        throw new Error(`diagram connection ${edge.id} has invalid data child`);
      if (model.incoming(point.id, "parOf").length !== 1)
        throw new Error(`diagram point ${point.id} has multiple parents`);
      transition(edge, "parTrans", false);
      const child = create(point, node, children.length);
      children.push(child);
      pending.push(child);
      transition(edge, "sibTrans", at === edges.length - 1);
    }
  }
  if (model.incoming(root.point.id, "parOf").length)
    throw new Error("diagram document point has a parent");
  for (const point of model.points)
    if (isData(point) && !byId.has(diagramModelIdKey(point.id)))
      throw new Error(`diagram data point ${point.id} is disconnected`);
  for (const edge of model.connections)
    if (
      edge.type === "parOf" &&
      (!byId.has(diagramModelIdKey(edge.sourceId)) ||
        !byId.has(diagramModelIdKey(edge.destinationId)))
    )
      throw new Error(`diagram connection ${edge.id} is disconnected`);

  const descendants = (
    nodes: readonly DiagramHierarchyNode[],
  ): DiagramHierarchyNode[] => {
    const result: DiagramHierarchyNode[] = [],
      stack = [...nodes].reverse();
    while (stack.length) {
      const node = stack.pop()!;
      result.push(node);
      for (let i = node.children.length - 1; i >= 0; i--)
        stack.push(node.children[i]!);
    }
    return result;
  };
  return {
    root,
    node: (id) => byId.get(diagramModelIdKey(id)) ?? null,
    axis: (node, axis) => {
      if (byId.get(diagramModelIdKey(node.point.id)) !== node)
        throw new Error(
          "diagram axis context belongs to a different hierarchy",
        );
      switch (axis) {
        case "none":
          return [];
        case "self":
          return [node];
        case "root":
          return [root];
        case "par":
          return node.parent ? [node.parent] : [];
        case "ch":
          return [...node.children];
        case "des":
          return descendants(node.children);
        case "desOrSelf":
          return descendants([node]);
        case "ancst":
        case "ancstOrSelf": {
          const result: DiagramHierarchyNode[] = [];
          let ancestor: DiagramHierarchyNode | null =
            axis === "ancst" ? node.parent : node;
          while (ancestor) {
            result.push(ancestor);
            ancestor = ancestor.parent;
          }
          // Iterator st/cnt/step apply in root-to-leaf order.
          // This differs from XPath's reverse ancestor axis. Keeping the
          // nearest parent first would select the wrong node for cnt="1".
          return result.reverse();
        }
        case "followSib":
        case "follow": {
          const peers =
            node.parent?.children.slice(node.siblingIndex + 1) ?? [];
          return axis === "follow" ? descendants(peers) : peers;
        }
        case "precedSib":
        case "preced": {
          const peers = node.parent?.children.slice(0, node.siblingIndex) ?? [];
          return axis === "preced" ? descendants(peers) : peers;
        }
        default:
          throw new Error(`unknown diagram axis ${axis}`);
      }
    },
  };
};
