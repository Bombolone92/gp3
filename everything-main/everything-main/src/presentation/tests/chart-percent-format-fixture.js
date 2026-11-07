import { P } from "../src/model.js";
import { chartLegendLayoutDeck } from "./chart-copy-fixture.js";
import { chartRadarLabelDeck } from "./chart-radar-label-fixture.js";

export const percentLabelColor = "#AF2568";
export const valueLabelColor = "#663399";

// Deliberately different source and label formats expose which component owns
// numFmt. Native reference controls cover both collection scopes and switches.
export function chartPercentFormatDeck({
  kind = "pie",
  scope = "group",
  showPercent = true,
  showValue = true,
  format = '0.00" units"',
  linked = false,
  source = '0.0000" src"',
  color = percentLabelColor,
  values = [2.25, 4.5, 6.75, 8],
  ...options
} = {}) {
  const dataLabels = {
    showValue,
    showCategory: false,
    showSeriesName: false,
    showPercent,
    ...(format !== null ? { numberFormat: format } : {}),
    ...(linked !== null ? { numberFormatSourceLinked: linked } : {}),
    separator: " | ",
    textStyle: { font: "Arial", sizePt: 12, color },
  };
  const make = kind === "radar" ? chartRadarLabelDeck : chartLegendLayoutDeck;
  return make({
    ...(kind !== "radar" ? { kind } : {}),
    radarStyle: "marker",
    legend: undefined,
    categories: values.map((_, i) => String.fromCharCode(65 + i)),
    series: [
      {
        name: "Signal",
        values,
        numberFormat: source,
        color: "#E85239",
        ...(scope === "series" ? { dataLabels } : {}),
      },
    ],
    ...(scope === "group" ? { dataLabels } : {}),
    ...options,
  });
}

export function chartPercentFormatPair(kind) {
  const first = chartPercentFormatDeck({ kind, format: "0.0%" }),
    second = chartPercentFormatDeck({
      kind,
      scope: "series",
      showPercent: false,
      color: valueLabelColor,
    });
  for (const [i, f] of [first, second].entries()) {
    P.setShapePosition(f.shape, P.pt(30 + i * 470), P.pt(70));
    P.setShapeSize(f.shape, P.pt(430), P.pt(390));
  }
  const imported = P.importSlide(
    first.p,
    second.slide,
    P.getSlideLayout(first.slide),
    { preservePaintFormatting: true, preserveTextFormatting: true },
  );
  P.copyShape(first.slide, P.getSlideCharts(imported)[0].shape);
  P.removeSlide(first.p, imported);
  return first;
}
