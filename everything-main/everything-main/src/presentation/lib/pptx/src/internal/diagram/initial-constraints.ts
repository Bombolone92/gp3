import type { DiagramLayoutSize } from "./arrange.ts";
import type { DiagramLayoutNode } from "./layout.ts";
import type { DiagramCompositeCoordinates } from "./composite.ts";
import { deriveDiagramCompositeAxis } from "./composite-axis.ts";
import {
  compatibleDiagramEqualityValues,
  propagateDiagramEquality,
  type DiagramEqualityRelation,
  type DiagramEqualityValue,
} from "./equality.ts";
import {
  type DiagramConstraint,
  type DiagramConstraintProperty,
  type DiagramConstraintType,
  type DiagramConstraintRule,
  type DiagramConstraintSelector,
  type DiagramConstraintRuleMode,
  diagramConstraintRuleMode,
  diagramConstraintPropertyKey as serializePropertyKey,
  readDiagramConstraint,
  readDiagramConstraintRule,
} from "./constraint.ts";
import { selectDiagramConstraintTargets } from "./constraint-targets.ts";
import { matchesDiagramPointSelection } from "./iterator.ts";
import { getAttrValue, qname } from "../xml/index.ts";
import { DEFAULT_DIAGRAM_TEXT_FONT_SIZE } from "./text-customization.ts";

export interface DiagramInitialConstraints {
  /**
   * Rebuild this node and its descendants with the captured outer assignments
   * and parent geometry. Local changes/adjustments start afresh; supply retained
   * trials explicitly. Unrelated branches are not evaluated. Equality domains
   * outside this subtree remain the containing layout's responsibility.
   */
  evaluateScope(
    options?: DiagramScopeConstraintOptions,
  ): ReadonlyMap<DiagramLayoutNode, DiagramInitialConstraints>;
  /** Preferred values before adjustment rules, content fitting or arrangement. */
  readonly values: ReadonlyMap<DiagramConstraintType, number>;
  /**
   * Captured drawing extent, bounded by any supplied parent canvas. Composite
   * coordinates can restrict it even when a trial requests a larger preference.
   * Later live reference updates do not retroactively resize an earlier child.
   */
  readonly size: DiagramLayoutSize;
  /**
   * Composite coordinates used for physical placement. A fitted placement
   * retains its entrance coordinates even when live references later change.
   */
  readonly coordinates: DiagramCompositeCoordinates | null;
  /**
   * Automatic coordinate spans reserved before an active text aspect fit.
   * COMPOSITE projection consumes these spans; an unscaled child keeps its
   * fitted drawing extent. Local rules that already fit the axis reserve none.
   */
  readonly aspectReservation: Readonly<Partial<DiagramLayoutSize>> | undefined;
  /**
   * Axes allocated automatically by the containing COMPOSITE coordinates.
   * A local preference is distinct from this physical allocation. Rule and
   * equality ownership remain properties of their own constraint scopes.
   */
  readonly automaticDimensions: ReadonlySet<"w" | "h">;
  /** Active leading coordinate declarations, distinct from derived edges. */
  readonly leadingCoordinates: ReadonlySet<"l" | "t">;
  /**
   * Capture the completed allocation's unprojected coordinate expressions.
   * Reflow uses this immediately before fitting a COMPOSITE child. Unlike
   * captured placement coordinates, these expressions include completed
   * forward references. Evaluation is lazy: unused coordinates stay unused.
   */
  captureCompositeCoordinates(): DiagramCompositeCoordinates | null;
  /** Retained in execution order for the adjustment stage. */
  readonly constraints: readonly DiagramConstraint[];
  readonly rules: readonly DiagramConstraintRule[];
  reference(property: DiagramConstraintProperty): number;
  /**
   * Resolve a rule's existing writable variable and numeric limit. Null means
   * an unmatched variable, or a factor rule without a reference base in this
   * scope. This does not run the rule or choose a fitted value.
   */
  rulePlan(rule: DiagramConstraintRule): DiagramConstraintRulePlan | null;
  /**
   * Propagate one local fitting trial to other instances joined by equality
   * declarations. Returns self-slot changes for a subsequent evaluation; does
   * not choose the trial, rewrite parent declarations, or mutate this result.
   * Other properties of the initiating instance retain their local evaluation.
   * Position equalities require a coordinate-adjustment stage and reject here.
   */
  equalityChanges(
    type: DiagramConstraintType,
    value: number,
  ): readonly DiagramConstraintValueChange[];
  /**
   * Retain the owning scope of every propagated equality domain as well as
   * its physical projection. Parent reflow must distinguish an outer equality
   * domain from an otherwise identical domain inside the reevaluated subtree.
   * The caller decides when to retain or discard a trial; this is pure planning.
   */
  equalityTrial(
    type: DiagramConstraintType,
    value: number,
  ): DiagramEqualityTrial;
}
/** One fitted equality domain, distinct from the scope's authored expression. */
export interface DiagramEqualityScopeValue {
  readonly scope: DiagramLayoutNode;
  readonly property: DiagramConstraintProperty;
  readonly value: number;
}
export interface DiagramEqualityTrial {
  /** Physical self-slot values suitable for a subsequent constraint evaluation. */
  readonly changes: readonly DiagramConstraintValueChange[];
  /**
   * Fitted values keyed by declaring scope and canonical property identity.
   * Includes reference domains without physical slots and excludes domains
   * reached only by overlapping shape selections. These are NOT replacements
   * for authored declarations: their reference values remain unchanged.
   */
  readonly scopes: readonly DiagramEqualityScopeValue[];
}
export interface DiagramConstraintRulePlan {
  readonly rule: DiagramConstraintRule;
  readonly mode: DiagramConstraintRuleMode["kind"];
  readonly current: number;
  /** Infinity remains an unbounded limit, not a fabricated finite size. */
  readonly limit: number;
  /**
   * Another active property in this scope directly references this variable.
   * Dimension fitting uses this dependency information when selecting a path;
   * it is not a transitive relation or a test of the reference's numeric effect.
   */
  readonly hasCrossPropertyDependents: boolean;
}
/** One trial value for an existing scoped variable; never a source XML edit. */
export interface DiagramConstraintValueChange {
  readonly owner: DiagramLayoutNode;
  readonly property: DiagramConstraintProperty;
  readonly value: number;
}
export interface DiagramInitialConstraintOptions {
  /**
   * Trial rulers for COMPOSITE reference-envelope search. Automatic trailing
   * edges follow these rulers while retained physical allocations stay fixed.
   * The caller also supplies the corresponding parent dimension change, so
   * direct parent-dimension references use the same trial.
   */
  readonly compositeReferenceRulers?: ReadonlyMap<
    DiagramLayoutNode,
    Partial<DiagramLayoutSize>
  >;
  /** Entrance coordinates retained by an accepted COMPOSITE fitting pass. */
  readonly coordinateOrigins?: ReadonlyMap<
    DiagramLayoutNode,
    DiagramCompositeCoordinates
  >;
  /**
   * Physical fitted/input ratios for those same children. Explicit reference
   * declarations stay live; derived coordinates use the inverse projection.
   * Unlisted axes keep their ordinary allocation/reference semantics.
   */
  readonly coordinateScales?: ReadonlyMap<
    DiagramLayoutNode,
    Partial<DiagramLayoutSize>
  >;
  /**
   * Physical axes already bounded by parent arrangement. Preferences and
   * reference variables remain independently evaluable; subsequent drawing
   * extents and local dimension-rule limits cannot exceed these canvases.
   * Unlisted axes remain free, including height growth after width fitting.
   * Entries outside a locally evaluated subtree are not consumed.
   */
  readonly canvases?: ReadonlyMap<
    DiagramLayoutNode,
    Partial<DiagramLayoutSize>
  >;
  /**
   * Accepted allocation pass for this same expanded layout. Automatic composite
   * dimensions retain its reserved space while explicit dimensions and live
   * positions use this pass's drawing values. Supply only scopes whose
   * allocations survive the current reflow; local scope trials reset this map.
   * Results must come from this evaluator, not fabricated drawing rectangles.
   */
  readonly allocations?: ReadonlyMap<
    DiagramLayoutNode,
    DiagramInitialConstraints
  >;
  /**
   * Realize initial font constraints in whole points as each layout scope is
   * visited. Fonts in one scope are read from the same unrounded snapshot;
   * descendants then inherit the realized ancestor declarations. References,
   * factor-rule bases and equality relationships remain authored expressions.
   * Explicit rule adjustments are already fitted values and are not rounded.
   * Omitted/false retains the raw, expression-only initial evaluation.
   */
  readonly quantizeFonts?: boolean;
  /** Resolve the TX algorithm's initial aspect constraint before fitting.
   * Automatic composite coordinates retain their parent allocation. */
  readonly constrainTextAspect?: boolean;
  /**
   * Trial values already chosen by adjustment/content fitting. A self variable
   * changes one node's effective value; a ch/des declaration changes its scoped
   * expression and all dependent references. This pass does not choose trial
   * values, apply rules, or synchronize equality groups.
   *
   * Changes require an existing declaration or implicit self variable. Implicit
   * composite child coordinates are produced during execution, not writable
   * declarations. Duplicate changes through aliases of one variable reject.
   * With quantizeFonts, these expression replacements participate in initial
   * font realization; use adjustments for already fitted font values.
   */
  readonly changes?: readonly DiagramConstraintValueChange[];
  /**
   * Ordered numeric rule trials, applied after expression-only changes. Each
   * application replaces its scoped variable and writes the selected physical
   * slots, even if another declaration supplied their initial values. Later
   * applications win on overlapping slots while separate declaration values
   * remain independently referenceable. Repeated applications are permitted.
   *
   * The caller chooses trial values and synchronizes equality/content fitting;
   * this pass only reevaluates their effects. Position applications require a
   * coordinate-adjustment stage and are not supported here.
   */
  readonly adjustments?: readonly DiagramConstraintValueChange[];
  /**
   * Customized TX primary fonts own their physical slots after ancestor rule
   * applications. Keep ancestor declaration variables live for geometry while
   * realizing these unrounded local values in the normal initial font phase.
   * Scoped evaluations apply overrides only to nodes in that scope.
   */
  readonly primaryFontOverrides?: ReadonlyMap<DiagramLayoutNode, number>;
  /**
   * Caller-supplied numeric defaults override algorithm defaults. TX supplies
   * a primary font plus live secondary-font and margin defaults; authored
   * assignments override both. Custom-text fonts use primaryFontOverrides when
   * an ancestor adjustment must retain its separate algorithm variable.
   */
  readonly defaults?: (
    node: DiagramLayoutNode,
  ) => ReadonlyMap<DiagramConstraintType, number>;
  readonly maxOperations?: number;
}
export interface DiagramScopeConstraintOptions extends DiagramInitialConstraintOptions {
  /**
   * Retain this snapshot's local expression/rule trials. Explicit expression
   * changes replace the same scoped variable; ordered rule trials append.
   */
  readonly retainLocalTrials?: boolean;
  /**
   * Rebuild these dimensions from this scope's own declarations/defaults,
   * excluding incoming ancestor assignments on the scope root. Other axes,
   * inherited variables and reference expressions remain available. Linear
   * exhausted-content retries use this to ask a space leaf for its local
   * preference before capping it by the previously allocated canvas.
   */
  readonly localDimensions?: readonly ("w" | "h")[];
}
interface Cell {
  readonly name: string;
  activeEvaluation: object | undefined;
  changedValue: number | undefined;
  realizedValue: number | undefined;
  cacheGeneration: object | undefined;
  cachedValue: number | undefined;
  readonly literal: number | undefined;
  readonly directUnary: ((value: number) => number) | undefined;
  readonly directBinary: ((a: number, b: number) => number) | undefined;
  dependencies(): readonly Cell[];
  evaluate(values: readonly number[]): number;
}
interface Assignment {
  readonly cell: Cell;
  readonly owner: State;
}
interface State {
  readonly node: DiagramLayoutNode;
  readonly depth: number;
  readonly algorithm: string;
  readonly bindings: Map<string, Cell>;
  readonly reservedBindings: Set<string>;
  readonly assignments: Map<DiagramConstraintType, Assignment>;
  readonly selfSeen: Set<DiagramConstraintType>;
  readonly slots: Map<DiagramConstraintType, Cell>;
  readonly rawGeometry: Map<DiagramConstraintType, Cell>;
  readonly coordinates: Map<DiagramConstraintType, Cell>;
  referenceGeometry: Map<DiagramConstraintType, Cell> | null;
  projectionGeometry:
    { readonly [K in keyof DiagramCompositeCoordinates]: Cell } | null;
  readonly publishedGeometry: Map<
    string,
    ReadonlyMap<DiagramConstraintType, Cell>
  >;
  readonly imposedSizes: Map<DiagramConstraintType, number>;
  readonly sizeDefaults: Map<DiagramConstraintType, number>;
  readonly preferred: Map<DiagramConstraintType, number>;
  readonly size: { w: number; h: number };
  readonly baseKeys: Set<string>;
  readonly constraints: readonly DiagramConstraint[];
  readonly rules: readonly DiagramConstraintRule[];
  readonly defaults: ReadonlyMap<DiagramConstraintType, number>;
  readonly textDefaults: Set<DiagramConstraintType>;
  readonly targetIndexes: Map<
    string,
    {
      readonly all: readonly DiagramLayoutNode[];
      readonly names: ReadonlyMap<string, readonly DiagramLayoutNode[]>;
    }
  >;
}

interface ScopeBoundary {
  readonly work: number;
  readonly parent: State | undefined;
  readonly depth: number;
  readonly assignments: ReadonlyMap<
    DiagramLayoutNode,
    ReadonlyMap<DiagramConstraintType, { value: () => number; owner: State }>
  >;
  readonly geometry: ReadonlyMap<DiagramConstraintType, () => number>;
  readonly finalGeometry: ReadonlyMap<DiagramConstraintType, () => number>;
  readonly applications: readonly ScopeApplication[];
  readonly dimensionLimit: (node: DiagramLayoutNode, type: "w" | "h") => number;
}
interface ScopeApplication {
  readonly owner: State;
  readonly targets: readonly DiagramLayoutNode[];
  readonly type: DiagramConstraintType;
  readonly value: number;
}
interface AutomaticAxis {
  readonly preferred: number;
  readonly size: number;
  readonly coordinates: ReadonlyMap<DiagramConstraintType, number>;
}
const automaticGeometry = new WeakMap<
  DiagramInitialConstraints,
  {
    readonly node: DiagramLayoutNode;
    readonly axes: ReadonlyMap<"w" | "h", AutomaticAxis>;
  }
>();
// Self identities depend only on the finite constraint-type vocabulary. Reuse
// their serialized keys across trial scopes; never cache numeric values or XML.
const selfKeys = new Map<DiagramConstraintType, string>();
const propertyKey = (property: DiagramConstraintProperty): string => {
  const { type, selector } = property;
  if (
    selector.relationship !== "self" ||
    selector.name ||
    selector.pointType !== "all"
  )
    return serializePropertyKey(property);
  let key = selfKeys.get(type);
  if (key === undefined) {
    key = serializePropertyKey(property);
    selfKeys.set(type, key);
  }
  return key;
};
const self = (type: DiagramConstraintType): DiagramConstraintProperty => ({
  type,
  selector: { relationship: "self", name: "", pointType: "all" },
});
const geometry = new Set<DiagramConstraintType>([
  "l",
  "ctrX",
  "r",
  "w",
  "t",
  "ctrY",
  "b",
  "h",
]);
const positions = new Set<DiagramConstraintType>([
  "l",
  "ctrX",
  "r",
  "t",
  "ctrY",
  "b",
]);
const textProperties = new Set<DiagramConstraintType>([
  "primFontSz",
  "secFontSz",
  "lMarg",
  "rMarg",
  "tMarg",
  "bMarg",
]);
// The native reference starts an unconstrained TX dimension at 100 mm. A
// local literal zero selects this preference too; a referenced or ancestor-assigned zero is
// an actual zero. Composite-provided dimensions still supply omitted values.
// This is an initial preference, before parent fitting, not a minimum extent.
const DEFAULT_TEXT_DIMENSION_MM = 100;
// The reference text algorithm derives these defaults from the primary font,
// in points. They remain live during fitting, rather than capturing its initial
// value. Native controls cover custom fonts, explicit overrides and fractional
// sizes. Font quantization belongs to the later text-layout stage: rounding
// here would change references before all initial font values are calculated.
const textDefaultFactors = new Map<DiagramConstraintType, number>([
  ["secFontSz", 0.78],
  ["lMarg", 0.56],
  ["rMarg", 0.56],
  ["tMarg", 0.56],
  ["bMarg", 0.56],
]);
const userVariable = (type: DiagramConstraintType): boolean =>
  /^user[A-Z]$/.test(type);
const availableProperty = (
  type: DiagramConstraintType,
  algorithm: string,
): boolean =>
  type === "w" ||
  type === "h" ||
  userVariable(type) ||
  (algorithm === "tx" && textProperties.has(type)) ||
  (algorithm === "lin" && type === "sp");
const implementedProperty = (type: DiagramConstraintType): boolean =>
  geometry.has(type) ||
  textProperties.has(type) ||
  userVariable(type) ||
  type === "sp" ||
  type === "none";
const finite = (value: number): number => {
  if (!Number.isFinite(value))
    throw new Error("non-finite diagram constraint value");
  return value;
};
const operationBudget = (value = 1_000_000): number => {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("invalid diagram constraint operation budget");
  return value;
};

/**
 * Resolve the initial constraint environment for lin/composite/tx/sp layouts.
 * Scoped references and applied node values are separate: an inherited value
 * can acquire a local alias, and a later wildcard can change a node's value
 * without replacing an earlier named reference in the declaring scope.
 *
 * This is the initial-value pass, not a completed layout. Bounds, equality
 * groups and rules are retained for adjustment; they are not clamps on the
 * initial assignments. No text measurement, fallback scaling, drawing mutation
 * or saved-geometry approximation occurs here. Unsupported algorithms and
 * unevaluated property families fail explicitly.
 */
export const evaluateDiagramInitialConstraints = (
  root: DiagramLayoutNode,
  available: DiagramLayoutSize,
  options: DiagramInitialConstraintOptions = {},
): ReadonlyMap<DiagramLayoutNode, DiagramInitialConstraints> =>
  evaluateScope(root, available, options);

type Declarations = Pick<State, "constraints" | "rules">;

/**
 * Reuse parsed declarations during one reflow's numeric fitting trials. The
 * layout tree must remain unchanged for this evaluator's lifetime. Create a
 * new evaluator for each edit/reflow; numeric states, defaults, assignments
 * and geometry are rebuilt on every trial, including nested scope trials.
 * Standalone evaluation keeps its existing fresh-declaration behavior.
 */
export const createDiagramConstraintEvaluator = (root: DiagramLayoutNode) => {
  const declarations = new Map<DiagramLayoutNode, Declarations>();
  return (
    available: DiagramLayoutSize,
    options: DiagramInitialConstraintOptions = {},
  ): ReadonlyMap<DiagramLayoutNode, DiagramInitialConstraints> =>
    evaluateScope(root, available, options, undefined, declarations);
};

const evaluateScope = (
  root: DiagramLayoutNode,
  available: DiagramLayoutSize,
  options: DiagramInitialConstraintOptions,
  boundary?: ScopeBoundary,
  declarations?: Map<DiagramLayoutNode, Declarations>,
): ReadonlyMap<DiagramLayoutNode, DiagramInitialConstraints> => {
  if (finite(available.w) < 0 || finite(available.h) < 0)
    throw new Error("negative diagram constraint available size");
  const maximum = operationBudget(options.maxOperations);
  let operations = boundary?.work ?? 0;
  const consume = (): void => {
    if (++operations > maximum)
      throw new Error("diagram constraint operation budget exceeded");
  };
  const cell = (
    name: string,
    dependencies: () => readonly Cell[],
    evaluate: Cell["evaluate"],
    literal?: number,
    directUnary?: (value: number) => number,
    directBinary?: (a: number, b: number) => number,
  ): Cell => {
    consume();
    return {
      name,
      dependencies,
      evaluate,
      literal,
      directUnary,
      directBinary,
      cacheGeneration: undefined,
      cachedValue: undefined,
      activeEvaluation: undefined,
      changedValue: undefined,
      realizedValue: undefined,
    };
  };
  const constant = (value: number): Cell =>
    cell(
      String(value),
      () => [],
      () => finite(value),
      value,
    );
  const zero = constant(0);
  const unary = (
    name: string,
    a: Cell,
    fn: (value: number) => number,
  ): Cell => {
    const dependencies = [a];
    return cell(
      name,
      () => dependencies,
      ([v]) => fn(v!),
      undefined,
      fn,
    );
  };
  const binary = (
    name: string,
    a: Cell,
    b: Cell,
    fn: (a: number, b: number) => number,
  ): Cell => {
    const dependencies = [a, b];
    return cell(
      name,
      () => dependencies,
      ([a, b]) => fn(a!, b!),
      undefined,
      undefined,
      fn,
    );
  };
  const states = new Map<DiagramLayoutNode, State>();
  const order: State[] = [];
  const pending = [{ node: root, depth: boundary?.depth ?? 0 }];
  while (pending.length) {
    consume();
    const { node, depth } = pending.pop()!;
    const algorithm =
      node.algorithm && getAttrValue(node.algorithm, qname("", "type", ""));
    if (!algorithm || !["lin", "composite", "tx", "sp"].includes(algorithm))
      throw new Error(`unsupported diagram constraint algorithm ${algorithm}`);
    let parsed = declarations?.get(node);
    if (!parsed) {
      parsed = {
        constraints: node.constraints.map(readDiagramConstraint),
        rules: node.rules.map(readDiagramConstraintRule),
      };
      declarations?.set(node, parsed);
    }
    const state: State = {
      node,
      depth,
      algorithm,
      bindings: new Map(),
      reservedBindings: new Set(),
      assignments: new Map(),
      selfSeen: new Set(),
      slots: new Map(),
      rawGeometry: new Map(),
      coordinates: new Map(),
      referenceGeometry: null,
      projectionGeometry: null,
      publishedGeometry: new Map(),
      imposedSizes: new Map(),
      sizeDefaults: new Map(),
      preferred: new Map(),
      size: { w: 0, h: 0 },
      baseKeys: new Set(),
      constraints: parsed.constraints,
      rules: parsed.rules,
      defaults: new Map([
        ...(algorithm === "tx"
          ? ([["primFontSz", DEFAULT_DIAGRAM_TEXT_FONT_SIZE]] as const)
          : []),
        ...(options.defaults?.(node) ?? []),
      ]),
      textDefaults: new Set(),
      targetIndexes: new Map(),
    };
    for (const rule of state.rules) {
      consume();
      diagramConstraintRuleMode(rule);
    }
    for (const [type, value] of state.defaults) {
      finite(value);
      if (!availableProperty(type, algorithm))
        throw new Error(`unavailable diagram default ${type}`);
    }
    states.set(node, state);
    order.push(state);
    for (let i = node.children.length - 1; i >= 0; --i)
      pending.push({ node: node.children[i]!, depth: depth + 1 });
  }
  for (const s of order)
    for (const [type, inherited] of boundary?.assignments.get(s.node) ?? []) {
      consume();
      s.assignments.set(type, {
        cell: cell("outer assignment", () => [], inherited.value),
        owner: inherited.owner,
      });
    }
  const allocations = new Map<
    DiagramLayoutNode,
    ReadonlyMap<"w" | "h", AutomaticAxis>
  >();
  for (const [node, result] of options.allocations ?? []) {
    consume();
    if (!states.has(node)) throw new Error("unknown diagram allocation owner");
    const geometry = automaticGeometry.get(result);
    if (!geometry || geometry.node !== node)
      throw new Error("invalid diagram allocation source");
    allocations.set(node, geometry.axes);
  }
  // A forward reference in the parent can change after this subtree returns.
  // Reproduce its entrance value while capturing local geometry, then expose
  // its final value to live references. A single frozen value loses one phase.
  let completed = false;
  for (const [type, value] of boundary?.geometry ?? [])
    states.get(root)!.rawGeometry.set(
      type,
      cell(
        "outer geometry",
        () => [],
        () => (completed ? boundary!.finalGeometry.get(type)!() : value()),
      ),
    );
  const parentOf = (s: State): State | undefined =>
    s.node === root
      ? boundary?.parent
      : s.node.parent
        ? states.get(s.node.parent)
        : undefined;
  const targetsFor = (
    s: State,
    selector: DiagramConstraintSelector,
  ): readonly DiagramLayoutNode[] => {
    if (selector.relationship === "self")
      return selectDiagramConstraintTargets(s.node, selector);
    let index = s.targetIndexes.get(selector.relationship);
    if (!index) {
      const all = selectDiagramConstraintTargets(s.node, {
        relationship: selector.relationship,
        name: "",
        pointType: "all",
      });
      const names = new Map<string, DiagramLayoutNode[]>();
      for (const node of all) {
        consume();
        const group = names.get(node.name);
        if (group) group.push(node);
        else names.set(node.name, [node]);
      }
      index = { all, names };
      s.targetIndexes.set(selector.relationship, index);
    }
    const nodes = selector.name
      ? (index.names.get(selector.name) ?? [])
      : index.all;
    return nodes.filter((node) => {
      consume();
      return matchesDiagramPointSelection(node.context, selector.pointType);
    });
  };
  const slot = (s: State, type: DiagramConstraintType): Cell => {
    let result = s.slots.get(type);
    if (!result) {
      result = cell(
        `${s.node.name}.${type}`,
        () => {
          const imposed = s.imposedSizes.get(type);
          if (imposed !== undefined) return [constant(imposed)];
          const assignment = s.assignments.get(type);
          if (assignment) return [assignment.cell];
          if (
            s.node === root &&
            !boundary?.parent &&
            (type === "w" || type === "h")
          )
            return [constant(available[type])];
          const fallback = s.defaults.get(type);
          if (fallback !== undefined) return [constant(fallback)];
          if (s.textDefaults.has(type))
            return [
              unary(
                "text default",
                slot(s, "primFontSz"),
                (value) => value * textDefaultFactors.get(type)!,
              ),
            ];
          if (type === "w" || type === "h")
            return [
              constant(
                s.sizeDefaults.get(type) ??
                  (s.algorithm === "tx" ? DEFAULT_TEXT_DIMENSION_MM : 0),
              ),
            ];
          throw new Error(`unavailable implicit diagram value ${type}`);
        },
        ([value]) => value!,
      );
      s.slots.set(type, result);
    }
    return result;
  };
  const lookup = (s: State, property: DiagramConstraintProperty): Cell => {
    const { selector, type } = property;
    // Unlike lin, composite registers its named children's geometric variables
    // implicitly. References see derived values, even when the contributing
    // width/height was declared on the child rather than in the parent scope.
    if (
      s.algorithm === "composite" &&
      selector.relationship === "ch" &&
      selector.pointType === "all" &&
      geometry.has(type) &&
      selector.name
    ) {
      if (targetsFor(s, selector).length)
        return (
          s.publishedGeometry.get(selector.name)?.get(type) ??
          s.bindings.get(propertyKey(property)) ??
          zero
        );
    }
    const result = s.bindings.get(propertyKey(property));
    if (!result)
      throw new Error(
        `unresolved diagram constraint ${propertyKey(property)} in ${s.node.name}`,
      );
    return result;
  };
  const assign = (
    s: State,
    type: DiagramConstraintType,
    value: Cell,
    owner: State,
  ): void => {
    consume();
    const previous = s.assignments.get(type);
    // An ancestor assignment overrides a node's own fallback declaration, but
    // among ancestors the nearest declaring scope wins. Root descendant
    // declarations must not suppress a nearer parent's child declaration.
    if (
      !previous ||
      previous.owner === s ||
      (owner !== s && owner.depth >= previous.owner.depth)
    )
      s.assignments.set(type, { cell: value, owner });
  };
  const activeSelfBases = new Map<Cell, DiagramConstraint>();
  const declaredBases = new Map<Cell, DiagramConstraint>();
  for (const s of order) {
    for (const type of new Set<DiagramConstraintType>([
      "w",
      "h",
      ...s.assignments.keys(),
      ...s.defaults.keys(),
    ]))
      if (availableProperty(type, s.algorithm))
        s.bindings.set(propertyKey(self(type)), slot(s, type));
    for (const c of s.constraints) {
      consume();
      if (!implementedProperty(c.target.type))
        throw new Error(
          `unsupported initial diagram constraint ${c.target.type}`,
        );
      // equ with no reference and a zero value establishes an adjustment group;
      // it does not assign zero. none/zero is an ordinary base assignment.
      const base =
        (c.operator === "none" || c.operator === "equ") &&
        !(c.operator === "equ" && c.reference.type === "none" && c.value === 0);
      if (!base) continue;
      const key = propertyKey(c.target);
      if (s.baseKeys.has(key))
        throw new Error(`duplicate diagram constraint base ${key}`);
      s.baseKeys.add(key);
      const expression =
        c.reference.type === "none"
          ? constant(
              s.algorithm === "tx" &&
                c.target.selector.relationship === "self" &&
                (c.target.type === "w" || c.target.type === "h") &&
                c.value === 0
                ? DEFAULT_TEXT_DIMENSION_MM
                : c.value,
            )
          : cell(
              key,
              () => [lookup(s, c.reference)],
              ([value]) => value! * c.factor,
            );
      const targets = targetsFor(s, c.target.selector);
      const type = c.target.type;
      if (c.target.selector.relationship === "self") {
        if (!targets.length || !availableProperty(type, s.algorithm)) continue;
        // Dimension/font/margin variables retain their first local declaration.
        // User variables share the last same-scope value across declared aliases.
        // In both cases, an ancestor assignment retains priority over local ones.
        if (s.selfSeen.has(type) && !userVariable(type)) continue;
        s.selfSeen.add(type);
        assign(s, type, expression, s);
        if (s.assignments.get(type)?.cell === expression)
          activeSelfBases.set(slot(s, type), c);
        s.bindings.set(key, slot(s, type));
        s.bindings.set(propertyKey(self(type)), slot(s, type));
      } else {
        // A declaration creates a scoped variable independently of the shapes
        // it selects. The native reference retains unmatched names and empty
        // point-type selections for subsequent references and rules; only application to
        // physical slots depends on the selected nodes.
        if (s.reservedBindings.has(key))
          throw new Error(`duplicate diagram constraint binding ${key}`);
        s.reservedBindings.add(key);
        s.bindings.set(key, expression);
        declaredBases.set(expression, c);
        // Wildcards reserve matching child names against later declarations,
        // but do not declare those names as reference variables. Earlier named
        // declarations remain referenceable even when a wildcard changes the
        // applied values. Native lin controls distinguish all three cases.
        if (!c.target.selector.name)
          for (const target of targets) {
            consume();
            const alias = propertyKey({
              type,
              selector: { ...c.target.selector, name: target.name },
            });
            s.reservedBindings.add(alias);
          }
        for (const node of targets) {
          consume();
          const target = states.get(node)!;
          if (
            s.algorithm === "composite" &&
            c.target.selector.relationship === "ch" &&
            geometry.has(type)
          ) {
            // Composite geometry variables use the all selector. A typed
            // declaration remains addressable but does not drive its bounds.
            if (c.target.selector.pointType !== "all") continue;
            target.rawGeometry.set(type, expression);
          }
          if (!positions.has(type)) assign(target, type, expression, s);
        }
      }
    }
  }
  // Register derived values after all declarations, so inherited, local and
  // default primary fonts work alike and forward references to an implicit
  // secondary font or margin resolve.
  for (const s of order) {
    consume();
    if (s.algorithm !== "tx") continue;
    for (const type of textDefaultFactors.keys()) {
      s.textDefaults.add(type);
      const key = propertyKey(self(type));
      if (!s.bindings.has(key)) s.bindings.set(key, slot(s, type));
    }
  }
  // A local adjustment changes the physical slot, not its ancestor's authored
  // expression. Native font and height probes distinguish those two variables.
  // Conversely, changing a parent's declaration updates references in that
  // scope as well as the values applied to its children.
  const changes = new Map<Cell, number>();
  for (const change of options.changes ?? []) {
    consume();
    const state = states.get(change.owner);
    if (!state) throw new Error("unknown diagram change owner");
    const target = state.bindings.get(propertyKey(change.property));
    if (!target) throw new Error("unresolved diagram change variable");
    if (changes.has(target))
      throw new Error("duplicate diagram change variable");
    changes.set(target, finite(change.value));
  }
  const adjustedCells =
    options.quantizeFonts || options.constrainTextAspect
      ? new Set<Cell>()
      : null;
  const applications: ScopeApplication[] = [...(boundary?.applications ?? [])];
  for (const application of applications)
    for (const node of application.targets) {
      consume();
      const selected = slot(states.get(node)!, application.type);
      changes.set(selected, application.value);
      adjustedCells?.add(selected);
    }
  for (const adjustment of options.adjustments ?? []) {
    consume();
    const state = states.get(adjustment.owner);
    if (!state) throw new Error("unknown diagram adjustment owner");
    const { property } = adjustment,
      target = state.bindings.get(propertyKey(property));
    if (!target) throw new Error("unresolved diagram adjustment variable");
    if (positions.has(property.type))
      throw new Error("unsupported diagram position adjustment");
    const value = finite(adjustment.value);
    changes.set(target, value);
    adjustedCells?.add(target);
    // A rule is a new application, not a replacement of an old expression at
    // its original place in the declaration list. Scoped aliases can select
    // overlapping shapes without sharing the same reference variable.
    const targets: DiagramLayoutNode[] = [];
    for (const node of targetsFor(state, property.selector)) {
      consume();
      const selected = states.get(node)!;
      if (availableProperty(property.type, selected.algorithm)) {
        const selectedSlot = slot(selected, property.type);
        changes.set(selectedSlot, value);
        adjustedCells?.add(selectedSlot);
        targets.push(node);
      }
    }
    applications.push({ owner: state, targets, type: property.type, value });
  }
  if (options.primaryFontOverrides)
    for (const state of order) {
      consume();
      const value = options.primaryFontOverrides.get(state.node);
      if (value === undefined) continue;
      if (state.algorithm !== "tx")
        throw new Error("diagram primary font override requires a text node");
      const target = slot(state, "primFontSz");
      changes.set(target, finite(value));
      // These are authored inputs, not already fitted numeric rule values.
      // Primary and secondary must still quantize from one unrounded snapshot.
      adjustedCells?.delete(target);
    }
  // Realized values are not expression replacements. In particular, font
  // quantization must not erase a factor rule's base or an equality edge.
  for (const [cell, value] of changes) cell.changedValue = value;
  // Cells belong to a single evaluation graph. A fresh token invalidates its
  // values after a realized font, aspect limit, or geometry phase changes.
  // Nested scopes have distinct tokens, even if a boundary shares a cell.
  let cacheGeneration: object = {};
  const aspectReservations = new Map<State, Partial<DiagramLayoutSize>>();
  const textAspectLimits = new Map<
    State,
    { axis: "w" | "h"; limit: number; applied: boolean }
  >();
  const evaluate = (root: Cell): number => {
    const cached =
      root.cacheGeneration === cacheGeneration ? root.cachedValue : undefined;
    if (cached !== undefined) return cached;
    const overridden = root.realizedValue ?? root.changedValue;
    if (overridden !== undefined || root.literal !== undefined) {
      consume();
      const value = overridden ?? finite(root.literal!);
      root.cacheGeneration = cacheGeneration;
      root.cachedValue = value;
      return value;
    }
    const active = {};
    const stack: {
      cell: Cell;
      index: number;
      dependencies: readonly Cell[] | null;
    }[] = [{ cell: root, index: 0, dependencies: null }];
    while (stack.length) {
      consume();
      const frame = stack[stack.length - 1]!,
        current = frame.cell;
      if (current.cacheGeneration === cacheGeneration) {
        stack.pop();
        continue;
      }
      const overridden = current.realizedValue ?? current.changedValue;
      if (overridden !== undefined || current.literal !== undefined) {
        current.cacheGeneration = cacheGeneration;
        current.cachedValue = overridden ?? finite(current.literal!);
        stack.pop();
        continue;
      }
      if (frame.dependencies === null) {
        current.activeEvaluation = active;
        frame.dependencies = current.dependencies();
      }
      if (frame.index < frame.dependencies.length) {
        const dependency = frame.dependencies[frame.index++]!;
        if (dependency.activeEvaluation === active)
          throw new Error(
            `cyclic diagram constraint reference ${dependency.name}`,
          );
        if (dependency.cacheGeneration !== cacheGeneration)
          stack.push({ cell: dependency, index: 0, dependencies: null });
        continue;
      }
      current.cachedValue = finite(
        current.directUnary
          ? current.directUnary(frame.dependencies[0]!.cachedValue!)
          : current.directBinary
            ? current.directBinary(
                frame.dependencies[0]!.cachedValue!,
                frame.dependencies[1]!.cachedValue!,
              )
            : current.evaluate(frame.dependencies.map((d) => d.cachedValue!)),
      );
      current.cacheGeneration = cacheGeneration;
      current.activeEvaluation = undefined;
      stack.pop();
    }
    return root.cachedValue!;
  };
  const axes = [
    ["l", "ctrX", "r", "w"],
    ["t", "ctrY", "b", "h"],
  ] as const;
  const arithmetic = {
    zero,
    add: (a: Cell, b: Cell) => binary("sum", a, b, (a, b) => a + b),
    subtract: (a: Cell, b: Cell) => binary("difference", a, b, (a, b) => a - b),
    scale: (value: Cell, factor: number) =>
      unary("scale", value, (value) => value * factor),
    absolute: (value: Cell) => unary("extent", value, Math.abs),
  };
  const preferred = (
    s: State,
    automaticWidth = false,
    automaticHeight = false,
  ): void => {
    if (options.quantizeFonts) {
      const fonts = new Set<Cell>();
      for (const property of [
        self("primFontSz"),
        self("secFontSz"),
        ...s.constraints.map((constraint) => constraint.target),
      ]) {
        consume();
        if (property.type !== "primFontSz" && property.type !== "secFontSz")
          continue;
        const binding = s.bindings.get(propertyKey(property));
        if (binding && !adjustedCells?.has(binding)) fonts.add(binding);
      }
      // Capture both fonts before publishing either. For example, primary
      // 1.9 and secondary primary*.78 become 2 and 1 in this scope. A child
      // inheriting that primary instead starts from 2 and derives secondary 2.
      // A TX-local numeric font starts at least at 1pt BEFORE dependent fonts
      // are calculated. Referenced/inherited values and container declarations
      // have no such floor: .2 can round to zero and drive zero-sized geometry.
      const minimums: (readonly [Cell, number])[] = [];
      if (s.algorithm === "tx")
        for (const type of ["primFontSz", "secFontSz"] as const) {
          const binding = s.bindings.get(propertyKey(self(type)));
          if (!binding || !fonts.has(binding)) continue;
          const base = activeSelfBases.get(binding);
          if (
            changes.has(binding) ||
            base?.reference.type === "none" ||
            (!s.assignments.has(type) && s.defaults.has(type))
          )
            minimums.push([binding, Math.max(1, evaluate(binding))]);
        }
      for (const [binding, value] of minimums) binding.realizedValue = value;
      if (minimums.length) cacheGeneration = {};
      const snapshot = [...fonts].map(
        (binding) => [binding, Math.round(evaluate(binding))] as const,
      );
      for (const [binding, value] of snapshot) binding.realizedValue = value;
      if (snapshot.length) cacheGeneration = {};
    }
    if (options.constrainTextAspect && s.algorithm === "tx") {
      // TX consumes the first dimension inequality as an aspect constraint.
      // Either geometric refType selects this path; aliases, literals and
      // font references remain ordinary fitting bounds. Native controls also
      // distinguish first-match order from intersecting all inequalities.
      const aspect = s.constraints.find((c) => {
        consume();
        return (
          (c.operator === "lte" || c.operator === "gte") &&
          (c.target.type === "w" || c.target.type === "h") &&
          (c.reference.type === "w" || c.reference.type === "h")
        );
      });
      if (aspect) {
        for (const selector of [
          aspect.target.selector,
          aspect.reference.selector,
        ])
          if (
            selector.relationship !== "self" ||
            selector.name ||
            selector.pointType !== "all"
          )
            throw new Error("unsupported diagram text aspect selector");
        if (!Number.isFinite(aspect.factor) || aspect.factor <= 0)
          throw new Error("unsupported diagram text aspect factor");
        // Both directions shrink the rectangle. A lower bound on one
        // dimension reduces the opposite dimension instead of enlarging it.
        const target = aspect.target.type as "w" | "h",
          axis =
            aspect.operator === "lte" ? target : target === "w" ? "h" : "w",
          binding = slot(s, axis);
        // An adjusted explicit dimension needs no initial aspect calculation.
        // Automatic coordinates still need the limit to preserve their ruler.
        if (
          !adjustedCells?.has(binding) ||
          (axis === "w" ? automaticWidth : automaticHeight)
        ) {
          const opposite = axis === "w" ? "h" : "w",
            ruler = evaluate(slot(s, opposite)),
            limit = finite(
              aspect.operator === "lte"
                ? ruler * aspect.factor
                : ruler / aspect.factor,
            ),
            applied = !adjustedCells?.has(binding) && evaluate(binding) > limit;
          textAspectLimits.set(s, { axis, limit, applied });
          // Ordered rule results have a separate lifetime. Their bounds were
          // resolved during the trial; a later parent resize must not silently
          // replace a retained adjustment with a newly evaluated initial bound.
          if (applied) {
            binding.realizedValue = limit;
            cacheGeneration = {};
          }
        }
      }
    }
    for (const type of new Set<DiagramConstraintType>([
      "w",
      "h",
      ...s.assignments.keys(),
      ...s.defaults.keys(),
      ...s.textDefaults,
    ]))
      if (availableProperty(type, s.algorithm))
        s.preferred.set(type, evaluate(slot(s, type)));
  };
  const dimensionLimits = new Map<State, Map<"w" | "h", number>>();
  // Composite child dimensions bind to a direct equality with the same parent
  // axis, or to two equalities sharing a direct reference. The effective parent
  // ruler supplies the initial geometry and the child rule limit. This is a
  // local geometry binding, not transitive fitting propagation: native controls
  // with longer user-variable chains remain adjustable. Descendant selectors
  // do not declare composite child coordinates and do not acquire this bound.
  const dimensionLimit = (s: State, type: "w" | "h"): number => {
    const parent = parentOf(s);
    if (parent?.algorithm !== "composite" || !s.rawGeometry.has(type))
      return Infinity;
    if (s.node === root && boundary)
      return boundary.dimensionLimit(s.node, type);
    let limits = dimensionLimits.get(s);
    if (!limits) dimensionLimits.set(s, (limits = new Map()));
    if (limits.has(type)) return limits.get(type)!;
    const base = declaredBases.get(s.rawGeometry.get(type)!);
    if (!base) return Infinity;
    const canonicalKey = (property: DiagramConstraintProperty) =>
      propertyKey(
        property.selector.relationship === "self"
          ? self(property.type)
          : property,
      );
    const childKey = canonicalKey(base.target),
      rulerKey = propertyKey(self(type));
    const neighbors = (key: string) => {
      const result = new Map<string, { factor: number; inverse: boolean }>();
      for (const c of parent.constraints) {
        consume();
        if (c.operator !== "equ" || c.reference.type === "none") continue;
        const targetKey = canonicalKey(c.target),
          sourceKey = canonicalKey(c.reference);
        if (targetKey !== key && sourceKey !== key) continue;
        if (c.target.selector.relationship === "self") {
          // A preference supplied by an ancestor or allocation does not erase
          // this local geometry equality. It still binds the selected ruler.
          if (!targetsFor(parent, c.target.selector).length) continue;
        }
        if (!Number.isFinite(c.factor) || c.factor === 0)
          throw new Error("invalid diagram equality factor");
        if (targetKey === key)
          result.set(sourceKey, { factor: c.factor, inverse: true });
        if (sourceKey === key)
          result.set(targetKey, { factor: c.factor, inverse: false });
      }
      return result;
    };
    const childReferences = neighbors(childKey),
      rulerReferences = neighbors(rulerKey);
    let limit = Infinity;
    const apply = (
      value: number,
      edge: { factor: number; inverse: boolean },
      reverse = false,
    ) =>
      finite(
        edge.inverse !== reverse ? value / edge.factor : value * edge.factor,
      );
    const ruler = parent.preferred.get(type)!;
    const direct = childReferences.get(rulerKey);
    if (direct !== undefined) limit = Math.abs(apply(ruler, direct, true));
    for (const [reference, edge] of childReferences) {
      const rulerEdge = rulerReferences.get(reference);
      if (rulerEdge !== undefined)
        limit = Math.min(
          limit,
          Math.abs(apply(apply(ruler, rulerEdge), edge, true)),
        );
    }
    limits.set(type, limit);
    return limit;
  };
  // The native reference visits composite children in layout order. Explicit
  // constraints can be live references, while derived coordinates and child sizes are captured
  // during each visit. In particular, a forward position reference can move a
  // shape later without retroactively changing its previously derived right
  // edge. Repeated layout names expose the last completed instance's variables.
  const tasks: { state: State; post: boolean }[] = [
    { state: states.get(root)!, post: false },
  ];
  // Snapshot outer references at the entrance boundary without forcing an
  // otherwise unused declaration to become executable. Coordinate-derived
  // dimensions can legitimately shadow an unresolved ancestor preference.
  const capture = (cell: Cell): (() => number) => {
    try {
      const value = evaluate(cell);
      return () => value;
    } catch (error) {
      if (operations > maximum) throw error;
      return () => {
        throw error;
      };
    }
  };
  const incomingValues = new Map<
    State,
    Map<DiagramConstraintType, () => number>
  >();
  const incomingGeometry = new Map<
    State,
    Map<DiagramConstraintType, () => number>
  >();
  const capturedAxes = new Map<State, Map<"w" | "h", AutomaticAxis>>();
  while (tasks.length) {
    consume();
    const { state: s, post } = tasks.pop()!,
      parent = parentOf(s);
    if (post) {
      if (parent?.algorithm === "composite" && states.has(parent.node)) {
        parent.publishedGeometry.set(
          s.node.name,
          s.referenceGeometry
            ? new Map([...s.coordinates, ...s.referenceGeometry])
            : s.coordinates,
        );
        cacheGeneration = {};
      }
      continue;
    }
    incomingValues.set(
      s,
      new Map(
        [...s.assignments]
          .filter(([, assignment]) => assignment.owner !== s)
          .map(([type, assignment]) => [type, capture(assignment.cell)]),
      ),
    );
    incomingGeometry.set(
      s,
      new Map([...s.rawGeometry].map(([type, cell]) => [type, capture(cell)])),
    );
    if (parent?.algorithm === "composite") {
      const plans = axes.map(([start, center, end, length]) => {
        const raw = s.rawGeometry,
          assignment = s.assignments.get(length);
        const inherited = assignment && assignment.owner.depth < parent.depth;
        // Composite supplies an automatic dimension when its child has no
        // local base for that dimension. A more distant ancestor's preference
        // only participates when the child explicitly requests a dimension;
        // otherwise the parent's available span wins, including leading offsets.
        // Keep the ancestor declaration separately referenceable.
        const automaticInherited = inherited && !s.selfSeen.has(length);
        let size = raw.get(length);
        if (inherited && !automaticInherited) size = assignment.cell;
        const parentSize = parent.preferred.get(length)!;
        // An inherited parent preference can differ from its local formula.
        // Resolve the child against that effective ruler, while allowing an
        // explicit fitting/allocation trial to replace the child slot.
        const bound = dimensionLimit(s, length);
        if (Number.isFinite(bound) && !changes.has(slot(s, length)))
          size = constant(bound);
        const coordinateCount = [start, center, end].filter((type) =>
          raw.has(type),
        ).length;
        // A trailing edge/center requires a dimension before placing the child.
        // An authored child-local dimension is not yet evaluated at that point;
        // native composite retains the explicit coordinate but uses zero for
        // the unresolved start/size. A known leading edge can run the child
        // first and use its preferred size. See the native ordering controls.
        const pendingDimension =
          !size &&
          !raw.has(start) &&
          assignment?.owner === s &&
          (raw.has(center) || raw.has(end));
        const fixed =
          !!size || coordinateCount >= 2 || raw.has(center) || raw.has(end);
        const cells = pendingDimension
          ? {
              start: zero,
              center: raw.get(center) ?? zero,
              end: raw.get(end) ?? zero,
              length: zero,
            }
          : deriveDiagramCompositeAxis(
              constant(parentSize),
              raw.get(start),
              raw.get(center),
              raw.get(end),
              size,
              arithmetic,
            );
        const dimension = evaluate(cells.length);
        const automatic = !size && (fixed || automaticInherited || !assignment);
        const allocation =
          automatic && !changes.has(slot(s, length))
            ? allocations.get(s.node)?.get(length)
            : undefined;
        if (fixed || automaticInherited)
          s.imposedSizes.set(length, allocation?.preferred ?? dimension);
        else s.sizeDefaults.set(length, allocation?.preferred ?? dimension);
        cacheGeneration = {};
        return {
          start,
          center,
          end,
          length,
          raw,
          size,
          cells,
          fixed,
          parentSize,
          automatic,
          allocation,
          bound,
        };
      });
      preferred(s, plans[0]!.automatic, plans[1]!.automatic);
      s.projectionGeometry = {
        l: plans[0]!.cells.start,
        ctrX: plans[0]!.cells.center,
        r: plans[0]!.cells.end,
        w: plans[0]!.cells.length,
        t: plans[1]!.cells.start,
        ctrY: plans[1]!.cells.center,
        b: plans[1]!.cells.end,
        h: plans[1]!.cells.length,
      };
      for (const plan of plans) {
        const {
          start,
          center,
          end,
          length,
          raw,
          size,
          fixed,
          parentSize,
          automatic,
          allocation,
          bound,
        } = plan;
        // An extent derived from parent coordinates remains constrained by
        // them, independently of a child's adjusted preferred size. An explicit
        // parent extent permits the child to publish its adjusted geometry.
        const aspect = textAspectLimits.get(s);
        const limit = aspect?.axis === length ? aspect.limit : Infinity;
        const adjusted =
          changes.has(slot(s, length)) ||
          (aspect?.axis === length && aspect.applied);
        // Authored parent coordinates reserve their original span after aspect
        // fitting. With no coordinate on this axis, the automatic default does
        // not reserve space: publish the child's fitted extent and edges.
        const retainedAutomatic =
          automatic &&
          (raw.has(start) || raw.has(center) || raw.has(end)) &&
          evaluate(plan.cells.length) > limit;
        if (retainedAutomatic && aspect?.applied)
          aspectReservations.set(s, {
            ...aspectReservations.get(s),
            [length]: evaluate(plan.cells.length),
          });
        const cells =
          retainedAutomatic || (fixed && (!adjusted || !size))
            ? plan.cells
            : deriveDiagramCompositeAxis(
                constant(parentSize),
                raw.get(start),
                raw.get(center),
                raw.get(end),
                constant(s.preferred.get(length)!),
                arithmetic,
              );
        s.size[length] = Math.min(
          allocation?.size ?? evaluate(cells.length),
          retainedAutomatic
            ? s.preferred.get(length)!
            : adjustedCells?.has(slot(s, length))
              ? Infinity
              : limit,
        );
        if (
          options.compositeReferenceRulers?.get(parent.node)?.[length] !==
            undefined &&
          automatic &&
          !size &&
          raw.has(start) &&
          !raw.has(center) &&
          !raw.has(end)
        ) {
          s.referenceGeometry ??= new Map();
          s.referenceGeometry.set(end, constant(parentSize));
        }
        const captured = new Map<DiagramConstraintType, number>();
        for (const [type, value] of [
          [start, cells.start],
          [center, cells.center],
          [end, cells.end],
          [length, cells.length],
        ] as const) {
          const live =
            type === length ? size !== undefined : value === raw.get(type);
          if (live) s.coordinates.set(type, value);
          else {
            const resolved =
              allocation?.coordinates.get(type) ?? evaluate(value);
            s.coordinates.set(type, constant(resolved));
            captured.set(type, resolved);
          }
        }
        const projection = options.coordinateScales?.get(s.node)?.[length];
        if (projection !== undefined && finite(projection) < 0)
          throw new Error("negative diagram coordinate projection");
        if (projection !== undefined && projection > 0 && projection !== 1) {
          s.referenceGeometry ??= new Map();
          for (const [type, original] of [
            [start, plan.cells.start],
            [center, plan.cells.center],
            [end, plan.cells.end],
            [length, plan.cells.length],
          ] as const) {
            // Physical coordinates stay in the placement's entrance domain.
            // Explicit references retain their declarations; derived positions
            // are published in the inverse projection domain.
            const captured = options.coordinateOrigins?.get(s.node)?.[type];
            const entrance = finite(captured ?? evaluate(original));
            s.coordinates.set(type, constant(entrance));
            // A default trailing edge is the parent's available boundary,
            // not an edge calculated from the child's projected extent.
            const parentBoundary =
              type === end && !size && !raw.has(end) && !raw.has(center);
            s.referenceGeometry.set(
              type,
              raw.get(type) ??
                constant(parentBoundary ? parentSize : entrance / projection),
            );
          }
        }
        if (
          changes.has(slot(s, length)) &&
          aspectReservations.get(s)?.[length] !== undefined
        ) {
          // A projected automatic span can hit its text aspect bound again.
          // Publish that completed dimension without replacing the entrance
          // allocation or the independently retained center/trailing rulers.
          s.referenceGeometry ??= new Map();
          s.referenceGeometry.set(length, constant(s.preferred.get(length)!));
        }
        if (automatic) {
          let axes = capturedAxes.get(s);
          if (!axes) capturedAxes.set(s, (axes = new Map()));
          axes.set(length, {
            preferred: s.preferred.get(length)!,
            size: s.size[length],
            coordinates: captured,
          });
        }
      }
    } else {
      preferred(s);
      s.size.w = s.preferred.get("w")!;
      s.size.h = s.preferred.get("h")!;
    }
    tasks.push({ state: s, post: true });
    for (let i = s.node.children.length - 1; i >= 0; --i)
      tasks.push({ state: states.get(s.node.children[i]!)!, post: false });
  }
  completed = true;
  cacheGeneration = {};
  interface Member {
    readonly state: State;
    readonly type: DiagramConstraintType;
  }
  interface Domain {
    readonly scope: State;
    readonly property: DiagramConstraintProperty;
    readonly members: readonly Member[];
    readonly selected: boolean;
  }
  interface Relation extends DiagramEqualityRelation<Domain> {
    readonly localTarget: Member | null;
  }
  let equality: {
    domains: readonly Domain[];
    relations: readonly Relation[];
  } | null = null;
  const members = new Map<Cell, Member>();
  const member = (state: State, type: DiagramConstraintType): Member => {
    if (!availableProperty(type, state.algorithm))
      throw new Error(`unsupported diagram equality variable ${type}`);
    const key = slot(state, type);
    let result = members.get(key);
    if (!result) {
      result = { state, type };
      members.set(key, result);
    }
    return result;
  };
  const equalityGraph = () => {
    if (equality) return equality;
    const domains: Domain[] = [],
      relations: Relation[] = [];
    const scopes = new Map<State, Map<string, Domain>>();
    const domain = (s: State, property: DiagramConstraintProperty): Domain => {
      const canonical =
        property.selector.relationship === "self"
          ? self(property.type)
          : property;
      const key = propertyKey(canonical);
      const scope = scopes.get(s) ?? new Map<string, Domain>();
      scopes.set(s, scope);
      let result = scope.get(key);
      if (!result) {
        if (positions.has(property.type))
          throw new Error(
            `unsupported diagram equality variable ${property.type}`,
          );
        const targets = targetsFor(s, property.selector);
        result = {
          scope: s,
          property: canonical,
          selected: targets.length > 0,
          // A selector can include containers and sp nodes as well as text
          // nodes. Only algorithms exposing this variable have physical slots;
          // the declaring scope still has its reference domain in either case.
          members: targets.flatMap((node) => {
            const target = states.get(node)!;
            return availableProperty(property.type, target.algorithm)
              ? [member(target, property.type)]
              : [];
          }),
        };
        scope.set(key, result);
        domains.push(result);
      }
      return result;
    };
    for (const s of order)
      for (const c of s.constraints) {
        consume();
        if (c.operator !== "equ") continue;
        const targetBinding = s.bindings.get(propertyKey(c.target));
        const isSelf = c.target.selector.relationship === "self";
        if (isSelf) {
          if (!targetBinding) continue;
          const assignment = s.assignments.get(c.target.type);
          if (assignment && assignment.owner !== s) continue;
          if (
            (c.reference.type !== "none" || c.value !== 0) &&
            activeSelfBases.get(targetBinding) !== c
          )
            continue;
        }
        const target = domain(s, c.target);
        if (c.reference.type === "none" || !target.selected) continue;
        if (!Number.isFinite(c.factor) || c.factor === 0)
          throw new Error("invalid diagram equality factor");
        // A numeric replacement of a declaration severs its previous formula.
        // A child-local trial does not overwrite the ancestor's declaration.
        if (targetBinding && changes.has(targetBinding)) continue;
        lookup(s, c.reference);
        const source = domain(s, c.reference);
        relations.push({
          source,
          target,
          factor: c.factor,
          localTarget: isSelf ? member(s, c.target.type) : null,
        });
      }
    equality = { domains, relations };
    return equality;
  };
  const equalityTrial = (
    s: State,
    type: DiagramConstraintType,
    value: number,
  ): DiagramEqualityTrial => {
    finite(value);
    if (!s.bindings.has(propertyKey(self(type))))
      throw new Error("unresolved diagram equality trial variable");
    const seed = member(s, type),
      graph = equalityGraph();
    let work = 0;
    const step = () => {
      if (++work > maximum)
        throw new Error("diagram equality operation budget exceeded");
    };
    const seeds = graph.domains.filter((domain) =>
      domain.members.some((candidate) => {
        step();
        return candidate === seed;
      }),
    );
    const propagated = propagateDiagramEquality(
      graph.relations.filter((relation) => {
        step();
        return relation.localTarget !== seed;
      }),
      seeds,
      value,
      step,
    );
    const projected = new Map<Member, DiagramEqualityValue>([
      [seed, { value, error: 0 }],
    ]);
    const ancestors = new Set<State>();
    for (let parent = parentOf(s); parent; parent = parentOf(parent)) {
      step();
      ancestors.add(parent);
    }
    for (const [domain, trial] of propagated)
      for (const target of domain.members) {
        step();
        // Native repeated-instance controls propagate w/h links through the
        // declaration graph but exclude the initiating instance's other slots.
        if (target.state === s && target !== seed) continue;
        // A descendant trial can traverse an ancestor's virtual domain to
        // other equality-linked instances, but must not replace the ancestor's
        // own value. Ordinary references keep that original ruler. Native
        // controls cover frame dimensions, nested canvases and user variables.
        if (ancestors.has(target.state)) continue;
        const previous = projected.get(target);
        if (previous && !compatibleDiagramEqualityValues(previous, trial))
          throw new Error("inconsistent diagram equality projection");
        if (!previous) projected.set(target, trial);
      }
    return {
      changes: [...projected].map(([target, trial]) => ({
        owner: target.state.node,
        property: self(target.type),
        value: trial.value,
      })),
      scopes: [...propagated].map(([domain, trial]) => ({
        scope: domain.scope.node,
        property: {
          ...domain.property,
          selector: { ...domain.property.selector },
        },
        value: trial.value,
      })),
    };
  };
  const crossPropertySources = new Map<State, ReadonlySet<Cell>>();
  const hasCrossPropertyDependents = (s: State, variable: Cell): boolean => {
    let sources = crossPropertySources.get(s);
    if (!sources) {
      const direct = new Set<Cell>();
      for (const type of s.textDefaults) {
        consume();
        if (
          !s.assignments.has(type) &&
          !s.defaults.has(type) &&
          !changes.has(slot(s, type))
        )
          direct.add(slot(s, "primFontSz"));
      }
      for (const c of s.constraints) {
        consume();
        if (c.reference.type === "none" || c.reference.type === c.target.type)
          continue;
        const target = s.bindings.get(propertyKey(c.target));
        if (!target || changes.has(target)) continue;
        const base =
          c.target.selector.relationship === "self"
            ? activeSelfBases.get(target)
            : declaredBases.get(target);
        // Bounds and ignored declarations do not establish a dependency.
        // Empty child selections still have a scoped declaration. A numeric
        // replacement severs that formula, including earlier rule applications.
        if (base !== c) continue;
        const source = s.bindings.get(propertyKey(c.reference));
        if (source) direct.add(source);
      }
      sources = direct;
      crossPropertySources.set(s, sources);
    }
    return sources.has(variable);
  };
  const results = new Map<DiagramLayoutNode, DiagramInitialConstraints>();
  for (const s of order) {
    const coordinates = s.coordinates.size
      ? (Object.fromEntries(
          [...s.coordinates].map(([type, value]) => [type, evaluate(value)]),
        ) as unknown as DiagramCompositeCoordinates)
      : null;
    const finalGeometry = new Map(
      [...s.rawGeometry].map(([type, cell]) => [type, capture(cell)]),
    );
    const canvas = options.canvases?.get(s.node);
    const canvasLimit = (axis: "w" | "h"): number => {
      const value = canvas?.[axis];
      if (value === undefined) return Infinity;
      if (finite(value) < 0) throw new Error("negative diagram canvas size");
      return value;
    };
    const boundedSize = {
      w: Math.min(s.size.w, canvasLimit("w")),
      h: Math.min(s.size.h, canvasLimit("h")),
    };
    const result: DiagramInitialConstraints = {
      evaluateScope: (localOptions = {}) => {
        const nextOptions = {
          ...options,
          changes: [],
          adjustments: [],
          allocations: new Map(),
          ...localOptions,
        };
        const budget = operationBudget(nextOptions.maxOperations);
        let work = 0;
        const step = () => {
          if (++work > budget)
            throw new Error("diagram constraint operation budget exceeded");
        };
        const inherited = new Map<
          DiagramLayoutNode,
          Map<DiagramConstraintType, { value: () => number; owner: State }>
        >();
        const descendants = [s.node];
        while (descendants.length) {
          step();
          const node = descendants.pop()!,
            state = states.get(node)!;
          const assignments = new Map<
            DiagramConstraintType,
            { value: () => number; owner: State }
          >();
          for (const [type, assignment] of state.assignments) {
            step();
            if (
              assignment.owner.depth < s.depth &&
              !(
                node === s.node &&
                (type === "w" || type === "h") &&
                localOptions.localDimensions?.includes(type)
              )
            )
              assignments.set(type, {
                value: incomingValues.get(state)!.get(type)!,
                owner: assignment.owner,
              });
          }
          inherited.set(node, assignments);
          for (const child of node.children) descendants.push(child);
        }
        if (localOptions.retainLocalTrials) {
          const explicit = localOptions.changes ?? [];
          nextOptions.changes = [
            ...(options.changes ?? []).filter(
              (change) =>
                inherited.has(change.owner) &&
                !explicit.some(
                  (next) =>
                    next.owner === change.owner &&
                    propertyKey(next.property) === propertyKey(change.property),
                ),
            ),
            ...explicit,
          ];
          nextOptions.adjustments = [
            ...(options.adjustments ?? []).filter((change) =>
              inherited.has(change.owner),
            ),
            ...(localOptions.adjustments ?? []),
          ];
        }
        const outerApplications: ScopeApplication[] = [];
        for (const application of applications) {
          step();
          if (application.owner.depth >= s.depth) continue;
          const targets = application.targets.filter((node) => {
            step();
            return inherited.has(node);
          });
          if (targets.length)
            outerApplications.push({ ...application, targets });
        }
        return evaluateScope(
          s.node,
          available,
          nextOptions,
          {
            work,
            parent: parentOf(s),
            depth: s.depth,
            assignments: inherited,
            geometry: incomingGeometry.get(s)!,
            finalGeometry,
            applications: outerApplications,
            dimensionLimit: (node, type) =>
              dimensionLimit(states.get(node)!, type),
          },
          declarations,
        );
      },
      values: s.preferred,
      size: boundedSize,
      coordinates,
      aspectReservation: aspectReservations.get(s),
      automaticDimensions: new Set(capturedAxes.get(s)?.keys()),
      leadingCoordinates: new Set(
        (["l", "t"] as const).filter((type) => s.rawGeometry.has(type)),
      ),
      captureCompositeCoordinates: () => {
        const c = s.projectionGeometry;
        return c
          ? {
              l: evaluate(c.l),
              ctrX: evaluate(c.ctrX),
              r: evaluate(c.r),
              w: evaluate(c.w),
              t: evaluate(c.t),
              ctrY: evaluate(c.ctrY),
              b: evaluate(c.b),
              h: evaluate(c.h),
            }
          : null;
      },
      constraints: s.constraints,
      rules: s.rules,
      reference: (property) => evaluate(lookup(s, property)),
      rulePlan: (rule) => {
        consume();
        const mode = diagramConstraintRuleMode(rule),
          binding = s.bindings.get(propertyKey(rule.target));
        if (!binding) {
          if (
            s.algorithm === "composite" &&
            rule.target.selector.relationship === "ch" &&
            rule.target.selector.pointType === "all" &&
            rule.target.selector.name &&
            geometry.has(rule.target.type) &&
            targetsFor(s, rule.target.selector).length
          )
            throw new Error("unsupported implicit composite rule variable");
          return null;
        }
        let limit = mode.value;
        if (mode.kind === "factor") {
          // Inherited self slots expose a value, not the ancestor's formula.
          // An ignored local declaration cannot make that formula adjustable.
          const base =
            rule.target.selector.relationship === "self"
              ? activeSelfBases.get(binding)
              : declaredBases.get(binding);
          if (!base || base.reference.type === "none" || changes.has(binding))
            return null;
          limit *= evaluate(lookup(s, base.reference));
          if (
            Number.isNaN(limit) ||
            (!Number.isFinite(limit) && Number.isFinite(mode.value))
          )
            throw new Error("non-finite diagram rule limit");
        }
        return {
          rule,
          mode: mode.kind,
          current: evaluate(binding),
          limit:
            rule.target.selector.relationship === "self" &&
            (rule.target.type === "w" || rule.target.type === "h")
              ? Math.min(
                  limit,
                  dimensionLimit(s, rule.target.type),
                  canvasLimit(rule.target.type),
                )
              : limit,
          hasCrossPropertyDependents: hasCrossPropertyDependents(s, binding),
        };
      },
      equalityChanges: (type, value) => equalityTrial(s, type, value).changes,
      equalityTrial: (type, value) => equalityTrial(s, type, value),
    };
    results.set(s.node, result);
    automaticGeometry.set(result, {
      node: s.node,
      axes: capturedAxes.get(s) ?? new Map(),
    });
  }
  return results;
};
