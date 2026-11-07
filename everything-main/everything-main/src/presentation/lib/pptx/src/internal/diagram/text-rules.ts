import type { DiagramConstraintRule } from "./constraint.ts";
import type { DiagramConstraintRulePlan } from "./initial-constraints.ts";
import {
  fitDiagramTextFontRule,
  fitDiagramTextHeightRule,
  type DiagramRuleFit,
} from "./rule-fit.ts";

export type DiagramTextRuleValues = Readonly<
  Partial<Record<"h" | "primFontSz" | "secFontSz", number>>
>;

export interface DiagramTextRuleEvaluation {
  readonly fits: boolean;
  /** Wrapped-line height, independently of unbreakable-word overflow. */
  readonly heightFits?: boolean;
  rulePlan(rule: DiagramConstraintRule): DiagramConstraintRulePlan | null;
}

export interface DiagramTextRuleResult<T extends DiagramTextRuleEvaluation> {
  /** Local numeric adjustments, separate from the authored expressions. */
  readonly values: DiagramTextRuleValues;
  readonly evaluation: T;
  /** Space reserved by an exhausted height prefix before font fitting. */
  readonly allocationHeight?: number;
}

// Both searches return the last feasible probe, or their exhausted endpoint.
// Keep only those states, not a constraint graph for every rejected probe.
const search = <T extends DiagramTextRuleEvaluation>(
  plan: DiagramConstraintRulePlan,
  initial: DiagramTextRuleResult<T>,
  fit: (
    plan: DiagramConstraintRulePlan,
    fits: (value: number) => boolean,
  ) => DiagramRuleFit,
  trial: (value: number) => DiagramTextRuleResult<T>,
  feasible: (evaluation: T) => boolean = (evaluation) => evaluation.fits,
): DiagramTextRuleResult<T> => {
  let accepted = initial,
    rejected = initial,
    acceptedValue = plan.current,
    rejectedValue = plan.current;
  const fitted = fit(plan, (value) => {
    const state = value === plan.current ? initial : trial(value);
    const fits = feasible(state.evaluation);
    if (fits) {
      accepted = state;
      acceptedValue = value;
    } else {
      rejected = state;
      rejectedValue = value;
    }
    return fits;
  });
  if (fitted.value === plan.current) return initial;
  if (fitted.fits && fitted.value === acceptedValue) return accepted;
  if (!fitted.fits && fitted.value === rejectedValue) return rejected;
  // A failed doubling beyond a finite endpoint returns that endpoint, which
  // need not have been measured. Project the returned value, not the probe.
  return trial(fitted.value);
};

/**
 * Run local TX height/font rules in authored order, stopping when text fits.
 * Font reductions persist. A changed font replays preceding height rules from
 * the local initial height, rather than retaining their exhausted endpoints.
 * Earlier font rules are NOT rerun when a later height rule grows the box.
 * Native controls distinguish these lifetimes, including repeated rules.
 *
 * evaluate must independently rebuild this scope from its initial expressions
 * plus the supplied numeric adjustments, resolve current rule plans, and check
 * text height AND word fit. It must not retain trial side effects. Feasibility
 * must be monotone toward each resolved search limit.
 *
 * The caller supplies quantized initial fonts, semantic text measurement, equality domain
 * handling, finite bounds when required, and parent arrangement/reflow. Outer
 * retained height allocations are distinct from this local drawing preference.
 * This stage only accepts unqualified self height/font rules; other properties
 * and selectors require their own fitting paths, not silent approximation.
 */
export const fitDiagramTextRules = <T extends DiagramTextRuleEvaluation>(
  rules: readonly DiagramConstraintRule[],
  evaluate: (values: DiagramTextRuleValues) => T,
): DiagramTextRuleResult<T> => {
  for (const { target } of rules)
    if (
      !["h", "primFontSz", "secFontSz"].includes(target.type) ||
      target.selector.relationship !== "self" ||
      target.selector.name !== "" ||
      target.selector.pointType !== "all"
    )
      throw new Error("unsupported local diagram text rule");

  const evaluated = (
    values: DiagramTextRuleValues,
    allocationHeight?: number,
  ): DiagramTextRuleResult<T> => ({
    values,
    evaluation: evaluate(values),
    ...(allocationHeight === undefined ? {} : { allocationHeight }),
  });
  const heights: DiagramConstraintRule[] = [];
  let fonts: DiagramTextRuleValues = {};
  let result = evaluated(fonts);

  const height = (
    rule: DiagramConstraintRule,
    initial: DiagramTextRuleResult<T>,
  ): DiagramTextRuleResult<T> => {
    const plan = initial.evaluation.rulePlan(rule);
    if (!plan) return initial;
    const allocationHeight =
      initial.allocationHeight === undefined
        ? undefined
        : Math.min(initial.allocationHeight, plan.limit);
    const reserved =
      allocationHeight === undefined
        ? initial
        : { ...initial, allocationHeight };
    return search(
      plan,
      reserved,
      fitDiagramTextHeightRule,
      (value) => evaluated({ ...initial.values, h: value }, allocationHeight),
      (evaluation) => evaluation.heightFits ?? evaluation.fits,
    );
  };
  const replayHeights = (
    values: DiagramTextRuleValues,
    allocationHeight?: number,
  ): DiagramTextRuleResult<T> => {
    let state = evaluated(values, allocationHeight);
    for (const rule of heights) {
      if (state.evaluation.fits) break;
      state = height(rule, state);
    }
    return state;
  };

  for (const rule of rules) {
    if (result.evaluation.fits) break;
    const type = rule.target.type;
    if (type === "h") {
      heights.push(rule);
      result = height(rule, result);
      continue;
    }
    const plan = result.evaluation.rulePlan(rule);
    if (!plan) continue;
    const allocationHeight = result.values.h ?? result.allocationHeight;
    result = search(plan, result, fitDiagramTextFontRule, (value) =>
      replayHeights({ ...fonts, [type]: value }, allocationHeight),
    );
    // Height is a local preference, not part of the retained font state.
    const { h: _height, ...retained } = result.values;
    fonts = retained;
  }
  return result;
};
