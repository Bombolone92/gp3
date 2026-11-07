import { type XmlElement, getAttrValue, qname } from "../xml/index.ts";
import type {
  DiagramAxis,
  DiagramHierarchy,
  DiagramHierarchyNode,
} from "./hierarchy.ts";

export type DiagramPointSelection =
  | "all"
  | "doc"
  | "node"
  | "norm"
  | "nonNorm"
  | "asst"
  | "nonAsst"
  | "parTrans"
  | "pres"
  | "sibTrans";

export interface DiagramIteratorStep {
  readonly axis: DiagramAxis;
  readonly pointType: DiagramPointSelection;
  readonly hideLastTransition: boolean;
  readonly start: number;
  readonly count: number;
  readonly step: number;
}

const axes = new Set<DiagramAxis>([
  "none",
  "self",
  "root",
  "par",
  "ancst",
  "ancstOrSelf",
  "ch",
  "des",
  "desOrSelf",
  "followSib",
  "precedSib",
  "follow",
  "preced",
]);
const pointTypes = new Set<DiagramPointSelection>([
  "all",
  "doc",
  "node",
  "norm",
  "nonNorm",
  "asst",
  "nonAsst",
  "parTrans",
  "pres",
  "sibTrans",
]);
/** ST_ElementType is shared by iterators, constraints and adjustment rules. */
export const readDiagramPointSelection = (
  value: string,
  context = "diagram",
): DiagramPointSelection => {
  if (!pointTypes.has(value as DiagramPointSelection))
    throw new Error(`unknown ${context} point type ${value}`);
  return value as DiagramPointSelection;
};
const list = (element: XmlElement, name: string): string[] => {
  const value = getAttrValue(element, qname("", name, ""));
  return value?.trim() ? value.trim().split(/[\t\n\r ]+/) : [];
};
const integer = (
  value: string | undefined,
  fallback: number,
  unsigned = false,
): number => {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (
    !/^[+-]?\d+$/.test(value) ||
    !Number.isInteger(n) ||
    n < (unsigned ? 0 : -0x80000000) ||
    n > (unsigned ? 0xffffffff : 0x7fffffff)
  )
    throw new Error(`invalid diagram iterator integer ${value}`);
  return n;
};

/**
 * ECMA-376 AG_IteratorAttributes and MS-OE376 2.1.1666: lists describe nested
 * traversals, not a union of axes. Each axis has its own options. Missing list
 * entries use the schema defaults; a scalar option is not broadcast to later
 * axes. Surplus options beyond the axis list are ignored.
 */
export const readDiagramIterator = (
  element: XmlElement,
): DiagramIteratorStep[] => {
  const axis = list(element, "axis"),
    pointType = list(element, "ptType"),
    hide = list(element, "hideLastTrans"),
    start = list(element, "st"),
    count = list(element, "cnt"),
    step = list(element, "step");
  return (axis.length ? axis : ["none"]).map((value, index) => {
    if (!axes.has(value as DiagramAxis))
      throw new Error(`unknown diagram iterator axis ${value}`);
    const type = readDiagramPointSelection(
      pointType[index] ?? "all",
      "diagram iterator",
    );
    const hidden = hide[index] ?? "true";
    if (!["true", "false", "1", "0"].includes(hidden))
      throw new Error(`invalid diagram iterator boolean ${hidden}`);
    return {
      axis: value as DiagramAxis,
      pointType: type,
      hideLastTransition: hidden === "true" || hidden === "1",
      start: integer(start[index], 1),
      count: integer(count[index], 0, true),
      step: integer(step[index], 1),
    };
  });
};

/** Match a semantic context, independently of its presentation/text mappings. */
export const matchesDiagramPointSelection = (
  node: DiagramHierarchyNode,
  type: DiagramPointSelection,
): boolean => {
  const actual = node.point.type;
  switch (type) {
    case "all":
      return true;
    // Assistants are user data nodes too. norm/nonAsst exclude document and
    // transition points; they are not the complement of asst over every type.
    case "node":
      return actual === "node" || actual === "asst";
    case "norm":
    case "nonAsst":
      return actual === "node";
    case "nonNorm":
      return actual === "asst";
    default:
      return actual === type;
  }
};

function* applyStep(
  hierarchy: DiagramHierarchy,
  context: DiagramHierarchyNode,
  selection: DiagramIteratorStep,
): Generator<DiagramHierarchyNode> {
  const nodes = hierarchy
    .axis(context, selection.axis)
    .filter(
      (node) =>
        matchesDiagramPointSelection(node, selection.pointType) &&
        !(selection.hideLastTransition && node.closesCycle),
    );
  const start =
    selection.start < 0
      ? nodes.length + selection.start
      : Math.max(1, selection.start) - 1;
  const step = selection.step || 1;
  // Count bounds the forward index window before stepping, not the number of
  // emitted nodes. The native reference retains that upper bound for negative
  // steps, which continue to index zero. Native controls cover both directions.
  const end = selection.count
    ? Math.min(nodes.length, start + selection.count)
    : nodes.length;
  for (let index = start; index >= 0 && index < end; index += step)
    yield nodes[index]!;
}

/**
 * Walk nested iterators lazily in data order. Repeated results are retained:
 * presOf collects a set, whereas layout expansion tracks instance identity.
 * An explicit stack avoids call-stack overflow for deeply nested expressions.
 */
export function* iterateDiagramNodes(
  hierarchy: DiagramHierarchy,
  context: DiagramHierarchyNode,
  expression: readonly DiagramIteratorStep[],
  onStep?: () => void,
): Generator<DiagramHierarchyNode> {
  // Reject a foreign context even for an empty/no-op expression.
  hierarchy.axis(context, "self");
  if (!expression.length) return;
  const stack = [applyStep(hierarchy, context, expression[0]!)];
  while (stack.length) {
    // Layout callers can enforce a work budget even when a long traversal
    // produces no results and therefore never yields back to its consumer.
    onStep?.();
    const next = stack[stack.length - 1]!.next();
    if (next.done) stack.pop();
    else if (stack.length === expression.length) yield next.value;
    else
      stack.push(applyStep(hierarchy, next.value, expression[stack.length]!));
  }
}

/** The ordered set of semantic contributors selected by a presOf expression. */
export const selectDiagramNodes = (
  hierarchy: DiagramHierarchy,
  context: DiagramHierarchyNode,
  expression: readonly DiagramIteratorStep[],
): DiagramHierarchyNode[] => {
  hierarchy.axis(context, "self");
  if (!expression.length) return [];
  let current = [context];
  for (const selection of expression) {
    const next = new Set<DiagramHierarchyNode>();
    for (const node of current)
      for (const result of applyStep(hierarchy, node, selection))
        next.add(result);
    current = [...next];
    if (!current.length) break;
  }
  // A repeated context has identical remaining traversals, so deduplicating
  // each stage preserves first-occurrence order while avoiding exponential
  // work for paths such as repeated ch/par pairs.
  return current;
};

/** Count traversal instances without expanding exponentially repeated paths. */
export const countDiagramNodes = (
  hierarchy: DiagramHierarchy,
  context: DiagramHierarchyNode,
  expression: readonly DiagramIteratorStep[],
): bigint => {
  hierarchy.axis(context, "self");
  if (!expression.length) return 0n;
  let current = new Map([[context, 1n]]);
  for (const selection of expression) {
    const next = new Map<DiagramHierarchyNode, bigint>();
    for (const [node, multiplicity] of current)
      for (const result of applyStep(hierarchy, node, selection))
        next.set(result, (next.get(result) ?? 0n) + multiplicity);
    current = next;
    if (!current.size) break;
  }
  let count = 0n;
  for (const multiplicity of current.values()) count += multiplicity;
  return count;
};
