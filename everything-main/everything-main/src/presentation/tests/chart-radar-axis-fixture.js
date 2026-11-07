import { chartRadarLabelDeck } from "./chart-radar-label-fixture.js";

export const radarAxisColor = "#2468AC";
// Tick values and labels are independently checked in the native reference.
export const radarAxisCases = [
  {
    name: "quarter percent",
    axis: {
      min: 0,
      max: 1,
      majorUnit: 0.25,
      numberFormat: "0.0%",
      numberFormatSourceLinked: false,
    },
    ticks: [0, 0.25, 0.5, 0.75, 1],
    labels: ["0.0%", "25.0%", "50.0%", "75.0%", "100.0%"],
  },
  {
    name: "negative currency",
    axis: {
      min: -3,
      max: 5,
      majorUnit: 2,
      numberFormat: '\"$\"0.00',
      numberFormatSourceLinked: false,
    },
    ticks: [-3, -1, 1, 3, 5],
    labels: ["-$3.00", "-$1.00", "$1.00", "$3.00", "$5.00"],
  },
  {
    name: "fractional minimum",
    axis: {
      min: 1.3,
      max: 8,
      majorUnit: 2,
      numberFormat: "0.0",
      numberFormatSourceLinked: false,
    },
    ticks: [1.3, 3.3, 5.3, 7.3],
    labels: ["1.3", "3.3", "5.3", "7.3"],
  },
  {
    name: "source linked",
    axis: {
      min: 0,
      max: 1,
      majorUnit: 0.2,
      numberFormat: "0.0",
      numberFormatSourceLinked: true,
    },
    source: "0.0%",
    ticks: [0, 0.2, 0.4, 0.6, 0.8, 1],
    labels: ["0.0%", "20.0%", "40.0%", "60.0%", "80.0%", "100.0%"],
  },
  {
    name: "explicit unlinked",
    axis: {
      min: 0,
      max: 1,
      majorUnit: 0.2,
      numberFormat: "0.0",
      numberFormatSourceLinked: false,
    },
    source: "0.0%",
    ticks: [0, 0.2, 0.4, 0.6, 0.8, 1],
    labels: ["0.0", "0.2", "0.4", "0.6", "0.8", "1.0"],
  },
  {
    name: "display thousands",
    axis: {
      min: 0,
      max: 8000,
      majorUnit: 2000,
      numberFormat: "0.0",
      numberFormatSourceLinked: false,
      displayUnits: "thousands",
    },
    ticks: [0, 2000, 4000, 6000, 8000],
    labels: ["0.0", "2.0", "4.0", "6.0", "8.0"],
  },
  {
    name: "only center tick",
    axis: { min: 2, max: 3, majorUnit: 5, numberFormat: "0.0" },
    ticks: [2],
    labels: ["2.0"],
  },
  {
    name: "hidden labels",
    axis: { min: 0, max: 8, majorUnit: 2, numberFormat: "0.0%" },
    tickLabelPos: "none",
    ticks: [0, 2, 4, 6, 8],
    labels: [],
  },
  {
    name: "automatic fractional origin",
    axis: {
      min: 1.3,
      max: 8,
      numberFormat: "0.00",
      numberFormatSourceLinked: false,
    },
    ticks: [1.3, 2.3, 3.3, 4.3, 5.3, 6.3, 7.3],
    labels: ["1.30", "2.30", "3.30", "4.30", "5.30", "6.30", "7.30"],
  },
  {
    name: "automatic small origin",
    axis: {
      min: 0.13,
      max: 0.8,
      numberFormat: "0.00",
      numberFormatSourceLinked: false,
    },
    ticks: [0.13, 0.23, 0.33, 0.43, 0.53, 0.63, 0.73],
    labels: ["0.13", "0.23", "0.33", "0.43", "0.53", "0.63", "0.73"],
  },
  {
    name: "automatic scaled origin",
    axis: {
      min: 120,
      max: 800,
      numberFormat: "0.00",
      numberFormatSourceLinked: false,
    },
    ticks: [120, 220, 320, 420, 520, 620, 720],
    labels: [
      "120.00",
      "220.00",
      "320.00",
      "420.00",
      "520.00",
      "620.00",
      "720.00",
    ],
  },
];

export function chartRadarAxisDeck(c, radarStyle = "marker") {
  const span = c.axis.max - c.axis.min;
  return chartRadarLabelDeck({
    radarStyle,
    categories: ["North", "East", "South", "West"],
    valueAxis: c.axis,
    valueAxisMajorGridlines: true,
    valueAxisMajorGridlineColor: "#E5E7EB",
    valueAxisMajorGridlineWidthEmu: 4762,
    valueAxisTickLabelPos: c.tickLabelPos,
    valueAxisLabelStyle: { font: "Arial", sizePt: 12, color: radarAxisColor },
    series: [
      {
        name: "Units",
        values: [0.2, 0.4, 0.6, 0.8].map((v) => c.axis.min + v * span),
        color: "#E85239",
        numberFormat: c.source,
      },
    ],
  });
}
