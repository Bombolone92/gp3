import type {
  ChartAxisCrossing,
  ChartAxisTickLabelPosition,
} from "../../pptx/src/internal/chartml/index.ts";
import type { FontSpec, TextMeasurer } from "./text-layout.ts";

export interface AxisPlacement {
  readonly coordinate: number;
  readonly tickCoordinate: number;
  readonly labelCoordinate: number;
  readonly labelSide: number;
  readonly tickSide: number;
}

export interface AxisLayoutInput {
  /** Physical interval perpendicular to this axis, in CSS pixels. */
  readonly origin: number;
  readonly end: number;
  readonly horizontal: boolean;
  readonly min: number;
  readonly max: number;
  readonly reversed?: boolean;
  readonly crossing?: ChartAxisCrossing;
  readonly labelPosition?: ChartAxisTickLabelPosition;
  readonly position?: "b" | "t" | "l" | "r";
  readonly rowDepth: number;
  readonly hidden?: boolean;
}

interface AxisRow {
  readonly coordinate: number;
  readonly side: number;
  readonly external: boolean;
  readonly depth: number;
}
export interface AxisLayout {
  readonly placement: AxisPlacement;
  readonly row: AxisRow;
  readonly nominalCoordinate: number;
  readonly tickBaseCoordinate: number;
}

const coincides = (a: number, b: number) =>
  Math.abs(a - b) <=
  Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 16;

/** The axis keeps three independent rails: the spine, marks and label row.
 * Numeric crossings retain axPos's physical direction. Enum crossings resolve
 * their logical edge instead. A numeric upper crossing whose marks face the
 * logical high side returns nextTo labels/marks to a separate low-edge row.
 * Crossings are expressed in the CROSSING axis's domain (MS-OE376 2.1.1464).
 */
export const layoutAxis = (
  input: AxisLayoutInput,
  primary?: AxisLayout,
): AxisLayout => {
  const { origin, end, min, max, crossing, labelPosition = "nextTo" } = input;
  const lowSide = (input.horizontal ? 1 : -1) * (input.reversed ? -1 : 1);
  const low = lowSide < 0 ? origin : end;
  const high = lowSide < 0 ? end : origin;
  const value =
    crossing === "min"
      ? min
      : crossing === "max"
        ? max
        : typeof crossing === "object"
          ? crossing.at
          : 0;
  const fraction = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const nominal = low + fraction * (high - low);
  const tickSide =
    typeof crossing === "object"
      ? input.position === "t" || input.position === "l"
        ? -1
        : input.position === "b" || input.position === "r"
          ? 1
          : input.horizontal
            ? 1
            : -1
      : lowSide * (crossing === "max" ? -1 : 1);
  const returned =
    typeof crossing === "object" && crossing.at >= max && tickSide === -lowSide;
  const fixed = labelPosition === "low" || labelPosition === "high";
  const labelSide = fixed
    ? lowSide * (labelPosition === "high" ? -1 : 1)
    : lowSide * (crossing === "max" ? -1 : 1);
  // NONE still reserves a category mark/font row, but its actual marks stay
  // at the nominal crossing. It must not inherit a visible returned mark rail.
  const rowSide =
    labelPosition === "none" ? (returned ? lowSide : tickSide) : labelSide;
  const rowCoordinate = fixed
    ? labelPosition === "high"
      ? high
      : low
    : returned
      ? low
      : nominal;
  const row: AxisRow = {
    coordinate: rowCoordinate,
    side: rowSide,
    external: coincides(rowCoordinate, rowSide < 0 ? origin : end),
    depth: input.hidden ? 0 : input.rowDepth,
  };
  const shared =
    !input.hidden &&
    row.external &&
    primary?.row.external &&
    primary.row.side === row.side &&
    coincides(primary.row.coordinate, row.coordinate);
  const offset = shared ? primary.row.depth * row.side : 0;
  // Only outward, coincident external rows displace secondary spines.
  // Interior/inward rows overlap without changing the data projection.
  const coordinate =
    nominal +
    (shared && coincides(nominal, rowCoordinate) && tickSide === rowSide
      ? offset
      : 0);
  const labelCoordinate =
    labelPosition === "nextTo" && !returned
      ? coordinate
      : rowCoordinate + offset;
  const tickCoordinate =
    labelPosition === "nextTo"
      ? returned
        ? labelCoordinate + input.rowDepth * labelSide
        : coordinate
      : nominal;
  return {
    placement: {
      coordinate,
      tickCoordinate,
      labelCoordinate,
      labelSide,
      tickSide,
    },
    row,
    nominalCoordinate: nominal,
    tickBaseCoordinate:
      labelPosition === "nextTo" && returned ? rowCoordinate : nominal,
  };
};

export interface AxisTextRow {
  readonly depth: number;
  readonly distanceDelta: number;
  /** Intrinsic text-edge gap beside a vertical axis, before label distance. */
  readonly sideGap: number;
  /** Intrinsic font-edge gap above/below a horizontal axis. */
  readonly horizontalGap: number;
  readonly width: number;
  readonly height: number;
}

/** Measure the labels selected for painting, after interval selection. Font
 * bounds and shaped advances are intrinsic measurements, not current glyph ink.
 * The 2px compatibility padding is shared across native faces/sizes; all other
 * spacing follows the measured font. No native baseline correction is implied.
 */
export const measureAxisTextRow = (
  labels: ReadonlyArray<string>,
  font: FontSpec,
  measure: TextMeasurer,
  options: {
    readonly horizontal: boolean;
    readonly category: boolean;
    readonly visible: boolean;
    readonly angle?: number;
    readonly distance?: number;
    readonly lineSpacing?: {
      readonly kind: "pts" | "pct";
      readonly value: number;
    } | null;
  },
): AxisTextRow => {
  const metrics = measure("0", font);
  const valid = (n: number | undefined): n is number =>
    n !== undefined && Number.isFinite(n) && n >= 0;
  const ascent = valid(metrics.ascentPx) ? metrics.ascentPx : font.sizePx;
  const descent = valid(metrics.descentPx) ? metrics.descentPx : 0;
  const height = ascent + descent;
  const gap = valid(metrics.lineGapPx) ? metrics.lineGapPx : 0;
  const spacing = options.lineSpacing;
  const advance =
    spacing?.kind === "pts"
      ? (spacing.value * 4) / 3
      : spacing?.kind === "pct"
        ? (height + gap) * spacing.value
        : height;
  let width = 0;
  let hasText = false;
  for (const label of labels) {
    if (label === "") continue;
    hasText = true;
    const measured = measure(label, font).widthPx;
    if (Number.isFinite(measured)) width = Math.max(width, measured);
  }
  const tick = ascent / 3;
  const distanceDelta =
    ((options.distance ?? 100) / 100 - 1) * Math.max(4, height / 4);
  const angle = Math.abs(((options.angle ?? 0) * Math.PI) / 180);
  // Empty cache labels have no text rectangle. The layout retains the axis's
  // intrinsic mark/distance spaces, but does not reserve a blank font line.
  const projected = !hasText
    ? 0
    : options.horizontal
      ? width * Math.abs(Math.sin(angle)) + advance * Math.abs(Math.cos(angle))
      : width * Math.abs(Math.cos(angle)) + advance * Math.abs(Math.sin(angle));
  return {
    depth: options.visible
      ? projected +
        (options.horizontal ? 2 * tick : tick + height / 2) +
        2 +
        distanceDelta
      : options.category
        ? tick
        : 0,
    distanceDelta,
    sideGap: tick + height / 2,
    horizontalGap: 2 * tick,
    width,
    height,
  };
};
