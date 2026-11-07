import type { ChartKind, ChartSpec } from "./types.ts";

const positions = new Set([
  "bestFit",
  "b",
  "ctr",
  "inBase",
  "inEnd",
  "l",
  "outEnd",
  "r",
  "t",
]);

/**
 * MS-OI29500 2.1.1456 adds context restrictions to ST_DLblPos.
 * The documented series restrictions are also enforced at group scope by
 * the native reference: e.g. top/bestFit bar-group labels require repair.
 * Use the interoperable kind/grouping-specific set at both scopes.
 * Validate before authoring, rather than dropping the caller's requested
 * position or emitting a chart that readers must repair. Reading and
 * untouched package saves remain lossless for other producers' native XML.
 */
export const validateChartLabelPositions = (spec: ChartSpec): void => {
  const check = (value: unknown, kind: ChartKind, path: string): void => {
    if (value === undefined) return;
    if (typeof value !== "string" || !positions.has(value))
      throw new RangeError(`${path}: expected an OOXML ST_DLblPos token`);
    if (kind === "area" || kind === "doughnut" || kind === "radar")
      throw new RangeError(
        `${path}: ${kind} charts require omission of the label position (MS-OI29500 2.1.1456)`,
      );
    const allowed =
      kind === "bar" || kind === "column"
        ? spec.grouping === "stacked" || spec.grouping === "percentStacked"
          ? ["inBase", "inEnd", "ctr"]
          : ["inBase", "inEnd", "outEnd", "ctr"]
        : kind === "pie"
          ? ["bestFit", "outEnd", "inEnd", "ctr"]
          : ["l", "r", "b", "t", "ctr"];
    if (!allowed.includes(value))
      throw new RangeError(
        `${path}: unsupported position for a ${spec.grouping ?? "clustered"} ${kind} chart; expected ${allowed.join(", ")}`,
      );
  };
  const kinds = new Set(
    spec.series.length
      ? spec.series.map((series) => series.chartKind ?? spec.kind)
      : [spec.kind],
  );
  for (const kind of kinds)
    check(spec.dataLabels?.position, kind, "dataLabels.position");
  spec.series.forEach((series, i) =>
    check(
      series.dataLabels?.position,
      series.chartKind ?? spec.kind,
      `series[${i}].dataLabels.position`,
    ),
  );
};
