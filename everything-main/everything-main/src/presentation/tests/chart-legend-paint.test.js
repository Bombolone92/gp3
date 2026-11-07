import { canonicalSvgDefinitionIds } from "./svg-definition-ids.js";
import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import { renderSlideToSvg as renderWithSharedIds } from "../lib/pptx-preview/src/index.ts";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
  walkElements,
  getAttrValue,
} from "../lib/pptx/src/internal/xml/index.ts";
const child = (e, n, ns = NS.chart) => firstChildElement(e, qname("", n, ns));
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const kinds = ["bar", "column", "line", "area", "pie", "doughnut"];
const fill = "#ECD8B0",
  stroke = "#5438A8";
function fixture(kind = "column", legend = {}, extra = {}) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0],
    shape = P.addSlideChart(slide, {
      x: P.inches(1),
      y: P.inches(1),
      w: P.inches(7),
      h: P.inches(4),
      spec: {
        kind,
        categories: ["Alpha", "Beta", "Gamma"],
        series: [{ name: "Units", values: [4, 2, 7], color: "#23916F" }],
        legend: { position: "b", ...legend },
        ...extra,
      },
    });
  return {
    p,
    slide,
    shape,
    part: P._internalPackageOf(p).getPart(chartRoot(shape)),
  };
}
function edit(f, fn) {
  const doc = parseXml(new TextDecoder().decode(f.part.data));
  fn(doc.root, child(child(doc.root, "chart"), "legend"));
  f.part.data = new TextEncoder().encode(serializeXml(doc));
}
function native(f, contents) {
  edit(f, (_, legend) => {
    legend.children = legend.children.filter(
      (e) =>
        e.kind !== "element" ||
        e.name.namespaceURI !== NS.chart ||
        e.name.localName !== "spPr",
    );
    const index = legend.children.findIndex(
      (e) => e.kind === "element" && e.name.localName === "txPr",
    );
    legend.children.splice(
      index < 0 ? legend.children.length : index,
      0,
      parseXml(
        `<c:spPr xmlns:c="${NS.chart}" xmlns:a="${NS.dml}">${contents}</c:spPr>`,
      ).root,
    );
  });
}
function nodes(svg) {
  const out = [];
  walkElements(parseXml(svg).root, (e) => out.push(e));
  return out;
}
function rendered(f, options) {
  return nodes(renderSlideToSvg(f.p, f.slide, options));
}
function backdrop(elements, color = fill) {
  return elements.find(
    (e) =>
      e.name.localName === "rect" &&
      (attr(e, "fill") === color || attr(e, "stroke") === stroke),
  );
}
const paints = (spec) => [
  spec.legend?.fill,
  spec.legend?.strokeColor,
  spec.legend?.strokeWidthEmu,
];
const snapshot = (p) =>
  P._internalPackageOf(p).parts.map((part) => [part.name, part.data.slice()]);
const paintXml = (color) =>
  color === null
    ? "<a:noFill/>"
    : `<a:solidFill><a:srgbClr val="${color.slice(1)}"/></a:solidFill>`;

describe("native legend background and outline paint", () => {
  for (const kind of kinds)
    for (const [background, outline, width] of [
      [fill, stroke, 38100],
      [null, stroke, 1],
      [fill, null, 9525],
      [null, null, 0],
    ])
      it(`${kind} reads ${background}/${outline}/${width} independently and retains it through data edits and export`, async () => {
        const f = fixture(kind, {
          textStyle: { sizePt: 13, bold: true, color: "#112233" },
          overlay: true,
        });
        native(
          f,
          `${paintXml(background)}<a:ln w="${width}">${paintXml(outline)}</a:ln>`,
        );
        const before = f.part.data.slice(),
          spec = P.getShapeChartSpec(f.shape);
        expect(paints(spec)).toEqual([background, outline, width]);
        const r = rendered(f),
          box = backdrop(r);
        if (background === null && outline === null)
          expect(box).toBeUndefined();
        else {
          expect(attr(box, "fill")).toBe(background ?? "none");
          expect(attr(box, "stroke")).toBe(outline ?? "none");
          expect(Number(attr(box, "stroke-width"))).toBe(width / 9525);
        }
        expect(f.part.data).toEqual(before);
        P.setChartSpec(P.getSlideCharts(f.slide)[0], {
          ...spec,
          series: spec.series.map((s) => ({
            ...s,
            values: s.values.map((v) => v + 1),
          })),
        });
        const updated = P.getShapeChartSpec(f.shape);
        expect(updated.legend).toEqual(spec.legend);
        expect(updated.series[0].values).toEqual([5, 3, 8]);
        const sourceDoc = parseXml(new TextDecoder().decode(f.part.data)),
          legend = child(child(sourceDoc.root, "chart"), "legend"),
          sp = child(legend, "spPr");
        expect(attr(child(sp, "ln", NS.dml), "w")).toBe(String(width));
        expect(
          legend.children
            .filter((e) => e.kind === "element")
            .map((e) => e.name.localName),
        ).toEqual(["legendPos", "overlay", "spPr", "txPr"]);
        const saved = await P.loadPresentation(await P.savePresentation(f.p));
        expect(P.getSlideCharts(P.getSlides(saved)[0])[0].spec).toEqual(
          updated,
        );
        expect(P.validatePresentation(saved)).toEqual([]);
      });
  it.each(kinds)(
    "%s transfers independent legend paint both ways with distinct chart and workbook parts",
    async (kind) => {
      const f = fixture(kind, {
          fill: null,
          strokeColor: stroke,
          strokeWidthEmu: 0,
        }),
        original = f.part.data.slice(),
        q = createDeck("blank");
      const copiedSlide = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0], {
        preservePaintFormatting: true,
      });
      const copied = P.getSlideCharts(copiedSlide)[0];
      expect(paints(copied.spec)).toEqual([null, stroke, 0]);
      expect(workbook(q, copied.shape).data).toEqual(
        workbook(f.p, f.shape).data,
      );
      const saved = await P.loadPresentation(await P.savePresentation(q)),
        backSlide = P.importSlide(
          f.p,
          P.getSlides(saved).at(-1),
          P.getSlideLayout(f.slide),
          { preservePaintFormatting: true },
        ),
        back = P.getSlideCharts(backSlide)[0];
      expect(chartRoot(back.shape)).not.toBe(chartRoot(f.shape));
      expect(workbook(f.p, back.shape).name).not.toBe(
        workbook(f.p, f.shape).name,
      );
      P.setChartSpec(back, {
        ...back.spec,
        series: [{ ...back.spec.series[0], values: [19, 23, 29] }],
      });
      expect(paints(P.getShapeChartSpec(back.shape))).toEqual([
        null,
        stroke,
        0,
      ]);
      expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([4, 2, 7]);
      expect(f.part.data).toEqual(original);
      expect(P.validatePresentation(f.p)).toEqual([]);
    },
  );
  for (const position of ["b", "t", "l", "r", "tr"])
    it.each([false, true])(
      `${position} bounds follow visible keys and measured labels, overlay=%s`,
      (overlay) => {
        const legend = {
            position,
            overlay,
            fill,
            strokeColor: stroke,
            strokeWidthEmu: 9525,
            hiddenIndices: [0],
            textStyle: { font: "Owned Test Face", sizePt: 24 },
          },
          f = fixture("line", legend, {
            lineMarkers: true,
            series: [
              {
                name: "Hidden widest label",
                values: [1, 3, 5],
                markerSymbol: "circle",
              },
              {
                name: "Visible label",
                values: [2, 4, 6],
                markerSymbol: "circle",
              },
              { name: "Third", values: [3, 5, 7], markerSymbol: "circle" },
            ],
          });
        const r = rendered(f, {
            measureText: (text, font) => ({
              widthPx: text.length * font.sizePx * 0.5,
              ascentPx: font.sizePx * 0.8,
              descentPx: font.sizePx * 0.3,
            }),
          }),
          box = backdrop(r),
          left = Number(attr(box, "x")),
          top = Number(attr(box, "y")),
          right = left + Number(attr(box, "width")),
          bottom = top + Number(attr(box, "height"));
        expect(Number.isFinite(left + top + right + bottom)).toBe(true);
        expect(right).toBeGreaterThan(left);
        expect(bottom).toBeGreaterThan(top);
        const halfStroke = Number(attr(box, "stroke-width")) / 2;
        const keys = r.filter((e) => e.name.localName === "circle");
        expect(keys.length).toBeGreaterThanOrEqual(2);
        for (const key of keys.slice(-2)) {
          const x = Number(attr(key, "cx")),
            y = Number(attr(key, "cy")),
            radius = Number(attr(key, "r"));
          expect(x - radius).toBeGreaterThanOrEqual(left + halfStroke - 0.02);
          expect(x + radius).toBeLessThanOrEqual(right - halfStroke + 0.02);
          expect(y - radius).toBeGreaterThanOrEqual(top + halfStroke - 0.02);
          expect(y + radius).toBeLessThanOrEqual(bottom - halfStroke + 0.02);
        }
        const texts = r.filter(
          (e) =>
            e.name.localName === "text" &&
            e.children.some(
              (c) =>
                c.kind === "text" &&
                [
                  "Visible label",
                  "Visible",
                  "label",
                  "Third",
                  "Hidden widest label",
                ].includes(c.data),
            ),
        );
        expect(texts).toHaveLength(["b", "t"].includes(position) ? 2 : 3);
        expect(
          texts
            .map((e) =>
              e.children
                .filter((c) => c.kind === "text")
                .map((c) => c.data)
                .join(""),
            )
            .join(""),
        ).not.toContain("Hidden");
        for (const text of texts) {
          const x = Number(attr(text, "x")),
            y = Number(attr(text, "y"));
          expect(x).toBeGreaterThanOrEqual(left - 0.02);
          expect(x).toBeLessThan(right);
          expect(y).toBeGreaterThan(top);
          expect(y).toBeLessThan(bottom);
          expect(r.indexOf(box)).toBeLessThan(r.indexOf(text));
        }
        const unpainted = fixture(
          "line",
          {
            ...legend,
            fill: undefined,
            strokeColor: undefined,
            strokeWidthEmu: undefined,
          },
          { lineMarkers: true, series: P.getShapeChartSpec(f.shape).series },
        );
        const without = rendered(unpainted, {
          measureText: (text, font) => ({
            widthPx: text.length * font.sizePx * 0.5,
            ascentPx: font.sizePx * 0.8,
            descentPx: font.sizePx * 0.3,
          }),
        });
        expect(
          r.filter(
            (e) => e !== box && !["g", "svg"].includes(e.name.localName),
          ),
        ).toEqual(
          without.filter((e) => !["g", "svg"].includes(e.name.localName)),
        );
      },
    );
  it.each(["bar", "line"])(
    "%s bounds include thick series keys with the native legend stroke cap",
    (kind) => {
      const f = fixture(
        kind,
        {
          fill,
          strokeColor: stroke,
          strokeWidthEmu: 38100,
          textStyle: { sizePt: 4 },
        },
        {
          series: [
            {
              name: "Units",
              values: [1, 2, 3],
              color: "#23916F",
              lineColor: "#B63874",
              lineWidthEmu: 285750,
            },
          ],
        },
      );
      const r = rendered(f),
        box = backdrop(r),
        key = r.filter((e) => attr(e, "stroke") === "#B63874").at(-1),
        half = Number(attr(box, "stroke-width")) / 2;
      const left = Number(attr(box, "x")) + half,
        right = Number(attr(box, "x")) + Number(attr(box, "width")) - half,
        top = Number(attr(box, "y")) + half,
        bottom = Number(attr(box, "y")) + Number(attr(box, "height")) - half;
      const x = Number(attr(key, kind === "bar" ? "x" : "x1")),
        y = Number(attr(key, kind === "bar" ? "y" : "y1")),
        width = Number(attr(key, "stroke-width"));
      expect(width).toBeCloseTo(4 / 3, 10);
      expect(
        r
          .filter((e) => attr(e, "stroke") === "#B63874")
          .slice(0, -1)
          .every((e) => +attr(e, "stroke-width") === 30),
      ).toBe(true);
      expect(y - width / 2).toBeGreaterThanOrEqual(top - 0.02);
      expect(
        y + (kind === "bar" ? Number(attr(key, "height")) : 0) + width / 2,
      ).toBeLessThanOrEqual(bottom + 0.02);
      expect(x - (kind === "bar" ? width / 2 : 0)).toBeGreaterThanOrEqual(
        left - 0.02,
      );
      expect(
        kind === "bar"
          ? x + Number(attr(key, "width")) + width / 2
          : Number(attr(key, "x2")),
      ).toBeLessThanOrEqual(right + 0.02);
    },
  );
  it("wraps horizontal entries before fitting while retaining every key and label", () => {
    const f = fixture(
      "column",
      {
        fill,
        strokeColor: stroke,
        textStyle: { font: "Arial", sizePt: 11, color: "#A37511" },
      },
      {
        series: [
          {
            name: "Very long first label that requires fitting ".repeat(8),
            values: [1, 2],
          },
          { name: "Second long label ".repeat(8), values: [3, 4] },
        ],
      },
    );
    const r = rendered(f),
      box = backdrop(r),
      texts = r.filter(
        (e) => e.name.localName === "text" && attr(e, "fill") === "#A37511",
      );
    expect(texts.length).toBeGreaterThan(2);
    for (const text of texts)
      expect(Number(attr(text, "font-size"))).toBeCloseTo((11 * 4) / 3, 1);
    const text = texts
      .map((e) =>
        e.children
          .filter((c) => c.kind === "text")
          .map((c) => c.data)
          .join(""),
      )
      .join("")
      .replace(/\s/g, "");
    for (const series of P.getShapeChartSpec(f.shape).series)
      expect(text).toContain(series.name.replace(/\s/g, ""));
    expect(
      r.filter(
        (e) =>
          e.name.localName === "rect" && attr(e, "width") === attr(e, "height"),
      ),
    ).toHaveLength(2);
    expect(Number(attr(box, "x"))).toBeGreaterThanOrEqual(96);
    expect(
      Number(attr(box, "x")) + Number(attr(box, "width")),
    ).toBeLessThanOrEqual(8 * 96);
  });
  it("does not paint an empty or fully hidden legend", () => {
    for (const extra of [{ series: [] }, {}]) {
      const f = fixture(
        "column",
        { fill, strokeColor: stroke, hiddenIndices: [0] },
        extra,
      );
      expect(backdrop(rendered(f))).toBeUndefined();
    }
  });
  it.each(kinds)(
    "omitted and explicit invisible %s legend paints preserve the previous preview",
    (kind) => {
      const f = fixture(kind),
        before = preview(f.p, f.slide),
        spec = P.getShapeChartSpec(f.shape);
      expect(paints(spec)).toEqual([undefined, undefined, undefined]);
      P.setChartSpec(P.getSlideCharts(f.slide)[0], {
        ...spec,
        legend: {
          ...spec.legend,
          fill: null,
          strokeColor: null,
          strokeWidthEmu: 0,
        },
      });
      expect(preview(f.p, f.slide)).toEqual(before);
    },
  );
  it("treats a zero outline width independently of a visible background", () => {
    const f = fixture("column", {
        fill,
        strokeColor: stroke,
        strokeWidthEmu: 0,
      }),
      box = backdrop(rendered(f));
    expect(attr(box, "fill")).toBe(fill);
    expect(attr(box, "stroke-width")).toBe("0");
    expect(
      backdrop(
        rendered(
          fixture("column", {
            fill: null,
            strokeColor: stroke,
            strokeWidthEmu: 0,
          }),
        ),
      ),
    ).toBeUndefined();
  });
  it.each(["<a:gradFill/>", '<f:noFill xmlns:f="urn:foreign"/>'])(
    "does not confuse unsupported legend paint with noFill: %s",
    (xml) => {
      const f = fixture();
      native(f, `${xml}<a:ln>${xml}</a:ln>`);
      const before = f.part.data.slice();
      expect(paints(P.getShapeChartSpec(f.shape))).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
      expect(f.part.data).toEqual(before);
    },
  );
  it("resolves DrawingML color transformations through the chart host", () => {
    const f = fixture();
    native(
      f,
      '<a:solidFill><a:prstClr val="red"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="123456"><a:inv/></a:srgbClr></a:solidFill></a:ln>',
    );
    expect(paints(P.getShapeChartSpec(f.shape))).toEqual([
      "#FF0000",
      "#FEFBF4",
      undefined,
    ]);
  });
  it.each([
    "-1",
    "20116801",
    "NaN",
    "Infinity",
    "9525junk",
    "1.5",
    "1e3",
    "",
    "0x20",
  ])(
    "ignores malformed native outline width %s without mutating the source",
    (width) => {
      const f = fixture();
      native(
        f,
        `${paintXml(fill)}<a:ln w="${width}">${paintXml(stroke)}</a:ln>`,
      );
      const before = f.part.data.slice();
      expect(paints(P.getShapeChartSpec(f.shape))).toEqual([
        fill,
        stroke,
        undefined,
      ]);
      expect(attr(backdrop(rendered(f)), "stroke-width")).toBe("0.6");
      expect(f.part.data).toEqual(before);
    },
  );
  it.each([0, 1, 20116800])(
    "authors exact ST_LineWidth boundary %s",
    (width) => {
      const f = fixture("column", {
        fill,
        strokeColor: stroke,
        strokeWidthEmu: width,
      });
      expect(paints(P.getShapeChartSpec(f.shape))).toEqual([
        fill,
        stroke,
        width,
      ]);
      expect(Number(attr(backdrop(rendered(f)), "stroke-width"))).toBe(
        width / 9525,
      );
    },
  );
  for (const field of ["fill", "strokeColor"])
    it.each(["red", "#12", "#GG0000", 12, {}])(
      `rejects invalid legend ${field}=%j before package mutation`,
      (invalid) => {
        const f = fixture(),
          before = snapshot(f.p),
          chart = P.getSlideCharts(f.slide)[0];
        expect(() =>
          P.setChartSpec(chart, {
            ...chart.spec,
            legend: { ...chart.spec.legend, [field]: invalid },
          }),
        ).toThrow(`legend.${field}`);
        expect(snapshot(f.p)).toEqual(before);
        expect(() =>
          P.addSlideChart(f.slide, {
            x: P.inches(1),
            y: P.inches(1),
            w: P.inches(3),
            h: P.inches(2),
            spec: {
              ...chart.spec,
              legend: { position: "b", [field]: invalid },
            },
          }),
        ).toThrow(`legend.${field}`);
        expect(snapshot(f.p)).toEqual(before);
      },
    );
  it.each([-1, 20116801, NaN, Infinity, null, "9525"])(
    "rejects authored outline width %j atomically",
    (invalid) => {
      const f = fixture(),
        before = snapshot(f.p),
        chart = P.getSlideCharts(f.slide)[0];
      expect(() =>
        P.setChartSpec(chart, {
          ...chart.spec,
          legend: { ...chart.spec.legend, strokeWidthEmu: invalid },
        }),
      ).toThrow("legend.strokeWidthEmu");
      expect(snapshot(f.p)).toEqual(before);
    },
  );
  it.each(["scatter", "bubble", "radar"])(
    "%s reads native legend paint and retains its native graph through save and transfer both ways",
    async (kind) => {
      const f = fixture("column", {
        fill,
        strokeColor: stroke,
        strokeWidthEmu: 1,
      });
      edit(f, (root) => {
        const plot = child(child(root, "chart"), "plotArea");
        const group = child(plot, "barChart"),
          cat = child(plot, "catAx");
        const xId = attr(child(cat, "axId"), "val"),
          yId = attr(child(child(plot, "valAx"), "axId"), "val");
        const cache = (values) =>
          `<c:numLit><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("")}</c:numLit>`;
        const channels =
          kind === "radar"
            ? `<c:cat><c:strLit><c:ptCount val="3"/><c:pt idx="0"><c:v>Alpha</c:v></c:pt><c:pt idx="1"><c:v>Beta</c:v></c:pt><c:pt idx="2"><c:v>Gamma</c:v></c:pt></c:strLit></c:cat><c:val>${cache([4, 2, 7])}</c:val>`
            : `<c:xVal>${cache([1, 2, 4])}</c:xVal><c:yVal>${cache([4, 2, 7])}</c:yVal>${kind === "bubble" ? `<c:bubbleSize>${cache([2, 4, 3])}</c:bubbleSize>` : ""}`;
        const nativeGroup = parseXml(
          `<c:${kind}Chart xmlns:c="${NS.chart}" xmlns:a="${NS.dml}">${kind === "scatter" ? '<c:scatterStyle val="lineMarker"/>' : kind === "radar" ? '<c:radarStyle val="standard"/>' : ""}<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Units</c:v></c:tx>${channels}</c:ser><c:axId val="${xId}"/><c:axId val="${yId}"/></c:${kind}Chart>`,
        ).root;
        plot.children = plot.children.map((e) =>
          e === group ? nativeGroup : e,
        );
        if (kind !== "radar")
          plot.children = plot.children.map((e) =>
            e === cat
              ? parseXml(
                  `<c:valAx xmlns:c="${NS.chart}"><c:axId val="${xId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="${yId}"/></c:valAx>`,
                ).root
              : e,
          );
      });
      const before = f.part.data.slice(),
        spec = P.getShapeChartSpec(f.shape);
      expect(spec.kind).toBe(kind);
      expect(spec.series[0].values).toEqual([4, 2, 7]);
      expect(paints(spec)).toEqual([fill, stroke, 1]);
      expect(attr(backdrop(rendered(f)), "stroke-width")).toBe(
        String(1 / 9525),
      );
      const saved = await P.loadPresentation(await P.savePresentation(f.p)),
        q = createDeck("blank"),
        copiedSlide = P.importSlide(
          q,
          P.getSlides(saved)[0],
          P.getSlideLayouts(q)[0],
          { preservePaintFormatting: true },
        ),
        copied = P.getSlideCharts(copiedSlide)[0];
      expect(copied.spec).toEqual(spec);
      expect(workbook(q, copied.shape).data).toEqual(
        workbook(f.p, f.shape).data,
      );
      const returnedSlide = P.importSlide(
          f.p,
          copiedSlide,
          P.getSlideLayout(f.slide),
          { preservePaintFormatting: true },
        ),
        back = P.getSlideCharts(returnedSlide)[0];
      expect(back.spec).toEqual(spec);
      expect(chartRoot(back.shape)).not.toBe(chartRoot(f.shape));
      expect(f.part.data).toEqual(before);
      expect(P.validatePresentation(f.p)).toEqual([]);
    },
  );
  it("omits native shape properties when only text/position are authored", () => {
    const f = fixture("column", { position: "r", textStyle: { sizePt: 12 } });
    const doc = parseXml(new TextDecoder().decode(f.part.data));
    expect(child(child(child(doc.root, "chart"), "legend"), "spPr")).toBeNull();
  });
});

function renderSlideToSvg(...args) {
  return canonicalSvgDefinitionIds(renderWithSharedIds(...args));
}
