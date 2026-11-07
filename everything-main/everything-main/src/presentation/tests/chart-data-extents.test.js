import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { P, createDeck, preview } from "../src/model.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import { NativeChartWorkbook } from "../lib/pptx/src/internal/chartml/native-workbook.ts";
import {
  NS,
  parseXml,
  firstChildElement,
  allChildElements,
  qname,
  getAttrValue,
  textContent,
} from "../lib/pptx/src/internal/xml/index.ts";

const child = (node, name, ns = NS.chart) =>
  firstChildElement(node, qname("", name, ns));
const attribute = (node, name) => getAttrValue(node, qname("", name, ""));

function fixture(spec) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0],
    shape = P.addSlideChart(slide, {
      x: P.inches(1),
      y: P.inches(1),
      w: P.inches(7),
      h: P.inches(4),
      spec,
    });
  return { p, slide, shape };
}
function nativeSeries(f) {
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    root = parseXml(strFromU8(part.data)).root,
    plot = child(child(root, "chart"), "plotArea");
  return plot.children
    .filter((node) => node.kind === "element")
    .flatMap((node) => allChildElements(node, qname("", "ser", NS.chart)));
}
function numericCache(series) {
  const value = child(series, "val"),
    ref = child(value, "numRef"),
    cache = ref ? child(ref, "numCache") : child(value, "numLit");
  return {
    formula: ref ? textContent(child(ref, "f")) : null,
    count: Number(attribute(child(cache, "ptCount"), "val")),
    points: allChildElements(cache, qname("", "pt", NS.chart)).map((point) => [
      Number(attribute(point, "idx")),
      textContent(child(point, "v")),
    ]),
  };
}
function sheetCells(f) {
  const sheet = unzipSync(workbook(f.p, f.shape).data)[
      "xl/worksheets/sheet1.xml"
    ],
    root = parseXml(strFromU8(sheet)).root,
    ns = root.name.namespaceURI,
    cells = new Map();
  for (const row of allChildElements(
    child(root, "sheetData", ns),
    qname("", "row", ns),
  ))
    for (const cell of allChildElements(row, qname("", "c", ns))) {
      const value =
        child(cell, "v", ns) ?? child(child(cell, "is", ns), "t", ns);
      cells.set(attribute(cell, "r"), textContent(value));
    }
  return cells;
}
describe("chart category and value extents", () => {
  it.each(["bar", "column", "line", "area", "pie", "doughnut"])(
    "preserves unlabelled %s values in caches and workbook",
    (kind) => {
      const f = fixture({
          kind,
          categories: [],
          series: [{ name: "Values", values: [8, -3, 15] }],
        }),
        series = nativeSeries(f)[0],
        cells = sheetCells(f);
      expect(child(series, "cat")).toBeNull();
      expect(numericCache(series)).toEqual({
        formula: "Sheet1!$B$2:$B$4",
        count: 3,
        points: [
          [0, "8"],
          [1, "-3"],
          [2, "15"],
        ],
      });
      expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([
        8, -3, 15,
      ]);
      expect([cells.get("B2"), cells.get("B3"), cells.get("B4")]).toEqual([
        "8",
        "-3",
        "15",
      ]);
      expect(P.validatePresentation(f.p)).toEqual([]);
    },
  );
  it.each(["bar", "column", "line", "area", "pie", "doughnut"])(
    "retains all %s values when labels are shorter",
    (kind) => {
      const f = fixture({
          kind,
          categories: ["Named"],
          series: [{ name: "Values", values: [5, 12, 19] }],
        }),
        series = nativeSeries(f)[0],
        cells = sheetCells(f);
      expect(P.getShapeChartSpec(f.shape).categories).toEqual(["Named"]);
      expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([
        5, 12, 19,
      ]);
      expect(numericCache(series).formula).toBe("Sheet1!$B$2:$B$4");
      expect(
        textContent(child(child(child(series, "cat"), "strRef"), "f")),
      ).toBe("Sheet1!$A$2:$A$2");
      expect([cells.get("A2"), cells.get("A3"), cells.get("A4")]).toEqual([
        "Named",
        "",
        "",
      ]);
      expect(cells.get("B4")).toBe("19");
    },
  );
  it("uses independent series extents while keeping workbook rows aligned", () => {
    const f = fixture({
        kind: "column",
        categories: ["One", "Two"],
        series: [
          { name: "Long", values: [2, null, 7, null] },
          { name: "Short", values: [4] },
          { name: "Empty", values: [] },
        ],
      }),
      series = nativeSeries(f),
      cells = sheetCells(f);
    expect(series.map(numericCache)).toEqual([
      {
        formula: "Sheet1!$B$2:$B$5",
        count: 4,
        points: [
          [0, "2"],
          [2, "7"],
        ],
      },
      { formula: "Sheet1!$C$2:$C$2", count: 1, points: [[0, "4"]] },
      { formula: null, count: 0, points: [] },
    ]);
    expect(cells.get("B4")).toBe("7");
    expect(cells.get("A5")).toBe("");
    expect(cells.has("B3")).toBe(false);
    expect(cells.has("B5")).toBe(false);
    expect(cells.has("C3")).toBe(false);
    expect(cells.has("D2")).toBe(false);
  });
  it.each(["column", "bar", "line", "area"])(
    "retains independent %s extents when appending, resizing and clearing series",
    async (kind) => {
      const f = fixture({
          kind,
          categories: ["A", "B", "C", "D", "E"],
          dispBlanksAs: "zero",
          series: [{ name: "Full", values: [1, 2, 3, 4, 5] }],
        }),
        update = (patch) => {
          const chart = P.getSlideCharts(f.slide)[0];
          P.setChartSpec(chart, { ...chart.spec, ...patch });
        },
        values = () => P.getShapeChartSpec(f.shape).series.map((s) => s.values);
      update({
        series: [
          ...P.getShapeChartSpec(f.shape).series,
          { name: "Short", values: [7, null] },
          { name: "Empty", values: [] },
        ],
      });
      expect(values()).toEqual([[1, 2, 3, 4, 5], [7, null], []]);
      expect(nativeSeries(f).map(numericCache)).toEqual([
        expect.objectContaining({ count: 5 }),
        {
          formula: expect.stringMatching(/!\$([A-Z]+)\$2:\$\1\$3$/),
          count: 2,
          points: [[0, "7"]],
        },
        { formula: null, count: 0, points: [] },
      ]);
      const book = new NativeChartWorkbook(workbook(f.p, f.shape).data),
        range = book.sourceRange(numericCache(nativeSeries(f)[1]).formula);
      expect(
        textContent(child(book.cell(range.sheet, range.start), "v", NS.sml)),
      ).toBe("7");
      expect(
        book.cell(range.sheet, { ...range.start, row: range.end.row + 1 }),
      ).toBeNull();
      update({ categories: ["A", "B", "C", "D", "E", "F", "G"] });
      expect(values()).toEqual([[1, 2, 3, 4, 5], [7, null], []]);
      update({
        series: P.getShapeChartSpec(f.shape).series.map((s, i) => ({
          ...s,
          values: i === 0 ? [9] : i === 1 ? [] : [null, 6, null],
        })),
      });
      const expected = [[9], [], [null, 6, null]];
      expect(values()).toEqual(expected);
      expect(nativeSeries(f).map((s) => numericCache(s).count)).toEqual([
        1, 0, 3,
      ]);
      expect(numericCache(nativeSeries(f)[1]).formula).toBeNull();
      const p = await P.loadPresentation(await P.savePresentation(f.p)),
        chart = P.getSlideCharts(P.getSlides(p)[0])[0];
      expect(chart.spec.series.map((s) => s.values)).toEqual(expected);
      expect(P.validatePresentation(p)).toEqual([]);
    },
  );
  it("does not create reversed spreadsheet ranges for an empty series", () => {
    const f = fixture({
        kind: "line",
        categories: [],
        series: [{ name: "Empty", values: [] }],
      }),
      series = nativeSeries(f)[0];
    expect(child(series, "cat")).toBeNull();
    expect(numericCache(series)).toEqual({
      formula: null,
      count: 0,
      points: [],
    });
    expect(sheetCells(f).size).toBe(2);
  });
  it("references the same workbook columns beyond Z", () => {
    const f = fixture({
        kind: "column",
        categories: ["One"],
        series: Array.from({ length: 28 }, (_, i) => ({
          name: `Series ${i}`,
          values: [i + 1, i + 2],
        })),
      }),
      series = nativeSeries(f),
      cells = sheetCells(f);
    for (const [index, column] of [
      [24, "Z"],
      [25, "AA"],
      [26, "AB"],
      [27, "AC"],
    ]) {
      expect(
        textContent(child(child(child(series[index], "tx"), "strRef"), "f")),
      ).toBe(`Sheet1!$${column}$1`);
      expect(numericCache(series[index]).formula).toBe(
        `Sheet1!$${column}$2:$${column}$3`,
      );
      expect(cells.get(`${column}3`)).toBe(String(index + 2));
    }
  });
  it("preserves additional values through edits, export and native transfer both ways", async () => {
    const f = fixture({
        kind: "column",
        categories: ["First", "Second"],
        series: [{ name: "Before", values: [1, 2] }],
      }),
      updated = {
        kind: "line",
        categories: [],
        series: [{ name: "After", values: [3, 6, 9, 12] }],
      };
    P.setChartSpec(
      { shape: f.shape, spec: P.getShapeChartSpec(f.shape) },
      updated,
    );
    expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([
      3, 6, 9, 12,
    ]);
    expect(sheetCells(f).get("B5")).toBe("12");
    const loaded = await P.loadPresentation(await P.savePresentation(f.p)),
      sourceSlide = P.getSlides(loaded)[0],
      sourceShape = P.getSlideCharts(sourceSlide)[0].shape,
      q = createDeck("blank"),
      destination = P.importSlide(q, sourceSlide, P.getSlideLayouts(q)[0]),
      copy = P.getSlideCharts(destination)[0].shape,
      returned = P.importSlide(
        loaded,
        destination,
        P.getSlideLayout(sourceSlide),
      ),
      back = P.getSlideCharts(returned)[0].shape;
    for (const shape of [sourceShape, copy, back])
      expect(P.getShapeChartSpec(shape).series[0].values).toEqual([
        3, 6, 9, 12,
      ]);
    expect(workbook(q, copy).data).toEqual(workbook(loaded, sourceShape).data);
    expect(workbook(loaded, back).data).toEqual(
      workbook(loaded, sourceShape).data,
    );
    expect(decodeURIComponent(preview(q, destination))).toMatch(
      /<path d="M[^"]* L[^"]* L[^"]* L/,
    );
    const original = workbook(loaded, sourceShape).data.slice();
    P.setChartSpec(
      { shape: back, spec: P.getShapeChartSpec(back) },
      {
        ...updated,
        series: [{ name: "Independent", values: [20, 40, 60, 80, 100] }],
      },
    );
    expect(workbook(loaded, sourceShape).data).toEqual(original);
    expect(P.getShapeChartSpec(sourceShape).series[0].values).toEqual([
      3, 6, 9, 12,
    ]);
    expect(P.validatePresentation(loaded)).toEqual([]);
    expect(P.validatePresentation(q)).toEqual([]);
  });
});
