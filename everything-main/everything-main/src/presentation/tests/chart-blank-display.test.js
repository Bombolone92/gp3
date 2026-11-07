import { describe, expect, it } from "vitest";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { P, createDeck, preview } from "../src/model.js";
import {
  chartStackedBlanksDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
  getAttrValue,
  walkElements,
  allChildElements,
} from "../lib/pptx/src/internal/xml/index.ts";
import {
  chartBlankDisplay,
  readChartBlankDisplays,
} from "../lib/pptx/src/internal/chartml/blank-display.ts";
import { chartRenderingView } from "../lib/pptx/src/api/fn/charts.ts";

const child = (e, n) => firstChildElement(e, qname("c", n, NS.chart)),
  attr = (e, n) => getAttrValue(e, qname("", n, "")),
  colors = ["#E85239", "#2F8541", "#376CA8"];
function document(f, mutate) {
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data));
  mutate(doc.root);
  part.data = new TextEncoder().encode(serializeXml(doc));
}
function plot(f) {
  const svg = decodeURIComponent(
      preview(f.p, f.slide).split(",").slice(1).join(","),
    ),
    markers = [],
    paths = [];
  walkElements(parseXml(svg).root, (e) => {
    if (e.name.localName === "circle" && colors.includes(attr(e, "fill")))
      markers.push(e);
    if (e.name.localName === "path" && colors.includes(attr(e, "stroke")))
      paths.push(e);
  });
  return { svg, markers, paths };
}

describe("native plot capabilities resolve blank display without changing data", () => {
  for (const [name, grouping, allowed, fallback] of [
    ["lineChart", "standard", ["gap", "span", "zero"], "gap"],
    ["lineChart", "stacked", ["zero"], "zero"],
    ["lineChart", "percentStacked", ["zero"], "zero"],
    ["areaChart", "standard", ["gap", "zero"], "gap"],
    ["areaChart", "stacked", ["zero"], "zero"],
    ["areaChart", "percentStacked", ["zero"], "zero"],
    ["line3DChart", "stacked", ["gap", "zero"], "gap"],
    ["area3DChart", "standard", ["zero"], "zero"],
    ["barChart", "clustered", ["gap", "zero"], "gap"],
    ["pieChart", undefined, ["gap", "zero"], "gap"],
    ["scatterChart", undefined, ["gap", "span", "zero"], "gap"],
    ["radarChart", undefined, ["gap", "span", "zero"], "gap"],
  ])
    it(`${name} ${grouping} distinguishes the schema default from unsupported-method fallback`, () => {
      const root = parseXml(
        `<c:${name} xmlns:c="${NS.chart}">${grouping ? `<c:grouping val="${grouping}"/>` : ""}</c:${name}>`,
      ).root;
      for (const requested of [
        "gap",
        "span",
        "zero",
        undefined,
        null,
        "future",
      ])
        expect(chartBlankDisplay(root, requested)).toBe(
          requested == null || (name === "areaChart" && requested === "span")
            ? "zero"
            : allowed.includes(requested)
              ? requested
              : fallback,
        );
    });
  for (const kind of ["line", "area"])
    for (const grouping of ["stacked", "percentStacked"])
      for (const dispBlanksAs of ["gap", "span", undefined])
        it(`${kind} ${grouping} ${dispBlanksAs} renders the same projected zeros as zero mode and preserves blanks`, () => {
          // The authoring API writes its default gap; exercise native omission
          // by removing the element rather than treating that default as absent.
          const f = chartStackedBlanksDeck({ kind, grouping, dispBlanksAs }),
            zero = chartStackedBlanksDeck({
              kind,
              grouping,
              dispBlanksAs: "zero",
            });
          if (dispBlanksAs === undefined)
            document(f, (root) => {
              const chart = child(root, "chart");
              chart.children = chart.children.filter(
                (e) => e !== child(chart, "dispBlanksAs"),
              );
            });
          const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
            bytes = part.data.slice(),
            book = workbook(f.p, f.shape).data.slice(),
            raw = P.getShapeChartSpec(f.shape);
          expect(plot(f).svg).toBe(plot(zero).svg);
          expect(plot(f).svg).not.toMatch(/NaN|Infinity/);
          expect(
            chartRenderingView(f.shape).seriesDisplays.map((d) => d.blank),
          ).toEqual(["zero", "zero", "zero"]);
          expect(P.getShapeChartSpec(f.shape)).toEqual(raw);
          expect(raw.dispBlanksAs).toBe(dispBlanksAs);
          expect(raw.series.every((s) => s.values[1] === null)).toBe(true);
          expect(part.data).toEqual(bytes);
          expect(workbook(f.p, f.shape).data).toEqual(book);
          if (kind === "line") expect(plot(f).markers).toHaveLength(9);
        });
  for (const grouping of ["standard", "clustered", undefined])
    it(`unstacked ${grouping} retains gap/span and marks only finite points`, () => {
      const gap = chartStackedBlanksDeck({ grouping, dispBlanksAs: "gap" }),
        span = chartStackedBlanksDeck({ grouping, dispBlanksAs: "span" });
      expect(plot(gap).markers).toHaveLength(6);
      expect(plot(span).markers).toHaveLength(6);
      for (const p of plot(gap).paths)
        expect(attr(p, "d").match(/M/g)).toHaveLength(2);
      for (const p of plot(span).paths)
        expect(attr(p, "d").match(/M/g)).toHaveLength(1);
    });
  for (const kind of ["line", "area"])
    for (const grouping of ["stacked", "percentStacked"])
      it(`${kind} ${grouping} projects native #N/A caches at zero while preserving error cells`, async () => {
        // Native stacked plots use zero vertices for #N/A too. Preserve
        // the native error values, even though the numeric model reads null.
        for (const dispBlanksAs of ["gap", "span", "zero"]) {
          const f = chartStackedBlanksDeck({ kind, grouping, dispBlanksAs }),
            blank = chartStackedBlanksDeck({ kind, grouping, dispBlanksAs });
          document(f, (root) => {
            walkElements(root, (e) => {
              if (
                e.name.namespaceURI === NS.chart &&
                e.name.localName === "numCache"
              )
                e.children.push(
                  parseXml(
                    `<c:pt xmlns:c="${NS.chart}" idx="1"><c:v>#N/A</c:v></c:pt>`,
                  ).root,
                );
            });
          });
          const book = workbook(f.p, f.shape),
            entries = unzipSync(book.data),
            sheet = parseXml(strFromU8(entries["xl/worksheets/sheet1.xml"])),
            s = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
          walkElements(sheet.root, (e) => {
            if (
              e.name.namespaceURI !== s ||
              e.name.localName !== "row" ||
              attr(e, "r") !== "3"
            )
              return;
            e.children = e.children.filter(
              (c) =>
                c.kind !== "element" ||
                !["B3", "C3", "D3"].includes(attr(c, "r")),
            );
            for (const r of ["B3", "C3", "D3"])
              e.children.push(
                parseXml(`<c xmlns="${s}" r="${r}" t="e"><v>#N/A</v></c>`).root,
              );
            expect(allChildElements(e, qname("", "c", s))).toHaveLength(4);
          });
          entries["xl/worksheets/sheet1.xml"] = strToU8(serializeXml(sheet));
          book.data = zipSync(entries);
          const bytes = P._internalPackageOf(f.p)
              .getPart(chartRoot(f.shape))
              .data.slice(),
            bookBytes = book.data.slice();
          expect(plot(f).svg).toBe(plot(blank).svg);
          expect(
            P.getShapeChartSpec(f.shape).series.every(
              (series) => series.values[1] === null,
            ),
          ).toBe(true);
          const p = await P.loadPresentation(await P.savePresentation(f.p)),
            slide = P.getSlides(p)[0],
            chart = P.getSlideCharts(slide)[0];
          expect(plot({ p, slide }).svg).toBe(plot(blank).svg);
          expect(
            P._internalPackageOf(p).getPart(chartRoot(chart.shape)).data,
          ).toEqual(bytes);
          expect(workbook(p, chart.shape).data).toEqual(bookBytes);
          expect(P.validatePresentation(p)).toEqual([]);
        }
      });
  it("native 3D line gaps retain their capability after projection to the line model", () => {
    const f = chartStackedBlanksDeck({ dispBlanksAs: "span" });
    document(f, (root) => {
      const group = child(child(child(root, "chart"), "plotArea"), "lineChart");
      group.name = qname("c", "line3DChart", NS.chart);
    });
    expect(
      chartRenderingView(f.shape).seriesDisplays.map((d) => d.blank),
    ).toEqual(["gap", "gap", "gap"]);
    expect(plot(f).markers).toHaveLength(6);
    for (const p of plot(f).paths)
      expect(attr(p, "d").match(/M/g)).toHaveLength(2);
  });
  it("plot types absent from the capability table retain their represented method", () => {
    const f = chartStackedBlanksDeck({
      grouping: "standard",
      dispBlanksAs: "span",
    });
    document(f, (root) => {
      const group = child(child(child(root, "chart"), "plotArea"), "lineChart");
      group.name = qname("c", "stockChart", NS.chart);
    });
    expect(
      chartRenderingView(f.shape).seriesDisplays.map((d) => d.blank),
    ).toEqual(["span", "span", "span"]);
    for (const p of plot(f).paths)
      expect(attr(p, "d").match(/M/g)).toHaveLength(1);
  });
  it("mixed native groups use their own grouping and ignore foreign lookalikes", () => {
    const root = parseXml(
      `<c:chartSpace xmlns:c="${NS.chart}" xmlns:f="urn:foreign"><c:chart><c:plotArea><f:lineChart><c:ser/></f:lineChart><c:barChart><c:grouping val="stacked"/><c:ser/></c:barChart><c:lineChart><c:grouping val="standard"/><c:ser/><c:ser/></c:lineChart><c:areaChart><c:grouping val="stacked"/><c:ser/></c:areaChart></c:plotArea><c:dispBlanksAs val="span"/></c:chart></c:chartSpace>`,
    ).root;
    expect(readChartBlankDisplays(root)).toEqual([
      "gap",
      "span",
      "span",
      "zero",
    ]);
  });
  for (const kind of ["line", "column"])
    it(`${kind} primary and unstacked secondary line plots retain their own blank capabilities during renderer regrouping`, () => {
      const f = chartStackedBlanksDeck({ kind }),
        chart = P.getSlideCharts(f.slide)[0];
      P.setChartSpec(chart, {
        ...chart.spec,
        series: chart.spec.series.map((s, i) => ({
          ...s,
          ...(i === 1
            ? { chartKind: "line", secondaryAxis: true, markerSymbol: "circle" }
            : {}),
        })),
      });
      document(f, (root) => {
        const area = child(child(root, "chart"), "plotArea"),
          lines = area.children.filter(
            (e) => e.kind === "element" && e.name.localName === "lineChart",
          ),
          secondary = lines.at(-1);
        child(secondary, "grouping").attrs[0].value = "standard";
      });
      const r = plot(f),
        view = chartRenderingView(f.shape);
      expect(view.seriesDisplays.map((d) => d.blank)).toEqual(
        kind === "line" ? ["zero", "zero", "gap"] : ["gap", "gap", "gap"],
      );
      expect(r.markers).toHaveLength(kind === "line" ? 8 : 2);
      expect(
        r.markers.filter((e) => attr(e, "fill") === colors[1]),
      ).toHaveLength(2);
      expect(P.getShapeChartSpec(f.shape).dispBlanksAs).toBe("gap");
      expect(
        P.getShapeChartSpec(f.shape).series.every((s) => s.values[1] === null),
      ).toBe(true);
    });
  it("leading/trailing/all-blank categories remain blank in data and project finite zero vertices", () => {
    const f = chartStackedBlanksDeck(),
      chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, {
      ...chart.spec,
      categories: ["A", "B", "C", "D"],
      series: chart.spec.series.map((s, i) => ({
        ...s,
        values: i ? [null, null, null, null] : [null, 2, 0, null],
      })),
    });
    const r = plot(f);
    expect(r.markers).toHaveLength(12);
    expect(r.svg).not.toMatch(/NaN|Infinity/);
    expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([
      null,
      2,
      0,
      null,
    ]);
    const first = r.markers.filter((e) => attr(e, "fill") === colors[0]);
    expect(attr(first[0], "cy")).toBe(attr(first[2], "cy"));
    expect(attr(first[2], "cy")).toBe(attr(first[3], "cy"));
  });
  it("untouched native save and both-way transfer preserve raw mode, data, workbook and independent copied edits", async () => {
    const f = chartStackedBlanksDeck(),
      q = createDeck("blank"),
      before = P._internalPackageOf(f.p)
        .getPart(chartRoot(f.shape))
        .data.slice(),
      book = workbook(f.p, f.shape).data.slice(),
      to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      back = P.importSlide(f.p, to, P.getSlideLayout(f.slide)),
      chart = P.getSlideCharts(back)[0];
    P.setChartSpec(chart, {
      ...chart.spec,
      grouping: "percentStacked",
      dispBlanksAs: "span",
      series: chart.spec.series.map((s) => ({
        ...s,
        values: s.values.map((v) => (v === null ? null : v + 1)),
      })),
    });
    const p = await P.loadPresentation(await P.savePresentation(f.p));
    for (const [i, slide] of P.getSlides(p).entries()) {
      const c = P.getSlideCharts(slide)[0];
      expect(c.spec.dispBlanksAs).toBe(i ? "span" : "gap");
      expect(c.spec.series.every((s) => s.values[1] === null)).toBe(true);
      expect(plot({ p, slide }).markers).toHaveLength(9);
      if (i === 0) {
        expect(
          P._internalPackageOf(p).getPart(chartRoot(c.shape)).data,
        ).toEqual(before);
        expect(workbook(p, c.shape).data).toEqual(book);
      }
    }
    expect(
      workbook(p, P.getSlideCharts(P.getSlides(p)[0])[0].shape).name,
    ).not.toBe(workbook(p, P.getSlideCharts(P.getSlides(p)[1])[0].shape).name);
    expect(P.validatePresentation(p)).toEqual([]);
  });
});
