import { describe, expect, it } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { formatFixedChartNumber } from "../lib/pptx-preview/src/chart-number-format.ts";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  chartOptionalNumberDeck,
  optionalNumberCases,
} from "./chart-optional-number-fixture.js";
import {
  chartPercentFormatDeck,
  percentLabelColor,
} from "./chart-percent-format-fixture.js";

function texts(p, slide, color = percentLabelColor) {
  const result = [];
  walkElements(
    parseXml(
      decodeURIComponent(preview(p, slide).split(",").slice(1).join(",")),
    ).root,
    (e) => {
      if (
        e.name.localName === "text" &&
        getAttrValue(e, qname("", "fill", "")) === color
      )
        result.push(
          e.children
            .filter((c) => c.kind === "text")
            .map((c) => c.data)
            .join(""),
        );
    },
  );
  return result;
}
const kinds = ["column", "bar", "line", "area", "radar", "pie", "doughnut"];
describe("native fixed-number digit placeholders and decimal rounding", () => {
  for (const kind of kinds)
    for (const [i, c] of optionalNumberCases.entries())
      it(`${kind} native control ${i + 1}: ${c.format}`, () => {
        const f = chartOptionalNumberDeck({
            kind,
            format: c.format,
            values: c.values,
          }),
          spec = P.getShapeChartSpec(f.shape),
          xml = P._internalPackageOf(f.p)
            .getPart(chartRoot(f.shape))
            .data.slice(),
          book = workbook(f.p, f.shape).data.slice();
        expect(spec.series[0].values).toEqual(c.values);
        expect(texts(f.p, f.slide).join("")).toBe(c.labels);
        if (!["pie", "doughnut"].includes(kind))
          expect(texts(f.p, f.slide, "#2468AC").join("")).toBe(c.axis);
        expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
        expect(
          P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
        ).toEqual(xml);
        expect(workbook(f.p, f.shape).data).toEqual(book);
      });
  for (const kind of ["pie", "doughnut"])
    for (const scope of ["group", "series"])
      for (const [format, values, expected] of [
        ["0.#%", [2.25, 4.5, 6.75, 8], ["10.5%", "20.9%", "31.4%", "37.2%"]],
        ["0.#%", [0, 1, 2, 3, 4], ["0.%", "10.%", "20.%", "30.%", "40.%"]],
        [
          "0.0#%",
          [2.25, 4.5, 6.75, 8],
          ["10.47%", "20.93%", "31.4%", "37.21%"],
        ],
        [
          "0.0#%",
          [0, 1, 2, 3, 4],
          ["0.0%", "10.0%", "20.0%", "30.0%", "40.0%"],
        ],
      ])
        it(`${kind} ${scope} applies optional ${format} to ${values}`, () => {
          const f = chartPercentFormatDeck({
            kind,
            scope,
            format,
            values,
            showValue: false,
          });
          expect(texts(f.p, f.slide)).toEqual(expected);
        });
  for (const kind of kinds)
    for (const linked of [true, null])
      it(`${kind} resolves optional digits from ${linked === true ? "linked" : "omitted"} source format`, () => {
        const f = chartOptionalNumberDeck({
          kind,
          format: linked === true ? "0.0" : null,
          linked,
          source: "0.0#",
        });
        expect(texts(f.p, f.slide).join("")).toBe(
          optionalNumberCases[1].labels,
        );
      });
  for (const kind of ["column", "radar", "pie", "doughnut"])
    it(`${kind} keeps optional formats editable through clipboard both ways and export`, async () => {
      const f = chartOptionalNumberDeck({
          kind,
          scope: "series",
          format: "0.#0#",
        }),
        spec = P.getShapeChartSpec(f.shape),
        book = workbook(f.p, f.shape).data.slice(),
        xml = P._internalPackageOf(f.p)
          .getPart(chartRoot(f.shape))
          .data.slice(),
        expected = texts(f.p, f.slide);
      const q = createDeck("blank"),
        imported = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0], {
          preservePaintFormatting: true,
          preserveTextFormatting: true,
        }),
        copied = P.copyShape(imported, P.getSlideCharts(imported)[0].shape);
      const transferredXml = P._internalPackageOf(q)
        .getPart(chartRoot(copied))
        .data.slice();
      const loaded = await P.loadPresentation(await P.savePresentation(q)),
        slide = P.getSlides(loaded).at(-1),
        charts = P.getSlideCharts(slide);
      expect(charts).toHaveLength(2);
      expect(new Set(charts.map((c) => chartRoot(c.shape))).size).toBe(2);
      expect(
        new Set(charts.map((c) => workbook(loaded, c.shape).name)).size,
      ).toBe(2);
      expect(texts(loaded, slide)).toEqual([...expected, ...expected]);
      for (const chart of charts) {
        expect(chart.spec).toEqual(spec);
        expect(workbook(loaded, chart.shape).data).toEqual(book);
        expect(
          P._internalPackageOf(loaded).getPart(chartRoot(chart.shape)).data,
        ).toEqual(transferredXml);
      }
      const back = P.importSlide(f.p, slide, P.getSlideLayout(f.slide), {
        preservePaintFormatting: true,
        preserveTextFormatting: true,
      });
      expect(texts(f.p, back)).toEqual([...expected, ...expected]);
      expect(P.validatePresentation(f.p)).toEqual([]);
      expect(P.getShapeChartSpec(copied)).toEqual(spec);
      expect(
        P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
      ).toEqual(xml);
    });
  it.each([
    [0, "#", ""],
    [0, "#.##", "."],
    [0, "0#.#", "0."],
    [1, "0#.#", "01."],
    [0, "0.#0#", "0.0"],
    [0.3, "0.#0#", "0.30"],
    [0.004, "0.#0#", "0.004"],
    [-0.004, "0.00", "0.00"],
    [-0.004, "#.##", "."],
    [15, "0.##,", "0.02"],
    [1e22, "0.00", "10000000000000000000000.00"],
    [1e-100, "0." + "#".repeat(100), "0." + "0".repeat(99) + "1"],
    [Number.MIN_VALUE, "0." + "#".repeat(100), "0."],
  ])("formats %s with %s as %s", (value, format, expected) =>
    expect(formatFixedChartNumber(value, format)).toBe(expected),
  );
  it.each([
    "0." + "#".repeat(101),
    "0.??",
    "0.0E+00",
    "0.00;[Red]0.00",
    '0.0"unterminated',
    "0.0\\",
  ])("retains fallback for unsupported or malformed %s", (format) =>
    expect(formatFixedChartNumber(1.25, format)).toBeUndefined(),
  );
});
