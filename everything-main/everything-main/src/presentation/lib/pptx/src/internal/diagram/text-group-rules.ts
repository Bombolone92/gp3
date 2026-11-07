import type { DiagramConstraintRule } from "./constraint.ts";
import type { DiagramConstraintRulePlan } from "./initial-constraints.ts";
import type {
  DiagramTextRuleEvaluation,
  DiagramTextRuleValues,
} from "./text-rules.ts";
import {
  fitDiagramTextFontRule,
  fitDiagramTextHeightRule,
  fitDiagramTextHeightGroup,
} from "./rule-fit.ts";

export interface DiagramTextGroupRuleResult<
  T extends DiagramTextRuleEvaluation,
> {
  readonly values: readonly DiagramTextRuleValues[];
  readonly evaluations: readonly T[];
  /** Reserved shared height, distinct from the replayed drawing heights. */
  readonly allocationHeight: number | undefined;
  /** Independent space reserved by failed height prefixes before font fitting. */
  readonly allocationHeights: readonly (number | undefined)[];
  readonly fits: boolean;
}

const commonPlan = (
  plans: readonly (DiagramConstraintRulePlan | null)[],
): DiagramConstraintRulePlan | null => {
  const first = plans[0] ?? null;
  if (plans.every((p) => p === null)) return null;
  if (
    !first ||
    plans.some(
      (p) =>
        !p ||
        p.current !== first.current ||
        p.limit !== first.limit ||
        p.mode !== first.mode ||
        (p.mode === "factor" && p.rule.factor !== first.rule.factor),
    )
  )
    throw new Error("unequal shared diagram text rule plans");
  return first;
};

/**
 * Execute a common ordered rule sequence for an equal-font TX domain. A font
 * trial replays earlier height rules from local initial heights. Independent
 * height domains lower a shared font in member order; a shared height domain
 * instead fits every member together. When height is also shared, allocation survives this replay;
 * drawing heights are fitted afresh against that final allocation in layout
 * order. Searching all members as one height predicate loses that ordering.
 *
 * The caller discovers equality domains, verifies that each adjusted font is
 * shared by exactly these members, resolves scoped plans, and handles parent
 * arrangement. Proportional domains and differing member sequences are not
 * represented by this API. Every evaluator must be pure and bounded by its
 * caller's operation budget.
 */
export const fitDiagramTextGroupRules = <T extends DiagramTextRuleEvaluation>(
  rules: readonly DiagramConstraintRule[],
  members: readonly ((values: DiagramTextRuleValues) => T)[],
  options: {
    readonly sharedHeight: boolean;
    readonly retainedHeight?: number;
  },
): DiagramTextGroupRuleResult<T> => {
  if (!members.length) throw new Error("empty diagram text rule domain");
  for (const { target } of rules)
    if (
      !["h", "primFontSz", "secFontSz"].includes(target.type) ||
      target.selector.relationship !== "self" ||
      target.selector.name ||
      target.selector.pointType !== "all"
    )
      throw new Error("unsupported shared diagram text rule");
  const evaluated = (
    values: readonly DiagramTextRuleValues[],
    allocationHeight?: number,
    allocationHeights: readonly (number | undefined)[] = members.map(
      () => undefined,
    ),
  ): DiagramTextGroupRuleResult<T> => {
    const evaluations = members.map((member, i) => member(values[i]!));
    return {
      values,
      evaluations,
      allocationHeight,
      allocationHeights,
      fits: evaluations.every((e) => e.fits),
    };
  };
  const height = (
    initial: DiagramTextGroupRuleResult<T>,
    rule: DiagramConstraintRule,
    retainedHeight?: number,
    changedFont = false,
  ): DiagramTextGroupRuleResult<T> => {
    const plans = initial.evaluations.map((e) => e.rulePlan(rule));
    if (options.sharedHeight) {
      const plan = commonPlan(plans);
      if (!plan) return initial;
      // A font change starts a new height-rule replay. Retained space must
      // respect that replay's limit; unchanged-font parent reflow can keep its
      // earlier allocation separately from the smaller drawing preference.
      const result = fitDiagramTextHeightGroup(
        plan,
        members.map((member, i) => (h) => {
          const result = member({ ...initial.values[i], h });
          return result.heightFits ?? result.fits;
        }),
        changedFont && retainedHeight !== undefined
          ? Math.min(retainedHeight, plan.limit)
          : retainedHeight,
      );
      const projected = evaluated(
        initial.values.map((v) => ({ ...v, h: result.drawing.value })),
        result.allocation.value,
      );
      return { ...projected, fits: projected.fits && result.fits };
    }
    return evaluated(
      initial.values.map((values, i) => {
        const plan = plans[i];
        if (!plan || initial.evaluations[i]!.fits) return values;
        const fitted = fitDiagramTextHeightRule(plan, (h) => {
          const result = members[i]!({ ...values, h });
          return result.heightFits ?? result.fits;
        });
        return { ...values, h: fitted.value };
      }),
      initial.allocationHeight,
      initial.allocationHeights.map((h, i) =>
        h === undefined || !plans[i] ? h : Math.min(h, plans[i]!.limit),
      ),
    );
  };
  const heights: DiagramConstraintRule[] = [];
  let fonts: DiagramTextRuleValues = {};
  let result = evaluated(
    members.map(() => fonts),
    options.retainedHeight,
  );
  // A shared height prefix also establishes the containing scope's reserved
  // height when the initial text already fits. Keep that allocation available
  // to a later parent reflow; only the drawing preference starts afresh.
  let start = 0;
  if (options.sharedHeight && rules[0]?.target.type === "h") {
    heights.push(rules[0]);
    result = height(result, rules[0], options.retainedHeight);
    start = 1;
  }
  for (const rule of rules.slice(start)) {
    if (result.fits) break;
    const type = rule.target.type;
    if (type === "h") {
      heights.push(rule);
      result = height(result, rule, result.allocationHeight);
      continue;
    }
    if (!options.sharedHeight && heights.length) {
      // Independent height domains fit their common font in layout order.
      // A later member can lower the font again: earlier members then restart
      // their height preference at that font rather than retaining the space
      // exhausted before another member's font reduction.
      for (let member = 0; member < members.length; ++member) {
        if (result.evaluations[member]!.fits) continue;
        const plan = commonPlan(
          result.evaluations.map((e) => e.rulePlan(rule)),
        );
        if (!plan) continue;
        const initial = result;
        let accepted = initial,
          rejected = initial;
        const fitted = fitDiagramTextFontRule(plan, (value) => {
          let trial = initial;
          if (value !== plan.current) {
            const next = { ...fonts, [type]: value };
            trial = evaluated(
              members.map(() => next),
              undefined,
              members.map((_, i) =>
                i === member
                  ? (initial.values[i]!.h ?? initial.allocationHeights[i])
                  : undefined,
              ),
            );
            for (const previous of heights) {
              if (trial.fits) break;
              trial = height(trial, previous);
            }
          }
          if (trial.evaluations[member]!.fits) accepted = trial;
          else rejected = trial;
          return trial.evaluations[member]!.fits;
        });
        result =
          fitted.value === plan.current
            ? initial
            : fitted.fits
              ? accepted
              : rejected;
        const { h: _height, ...retained } = result.values[0]!;
        fonts = retained;
      }
      continue;
    }
    const plan = commonPlan(result.evaluations.map((e) => e.rulePlan(rule)));
    if (!plan) continue;
    const initial = result;
    let accepted = initial,
      rejected = initial;
    const fitted = fitDiagramTextFontRule(plan, (value) => {
      let trial = initial;
      if (value !== plan.current) {
        const next = { ...fonts, [type]: value };
        trial = evaluated(
          members.map(() => next),
          initial.allocationHeight,
        );
        for (const [index, previous] of heights.entries()) {
          if (trial.fits && !(options.sharedHeight && index === 0)) break;
          trial = height(trial, previous, initial.allocationHeight, true);
        }
      }
      if (trial.fits) accepted = trial;
      else rejected = trial;
      return trial.fits;
    });
    result =
      fitted.value === plan.current
        ? initial
        : fitted.fits
          ? accepted
          : rejected;
    const { h: _height, ...retained } = result.values[0]!;
    fonts = retained;
  }
  return result;
};
