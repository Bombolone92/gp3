import { chartAxisGridDeck } from "./chart-axis-grid-fixture.js";

export const baselineColors = {
  target: "#D85532",
  context: "#425EA8",
  plot: "#F7F9FB",
  primaryAxis: "#AC2351",
  secondaryAxis: "#245A41",
};

export function chartFillBaselineDeck({
  kind = "column",
  hidden = true,
  primary = { min: -10, max: 20 },
  secondary = { min: 10, max: 50 },
  primaryCrossing = { at: 5 },
  secondaryCrossing = { at: 35 },
  primaryDirection = "minMax",
  secondaryDirection = "minMax",
  ...options
} = {}) {
  return chartAxisGridDeck({
    kind,
    legend: undefined,
    title: undefined,
    categories: ["A", "B", "C"],
    textStyle: { font: "Arial", sizePt: 10 },
    plotAreaFill: baselineColors.plot,
    dropLines: kind === "line",
    valueAxis: primary,
    valueAxisHidden: true,
    valueAxisOrientation: primaryDirection,
    secondaryValueAxisOrientation: secondaryDirection,
    categoryAxisCrosses: primaryCrossing,
    secondaryCategoryAxisCrosses: secondaryCrossing,
    categoryAxisLineColor: baselineColors.primaryAxis,
    secondaryCategoryAxisLineColor: baselineColors.secondaryAxis,
    categoryAxisLabelRotationDeg: 0,
    valueAxisLabelRotationDeg: 0,
    categoryAxisTickLabelPos: "none",
    secondaryCategoryAxisTickLabelPos: "none",
    secondaryValueAxisCrosses: "max",
    series: [
      {
        name: "Target",
        values: [0.125, 0.375, 0.75].map(
          (f) => secondary.min + f * (secondary.max - secondary.min),
        ),
        color: baselineColors.target,
        lineColor: baselineColors.target,
        secondaryAxis: true,
        invertIfNegative: false,
        markerSymbol: "none",
      },
      {
        name: "Context",
        values: [0.25, 0.5, 0.625].map(
          (f) => primary.min + f * (primary.max - primary.min),
        ),
        color: baselineColors.context,
        lineColor: baselineColors.context,
        secondaryAxis: false,
        invertIfNegative: false,
        markerSymbol: "none",
        ...(kind !== "bar" ? { chartKind: "line" } : {}),
      },
    ],
    axes: {
      secondaryValue: { hidden, ...secondary },
      secondaryCategory: { hidden: false },
    },
    ...options,
  });
}
