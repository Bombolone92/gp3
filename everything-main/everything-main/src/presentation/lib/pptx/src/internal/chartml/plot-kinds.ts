import type { ChartKind } from "./types.ts";

interface PlottedKindMap {
  readonly localName: string;
  readonly kind: ChartKind;
}

export const CHART_PLOT_KINDS: ReadonlyArray<PlottedKindMap> = [
  // `barChart` is overloaded; `<c:barDir val="bar"/>` vs `"col"` decides.
  { localName: "barChart", kind: "column" },
  // The 3D variants share the same `<c:ser>` schema as their flat
  // counterparts; we degrade to the flat kind so renderers don't have
  // to special-case them. Native editing of the embedded data flattens
  // them the same way.
  { localName: "bar3DChart", kind: "column" },
  { localName: "lineChart", kind: "line" },
  { localName: "line3DChart", kind: "line" },
  { localName: "pieChart", kind: "pie" },
  { localName: "pie3DChart", kind: "pie" },
  { localName: "ofPieChart", kind: "pie" },
  { localName: "doughnutChart", kind: "doughnut" },
  { localName: "areaChart", kind: "area" },
  { localName: "area3DChart", kind: "area" },
  // Scatter / bubble carry xy / xyz tuples per series (`<c:xVal>` /
  // `<c:yVal>` / `<c:bubbleSize>`) rather than numeric channels against
  // shared categories; radar uses cat+val like line. All three are
  // modeled as their own kind (read + render only — the builder rejects
  // them, see chart-builder.ts).
  { localName: "scatterChart", kind: "scatter" },
  { localName: "bubbleChart", kind: "bubble" },
  { localName: "radarChart", kind: "radar" },
  // Stock charts: open / high / low / close as a four-line plot.
  { localName: "stockChart", kind: "line" },
  // Surface degrades to a column chart so the data table is visible.
  { localName: "surfaceChart", kind: "column" },
  { localName: "surface3DChart", kind: "column" },
];
