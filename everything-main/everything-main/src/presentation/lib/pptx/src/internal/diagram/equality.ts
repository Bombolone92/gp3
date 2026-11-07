/** One proportional equality between scoped declaration domains. */
export interface DiagramEqualityRelation<T> {
  readonly source: T;
  readonly target: T;
  readonly factor: number;
}
export interface DiagramEqualityValue {
  readonly value: number;
  /** Accumulated floating-point error from traversed multiply/divide steps. */
  readonly error: number;
}

export const compatibleDiagramEqualityValues = (
  a: DiagramEqualityValue,
  b: DiagramEqualityValue,
): boolean => {
  const difference = Math.abs(a.value - b.value),
    tolerance = a.error + b.error;
  if (Number.isFinite(difference) && Number.isFinite(tolerance))
    return difference <= tolerance;
  // Avoid Infinity <= Infinity when comparing finite values near the limit.
  return Math.abs(a.value / 2 - b.value / 2) <= a.error / 2 + b.error / 2;
};

/**
 * Propagate one trial through declaration equalities, not through shape slots.
 * Callers seed all domains selecting the initiating variable, then project the
 * results onto their members without seeding additional domains from those
 * projected values. Keeping those two steps separate preserves shadowed scopes.
 */
export const propagateDiagramEquality = <T>(
  relations: readonly DiagramEqualityRelation<T>[],
  seeds: readonly T[],
  value: number,
  consume: () => void,
): ReadonlyMap<T, DiagramEqualityValue> => {
  if (!Number.isFinite(value))
    throw new Error("non-finite diagram equality trial");
  const edges = new Map<T, { target: T; factor: number; divide: boolean }[]>();
  const edge = (source: T, target: T, factor: number, divide: boolean) => {
    const list = edges.get(source) ?? [];
    list.push({ target, factor, divide });
    edges.set(source, list);
  };
  for (const relation of relations) {
    consume();
    if (!Number.isFinite(relation.factor) || relation.factor === 0)
      throw new Error("invalid diagram equality factor");
    edge(relation.source, relation.target, relation.factor, false);
    // Do not precompute 1/factor: a tiny but valid factor can have an infinite
    // reciprocal even when dividing the actual trial gives a finite result.
    edge(relation.target, relation.source, relation.factor, true);
  }
  const values = new Map<T, DiagramEqualityValue>();
  const pending: T[] = [];
  const put = (domain: T, next: DiagramEqualityValue) => {
    consume();
    if (!Number.isFinite(next.value) || !Number.isFinite(next.error))
      throw new Error("non-finite diagram equality value");
    const previous = values.get(domain);
    if (previous) {
      if (!compatibleDiagramEqualityValues(previous, next))
        throw new Error("inconsistent diagram equality trial");
    } else {
      values.set(domain, next);
      pending.push(domain);
    }
  };
  for (const seed of seeds) put(seed, { value, error: 0 });
  for (let index = 0; index < pending.length; ++index) {
    consume();
    const domain = pending[index]!,
      current = values.get(domain)!;
    for (const link of edges.get(domain) ?? []) {
      consume();
      const next = link.divide
        ? current.value / link.factor
        : current.value * link.factor;
      const inherited = link.divide
        ? current.error / Math.abs(link.factor)
        : current.error * Math.abs(link.factor);
      put(link.target, {
        value: next,
        error: inherited + Number.EPSILON * Math.abs(next) + Number.MIN_VALUE,
      });
    }
  }
  return values;
};
