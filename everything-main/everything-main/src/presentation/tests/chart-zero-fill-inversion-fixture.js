import { chartSeriesOpacityDeck } from "./chart-series-opacity-fixture.js";

// Keep negative bars inside explicit bounds so native outline checks cannot
// accidentally pass because a bar was clipped outside the plot.
export function chartZeroFillInversionDeck({
  kind = "bar",
  negativeColor,
  outline = "none",
  ...options
} = {}) {
  return chartSeriesOpacityDeck({
    kind,
    opacity: 0,
    legend: { position: null },
    valueAxis: { min: -6, max: 6, majorUnit: 2 },
    categoryAxisLabelRotationDeg: 0,
    valueAxisLabelRotationDeg: 0,
    series: [
      {
        name: "Signed",
        values: [-2, 4, -3],
        color: "#E85239",
        negativeColor,
        invertIfNegative: true,
        ...(outline === "none"
          ? { lineColor: null }
          : outline === "blue"
            ? { lineColor: "#316BB0", lineWidthEmu: 50800 }
            : {}),
      },
    ],
    ...options,
  });
}
