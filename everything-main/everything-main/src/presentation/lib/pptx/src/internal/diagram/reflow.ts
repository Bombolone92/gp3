import type { DiagramCompositeCoordinates } from "./composite.ts";
import { fitDiagramCompositeCanvas } from "./composite-canvas.ts";
import { selectDiagramConstraintTargets } from "./constraint-targets.ts";
import { getAttrValue, qname } from "../xml/index.ts";
import type { DiagramLayoutNode } from "./layout.ts";
import {
  diagramConstraintPropertyKey,
  diagramConstraintRuleMode,
  readDiagramConstraintRule,
  type DiagramConstraintRule,
  type DiagramConstraint,
  type DiagramConstraintType,
} from "./constraint.ts";
import {
  createDiagramConstraintEvaluator,
  type DiagramInitialConstraints,
  type DiagramConstraintValueChange,
  type DiagramConstraintRulePlan,
  type DiagramEqualityScopeValue,
} from "./initial-constraints.ts";
import {
  arrangeDiagramChildren,
  readDiagramArrangement,
  positionDiagramLinearChildren,
  type DiagramArrangement,
  type DiagramLayoutRect,
  type DiagramLayoutSize,
} from "./arrange.ts";
import {
  fitDiagramLinearGeometryRule,
  fitDiagramTextFontRule,
  fitDiagramTextHeightGroup,
} from "./rule-fit.ts";
import { fitDiagramTextRules } from "./text-rules.ts";
import { fitDiagramTextGroupRules } from "./text-group-rules.ts";
import { readDiagramTextCustomization } from "./text-customization.ts";

type Axis = keyof DiagramLayoutSize;
type Dimensions = Partial<DiagramLayoutSize>;
const mainAxis = (arrangement: DiagramArrangement): Axis | null =>
  arrangement.type === "lin"
    ? arrangement.direction === "fromL" || arrangement.direction === "fromR"
      ? "w"
      : "h"
    : null;

type States = ReadonlyMap<DiagramLayoutNode, DiagramInitialConstraints>;
interface HeightGroup {
  readonly members: readonly DiagramLayoutNode[];
  readonly scopes: readonly DiagramEqualityScopeValue[];
}
interface FontGroup {
  readonly members: readonly DiagramLayoutNode[];
  readonly height: HeightGroup | null;
}
type TextDomain = FontGroup | HeightGroup | DiagramLayoutNode;
interface FittedDomain {
  readonly allocated: readonly DiagramConstraintValueChange[];
  readonly drawn: readonly DiagramConstraintValueChange[];
}
interface Pass {
  /** Constraints on entry, before local text preferences grow their heights. */
  readonly entrance: States;
  /** Height preference retained when parent retry must change the font again. */
  readonly drawingStarts: ReadonlyMap<DiagramLayoutNode, number>;
  readonly retainedGeometryHeights: ReadonlySet<DiagramLayoutNode>;
  readonly algorithms: States;
  readonly domains: ReadonlyMap<TextDomain, FittedDomain>;
  readonly allocation: States;
  readonly drawing: States;
  readonly heights: ReadonlyMap<HeightGroup, number>;
  readonly fits: ReadonlyMap<DiagramLayoutNode, boolean>;
}
export interface DiagramReflowResult {
  /** Final drawn geometry in frame-local millimetres. Container bounds can
   * differ from their fitting canvases, which remain in allocation. */
  readonly bounds: ReadonlyMap<DiagramLayoutNode, DiagramLayoutRect>;
  readonly allocation: States;
  readonly drawing: States;
  /** Algorithm rulers before custom text overrides, including unmeasured TX nodes. */
  readonly algorithms: States;
  /** False retains exhausted rule endpoints; it does not claim content fit. */
  readonly fits: boolean;
}
export interface DiagramReflowOptions {
  /**
   * Measure semantic text with the supplied fitted constraints, including
   * margins and unbreakable-word overflow. The third argument contains the
   * algorithm's fonts before custT overrides, for mixed custom text rulers.
   * No saved drawing geometry or text is an input to this operation.
   */
  readonly textFits: (
    node: DiagramLayoutNode,
    state: DiagramInitialConstraints,
    algorithm: DiagramInitialConstraints,
  ) => DiagramTextFit;
  /** Bounds the total number of constraint passes and text probes. */
  readonly maxOperations?: number;
}
/** Height rules fit wrapped lines; font rules and parent fallback also require
 * word width to fit. A boolean remains valid for predicates without that split. */
export type DiagramTextFit =
  boolean | { readonly fits: boolean; readonly heightFits: boolean };
const fittedText = { fits: true, heightFits: true };
const overflowingText = { fits: false, heightFits: false };
const algorithm = (node: DiagramLayoutNode): string | null =>
  node.algorithm && getAttrValue(node.algorithm, qname("", "type", ""));
const self = (
  owner: DiagramLayoutNode,
  type: DiagramConstraintType,
  value: number,
): DiagramConstraintValueChange => ({
  owner,
  property: {
    type,
    selector: { relationship: "self", name: "", pointType: "all" },
  },
  value,
});
const contains = (
  parent: DiagramLayoutNode,
  node: DiagramLayoutNode,
): boolean => {
  for (
    let current: DiagramLayoutNode | null = node;
    current;
    current = current.parent
  )
    if (current === parent) return true;
  return false;
};
const heightBound = (state: DiagramInitialConstraints): number => {
  let limit = Infinity;
  for (const constraint of state.constraints) {
    if (constraint.operator !== "lte" || constraint.target.type !== "h")
      continue;
    const selector = constraint.target.selector;
    if (
      selector.relationship !== "self" ||
      selector.name ||
      selector.pointType !== "all"
    )
      throw new Error("unsupported diagram text height bound selector");
    const bound =
      constraint.reference.type === "none"
        ? constraint.value
        : state.reference(constraint.reference) * constraint.factor;
    if (!Number.isFinite(bound))
      throw new Error("non-finite diagram text height bound");
    limit = Math.min(limit, bound);
  }
  return limit;
};
const plan = (
  state: DiagramInitialConstraints,
  rule: DiagramConstraintRule,
): DiagramConstraintRulePlan | null => {
  const result = state.rulePlan(rule);
  return result && rule.target.type === "h"
    ? { ...result, limit: Math.min(result.limit, heightBound(state)) }
    : result;
};

/**
 * Coordinate semantic constraint evaluation, text fitting, parent arrangement
 * and allocation/drawing reflow. LIN and COMPOSITE containers are traversed in
 * layout order; TX probes rebuild only their local constraint scope. Equality
 * allocations survive resizing below their declaring scope. Automatic geometry
 * is captured at the current allocated sizes before the final drawing pass.
 *
 * Shared height rules, equal-font ordered TX domains and independent ordered
 * rules have distinct fitting paths. Proportional/overlapping text domains and
 * differing shared rule sequences still reject explicitly. This is
 * geometry orchestration, not shape projection or a saved-cache fallback.
 */
export const reflowDiagramLayout = (
  root: DiagramLayoutNode,
  available: DiagramLayoutSize,
  options: DiagramReflowOptions,
): DiagramReflowResult => {
  // Native TX layout accepts a zero extent without running text adjustment
  // rules. This is an exact geometry boundary, not a text-overflow tolerance;
  // positive dimensions still measure content. Keep the node and text intact.
  const measure = (
    node: DiagramLayoutNode,
    state: DiagramInitialConstraints,
    algorithmState: DiagramInitialConstraints,
  ) => {
    if (state.size.w === 0 || state.size.h === 0) return fittedText;
    const result = options.textFits(node, state, algorithmState);
    return typeof result === "boolean"
      ? result
        ? fittedText
        : overflowingText
      : result;
  };
  const textFits = (
    node: DiagramLayoutNode,
    state: DiagramInitialConstraints,
    algorithmState: DiagramInitialConstraints,
  ) => measure(node, state, algorithmState).fits;
  const budget = options.maxOperations ?? 100_000;
  if (!Number.isSafeInteger(budget) || budget < 1)
    throw new Error("invalid diagram reflow operation budget");
  let operations = 0;
  const consume = () => {
    if (++operations > budget)
      throw new Error("diagram reflow operation budget exceeded");
  };
  const compositeHeightPreferences = new Set<DiagramLayoutNode>();
  // This domain has no descendant adjustment lifetime: each ordered ancestor
  // trial can evaluate all leaf content directly from the current constraints.
  // Nested containers and TX height/font rules require a completed local pass.
  const directTextRules =
    algorithm(root) === "lin" &&
    root.children.length > 0 &&
    root.children.every(
      (child) => algorithm(child) === "tx" && !child.rules.length,
    ) &&
    root.rules.every((element) => {
      const { target } = readDiagramConstraintRule(element);
      return (
        (target.type === "primFontSz" &&
          target.selector.relationship === "des") ||
        target.type === "w"
      );
    });
  const nodes: DiagramLayoutNode[] = [],
    pending = [root];
  while (pending.length) {
    consume();
    const node = pending.pop()!;
    nodes.push(node);
    pending.push(...[...node.children].reverse());
    const type = algorithm(node);
    if (!["lin", "composite", "tx", "sp"].includes(type ?? ""))
      throw new Error(`unsupported diagram reflow algorithm ${type}`);
    if ((type === "tx" || type === "sp") && node.children.length)
      throw new Error("unsupported diagram leaf algorithm with children");
    if (
      type === "composite" &&
      node.rules.length === 1 &&
      node.children.every((child) =>
        ["tx", "sp"].includes(algorithm(child) ?? ""),
      )
    ) {
      const arrangement = readDiagramArrangement(node.algorithm!);
      const rule = readDiagramConstraintRule(node.rules[0]!);
      const { selector, type: property } = rule.target;
      const mode = diagramConstraintRuleMode(rule);
      if (
        arrangement.type === "composite" &&
        arrangement.aspectRatio === 0 &&
        property === "h" &&
        selector.relationship === "self" &&
        !selector.name &&
        selector.pointType === "all" &&
        mode.kind === "value" &&
        mode.value === Infinity
      )
        compositeHeightPreferences.add(node);
    }
    if (
      type !== "tx" &&
      node.rules.length &&
      !compositeHeightPreferences.has(node) &&
      // SP leaves need only geometry. Direct unruled TX leaves can additionally
      // measure content during ordered ancestor font trials. Other containers
      // require descendant execution and retry scope retention.
      !(
        node === root &&
        type === "lin" &&
        (node.children.every((child) => algorithm(child) === "sp") ||
          directTextRules)
      )
    )
      throw new Error("unsupported diagram container adjustment rules");
  }
  // Preorder intervals give each subtree a contiguous range. Resizing one
  // completed branch must not scan unrelated branches or walk parent chains.
  const ranges = new Map(
    nodes.map((node, start) => [node, { start, end: start + 1 }]),
  );
  const arrangements = new Map<DiagramLayoutNode, DiagramArrangement>();
  const spacers = new Map<DiagramLayoutNode, ReadonlySet<number>>();
  const spacerAxes = new Map<DiagramLayoutNode, Axis>();
  const searchAxes = new Map<DiagramLayoutNode, Axis>();
  for (const node of nodes) {
    if (algorithm(node) !== "lin" && algorithm(node) !== "composite") continue;
    const arrangement = readDiagramArrangement(node.algorithm!);
    arrangements.set(node, arrangement);
    const axis = mainAxis(arrangement);
    if (axis) {
      const indices = new Set<number>();
      for (const [index, child] of node.children.entries()) {
        const shapeType =
          child.shape && getAttrValue(child.shape, qname("", "type", ""));
        if (
          algorithm(child) === "sp" &&
          (shapeType === null || shapeType === "none" || shapeType === "")
        ) {
          indices.add(index);
          spacerAxes.set(child, axis);
        }
      }
      if (indices.size) spacers.set(node, indices);
    }
    if (axis)
      searchAxes.set(
        node,
        node.parent && algorithm(node.parent) === "lin"
          ? searchAxes.get(node.parent)!
          : axis,
      );
  }
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]!;
    if (node.parent)
      ranges.get(node.parent)!.end = Math.max(
        ranges.get(node.parent)!.end,
        ranges.get(node)!.end,
      );
  }
  const custom = nodes.flatMap((node) => {
    const value =
      algorithm(node) === "tx" ? readDiagramTextCustomization(node) : null;
    return value ? [self(node, "primFontSz", value.primaryFontSize)] : [];
  });
  const customized = new Set(custom.map((c) => c.owner));
  const customFonts = new Map(custom.map((c) => [c.owner, c.value]));
  const fontProperty = (type: DiagramConstraintType) =>
    type === "primFontSz" || type === "secFontSz";
  // Custom text owns its primary font and does not run local font rules.
  // Equality declarations still connect other members. Secondary constraints
  // may propagate into custom text (including margins derived from them), but
  // a custom node never drives the font search.
  const equality = (
    state: DiagramInitialConstraints,
    type: DiagramConstraintType,
    value: number,
  ) => {
    const trial = state.equalityTrial(type, value);
    return {
      ...trial,
      changes: trial.changes.filter(
        (c) => !(c.property.type === "primFontSz" && customized.has(c.owner)),
      ),
    };
  };
  const fittedReferences = new Map<
    DiagramLayoutNode,
    DiagramConstraintValueChange[]
  >();
  const coordinateOrigins = new Map<
    DiagramLayoutNode,
    DiagramCompositeCoordinates
  >();
  const coordinateScales = new Map<DiagramLayoutNode, Dimensions>();
  const sizes = new Map<DiagramLayoutNode, Dimensions>();
  const canvases = new Map<DiagramLayoutNode, Dimensions>();
  // A nested LIN owns the cross-axis drawing it completed before its canvas
  // was clipped. Main-axis allocation and TX adjustment rules remain live.
  const drawingCross = new Map<DiagramLayoutNode, Dimensions>();
  const rulerReferences = new Map<DiagramLayoutNode, Set<string>>();
  const dimensionBindings = new Map<
    DiagramLayoutNode,
    Map<
      Axis,
      readonly { node: DiagramLayoutNode; type: Axis; factor: number }[]
    >
  >();
  const boundDimensions = (owner: DiagramLayoutNode, axis: Axis) => {
    let axes = dimensionBindings.get(owner);
    if (!axes) dimensionBindings.set(owner, (axes = new Map()));
    const cached = axes.get(axis);
    if (cached) return cached;
    const state = initial.get(owner)!;
    const key = (property: DiagramConstraintValueChange["property"]) =>
      diagramConstraintPropertyKey(
        property.selector.relationship === "self"
          ? self(owner, property.type, 0).property
          : property,
      );
    const ruler = key(self(owner, axis, 0).property);
    const adjacent = new Map<string, number>([[ruler, 1]]);
    for (const constraint of state.constraints) {
      if (
        constraint.operator !== "equ" ||
        constraint.reference.type === "none" ||
        !selectDiagramConstraintTargets(owner, constraint.target.selector)
          .length
      )
        continue;
      const target = key(constraint.target),
        reference = key(constraint.reference);
      if (target !== ruler && reference !== ruler) continue;
      if (!Number.isFinite(constraint.factor) || constraint.factor === 0)
        throw new Error("invalid diagram equality factor");
      if (reference === ruler) adjacent.set(target, constraint.factor);
      if (target === ruler) adjacent.set(reference, 1 / constraint.factor);
    }
    const references = rulerReferences.get(owner) ?? new Set<string>();
    for (const reference of adjacent.keys()) references.add(reference);
    rulerReferences.set(owner, references);
    const result: { node: DiagramLayoutNode; type: Axis; factor: number }[] =
      [];
    for (const constraint of state.constraints) {
      const type = constraint.target.type;
      if (
        constraint.operator !== "equ" ||
        constraint.reference.type === "none" ||
        constraint.target.selector.relationship === "self" ||
        (type !== "w" && type !== "h")
      )
        continue;
      const factor = adjacent.get(key(constraint.reference));
      if (factor === undefined) continue;
      if (!Number.isFinite(constraint.factor) || constraint.factor === 0)
        throw new Error("invalid diagram equality factor");
      for (const node of selectDiagramConstraintTargets(
        owner,
        constraint.target.selector,
      ))
        result.push({ node, type, factor: factor * constraint.factor });
    }
    axes.set(axis, result);
    return result;
  };
  const dimensionChanges = (
    node: DiagramLayoutNode,
    dimensions: Dimensions,
  ) => {
    const result: DiagramConstraintValueChange[] = [];
    for (const axis of ["w", "h"] as const) {
      const value = dimensions[axis];
      if (value === undefined) continue;
      result.push(self(node, axis, value));
      // A container allocation reapplies its physical dimension bindings.
      // This is the local ruler binding used by composite geometry, not the
      // transitive equality graph used for coordinated text-rule trials.
      if (node.children.length)
        for (const binding of boundDimensions(node, axis))
          result.push(self(binding.node, binding.type, value * binding.factor));
    }
    return result;
  };
  const localChanges = (node: DiagramLayoutNode) => [
    ...custom.filter((change) => change.owner === node),
    // Height/font rules rebuild their local preference at the allocated width.
    // Height remains adjustable unless parent arrangement bounded that axis.
    ...(sizes.get(node)?.w !== undefined
      ? [self(node, "w", sizes.get(node)!.w!)]
      : []),
  ];
  const evaluateConstraints = createDiagramConstraintEvaluator(root);
  const containerAdjustments: DiagramConstraintValueChange[] = [];
  const evaluate = (
    adjustments: readonly DiagramConstraintValueChange[] = [],
    allocations?: States,
    customized = true,
  ): States => {
    consume();
    const bounded = new Map(canvases);
    // A signed SP advance is an allocation, not a nonnegative fitting canvas.
    // Its fitted value travels through `sizes`; capping it with Math.min would
    // undo a shrink because a larger-magnitude negative value sorts lower.
    for (const [node, axis] of spacerAxes) {
      const canvas = bounded.get(node);
      if (canvas?.[axis] !== undefined && canvas[axis]! < 0) {
        const dimensions = { ...canvas };
        delete dimensions[axis];
        bounded.set(node, dimensions);
      }
    }
    if (allocations)
      for (const [node, drawn] of drawingCross) {
        const canvas = { ...bounded.get(node) };
        if (drawn.w !== undefined) delete canvas.w;
        if (drawn.h !== undefined) delete canvas.h;
        bounded.set(node, canvas);
      }
    // A grown preference initializes the local ruler. A later parent allocation
    // owns that physical axis and must be able to replace it.
    const preferences = containerAdjustments.filter(
      (change) => sizes.get(change.owner)?.h === undefined,
    );
    return evaluateConstraints(available, {
      quantizeFonts: true,
      constrainTextAspect: true,
      // Ancestor font trials change their declaration variable, including its
      // geometric dependents. Customized text retains a separate primary slot.
      ...(customized &&
      [...preferences, ...adjustments].some(
        (change) =>
          change.owner === root && change.property.type === "primFontSz",
      )
        ? { primaryFontOverrides: customFonts }
        : {}),
      canvases: bounded,
      coordinateOrigins,
      coordinateScales,
      changes: [
        ...(customized ? custom : []),
        ...[...fittedReferences.values()].flat(),
        ...[
          ...new Map(
            [...sizes]
              .flatMap(([node, size]) => dimensionChanges(node, size))
              .map((change) => [
                ranges.get(change.owner)!.start +
                  ":" +
                  diagramConstraintPropertyKey(change.property),
                change,
              ]),
          ).values(),
        ],
      ],
      adjustments:
        allocations && drawingCross.size
          ? [
              ...preferences,
              ...adjustments,
              ...[...drawingCross].flatMap(([node, size]) =>
                dimensionChanges(node, size),
              ),
            ]
          : [...preferences, ...adjustments],
      ...(allocations ? { allocations } : {}),
    });
  };
  let completedAncestorTextRules = false;
  let initial = evaluate();
  if (algorithm(root) === "lin" && root.rules.length) {
    const arrangement = arrangements.get(root)!;
    if (arrangement.type !== "lin")
      throw new Error("invalid diagram linear rule arrangement");
    const main = mainAxis(arrangement)!;
    let state = initial;
    for (const rule of initial.get(root)!.rules) {
      const rulePlan = state.get(root)!.rulePlan(rule);
      if (!rulePlan) continue;
      const trial = (value: number) =>
        evaluate([{ owner: root, property: rule.target, value }]);
      const fitsGeometry = (candidate: States) => {
        const canvas = candidate.get(root)!.size;
        const cross = main === "w" ? "h" : "w";
        let advance = 0,
          start = 0,
          end = 0,
          crossExtent = 0;
        for (const [index, child] of root.children.entries()) {
          consume();
          const size = candidate.get(child)!.size;
          // Drawable dimensions clamp at zero; invisible spacers retain signed
          // advances. Backtracking must fit the whole coordinate span, not just
          // the final cursor. Numeric trials need not yet be drawable.
          const extent = spacers.get(root)?.has(index)
            ? size[main]
            : Math.max(0, size[main]);
          start = Math.min(start, advance, advance + extent);
          end = Math.max(end, advance, advance + extent);
          advance += extent;
          crossExtent = Math.max(crossExtent, size[cross]);
        }
        return (
          end - start - canvas[main] < 1e-9 &&
          crossExtent - canvas[cross] < 1e-9
        );
      };
      const result =
        directTextRules && rule.target.type === "primFontSz"
          ? fitDiagramTextFontRule(rulePlan, (value) => {
              const candidate = trial(value);
              if (!fitsGeometry(candidate)) return false;
              const algorithms = custom.length
                ? evaluate(
                    [{ owner: root, property: rule.target, value }],
                    undefined,
                    false,
                  )
                : candidate;
              return root.children.every((child) => {
                consume();
                // Its authored glyphs cannot shrink with the algorithm font.
                // Geometry still participates through the declaration ruler.
                if (customized.has(child)) return true;
                return textFits(
                  child,
                  candidate.get(child)!,
                  algorithms.get(child)!,
                );
              });
            })
          : fitDiagramLinearGeometryRule(rulePlan, main, (value) =>
              fitsGeometry(trial(value)),
            );
      if (rule.target.type === "primFontSz")
        completedAncestorTextRules = result.fits;
      if (result.value !== rulePlan.current)
        containerAdjustments.push({
          owner: root,
          property: rule.target,
          value: result.value,
        });
      state = evaluate();
    }
    initial = state;
  }
  const assignsValue = (constraint: DiagramConstraint) =>
    (constraint.operator === "none" || constraint.operator === "equ") &&
    !(
      constraint.operator === "equ" &&
      constraint.reference.type === "none" &&
      constraint.value === 0
    );
  const ownCanvasCache = new Map<DiagramLayoutNode, readonly Axis[]>();
  const ownCanvasAxes = (node: DiagramLayoutNode): readonly Axis[] => {
    const cached = ownCanvasCache.get(node);
    if (cached) return cached;
    const axes = (["w", "h"] as const).filter((axis) => {
      if (
        !initial
          .get(node)!
          .constraints.some(
            (constraint) =>
              constraint.target.type === axis &&
              constraint.target.selector.relationship === "self" &&
              assignsValue(constraint) &&
              selectDiagramConstraintTargets(
                node,
                constraint.target.selector,
              ).includes(node),
          )
      )
        return false;
      for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
        consume();
        if (
          initial
            .get(ancestor)!
            .constraints.some(
              (constraint) =>
                constraint.target.type === axis &&
                assignsValue(constraint) &&
                selectDiagramConstraintTargets(
                  ancestor,
                  constraint.target.selector,
                ).includes(node),
            )
        )
          return false;
      }
      return true;
    });
    ownCanvasCache.set(node, axes);
    return axes;
  };

  const declaredCanvasCache = new Map<DiagramLayoutNode, readonly Axis[]>();
  const declaredCanvasAxes = (node: DiagramLayoutNode): readonly Axis[] => {
    const cached = declaredCanvasCache.get(node);
    if (cached) return cached;
    const axes = (["w", "h"] as const).filter((axis) => {
      for (
        let scope: DiagramLayoutNode | null = node;
        scope;
        scope = scope.parent
      ) {
        consume();
        if (
          initial
            .get(scope)!
            .constraints.some(
              (constraint) =>
                constraint.target.type === axis &&
                assignsValue(constraint) &&
                selectDiagramConstraintTargets(
                  scope!,
                  constraint.target.selector,
                ).includes(node),
            )
        )
          return true;
      }
      return false;
    });
    declaredCanvasCache.set(node, axes);
    return axes;
  };

  const text = nodes.filter((node) => algorithm(node) === "tx");
  const rulesFor = new Map(
    text.map((node) => [
      node,
      initial
        .get(node)!
        .rules.filter(
          (rule) => !(customized.has(node) && fontProperty(rule.target.type)),
        ),
    ]),
  );
  const heightRules = new Set<DiagramLayoutNode>();
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    if (
      rulesFor.get(node)?.some((rule) => rule.target.type === "h") ||
      node.children.some((child) => heightRules.has(child))
    )
      heightRules.add(node);
  }
  const groups: HeightGroup[] = [],
    grouped = new Set<DiagramLayoutNode>();
  for (const node of text) {
    const state = initial.get(node)!;
    // Validate selectors even when initial content happens to fit.
    for (const rule of state.rules) {
      const { type, selector } = rule.target;
      if (
        !["h", "primFontSz", "secFontSz"].includes(type) ||
        selector.relationship !== "self" ||
        selector.name ||
        selector.pointType !== "all"
      )
        throw new Error("unsupported local diagram text rule");
    }
    if (grouped.has(node) || !rulesFor.get(node)!.length) continue;
    if (rulesFor.get(node)![0]!.target.type !== "h") continue;
    const trial = equality(state, "h", 1);
    if (
      rulesFor.get(node)!.length > 1 &&
      !trial.scopes.length &&
      !trial.changes.some((c) => c.owner !== node)
    )
      continue;
    const members = text.filter((other) =>
      trial.changes.some((c) => c.owner === other && c.property.type === "h"),
    );
    if (!members.includes(node)) members.unshift(node);
    for (const member of members) {
      if (grouped.has(member))
        throw new Error("overlapping diagram text height domains");
      const rules = rulesFor.get(member)!;
      if (!rules.length || rules[0]!.target.type !== "h")
        throw new Error("unsupported shared ordered diagram text rules");
      if (
        trial.changes.some(
          (c) => c.owner === member && c.property.type === "h" && c.value !== 1,
        )
      )
        throw new Error("unsupported proportional diagram text height domain");
      const reverse = equality(initial.get(member)!, "h", 1);
      if (
        members.some(
          (n) =>
            n !== member &&
            !reverse.changes.some(
              (c) => c.owner === n && c.property.type === "h" && c.value === 1,
            ),
        )
      )
        throw new Error("overlapping diagram text height domains");
      grouped.add(member);
    }
    groups.push({ members, scopes: trial.scopes });
  }
  const fontGroups: FontGroup[] = [],
    fontGrouped = new Set<DiagramLayoutNode>();
  const sameMembers = (
    a: readonly DiagramLayoutNode[],
    b: readonly DiagramLayoutNode[],
  ) => a.length === b.length && a.every((n) => b.includes(n));
  for (const node of text) {
    if (fontGrouped.has(node)) continue;
    const state = initial.get(node)!;
    const fontRule = rulesFor.get(node)!.find((r) => r.target.type !== "h");
    if (!fontRule) continue;
    const trial = equality(state, fontRule.target.type, 1);
    const members = text.filter(
      (n) =>
        !customized.has(n) &&
        trial.changes.some(
          (c) => c.owner === n && c.property.type === fontRule.target.type,
        ),
    );
    // A one-member equality height domain can still need its ordered font
    // fallback when its composite ruler prevents further height growth.
    if (
      !members.length ||
      (members.length === 1 &&
        !groups.some((group) => sameMembers(group.members, members))) ||
      members.some((n) => fontGrouped.has(n))
    )
      continue;
    // Only coincident, unit-ratio font domains share a single scalar search.
    // Other domains retain the explicit unsupported path if a rule must run.
    const common = members.every((n) => {
      const s = initial.get(n)!;
      return (
        rulesFor.get(n)!.length === rulesFor.get(node)!.length &&
        rulesFor.get(n)!.every((r, i) => {
          if (r.target.type !== rulesFor.get(node)![i]!.target.type)
            return false;
          if (r.target.type === "h") return true;
          const changes = equality(s, r.target.type, 1).changes;
          return (
            changes.every(
              (c) => c.property.type === r.target.type && c.value === 1,
            ) &&
            sameMembers(
              members,
              text.filter(
                (other) =>
                  !customized.has(other) &&
                  changes.some((c) => c.owner === other),
              ),
            )
          );
        })
      );
    });
    if (!common) continue;
    const heights = members.map((n) => equality(initial.get(n)!, "h", 1));
    const heightMembers = heights.map((t) =>
      text.filter((n) =>
        t.changes.some((c) => c.owner === n && c.property.type === "h"),
      ),
    );
    const sharedHeight =
      heightMembers.every((m) => sameMembers(m, members)) &&
      heights.every((t) =>
        t.changes.every((c) => c.property.type === "h" && c.value === 1),
      );
    if (!sharedHeight && heightMembers.some((m) => m.length !== 1)) continue;
    const height = sharedHeight
      ? (groups.find((g) => sameMembers(g.members, members)) ?? {
          members,
          scopes: heights[0]!.scopes,
        })
      : null;
    fontGroups.push({ members, height });
    for (const member of members) fontGrouped.add(member);
  }
  const domainFor = new Map<DiagramLayoutNode, TextDomain>(
    text.map((node) => [node, node]),
  );
  const heightFor = new Map<DiagramLayoutNode, HeightGroup>();
  for (const group of groups)
    for (const member of group.members) {
      domainFor.set(member, group);
      heightFor.set(member, group);
    }
  for (const group of fontGroups)
    for (const member of group.members) {
      domainFor.set(member, group);
      if (group.height) heightFor.set(member, group.height);
    }
  const independentAutomaticHeight = (
    node: DiagramLayoutNode,
    state: DiagramInitialConstraints,
  ) => {
    const group = heightFor.get(node);
    return (
      group?.members.length === 1 &&
      !group.scopes.length &&
      state.automaticDimensions.has("h")
    );
  };
  // LIN supplies a physical canvas to completed independent automatic height
  // domains. Explicit local heights and parent/equality bindings still own their
  // reference projection. A COMPOSITE parent owns its own projection pass.
  // Cache this ownership once; checking every sibling for each TX would make
  // content feasibility quadratic in a wide container.
  const linearHeightPreferences = new Set<DiagramLayoutNode>();
  for (const node of compositeHeightPreferences) {
    consume();
    if (!node.parent || algorithm(node.parent) !== "lin") continue;
    let independent = true;
    for (const child of node.children) {
      consume();
      if (
        algorithm(child) === "tx" &&
        !independentAutomaticHeight(child, initial.get(child)!)
      ) {
        independent = false;
        break;
      }
    }
    if (independent) linearHeightPreferences.add(node);
  }
  const linearHeightPreference = (node: DiagramLayoutNode) =>
    linearHeightPreferences.has(node);
  const automaticHeightAllocation = (
    node: DiagramLayoutNode,
    state: DiagramInitialConstraints,
    height: number,
  ) => {
    consume();
    for (const child of node.children) consume();
    return state.evaluateScope({
      changes: [self(node, "w", state.size.w), self(node, "h", height)],
      canvases: new Map(),
      coordinateOrigins: new Map(),
      coordinateScales: new Map(),
    });
  };
  // A physical parent resize can replace a member's current expression with
  // an allocated dimension. It does not remove that member from the semantic
  // equality domain discovered before resizing. Commit every member, even
  // when the current numeric graph no longer contains its original edge.
  const heightGroupChanges = (
    group: HeightGroup,
    state: DiagramInitialConstraints,
    value: number,
  ) => {
    const changes = [...equality(state, "h", value).changes];
    for (const member of group.members)
      if (
        !changes.some(
          (change) => change.owner === member && change.property.type === "h",
        )
      )
        changes.push(self(member, "h", value));
    return changes;
  };
  const frozen = new Set<DiagramLayoutNode>();
  const replayedDrawing = new Set<TextDomain>();
  const replayedHeightStarts = new Map<DiagramLayoutNode, number | undefined>();
  const compositePrepared = new Set<DiagramLayoutNode>();
  const compositeResized = new Set<DiagramLayoutNode>();
  const virtualHeightGroups = [...new Set(heightFor.values())].filter((group) =>
    group.scopes.some(
      (scope) =>
        scope.property.selector.relationship === "self" &&
        scope.property.type.startsWith("user"),
    ),
  );
  // A composite establishes a coordinate domain. A nested LIN can pass a
  // height preference through only when it does not own that height canvas.
  // Only domains reaching this scope publish into its projected references.
  const virtualProjectionKeys = new Map<DiagramLayoutNode, Set<string>>();
  const reopenedHeightScopes = new Set<DiagramLayoutNode>();
  const retainsLocalWidth = (node: DiagramLayoutNode): boolean => {
    for (let parent = node.parent; parent; parent = parent.parent)
      if (
        reopenedHeightScopes.has(parent) &&
        ownCanvasAxes(parent).includes("w")
      )
        return true;
    return false;
  };
  const projectionMember = (owner: DiagramLayoutNode, group: HeightGroup) =>
    group.members.find((member) => {
      for (
        let parent = member.parent;
        parent !== owner;
        parent = parent.parent
      ) {
        if (
          !parent ||
          algorithm(parent) === "composite" ||
          (declaredCanvasAxes(parent).includes("h") &&
            !reopenedHeightScopes.has(parent))
        )
          return false;
      }
      return true;
    });
  const compositeHeightBoundary = (
    owner: DiagramLayoutNode,
    group: HeightGroup,
  ) =>
    group.members.every((member) => {
      if (!contains(owner, member)) return false;
      for (
        let parent: DiagramLayoutNode | null = member;
        parent && parent !== owner;
        parent = parent.parent
      )
        if (algorithm(parent) === "composite") return true;
      return false;
    });
  for (const group of virtualHeightGroups)
    for (const scope of group.scopes)
      if (
        scope.property.selector.relationship === "self" &&
        scope.property.type.startsWith("user") &&
        projectionMember(scope.scope, group)
      ) {
        const keys =
          virtualProjectionKeys.get(scope.scope) ?? new Set<string>();
        keys.add(diagramConstraintPropertyKey(scope.property));
        virtualProjectionKeys.set(scope.scope, keys);
      }
  const initialHeightAllocations = new Map<HeightGroup, number>();
  const virtualReferences = new Map<
    DiagramLayoutNode,
    Map<string, DiagramConstraintValueChange>
  >();
  const recordVirtualReferences = (completed: Pass): Pass => {
    for (const group of virtualHeightGroups) {
      const member = group.members[0]!;
      const state = completed.drawing.get(member)!;
      if (!initialHeightAllocations.has(group))
        initialHeightAllocations.set(
          group,
          completed.heights.get(group) ?? state.size.h,
        );
      for (const scope of group.scopes) {
        if (
          scope.property.selector.relationship !== "self" ||
          !scope.property.type.startsWith("user")
        )
          continue;
        const changes =
          virtualReferences.get(scope.scope) ??
          new Map<string, DiagramConstraintValueChange>();
        const key = diagramConstraintPropertyKey(scope.property);
        const previous = changes.get(key);
        // Retain the smallest accepted physical height. A signed variable
        // reverses scalar ordering without reversing that fitting decision.
        // A reference reaching the text's allocation domain publishes the
        // accepted reserved height. Local drawing retries can be smaller but
        // do not replace that shared allocation. An intervening owned canvas
        // isolates the reservation and only exposes its completed drawing.
        let height =
          projectionMember(scope.scope, group) === member
            ? completed.allocation.get(member)!.size.h
            : state.size.h;
        // A nested composite provides a separate physical height. It may
        // clip the inherited preference, but its larger canvas is not a
        // fitted increase of the ancestor's declared variable.
        for (
          let parent = contains(scope.scope, member) ? member : null;
          parent && parent !== scope.scope;
          parent = parent.parent
        ) {
          if (algorithm(parent) !== "composite") continue;
          height = Math.min(
            height,
            completed.drawing.get(scope.scope)!.reference(scope.property) /
              scope.value,
          );
          break;
        }
        const value = scope.value * height;
        const retained =
          scope.value < 0
            ? Math.max(previous?.value ?? -Infinity, value)
            : Math.min(previous?.value ?? Infinity, value);
        changes.set(key, {
          owner: scope.scope,
          property: scope.property,
          value: retained,
        });
        virtualReferences.set(scope.scope, changes);
      }
    }
    return completed;
  };
  const fit = (
    previous?: Pass,
    resized: readonly DiagramLayoutNode[] = [],
    retry = false,
    retainedGeometryHeights?: ReadonlySet<DiagramLayoutNode>,
  ): Pass => {
    let base = previous ? evaluate() : initial;
    const entrance = base;
    let appliedCount = 0;
    let completedDrawing:
      { allocation: States; states: States; count: number } | undefined;
    const algorithmStates = custom.length
      ? evaluate([], undefined, false)
      : base;
    const allocated: DiagramConstraintValueChange[] = [],
      drawn: DiagramConstraintValueChange[] = [];
    const domains = new Map<TextDomain, FittedDomain>();
    const drawingStarts = new Map<DiagramLayoutNode, number>();
    const retainedHeights = new Set<DiagramLayoutNode>();
    const heights = new Map<HeightGroup, number>(),
      fits = new Map<DiagramLayoutNode, boolean>();
    const inspect = (
      node: DiagramLayoutNode,
      changes: readonly DiagramConstraintValueChange[],
      source: States = base,
    ) => {
      consume();
      const state = source
        .get(node)!
        .evaluateScope({
          changes: localChanges(node),
          adjustments: changes,
        })
        .get(node)!;
      return {
        state,
        ...measure(node, state, algorithmStates.get(node)!),
      };
    };
    const retainHeight = (group: HeightGroup): boolean => {
      const affected = resized.filter((n) =>
        group.members.some((member) => contains(n, member)),
      );
      return (
        retry ||
        !affected.length ||
        affected.every(
          (n) =>
            group.scopes.some(
              ({ scope }) => scope !== n && contains(scope, n),
            ) ||
            // A copied variable can own a fitted equality independently of the
            // container's dimensions. Rebuilding its canvas resets a live link
            // to w/h, but does not itself discard that independent allocation.
            (group.scopes.some(
              ({ scope, property }) =>
                scope === n &&
                property.selector.relationship === "self" &&
                property.type !== "w" &&
                property.type !== "h",
            ) &&
              !group.scopes.some(
                ({ scope, property }) =>
                  scope === n &&
                  property.selector.relationship === "self" &&
                  (property.type === "w" || property.type === "h"),
              )),
        )
      );
    };
    const remember = (domain: TextDomain, result: FittedDomain) => {
      domains.set(domain, result);
      allocated.push(...result.allocated);
      drawn.push(...result.drawn);
    };
    // Parent fallback keeps an accepted fitting result if it still fits the
    // rebuilt geometry. Retain numeric rule adjustments, not drawing bounds:
    // current constraints must still clamp sizes and recompute references.
    const reuse = (
      domain: TextDomain,
      members: readonly DiagramLayoutNode[],
      height: HeightGroup | null = null,
    ): boolean => {
      const preserve = members.every((n) => frozen.has(n));
      const retainGeometry =
        !!height &&
        members.every((node) => retainedGeometryHeights?.has(node) === true);
      const result =
        (retry || preserve || retainGeometry || replayedDrawing.has(domain)) &&
        previous?.domains.get(domain);
      if (
        !result ||
        (!preserve &&
          !retainGeometry &&
          ((!result.allocated.length && !result.drawn.length) ||
            members.some((n) => !previous!.fits.get(n))))
      )
        return false;
      const trialAllocation = evaluate([...allocated, ...result.allocated]);
      let trialDrawing = evaluate([...drawn, ...result.drawn], trialAllocation);
      const retained = {
        ...result,
        drawn: result.drawn.map((c) =>
          c.property.type === "h"
            ? {
                ...c,
                value: Math.min(
                  c.value,
                  heightBound(trialDrawing.get(c.owner)!),
                ),
              }
            : c,
        ),
      };
      if (retained.drawn.some((c, i) => c.value !== result.drawn[i]!.value))
        trialDrawing = evaluate([...drawn, ...retained.drawn], trialAllocation);
      for (const node of members) {
        for (const states of [trialAllocation, trialDrawing]) {
          consume();
          if (
            !preserve &&
            !retainGeometry &&
            !textFits(node, states.get(node)!, algorithmStates.get(node)!)
          )
            return false;
        }
      }
      remember(domain, retained);
      base = trialAllocation;
      appliedCount = allocated.length;
      completedDrawing = {
        allocation: trialAllocation,
        states: trialDrawing,
        count: drawn.length,
      };
      if (height && previous!.heights.has(height))
        heights.set(height, previous!.heights.get(height)!);
      if (retainGeometry) for (const node of members) retainedHeights.add(node);
      for (const node of members)
        fits.set(
          node,
          retainGeometry
            ? textFits(
                node,
                trialAllocation.get(node)!,
                algorithmStates.get(node)!,
              ) &&
                textFits(
                  node,
                  trialDrawing.get(node)!,
                  algorithmStates.get(node)!,
                )
            : true,
        );
      return true;
    };
    for (const group of fontGroups) {
      if (appliedCount !== allocated.length) {
        base = evaluate(allocated);
        appliedCount = allocated.length;
      }
      if (reuse(group, group.members, group.height)) continue;
      const groupAllocated: DiagramConstraintValueChange[] = [],
        groupDrawn: DiagramConstraintValueChange[] = [];
      const rules = rulesFor.get(group.members[0]!)!;
      const result = fitDiagramTextGroupRules(
        rules,
        group.members.map((node) => (values) => {
          const trial = inspect(
            node,
            Object.entries(values).map(([type, value]) =>
              self(node, type as DiagramConstraintType, value),
            ),
          );
          return {
            fits: trial.fits,
            heightFits: trial.heightFits,
            rulePlan: (rule: DiagramConstraintRule) =>
              plan(trial.state, trial.state.rules[rules.indexOf(rule)]!),
          };
        }),
        {
          sharedHeight: group.height !== null,
          ...(group.height &&
          retainHeight(group.height) &&
          previous?.heights.has(group.height)
            ? { retainedHeight: previous.heights.get(group.height)! }
            : {}),
        },
      );
      if (group.height && result.allocationHeight !== undefined)
        heights.set(group.height, result.allocationHeight);
      for (const [i, node] of group.members.entries()) {
        for (const [type, value] of Object.entries(result.values[i]!)) {
          const state = base.get(node)!,
            property = type as DiagramConstraintType;
          groupAllocated.push(
            ...equality(
              state,
              property,
              type === "h"
                ? (result.allocationHeight ??
                    (node.parent && algorithm(node.parent) === "composite"
                      ? result.allocationHeights[i]
                      : undefined) ??
                    value)
                : value,
            ).changes,
          );
          groupDrawn.push(...equality(state, property, value).changes);
        }
        if (
          result.values[i]!.h === undefined &&
          node.parent &&
          algorithm(node.parent) === "composite" &&
          result.allocationHeights[i] !== undefined
        )
          groupAllocated.push(
            ...equality(base.get(node)!, "h", result.allocationHeights[i]!)
              .changes,
          );
        fits.set(node, result.fits);
      }
      remember(group, { allocated: groupAllocated, drawn: groupDrawn });
    }
    for (const group of groups) {
      if (group.members.every((n) => fontGrouped.has(n))) continue;
      if (appliedCount !== allocated.length) {
        base = evaluate(allocated);
        appliedCount = allocated.length;
      }
      if (reuse(group, group.members, group)) continue;
      const first = group.members[0]!,
        state = base.get(first)!,
        rule = rulesFor.get(first)![0]!;
      let resolved = plan(state, rule);
      if (!resolved)
        throw new Error("unresolved diagram text height group rule");
      if (
        group.members.length === 1 &&
        !group.scopes.length &&
        first.parent &&
        algorithm(first.parent) === "composite" &&
        !compositeHeightPreferences.has(first.parent) &&
        state.automaticDimensions.has("h")
      ) {
        // An independent local height rule fits inside its automatic physical
        // allocation. Growing the preference cannot enlarge that allocation.
        // Parent height preferences and shared/outer equality domains instead
        // own their height search and must retain their existing limits.
        const reserved = retainHeight(group)
          ? (previous?.heights.get(group) ?? state.size.h)
          : state.size.h;
        resolved = {
          ...resolved,
          current: Math.min(resolved.current, reserved),
          limit: Math.min(resolved.limit, reserved),
        };
      }
      for (const node of group.members.slice(1)) {
        const s = base.get(node)!,
          p = plan(s, rulesFor.get(node)![0]!);
        if (
          !p ||
          p.mode !== resolved.mode ||
          p.current !== resolved.current ||
          p.limit !== resolved.limit ||
          (p.rule.factor !== resolved.rule.factor &&
            !(
              Number.isNaN(p.rule.factor) && Number.isNaN(resolved.rule.factor)
            ))
        )
          throw new Error("unequal diagram text height group rules");
      }
      // Enter the local height search after its finite outer equality limit
      // has been materialized. Inherited text properties retain that scope;
      // each local trial still reevaluates its own live declarations.
      const limitChanges =
        first.parent &&
        sizes.has(first.parent) &&
        group.members.every((member) => member.parent === first.parent) &&
        Number.isFinite(resolved.limit)
          ? equality(state, "h", resolved.limit)
              .scopes.filter(
                (change) =>
                  sizes.has(change.scope) &&
                  group.members.every(
                    (member) => member.parent === change.scope,
                  ),
              )
              .map((change) => ({
                owner: change.scope,
                property: change.property,
                value: change.value,
              }))
          : [];
      const measurementBase = limitChanges.length
        ? evaluate([...allocated, ...limitChanges])
        : base;
      // Allocation and drawing frequently ask the same pure local trial.
      // Cache both kinds of feasibility without retaining a constraint graph.
      const measurements = group.members.map((node) => {
        const measured = new Map<
          number,
          { readonly fits: boolean; readonly heightFits: boolean }
        >();
        return (value: number) => {
          let result = measured.get(value);
          if (!result) {
            const trial = inspect(
              node,
              [self(node, "h", value)],
              measurementBase,
            );
            result = { fits: trial.fits, heightFits: trial.heightFits };
            measured.set(value, result);
          }
          return result;
        };
      });
      const result = fitDiagramTextHeightGroup(
        resolved,
        measurements.map((measure) => (value) => measure(value).heightFits),
        retainHeight(group) ? previous?.heights.get(group) : undefined,
      );
      const memberFits = measurements.map(
        (measure) => result.fits && measure(result.drawing.value).fits,
      );
      // Rules stop at the first fit. A shared height prefix can therefore be
      // evaluated without running later font rules; if the prefix exhausts,
      // the shared ordered replay needs its own implementation.
      if (
        memberFits.some((fits) => !fits) &&
        group.members.some((n) => rulesFor.get(n)!.length > 1)
      )
        throw new Error("unsupported shared ordered diagram text rules");
      heights.set(group, result.allocation.value);
      remember(group, {
        allocated: heightGroupChanges(group, state, result.allocation.value),
        drawn: heightGroupChanges(group, state, result.drawing.value),
      });
      for (const [i, node] of group.members.entries())
        fits.set(node, memberFits[i]!);
    }
    for (const node of text) {
      if (grouped.has(node) || fontGrouped.has(node)) continue;
      // Unruled text and independent ordered rules see the space reserved by
      // earlier height domains, including automatic composite dimensions.
      if (appliedCount !== allocated.length) {
        base = evaluate(allocated);
        appliedCount = allocated.length;
      }
      if (reuse(node, [node])) continue;
      // A completed parent retry keeps the previous preference as its search
      // start even if a tighter width now requires another font reduction.
      // Its reserved height still belongs to the earlier allocation pass.
      const retained = retry ? previous?.domains.get(node) : undefined;
      const start = retained
        ? retained.drawn.map((c) =>
            c.property.type === "h"
              ? {
                  ...c,
                  value: Math.min(c.value, heightBound(base.get(node)!)),
                }
              : c,
          )
        : [];
      const startHeight = start.find(
        (c) => c.owner === node && c.property.type === "h",
      )?.value;
      if (startHeight !== undefined) drawingStarts.set(node, startHeight);
      const result = fitDiagramTextRules(rulesFor.get(node)!, (values) => {
        const {
          state: trial,
          fits,
          heightFits,
        } = inspect(node, [
          ...start,
          ...Object.entries(values).map(([type, value]) =>
            self(node, type as DiagramConstraintType, value),
          ),
        ]);
        return {
          state: trial,
          fits,
          heightFits,
          rulePlan: (rule: DiagramConstraintRule) => {
            if (
              equality(base.get(node)!, rule.target.type, 1).changes.some(
                (c) =>
                  c.owner !== node &&
                  !(c.property.type === "secFontSz" && customized.has(c.owner)),
              )
            )
              throw new Error("unsupported shared ordered diagram text rules");
            return plan(trial, rule);
          },
        };
      });
      const adjustments = [
        ...start.filter((c) => !(c.property.type in result.values)),
        ...Object.entries(result.values).flatMap(
          ([type, value]) =>
            equality(base.get(node)!, type as DiagramConstraintType, value)
              .changes,
        ),
      ];
      const retainedHeight = retained?.allocated.find(
        (c) => c.owner === node && c.property.type === "h",
      )?.value;
      const allocationHeight =
        retainedHeight === undefined
          ? result.allocationHeight
          : Math.max(retainedHeight, result.allocationHeight ?? retainedHeight);
      // COMPOSITE automatic siblings consume the height reserved before font
      // fitting. LIN leaf packing instead consumes the final drawn preference.
      const reserved =
        allocationHeight === undefined ||
        !node.parent ||
        algorithm(node.parent) !== "composite"
          ? adjustments
          : [
              ...adjustments.filter((c) => c.property.type !== "h"),
              ...equality(base.get(node)!, "h", allocationHeight).changes,
            ];
      remember(node, { allocated: reserved, drawn: adjustments });
      fits.set(node, result.evaluation.fits);
    }
    const allocation =
        appliedCount === allocated.length ? base : evaluate(allocated),
      // Reuse the final accepted trial when no subsequent domain changed its
      // allocation or drawing adjustments. Constraint inputs are stable within
      // this fitting pass, so rebuilding it would produce the same state.
      drawing =
        completedDrawing?.allocation === allocation &&
        completedDrawing.count === drawn.length
          ? completedDrawing.states
          : evaluate(drawn, allocation);
    for (const node of text) {
      consume();
      fits.set(
        node,
        (fits.get(node) ?? true) &&
          textFits(node, allocation.get(node)!, algorithmStates.get(node)!) &&
          textFits(node, drawing.get(node)!, algorithmStates.get(node)!),
      );
    }
    return recordVirtualReferences({
      entrance,
      allocation,
      drawing,
      heights,
      fits,
      domains,
      algorithms: algorithmStates,
      drawingStarts,
      retainedGeometryHeights: retainedHeights,
    });
  };
  let pass = fit();
  // A COMPOSITE's unbounded height preference consumes completed leaf heights
  // before its containing layout projects a canvas. Child offsets affect their
  // drawing positions, not this height ruler. Keep a larger authored preference;
  // dependent markers must continue to see that reserved height.
  //
  // Rebuild the full constraint/text pass after publishing a preference. If
  // dependent wrapping or word overflow cannot complete in that preference,
  // ancestor content retry is still required and remains explicitly unsupported.
  for (const node of compositeHeightPreferences) {
    consume();
    const state = pass.allocation.get(node)!;
    const rule = state.rules[0]!;
    const resolved = state.rulePlan(rule);
    if (
      !resolved ||
      resolved.limit !== Infinity ||
      !Number.isFinite(resolved.current) ||
      resolved.current <= 0
    )
      throw new Error("unsupported diagram composite height preference");
    let height = resolved.current;
    for (const child of node.children) {
      consume();
      height = Math.max(height, pass.drawing.get(child)!.size.h);
    }
    if (height !== resolved.current) {
      containerAdjustments.push(self(node, "h", height));
      initial = evaluate();
      // Publishing the container preference does not restart its completed
      // descendant searches. A later physical allocation can rebuild them.
      pass = fit(pass, [], true);
    }
    if (
      node.children.some(
        (child) =>
          pass.drawing.get(child)!.size.h > height ||
          (algorithm(child) === "tx" && !pass.fits.get(child)),
      )
    )
      throw new Error("unsupported diagram composite height content retry");
  }
  const placements = new Map<DiagramLayoutNode, DiagramLayoutRect>();
  const emptyGeometry = () => ({
    drawingSizes: new Map<DiagramLayoutNode, DiagramLayoutSize>(),
    canvasSizes: new Map<DiagramLayoutNode, DiagramLayoutSize>(),
    drawingOrigins: new Map<DiagramLayoutNode, { x: number; y: number }>(),
    drawingPositions: new Map<DiagramLayoutNode, { x: number; y: number }>(),
  });
  let geometry = emptyGeometry(),
    geometryPass: Pass | null = null;
  const invalidatePlacement = (node: DiagramLayoutNode) => {
    if (geometryPass !== pass) return;
    for (
      let current: DiagramLayoutNode | null = node;
      current && geometry.drawingSizes.has(current);
      current = current.parent
    ) {
      geometry.drawingSizes.delete(current);
      geometry.canvasSizes.delete(current);
      geometry.drawingOrigins.delete(current);
    }
  };
  const referencePreferences = new Map<DiagramLayoutNode, DiagramLayoutSize>();
  const geometricInputs = new Map<DiagramLayoutNode, DiagramLayoutSize[]>();
  const referenceCanvases = new Map<DiagramLayoutNode, DiagramLayoutSize>();
  const retainedCompositeCanvases = new Map<DiagramLayoutNode, Dimensions>();
  const initialCompositeResized = new Set<DiagramLayoutNode>();
  const drawingGeometry = (
    scope = root,
    overrides?: Map<DiagramLayoutNode, DiagramLayoutSize>,
  ) => {
    // Completed geometry is stable until fitting changes a constraint pass or
    // arrangement moves a child. Reuse unchanged descendants across ancestor
    // searches instead of rebuilding the same deep subtree at every level.
    if (geometryPass !== pass) {
      geometry = emptyGeometry();
      geometryPass = pass;
    }
    const { drawingSizes, canvasSizes, drawingOrigins, drawingPositions } =
      overrides ? emptyGeometry() : geometry;
    if (drawingSizes.has(scope)) return geometry;
    const subtree = [scope];
    for (let i = 0; i < subtree.length; i++)
      for (const child of subtree[i]!.children)
        if (!drawingSizes.has(child)) subtree.push(child);
    for (let i = subtree.length - 1; i >= 0; i--) {
      const node = subtree[i]!;
      consume();
      const state = pass.drawing.get(node)!;
      let size = state.size;
      const children = node.children.map((child) => {
        const childState = pass.drawing.get(child)!,
          placed = placements.get(child);
        return {
          x:
            (placed?.x ?? 0) +
            (childState.coordinates?.l ?? 0) +
            (drawingOrigins.get(child)?.x ?? 0),
          y:
            (placed?.y ?? 0) +
            (childState.coordinates?.t ?? 0) +
            (drawingOrigins.get(child)?.y ?? 0),
          ...drawingSizes.get(child)!,
        };
      });
      const arrangement = arrangements.get(node);
      if (children.length && arrangement?.type === "lin") {
        const arranged = positionDiagramLinearChildren(
          state.size,
          children,
          arrangement,
          { spacers: spacers.get(node) },
        );
        for (const i of node.children.keys()) {
          // Arrangement determines positions; descendant drawing passes own
          // the extents. Keep those extents when forming the container union.
          children[i] = {
            ...children[i]!,
            x: arranged[i]!.x,
            y: arranged[i]!.y,
          };
        }
      }
      if (
        children.length &&
        (algorithm(node) === "lin" || algorithm(node) === "composite")
      ) {
        let left = Infinity,
          top = Infinity,
          right = -Infinity,
          bottom = -Infinity;
        let canvasLeft = Infinity,
          canvasTop = Infinity,
          canvasRight = -Infinity,
          canvasBottom = -Infinity;
        for (const child of children) {
          // Zero-by-zero points participate in the coordinate envelope used
          // when a retry creates a canvas, but contribute no final drawing area.
          const endX = child.x + child.w,
            endY = child.y + child.h;
          canvasLeft = Math.min(canvasLeft, child.x, endX);
          canvasTop = Math.min(canvasTop, child.y, endY);
          canvasRight = Math.max(canvasRight, child.x, endX);
          canvasBottom = Math.max(canvasBottom, child.y, endY);
          if (child.w === 0 && child.h === 0) continue;
          left = Math.min(left, child.x, endX);
          top = Math.min(top, child.y, endY);
          right = Math.max(right, child.x, endX);
          bottom = Math.max(bottom, child.y, endY);
        }
        if (left === Infinity) left = top = right = bottom = 0;
        size = { w: right - left, h: bottom - top };
        canvasSizes.set(node, {
          w: canvasRight - canvasLeft,
          h: canvasBottom - canvasTop,
        });
        drawingOrigins.set(node, { x: left, y: top });
        for (const [i, child] of node.children.entries())
          drawingPositions.set(child, {
            x: children[i]!.x - left,
            y: children[i]!.y - top,
          });
      }
      drawingSizes.set(node, overrides?.get(node) ?? size);
    }
    return { drawingSizes, drawingPositions, drawingOrigins, canvasSizes };
  };
  let contentPass: Pass | null = null;
  const contentFits = new Map<DiagramLayoutNode, boolean>();
  const childrenFit = (node: DiagramLayoutNode): boolean => {
    if (contentPass !== pass) {
      contentFits.clear();
      const physicalAllocations = new Map<DiagramLayoutNode, States>();
      for (let i = nodes.length - 1; i >= 0; i--) {
        const current = nodes[i]!;
        let fits = pass.fits.get(current) === true;
        const parent = current.parent;
        if (
          fits &&
          algorithm(current) === "tx" &&
          parent &&
          linearHeightPreference(parent) &&
          independentAutomaticHeight(current, pass.entrance.get(current)!)
        ) {
          let physical = physicalAllocations.get(parent);
          if (!physical) {
            const state = pass.entrance.get(parent)!;
            physical = automaticHeightAllocation(
              parent,
              state,
              Math.max(
                state.size.h,
                pass.allocation.get(parent.parent!)!.size.h,
              ),
            );
            physicalAllocations.set(parent, physical);
          }
          const allocation = physical.get(current)!;
          // A fitted preference does not imply that content fits the physical
          // span available from LIN. Smaller completed preferences remain small.
          consume();
          const physicalState = allocation
            .evaluateScope({
              changes: [
                ...localChanges(current),
                self(
                  current,
                  "h",
                  Math.min(
                    allocation.size.h,
                    pass.allocation.get(current)!.size.h,
                  ),
                ),
              ],
            })
            .get(current)!;
          fits = textFits(
            current,
            physicalState,
            pass.algorithms.get(current)!,
          );
        }
        contentFits.set(
          current,
          algorithm(current) === "tx"
            ? fits
            : current.children.every((child) => contentFits.get(child)),
        );
      }
      contentPass = pass;
    }
    return contentFits.get(node)!;
  };
  let spacePass: Pass | null = null;
  const spaceAdjustments = new Map<
    DiagramLayoutNode,
    DiagramConstraintValueChange[]
  >();
  const localSpace = (node: DiagramLayoutNode, axis: Axis): number => {
    if (spacePass !== pass) {
      spaceAdjustments.clear();
      for (const domain of pass.domains.values())
        for (const change of domain.allocated) {
          const changes = spaceAdjustments.get(change.owner);
          if (changes) changes.push(change);
          else spaceAdjustments.set(change.owner, [change]);
        }
      spacePass = pass;
    }
    return pass.allocation
      .get(node)!
      .evaluateScope({
        localDimensions: [axis],
        adjustments: spaceAdjustments.get(node) ?? [],
      })
      .get(node)!.size[axis];
  };
  // Failed composite content starts a local drawing pass even when arranging
  // its children did not resize anything. Bound the height search by reserved
  // space; outer/shared height domains already ran their coordinated replay.
  const replayCompositeDrawing = (
    parent: DiagramLayoutNode,
    descendants = false,
  ) => {
    const domains = new Map(pass.domains);
    let changed = false;
    const retainedHeights = new Set(pass.retainedGeometryHeights);
    for (const node of descendants
      ? nodes.slice(ranges.get(parent)!.start + 1, ranges.get(parent)!.end)
      : parent.children) {
      if (algorithm(node) !== "tx") continue;
      const rules = rulesFor.get(node)!.filter((r) => r.target.type === "h");
      const height = heightFor.get(node);
      if (
        !rules.length ||
        (height &&
          (height.members.length > 1 ||
            (descendants &&
              (pass.heights.get(height) ?? pass.allocation.get(node)!.size.h) <=
                (initialHeightAllocations.get(height) ?? Infinity) &&
              height.scopes.some(
                ({ scope, property }) =>
                  scope === parent &&
                  property.selector.relationship === "self" &&
                  property.type !== "w" &&
                  property.type !== "h",
              ) &&
              !height.scopes.some(
                ({ scope, property }) =>
                  scope === parent &&
                  property.selector.relationship === "self" &&
                  (property.type === "w" || property.type === "h"),
              )) ||
            height.scopes.some(
              ({ scope }) => scope !== parent && contains(scope, parent),
            )))
      )
        continue;
      const current = pass.drawing.get(node)!;
      const fonts = ["primFontSz", "secFontSz"].map((type) =>
        self(
          node,
          type as DiagramConstraintType,
          current.values.get(type as DiagramConstraintType)!,
        ),
      );
      const reserved = pass.allocation.get(node)!.size.h;
      const physicalHeight = boundDimensions(parent, "h").find(
        (binding) => binding.node === node && binding.type === "h",
      );
      const startHeight = physicalHeight
        ? pass.allocation
            .get(parent)!
            .reference(self(parent, "h", 0).property) * physicalHeight.factor
        : pass.drawingStarts.get(node);
      // A completed local drawing fit can be smaller than its retained
      // allocation. Ancestor geometry reentry must not restart that search
      // from the larger reserved extent.
      if (
        descendants &&
        current.size.h < reserved &&
        (!physicalHeight ||
          (replayedDrawing.has(domainFor.get(node)!) &&
            replayedHeightStarts.get(node) === startHeight))
      )
        continue;
      retainedHeights.delete(node);
      const result = fitDiagramTextRules(rules, (values) => {
        consume();
        const state = pass.allocation
          .get(node)!
          .evaluateScope({
            changes: localChanges(node),
            adjustments: [
              ...fonts,
              ...(startHeight !== undefined
                ? [self(node, "h", startHeight)]
                : []),
              ...Object.entries(values).map(([type, value]) =>
                self(node, type as DiagramConstraintType, value),
              ),
            ],
          })
          .get(node)!;
        return {
          ...measure(node, state, pass.algorithms.get(node)!),
          rulePlan: (rule: DiagramConstraintRule) => {
            const resolved = plan(state, rule);
            return resolved
              ? { ...resolved, limit: Math.min(resolved.limit, reserved) }
              : null;
          },
        };
      });
      const value = result.values.h;
      if (value === undefined || value === current.values.get("h")) continue;
      const domain = domainFor.get(node)!;
      const before = domains.get(domain)!;
      if (descendants) {
        replayedDrawing.add(domain);
        replayedHeightStarts.set(node, startHeight);
      }
      domains.set(domain, {
        ...before,
        drawn: [
          ...before.drawn.filter(
            (c) => !(c.owner === node && c.property.type === "h"),
          ),
          self(node, "h", value),
        ],
      });
      changed = true;
    }
    if (!changed) return;
    const drawing = evaluate(
      [...domains.values()].flatMap((r) => r.drawn),
      pass.allocation,
    );
    const fits = new Map(pass.fits);
    for (const node of text) {
      consume();
      const before = pass.drawing.get(node)!,
        after = drawing.get(node)!;
      // A local drawing change often moves siblings without changing their
      // text box or numeric text constraints. Keep those measurements; the
      // allocation and algorithm ruler have not changed during this phase.
      if (
        before.size.w === after.size.w &&
        before.size.h === after.size.h &&
        before.values.size === after.values.size &&
        [...before.values].every(
          ([key, value]) => after.values.get(key) === value,
        )
      )
        continue;
      fits.set(
        node,
        textFits(
          node,
          pass.allocation.get(node)!,
          pass.algorithms.get(node)!,
        ) && textFits(node, drawing.get(node)!, pass.algorithms.get(node)!),
      );
    }
    pass = recordVirtualReferences({
      ...pass,
      drawing,
      domains,
      fits,
      retainedGeometryHeights: retainedHeights,
    });
  };
  // LIN parents arrange a child's completed preference as a unit. COMPOSITE
  // parents allocate constraint canvases through their separate fitting path.
  const prepared = new Set<DiagramLayoutNode>();
  const intrinsicComposites = new Set<DiagramLayoutNode>();
  const enteredCompositeChildren = new Set<DiagramLayoutNode>();
  const completedSubtrees = new Map<DiagramLayoutNode, Pass>();
  const fittedLinearMain = new Set<DiagramLayoutNode>();
  const preparedMainOverflow = new Set<DiagramLayoutNode>();
  const ancestorMainOverflow = new Set<DiagramLayoutNode>();
  const preparedResized = new Set<DiagramLayoutNode>();
  const ancestorLinearAxes = new Map<DiagramLayoutNode, Axis>();
  const retainedDescendantDrawing = new Map<
    DiagramLayoutNode,
    DiagramLayoutSize
  >();
  const retainedDescendantSizes = new Map<
    DiagramLayoutNode,
    DiagramLayoutSize
  >();
  const ancestorLinearScales = new Map<
    DiagramLayoutNode,
    { w?: number; h?: number }
  >();
  const retainedCompositeChildren = new Map<
    DiagramLayoutNode,
    { w: number; h: number }
  >();
  const preparedCrossClipped = new Set<DiagramLayoutNode>();
  const projectedCross = new Map<DiagramLayoutNode, Dimensions>();
  const projectedCrossRetry = new Set<DiagramLayoutNode>();
  // Physical child rectangles belong to the enclosing COMPOSITE pass. A
  // child may subsequently draw beyond that rectangle during a local retry.
  const allocatedChildGeometry = new Map<
    DiagramLayoutNode,
    DiagramLayoutSize
  >();
  const heightReplayPreferences = new Map<DiagramLayoutNode, number>();
  const pendingLinearWidths = new Map<DiagramLayoutNode, number>();
  const projectedMainParents = new Set<DiagramLayoutNode>();
  const completedAncestorDrawing = new Map<
    DiagramLayoutNode,
    DiagramLayoutSize
  >();
  const entryContentFailed = new Set<DiagramLayoutNode>();
  const ownsCompositeRetry = (node: DiagramLayoutNode) =>
    compositePrepared.has(node) &&
    ((preparedCrossClipped.has(node) && !compositeResized.has(node)) ||
      projectedCrossRetry.has(node));
  const referenceFrozen = new Set<DiagramLayoutNode>();
  const geometricPasses = new Map<DiagramLayoutNode, Pass>();
  const canGrowHeight = (node: DiagramLayoutNode) =>
    text.some(
      (child) =>
        contains(node, child) &&
        rulesFor.get(child)?.some((rule) => {
          if (rule.target.type !== "h") return false;
          const state = pass.drawing.get(child)!;
          const trial = plan(state, rule);
          return trial && state.size.h < trial.limit;
        }),
    );
  const arrange = (
    node: DiagramLayoutNode,
    fallback = false,
    retry = false,
    retryingAncestor = false,
    preparing = false,
  ): boolean => {
    consume();
    // Publish accepted virtual values before another geometry pass reads them.
    // A scope's first publication below still captures any projected geometry.
    const published = fittedReferences.get(node);
    if (published && virtualReferences.has(node)) {
      const references = new Map(
        published.map((c) => [diagramConstraintPropertyKey(c.property), c]),
      );
      let changed = false;
      for (const [key, value] of virtualReferences.get(node)!) {
        if (
          !virtualProjectionKeys.get(node)?.has(key) ||
          !references.has(key) ||
          references.get(key)!.value === value.value
        )
          continue;
        references.set(key, value);
        changed = true;
      }
      if (changed) {
        fittedReferences.set(node, [...references.values()]);
        pass = fit(pass, [], true);
      }
    }
    const state = pass.allocation.get(node)!;
    const retainedCanvas = retainedCompositeCanvases.get(node);
    const current = {
      ...state,
      size: {
        w: retainedCanvas?.w ?? state.size.w,
        h: retainedCanvas?.h ?? state.size.h,
      },
    };
    if (linearHeightPreference(node))
      current.size.h = Math.max(
        current.size.h,
        pass.allocation.get(node.parent!)!.size.h,
      );
    const arrangement = arrangements.get(node)!;
    const axis = mainAxis(arrangement);
    // Descendants have completed the ancestor's content retry in their own
    // projected canvases. Their drawing may exceed this reserved container.
    if (
      retry &&
      arrangement.type === "composite" &&
      referenceFrozen.has(node) &&
      !childrenFit(node)
    ) {
      if (!canGrowHeight(node)) return false;
    }
    // A parent content retry rebuilds SP in the active search dimension.
    // Prepared children may complete that local step before the outer search;
    // a perpendicular child must not substitute its own packing dimension.
    // Font-only exhaustion has no later height retry and retains its spacers.
    const resetSpaces =
      retry &&
      axis !== null &&
      (retryingAncestor || prepared.has(node)) &&
      (fallback ||
        (prepared.has(node) &&
          !childrenFit(node) &&
          heightRules.has(node) &&
          searchAxes.get(node) === axis));
    // A completed LIN's pure geometric pass is repeatable within one unchanged
    // constraint pass. Reuse it on entry/exit unless content, local SP rebuilds
    // or a COMPOSITE child's completion requires a distinct search.
    if (
      prepared.has(node) &&
      !fallback &&
      !resetSpaces &&
      geometricPasses.get(node) === pass &&
      !node.children.some((child) => algorithm(child) === "composite")
    )
      return false;
    // A zero-axis composite stays unbounded until a parent supplies a
    // canvas. Its constraint values remain zero for relative child expressions.
    // An aspect ratio couples the axes and still permits collapse to zero.
    if (
      arrangement.type === "composite" &&
      arrangement.aspectRatio === 0 &&
      (current.size.w === 0 || current.size.h === 0)
    ) {
      for (const child of node.children)
        if (placements.delete(child)) invalidatePlacement(node);
      return false;
    }
    // LIN consumes prepared LIN preferences on entry and completed COMPOSITE
    // extents on exit. Drawing extents and reserved canvases remain distinct.
    const completed =
      (algorithm(node) === "composite" &&
        node.children.some(
          (child) =>
            compositePrepared.has(child) ||
            (algorithm(child) === "composite" &&
              ownCanvasAxes(child).length > 0),
        )) ||
      (algorithm(node) === "lin" &&
        node.children.some(
          (child) =>
            (retry && algorithm(child) === "composite") ||
            intrinsicComposites.has(child) ||
            prepared.has(child),
        ))
        ? drawingGeometry(node)
        : null;
    let refreshedReferenceGeometry = false;
    const rectangles = node.children.map((child) => {
      const state = pass.allocation.get(child)!;
      // Composite exit reuses the placement from its earlier fitting pass.
      // Resetting to an authored offset while retaining the resized extent
      // can make an already fitted rectangle overflow and shrink a second time.
      const placed =
        (retry ||
          (retryingAncestor &&
            linearHeightPreference(node) &&
            pass.retainedGeometryHeights.has(child))) &&
        (referenceFrozen.has(node) ||
          !fallback ||
          !intrinsicComposites.has(node)) &&
        arrangement.type === "composite" &&
        !compositePrepared.has(child) &&
        (referenceFrozen.has(node) ||
          !node.children.some(
            (sibling) =>
              compositePrepared.has(sibling) ||
              (algorithm(sibling) === "composite" &&
                ownCanvasAxes(sibling).length > 0),
          ))
          ? placements.get(child)
          : undefined;
      let preference =
        (algorithm(node) === "lin" ||
        compositePrepared.has(child) ||
        (algorithm(child) === "composite" && ownCanvasAxes(child).length > 0)
          ? (retainedCompositeChildren.get(child) ??
            completed?.drawingSizes.get(child))
          : null) ?? state.size;
      if (
        arrangement.type === "composite" &&
        !referenceFrozen.has(node) &&
        compositePrepared.has(child) &&
        retainedCompositeChildren.has(child)
      ) {
        const overrides = new Map<DiagramLayoutNode, DiagramLayoutSize>();
        const range = ranges.get(child)!;
        for (let i = range.start + 1; i < range.end; i++) {
          const descendant = nodes[i]!;
          if (algorithm(descendant) === "tx")
            overrides.set(descendant, {
              ...pass.drawing.get(descendant)!.size,
              h: pass.allocation.get(descendant)!.size.h,
            });
        }
        const allocatedDrawing = drawingGeometry(
          child,
          overrides,
        ).drawingSizes.get(child)!;
        preference = { ...preference, h: allocatedDrawing.h };
      }
      if (
        arrangement.type === "composite" &&
        referenceFrozen.has(node) &&
        compositePrepared.has(child)
      )
        preference = completed?.drawingSizes.get(child) ?? preference;
      if (
        arrangement.type === "composite" &&
        !retry &&
        !compositePrepared.has(child)
      ) {
        preference = completedAncestorDrawing.get(child) ?? preference;
        completedAncestorDrawing.delete(child);
      }
      if (retry && axis && intrinsicComposites.has(child))
        preference = drawingGeometry(
          child,
          referencePreferences,
        ).drawingSizes.get(child)!;
      if (referenceCanvases.has(node) && compositePrepared.has(child))
        preference = drawingGeometry(
          child,
          referencePreferences,
        ).drawingSizes.get(child)!;
      if (
        arrangement.type === "composite" &&
        preparedCrossClipped.has(child) &&
        ancestorLinearAxes.has(node) &&
        retainedCompositeChildren.has(child)
      ) {
        const childArrangement = arrangements.get(child)!;
        const childAxis = mainAxis(childArrangement)!;
        const cross = childAxis === "w" ? "h" : "w";
        const childCanvas = retainedDescendantSizes.get(child)!;
        const childOwnsReplay =
          childAxis === ancestorLinearAxes.get(node) &&
          !ancestorMainOverflow.has(node);
        const trial = childOwnsReplay
          ? null
          : arrangeDiagramChildren(
              {
                ...childCanvas,
                [cross]: Math.min(childCanvas[cross], current.size[cross]),
              },
              child.children.map((descendant) => ({
                x: 0,
                y: 0,
                ...retainedDescendantDrawing.get(descendant)!,
              })),
              childArrangement,
              { spacers: spacers.get(child) },
            );
        if (trial)
          preference = {
            ...preference,
            [childAxis]: trial.reduce(
              (total, rect) => total + rect[childAxis],
              0,
            ),
          };
      }
      if (
        arrangement.type === "composite" &&
        heightReplayPreferences.has(child)
      )
        preference = { ...preference, h: heightReplayPreferences.get(child)! };
      // A child without its own canvas in an axis inherits the enclosing
      // composite allocation. Complete that boundary before combining child
      // preferences, so internal drawing overflow cannot rescale siblings.
      if (
        arrangement.type === "composite" &&
        sizes.has(node) &&
        child.children.length
      ) {
        const owned = declaredCanvasAxes(child);
        for (const dimension of ["w", "h"] as const)
          if (
            !owned.includes(dimension) ||
            (dimension === "h" && reopenedHeightScopes.has(child))
          )
            preference = {
              ...preference,
              [dimension]: Math.min(
                preference[dimension],
                current.size[dimension],
              ),
            };
      }
      if (
        arrangement.type === "composite" &&
        retry &&
        referenceFrozen.has(node) &&
        projectedCrossRetry.has(child)
      ) {
        const childAxis = mainAxis(arrangements.get(child)!);
        const previous = allocatedChildGeometry.get(child);
        if (childAxis && previous) {
          const cross = childAxis === "w" ? "h" : "w";
          preference = { ...preference, [cross]: previous[cross] };
        }
      }
      if (axis === "w" && !retry && pendingLinearWidths.has(child)) {
        preference = { ...preference, w: pendingLinearWidths.get(child)! };
        pendingLinearWidths.delete(child);
      }
      return {
        x: (state.coordinates?.l ?? 0) + (placed?.x ?? 0),
        y: (state.coordinates?.t ?? 0) + (placed?.y ?? 0),
        ...preference,
        ...(algorithm(node) === "lin" && node.parent
          ? drawingCross.get(child)
          : {}),
      };
    });
    // A composite geometry retry reevaluates dimensions expressed through
    // user variables. Literal dimensions and physical canvas references keep
    // the allocation produced by the preceding projection.
    if (
      retry &&
      arrangement.type === "composite" &&
      !referenceFrozen.has(node)
    ) {
      // Resolve the active child coordinate declarations before selecting
      // references to refresh. Typed declarations are addressable variables,
      // but do not drive composite bounds; a later wildcard replaces an
      // earlier named coordinate without removing that named variable.
      const bases = new Map<DiagramLayoutNode, Map<Axis, DiagramConstraint>>();
      for (const constraint of current.constraints) {
        const { type, selector } = constraint.target;
        if (
          !assignsValue(constraint) ||
          selector.relationship !== "ch" ||
          selector.pointType !== "all" ||
          (type !== "w" && type !== "h")
        )
          continue;
        for (const child of selectDiagramConstraintTargets(node, selector)) {
          const dimensions =
            bases.get(child) ?? new Map<Axis, DiagramConstraint>();
          dimensions.set(type, constraint);
          bases.set(child, dimensions);
        }
      }
      for (const [index, child] of node.children.entries()) {
        for (const [type, constraint] of bases.get(child) ?? []) {
          if (
            constraint.reference.type.startsWith("user") &&
            !rulesFor.get(child)?.some((rule) => rule.target.type === type)
          ) {
            if (
              fallback ||
              virtualHeightGroups.some(
                (group) =>
                  compositeHeightBoundary(node, group) &&
                  group.scopes.some(
                    (scope) =>
                      scope.scope === node &&
                      diagramConstraintPropertyKey(scope.property) ===
                        diagramConstraintPropertyKey(constraint.reference),
                  ),
              )
            ) {
              boundDimensions(node, "w");
              boundDimensions(node, "h");
              const reference =
                constraint.reference.selector.relationship === "self"
                  ? self(node, constraint.reference.type, 0).property
                  : constraint.reference;
              // Content fallback keeps the preceding physical projection.
              // A user variable linked to that ruler shares its lifetime;
              // independent variables may publish a new text preference.
              if (
                rulerReferences
                  .get(node)
                  ?.has(diagramConstraintPropertyKey(reference))
              )
                continue;
            }
            const value = current.reference(constraint.target);
            refreshedReferenceGeometry ||= rectangles[index]![type] !== value;
            rectangles[index]![type] = value;
          }
        }
      }
    }
    if (
      axis &&
      retryingAncestor &&
      node.parent &&
      projectedMainParents.has(node.parent)
    ) {
      for (const change of fittedReferences.get(node) ?? []) {
        if (change.property.type !== axis) continue;
        for (const child of selectDiagramConstraintTargets(
          node,
          change.property.selector,
        )) {
          if (rulesFor.get(child)?.some((rule) => rule.target.type === axis))
            continue;
          const index = node.children.indexOf(child);
          if (index >= 0) rectangles[index]![axis] = change.value;
        }
      }
    }
    let restartedGeometry = false;
    if (initialCompositeResized.has(node) && !preparing) {
      if (!fallback && !retry)
        geometricInputs.set(
          node,
          rectangles.map((rect) => ({ w: rect.w, h: rect.h })),
        );
      if (fallback && !retry && !referenceFrozen.has(node)) {
        const inputs = geometricInputs.get(node);
        if (inputs) {
          restartedGeometry = true;
          for (let i = 0; i < rectangles.length; i++)
            Object.assign(rectangles[i]!, inputs[i]);
        }
      }
    }
    // A content retry starts a new reference scope at the preceding allocated
    // main-axis sizes, not a composite child's completed drawing union.
    // The next geometry pass may shrink physical children
    // again without rewriting these declarations. Numeric adjustment rules
    // retain their own authored reference domains, and fitting never enlarges
    // a declaration merely because another scope enlarged its physical child.
    if (axis && retry && fallback && !referenceFrozen.has(node)) {
      const committed = new Map(
        (fittedReferences.get(node) ?? []).map((change) => [
          diagramConstraintPropertyKey(change.property),
          change,
        ]),
      );
      for (const constraint of current.constraints) {
        if (
          projectedCrossRetry.has(node) &&
          committed.has(diagramConstraintPropertyKey(constraint.target))
        )
          continue;
        if (
          constraint.target.type !== axis ||
          constraint.target.selector.relationship !== "ch"
        )
          continue;
        const selected = selectDiagramConstraintTargets(
          node,
          constraint.target.selector,
        );
        if (
          selected.some((child) =>
            rulesFor.get(child)?.some((rule) => rule.target.type === axis),
          )
        )
          continue;
        const values = selected.map(
          (child) => pass.allocation.get(child)!.size[axis],
        );
        if (values.length && values.every((value) => value === values[0]))
          committed.set(diagramConstraintPropertyKey(constraint.target), {
            owner: node,
            property: constraint.target,
            value: Math.min(current.reference(constraint.target), values[0]!),
          });
      }
      if (committed.size) fittedReferences.set(node, [...committed.values()]);
    }
    if (
      axis &&
      (fallback || !childrenFit(node)) &&
      compositePrepared.has(node) &&
      !referenceFrozen.has(node)
    ) {
      const preceding = geometricPasses.get(node);
      if (preceding) {
        const refs = node.children.map((child) => ({
          x: 0,
          y: 0,
          ...preceding.allocation.get(child)!.size,
        }));
        const fitted = arrangeDiagramChildren(current.size, refs, arrangement, {
          childrenFit: false,
          spacers: spacers.get(node),
        });
        referencePreferences.set(node, {
          ...drawingGeometry(node).drawingSizes.get(node)!,
          [axis]: fitted.reduce((sum, rect) => sum + rect[axis], 0),
        });
      }
    }
    // A parent's allocation replays the child's completed text preference.
    // Resolve independent variables for geometry before computing its union;
    // references linked to the physical canvas retain their current ruler.
    if (
      !retry &&
      arrangement.type === "composite" &&
      sizes.has(node) &&
      virtualReferences.has(node)
    ) {
      const published = new Set(
        (fittedReferences.get(node) ?? []).map((c) =>
          diagramConstraintPropertyKey(c.property),
        ),
      );
      if (
        ![...virtualReferences.get(node)!.keys()].some((key) =>
          published.has(key),
        )
      ) {
        boundDimensions(node, "w");
        boundDimensions(node, "h");
        const completed = geometricPasses.get(node) ?? pass;
        const changes: DiagramConstraintValueChange[] = [];
        for (const group of virtualHeightGroups)
          for (const scope of group.scopes)
            if (
              scope.scope === node &&
              scope.property.selector.relationship === "self" &&
              scope.property.type.startsWith("user")
            )
              if (projectionMember(node, group))
                changes.push({
                  owner: node,
                  property: scope.property,
                  value:
                    scope.value *
                    completed.drawing.get(projectionMember(node, group)!)!.size
                      .h,
                });
        const references = current.evaluateScope({ changes }).get(node)!;
        for (const constraint of current.constraints) {
          const type = constraint.target.type;
          if (
            !assignsValue(constraint) ||
            !constraint.reference.type.startsWith("user") ||
            constraint.target.selector.relationship === "self" ||
            (type !== "w" && type !== "h")
          )
            continue;
          const reference =
            constraint.reference.selector.relationship === "self"
              ? self(node, constraint.reference.type, 0).property
              : constraint.reference;
          if (
            rulerReferences
              .get(node)
              ?.has(diagramConstraintPropertyKey(reference)) ||
            !virtualProjectionKeys
              .get(node)
              ?.has(diagramConstraintPropertyKey(reference))
          )
            continue;
          for (const child of selectDiagramConstraintTargets(
            node,
            constraint.target.selector,
          )) {
            const index = node.children.indexOf(child);
            if (
              index < 0 ||
              rulesFor.get(child)?.some((rule) => rule.target.type === type)
            )
              continue;
            rectangles[index]![type] = references.reference(constraint.target);
          }
        }
      }
    }
    // References crossing a COMPOSITE coordinate domain cannot grow with its
    // physical canvas. Resolve their clipped preference before the union,
    // and retain each subsequent geometric projection in the declaring scope.
    const externalGeometry: {
      constraint: DiagramConstraint;
      index: number;
      type: Axis;
      value: number;
    }[] = [];
    if (arrangement.type === "composite" && virtualReferences.has(node)) {
      boundDimensions(node, "w");
      boundDimensions(node, "h");
      const changes = new Map<string, DiagramConstraintValueChange>();
      for (const group of virtualHeightGroups) {
        if (
          projectionMember(node, group) ||
          !compositeHeightBoundary(node, group)
        )
          continue;
        for (const scope of group.scopes) {
          const key = diagramConstraintPropertyKey(scope.property);
          const fitted = virtualReferences.get(node)!.get(key);
          if (
            scope.scope !== node ||
            !fitted ||
            rulerReferences.get(node)?.has(key)
          )
            continue;
          const declared = current.reference(scope.property);
          const value =
            scope.value < 0
              ? Math.max(declared, fitted.value)
              : Math.min(declared, fitted.value);
          changes.set(key, { ...fitted, value });
        }
      }
      if (changes.size) {
        const altered = [...changes.values()].some(
          (c) => current.reference(c.property) !== c.value,
        );
        const resolved = altered
          ? current.evaluateScope({ changes: [...changes.values()] }).get(node)!
          : current;
        const active = new Map<
          DiagramLayoutNode,
          Map<Axis, DiagramConstraint>
        >();
        for (const constraint of current.constraints) {
          const { type, selector } = constraint.target;
          if (
            !assignsValue(constraint) ||
            selector.relationship !== "ch" ||
            selector.pointType !== "all" ||
            (type !== "w" && type !== "h")
          )
            continue;
          for (const child of selectDiagramConstraintTargets(node, selector)) {
            const axes =
              active.get(child) ?? new Map<Axis, DiagramConstraint>();
            axes.set(type, constraint);
            active.set(child, axes);
          }
        }
        for (const [index, child] of node.children.entries())
          for (const [type, constraint] of active.get(child) ?? []) {
            const reference =
              constraint.reference.selector.relationship === "self"
                ? self(node, constraint.reference.type, 0).property
                : constraint.reference;
            if (
              !changes.has(diagramConstraintPropertyKey(reference)) ||
              rulesFor.get(child)?.some((r) => r.target.type === type)
            )
              continue;
            const value = resolved.reference(constraint.target);
            rectangles[index]![type] = value;
            externalGeometry.push({ constraint, index, type, value });
          }
      }
    }
    const preferred = resetSpaces
      ? rectangles.map((rect, index) => {
          const child = node.children[index]!;
          return algorithm(child) === "sp" && rect[axis] !== 0
            ? { ...rect, [axis]: Math.min(rect[axis], localSpace(child, axis)) }
            : rect;
        })
      : rectangles;
    const mainOverflow =
      axis &&
      preferred.reduce((total, rect) => total + rect[axis], 0) -
        current.size[axis] >=
        1e-9;
    if (preparing && mainOverflow) preparedMainOverflow.add(node);
    if (mainOverflow) fittedLinearMain.add(node);
    // A rebuilt physical height ruler uses the completed COMPOSITE envelope
    // for its allocation replay. Drawing keeps the first local text preference.
    let reserved = preferred;
    if (linearHeightPreference(node) && !retry && !retryingAncestor) {
      const automatic = automaticHeightAllocation(
        node,
        current,
        current.size.h,
      );
      reserved = preferred.map((rect) => ({ ...rect }));
      for (const [index, child] of node.children.entries()) {
        const state = automatic.get(child)!;
        if (independentAutomaticHeight(child, state))
          preferred[index] = {
            ...preferred[index]!,
            h: Math.min(preferred[index]!.h, state.size.h),
          };
      }
      // The fitted preference determines the projection envelope; the physical
      // automatic span determines the drawn height. Their coordinates use the
      // same projection, and completed domains survive an ancestor-only retry.
    }
    if (
      arrangement.type === "composite" &&
      sizes.has(node) &&
      !retry &&
      !referenceFrozen.has(node)
    ) {
      const linked = boundDimensions(node, "h").filter(
        (binding) =>
          binding.type === "h" &&
          algorithm(binding.node) === "tx" &&
          rulesFor.get(binding.node)?.some((rule) => rule.target.type === "h"),
      );
      const width =
        Math.max(...preferred.map((rect) => rect.x + rect.w)) -
        Math.min(...preferred.map((rect) => rect.x));
      const height =
        Math.max(...preferred.map((rect) => rect.y + rect.h)) -
        Math.min(...preferred.map((rect) => rect.y));
      // Finish width projection before a height replay: wrapping can change
      // when the pending width allocation reaches the text scope.
      if (linked.length && width <= current.size.w && height > current.size.h) {
        const replay = current.evaluateScope({
          changes: [self(node, "h", height)],
          canvases: new Map(),
        });
        reserved = preferred.map((rect) => ({ ...rect }));
        const replayedDomains = new Map(pass.domains);
        const replayedHeights = new Map(pass.heights);
        let replayedNested = false;
        const replayedBranches = new Set<DiagramLayoutNode>();
        const allocatedOverrides = new Map<
          DiagramLayoutNode,
          DiagramLayoutSize
        >();
        const drawnOverrides = new Map<DiagramLayoutNode, DiagramLayoutSize>();
        for (const { node: child, factor } of linked) {
          const state = replay.get(child)!;
          const heightRule = rulesFor
            .get(child)!
            .find((rule) => rule.target.type === "h")!;
          const heightPlan = plan(state, heightRule)!;
          const startHeight =
            child.parent === node ? heightPlan.current : height * factor;
          const limitChanges = Number.isFinite(heightPlan.limit)
            ? equality(state, "h", heightPlan.limit)
                .scopes.filter((change) => change.scope === node)
                .map((change) => ({
                  owner: change.scope,
                  property: change.property,
                  value: change.value,
                }))
            : [];
          const captured = limitChanges.length
            ? current
                .evaluateScope({
                  changes: [self(node, "h", height)],
                  adjustments: limitChanges,
                  canvases: new Map(),
                })
                .get(child)!
            : state;
          const result = fitDiagramTextRules(rulesFor.get(child)!, (values) => {
            const trial = captured
              .evaluateScope({
                changes: localChanges(child),
                adjustments: [
                  self(child, "h", startHeight),
                  ...Object.entries(values).map(([type, value]) =>
                    self(child, type as DiagramConstraintType, value),
                  ),
                ],
                canvases: new Map(),
              })
              .get(child)!;
            return {
              ...measure(child, trial, pass.algorithms.get(child)!),
              rulePlan: (rule: DiagramConstraintRule) => plan(trial, rule),
            };
          });
          const replayHeight =
            result.allocationHeight ?? result.values.h ?? state.size.h;
          const branch = node.children.find((branch) =>
            contains(branch, child),
          )!;
          const index = node.children.indexOf(branch);
          if (branch === child) {
            reserved[index]!.h = Math.max(reserved[index]!.h, replayHeight);
          } else {
            const domain = domainFor.get(child)!;
            const prior = replayedDomains.get(domain)!;
            const changes = equality(
              pass.allocation.get(child)!,
              "h",
              replayHeight,
            ).changes;
            const replace = (
              before: readonly DiagramConstraintValueChange[],
            ) => [
              ...before.filter(
                (change) =>
                  !changes.some(
                    (next) =>
                      next.owner === change.owner &&
                      diagramConstraintPropertyKey(next.property) ===
                        diagramConstraintPropertyKey(change.property),
                  ),
              ),
              ...changes,
            ];
            let drawn = prior.drawn;
            let drawingHeight = pass.drawing.get(child)!.size.h;
            if (algorithm(branch) === "lin") {
              const local = fitDiagramTextRules(
                rulesFor.get(child)!,
                (values) => {
                  const trial = captured
                    .evaluateScope({
                      changes: localChanges(child),
                      adjustments: [
                        self(child, "h", startHeight),
                        ...Object.entries(values).map(([type, value]) =>
                          self(child, type as DiagramConstraintType, value),
                        ),
                      ],
                      canvases: new Map(),
                    })
                    .get(child)!;
                  return {
                    ...measure(child, trial, pass.algorithms.get(child)!),
                    rulePlan: (rule: DiagramConstraintRule) => {
                      const resolved = plan(trial, rule);
                      return resolved && rule.target.type === "h"
                        ? {
                            ...resolved,
                            limit: Math.min(resolved.limit, replayHeight),
                          }
                        : resolved;
                    },
                  };
                },
              );
              drawingHeight = local.values.h ?? drawingHeight;
              const drawChanges = equality(
                pass.allocation.get(child)!,
                "h",
                drawingHeight,
              ).changes;
              drawn = [
                ...prior.drawn.filter(
                  (change) =>
                    !drawChanges.some(
                      (next) =>
                        next.owner === change.owner &&
                        diagramConstraintPropertyKey(next.property) ===
                          diagramConstraintPropertyKey(change.property),
                    ),
                ),
                ...drawChanges,
              ];
              replayedDrawing.add(domain);
              replayedHeightStarts.set(child, startHeight);
            }
            replayedDomains.set(domain, {
              allocated: replace(prior.allocated),
              drawn,
            });
            const group = heightFor.get(child);
            if (group) replayedHeights.set(group, replayHeight);
            allocatedOverrides.set(child, {
              ...pass.drawing.get(child)!.size,
              h: replayHeight,
            });
            drawnOverrides.set(child, {
              ...pass.drawing.get(child)!.size,
              h: drawingHeight,
            });
            replayedBranches.add(branch);
            replayedNested = true;
          }
        }
        if (replayedNested) {
          for (const branch of replayedBranches) {
            const index = node.children.indexOf(branch);
            const reservedHeight = drawingGeometry(
              branch,
              allocatedOverrides,
            ).drawingSizes.get(branch)!.h;
            const drawnHeight = drawingGeometry(
              branch,
              drawnOverrides,
            ).drawingSizes.get(branch)!.h;
            reserved[index]!.h = reservedHeight;
            preferred[index]!.h =
              algorithm(branch) === "lin" ? drawnHeight : reservedHeight;
            heightReplayPreferences.set(
              branch,
              algorithm(branch) === "lin" ? drawnHeight : reservedHeight,
            );
          }
          const allocation = evaluate(
            [...replayedDomains.values()].flatMap((domain) => domain.allocated),
          );
          const drawing = evaluate(
            [...replayedDomains.values()].flatMap((domain) => domain.drawn),
            allocation,
          );
          const fits = new Map(pass.fits);
          for (const textNode of text)
            fits.set(
              textNode,
              textFits(
                textNode,
                allocation.get(textNode)!,
                pass.algorithms.get(textNode)!,
              ) &&
                textFits(
                  textNode,
                  drawing.get(textNode)!,
                  pass.algorithms.get(textNode)!,
                ),
            );
          pass = recordVirtualReferences({
            ...pass,
            domains: replayedDomains,
            heights: replayedHeights,
            allocation,
            drawing,
            fits,
          });
        }
      }
    }
    const projectionEnvelope: { w?: number; h?: number } = {};
    if (arrangement.type === "composite" && !retry) {
      const range = ranges.get(node)!;
      let retained:
        Map<DiagramLayoutNode, DiagramInitialConstraints> | undefined;
      for (const dimension of ["w", "h"] as const) {
        const coordinate = dimension === "w" ? "x" : "y";
        const leading = dimension === "w" ? "l" : "t";
        const inputs = node.children.map((child) =>
          pass.allocation.get(child)!.leadingCoordinates.has(leading),
        );
        const extent = (rects: readonly DiagramLayoutRect[]) =>
          Math.max(...rects.map((rect) => rect[coordinate] + rect[dimension])) -
          Math.min(...rects.map((rect) => rect[coordinate]));
        const original = extent(reserved);
        if (
          !(
            current.size[dimension] > 0 && original > current.size[dimension]
          ) ||
          !inputs.some(Boolean)
        )
          continue;
        retained ??= new Map(
          nodes
            .slice(range.start, range.end)
            .map((child) => [child, pass.allocation.get(child)!]),
        );
        const allocations = retained;
        projectionEnvelope[dimension] = fitDiagramCompositeCanvas(
          current.size[dimension],
          original,
          (ruler) => {
            // Charge each rebuilt scope, including divergent reference trials.
            for (let i = range.start; i < range.end; i++) consume();
            const trial = current.evaluateScope({
              retainLocalTrials: true,
              changes: [self(node, dimension, ruler)],
              allocations,
              coordinateOrigins: new Map(),
              coordinateScales: new Map(),
              compositeReferenceRulers: new Map([
                [node, { [dimension]: ruler }],
              ]),
            });
            // Only authored leading coordinates follow the trial ruler. Child
            // dimensions and derived center/trailing placements retain their
            // entrance allocation; projection materializes them afterwards.
            return extent(
              reserved.map((rect, index) =>
                inputs[index]
                  ? {
                      ...rect,
                      [coordinate]: trial.get(node.children[index]!)!
                        .coordinates![leading],
                    }
                  : rect,
              ),
            );
          },
        );
      }
    }
    const arranged = arrangeDiagramChildren(
      {
        ...(referenceCanvases.get(node) ?? current.size),
        ...projectedCross.get(node),
      },
      reserved,
      arrangement,
      {
        projectionEnvelope,
        projectedCoordinates: (scales) => {
          if (linearHeightPreference(node) && !retry && !retryingAncestor) {
            const range = ranges.get(node)!;
            for (let i = range.start; i < range.end; i++) consume();
            const changes = node.children.flatMap((child, index) =>
              (["w", "h"] as const)
                .filter((axis) => scales[axis] !== 1)
                .map((axis) =>
                  self(child, axis, preferred[index]![axis] * scales[axis]),
                ),
            );
            if (changes.length) {
              // Re-evaluate authored position expressions against projected
              // dimensions. Literal offsets remain literal; live height and
              // trailing-edge references follow the physical drawing.
              const trial = current.evaluateScope({
                retainLocalTrials: true,
                adjustments: changes,
                coordinateOrigins: new Map(
                  [...coordinateOrigins].filter(
                    ([child]) => child.parent !== node,
                  ),
                ),
                coordinateScales: new Map(
                  [...coordinateScales].filter(
                    ([child]) => child.parent !== node,
                  ),
                ),
              });
              return node.children.map((child) => {
                const state = pass.allocation.get(child)!;
                const fresh = trial.get(child)!;
                const coordinates: { x?: number; y?: number } = {};
                for (const [axis, leading, coordinate] of [
                  ["w", "l", "x"],
                  ["h", "t", "y"],
                ] as const)
                  if (
                    scales[axis] !== 1 &&
                    state.leadingCoordinates.has(leading)
                  ) {
                    const value = fresh.coordinates?.[leading];
                    if (value !== undefined) coordinates[coordinate] = value;
                  }
                return coordinates;
              });
            }
          }
          const changes = node.children.flatMap((child) => {
            const state = pass.allocation.get(child)!;
            return (["w", "h"] as const).flatMap((axis) => {
              const reserved = state.aspectReservation?.[axis];
              return reserved !== undefined &&
                scales[axis] !== 1 &&
                reserved * scales[axis] > state.values.get(axis)!
                ? [self(child, axis, reserved * scales[axis])]
                : [];
            });
          });
          if (!changes.length) return;
          const range = ranges.get(node)!;
          for (let i = range.start; i < range.end; i++) consume();
          const trial = current.evaluateScope({
            retainLocalTrials: true,
            changes,
            allocations: new Map(
              nodes
                .slice(range.start, range.end)
                .map((child) => [child, pass.allocation.get(child)!]),
            ),
            // Reopen this parent's child coordinates in their entrance domain.
            // Completed projections inside those children retain their scope.
            coordinateOrigins: new Map(
              [...coordinateOrigins].filter(([child]) => child.parent !== node),
            ),
            coordinateScales: new Map(
              [...coordinateScales].filter(([child]) => child.parent !== node),
            ),
          });
          return node.children.map((child) => {
            const state = pass.allocation.get(child)!,
              fresh = trial.get(child)!,
              coordinates: { x?: number; y?: number } = {};
            for (const [axis, leading, coordinate] of [
              ["w", "l", "x"],
              ["h", "t", "y"],
            ] as const)
              if (
                scales[axis] !== 1 &&
                state.leadingCoordinates.has(leading) &&
                fresh.coordinates![leading] !== state.coordinates![leading]
              )
                coordinates[coordinate] = fresh.coordinates![leading];
            return coordinates;
          });
        },
        reservedSizes:
          arrangement.type === "composite"
            ? node.children.map((child, index) => ({
                ...pass.allocation.get(child)!.aspectReservation,
                ...(linearHeightPreference(node) && !retry && !retryingAncestor
                  ? { h: preferred[index]!.h }
                  : {}),
              }))
            : undefined,
        spacers: spacers.get(node),
        childrenFit:
          !fallback || (referenceFrozen.has(node) && !canGrowHeight(node)),
      },
    );
    if (
      reserved !== preferred &&
      !(linearHeightPreference(node) && !retry && !retryingAncestor)
    )
      for (const [index, rect] of arranged.entries())
        if (
          reserved[index]!.h !== preferred[index]!.h &&
          reserved[index]!.h !== 0
        )
          arranged[index] = {
            ...rect,
            h: (rect.h * preferred[index]!.h) / reserved[index]!.h,
          };
    if (
      refreshedReferenceGeometry &&
      fallback &&
      virtualProjectionKeys.has(node)
    ) {
      const contributing = arranged.filter(
        (rect) => rect.w !== 0 || rect.h !== 0,
      );
      if (contributing.length)
        referencePreferences.set(node, {
          w:
            Math.max(...contributing.map((r) => r.x + r.w)) -
            Math.min(...contributing.map((r) => r.x)),
          h:
            Math.max(...contributing.map((r) => r.y + r.h)) -
            Math.min(...contributing.map((r) => r.y)),
        });
    }
    if (
      axis &&
      (!fittedReferences.has(node) || restartedGeometry) &&
      !preparing &&
      !retry &&
      ((compositePrepared.has(node) &&
        (!fallback || restartedGeometry) &&
        node.parent &&
        ancestorLinearAxes.has(node.parent)) ||
        node.children.some((child) => intrinsicComposites.has(child)))
    ) {
      const committed = new Map<string, DiagramConstraintValueChange>();
      for (const constraint of current.constraints) {
        if (
          constraint.target.type !== axis ||
          constraint.target.selector.relationship !== "ch"
        )
          continue;
        const selected = selectDiagramConstraintTargets(
          node,
          constraint.target.selector,
        );
        const values = selected.map(
          (child) => arranged[node.children.indexOf(child)]![axis],
        );
        if (values.length && values.every((value) => value === values[0]))
          committed.set(diagramConstraintPropertyKey(constraint.target), {
            owner: node,
            property: constraint.target,
            value: values[0]!,
          });
      }
      if (committed.size) fittedReferences.set(node, [...committed.values()]);
    }
    const replaying =
      axis &&
      retry &&
      node.children.some(
        (child) =>
          intrinsicComposites.has(child) &&
          child.children.some((descendant) => geometricInputs.has(descendant)),
      );
    const physicalArrangement = replaying
      ? arrangeDiagramChildren(
          current.size,
          preferred.map((rect, i) => {
            const child = node.children[i]!;
            return intrinsicComposites.has(child) &&
              child.children.some((descendant) =>
                geometricInputs.has(descendant),
              )
              ? { ...rect, ...drawingGeometry(child).drawingSizes.get(child)! }
              : rect;
          }),
          arrangement,
          {
            spacers: spacers.get(node),
            childrenFit:
              !fallback || (referenceFrozen.has(node) && !canGrowHeight(node)),
          },
        )
      : null;
    const physicalComposite = referenceCanvases.has(node)
      ? arrangeDiagramChildren(
          current.size,
          preferred.map((rect, i) => {
            const child = node.children[i]!;
            return compositePrepared.has(child)
              ? { ...rect, ...drawingGeometry(child).drawingSizes.get(child)! }
              : rect;
          }),
          arrangement,
          { childrenFit: !fallback, spacers: spacers.get(node) },
        )
      : null;
    let publishedVirtual = false;
    if (externalGeometry.length) {
      const references = new Map(
        (fittedReferences.get(node) ?? []).map((c) => [
          diagramConstraintPropertyKey(c.property),
          c,
        ]),
      );
      for (const { constraint, index, type, value } of externalGeometry) {
        const extent = rectangles[index]![type];
        // An identity projection must preserve the exact reference value;
        // multiplying and dividing it can round into a spurious new reference.
        const projected =
          extent === 0 || arranged[index]![type] === extent
            ? value
            : (value * arranged[index]![type]) / extent;
        // Before parent allocation, a changed reference preference alone does
        // not replace the preceding physical drawing. An actual projection
        // does establish a new geometry reference immediately.
        if (!sizes.has(node) && projected === value) continue;
        if (projected === current.reference(constraint.target)) continue;
        references.set(diagramConstraintPropertyKey(constraint.target), {
          owner: node,
          property: constraint.target,
          value: projected,
        });
        publishedVirtual = true;
      }
      if (publishedVirtual)
        fittedReferences.set(node, [...references.values()]);
    }

    if (
      !retry &&
      arrangement.type === "composite" &&
      sizes.has(node) &&
      virtualReferences.has(node)
    ) {
      const references = new Map(
        (fittedReferences.get(node) ?? []).map((c) => [
          diagramConstraintPropertyKey(c.property),
          c,
        ]),
      );
      let publishedStates: States | undefined;
      // Geometry keeps the reference expressions captured before the text
      // scope publishes fitted variables. An independent ruled height is a
      // text preference and starts its next search at the published value.
      for (const constraint of current.constraints) {
        if (
          !assignsValue(constraint) ||
          !constraint.reference.type.startsWith("user") ||
          constraint.target.selector.relationship === "self" ||
          (constraint.target.type !== "w" && constraint.target.type !== "h")
        )
          continue;
        const targets = selectDiagramConstraintTargets(
          node,
          constraint.target.selector,
        );
        const independentHeight =
          constraint.target.type === "h" &&
          targets.length &&
          targets.every((child) => {
            const height = heightFor.get(child);
            return (
              height?.scopes.some(
                ({ scope, property }) =>
                  scope === node &&
                  property.selector.relationship === "self" &&
                  property.type !== "w" &&
                  property.type !== "h",
              ) &&
              !height.scopes.some(
                ({ scope, property }) =>
                  scope === node &&
                  property.selector.relationship === "self" &&
                  (property.type === "w" || property.type === "h"),
              )
            );
          });
        if (independentHeight) continue;
        const alreadyPublished = [
          ...(virtualReferences.get(node)?.keys() ?? []),
        ].some((key) => references.has(key));
        const type = constraint.target.type as Axis;
        const projected = targets.some((child) => {
          const index = node.children.indexOf(child);
          return (
            index >= 0 && arranged[index]![type] !== rectangles[index]![type]
          );
        });
        boundDimensions(node, "w");
        boundDimensions(node, "h");
        const reference =
          constraint.reference.selector.relationship === "self"
            ? self(node, constraint.reference.type, 0).property
            : constraint.reference;
        const physical = rulerReferences
          .get(node)
          ?.has(diagramConstraintPropertyKey(reference));
        const local = virtualProjectionKeys
          .get(node)
          ?.has(diagramConstraintPropertyKey(reference));
        if (local && (alreadyPublished || (!projected && !physical))) continue;
        const key = diagramConstraintPropertyKey(constraint.target);
        if (!references.has(key)) {
          let value = current.reference(constraint.target);
          if (local && projected && !physical) {
            publishedStates ??= current.evaluateScope({
              changes: [...virtualReferences.get(node)!.values()],
            });
            const fittedValue = publishedStates
              .get(node)!
              .reference(constraint.target);
            // A projected coordinate remains bounded by its old reference.
            // Transform the newly fitted expression through the same physical
            // projection as its child before retaining that reference bound.
            for (const target of targets) {
              const index = node.children.indexOf(target);
              if (index < 0 || rectangles[index]![type] === 0) continue;
              const scale = arranged[index]![type] / rectangles[index]![type];
              value =
                type === "h"
                  ? fittedValue * scale
                  : Math.min(value, fittedValue * scale);
            }
          }
          references.set(key, {
            owner: node,
            property: constraint.target,
            value,
          });
          publishedVirtual = true;
        }
      }
      for (const [key, change] of virtualReferences.get(node) ?? []) {
        if (references.get(key)?.value === change.value) continue;
        references.set(key, change);
        publishedVirtual = true;
      }
      if (publishedVirtual)
        fittedReferences.set(node, [...references.values()]);
    }
    if (arrangement.type === "composite")
      for (const [index, child] of node.children.entries())
        if (compositePrepared.has(child))
          allocatedChildGeometry.set(child, {
            w: arranged[index]!.w,
            h: arranged[index]!.h,
          });
    const resized: DiagramLayoutNode[] = [];
    for (const [index, child] of node.children.entries()) {
      let rect = arranged[index]!;
      if (physicalComposite && !compositePrepared.has(child))
        rect = physicalComposite[index]!;
      if (physicalArrangement) {
        const physical = physicalArrangement[index]!;
        if (
          intrinsicComposites.has(child) &&
          child.children.some((descendant) => geometricInputs.has(descendant))
        )
          referenceCanvases.set(child, { w: rect.w, h: rect.h });
        rect = physical;
      }
      const before = rectangles[index]!;
      if (axis && retry && intrinsicComposites.has(child)) {
        const completed = drawingGeometry(child);
        for (const descendant of child.children)
          completedAncestorDrawing.set(descendant, {
            ...completed.drawingSizes.get(descendant)!,
          });
      }
      const completedCompositeChild =
        arrangement.type === "composite" && compositePrepared.has(child);
      const ancestorAxis = ancestorLinearAxes.get(node);
      const ancestorCross = ancestorAxis === "w" ? "h" : "w";
      const childAxis = completedCompositeChild
        ? mainAxis(arrangements.get(child)!)
        : null;
      const inheritedPreparedCross =
        completedCompositeChild &&
        preparedCrossClipped.has(child) &&
        ancestorAxis;
      const inheritsCrossClip =
        inheritedPreparedCross &&
        childAxis === ancestorAxis &&
        !ancestorMainOverflow.has(node) &&
        ancestorLinearScales.get(node)?.[ancestorCross] !== undefined;
      if (
        completedCompositeChild &&
        childAxis &&
        !retry &&
        !compositeResized.has(child)
      ) {
        const cross = childAxis === "w" ? "h" : "w";
        const extent = (axis: "w" | "h") => {
          const origin = axis === "w" ? "x" : "y";
          return (
            Math.max(...rectangles.map((r) => r[origin] + r[axis])) -
            Math.min(...rectangles.map((r) => r[origin]))
          );
        };
        let scale =
          extent(cross) > current.size[cross]
            ? current.size[cross] / extent(cross)
            : 1;
        if (arrangement.type === "composite" && arrangement.aspectRatio > 0) {
          const other = cross === "w" ? "h" : "w";
          scale = Math.min(
            scale,
            extent(other) > current.size[other]
              ? current.size[other] / extent(other)
              : 1,
          );
        }
        const projected = pass.allocation.get(child)!.size[cross] * scale;
        const boundedByParent = scale < 1 && projected < current.size[cross];
        const projectedDrawing = before[cross] * scale;
        // Division and multiplication can round an exact boundary to opposite
        // sides. Only a reduction beyond their arithmetic error means that
        // position clipping introduced another cross-axis budget.
        const projectionError =
          Number.EPSILON *
            (Math.abs(projectedDrawing) + Math.abs(rect[cross])) +
          Number.MIN_VALUE;
        const clippedByPosition =
          projectedDrawing - rect[cross] > projectionError;
        if (boundedByParent || clippedByPosition) {
          if (boundedByParent) {
            projectedCrossRetry.add(child);
            if (rect[childAxis] < before[childAxis])
              projectedMainParents.add(node);
          }
          projectedCross.set(child, {
            [cross]: Math.max(
              current.size[cross],
              referenceFrozen.has(node)
                ? pass.allocation.get(child)!.size[cross]
                : projected,
            ),
          });
        }
      }
      if (completedCompositeChild) {
        const canvas = pass.allocation.get(child)!.size;
        const reference =
          referenceFrozen.has(node) && initialCompositeResized.has(child)
            ? drawingGeometry(child, referencePreferences).drawingSizes.get(
                child,
              )!
            : before;
        rect = {
          ...rect,
          w:
            rect.w === before.w
              ? canvas.w
              : before.w === 0
                ? rect.w
                : (canvas.w * rect.w) / reference.w,
          h:
            rect.h === before.h
              ? canvas.h
              : before.h === 0
                ? rect.h
                : (canvas.h * rect.h) / reference.h,
        };
      }
      if (retry && projectedMainParents.has(node) && childAxis) {
        const cross = childAxis === "w" ? "h" : "w";
        const origin = cross === "w" ? "x" : "y";
        const coordinate = cross === "w" ? "l" : "t";
        rect = {
          ...rect,
          [cross]: pass.allocation.get(child)!.size[cross],
          [origin]:
            (placements.get(child)?.[origin] ?? 0) +
            (pass.allocation.get(child)!.coordinates?.[coordinate] ?? 0),
        };
      }
      if (
        completedCompositeChild ||
        (arrangement.type === "composite" && algorithm(child) === "composite")
      ) {
        const childState = pass.allocation.get(child)!;
        const ownAxes = ownCanvasAxes(child);
        if (ownAxes.length) {
          const local = childState
            .evaluateScope({ localDimensions: ownAxes, canvases: new Map() })
            .get(child)!;
          for (const ownAxis of ownAxes) {
            // A child-local retry has already completed this cross canvas.
            // A geometric parent retry must not reopen its earlier declaration.
            if (
              retry &&
              completedCompositeChild &&
              ownsCompositeRetry(child) &&
              ownAxis !== childAxis
            )
              continue;
            rect = { ...rect, [ownAxis]: local.size[ownAxis] };
          }
        }
      }
      if (inheritedPreparedCross && childAxis) {
        const cross = childAxis === "w" ? "h" : "w";
        rect = {
          ...rect,
          [cross]: Math.min(
            retainedDescendantSizes.get(child)?.[cross] ??
              pass.allocation.get(child)!.size[cross],
            current.size[cross],
          ),
        };
      }
      if (
        algorithm(node) === "lin" &&
        retry &&
        intrinsicComposites.has(child)
      ) {
        const range = ranges.get(child)!;
        for (let i = range.start; i < range.end; i++)
          referenceFrozen.add(nodes[i]!);
      }
      if (
        completedCompositeChild &&
        ancestorLinearAxes.has(node) &&
        !referenceFrozen.has(node)
      ) {
        const committed = new Map(
          (fittedReferences.get(node) ?? []).map((change) => [
            diagramConstraintPropertyKey(change.property),
            change,
          ]),
        );
        for (const constraint of current.constraints) {
          const type = constraint.target.type;
          if (
            (type !== "w" && type !== "h") ||
            constraint.target.selector.relationship !== "ch"
          )
            continue;
          const selected = selectDiagramConstraintTargets(
            node,
            constraint.target.selector,
          );
          if (selected.length === 1 && selected[0] === child)
            committed.set(diagramConstraintPropertyKey(constraint.target), {
              owner: node,
              property: constraint.target,
              value: rect[type],
            });
        }
        if (committed.size) fittedReferences.set(node, [...committed.values()]);
      }
      if (
        arrangement.type === "lin" &&
        linearHeightPreference(child) &&
        fallback &&
        !retry
      )
        rect = { ...rect, h: Math.max(rect.h, current.size.h) };
      const position = {
        ...rect,
        x: rect.x - (pass.allocation.get(child)!.coordinates?.l ?? 0),
        y: rect.y - (pass.allocation.get(child)!.coordinates?.t ?? 0),
      };
      const previous = placements.get(child);
      if (previous?.x !== position.x || previous.y !== position.y)
        invalidatePlacement(node);
      placements.set(child, position);
      const allocationBefore =
        completedCompositeChild ||
        (arrangement.type === "composite" &&
          algorithm(child) === "composite" &&
          ownCanvasAxes(child).length > 0)
          ? pass.allocation.get(child)!.size
          : before;
      if (rect.w !== allocationBefore.w || rect.h !== allocationBefore.h) {
        if (arrangement.type === "composite") {
          const origin = pass.allocation
            .get(child)!
            .captureCompositeCoordinates();
          if (origin) coordinateOrigins.set(child, origin);
          const scales = { ...coordinateScales.get(child) };
          // Completed child drawing and reserved canvas share the physical
          // projection ratio; use the arrangement before canvas conversion.
          const projected = arranged[index]!;
          if (before.w && projected.w !== before.w)
            scales.w = projected.w / before.w;
          if (before.h && projected.h !== before.h)
            scales.h = projected.h / before.h;
          coordinateScales.set(child, scales);
        }
        if (algorithm(node) === "lin" && node.parent && axis) {
          const cross = axis === "w" ? "h" : "w";
          if (preparing && rect[cross] !== before[cross])
            preparedCrossClipped.add(node);
          if (
            rect[cross] !== before[cross] &&
            (algorithm(node.parent) === "composite"
              ? !preparing
              : drawingCross.get(child)?.[cross] === undefined)
          )
            drawingCross.set(child, {
              ...drawingCross.get(child),
              [cross]:
                algorithm(node.parent) === "composite" &&
                (!declaredCanvasAxes(node).includes(cross) ||
                  (cross === "h" && reopenedHeightScopes.has(node)))
                  ? rect[cross]
                  : projectedCross.get(node)?.[cross] !== undefined
                    ? Math.min(before[cross], projectedCross.get(node)![cross]!)
                    : preparedCrossClipped.has(node) &&
                        compositeResized.has(node) &&
                        ancestorLinearAxes.has(node.parent)
                      ? rect[cross]
                      : (algorithm(node.parent) === "composite"
                          ? pass.allocation
                          : pass.drawing
                        ).get(child)!.size[cross],
            });
        }
        if (completedCompositeChild) {
          if (
            !ancestorLinearAxes.has(node) &&
            node.parent &&
            algorithm(node.parent) === "lin"
          )
            initialCompositeResized.add(child);
          const inheritedScale = inheritsCrossClip
            ? ancestorLinearScales.get(node)
            : preparedMainOverflow.has(child) &&
                ancestorMainOverflow.has(node) &&
                childAxis === ancestorAxis
              ? { [childAxis!]: ancestorLinearScales.get(node)?.[childAxis!] }
              : undefined;
          const range = ranges.get(child)!;
          for (let i = range.start + 1; i < range.end; i++) {
            const descendant = nodes[i]!;
            if (retry && algorithm(descendant) === "tx") frozen.add(descendant);
            if (
              retry &&
              ancestorLinearAxes.has(node) &&
              childAxis === "w" &&
              compositeResized.has(child) &&
              algorithm(descendant) === "tx" &&
              rect.w !== allocationBefore.w
            ) {
              const parent = descendant.parent;
              const parentOwnsWidth =
                parent &&
                pass.allocation
                  .get(parent)!
                  .constraints.some(
                    (constraint) =>
                      constraint.target.type === "w" &&
                      selectDiagramConstraintTargets(
                        parent,
                        constraint.target.selector,
                      ).includes(descendant),
                  );
              if (!parentOwnsWidth)
                pendingLinearWidths.set(
                  descendant,
                  pass.allocation.get(descendant)!.size.w,
                );
              const width = Math.min(
                pass.allocation.get(descendant)!.size.w,
                descendant.parent === child
                  ? rect.w
                  : pass.allocation.get(descendant.parent!)!.size.w,
              );
              sizes.set(descendant, { ...sizes.get(descendant), w: width });
              canvases.set(descendant, {
                ...canvases.get(descendant),
                w: width,
              });
            }
            if (!compositeResized.has(child)) {
              if (
                childAxis === "w" &&
                inheritedScale?.w !== undefined &&
                algorithm(descendant) === "tx"
              ) {
                const parent = descendant.parent!;
                const parentOwnsWidth = pass.allocation
                  .get(parent)!
                  .constraints.some(
                    (constraint) =>
                      constraint.target.type === "w" &&
                      assignsValue(constraint) &&
                      selectDiagramConstraintTargets(
                        parent,
                        constraint.target.selector,
                      ).includes(descendant),
                  );
                if (!parentOwnsWidth)
                  pendingLinearWidths.set(
                    descendant,
                    retainedDescendantDrawing.get(descendant)?.w ??
                      pass.allocation.get(descendant)!.size.w,
                  );
              }
              const dimensions = { ...sizes.get(descendant) };
              for (const key of ["w", "h"] as const) {
                if (rect[key] === allocationBefore[key]) continue;
                if (
                  inheritedPreparedCross &&
                  key === childAxis &&
                  ancestorLinearScales.get(node)?.[
                    childAxis === "w" ? "h" : "w"
                  ] === undefined
                ) {
                  dimensions[key] =
                    retainedDescendantSizes.get(descendant)?.[key] ??
                    pass.allocation.get(descendant)!.size[key];
                } else if (inheritsCrossClip) {
                  dimensions[key] =
                    key === ancestorAxis
                      ? (retainedDescendantSizes.get(descendant)?.[key] ??
                          pass.allocation.get(descendant)!.size[key]) *
                        (inheritedScale?.[key] ?? 1)
                      : pass.allocation
                          .get(descendant)!
                          .evaluateScope({ canvases: new Map() })
                          .get(descendant)!.size[key];
                } else {
                  dimensions[key] =
                    Math.min(
                      pass.allocation
                        .get(descendant)!
                        .evaluateScope({ canvases: new Map() })
                        .get(descendant)!.size[key],
                      pass.allocation.get(descendant.parent!)!.size[key],
                    ) *
                    (inheritedScale?.[key] ??
                      (key === childAxis &&
                      (!declaredCanvasAxes(child).includes(
                        key === "w" ? "h" : "w",
                      ) ||
                        (key === "w" && reopenedHeightScopes.has(child)) ||
                        (referenceFrozen.has(node) &&
                          projectedCrossRetry.has(child) &&
                          !ownCanvasAxes(child).includes(
                            key === "w" ? "h" : "w",
                          ))) &&
                      allocationBefore[key] !== 0
                        ? rect[key] / allocationBefore[key]
                        : 1));
                }
                const cap = { ...canvases.get(descendant) };
                delete cap[key];
                canvases.set(descendant, cap);
              }
              sizes.set(descendant, dimensions);
            }
          }
          if (!inheritsCrossClip) compositeResized.add(child);
        } else if (
          (prepared.has(child) ||
            (retry &&
              intrinsicComposites.has(child) &&
              child.children.some((descendant) =>
                fittedLinearMain.has(descendant),
              ))) &&
          axis
        ) {
          const range = ranges.get(child)!;
          for (let i = range.start + 1; i < range.end; i++) {
            const descendant = nodes[i]!,
              beforeSize = pass.allocation.get(descendant)!.size;
            // A prepared child with its own canvas runs its own fitting pass.
            // Ancestor projection must not also rescale that child's subtree.
            if (
              compositePrepared.has(descendant) &&
              ownCanvasAxes(descendant).includes(axis)
            ) {
              i = ranges.get(descendant)!.end - 1;
              continue;
            }
            let value = beforeSize[axis];
            if (
              retry &&
              fallback &&
              prepared.has(child) &&
              algorithm(descendant) === "sp"
            )
              value = Math.min(value, localSpace(descendant, axis));
            if (
              rect[axis] !== before[axis] &&
              before[axis] !== 0 &&
              !(
                retry &&
                fallback &&
                intrinsicComposites.has(child) &&
                [...referencePreferences.keys()].some((owner) =>
                  contains(child, owner),
                )
              )
            )
              value *= rect[axis] / before[axis];
            // Preserve untouched declarations. In particular, an old fitted
            // height is neither the next local rule start nor a new height cap.
            sizes.set(descendant, { ...sizes.get(descendant), [axis]: value });
            if (value !== beforeSize[axis])
              canvases.set(descendant, {
                ...canvases.get(descendant),
                [axis]: value,
              });
          }
        } else {
          if (algorithm(node) === "lin" && intrinsicComposites.has(child)) {
            if (mainOverflow) ancestorMainOverflow.add(child);
            else ancestorMainOverflow.delete(child);
            if (axis) ancestorLinearAxes.set(child, axis);
            ancestorLinearScales.set(child, {
              ...(rect.w !== before.w && before.w
                ? { w: rect.w / before.w }
                : {}),
              ...(rect.h !== before.h && before.h
                ? { h: rect.h / before.h }
                : {}),
            });
            const geometry = drawingGeometry(child);
            const range = ranges.get(child)!;
            for (let i = range.start + 1; i < range.end; i++) {
              const descendant = nodes[i]!;
              retainedDescendantDrawing.set(descendant, {
                ...geometry.drawingSizes.get(descendant)!,
              });
              retainedDescendantSizes.set(descendant, {
                ...pass.allocation.get(descendant)!.size,
              });
              if (
                compositePrepared.has(descendant) ||
                (algorithm(descendant) === "composite" &&
                  ownCanvasAxes(descendant).length > 0 &&
                  !childrenFit(descendant))
              )
                retainedCompositeChildren.set(descendant, {
                  ...geometry.drawingSizes.get(descendant)!,
                });
              compositeResized.delete(descendant);
              enteredCompositeChildren.delete(descendant);
              frozen.delete(descendant);
              completedSubtrees.delete(descendant);
            }
          }
          // Rebuilding expressions also ends any earlier local drawing scope.
          for (const descendant of sizes.keys())
            if (descendant !== child && contains(child, descendant)) {
              if (algorithm(node) === "lin" && intrinsicComposites.has(child)) {
                for (const values of [sizes, canvases, drawingCross]) {
                  const dimensions = { ...values.get(descendant) };
                  for (const key of ["w", "h"] as const)
                    if (
                      rect[key] !== before[key] &&
                      !(
                        retry &&
                        key === "w" &&
                        retainsLocalWidth(descendant)
                      ) &&
                      !(
                        algorithm(descendant) === "sp" &&
                        !fallback &&
                        childrenFit(child)
                      )
                    )
                      delete dimensions[key];
                  values.set(descendant, dimensions);
                }
              } else {
                sizes.delete(descendant);
                canvases.delete(descendant);
                drawingCross.delete(descendant);
              }
            }
        }
        if (algorithm(node) === "lin" && intrinsicComposites.has(child)) {
          for (const descendant of nodes.slice(
            ranges.get(child)!.start + 1,
            ranges.get(child)!.end,
          )) {
            if (!preparedCrossClipped.has(descendant)) continue;
            const descendantAxis = mainAxis(arrangements.get(descendant)!);
            if (!descendantAxis) continue;
            const cross = descendantAxis === "w" ? "h" : "w";
            const retained = retainedDescendantSizes.get(descendant);
            if (retained)
              sizes.set(descendant, {
                ...sizes.get(descendant),
                [cross]: retained[cross],
              });
          }
        }
        canvases.set(child, {
          ...canvases.get(child),
          ...(rect.w !== allocationBefore.w ? { w: rect.w } : {}),
          ...(rect.h !== allocationBefore.h ? { h: rect.h } : {}),
        });
        const allocated = pass.allocation.get(child)!.size;
        const canvas = completed?.canvasSizes.get(child) ?? before;
        if (axis && intrinsicComposites.has(child)) {
          if (retry) retainedCompositeCanvases.delete(child);
          else {
            const retained: { w?: number; h?: number } = {};
            for (const key of ["w", "h"] as const)
              if (
                rect[key] === allocationBefore[key] &&
                allocated[key] > current.size[key]
              )
                retained[key] = allocated[key];
            retainedCompositeCanvases.set(child, retained);
          }
        }
        // Materializing a previously zero axis includes even zero-size child
        // positions. These may acquire dimensions when references are replayed.
        // Prepared LIN children receive the containing canvas on untouched
        // axes too; other algorithms retain their existing allocation scope.
        sizes.set(child, {
          w:
            rect.w !== allocationBefore.w
              ? rect.w
              : prepared.has(child) || intrinsicComposites.has(child)
                ? Math.min(allocated.w || canvas.w, current.size.w)
                : allocated.w || Math.min(canvas.w, current.size.w),
          h:
            rect.h !== allocationBefore.h
              ? rect.h
              : prepared.has(child) || intrinsicComposites.has(child)
                ? Math.min(allocated.h || canvas.h, current.size.h)
                : allocated.h || Math.min(canvas.h, current.size.h),
        });
        resized.push(child);
      }
    }
    if (arrangement.type === "composite" && resized.length) {
      const retainsProjectedReferences = externalGeometry.some(
        ({ constraint }) =>
          fittedReferences
            .get(node)
            ?.some(
              (change) =>
                diagramConstraintPropertyKey(change.property) ===
                diagramConstraintPropertyKey(constraint.target),
            ),
      );
      for (const [index, child] of node.children.entries()) {
        const dimensions = { ...sizes.get(child) };
        for (const axis of ["w", "h"] as const)
          if (arranged[index]![axis] === rectangles[index]![axis]) {
            // Geometry-only ancestor retries replay completed space dimensions.
            // A content retry still reopens their constraint expressions.
            if (
              retainsProjectedReferences &&
              referenceFrozen.has(node) &&
              !retryingAncestor &&
              algorithm(child) === "sp"
            )
              dimensions[axis] = arranged[index]![axis];
            else delete dimensions[axis];
          }
        sizes.set(child, dimensions);
      }
    }
    if (algorithm(node) === "composite")
      for (const child of node.children)
        retainedCompositeChildren.delete(child);
    if (preparing && resized.length && arrangement.type === "lin")
      preparedResized.add(node);
    if (resized.length || publishedVirtual) {
      const retainedHeights = new Set<DiagramLayoutNode>();
      if (arrangement.type === "composite")
        for (const [index, child] of node.children.entries())
          if (
            algorithm(child) === "tx" &&
            arranged[index]!.w !== rectangles[index]!.w &&
            arranged[index]!.h === rectangles[index]!.h
          )
            retainedHeights.add(child);
      if (retry && arrangement.type === "lin")
        for (const [index, child] of node.children.entries()) {
          if (
            !linearHeightPreference(child) ||
            arranged[index]!.w === rectangles[index]!.w ||
            arranged[index]!.h !== rectangles[index]!.h
          )
            continue;
          for (const leaf of child.children) {
            consume();
            if (independentAutomaticHeight(leaf, initial.get(leaf)!))
              retainedHeights.add(leaf);
          }
        }
      pass = fit(pass, resized, retry, retainedHeights);
    } else if (!fallback && !resetSpaces) geometricPasses.set(node, pass);
    return resized.length > 0;
  };
  const hasOnlyRetainedGeometryFailures = (scope: DiagramLayoutNode) => {
    const range = ranges.get(scope)!;
    for (let i = range.start + 1; i < range.end; i++) {
      const node = nodes[i]!;
      if (
        algorithm(node) === "tx" &&
        !pass.fits.get(node) &&
        !pass.retainedGeometryHeights.has(node)
      )
        return false;
    }
    return true;
  };
  const heightPreferenceCompleted = (node: DiagramLayoutNode): boolean => {
    consume();
    if (!linearHeightPreference(node)) return false;
    for (const child of node.children) {
      consume();
      if (
        algorithm(child) === "tx" &&
        !pass.fits.get(child) &&
        !independentAutomaticHeight(child, initial.get(child)!)
      )
        return false;
    }
    // Parent retry demand and physical text feasibility have different
    // lifetimes. A monotonic preference stops demanding a parent retry once
    // its drawing reaches that preference; projected text can still overflow.
    // The final content-fit result continues to report that overflow.
    return (
      drawingGeometry(node).drawingSizes.get(node)!.h >=
      initial.get(node)!.size.h
    );
  };
  const ancestorTextCompleted = (node: DiagramLayoutNode) => {
    if (node !== root || !directTextRules || !completedAncestorTextRules)
      return false;
    return root.children.every((child) => {
      consume();
      return customized.has(child) || pass.fits.get(child);
    });
  };
  const layoutSubtree = (scope: DiagramLayoutNode) => {
    // Iterative traversal avoids consuming the JS call stack for nested layouts.
    const tasks: {
      node: DiagramLayoutNode;
      exit: boolean;
      fallback?: boolean;
      ancestorGeometry?: boolean;
      retryingAncestor: boolean;
    }[] = [{ node: scope, exit: false, retryingAncestor: false }];
    while (tasks.length) {
      const task = tasks.pop()!,
        node = task.node;
      consume();
      if (!node.children.length) continue;
      if (!task.exit && completedSubtrees.get(node) === pass) continue;
      if (
        !task.exit &&
        compositePrepared.has(node) &&
        !enteredCompositeChildren.has(node)
      ) {
        enteredCompositeChildren.add(node);
        if (!compositeResized.has(node)) {
          if (ownsCompositeRetry(node)) {
            if (!childrenFit(node)) entryContentFailed.add(node);
            const range = ranges.get(node)!;
            const reset: DiagramLayoutNode[] = [node];
            const axis = mainAxis(arrangements.get(node)!);
            const cross = axis === "w" ? "h" : "w";
            if (
              cross === "h" &&
              ownCanvasAxes(node).includes("h") &&
              !reopenedHeightScopes.has(node)
            ) {
              // The child has exhausted its own canvas and now retries in the
              // parent's height domain. Discard temporary clipped references
              // before publishing the completed retry in that larger domain.
              reopenedHeightScopes.add(node);
              for (const group of virtualHeightGroups)
                for (const scope of group.scopes) {
                  if (
                    scope.property.selector.relationship !== "self" ||
                    !scope.property.type.startsWith("user") ||
                    !group.members.some((member) => contains(node, member)) ||
                    !projectionMember(scope.scope, group)
                  )
                    continue;
                  const key = diagramConstraintPropertyKey(scope.property);
                  const keys =
                    virtualProjectionKeys.get(scope.scope) ?? new Set<string>();
                  keys.add(key);
                  virtualProjectionKeys.set(scope.scope, keys);
                  virtualReferences.get(scope.scope)?.delete(key);
                }
            }
            const parentCanvas = pass.allocation.get(node.parent!)!.size;
            const currentCanvas = pass.allocation.get(node)!.size;
            sizes.set(node, {
              ...sizes.get(node),
              [cross]: Math.max(currentCanvas[cross], parentCanvas[cross]),
            });
            for (let i = range.start + 1; i < range.end; i++) {
              const child = nodes[i]!;
              const dimensions = { ...sizes.get(child) };
              delete dimensions[cross];
              sizes.set(child, dimensions);
              const cap = { ...canvases.get(child) };
              delete cap[cross];
              canvases.set(child, cap);
              drawingCross.delete(child);
              reset.push(child);
            }
            pass = fit(pass, reset);
          } else {
            const range = ranges.get(node)!;
            const reset: DiagramLayoutNode[] = [];
            for (let i = range.start + 1; i < range.end; i++) {
              const child = nodes[i]!;
              if (sizes.delete(child)) reset.push(child);
              canvases.delete(child);
              drawingCross.delete(child);
            }
            if (reset.length) pass = fit(pass, reset);
          }
        }
      }
      if (!task.exit && task.ancestorGeometry)
        replayCompositeDrawing(node, true);
      if (task.exit) {
        const demandsContentRetry =
          algorithm(node) === "lin"
            ? !ancestorTextCompleted(node) &&
              node.children.some(
                (child) =>
                  !childrenFit(child) && !heightPreferenceCompleted(child),
              )
            : !childrenFit(node);
        const retryContent =
          !prepared.has(node) &&
          // An ancestor's geometric retry may reuse already completed heights.
          // Preserve the resulting overflow report without beginning another
          // content search for those unchanged fitting domains.
          !(
            task.retryingAncestor &&
            intrinsicComposites.has(node) &&
            hasOnlyRetainedGeometryFailures(node)
          ) &&
          !(
            task.retryingAncestor &&
            node.parent &&
            projectedMainParents.has(node.parent)
          ) &&
          (!task.fallback || projectedCrossRetry.has(node)) &&
          (demandsContentRetry ||
            (projectedCrossRetry.has(node) &&
              !!node.parent &&
              !childrenFit(node.parent))) &&
          !(
            algorithm(node) === "lin" &&
            node.parent &&
            algorithm(node.parent) === "composite" &&
            !ownsCompositeRetry(node)
          );
        // A composite's completed geometry can overflow despite a fitting (even
        // zero) initial allocation. Geometric retry does not force another failed
        // text attempt when a font-only domain has already exhausted its search.
        if (
          (retryContent ||
            (prepared.has(node) && !task.retryingAncestor) ||
            (compositePrepared.has(node) &&
              (heightRules.has(node) || ownsCompositeRetry(node)) &&
              !task.retryingAncestor) ||
            (algorithm(node) === "composite" &&
              heightRules.has(node) &&
              !task.fallback &&
              !task.retryingAncestor &&
              !task.ancestorGeometry &&
              node.children.some(
                (child) =>
                  compositePrepared.has(child) ||
                  (algorithm(child) === "composite" &&
                    ownCanvasAxes(child).length > 0),
              )) ||
            (algorithm(node) === "lin" &&
              node.children.some(
                (child) =>
                  algorithm(child) === "composite" &&
                  (!intrinsicComposites.has(child) || heightRules.has(child)),
              ))) &&
          (arrange(node, retryContent, true, task.retryingAncestor) ||
            (retryContent &&
              node.children.some(
                (child) =>
                  ownsCompositeRetry(child) &&
                  (!referenceFrozen.has(node) ||
                    !reopenedHeightScopes.has(child)),
              )))
        )
          tasks.push(
            ...[...node.children].reverse().map((node) => ({
              node,
              exit: false,
              ancestorGeometry: intrinsicComposites.has(node),
              retryingAncestor:
                task.retryingAncestor ||
                projectedMainParents.has(task.node) ||
                ((retryContent || algorithm(task.node) === "composite") &&
                  !ownsCompositeRetry(node)),
            })),
          );
        if (algorithm(node) === "composite" && !childrenFit(node)) {
          replayCompositeDrawing(node);
          // Retain completed, non-adjustable extents after child execution,
          // not before projection publishes new reference expressions.
          const range = ranges.get(node)!;
          for (let i = range.start + 1; i < range.end; i++) {
            const child = nodes[i]!;
            const limits = { ...canvases.get(child) };
            for (const axis of ["w", "h"] as const) {
              if (
                rulesFor.get(child)?.some((rule) => rule.target.type === axis)
              )
                continue;
              limits[axis] = Math.min(
                limits[axis] ?? Infinity,
                pass.allocation.get(child)!.size[axis],
              );
            }
            canvases.set(child, limits);
          }
        }
        continue;
      }
      // Known content failure participates in the initial arrangement search,
      // even when geometry alone fits. Height-ruled descendants can retry at
      // those dimensions even when a different, unruled sibling failed. Continued
      // failure requires the exit search. Font-only fitting does not add a second
      // geometry search after its exhaustion.
      const preparedContentFailed = entryContentFailed.delete(node);
      const contentFailed =
        (!childrenFit(node) && !ancestorTextCompleted(node)) ||
        preparedContentFailed ||
        (projectedCrossRetry.has(node) &&
          !!node.parent &&
          !childrenFit(node.parent));
      let fallback = contentFailed && !heightRules.has(node);
      const changed = arrange(
        node,
        contentFailed &&
          !prepared.has(node) &&
          !(
            algorithm(node) === "lin" &&
            node.parent &&
            algorithm(node.parent) === "composite" &&
            !ownsCompositeRetry(node) &&
            !(task.retryingAncestor && fittedLinearMain.has(node))
          ),
        false,
        task.retryingAncestor,
      );
      if (changed && !heightRules.has(node)) fallback = true;
      tasks.push(
        {
          node,
          exit: true,
          fallback,
          ancestorGeometry: !!task.ancestorGeometry,
          retryingAncestor: task.retryingAncestor,
        },
        ...[...node.children].reverse().map((node) => ({
          node,
          exit: false,
          retryingAncestor: task.retryingAncestor,
        })),
      );
    }
  };
  // Resolve child preferences bottom-up before the containing LIN searches.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    if (
      node.parent &&
      algorithm(node.parent) === "lin" &&
      algorithm(node) === "composite" &&
      (node.children.some(
        (child) =>
          compositePrepared.has(child) ||
          (algorithm(child) === "composite" && ownCanvasAxes(child).length > 0),
      ) ||
        (text.some((child) => contains(node, child)) &&
          (() => {
            const axis = mainAxis(arrangements.get(node.parent!)!);
            return (
              axis !== null &&
              initial.get(node)!.size[axis] -
                initial.get(node.parent!)!.size[axis] >=
                1e-9
            );
          })()))
    ) {
      layoutSubtree(node);
      intrinsicComposites.add(node);
      completedSubtrees.set(node, pass);
    }
    if (
      !node.parent ||
      !["lin", "composite"].includes(algorithm(node.parent) ?? "") ||
      algorithm(node) !== "lin"
    )
      continue;
    arrange(node, false, false, false, true);
    if (algorithm(node.parent!) === "lin") prepared.add(node);
    else compositePrepared.add(node);
  }
  layoutSubtree(root);
  const { drawingSizes, drawingPositions, drawingOrigins } = drawingGeometry();
  const bounds = new Map<DiagramLayoutNode, DiagramLayoutRect>();
  for (const node of nodes) {
    const state = pass.drawing.get(node)!,
      parent = node.parent && bounds.get(node.parent),
      placed = placements.get(node);
    // Composite positions remain live during the drawing pass; arrangement
    // contributes only the offset from its allocated coordinate system.
    // A root LIN backtrack is anchored inside the diagram frame. Its child
    // positions already subtract the union origin; do not reapply a negative
    // root origin and move the fitted drawing outside that frame. Positive
    // alignment offsets and descendant container origins remain live.
    const origin = drawingOrigins.get(node);
    const rootLinear = node === root && algorithm(node) === "lin";
    const x =
      drawingPositions.get(node)?.x ??
      (placed?.x ?? 0) +
        (state.coordinates?.l ?? 0) +
        (rootLinear ? Math.max(0, origin?.x ?? 0) : (origin?.x ?? 0));
    const y =
      drawingPositions.get(node)?.y ??
      (placed?.y ?? 0) +
        (state.coordinates?.t ?? 0) +
        (rootLinear ? Math.max(0, origin?.y ?? 0) : (origin?.y ?? 0));
    bounds.set(node, {
      x: (parent?.x ?? 0) + x,
      y: (parent?.y ?? 0) + y,
      ...drawingSizes.get(node)!,
    });
  }
  return {
    bounds,
    allocation: pass.allocation,
    drawing: pass.drawing,
    algorithms: pass.algorithms,
    fits: [...pass.fits.values()].every(Boolean),
  };
};
