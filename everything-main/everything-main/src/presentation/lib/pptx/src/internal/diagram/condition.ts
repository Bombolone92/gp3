import {
  type XmlElement,
  NS,
  firstChildElement,
  getAttrValue,
  qname,
} from "../xml/index.ts";
import type { DiagramHierarchy, DiagramHierarchyNode } from "./hierarchy.ts";
import {
  type DiagramIteratorStep,
  countDiagramNodes,
  readDiagramIterator,
  selectDiagramNodes,
} from "./iterator.ts";

const enumerations = {
  dir: ["norm", "rev"],
  hierBranch: ["l", "r", "hang", "std", "init"],
  animOne: ["none", "one", "branch"],
  animLvl: ["none", "lvl", "ctr"],
  resizeHandles: ["exact", "rel"],
} as const;
const variables = {
  orgChart: { element: "orgChart", default: "false" },
  chMax: { element: "chMax", default: "-1" },
  chPref: { element: "chPref", default: "-1" },
  bulEnabled: { element: "bulletEnabled", default: "false" },
  dir: { element: "dir", default: "norm" },
  hierBranch: { element: "hierBranch", default: "std" },
  animOne: { element: "animOne", default: "one" },
  animLvl: { element: "animLvl", default: "none" },
  resizeHandles: { element: "resizeHandles", default: "rel" },
} as const;
type Variable = keyof typeof variables;
export type DiagramVariables = ReadonlyMap<Variable, bigint>;
type FunctionType =
  | "cnt"
  | "pos"
  | "revPos"
  | "posEven"
  | "posOdd"
  | "var"
  | "depth"
  | "maxDepth";
type Operator = "equ" | "neq" | "gt" | "gte" | "lt" | "lte";
export interface DiagramCondition {
  readonly func: FunctionType;
  readonly argument: Variable | "none";
  readonly operator: Operator;
  readonly value: bigint;
  readonly iterator: readonly DiagramIteratorStep[];
}
const attribute = (element: XmlElement, name: string): string | null =>
  getAttrValue(element, qname("", name, ""))?.trim() ?? null;
const integer = (value: string): bigint => {
  if (!/^[+-]?\d+$/.test(value))
    throw new Error(`invalid diagram condition integer ${value}`);
  const n = BigInt(value);
  if (n < -2147483648n || n > 2147483647n)
    throw new Error(`diagram condition integer out of range ${value}`);
  return n;
};
const boolean = (value: string): bigint => {
  if (value === "true" || value === "1") return 1n;
  if (value === "false" || value === "0") return 0n;
  throw new Error(`invalid diagram condition boolean ${value}`);
};
const variableValue = (name: Variable, value: string): bigint => {
  if (name === "orgChart" || name === "bulEnabled") return boolean(value);
  if (name === "chMax" || name === "chPref") {
    const n = integer(value);
    if (n < -1n) throw new Error(`invalid diagram child count ${value}`);
    return n;
  }
  const index = (enumerations[name] as readonly string[]).indexOf(value);
  if (index < 0) throw new Error(`invalid diagram variable ${name}: ${value}`);
  return BigInt(index);
};

/**
 * Read an explicit varLst into a new layout-variable scope. Nested layout
 * nodes inherit missing variables. Only a present element receives its schema
 * default; an entirely absent variable evaluates as numeric zero.
 * This does not infer a scope from saved presentation-point properties.
 */
export const readDiagramVariables = (
  element: XmlElement | null,
  parent: DiagramVariables = new Map(),
): DiagramVariables => {
  const result = new Map(parent);
  if (element)
    for (const name of Object.keys(variables) as Variable[]) {
      const definition = variables[name];
      const child = firstChildElement(
        element,
        qname("dgm", definition.element, NS.diagram),
      );
      if (child)
        result.set(
          name,
          variableValue(name, attribute(child, "val") ?? definition.default),
        );
    }
  return result;
};

/** ST_FunctionValue's integer/boolean/enum union, compared numerically. */
const functionValue = (value: string): bigint => {
  if (value === "true" || value === "false") return boolean(value);
  for (const values of Object.values(enumerations)) {
    const index = (values as readonly string[]).indexOf(value);
    if (index >= 0) return BigInt(index);
  }
  return integer(value);
};

export const readDiagramCondition = (element: XmlElement): DiagramCondition => {
  const func = attribute(element, "func"),
    operator = attribute(element, "op"),
    value = attribute(element, "val"),
    argument = attribute(element, "arg") ?? "none";
  if (
    !func ||
    ![
      "cnt",
      "pos",
      "revPos",
      "posEven",
      "posOdd",
      "var",
      "depth",
      "maxDepth",
    ].includes(func)
  )
    throw new Error(`unknown diagram condition function ${func}`);
  if (!operator || !["equ", "neq", "gt", "gte", "lt", "lte"].includes(operator))
    throw new Error(`unknown diagram condition operator ${operator}`);
  if (argument !== "none" && !Object.hasOwn(variables, argument))
    throw new Error(`unknown diagram condition argument ${argument}`);
  if (value === null) throw new Error("missing diagram condition value");
  return {
    func: func as FunctionType,
    operator: operator as Operator,
    argument: argument as Variable | "none",
    value: functionValue(value),
    iterator: readDiagramIterator(element),
  };
};

/** Evaluate ECMA-376 CT_When against the current semantic node and layout scope. */
export const diagramConditionValue = (
  hierarchy: DiagramHierarchy,
  context: DiagramHierarchyNode,
  condition: DiagramCondition,
  scope: DiagramVariables = new Map(),
): bigint => {
  hierarchy.axis(context, "self");
  const { func, iterator, argument } = condition;
  if (func === "var")
    return argument === "none" ? 0n : (scope.get(argument) ?? 0n);
  if (func === "cnt") return countDiagramNodes(hierarchy, context, iterator);
  const nodes = selectDiagramNodes(hierarchy, context, iterator);
  const first = nodes[0];
  if (func === "depth") return BigInt(first?.depth ?? 0);
  if (func === "maxDepth") {
    // The native reference measures the selected extent from the first result,
    // including that level. Reversed traversal is not a min/max depth range.
    let maximum = first?.depth ?? 0;
    for (const node of nodes) maximum = Math.max(maximum, node.depth);
    return BigInt(maximum - (first?.depth ?? 0) + 1);
  }
  if (!first?.parent) return 0n;
  const final = iterator[iterator.length - 1]!;
  // Position is the sibling ordinal under the final point-type/transition
  // filter, not the index in the sliced or nested iterator result sequence.
  const peers = selectDiagramNodes(hierarchy, first.parent, [
    {
      ...final,
      axis: "ch",
      start: 1,
      count: 0,
      step: 1,
    },
  ]);
  const index = peers.indexOf(first);
  if (index < 0) return 0n;
  const position = index + 1;
  switch (func) {
    case "pos":
      return BigInt(position);
    case "revPos":
      return BigInt(peers.length - index);
    case "posEven":
      return position % 2 === 0 ? 1n : 0n;
    case "posOdd":
      return position % 2 === 1 ? 1n : 0n;
  }
};

export const evaluateDiagramCondition = (
  hierarchy: DiagramHierarchy,
  context: DiagramHierarchyNode,
  condition: DiagramCondition,
  scope?: DiagramVariables,
): boolean => {
  const actual = diagramConditionValue(hierarchy, context, condition, scope);
  const expected = condition.value;
  switch (condition.operator) {
    case "equ":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
      return actual > expected;
    case "gte":
      return actual >= expected;
    case "lt":
      return actual < expected;
    case "lte":
      return actual <= expected;
  }
};
