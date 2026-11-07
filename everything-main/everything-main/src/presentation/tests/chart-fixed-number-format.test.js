import { describe, expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import {
  chartFixedNumberDeck,
  chartFixedNumberPair,
  fixedNumberFormats,
  fixedNumberAxisMaximums,
} from "./chart-fixed-number-fixture.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";

function labels(f, color) {
  const result = [];
  walkElements(parseXml(renderSlideToSvg(f.p, f.slide)).root, (e) => {
    if (
      e.name.localName === "text" &&
      (!color || getAttrValue(e, qname("", "fill", "")) === color)
    )
      result.push(
        e.children
          .filter((c) => c.kind === "text")
          .map((c) => c.data)
          .join(""),
      );
  });
  return result;
}

describe("native fixed-number chart formats", () => {
  it.each(["radar", "column", "bar", "line", "area", "pie", "doughnut"])(
    "%s encodes format literals as SVG text",
    (kind) => {
      const f = chartFixedNumberDeck({ kind, format: '#,##0.00"<&>"' });
      const svg = renderSlideToSvg(f.p, f.slide);
      expect(svg).not.toContain("<&>");
      expect(svg).toContain("&lt;&amp;&gt;");
      if (kind === "radar")
        expect(labels(f, "#2468AC")).toContain("-20,000.00<&>");
      expect(labels(f, "#AF2568")).toEqual([
        "-12,345.60<&>",
        "0.00<&>",
        "12,345.60<&>",
        "17,500.00<&>",
      ]);
      expect(P.getShapeChartSpec(f.shape).dataLabels.numberFormat).toBe(
        '#,##0.00"<&>"',
      );
    },
  );
  it.each(["radar", "column", "pie"])(
    "%s resolves a native omitted-numFmt pair before and after save",
    async (kind) => {
      const f = chartFixedNumberPair(kind, false, true);
      for (const deck of [
        f.p,
        await P.loadPresentation(await P.savePresentation(f.p)),
      ]) {
        const slide = P.getSlides(deck)[0],
          charts = P.getSlideCharts(slide);
        expect(charts).toHaveLength(2);
        for (const chart of charts) {
          expect(chart.spec.dataLabels.numberFormat).toBeUndefined();
          expect(
            chart.spec.dataLabels.numberFormatSourceLinked,
          ).toBeUndefined();
        }
        expect(labels({ p: deck, slide }, "#AF2568")).toContain("12345.60");
        expect(labels({ p: deck, slide }, "#AF2568")).toContain("12,345.60");
        const rendered = labels(
          { p: deck, slide },
          kind === "radar" ? "#2468AC" : "#AF2568",
        );
        expect(rendered).toContain(kind === "radar" ? "20000.00" : "12345.60");
        expect(rendered).toContain(
          kind === "radar" ? "20,000.00" : "12,345.60",
        );
        expect(P.validatePresentation(deck)).toEqual([]);
      }
    },
  );
  for (const kind of ["column", "bar", "line", "area", "pie", "doughnut"])
    for (const [source, expected] of [
      ["0.00", "12345.60"],
      ["#,##0.00", "12,345.60"],
    ])
      it(`${kind} defaults omitted data-label numFmt to source ${source}`, async () => {
        const f = chartFixedNumberDeck({ kind, format: source });
        const spec = P.getShapeChartSpec(f.shape);
        delete spec.dataLabels.numberFormat;
        delete spec.dataLabels.numberFormatSourceLinked;
        P.setChartSpec({ shape: f.shape, spec }, spec);
        const book = workbook(f.p, f.shape).data.slice();
        expect(labels(f, "#AF2568")).toContain(expected);
        const saved = await P.loadPresentation(await P.savePresentation(f.p));
        expect(
          labels({ p: saved, slide: P.getSlides(saved)[0] }, "#AF2568"),
        ).toContain(expected);
        expect(
          workbook(saved, P.getSlideCharts(P.getSlides(saved)[0])[0].shape)
            .data,
        ).toEqual(book);
      });
  for (const [index, [format, ...expected]] of fixedNumberFormats.entries())
    for (const kind of [
      "radar",
      "column",
      "bar",
      "line",
      "area",
      "pie",
      "doughnut",
    ])
      it(`${kind} applies ${JSON.stringify(format)} to labels without changing source numbers`, () => {
        const f = chartFixedNumberDeck({ kind, format });
        const before = P.getShapeChartSpec(f.shape),
          book = workbook(f.p, f.shape).data.slice();
        expect(labels(f, "#AF2568")).toEqual(expected);
        if (!["pie", "doughnut"].includes(kind)) {
          const axis = labels(f, "#2468AC");
          expect(axis).toHaveLength(5);
          expect(axis).toContain(expected[1]);
          expect(axis).toContain(fixedNumberAxisMaximums[index]);
          expect(axis).toContain(`-${fixedNumberAxisMaximums[index]}`);
        } else {
          for (const value of expected) expect(labels(f)).toContain(value);
        }
        expect(P.getShapeChartSpec(f.shape)).toEqual(before);
        expect(workbook(f.p, f.shape).data).toEqual(book);
      });

  for (const kind of ["radar", "column", "pie"])
    for (const [format, source, expected] of [
      ["0.00", "#,##0.00", "12,345.60"],
      ["#,##0.00", "0.00", "12345.60"],
    ])
      it(`${kind} resolves linked ${format} from ${source} through transfer and export`, async () => {
        const f = chartFixedNumberDeck({ kind, format, linked: true, source });
        const before = P.getShapeChartSpec(f.shape),
          book = workbook(f.p, f.shape).data.slice();
        const sourceXml = P._internalPackageOf(f.p)
          .getPart(chartRoot(f.shape))
          .data.slice();
        const check = (p, slide) => {
          const chart = P.getSlideCharts(slide)[0];
          expect(chart.spec).toEqual(before);
          expect(workbook(p, chart.shape).data).toEqual(book);
          if (kind === "radar")
            expect(labels({ p, slide }, "#2468AC")).toContain(
              source === "0.00" ? "20000.00" : "20,000.00",
            );
          expect(labels({ p, slide }, "#AF2568")).toContain(expected);
          expect(P.validatePresentation(p)).toEqual([]);
        };
        const q = createDeck("blank"),
          imported = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0], {
            preservePaintFormatting: true,
            preserveTextFormatting: true,
          });
        check(q, imported);
        const copy = P.copyShape(imported, P.getSlideCharts(imported)[0].shape);
        expect(P.getShapeChartSpec(copy)).toEqual(before);
        expect(workbook(q, copy).data).toEqual(book);
        P.removeShape(copy);
        const saved = await P.loadPresentation(await P.savePresentation(q));
        check(saved, P.getSlides(saved).at(-1));
        const back = P.importSlide(
          f.p,
          P.getSlides(saved).at(-1),
          P.getSlideLayout(f.slide),
          { preservePaintFormatting: true, preserveTextFormatting: true },
        );
        check(f.p, back);
        expect(
          P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
        ).toEqual(sourceXml);
        expect(workbook(f.p, f.shape).data).toEqual(book);
      });
});
