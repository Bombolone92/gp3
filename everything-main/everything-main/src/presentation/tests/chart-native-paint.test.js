import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  chartPaintDeck,
  chartOpaquePaintDeck,
  chartRoot,
  workbook,
  chartGraph,
} from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  allChildElements,
  getAttrValue,
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
import { buildChartSpaceDoc } from "../lib/pptx/src/internal/chartml/chart-builder.ts";
import { preserveNativeChartPaint } from "../lib/pptx/src/internal/chartml/native-paint.ts";
import { resolveDrawingColor } from "../lib/pptx/src/api/fn/shape-color.ts";
const a = (n) => qname("a", n, NS.dml),
  c = (n) => qname("c", n, NS.chart),
  attr = (n) => qname("", n, "");
const xml = (f) =>
  parseXml(
    new TextDecoder().decode(
      P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
    ),
  );
const save = (f, d) =>
  (P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data =
    new TextEncoder().encode(serializeXml(d)));
const canonical = (e) => [
  e.name.namespaceURI,
  e.name.localName,
  e.attrs.map((a) => [a.name.namespaceURI, a.name.localName, a.value]).sort(),
  e.children.map((n) =>
    n.kind === "element" ? canonical(n) : [n.kind, n.data],
  ),
];
const blocks = (f) => {
  let out = [];
  walkElements(xml(f).root, (e) => {
    if (e.name.namespaceURI === NS.chart && e.name.localName === "spPr")
      out.push(canonical(e));
  });
  return out;
};
const hosts = (f) => {
  const root = xml(f).root,
    chart = firstChildElement(root, c("chart")),
    area = firstChildElement(chart, c("plotArea")),
    group = area.children.find(
      (n) =>
        n.kind === "element" &&
        [
          "barChart",
          "lineChart",
          "areaChart",
          "pieChart",
          "doughnutChart",
        ].includes(n.name.localName),
    );
  return {
    root,
    chart,
    area,
    series: firstChildElement(group, c("ser")),
    category: firstChildElement(area, c("catAx")),
    value: firstChildElement(area, c("valAx")),
    legend: firstChildElement(chart, c("legend")),
  };
};
const edit = (f) => {
  const chart = P.getSlideCharts(f.slide)[0];
  P.setChartSpec(chart, {
    ...chart.spec,
    series: chart.spec.series.map((s) => ({ ...s, values: [17, 23, 31] })),
  });
};
function neutral(e, fields) {
  const copy = structuredClone(e);
  let ln = firstChildElement(copy, a("ln"));
  if (fields.includes("fill"))
    copy.children = copy.children.filter(
      (n) =>
        n.kind !== "element" ||
        n.name.namespaceURI !== NS.dml ||
        ![
          "solidFill",
          "gradFill",
          "blipFill",
          "pattFill",
          "noFill",
          "grpFill",
        ].includes(n.name.localName),
    );
  if (ln) {
    if (fields.includes("width"))
      ln.attrs = ln.attrs.filter(
        (at) => at.name.namespaceURI !== "" || at.name.localName !== "w",
      );
    ln.children = ln.children.filter(
      (n) =>
        n.kind !== "element" ||
        n.name.namespaceURI !== NS.dml ||
        !(
          (fields.includes("stroke") &&
            ["solidFill", "gradFill", "pattFill", "noFill"].includes(
              n.name.localName,
            )) ||
          (fields.includes("dash") &&
            ["prstDash", "custDash"].includes(n.name.localName))
        ),
    );
  }
  return canonical(copy);
}
describe("native chart shape-property edits", () => {
  for (const kind of ["bar", "column", "line", "area", "pie", "doughnut"])
    it(`${kind} data edit/export retains all native paint bodies`, async () => {
      const f = chartPaintDeck(kind),
        before = blocks(f);
      edit(f);
      expect(blocks(f)).toEqual(before);
      const p = await P.loadPresentation(await P.savePresentation(f.p)),
        shape = P.getSlideCharts(P.getSlides(p)[0])[0].shape;
      expect(blocks({ p, shape })).toEqual(before);
      expect(P.validatePresentation(p)).toEqual([]);
    });
  for (const [scope, field, value, part] of [
    ["root", "chartAreaFill", "#16942D", "fill"],
    ["root", "chartAreaStrokeColor", null, "stroke"],
    ["root", "chartAreaStrokeWidthEmu", 38100, "width"],
    ["area", "plotAreaFill", null, "fill"],
    ["area", "plotAreaStrokeColor", "#FF5301", "stroke"],
    ["area", "plotAreaStrokeWidthEmu", 0, "width"],
    ["category", "categoryAxisLineColor", "#905CB1", "stroke"],
    ["value", "valueAxisLineWidthEmu", 0, "width"],
  ])
    it(`${field} changes only its represented native paint component`, () => {
      const f = chartPaintDeck(),
        before = firstChildElement(hosts(f)[scope], c("spPr")),
        chart = P.getSlideCharts(f.slide)[0];
      P.setChartSpec(chart, { ...chart.spec, [field]: value });
      expect(P.getShapeChartSpec(f.shape)[field]).toBe(value);
      expect(
        neutral(firstChildElement(hosts(f)[scope], c("spPr")), [part]),
      ).toEqual(neutral(before, [part]));
    });
  for (const [field, value, part] of [
    ["color", "#4892BD", "fill"],
    ["lineColor", null, "stroke"],
    ["lineWidthEmu", 0, "width"],
    ["lineDash", "sysDot", "dash"],
  ])
    it(`series ${field} edits preserve caps, compound/alignment, endpoints and effects`, () => {
      const f = chartPaintDeck(),
        before = firstChildElement(hosts(f).series, c("spPr")),
        chart = P.getSlideCharts(f.slide)[0];
      P.setChartSpec(chart, {
        ...chart.spec,
        series: [{ ...chart.spec.series[0], [field]: value }],
      });
      expect(P.getShapeChartSpec(f.shape).series[0][field]).toBe(value);
      expect(
        neutral(firstChildElement(hosts(f).series, c("spPr")), [part]),
      ).toEqual(neutral(before, [part]));
    });
  for (const field of ["color", "lineColor", "lineWidthEmu", "lineDash"])
    it(`clearing series ${field} resets its authored default without losing unrelated native properties`, () => {
      const f = chartPaintDeck(),
        before = firstChildElement(hosts(f).series, c("spPr")),
        chart = P.getSlideCharts(f.slide)[0],
        series = { ...chart.spec.series[0] };
      delete series[field];
      P.setChartSpec(chart, { ...chart.spec, series: [series] });
      const part = {
        color: "fill",
        lineColor: "stroke",
        lineWidthEmu: "width",
        lineDash: "dash",
      }[field];
      expect(
        neutral(firstChildElement(hosts(f).series, c("spPr")), [part]),
      ).toEqual(neutral(before, [part]));
    });
  it("retains native gradient fill and unrepresented custom outline dash on data edit", () => {
    const f = chartPaintDeck(),
      d = xml(f),
      sp = firstChildElement(
        firstChildElement(
          firstChildElement(
            firstChildElement(d.root, c("chart")),
            c("plotArea"),
          ),
          c("barChart"),
        ),
        c("ser"),
      );
    const body = firstChildElement(sp, c("spPr"));
    body.children = body.children.map((n) =>
      n.kind === "element" &&
      n.name.namespaceURI === NS.dml &&
      n.name.localName === "solidFill"
        ? parseXml(
            `<a:gradFill xmlns:a="${NS.dml}"><a:gsLst><a:gs pos="0"><a:srgbClr val="112233"/></a:gs><a:gs pos="100000"><a:srgbClr val="AABBCC"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>`,
          ).root
        : n,
    );
    const line = firstChildElement(body, a("ln"));
    line.children = line.children.map((n) =>
      n.kind === "element" && n.name.localName === "prstDash"
        ? parseXml(
            `<a:custDash xmlns:a="${NS.dml}"><a:ds d="300000" sp="100000"/></a:custDash>`,
          ).root
        : n,
    );
    save(f, d);
    const before = blocks(f);
    edit(f);
    expect(blocks(f)).toEqual(before);
  });
  it("an explicit preset dash replaces its mutually exclusive custom dash in the schema slot", () => {
    const f = chartPaintDeck(),
      d = xml(f);
    walkElements(d.root, (e) => {
      if (e.name.namespaceURI === NS.dml && e.name.localName === "prstDash") {
        e.name = a("custDash");
        e.attrs = [];
        e.children = parseXml(
          `<a:custDash xmlns:a="${NS.dml}"><a:ds d="200000" sp="100000"/></a:custDash>`,
        ).root.children;
      }
    });
    save(f, d);
    const chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, {
      ...chart.spec,
      series: [{ ...chart.spec.series[0], lineDash: "dot" }],
    });
    const ln = firstChildElement(
      firstChildElement(hosts(f).series, c("spPr")),
      a("ln"),
    );
    expect(firstChildElement(ln, a("custDash"))).toBeNull();
    expect(firstChildElement(ln, a("prstDash"))).not.toBeNull();
    expect(
      ln.children
        .filter((n) => n.kind === "element")
        .map((n) => n.name.localName),
    ).toEqual([
      "solidFill",
      "prstDash",
      "round",
      "headEnd",
      "tailEnd",
      "extLst",
    ]);
  });
  it("point paint and explosion edits preserve native point outlines, effects, markers and options", () => {
    const f = chartPaintDeck("pie"),
      d = xml(f);
    let old;
    walkElements(d.root, (e) => {
      if (
        e.name.namespaceURI === NS.chart &&
        e.name.localName === "dPt" &&
        getAttrValue(firstChildElement(e, c("idx")), attr("val")) === "2"
      )
        old = e;
    });
    old.children.splice(
      1,
      0,
      ...parseXml(
        `<c:wrapper xmlns:c="${NS.chart}" xmlns:a="${NS.dml}"><c:invertIfNegative val="1"/><c:marker><c:symbol val="star"/><c:size val="9"/><c:spPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="193857"/></a:gs><a:gs pos="100000"><a:srgbClr val="AD7319"/></a:gs></a:gsLst><a:lin ang="7200000"/></a:gradFill></c:spPr></c:marker></c:wrapper>`,
      ).root.children,
    );
    old.children.push(
      ...parseXml(
        `<c:wrapper xmlns:c="${NS.chart}" xmlns:future="urn:owned:point-options"><c:pictureOptions><c:applyToFront val="1"/><c:applyToSides val="1"/><c:applyToEnd val="0"/><c:pictureFormat val="stretch"/></c:pictureOptions><c:extLst><c:ext uri="urn:owned:options"><future:options value="retained"/></c:ext></c:extLst></c:wrapper>`,
      ).root.children,
    );
    save(f, d);
    const options = (point) =>
        canonical({
          ...point,
          children: point.children.filter(
            (n) =>
              n.kind !== "element" ||
              n.name.namespaceURI !== NS.chart ||
              !["explosion", "spPr"].includes(n.name.localName),
          ),
        }),
      before = firstChildElement(old, c("spPr")),
      chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, {
      ...chart.spec,
      series: [
        {
          ...chart.spec.series[0],
          pointColors: [chart.spec.series[0].pointColors[0], null, "#214F85"],
          pointExplosions: [null, null, 23],
        },
      ],
    });
    const point = allChildElements(hosts(f).series, c("dPt"))[1];
    expect(
      getAttrValue(firstChildElement(point, c("explosion")), attr("val")),
    ).toBe("23");
    expect(neutral(firstChildElement(point, c("spPr")), ["fill"])).toEqual(
      neutral(before, ["fill"]),
    );
    expect(options(point)).toEqual(options(old));
  });
  it("unrepresented point formatting survives removal of a modeled fill and explosion override", () => {
    const f = chartPaintDeck("pie"),
      chart = P.getSlideCharts(f.slide)[0],
      old = allChildElements(hosts(f).series, c("dPt"))[1],
      before = firstChildElement(old, c("spPr"));
    P.setChartSpec(chart, {
      ...chart.spec,
      series: [
        { ...chart.spec.series[0], pointColors: [], pointExplosions: [] },
      ],
    });
    const points = allChildElements(hosts(f).series, c("dPt"));
    expect(points).toHaveLength(2);
    expect(firstChildElement(points[1], c("explosion"))).toBeNull();
    expect(neutral(firstChildElement(points[1], c("spPr")), ["fill"])).toEqual(
      neutral(before, ["fill"]),
    );
  });
  it("series paints follow model indices through reversed combo plot order and secondary-first axis XML", () => {
    const f = chartPaintDeck("column", true),
      d = xml(f),
      area = firstChildElement(
        firstChildElement(d.root, c("chart")),
        c("plotArea"),
      );
    const nodes = area.children.filter(
      (n) =>
        n.kind === "element" &&
        ["barChart", "lineChart", "catAx", "valAx"].includes(n.name.localName),
    );
    area.children = [
      ...nodes.reverse(),
      ...area.children.filter((n) => !nodes.includes(n)),
    ];
    save(f, d);
    const byName = () =>
        Object.fromEntries(
          P.getShapeChartSpec(f.shape).series.map((s) => [
            s.name,
            [s.color, s.lineColor, s.lineWidthEmu],
          ]),
        ),
      before = byName(),
      props = blocks(f);
    edit(f);
    expect(byName()).toEqual(before);
    expect(blocks(f).map(JSON.stringify).sort()).toEqual(
      props.map(JSON.stringify).sort(),
    );
  });
  it("removed legend, axes, gridlines, markers and trendlines remain absent", () => {
    const f = chartPaintDeck("line"),
      chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, {
      ...chart.spec,
      kind: "pie",
      legend: { position: null },
      series: [
        {
          ...chart.spec.series[0],
          markerSymbol: undefined,
          markerSizePt: undefined,
          trendline: undefined,
        },
      ],
    });
    const h = hosts(f);
    expect(h.legend).toBeNull();
    expect(h.category).toBeNull();
    expect(h.value).toBeNull();
    expect(firstChildElement(h.series, c("marker"))).toBeNull();
    expect(firstChildElement(h.series, c("trendline"))).toBeNull();
  });
  it("native scheme fills remain live under chart-local maps and theme changes after editing", () => {
    const f = chartPaintDeck(),
      before = blocks(f);
    P.setPresentationTheme(f.p, { accent1: "#FF0000", accent3: "#00FF00" });
    edit(f);
    const green = P.getShapeChartSpec(f.shape).series[0].color;
    expect(green).toMatch(/^#00[0-9A-F]{2}00$/);
    P.setPresentationTheme(f.p, { accent3: "#0000FF" });
    expect(P.getShapeChartSpec(f.shape).series[0].color).toMatch(
      /^#0000[0-9A-F]{2}$/,
    );
    expect(blocks(f)).toEqual(before);
  });
  it("native XML inputs are immutable during the differential paint merge", () => {
    const f = chartPaintDeck(),
      d = xml(f),
      before = serializeXml(d),
      spec = P.getShapeChartSpec(f.shape),
      next = { ...spec, chartAreaFill: "#527B8D" },
      authored = buildChartSpaceDoc(next);
    preserveNativeChartPaint(d.root, authored.root, next, (color) =>
      resolveDrawingColor(color, P.getPresentationTheme(f.p), {
        accent1: "accent3",
      }),
    );
    expect(serializeXml(d)).toBe(before);
  });
  for (const kind of ["bar", "column", "line", "area", "pie", "doughnut"])
    it(`${kind} transfer both ways and independent copy edits preserve native paint`, async () => {
      const f = chartPaintDeck(kind),
        before = blocks(f),
        book = workbook(f.p, f.shape).data.slice(),
        render = preview(f.p, f.slide),
        target = createDeck("blank"),
        forward = P.importSlide(target, f.slide, P.getSlideLayouts(target)[0], {
          preservePaintFormatting: true,
        }),
        shape = P.getSlideCharts(forward)[0].shape;
      expect(blocks({ p: target, shape })).toEqual(before);
      const back = P.importSlide(f.p, forward, P.getSlideLayout(f.slide), {
          preservePaintFormatting: true,
        }),
        copy = P.getSlideCharts(back)[0];
      edit({ p: f.p, shape: copy.shape, slide: back });
      expect(blocks({ p: f.p, shape: copy.shape })).toEqual(before);
      expect(workbook(f.p, f.shape).data).toEqual(book);
      expect(preview(f.p, f.slide)).toEqual(render);
      const reopened = await P.loadPresentation(await P.savePresentation(f.p));
      expect(P.validatePresentation(reopened)).toEqual([]);
      expect(
        blocks({
          p: reopened,
          shape: P.getSlideCharts(P.getSlides(reopened).at(-1))[0].shape,
        }),
      ).toEqual(before);
    });
  it("opaque gradients, patterns, group and picture fills retain their native dependency graph through edits and transfer", async () => {
    const f = chartOpaquePaintDeck(),
      before = blocks(f),
      assets = chartGraph(f.p, chartRoot(f.shape))
        .filter((p) => p.contentType === "image/png")
        .map((p) => p.data.slice());
    edit(f);
    expect(blocks(f)).toEqual(before);
    const target = createDeck("blank"),
      slide = P.importSlide(target, f.slide, P.getSlideLayouts(target)[0], {
        preservePaintFormatting: true,
      }),
      shape = P.getSlideCharts(slide)[0].shape;
    expect(blocks({ p: target, shape })).toEqual(before);
    expect(
      chartGraph(target, chartRoot(shape))
        .filter((p) => p.contentType === "image/png")
        .map((p) => p.data),
    ).toEqual(assets);
    const returned = P.importSlide(f.p, slide, P.getSlideLayout(f.slide), {
        preservePaintFormatting: true,
      }),
      copy = P.getSlideCharts(returned)[0];
    edit({ p: f.p, shape: copy.shape, slide: returned });
    expect(blocks({ p: f.p, shape: copy.shape })).toEqual(before);
    expect(P.validatePresentation(f.p)).toEqual([]);
  });
  it("invisible trendline paint remains native until an explicit solid-color edit", () => {
    const f = chartPaintDeck(),
      d = xml(f);
    const visit = (e) => {
      if (
        e.name.namespaceURI === NS.chart &&
        e.name.localName === "trendline"
      ) {
        const sp = firstChildElement(e, c("spPr")),
          line = firstChildElement(sp, a("ln"));
        line.children = line.children.map((n) =>
          n.kind === "element" && n.name.localName === "solidFill"
            ? parseXml(`<a:noFill xmlns:a="${NS.dml}"/>`).root
            : n,
        );
      }
      for (const n of e.children) if (n.kind === "element") visit(n);
    };
    visit(d.root);
    save(f, d);
    const before = blocks(f);
    edit(f);
    expect(blocks(f)).toEqual(before);
    const chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, {
      ...chart.spec,
      series: [
        {
          ...chart.spec.series[0],
          trendline: { ...chart.spec.series[0].trendline, color: "#235B69" },
        },
      ],
    });
    expect(P.getShapeChartSpec(f.shape).series[0].trendline.color).toBe(
      "#235B69",
    );
  });
  it("label paint is inserted before visibility flags when there is no modeled text body", () => {
    const f = chartPaintDeck(),
      d = xml(f),
      h = firstChildElement(
        firstChildElement(
          firstChildElement(
            firstChildElement(d.root, c("chart")),
            c("plotArea"),
          ),
          c("barChart"),
        ),
        c("dLbls"),
      );
    h.children = h.children.filter(
      (n) => n.kind !== "element" || n.name.localName !== "txPr",
    );
    h.children.unshift(
      parseXml(
        `<c:spPr xmlns:c="${NS.chart}" xmlns:a="${NS.dml}"><a:pattFill prst="pct10"><a:fgClr><a:srgbClr val="102030"/></a:fgClr><a:bgClr><a:srgbClr val="405060"/></a:bgClr></a:pattFill></c:spPr>`,
      ).root,
    );
    save(f, d);
    edit(f);
    const result = firstChildElement(
      firstChildElement(hosts(f).area, c("barChart")),
      c("dLbls"),
    );
    expect(
      result.children.filter((n) => n.kind === "element")[0].name.localName,
    ).toBe("spPr");
  });
  for (const token of [
    "2suffix",
    "1.5",
    "1e2",
    "0x02",
    "-1",
    "4294967296",
    "NaN",
  ])
    it(`malformed point index ${token} stays opaque and never aliases a valid point`, () => {
      const f = chartPaintDeck(),
        d = xml(f),
        group = firstChildElement(
          firstChildElement(
            firstChildElement(d.root, c("chart")),
            c("plotArea"),
          ),
          c("barChart"),
        ),
        series = firstChildElement(group, c("ser")),
        point = structuredClone(firstChildElement(series, c("dPt"))),
        expected = P.getShapeChartSpec(f.shape).series[0].pointColors[2];
      firstChildElement(point, c("idx")).attrs = [
        { name: attr("val"), value: token },
      ];
      const sp = firstChildElement(point, c("spPr"));
      sp.children = sp.children.map((n) =>
        n.kind === "element" && n.name.localName === "solidFill"
          ? parseXml(
              `<a:solidFill xmlns:a="${NS.dml}"><a:srgbClr val="E71985"/></a:solidFill>`,
            ).root
          : n,
      );
      series.children.splice(
        series.children.indexOf(firstChildElement(series, c("dPt"))) + 1,
        0,
        point,
      );
      save(f, d);
      expect(P.getShapeChartSpec(f.shape).series[0].pointColors[2]).toBe(
        expected,
      );
      const before = blocks(f);
      edit(f);
      expect(blocks(f)).toEqual(before);
    });
  it("duplicate point indices retain inactive native choices until their represented property changes", () => {
    const f = chartPaintDeck(),
      d = xml(f),
      series = firstChildElement(
        firstChildElement(
          firstChildElement(
            firstChildElement(d.root, c("chart")),
            c("plotArea"),
          ),
          c("barChart"),
        ),
        c("ser"),
      ),
      original = firstChildElement(series, c("dPt")),
      duplicate = structuredClone(original);
    firstChildElement(duplicate, c("idx")).attrs = [
      { name: attr("val"), value: " +000 " },
    ];
    firstChildElement(duplicate, c("spPr")).children = firstChildElement(
      duplicate,
      c("spPr"),
    ).children.map((n) =>
      n.kind === "element" && n.name.localName === "solidFill"
        ? parseXml(
            `<a:solidFill xmlns:a="${NS.dml}"><a:srgbClr val="E71985"/></a:solidFill>`,
          ).root
        : n,
    );
    duplicate.children.splice(
      1,
      0,
      parseXml(`<c:explosion xmlns:c="${NS.chart}" val="37"/>`).root,
    );
    series.children.splice(series.children.indexOf(original) + 1, 0, duplicate);
    save(f, d);
    const before = blocks(f),
      chart = P.getSlideCharts(f.slide)[0];
    expect(chart.spec.series[0].pointColors[0]).toBe("#E71985");
    expect(chart.spec.series[0].pointExplosions[0]).toBe(37);
    edit(f);
    expect(blocks(f)).toEqual(before);
    const current = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(current, {
      ...current.spec,
      series: [
        {
          ...current.spec.series[0],
          pointColors: ["#235B69"],
          pointExplosions: [19],
        },
      ],
    });
    const result = P.getShapeChartSpec(f.shape).series[0];
    expect(result.pointColors[0]).toBe("#235B69");
    expect(result.pointExplosions[0]).toBe(19);
    const points = allChildElements(hosts(f).series, c("dPt")).filter(
      (point) =>
        Number(
          getAttrValue(firstChildElement(point, c("idx")), attr("val")),
        ) === 0,
    );
    expect(points).toHaveLength(2);
    for (const point of points) {
      expect(
        getAttrValue(firstChildElement(point, c("explosion")), attr("val")),
      ).toBe("19");
      expect(neutral(firstChildElement(point, c("spPr")), ["fill"])).toEqual(
        neutral(firstChildElement(original, c("spPr")), ["fill"]),
      );
    }
  });
  it("point metadata uses the same materialization limit as native caches, and complete replacement remains possible", () => {
    const f = chartPaintDeck(),
      chart = P.getSlideCharts(f.slide)[0],
      d = xml(f);
    walkElements(d.root, (e) => {
      if (e.name.namespaceURI === NS.chart && e.name.localName === "dPt")
        firstChildElement(e, c("idx")).attrs = [
          { name: attr("val"), value: "4294967295" },
        ];
    });
    save(f, d);
    expect(P.getShapeChartSpec(f.shape)).toBeNull();
    expect(() =>
      P.setChartSpec(chart, {
        ...chart.spec,
        series: [
          { ...chart.spec.series[0], pointColors: [], pointExplosions: [] },
        ],
      }),
    ).not.toThrow();
    expect(P.getShapeChartSpec(f.shape)).not.toBeNull();
  });
});
