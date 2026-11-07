import {
  type XmlElement,
  NS,
  childElements,
  getAttrValue,
  qname,
} from "../xml/index.ts";

/** Geometry after constraint evaluation, in millimetres, relative to the parent.
 * A non-drawing SP child can use a signed LIN main-axis spacing advance. */
export interface DiagramLayoutSize {
  readonly w: number;
  readonly h: number;
}
export interface DiagramLayoutRect extends DiagramLayoutSize {
  readonly x: number;
  readonly y: number;
}
interface ArrangementOptions {
  /** Solved reference envelope; physical entrance rectangles remain unchanged. */
  readonly projectionEnvelope?: Partial<DiagramLayoutSize>;
  /** Reserved physical spans consumed only when an axis is projected. */
  readonly reservedSizes?:
    readonly (Partial<DiagramLayoutSize> | undefined)[] | undefined;
  /**
   * Completed live positions in the projected parent domain, before clipping.
   * Missing axes retain their scaled entrance position. Group origin
   * normalization and alignment still apply to the resulting rectangles.
   */
  readonly projectedCoordinates?:
    | ((
        scales: DiagramLayoutSize,
      ) => readonly Partial<Pick<DiagramLayoutRect, "x" | "y">>[] | undefined)
    | undefined;
  readonly childrenFit?: boolean;
  /** Non-drawing SP children. Only their LIN main-axis advance may be signed. */
  readonly spacers?: ReadonlySet<number> | undefined;
  readonly fitting?: boolean;
}
type HorizontalAlignment = "none" | "l" | "ctr" | "r";
type VerticalAlignment = "none" | "t" | "mid" | "b";
interface Alignment {
  readonly horizontal: HorizontalAlignment;
  readonly vertical: VerticalAlignment;
}
export type DiagramArrangement = Alignment &
  (
    | {
        readonly type: "lin";
        readonly direction: "fromL" | "fromR" | "fromT" | "fromB";
      }
    | { readonly type: "composite"; readonly aspectRatio: number }
  );

const attr = (element: XmlElement, name: string): string | null =>
  getAttrValue(element, qname("", name, ""));
const enumeration = <T extends string>(
  value: string,
  allowed: readonly T[],
): T => {
  if (!allowed.includes(value as T))
    throw new Error(`invalid diagram arrangement parameter ${value}`);
  return value as T;
};

/**
 * Read the positional part of the linear/composite algorithms (ECMA-376
 * 21.4.7.1, 21.4.7.49). Constraint and text/rule evaluation are separate stages.
 * Parameters belonging to other algorithms have no effect on this stage;
 * native reference controls confirm that lin ignores both chAlign and ar.
 */
export const readDiagramArrangement = (
  algorithm: XmlElement,
): DiagramArrangement => {
  if (
    algorithm.name.namespaceURI !== NS.diagram ||
    algorithm.name.localName !== "alg"
  )
    throw new Error("expected diagram algorithm");
  const type = attr(algorithm, "type");
  if (type !== "lin" && type !== "composite")
    throw new Error(`unsupported diagram arrangement algorithm ${type}`);
  const parameters = new Map<string, string>();
  for (const child of childElements(algorithm)) {
    if (
      child.name.namespaceURI !== NS.diagram ||
      child.name.localName !== "param"
    )
      continue;
    const name = attr(child, "type"),
      value = attr(child, "val");
    if (name !== null && value !== null) {
      if (parameters.has(name))
        throw new Error(`duplicate diagram algorithm parameter ${name}`);
      parameters.set(name, value.trim());
    }
  }
  const alignment: Alignment = {
    horizontal: enumeration(parameters.get("horzAlign") ?? "ctr", [
      "none",
      "l",
      "ctr",
      "r",
    ]),
    vertical: enumeration(parameters.get("vertAlign") ?? "mid", [
      "none",
      "t",
      "mid",
      "b",
    ]),
  };
  if (type === "lin")
    return {
      ...alignment,
      type,
      direction: enumeration(parameters.get("linDir") ?? "fromL", [
        "fromL",
        "fromR",
        "fromT",
        "fromB",
      ]),
    };
  const value = parameters.get("ar") ?? "0";
  const aspectRatio = Number(value);
  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ||
    !Number.isFinite(aspectRatio) ||
    aspectRatio < 0
  )
    throw new Error(`invalid diagram composite aspect ratio ${value}`);
  return { ...alignment, type, aspectRatio };
};

const finite = (value: number): number => {
  if (!Number.isFinite(value))
    throw new Error("non-finite diagram layout geometry");
  return value;
};
const size = (value: number): number => {
  if (finite(value) < 0) throw new Error("negative diagram layout size");
  return value;
};
const extent = (rects: readonly DiagramLayoutRect[]): DiagramLayoutRect => {
  let x = Infinity,
    y = Infinity,
    r = -Infinity,
    b = -Infinity;
  for (const rect of rects) {
    x = Math.min(x, rect.x);
    y = Math.min(y, rect.y);
    r = Math.max(r, finite(rect.x + rect.w));
    b = Math.max(b, finite(rect.y + rect.h));
  }
  return { x, y, w: finite(r - x), h: finite(b - y) };
};
const offset = (
  start: number,
  length: number,
  available: number,
  alignment: HorizontalAlignment | VerticalAlignment,
): number => {
  switch (alignment) {
    case "none":
      return 0;
    case "l":
    case "t":
      return -start;
    case "ctr":
    case "mid":
      return (available - length) / 2 - start;
    case "r":
    case "b":
      return available - length - start;
  }
};

// Linear feasibility uses an absolute 1e-9 mm comparison threshold, both
// before fallback and during its search. Native controls bracket it at 0.99
// and 1.01 times this difference across frame sizes, axes and trial scales.
// Exact-fit arithmetic can otherwise select an entire extra bisection step.
const linearFits = (extent: number, available: number): boolean =>
  extent - available < 1e-9;

/**
 * Native linear fallback retains ten significant binary digits of the feasible
 * scale. Halving before the first feasible midpoint establishes its exponent;
 * that midpoint and the next nine bisections establish the significand.
 * A decimal relative tolerance stops too early immediately below powers of two.
 * Independently regenerated cases across scales and axes are recorded in
 * diagram-linear-boundary-native.json, alongside the broader arrangement suite.
 */
const linearScale = (available: number, preferred: number): number => {
  if (available === 0 && preferred > 0) return 0;
  let lower = 0,
    upper = 1,
    significantBits = 0;
  while (significantBits < 10) {
    const midpoint = (upper + lower) / 2;
    // Underflow can prevent progress for extreme, but finite, input sizes.
    if (midpoint === lower || midpoint === upper) break;
    if (linearFits(preferred * midpoint, available)) lower = midpoint;
    else upper = midpoint;
    if (lower > 0) significantBits++;
  }
  return lower;
};

/**
 * Arrange already evaluated child rectangles. This does not resolve DiagramML
 * constraints, measure text, apply adjustment rules, or replace a saved drawing.
 * A caller that has evaluated child content can pass childrenFit=false to run
 * one fallback attempt even when the rectangles fit geometrically. Native
 * controls cover linear main-axis fitting and composite aspect-ratio budgets.
 * This does not decide whether text fits, apply rules, count retries, or reflow
 * descendants at the resulting sizes; those belong to the layout orchestrator.
 * Results retain floating-point precision; EMU conversion belongs at the final
 * drawing boundary, not between sibling placements or nested layout stages.
 */
export const arrangeDiagramChildren = (
  available: DiagramLayoutSize,
  children: readonly DiagramLayoutRect[],
  arrangement: DiagramArrangement,
  options: Omit<ArrangementOptions, "fitting"> = {},
): DiagramLayoutRect[] =>
  options.spacers?.size
    ? arrangeWithSpaces(available, children, arrangement, options)
    : arrange(available, children, arrangement, options);

/** Position completed LIN drawings without repeating allocation or clipping.
 * A descendant can draw beyond its reserved canvas; those extents determine
 * sibling positions and the final union, while alignment still uses the canvas.
 */
export const positionDiagramLinearChildren = (
  available: DiagramLayoutSize,
  children: readonly DiagramLayoutRect[],
  arrangement: Extract<DiagramArrangement, { type: "lin" }>,
  options: Pick<ArrangementOptions, "spacers"> = {},
): DiagramLayoutRect[] =>
  options.spacers?.size
    ? arrangeWithSpaces(available, children, arrangement, {
        ...options,
        fitting: false,
      })
    : arrange(available, children, arrangement, { fitting: false });

const arrangeWithSpaces = (
  available: DiagramLayoutSize,
  children: readonly DiagramLayoutRect[],
  arrangement: DiagramArrangement,
  options: ArrangementOptions,
): DiagramLayoutRect[] => {
  if (arrangement.type === "lin" && options.spacers?.size) {
    const main =
      arrangement.direction === "fromL" || arrangement.direction === "fromR"
        ? "w"
        : "h";
    for (const index of options.spacers)
      if ((children[index]?.[main] ?? 0) < 0)
        return arrangeSignedSpaces(available, children, arrangement, options);
  }
  return arrange(available, children, arrangement, options);
};

/** SP without an output shape reserves spacing rather than a shape extent
 * (ECMA-376 21.4.7.1/21.4.2.27). A negative advance overlaps adjacent nodes.
 * Keep ordinary geometry on the existing path, including its strict validation
 * and native fallback. This path also fits backtracking beyond the row's ends.
 */
const arrangeSignedSpaces = (
  available: DiagramLayoutSize,
  children: readonly DiagramLayoutRect[],
  arrangement: Extract<DiagramArrangement, { type: "lin" }>,
  options: ArrangementOptions,
): DiagramLayoutRect[] => {
  size(available.w);
  size(available.h);
  const horizontal =
    arrangement.direction === "fromL" || arrangement.direction === "fromR";
  const main = horizontal ? "w" : "h",
    cross = horizontal ? "h" : "w",
    reverse =
      arrangement.direction === "fromR" || arrangement.direction === "fromB";
  let total = 0,
    first = 0,
    last = 0,
    crossExtent = 0;
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!;
    finite(child.x);
    finite(child.y);
    (options.spacers?.has(index) ? finite : size)(child[main]);
    size(child[cross]);
    total = finite(total + child[main]);
    first = Math.min(first, total);
    last = Math.max(last, total);
    crossExtent = Math.max(crossExtent, child[cross]);
  }
  const preferred = finite(last - first),
    scale =
      options.fitting !== false &&
      (options.childrenFit === false ||
        !linearFits(preferred, available[main]) ||
        !linearFits(crossExtent, available[cross]))
        ? linearScale(available[main], preferred)
        : 1;
  if (options.fitting !== false)
    crossExtent = Math.min(crossExtent, available[cross]);
  const length = total * scale;
  let position = 0;
  const result = children.map((child) => {
    const mainSize = child[main] * scale,
      crossSize =
        options.fitting === false
          ? child[cross]
          : Math.min(child[cross], available[cross]),
      mainPosition = reverse ? length - position - mainSize : position,
      crossPosition = (crossExtent - crossSize) / 2;
    position += mainSize;
    return horizontal
      ? { x: mainPosition, y: crossPosition, w: mainSize, h: crossSize }
      : { x: crossPosition, y: mainPosition, w: crossSize, h: mainSize };
  });
  // Spacing occupies the segment between its endpoints, without turning its
  // signed advance into a positive shape dimension for subsequent passes.
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const rect of result) {
    const endX = finite(rect.x + rect.w),
      endY = finite(rect.y + rect.h);
    left = Math.min(left, rect.x, endX);
    top = Math.min(top, rect.y, endY);
    right = Math.max(right, rect.x, endX);
    bottom = Math.max(bottom, rect.y, endY);
  }
  const dx = offset(
      left,
      finite(right - left),
      available.w,
      arrangement.horizontal,
    ),
    dy = offset(top, finite(bottom - top), available.h, arrangement.vertical);
  return result.map((child) => ({
    x: finite(child.x + dx),
    y: finite(child.y + dy),
    w: child.w,
    h: child.h,
  }));
};

const arrange = (
  available: DiagramLayoutSize,
  children: readonly DiagramLayoutRect[],
  arrangement: DiagramArrangement,
  options: Omit<ArrangementOptions, "spacers"> = {},
): DiagramLayoutRect[] => {
  size(available.w);
  size(available.h);
  for (const child of children) {
    finite(child.x);
    finite(child.y);
    size(child.w);
    size(child.h);
  }
  if (!children.length) return [];
  let result: DiagramLayoutRect[];
  if (arrangement.type === "lin") {
    const horizontal =
      arrangement.direction === "fromL" || arrangement.direction === "fromR";
    const reverse =
      arrangement.direction === "fromR" || arrangement.direction === "fromB";
    const main = horizontal ? "w" : "h",
      cross = horizontal ? "h" : "w";
    let preferred = 0,
      crossExtent = 0;
    for (const child of children) {
      preferred = finite(preferred + child[main]);
      crossExtent = Math.max(crossExtent, child[cross]);
    }
    // Child content failure and cross-axis overflow also enter fallback, even
    // if the row itself fits. Reuse the same search rather than scaling a saved
    // drawing by a fixed near-one factor.
    const scale =
      options.fitting !== false &&
      (options.childrenFit === false ||
        !linearFits(preferred, available[main]) ||
        !linearFits(crossExtent, available[cross]))
        ? linearScale(available[main], preferred)
        : 1;
    if (options.fitting !== false)
      crossExtent = Math.min(crossExtent, available[cross]);
    const length = preferred * scale;
    let position = 0;
    result = children.map((child) => {
      const mainSize = child[main] * scale,
        crossSize =
          options.fitting === false
            ? child[cross]
            : Math.min(child[cross], available[cross]);
      const mainPosition = reverse ? length - position - mainSize : position,
        crossPosition = (crossExtent - crossSize) / 2;
      position += mainSize;
      return horizontal
        ? { x: mainPosition, y: crossPosition, w: mainSize, h: crossSize }
        : { x: crossPosition, y: mainPosition, w: crossSize, h: mainSize };
    });
  } else {
    size(arrangement.aspectRatio);
    const bounds = { ...extent(children), ...options.projectionEnvelope };
    const fallback =
      options.childrenFit === false ||
      bounds.w > available.w ||
      bounds.h > available.h;
    let width = available.w,
      height = available.h;
    if (fallback && arrangement.aspectRatio > 0) {
      width = Math.min(width, height * arrangement.aspectRatio);
      height = Math.min(height, available.w / arrangement.aspectRatio);
    }
    let sx = bounds.w > width ? width / bounds.w : 1,
      sy = bounds.h > height ? height / bounds.h : 1;
    if (fallback && arrangement.aspectRatio > 0) sx = sy = Math.min(sx, sy);
    // Preserve positive authored offsets, but bring negative group origins
    // into the parent's coordinate system. Fallback limits both dimensions
    // against the original canvas (not the aspect-ratio fitting budget).
    // A partially outside child is shortened at the far edge; a completely
    // outside child is moved back inside, retaining its fitted size.
    const fitAxis = (
      position: number,
      length: number,
      limit: number,
    ): [number, number] => {
      if (!fallback) return [position, length];
      if (position > limit) return [limit - length, length];
      return [position, Math.min(length, limit - position)];
    };
    const liveCoordinates =
      sx !== 1 || sy !== 1
        ? options.projectedCoordinates?.({ w: sx, h: sy })
        : undefined;
    result = children.map((child, index) => {
      const [x, w] = fitAxis(
          (liveCoordinates?.[index]?.x ?? child.x * sx) -
            Math.min(0, bounds.x) * sx,
          (sx !== 1
            ? (options.reservedSizes?.[index]?.w ?? child.w)
            : child.w) * sx,
          available.w,
        ),
        [y, h] = fitAxis(
          (liveCoordinates?.[index]?.y ?? child.y * sy) -
            Math.min(0, bounds.y) * sy,
          (sy !== 1
            ? (options.reservedSizes?.[index]?.h ?? child.h)
            : child.h) * sy,
          available.h,
        );
      return { x, y, w, h };
    });
  }
  const bounds = extent(result);
  const dx = offset(bounds.x, bounds.w, available.w, arrangement.horizontal),
    dy = offset(bounds.y, bounds.h, available.h, arrangement.vertical);
  return result.map((child) => ({
    x: finite(child.x + dx),
    y: finite(child.y + dy),
    w: child.w,
    h: child.h,
  }));
};
