import type { DiagramConstraintRulePlan } from "./initial-constraints.ts";

export interface DiagramRuleFit {
  readonly value: number;
  readonly fits: boolean;
}

/**
 * Fit one rule using the general-variable search. The caller chooses the
 * permitted adjustment direction and evaluates each trial with the full layout
 * and content constraints. The predicate must be monotone toward the limit.
 *
 * Native controls with independent bounds, reference factors, both layout axes
 * and unused cross-property consumers establish five midpoint refinements.
 * This is distinct from the specialized linear width/height fitting paths and
 * from final arrangement scaling. Callers must select the proper fitting path;
 * this function does not infer it from a constraint's property name.
 *
 * All numeric modes search toward their limit on this path. Maximum rules are
 * inactive when fitting requires growth, even if their limit is below current.
 * A failed limit is retained for subsequent rules or parent fallback. Unbounded
 * intervals require a finite, layout-derived endpoint before invoking search.
 * No font rounding, EMU quantization, XML mutation or geometry scaling occurs.
 */
export const fitDiagramGeneralRule = (
  plan: DiagramConstraintRulePlan,
  direction: "increase" | "decrease",
  fits: (trial: number) => boolean,
): DiagramRuleFit => fitRule(plan, direction, fits, false);

/**
 * Fit a numeric rule in a LIN geometry pass. A main-axis dimension without a
 * direct cross-property consumer has an algorithm-specific path. Width uses
 * ten significant binary digits of the feasible fraction of its rule interval;
 * a maximum applies its endpoint directly. Zero factors remain active here.
 * Main-axis height is content-driven and is not adjusted by geometry alone.
 * Cross-axis dimensions and variables consumed by another property use the
 * general search toward zero, including its distinct maximum/factor semantics.
 *
 * This selects paths from evaluated dependencies, not XML spelling or a layout
 * identity. Each probe must rebuild the complete current constraint scope.
 * Descendant text fitting and container retry lifetime belong to reflow.
 */
export const fitDiagramLinearGeometryRule = (
  plan: DiagramConstraintRulePlan,
  main: "w" | "h",
  fits: (trial: number) => boolean,
): DiagramRuleFit => {
  if (plan.rule.target.type !== main || plan.hasCrossPropertyDependents)
    return fitDiagramGeneralRule(
      plan,
      plan.current < 0 ? "increase" : "decrease",
      fits,
    );
  const current = plan.current;
  if (!Number.isFinite(current) || Number.isNaN(plan.limit))
    throw new Error("invalid diagram rule fit interval");
  const currentFits = fits(current);
  if (currentFits || main === "h") return { value: current, fits: currentFits };
  const endpoint = Math.min(current, plan.limit);
  if (endpoint === current) return { value: current, fits: false };
  if (!Number.isFinite(endpoint))
    throw new Error("unbounded diagram rule fit interval");
  const endpointFits = fits(endpoint);
  if (!endpointFits || plan.mode === "maximum")
    return { value: endpoint, fits: endpointFits };
  let lower = 0,
    upper = 1,
    significantBits = 0;
  const value = (fraction: number) => {
    const interval = current - endpoint;
    return Number.isFinite(interval)
      ? endpoint + interval * fraction
      : endpoint * (1 - fraction) + current * fraction;
  };
  while (significantBits < 10) {
    const midpoint = (lower + upper) / 2;
    if (midpoint === lower || midpoint === upper) break;
    if (fits(value(midpoint))) lower = midpoint;
    else upper = midpoint;
    if (lower > 0) significantBits++;
  }
  return { value: value(lower), fits: true };
};

/**
 * Grow a TX algorithm's height until its text fits. When the limit exceeds
 * 100 times the positive starting height, it first tries up to 20 doubles,
 * then refines the last failed / first feasible interval five times. A trial
 * is measured before checking the limit, so a successful doubling may cross
 * a finite rule endpoint. Smaller intervals use the general-variable search.
 * Every probe must reevaluate dependent constraints and text wrapping: width
 * may itself depend on height. After 20 failed doubles, finite rules restart
 * the general search; an unbounded rule resets the text height to zero.
 * As on that path, the predicate must be monotone toward the resolved limit.
 *
 * This does not resolve automatic initial heights, measure text, apply parent
 * fallback or select the fitting path for other algorithms and properties.
 */
export const fitDiagramTextHeightRule = (
  plan: DiagramConstraintRulePlan,
  fits: (trial: number) => boolean,
): DiagramRuleFit => fitRule(plan, "increase", fits, true);

/**
 * Shrink a TX font rule to the largest feasible whole-point size. Unlike the
 * general-variable path, font fitting searches the integer interval completely;
 * five continuous refinements can unnecessarily shrink a large starting font.
 * Native controls establish nearest-point rounding of the resolved rule limit,
 * including upward half-point ties. An exhausted limit is retained on failure.
 *
 * The caller supplies an already quantized current constraint, resolves the
 * rule from its original reference base, and reevaluates text AND dependent
 * margins/geometry for each trial. Initial simultaneous font quantization,
 * equality propagation, displayed run minimums and parent fallback belong to
 * their respective phases. In particular, a zero constraint is a valid trial
 * even when the text renderer displays at least one-point text.
 * The predicate must be monotone toward the limit and free of retained effects.
 */
export const fitDiagramTextFontRule = (
  plan: DiagramConstraintRulePlan,
  fits: (trial: number) => boolean,
): DiagramRuleFit => {
  const current = plan.current;
  const limit = Math.round(plan.limit);
  if (
    !Number.isSafeInteger(current) ||
    current < 0 ||
    !Number.isSafeInteger(limit) ||
    plan.limit < 0
  )
    throw new Error("invalid diagram font fit interval");
  if (fits(current)) return { value: current, fits: true };
  if (plan.mode === "factor" && Math.abs(plan.rule.factor) < 1e-9)
    return { value: current, fits: false };
  const endpoint = Math.min(current, limit);
  if (endpoint === current) return { value: current, fits: false };
  if (!fits(endpoint)) return { value: endpoint, fits: false };
  let accepted = endpoint;
  let rejected = current;
  while (rejected - accepted > 1) {
    const midpoint = accepted + Math.floor((rejected - accepted) / 2);
    if (fits(midpoint)) accepted = midpoint;
    else rejected = midpoint;
  }
  return { value: accepted, fits: true };
};

export interface DiagramTextHeightLayout {
  /** Preferred height from the node's own rule in the current layout pass. */
  readonly preferred: DiagramRuleFit;
  /** Height reserved by the containing layout, including retained equality. */
  readonly allocation: DiagramRuleFit;
  /** The preferred drawing extent cannot exceed its allocation. */
  readonly extent: number;
  readonly fits: boolean;
}

/**
 * Resolve TX height when parent reflow retains an outer equality allocation.
 * Local preferred height is fitted afresh. The outer allocation is fitted from
 * its previous value: keep it when it still fits, or grow it when new wrapping
 * requires more space. Drawing extent and reserved height remain distinct;
 * dependent automatic geometry uses the allocation, while live coordinates
 * can reflect the smaller drawing extent.
 *
 * Native nested-layout controls distinguish these values by changing frame
 * width, text, font size, initial height, and the equality's declaring scope.
 * The caller supplies retainedAllocation only for a domain outside the scope
 * being rebuilt. This function does not choose scope lifetime or commit trials.
 * The predicate must independently evaluate each trial without retaining its
 * side effects; both searches use the same current content and constraints.
 */
export const fitDiagramTextHeightLayout = (
  plan: DiagramConstraintRulePlan,
  fits: (trial: number) => boolean,
  retainedAllocation?: number,
): DiagramTextHeightLayout => {
  if (retainedAllocation !== undefined && !Number.isFinite(retainedAllocation))
    throw new Error("invalid retained diagram text height");
  const preferred = fitDiagramTextHeightRule(plan, fits);
  const allocation =
    retainedAllocation === undefined || retainedAllocation === plan.current
      ? preferred
      : fitDiagramTextHeightRule(
          { ...plan, current: retainedAllocation },
          fits,
        );
  return {
    preferred,
    allocation,
    extent: Math.min(preferred.value, allocation.value),
    fits: preferred.fits && allocation.fits,
  };
};

export interface DiagramTextHeightGroupFit {
  /** Shared reserved height after fitting the members in layout order. */
  readonly allocation: DiagramRuleFit;
  /** Shared drawing height after replaying against the final allocation. */
  readonly drawing: DiagramRuleFit;
  readonly fits: boolean;
}

/**
 * Fit a domain of equal TX heights with one resolved height rule and bound.
 * Each predicate measures a member in layout order, in the domain's units.
 * Allocation grows across the members first. Drawing then starts from the
 * first member's local preference and fits the members again, bounded by both
 * the current rule and the FINAL allocation. Interleaving these passes makes
 * later siblings retain an earlier allocation's search interval and changes
 * the result.
 *
 * The caller resolves membership, a common rule plan, equality scope lifetime
 * and current text/constraints. This does not discover or reconcile overlapping
 * or proportional domains, perform parent fallback, or change source geometry.
 * Predicates must be independent, monotone and free of retained side effects.
 * Final feasibility checks include every member, even if an earlier search
 * failed and the last member already fits.
 */
export const fitDiagramTextHeightGroup = (
  plan: DiagramConstraintRulePlan,
  members: readonly ((trial: number) => boolean)[],
  retainedAllocation?: number,
): DiagramTextHeightGroupFit => {
  if (!members.length) throw new Error("empty diagram text height group");
  const first = fitDiagramTextHeightLayout(
    plan,
    members[0]!,
    retainedAllocation,
  );
  let allocation = first.allocation.value;
  for (let index = 1; index < members.length; ++index)
    allocation = fitDiagramTextHeightRule(
      { ...plan, current: allocation },
      members[index]!,
    ).value;
  let drawing = Math.min(first.preferred.value, allocation);
  for (let index = 1; index < members.length; ++index)
    drawing = fitDiagramTextHeightRule(
      {
        ...plan,
        current: drawing,
        // Parent reflow can tighten the local bound below a retained allocation.
        // Retention reserves space; it does not grant permission to grow past
        // the current rule's limit during the drawing pass.
        limit: Math.min(plan.limit, allocation),
      },
      members[index]!,
    ).value;
  const allocationFits = members.every((fits) => fits(allocation));
  const drawingFits = members.every((fits) => fits(drawing));
  return {
    allocation: { value: allocation, fits: allocationFits },
    drawing: { value: drawing, fits: drawingFits },
    fits: allocationFits && drawingFits,
  };
};

const fitRule = (
  plan: DiagramConstraintRulePlan,
  direction: "increase" | "decrease",
  fits: (trial: number) => boolean,
  expandTextHeight: boolean,
): DiagramRuleFit => {
  const current = plan.current;
  if (!Number.isFinite(current) || Number.isNaN(plan.limit))
    throw new Error("invalid diagram rule fit interval");
  if (fits(current)) return { value: current, fits: true };
  // The general-variable path treats |factor| < 1e-9 as inactive. Native
  // controls bracket the strict boundary with independently scaled references;
  // this tests the authored factor, not its product or a geometry tolerance.
  if (plan.mode === "factor" && Math.abs(plan.rule.factor) < 1e-9)
    return { value: current, fits: false };
  if (plan.mode === "maximum" && direction === "increase")
    return { value: current, fits: false };
  const endpoint =
    direction === "decrease"
      ? Math.min(current, plan.limit)
      : Math.max(current, plan.limit);
  if (endpoint === current) return { value: current, fits: false };
  let rejected = current,
    accepted = endpoint;
  if (expandTextHeight && endpoint === Infinity && current <= 0)
    throw new Error("unbounded text height fitting requires a positive height");
  if (expandTextHeight && current > 0 && endpoint / current > 100) {
    accepted = current;
    // Native controls distinguish the strict 100-fold boundary, the 20-probe
    // expansion budget, and testing feasibility before the strict endpoint
    // comparison. Neither EMU rounding nor an absolute small-height cutoff
    // selects this path.
    for (let expansion = 0; expansion < 20; ++expansion) {
      rejected = accepted;
      accepted = Math.min(accepted * 2, Number.MAX_VALUE);
      if (fits(accepted)) return refineRuleFit(rejected, accepted, fits);
      if (accepted > endpoint) return { value: endpoint, fits: false };
      if (accepted === rejected) break;
    }
    if (endpoint === Infinity) return { value: 0, fits: fits(0) };
    rejected = current;
    accepted = endpoint;
  }
  if (!Number.isFinite(endpoint))
    throw new Error("unbounded diagram rule fit interval");
  const endpointFits = fits(endpoint);
  if (!endpointFits) return { value: endpoint, fits: endpointFits };
  return refineRuleFit(rejected, accepted, fits);
};

const refineRuleFit = (
  rejected: number,
  accepted: number,
  fits: (trial: number) => boolean,
): DiagramRuleFit => {
  for (let refinement = 0; refinement < 5; ++refinement) {
    const difference = accepted - rejected;
    const midpoint = Number.isFinite(difference)
      ? rejected + difference / 2
      : rejected / 2 + accepted / 2;
    // Adjacent representable numbers and subnormal intervals cannot always be
    // bisected. Retain the known feasible endpoint when precision is exhausted.
    if (midpoint === rejected || midpoint === accepted) break;
    if (fits(midpoint)) accepted = midpoint;
    else rejected = midpoint;
  }
  return { value: accepted, fits: true };
};
