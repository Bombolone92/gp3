import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { P, createDeck, preview } from "../src/model.js";
import {
  chartRoot,
  workbook,
  chartWorkbookBindingDeck,
} from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  allChildElements,
  getAttrValue,
  textContent,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
const kinds = ["bar", "column", "line", "area", "pie", "doughnut"];
const invalid = [NaN, Infinity, -Infinity];
const snapshot = (p) => ({
  parts: P._internalPackageOf(p).parts.map((x) => [
    x.name,
    x.contentType,
    x.data.slice(),
  ]),
  types: structuredClone(P._internalPackageOf(p).contentTypes),
});
const options = (spec) => ({
  x: P.inches(1),
  y: P.inches(1),
  w: P.inches(5),
  h: P.inches(3),
  spec,
});
const child = (e, n, ns = NS.chart) => firstChildElement(e, qname("", n, ns));
const attribute = (e, n) => getAttrValue(e, qname("", n, ""));
function assertData(p, shape, values) {
  expect(P.getShapeChartSpec(shape).series[0].values).toEqual(values);
  const pkg = P._internalPackageOf(p),
    root = parseXml(strFromU8(pkg.getPart(chartRoot(shape)).data)).root,
    plot = child(child(root, "chart"), "plotArea"),
    group = plot.children.find(
      (e) =>
        e.kind === "element" &&
        e.name.namespaceURI === NS.chart &&
        e.name.localName.endsWith("Chart"),
    ),
    cache = child(
      child(child(child(group, "ser"), "val"), "numRef"),
      "numCache",
    ),
    points = allChildElements(cache, qname("c", "pt", NS.chart)).map((e) => [
      Number(attribute(e, "idx")),
      textContent(child(e, "v")),
    ]);
  expect(Number(attribute(child(cache, "ptCount"), "val"))).toBe(values.length);
  expect(points).toEqual(
    values.flatMap((v, i) => (v === null ? [] : [[i, String(v)]])),
  );
  const sheet = parseXml(
      strFromU8(unzipSync(workbook(p, shape).data)["xl/worksheets/sheet1.xml"]),
    ).root,
    ns = sheet.name.namespaceURI,
    cells = new Map(
      allChildElements(
        child(sheet, "sheetData", ns),
        qname("", "row", ns),
      ).flatMap((row) =>
        allChildElements(row, qname("", "c", ns))
          .filter((cell) => child(cell, "v", ns) !== null)
          .map((cell) => [
            attribute(cell, "r"),
            textContent(child(cell, "v", ns)),
          ]),
      ),
    );
  values.forEach((v, i) =>
    v === null
      ? expect(cells.has(`B${i + 2}`)).toBe(false)
      : expect(cells.get(`B${i + 2}`)).toBe(String(v)),
  );
  expect(P.validatePresentation(p)).toEqual([]);
}
describe("finite chart data authoring", () => {
  for (const kind of kinds) {
    it.each(invalid)(
      `rejects ${kind} data %s on creation without allocating any parts`,
      (value) => {
        const p = createDeck("blank"),
          slide = P.getSlides(p)[0],
          before = snapshot(p);
        expect(() =>
          P.addSlideChart(
            slide,
            options({
              kind,
              categories: ["First"],
              series: [{ name: "Units", values: [2, null, 5, value] }],
            }),
          ),
        ).toThrow("series[0].values[3]: expected a finite number");
        expect(snapshot(p)).toEqual(before);
        expect(P.getSlideShapes(slide)).toHaveLength(0);
      },
    );
    it.each(invalid)(
      `rejects ${kind} data %s on edit without altering native graphs or render`,
      (value) => {
        const f = chartWorkbookBindingDeck(kind),
          chart = P.getSlideCharts(f.slide)[0],
          before = snapshot(f.p),
          svg = preview(f.p, f.slide);
        expect(() =>
          P.setChartSpec(chart, {
            ...chart.spec,
            categories: [],
            series: [{ ...chart.spec.series[0], values: [4, null, value] }],
          }),
        ).toThrow("series[0].values[2]: expected a finite number");
        expect(snapshot(f.p)).toEqual(before);
        expect(preview(f.p, f.slide)).toBe(svg);
      },
    );
    it(`preserves ${kind} finite values and blank positions on add/edit/export`, async () => {
      const p = createDeck("blank"),
        slide = P.getSlides(p)[0],
        values = [0, null, -0.125, 2.5, 1e150, -1e-150],
        shape = P.addSlideChart(
          slide,
          options({
            kind,
            categories: ["Named"],
            series: [{ name: "Finite", values, numberFormat: "0.00" }],
          }),
        );
      assertData(p, shape, values);
      // Missing slots already behave as blank cells, including explicit undefined.
      const sparse = Array(6);
      sparse[0] = 0;
      sparse[2] = undefined;
      sparse[3] = -3.25;
      sparse[5] = 8;
      P.setChartSpec(P.getSlideCharts(slide)[0], {
        ...P.getShapeChartSpec(shape),
        series: [{ name: "Gaps", values: sparse }],
      });
      const expected = [0, null, null, -3.25, null, 8];
      assertData(p, shape, expected);
      const q = await P.loadPresentation(await P.savePresentation(p));
      assertData(q, P.getSlideCharts(P.getSlides(q)[0])[0].shape, expected);
    });
  }
  it.each(["7", "NaN", "Infinity", true, false, {}, new Number(4)])(
    "rejects nonnumeric data %j without coercion or partial changes",
    (value) => {
      const f = chartWorkbookBindingDeck(),
        chart = P.getSlideCharts(f.slide)[0],
        before = snapshot(f.p),
        spec = {
          ...chart.spec,
          series: [
            chart.spec.series[0],
            { name: "Later series", values: [1, null, value] },
          ],
        };
      expect(() => P.setChartSpec(chart, spec)).toThrow(
        "series[1].values[2]: expected a finite number",
      );
      expect(snapshot(f.p)).toEqual(before);
      expect(() => P.addSlideChart(f.slide, options(spec))).toThrow(
        "series[1].values[2]: expected a finite number",
      );
      expect(snapshot(f.p)).toEqual(before);
    },
  );
  it("rejects invalid later-series points even after valid combo and secondary-axis data", () => {
    const f = chartWorkbookBindingDeck("column"),
      chart = P.getSlideCharts(f.slide)[0],
      before = snapshot(f.p),
      spec = {
        ...chart.spec,
        series: [
          { name: "Primary", values: [2, 3, 4] },
          {
            name: "Secondary",
            chartKind: "line",
            secondaryAxis: true,
            values: [0, null, -Infinity],
          },
        ],
      };
    expect(() => P.setChartSpec(chart, spec)).toThrow(
      "series[1].values[2]: expected a finite number",
    );
    expect(snapshot(f.p)).toEqual(before);
    expect(() => P.addSlideChart(f.slide, options(spec))).toThrow(
      "series[1].values[2]: expected a finite number",
    );
    expect(snapshot(f.p)).toEqual(before);
  });
  it.each([true, false])(
    "rejects nonfinite inputs atomically for imported cached-only/linked charts: linked=%s",
    (linked) => {
      const f = chartWorkbookBindingDeck(),
        chart = P.getSlideCharts(f.slide)[0],
        pkg = P._internalPackageOf(f.p),
        owner = chartRoot(chart.shape);
      if (linked) {
        const rels = pkg.getRels(owner),
          rel = rels.items.find((r) => r.id === "rId7");
        rel.target = "https://example.com/live-source.xlsx";
        rel.targetMode = "External";
        pkg.setRels(owner, rels);
      } else {
        // Native cache-only chart: drop the bound relationship and its externalData node.
        const doc = parseXml(strFromU8(pkg.getPart(owner).data));
        doc.root.children = doc.root.children.filter(
          (e) =>
            e.kind !== "element" ||
            e.name.namespaceURI !== NS.chart ||
            e.name.localName !== "externalData",
        );
        pkg.getPart(owner).data = new TextEncoder().encode(serializeXml(doc));
        const rels = pkg.getRels(owner);
        rels.items = rels.items.filter((r) => r.id !== "rId7");
        pkg.setRels(owner, rels);
      }
      const before = snapshot(f.p);
      for (const value of invalid) {
        expect(() =>
          P.setChartSpec(chart, {
            ...chart.spec,
            series: [{ name: "Invalid", values: [value] }],
          }),
        ).toThrow("finite number");
        expect(snapshot(f.p)).toEqual(before);
      }
    },
  );
});
