import { describe, expect, it } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  NS,
  parseXml,
  serializeXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  chartPercentFormatDeck,
  percentLabelColor,
} from "./chart-percent-format-fixture.js";
import { withRadarPointLabels } from "./chart-radar-data-label-fixture.js";

const kinds = ["radar", "column", "bar", "line", "area", "pie", "doughnut"];
const sourceValues = ["2.2500 src", "4.5000 src", "6.7500 src", "8.0000 src"];
function labels(p, slide, color = percentLabelColor) {
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
const strings = (f, color) => labels(f.p, f.slide, color);
function editLabels(f, edit) {
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data));
  walkElements(doc.root, (e) => {
    if (e.name.namespaceURI === NS.chart && e.name.localName === "dLbls")
      edit(e);
  });
  part.data = new TextEncoder().encode(serializeXml(doc));
}

// Namespace prefixes and workbook relationship IDs may change during transfer.
// Compare every native data-label node/attribute/text by expanded XML name.
function labelRecords(p, shape) {
  const result = [];
  const canonical = (e) =>
    e.kind === "text"
      ? e.data
      : e.kind !== "element"
        ? null
        : {
            name: [e.name.namespaceURI, e.name.localName],
            attrs: e.attrs
              .filter(
                (a) => a.name.namespaceURI !== "http://www.w3.org/2000/xmlns/",
              )
              .map((a) => [a.name.namespaceURI, a.name.localName, a.value])
              .sort(),
            children: e.children.map(canonical),
          };
  walkElements(
    parseXml(
      new TextDecoder().decode(
        P._internalPackageOf(p).getPart(chartRoot(shape)).data,
      ),
    ).root,
    (e) => {
      if (e.name.namespaceURI === NS.chart && e.name.localName === "dLbls")
        result.push(canonical(e));
    },
  );
  return result;
}

describe("native data-label percentage format routing", () => {
  for (const kind of kinds)
    for (const scope of ["group", "series"])
      for (const showPercent of [false, true])
        it(`${kind} ${scope} routes the value format with showPercent=${showPercent}`, () => {
          const f = chartPercentFormatDeck({ kind, scope, showPercent }),
            spec = P.getShapeChartSpec(f.shape),
            xml = P._internalPackageOf(f.p)
              .getPart(chartRoot(f.shape))
              .data.slice(),
            book = workbook(f.p, f.shape).data.slice(),
            circular = kind === "pie" || kind === "doughnut";
          expect(strings(f)).toEqual(
            showPercent
              ? sourceValues.map((v, i) =>
                  circular
                    ? `${v} | ${["0.10", "0.21", "0.31", "0.37"][i]} units`
                    : v,
                )
              : ["2.25 units", "4.50 units", "6.75 units", "8.00 units"],
          );
          expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
          expect(
            P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
          ).toEqual(xml);
          expect(workbook(f.p, f.shape).data).toEqual(book);
        });

  for (const kind of ["pie", "doughnut"])
    for (const scope of ["group", "series"])
      for (const source of ["General", '0.0000" src"'])
        for (const [format, linked, expected] of [
          [null, null, ["11%", "21%", "31%", "37%"]],
          ["General", false, ["11%", "21%", "31%", "37%"]],
          ["0.0%", false, ["10.5%", "20.9%", "31.4%", "37.2%"]],
          ["0.0%", true, ["11%", "21%", "31%", "37%"]],
          [
            '0.00" units"',
            false,
            ["0.10 units", "0.21 units", "0.31 units", "0.37 units"],
          ],
          ['0.00" units"', true, ["11%", "21%", "31%", "37%"]],
        ])
          it(`${kind} ${scope} resolves percentage ${format}/${linked} independently of source ${source}`, () => {
            const f = chartPercentFormatDeck({
                kind,
                scope,
                format,
                linked,
                source,
              }),
              values =
                source === "General"
                  ? ["2.25", "4.5", "6.75", "8"]
                  : sourceValues;
            expect(strings(f)).toEqual(
              values.map((v, i) => `${v} | ${expected[i]}`),
            );
          });

  for (const kind of ["pie", "doughnut"])
    for (const scope of ["group", "series"])
      it(`${kind} ${scope} honors ISO implicit source links without changing the authored format`, () => {
        const f = chartPercentFormatDeck({ kind, scope, format: "0.0%" });
        editLabels(f, (e) => {
          for (const c of e.children)
            if (c.kind === "element" && c.name.localName === "numFmt")
              c.attrs = c.attrs.filter(
                (a) => a.name.localName !== "sourceLinked",
              );
        });
        expect(strings(f)).toEqual(
          sourceValues.map((v, i) => `${v} | ${[11, 21, 31, 37][i]}%`),
        );
        const spec = P.getShapeChartSpec(f.shape);
        expect(
          (scope === "series" ? spec.series[0] : spec).dataLabels
            .numberFormatSourceLinked,
        ).toBe(true);
      });

  for (const kind of ["pie", "doughnut"])
    for (const [values, expected] of [
      [
        [-2.25, 4.5, 6.75, 8],
        ["-2.25 | -10.5%", "4.5 | 20.9%", "6.75 | 31.4%", "8 | 37.2%"],
      ],
      [[0, 0, 0, 0], Array(4).fill("0 | 0.0%")],
      [
        [-2.25, 0, null, 6.75],
        ["-2.25 | -25.0%", "0 | 0.0%", "6.75 | 75.0%"],
      ],
      // Preserve finite normalized totals even when naive native summation
      // overflows. Do not reproduce erroneous native zero percentages.
      [[1e308, 1e308, 1e308, 1e308], Array(4).fill("1e+308 | 25.0%")],
    ])
      it(`${kind} formats signed/zero/null/extreme fractions ${JSON.stringify(values)}`, () => {
        const f = chartPercentFormatDeck({
          kind,
          values,
          source: "General",
          format: "0.0%",
        });
        expect(strings(f)).toEqual(expected);
        expect(preview(f.p, f.slide)).not.toMatch(/NaN|Infinity/);
      });

  for (const kind of ["pie", "doughnut"])
    it(`${kind} formats percentage-only labels and escapes literal XML`, () => {
      const f = chartPercentFormatDeck({
        kind,
        showValue: false,
        format: '0.00"<&>"',
      });
      expect(strings(f)).toEqual(["0.10<&>", "0.21<&>", "0.31<&>", "0.37<&>"]);
      expect(decodeURIComponent(preview(f.p, f.slide))).toContain(
        "&lt;&amp;&gt;",
      );
    });

  for (const kind of kinds)
    it(`${kind} lets a series false percentage switch override the group true switch`, () => {
      const f = chartPercentFormatDeck({
        kind,
        scope: "series",
        showPercent: false,
      });
      const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
        doc = parseXml(new TextDecoder().decode(part.data));
      walkElements(doc.root, (e) => {
        if (
          e.name.namespaceURI === NS.chart &&
          e.name.localName ===
            `${kind === "column" || kind === "bar" ? "bar" : kind}Chart`
        ) {
          // CT_*Chart places dLbls immediately after the series records.
          const at =
            e.children.findLastIndex(
              (c) =>
                c.kind === "element" &&
                c.name.namespaceURI === NS.chart &&
                c.name.localName === "ser",
            ) + 1;
          e.children.splice(
            at,
            0,
            parseXml(
              `<c:dLbls xmlns:c="${NS.chart}"><c:numFmt formatCode="0.0%" sourceLinked="0"/><c:showVal val="1"/><c:showPercent val="1"/></c:dLbls>`,
            ).root,
          );
        }
      });
      part.data = new TextEncoder().encode(serializeXml(doc));
      expect(strings(f)).toEqual([
        "2.25 units",
        "4.50 units",
        "6.75 units",
        "8.00 units",
      ]);
    });

  for (const radarStyle of ["standard", "marker", "filled"])
    for (const showPercent of [false, true, undefined])
      it(`${radarStyle} point showPercent=${showPercent} selects its own source routing`, () => {
        const f = withRadarPointLabels(
          chartPercentFormatDeck({
            kind: "radar",
            scope: "series",
            showPercent: false,
            radarStyle,
          }),
          [
            {
              index: 2,
              xml:
                '<c:numFmt formatCode="0.00&quot; units&quot;" sourceLinked="0"/>' +
                '<c:txPr><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1200"><a:solidFill><a:srgbClr val="663399"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr></a:p></c:txPr>' +
                '<c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/>' +
                (showPercent === undefined
                  ? ""
                  : `<c:showPercent val="${showPercent ? 1 : 0}"/>`),
            },
          ],
        );
        expect(strings(f, "#663399")).toEqual([
          showPercent === false ? "6.75 units" : "6.7500 src",
        ]);
        expect(strings(f)).toEqual(["2.25 units", "4.50 units", "8.00 units"]);
      });

  for (const kind of kinds)
    it(`${kind} retains source and format semantics through editable transfer and export`, async () => {
      const f = chartPercentFormatDeck({ kind }),
        spec = P.getShapeChartSpec(f.shape),
        raw = labelRecords(f.p, f.shape),
        book = workbook(f.p, f.shape).data.slice(),
        expected = strings(f),
        q = createDeck("blank"),
        imported = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0], {
          preservePaintFormatting: true,
          preserveTextFormatting: true,
        });
      const copy = P.copyShape(imported, P.getSlideCharts(imported)[0].shape);
      expect(P.getShapeChartSpec(copy)).toEqual(spec);
      P.removeShape(copy);
      const saved = await P.loadPresentation(await P.savePresentation(q)),
        back = P.importSlide(
          f.p,
          P.getSlides(saved).at(-1),
          P.getSlideLayout(f.slide),
          { preservePaintFormatting: true, preserveTextFormatting: true },
        );
      for (const [p, slide] of [
        [q, imported],
        [saved, P.getSlides(saved).at(-1)],
        [f.p, back],
      ]) {
        const chart = P.getSlideCharts(slide)[0];
        expect(chart.spec).toEqual(spec);
        expect(labelRecords(p, chart.shape)).toEqual(raw);
        expect(workbook(p, chart.shape).data).toEqual(book);
        expect(labels(p, slide)).toEqual(expected);
        expect(P.validatePresentation(p)).toEqual([]);
      }
    });
});
