import { describe, expect, it } from "vitest";
import { P, createDeck, parseDeck, preview } from "../src/model.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import { chartXmlWhitespaceDeck } from "./xml-whitespace-fixture.js";

const chartOf = (p) => P.getSlideCharts(P.getSlides(p)[0])[0];
const expectLabels = (chart, fixture) => {
  expect(chart.spec.series.map((s) => s.name)).toEqual(fixture.names);
  expect(chart.spec.categories).toEqual(fixture.categories);
};

describe("physical XML line endings in editable chart caches", () => {
  for (const newline of ["\n", "\r\n", "\r"]) {
    it(`${JSON.stringify(newline)} reads logical names without rewriting untouched chart/workbook parts`, async () => {
      const f = await chartXmlWhitespaceDeck(newline),
        p = await parseDeck(f.bytes),
        chart = chartOf(p),
        raw = P._internalPackageOf(p)
          .getPart(chartRoot(chart.shape))
          .data.slice(),
        book = workbook(p, chart.shape).data.slice(),
        svg = preview(p, P.getSlides(p)[0]);
      expectLabels(chart, f);
      const q = await parseDeck(await P.savePresentation(p)),
        restored = chartOf(q);
      expectLabels(restored, f);
      expect(
        P._internalPackageOf(q).getPart(chartRoot(restored.shape)).data,
      ).toEqual(raw);
      expect(workbook(q, restored.shape).data).toEqual(book);
      expect(preview(q, P.getSlides(q)[0])).toBe(svg);
      expect(P.validatePresentation(q)).toEqual([]);
    });

    it(`${JSON.stringify(newline)} survives transfer both ways with independent data edits`, async () => {
      const f = await chartXmlWhitespaceDeck(newline),
        p = await parseDeck(f.bytes),
        original = chartOf(p),
        book = workbook(p, original.shape).data.slice(),
        dest = createDeck("blank"),
        copiedSlide = P.importSlide(
          dest,
          P.getSlides(p)[0],
          P.getSlideLayouts(dest)[0],
        ),
        copied = P.getSlideCharts(copiedSlide)[0];
      expectLabels(copied, f);
      P.setChartSpec(copied, {
        ...copied.spec,
        series: copied.spec.series.map((s, i) =>
          i ? s : { ...s, values: [6, 1] },
        ),
      });
      expect(workbook(p, original.shape).data).toEqual(book);
      expect(original.spec.series[0].values).toEqual([2, 4]);
      expectLabels(P.getSlideCharts(copiedSlide)[0], f);
      P.importSlide(p, copiedSlide, P.getSlideLayouts(p)[0]);
      const q = await parseDeck(await P.savePresentation(p)),
        charts = P.getSlides(q).map((s) => P.getSlideCharts(s)[0]);
      for (const chart of charts) expectLabels(chart, f);
      expect(charts.map((c) => c.spec.series[0].values)).toEqual([
        [2, 4],
        [6, 1],
      ]);
      expect(new Set(charts.map((c) => workbook(q, c.shape).name)).size).toBe(
        2,
      );
      expect(workbook(q, charts[0].shape).data).toEqual(book);
      expect(workbook(q, charts[1].shape).data).not.toEqual(book);
      expect(P.validatePresentation(q)).toEqual([]);
    });

    it(`${JSON.stringify(newline)} does not rewrite workbook cells during an appearance-only edit`, async () => {
      const f = await chartXmlWhitespaceDeck(newline),
        p = await parseDeck(f.bytes),
        chart = chartOf(p),
        book = workbook(p, chart.shape).data.slice();
      P.setChartSpec(chart, {
        ...chart.spec,
        legend: { ...chart.spec.legend, position: "l" },
      });
      const q = await parseDeck(await P.savePresentation(p)),
        changed = chartOf(q);
      expectLabels(changed, f);
      expect(changed.spec.legend.position).toBe("l");
      expect(workbook(q, changed.shape).data).toEqual(book);
      expect(P.validatePresentation(q)).toEqual([]);
    });
  }
});
