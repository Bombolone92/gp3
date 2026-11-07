import { P } from "../src/model.js";
import {
  chartLegendLayoutDeck,
  chartMarkerPaintDeck,
  chartRoot,
} from "./chart-copy-fixture.js";
import { nativeChartSeriesHosts } from "../lib/pptx/src/internal/chartml/native-data.ts";
import {
  NS,
  firstChildElement,
  parseXml,
  qname,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
const child = (e, name) => firstChildElement(e, qname("c", name, NS.chart));

// Cache availability is native metadata: both an absent cache and an authored
// zero-point cache project to [] in the public numeric model.
export function setNativeChartCache(
  f,
  { indices = [1], cache = "missing", channel = "value" } = {},
) {
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data));
  for (const [i, host] of nativeChartSeriesHosts(doc.root).entries()) {
    if (!indices.includes(i)) continue;
    const c =
      channel === "value"
        ? (child(host.series, "val") ?? child(host.series, "yVal"))
        : child(host.series, channel);
    if (!c) throw Error(`Missing native channel ${channel}`);
    const reference = child(c, "numRef");
    if (cache === "missing" && reference)
      reference.children = reference.children.filter(
        (e) => e !== child(reference, "numCache"),
      );
    else
      c.children = [
        parseXml(
          cache === "missing"
            ? `<c:numRef xmlns:c="${NS.chart}"><c:f>Sheet1!$B$2:$B$4</c:f></c:numRef>`
            : cache === "referenceZero"
              ? `<c:numRef xmlns:c="${NS.chart}"><c:f>Sheet1!$B$2:$B$4</c:f><c:numCache><c:ptCount val="0"/></c:numCache></c:numRef>`
              : `<c:numLit xmlns:c="${NS.chart}"><c:ptCount val="${cache === "blank" ? 3 : 0}"/></c:numLit>`,
        ).root,
      ];
  }
  part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}

export function chartCacheAvailabilityDeck({
  kind = "column",
  indices,
  cache,
  channel,
  ...options
} = {}) {
  const f = ["scatter", "radar", "bubble"].includes(kind)
    ? chartMarkerPaintDeck(kind === "bubble" ? "scatter" : kind)
    : chartLegendLayoutDeck({
        kind,
        sizePt: 14,
        title: "Cache availability",
        ...(["pie", "doughnut"].includes(kind)
          ? { series: [{ name: "Alpha", values: [2, 4, 3], color: "#E85239" }] }
          : {}),
        ...options,
      });
  if (["scatter", "radar", "bubble"].includes(kind)) {
    const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
      doc = parseXml(new TextDecoder().decode(part.data)),
      chart = child(doc.root, "chart");
    if (!child(chart, "legend"))
      chart.children.splice(
        chart.children.indexOf(child(chart, "plotArea")) + 1,
        0,
        parseXml(
          `<c:legend xmlns:c="${NS.chart}"><c:legendPos val="r"/></c:legend>`,
        ).root,
      );
    if (kind === "bubble") {
      const group = child(child(chart, "plotArea"), "scatterChart");
      group.name = qname("c", "bubbleChart", NS.chart);
      group.children = group.children.filter(
        (e) => e !== child(group, "scatterStyle"),
      );
      for (const { series } of nativeChartSeriesHosts(doc.root)) {
        // Bubble series do not admit scatter markers or smoothing.
        series.children = series.children.filter(
          (e) => e !== child(series, "marker") && e !== child(series, "smooth"),
        );
        series.children.push(
          parseXml(
            `<c:bubbleSize xmlns:c="${NS.chart}"><c:numLit><c:ptCount val="3"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt><c:pt idx="2"><c:v>3</c:v></c:pt></c:numLit></c:bubbleSize>`,
          ).root,
        );
      }
    }
    part.data = new TextEncoder().encode(serializeXml(doc));
  }
  return setNativeChartCache(f, { indices, cache, channel });
}

// Valid native multi-ring input; the authoring API currently creates one ring.
export function chartDoughnutExtentsDeck(seriesValues) {
  const f = chartLegendLayoutDeck({
      kind: "doughnut",
      title: "Rings",
      sizePt: 14,
      categories: ["A", "B", "C"],
      series: [
        {
          name: "Rings",
          values: [2, 4, 3],
          pointColors: ["#E85239", "#2F8541", "#376CA8", "#845B20", "#B6327E"],
        },
      ],
    }),
    part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data)),
    group = child(child(child(doc.root, "chart"), "plotArea"), "doughnutChart"),
    source = child(group, "ser");
  group.children = group.children.filter((e) => e !== source);
  for (const [i, values] of seriesValues.entries()) {
    const series = structuredClone(source);
    child(series, "idx").attrs[0].value = String(i);
    child(series, "order").attrs[0].value = String(i);
    child(series, "val").children = [
      parseXml(
        values === null
          ? `<c:numRef xmlns:c="${NS.chart}"><c:f>Sheet1!$B$2:$B$4</c:f></c:numRef>`
          : `<c:numLit xmlns:c="${NS.chart}"><c:ptCount val="${values.length}"/>${values.flatMap((v, j) => (v === null ? [] : [`<c:pt idx="${j}"><c:v>${v}</c:v></c:pt>`])).join("")}</c:numLit>`,
      ).root,
    ];
    group.children.splice(i + 1, 0, series);
  }
  part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}
