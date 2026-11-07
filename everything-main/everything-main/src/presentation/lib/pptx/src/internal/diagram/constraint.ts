import { type XmlElement, NS, getAttrValue, qname } from "../xml/index.ts";
import type { DiagramLayoutNode } from "./layout.ts";
import {
  type DiagramPointSelection,
  readDiagramPointSelection,
} from "./iterator.ts";

const constraintTypes = [
  "none",
  "alignOff",
  "b",
  "begMarg",
  "begPad",
  "bendDist",
  "bMarg",
  "bOff",
  "connDist",
  "ctrX",
  "ctrXOff",
  "ctrY",
  "ctrYOff",
  "diam",
  "endMarg",
  "endPad",
  "h",
  "hArH",
  "hOff",
  "l",
  "lMarg",
  "lOff",
  "r",
  "rMarg",
  "rOff",
  "primFontSz",
  "pyraAcctRatio",
  "secFontSz",
  "sibSp",
  "secSibSp",
  "sp",
  "stemThick",
  "t",
  "tMarg",
  "tOff",
  "userA",
  "userB",
  "userC",
  "userD",
  "userE",
  "userF",
  "userG",
  "userH",
  "userI",
  "userJ",
  "userK",
  "userL",
  "userM",
  "userN",
  "userO",
  "userP",
  "userQ",
  "userR",
  "userS",
  "userT",
  "userU",
  "userV",
  "userW",
  "userX",
  "userY",
  "userZ",
  "w",
  "wArH",
  "wOff",
] as const;
export type DiagramConstraintType = (typeof constraintTypes)[number];
export interface DiagramConstraintSelector {
  readonly relationship: "self" | "ch" | "des";
  readonly name: string;
  readonly pointType: DiagramPointSelection;
}
export interface DiagramConstraintProperty {
  readonly type: DiagramConstraintType;
  readonly selector: DiagramConstraintSelector;
}
export interface DiagramConstraint {
  readonly element: XmlElement;
  readonly target: DiagramConstraintProperty;
  readonly reference: DiagramConstraintProperty;
  readonly operator: "none" | "equ" | "gte" | "lte";
  /** Original declared units: geometry in mm, font sizes in points. */
  readonly value: number;
  /** Multiplies a reference; does not multiply an absolute value. */
  readonly factor: number;
}
export interface DiagramConstraintRule {
  readonly element: XmlElement;
  readonly target: DiagramConstraintProperty;
  /** NaN is the schema's unspecified value; INF permits unbounded growth. */
  readonly value: number;
  readonly factor: number;
  readonly maximum: number;
}
export interface DiagramConstraintRuleMode {
  readonly kind: "value" | "factor" | "maximum";
  readonly value: number;
}

/**
 * Exactly one numeric mode is required, including when no adjustment is
 * needed. Keep the raw schema reader lossless; validate this execution rule
 * separately. Explicit NaN attributes mean unspecified, not an extra mode.
 */
export const diagramConstraintRuleMode = (
  rule: DiagramConstraintRule,
): DiagramConstraintRuleMode => {
  const modes: DiagramConstraintRuleMode[] = [
    { kind: "value", value: rule.value },
    { kind: "factor", value: rule.factor },
    { kind: "maximum", value: rule.maximum },
  ];
  const specified = modes.filter((mode) => !Number.isNaN(mode.value));
  if (specified.length !== 1)
    throw new Error("invalid diagram rule numeric mode");
  return specified[0]!;
};
export interface DiagramConstraintBinding {
  readonly property: DiagramConstraintProperty;
  readonly constraints: readonly DiagramConstraint[];
  readonly rules: readonly DiagramConstraintRule[];
}
export interface DiagramConstraintScope {
  readonly owner: DiagramLayoutNode;
  readonly bindings: readonly DiagramConstraintBinding[];
  /** Exact declaration lookup in this scope, not a search through layout nodes. */
  binding(property: DiagramConstraintProperty): DiagramConstraintBinding | null;
}

const attribute = (element: XmlElement, name: string): string | null =>
  getAttrValue(element, qname("", name, ""));
const trimXmlSpace = (value: string): string =>
  value.replace(/^[\t\r\n ]+|[\t\r\n ]+$/g, "");
const token = (
  element: XmlElement,
  name: string,
  fallback?: string,
): string => {
  const value = attribute(element, name);
  if (value === null && fallback === undefined)
    throw new Error(`diagram ${element.name.localName} is missing ${name}`);
  return trimXmlSpace(value ?? fallback!);
};
const enumeration = <T extends string>(
  value: string,
  allowed: readonly T[],
): T => {
  if (!allowed.includes(value as T))
    throw new Error(`invalid diagram constraint token ${value}`);
  return value as T;
};
const number = (
  element: XmlElement,
  name: string,
  fallback: number,
): number => {
  const raw = attribute(element, name);
  if (raw === null) return fallback;
  const value = trimXmlSpace(raw);
  // XML Schema doubles are not JavaScript numeric literals: hex, empty text,
  // and Infinity are invalid; INF/-INF and NaN are valid and must survive.
  if (value === "INF") return Infinity;
  if (value === "-INF") return -Infinity;
  if (value === "NaN") return NaN;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
    throw new Error(`invalid diagram constraint number ${name}=${raw}`);
  return Number(value);
};
const requireElement = (element: XmlElement, localName: string): void => {
  if (
    element.name.namespaceURI !== NS.diagram ||
    element.name.localName !== localName
  )
    throw new Error(`expected diagram ${localName}`);
};
const property = (
  element: XmlElement,
  reference = false,
): DiagramConstraintProperty => ({
  type: enumeration(
    token(
      element,
      reference ? "refType" : "type",
      reference ? "none" : undefined,
    ),
    constraintTypes,
  ),
  selector: {
    relationship: enumeration(
      token(element, reference ? "refFor" : "for", "self"),
      ["self", "ch", "des"],
    ),
    // forName/refForName are xsd:string, not token or ID; spaces are significant.
    name: attribute(element, reference ? "refForName" : "forName") ?? "",
    pointType: readDiagramPointSelection(
      token(element, reference ? "refPtType" : "ptType", "all"),
      "diagram constraint",
    ),
  },
});

/** ECMA-376 CT_Constraint, preserving selectors and numeric schema defaults. */
export const readDiagramConstraint = (
  element: XmlElement,
): DiagramConstraint => {
  requireElement(element, "constr");
  return {
    element,
    target: property(element),
    reference: property(element, true),
    operator: enumeration(token(element, "op", "none"), [
      "none",
      "equ",
      "gte",
      "lte",
    ]),
    value: number(element, "val", 0),
    factor: number(element, "fact", 1),
  };
};

/** CT_NumericRule changes an existing constraint; it is not a base assignment. */
export const readDiagramConstraintRule = (
  element: XmlElement,
): DiagramConstraintRule => {
  requireElement(element, "rule");
  return {
    element,
    target: property(element),
    value: number(element, "val", NaN),
    factor: number(element, "fact", NaN),
    maximum: number(element, "max", NaN),
  };
};

/**
 * Evaluate a constraint's right-hand side after its reference is resolved.
 * The referenced numeric value is multiplied in its declared units, then
 * interprets the result in the target's units. In particular, a reference from
 * font size 18pt to height with factor 3 gives 54mm, not 19.05mm. Operators and
 * adjustment rules are not evaluated here. Missing references are not zero.
 */
export const diagramConstraintValue = (
  constraint: DiagramConstraint,
  referencedValue?: number,
): number => {
  if (constraint.reference.type === "none") return constraint.value;
  if (referencedValue === undefined)
    throw new Error("unresolved diagram constraint reference");
  return referencedValue * constraint.factor;
};

/**
 * norm/nonAsst and asst/nonNorm are treated as the same constraint
 * selectors, including reference/rule lookup and duplicate-base validation.
 * Other selectors retain distinct identities even when their selected nodes
 * happen to coincide. Preserve authored spellings in the parsed declarations.
 */
export const diagramConstraintPropertyKey = ({
  type,
  selector,
}: DiagramConstraintProperty): string =>
  JSON.stringify([
    selector.relationship,
    selector.name,
    selector.pointType === "nonAsst"
      ? "norm"
      : selector.pointType === "nonNorm"
        ? "asst"
        : selector.pointType,
    type,
  ]);

/**
 * Index one node's active declarations without evaluating or applying them.
 * References and rules identify constraint variables by their complete target
 * descriptor, not the eventual set of shapes that a descriptor might select.
 * In particular, an ancestor cannot reference a child's local declaration as
 * though it had been declared in the ancestor's ch/des scope. Likewise, all,
 * node and norm selectors remain distinct keys even when they select the
 * same nodes. Only the defined point-type aliases share a key. This index
 * contains authored declarations only: a rule-only binding can later resolve
 * an implicit self value supplied by the algorithm or an applied constraint.
 *
 * Algorithm defaults, derived dimensions, adjustments and constraint solving
 * belong to the evaluator. Keep all operators/declarations for that stage;
 * never silently turn a bound or a zero-valued equality into an assignment.
 */
export const readDiagramConstraintScope = (
  owner: DiagramLayoutNode,
): DiagramConstraintScope => {
  const byKey = new Map<
    string,
    {
      property: DiagramConstraintProperty;
      constraints: DiagramConstraint[];
      rules: DiagramConstraintRule[];
    }
  >();
  const get = (target: DiagramConstraintProperty) => {
    const key = diagramConstraintPropertyKey(target);
    let binding = byKey.get(key);
    if (!binding) {
      binding = { property: target, constraints: [], rules: [] };
      byKey.set(key, binding);
    }
    return binding;
  };
  for (const element of owner.constraints) {
    const constraint = readDiagramConstraint(element);
    get(constraint.target).constraints.push(constraint);
  }
  for (const element of owner.rules) {
    const rule = readDiagramConstraintRule(element);
    get(rule.target).rules.push(rule);
  }
  return {
    owner,
    bindings: [...byKey.values()],
    binding: (target) =>
      byKey.get(diagramConstraintPropertyKey(target)) ?? null,
  };
};
