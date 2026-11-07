import { describe, expect, it } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  chartPercentFormatDeck,
  percentLabelColor,
} from "./chart-percent-format-fixture.js";

function labels(p, slide) {
  const result = [];
  walkElements(
    parseXml(
      decodeURIComponent(preview(p, slide).split(",").slice(1).join(",")),
    ).root,
    (e) => {
      if (
        e.name.localName === "text" &&
        getAttrValue(e, qname("", "fill", "")) === percentLabelColor
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
const cases = [
  ["unequal", [2.25, 4.5, 6.75, 8], [11, 21, 31, 37]],
  ["reversed", [8, 6.75, 4.5, 2.25], [37, 31, 21, 11]],
  ["thirds", [1, 1, 1], [34, 33, 33]],
  ["sixths", Array(6).fill(1), [16, 16, 17, 17, 17, 17]],
  ["sevenths", Array(7).fill(1), [15, 15, 14, 14, 14, 14, 14]],
  ["over-rounding", [1, 1, 1, 3], [16, 17, 17, 50]],
  ["largest last", [101, 202, 303, 394], [10, 20, 30, 40]],
  ["largest first", [394, 303, 202, 101], [40, 30, 20, 10]],
  ["equal over-rounding errors", [105, 205, 305, 385], [10, 20, 31, 39]],
  ["zero", [0, 1, 1, 1], [0, 34, 33, 33]],
  ["blank", [null, 1, 1, 1], [34, 33, 33]],
  ["zero total", [0, 0, 0], [0, 0, 0]],
  ["decimal", [0.1, 0.2, 0.3], [17, 33, 50]],
  // Native adjusts unrounded signed fractions and can flip a positive half
  // percent to -1%, or reduce a negative magnitude. Preserve signs and a total
  // magnitude of 100 instead; this is a deliberate compatibility boundary.
  ["positive half ties", [1, 1, 198], [0, 1, 99]],
  ["signed", [-1, 1, 1], [-34, 33, 33]],
  ["all negative", [-1, -1, -1], [-34, -33, -33]],
  // Normalize overflowing totals, retaining the existing finite geometry rule.
  ["overflow", Array(3).fill(1e308), [34, 33, 33]],
  ["subnormal", Array(3).fill(Number.MIN_VALUE), [34, 33, 33]],
];

describe("whole pie/ring percentage allocation", () => {
  for (const kind of ["pie", "doughnut"])
    for (const scope of ["group", "series"])
      for (const [name, values, expected] of cases)
        it(`${kind} ${scope} allocates ${name} without changing source data`, () => {
          const f = chartPercentFormatDeck({
              kind,
              scope,
              values,
              format: null,
              linked: null,
              source: "General",
              showValue: false,
            }),
            spec = P.getShapeChartSpec(f.shape),
            xml = P._internalPackageOf(f.p)
              .getPart(chartRoot(f.shape))
              .data.slice(),
            book = workbook(f.p, f.shape).data.slice();
          expect(labels(f.p, f.slide)).toEqual(expected.map((n) => `${n}%`));
          expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
          expect(
            P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
          ).toEqual(xml);
          expect(workbook(f.p, f.shape).data).toEqual(book);
        });

  for (const kind of ["pie", "doughnut"])
    for (const [format, linked, expected] of [
      ["0%", false, ["11%", "21%", "31%", "37%"]],
      ["General", false, ["11%", "21%", "31%", "37%"]],
      ["0.0%", true, ["11%", "21%", "31%", "37%"]],
      ["#0%", false, ["10%", "21%", "31%", "37%"]],
      ["00%", false, ["10%", "21%", "31%", "37%"]],
      ["#,##0%", false, ["10%", "21%", "31%", "37%"]],
      ["0% ", false, ["10% ", "21% ", "31% ", "37% "]],
      ["%0", false, ["%10", "%21", "%31", "%37"]],
      ["0.0%", false, ["10.5%", "20.9%", "31.4%", "37.2%"]],
      ['0"%"', false, ["0%", "0%", "0%", "0%"]],
    ])
      it(`${kind} distinguishes canonical percent from custom ${format}/${linked}`, () => {
        const f = chartPercentFormatDeck({
          kind,
          format,
          linked,
          showValue: false,
        });
        expect(labels(f.p, f.slide)).toEqual(expected);
      });

  for (const kind of ["pie", "doughnut"])
    for (const count of [101, 251])
      it(`${kind} allocates 100 integer units among ${count} positive slices`, () => {
        const f = chartPercentFormatDeck({
          kind,
          values: Array(count).fill(1),
          format: null,
          linked: null,
          showValue: false,
        });
        const painted = labels(f.p, f.slide).map((s) => Number(s.slice(0, -1)));
        expect(painted).toHaveLength(count);
        expect(painted.reduce((a, b) => a + b, 0)).toBe(100);
        expect(painted).toEqual(
          count === 101
            ? [0, ...Array(100).fill(1)]
            : [...Array(100).fill(1), ...Array(count - 100).fill(0)],
        );
      });

  it("allocates each editable doughnut ring independently", async () => {
    const f = chartPercentFormatDeck({
        kind: "doughnut",
        format: null,
        linked: null,
        source: "General",
        showValue: false,
        categories: ["A", "B", "C", "D"],
        series: [
          { name: "Inner", values: [1, 1, 1, null] },
          { name: "Outer", values: [1, 1, 1, 3] },
        ],
      }),
      spec = P.getShapeChartSpec(f.shape),
      book = workbook(f.p, f.shape).data.slice();
    expect(labels(f.p, f.slide)).toEqual([
      "34%",
      "33%",
      "33%",
      "16%",
      "17%",
      "17%",
      "50%",
    ]);
    const destination = createDeck("blank"),
      target = P.getSlides(destination)[0];
    const imported = P.importSlide(
      destination,
      f.slide,
      P.getSlideLayout(target),
      { preservePaintFormatting: true, preserveTextFormatting: true },
    );
    const copied = P.copyShape(target, P.getSlideCharts(imported)[0].shape);
    const back = P.importSlide(f.p, target, P.getSlideLayout(f.slide), {
      preservePaintFormatting: true,
      preserveTextFormatting: true,
    });
    const returned = P.copyShape(f.slide, P.getSlideCharts(back)[0].shape);
    expect(labels(f.p, f.slide)).toEqual([
      ...labels(destination, imported),
      ...labels(destination, imported),
    ]);
    expect(P.getShapeChartSpec(returned)).toEqual(spec);
    expect(chartRoot(returned)).not.toBe(chartRoot(f.shape));
    expect(workbook(f.p, returned).data).toEqual(book);
    const loaded = await P.loadPresentation(await P.savePresentation(f.p));
    expect(labels(loaded, P.getSlides(loaded)[0])).toEqual(
      labels(f.p, f.slide),
    );
    expect(P.validatePresentation(loaded)).toEqual([]);
  });
});
