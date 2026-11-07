import { describe, expect, it } from "vitest";
import { P, createDeck, parseDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import {
  chartLegendLayoutDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";

const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const measureText = (text, font) => ({
  widthPx: text.length * font.sizePx * (text.length === 1 ? 0.67 : 0.4655),
  ascentPx: font.sizePx * 0.8,
  descentPx: font.sizePx * 0.3171875,
});
function fixture(
  n,
  { widthIn = 7, position = "b", sizePt = 18, names, kind = "column" } = {},
) {
  names ??= Array.from(
    { length: n },
    (_, i) => `Entry ${String(i + 1).padStart(2, "0")}`,
  );
  const f = chartLegendLayoutDeck({
    kind,
    sizePt,
    categoryAxisLabelStyle: { font: "Arial", sizePt: 9 },
    valueAxisLabelStyle: { font: "Arial", sizePt: 9 },
    legend: {
      position,
      textStyle: { font: "Arial", sizePt },
      fill: "#FFF0D1",
      strokeColor: "#845B20",
    },
    series: names.map((name, i) => ({
      name,
      values: [2 + (i % 3), 4, 3, 5],
      color: "#E85239",
      ...(kind === "line" ? { markerSymbol: "none" } : {}),
    })),
  });
  P.setShapeSize(f.shape, P.inches(widthIn), P.inches(6));
  return { ...f, names };
}
function rendered(f, slide = f.slide, p = f.p) {
  const nodes = [];
  const svg = renderSlideToSvg(p, slide, { measureText });
  walkElements(parseXml(svg).root, (e) => nodes.push(e));
  const labels = nodes.filter(
    (e) =>
      e.name.localName === "text" &&
      f.names.includes(e.children.map((c) => c.data ?? "").join("")),
  );
  const ys = [...new Set(labels.map((e) => +attr(e, "y")))].sort(
    (a, b) => a - b,
  );
  const rows = ys.map((y) =>
    labels
      .filter((e) => +attr(e, "y") === y)
      .sort((a, b) => +attr(a, "x") - +attr(b, "x")),
  );
  const legend = nodes.find(
    (e) => e.name.localName === "rect" && attr(e, "fill") === "#FFF0D1",
  );
  return { svg, rows, labels, legend };
}
const texts = (row) =>
  row.map((e) => e.children.map((c) => c.data ?? "").join(""));

describe("native horizontal legend row balancing", () => {
  // Equal-width native controls distinguish balanced columns from greedy
  // packing. Changing counts may narrow the whole grid without changing text.
  for (const position of ["b", "t"])
    for (const [widthIn, n, counts] of [
      [7, 5, [5]],
      [7, 6, [3, 3]],
      [7, 7, [4, 3]],
      [7, 9, [5, 4]],
      [7, 11, [4, 4, 3]],
      [7, 13, [5, 5, 3]],
      [9, 6, [6]],
      [9, 7, [4, 3]],
      [9, 11, [6, 5]],
      [9, 13, [5, 5, 3]],
      [9, 19, [5, 5, 5, 4]],
    ])
      it(`${position}, ${widthIn}in, ${n} entries balances rows ${counts}`, () => {
        const f = fixture(n, { widthIn, position }),
          r = rendered(f);
        expect(r.rows.map((row) => row.length)).toEqual(counts);
        expect(r.rows.flatMap(texts)).toEqual(f.names);
        for (const row of r.rows.slice(1))
          for (const [i, label] of row.entries())
            expect(+attr(label, "x")).toBe(+attr(r.rows[0][i], "x"));
        expect(r.svg).not.toContain("scale(");
      });

  for (const [kind, sizePt, widthIn, n, counts] of [
    ["column", 9, 7, 17, [9, 8]],
    ["column", 32, 9, 7, [3, 3, 1]],
    ["line", 9, 9, 13, [7, 6]],
    ["line", 18, 9, 13, [5, 5, 3]],
    ["line", 32, 9, 13, [4, 4, 4, 1]],
  ])
    it(`${kind} ${sizePt}pt uses its own key column at ${widthIn}in`, () => {
      const f = fixture(n, { kind, sizePt, widthIn }),
        r = rendered(f);
      expect(r.rows.map((row) => row.length)).toEqual(counts);
      for (const label of r.labels)
        expect(+attr(label, "font-size")).toBeCloseTo((sizePt * 4) / 3, 1);
    });

  for (const index of [0, 5, 6, 11])
    it(`sizes every grid cell from the widest entry, at index ${index}`, () => {
      const names = Array.from({ length: 12 }, (_, i) =>
        i === index ? "Longer label here" : String.fromCharCode(65 + i),
      );
      const r = rendered(fixture(12, { names }));
      expect(r.rows.map((row) => row.length)).toEqual([2, 2, 2, 2, 2, 2]);
      const xs = r.rows.map((row) => row.map((e) => +attr(e, "x")));
      for (const row of xs) expect(row).toEqual(xs[0]);
      expect(r.rows.flatMap(texts)).toEqual(names);
    });

  it("tries the combined variable widths before creating equal grid columns", () => {
    const names = ["Longer label here", "B", "C", "D", "E", "F", "G"],
      r = rendered(fixture(7, { names }));
    expect(r.rows.map((row) => row.length)).toEqual([7]);
    const font = { sizePx: 24 },
      keyColumn = 24 * 1.1171875 * 0.9,
      advances = names.map((name) => measureText(name, font).widthPx),
      gaps = r.labels
        .slice(1)
        .map(
          (e, i) =>
            +attr(e, "x") - +attr(r.labels[i], "x") - advances[i] - keyColumn,
        );
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 1);
    expect(gaps[0]).toBeGreaterThan(0);
  });

  it("caps a single row by distributing less space rather than scaling the text", () => {
    const r = rendered(fixture(5));
    expect(r.rows).toHaveLength(1);
    expect(
      +attr(r.legend, "width") - +attr(r.legend, "stroke-width"),
    ).toBeCloseTo(7 * 96 * 0.9, 1);
    expect(r.svg).not.toContain("scale(");
    for (const e of r.labels) expect(+attr(e, "font-size")).toBe(24);
  });

  it("preserves chart/workbook bytes and independent copied edits through export/reimport", async () => {
    const f = fixture(7),
      chart = P.getSlideCharts(f.slide)[0],
      before = chart.spec,
      raw = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data.slice(),
      book = workbook(f.p, f.shape).data.slice();
    rendered(f);
    expect(P.getShapeChartSpec(f.shape)).toEqual(before);
    expect(P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data).toEqual(
      raw,
    );
    expect(workbook(f.p, f.shape).data).toEqual(book);
    const dest = createDeck("blank"),
      imported = P.importSlide(dest, f.slide, P.getSlideLayouts(dest)[0]),
      copied = P.getSlideCharts(imported)[0];
    P.setChartSpec(copied, {
      ...copied.spec,
      legend: { ...copied.spec.legend, position: "t" },
      series: copied.spec.series.map((s) => ({
        ...s,
        values: s.values.map((v) => v + 1),
      })),
    });
    P.importSlide(f.p, imported, P.getSlideLayouts(f.p)[0]);
    const q = await parseDeck(await P.savePresentation(f.p)),
      charts = P.getSlides(q).map((s) => P.getSlideCharts(s)[0]);
    for (const slide of P.getSlides(q))
      expect(rendered(f, slide, q).rows.map((row) => row.length)).toEqual([
        4, 3,
      ]);
    expect(charts.map((c) => c.spec.legend.position)).toEqual(["b", "t"]);
    expect(charts.map((c) => c.spec.series[0].values)).toEqual([
      [2, 4, 3, 5],
      [3, 5, 4, 6],
    ]);
    expect(new Set(charts.map((c) => workbook(q, c.shape).name)).size).toBe(2);
    expect(workbook(q, charts[0].shape).data).toEqual(book);
    expect(P.validatePresentation(q)).toEqual([]);
  });
});
