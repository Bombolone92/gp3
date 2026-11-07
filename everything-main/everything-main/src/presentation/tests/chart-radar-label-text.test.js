import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  chartRadarLabelDeck,
  radarCategories,
  radarLabelColor,
} from "./chart-radar-label-fixture.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

function labels(p, slide) {
  const result = [];
  walkElements(
    parseXml(
      decodeURIComponent(preview(p, slide).split(",").slice(1).join(",")),
    ).root,
    (e) => {
      if (
        e.name.localName === "text" &&
        getAttrValue(e, qname("", "fill", "")) === radarLabelColor
      )
        result.push(
          e.children
            .filter((n) => n.kind === "text")
            .map((n) => n.data)
            .join(""),
        );
    },
  );
  return result;
}

describe("radar category text preserves the complete cached strings", () => {
  for (const radarStyle of ["standard", "marker", "filled"])
    for (const [font, sizePt] of [
      ["Arial", 12],
      ["Georgia", 18],
    ])
      for (const categories of [
        [
          "Quarterly revenue",
          "Operating income",
          "Investment return",
          "Customer support",
        ],
        radarCategories,
        [...radarCategories.slice(1), radarCategories[0]],
        ["First", "Second", "Third", "Cost …"],
      ])
        it(`${radarStyle} ${font} ${sizePt}pt preserves ${categories[0]} through transfer and export`, async () => {
          const f = chartRadarLabelDeck({
              radarStyle,
              categories,
              categoryAxisLabelStyle: { font, sizePt, color: radarLabelColor },
            }),
            spec = P.getShapeChartSpec(f.shape),
            chart = P._internalPackageOf(f.p)
              .getPart(chartRoot(f.shape))
              .data.slice(),
            book = workbook(f.p, f.shape).data.slice();
          expect(labels(f.p, f.slide)).toEqual(categories);
          expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
          expect(
            P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
          ).toEqual(chart);
          expect(workbook(f.p, f.shape).data).toEqual(book);
          const target = createDeck("blank"),
            slide = P.importSlide(
              target,
              f.slide,
              P.getSlideLayouts(target)[0],
              {
                preservePaintFormatting: true,
                preserveTextFormatting: true,
              },
            ),
            copied = P.getSlideCharts(slide)[0];
          expect(copied.spec).toEqual(spec);
          expect(labels(target, slide)).toEqual(categories);
          expect(workbook(target, copied.shape).data).toEqual(book);
          const round = await P.loadPresentation(
              await P.savePresentation(target),
            ),
            reloaded = P.getSlides(round).at(-1),
            saved = P.getSlideCharts(reloaded)[0];
          expect(saved.spec).toEqual(spec);
          expect(labels(round, reloaded)).toEqual(categories);
          expect(preview(round, reloaded)).toBe(preview(target, slide));
          expect(workbook(round, saved.shape).data).toEqual(book);
          expect(P.validatePresentation(round)).toEqual([]);
        });
});
