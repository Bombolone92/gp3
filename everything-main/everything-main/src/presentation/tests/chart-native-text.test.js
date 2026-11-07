import { describe, it, expect } from "vitest";
import { P, preview, createDeck } from "../src/model.js";
import { chartTextDeck, chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  allChildElements,
  qname,
  getAttrValue,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
import { preserveNativeChartText } from "../lib/pptx/src/internal/chartml/native-text.ts";
import { buildChartSpaceDoc } from "../lib/pptx/src/internal/chartml/chart-builder.ts";
const a = (n) => qname("a", n, NS.dml),
  c = (n) => qname("c", n, NS.chart),
  attr = (n) => qname("", n, "");
const xml = (p, shape) =>
  parseXml(
    new TextDecoder().decode(
      P._internalPackageOf(p).getPart(chartRoot(shape)).data,
    ),
  );
const canonical = (e) => [
  e.name.namespaceURI,
  e.name.localName,
  e.attrs.map((a) => [a.name.namespaceURI, a.name.localName, a.value]).sort(),
  e.children.map((n) =>
    n.kind === "element" ? canonical(n) : [n.kind, n.data],
  ),
];
const textBlocks = (p, shape) => {
  let result = [];
  walkElements(xml(p, shape).root, (e) => {
    if (e.name.namespaceURI === NS.chart && e.name.localName === "txPr")
      result.push(canonical(e));
  });
  return result;
};
const saveXml = (f, d) => {
  P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data =
    new TextEncoder().encode(serializeXml(d));
};
function axis(f, name = "catAx") {
  const root = xml(f.p, f.shape).root,
    chart = firstChildElement(root, c("chart")),
    area = firstChildElement(chart, c("plotArea"));
  return { root, chart, area, axis: firstChildElement(area, c(name)) };
}
function body(f, name = "catAx") {
  return firstChildElement(axis(f, name).axis, c("txPr"));
}
const edit = (f) => {
  const chart = P.getSlideCharts(f.slide)[0];
  P.setChartSpec(chart, {
    ...chart.spec,
    series: chart.spec.series.map((s) => ({
      ...s,
      values: s.values.map((v) => (v === null ? null : v + 3)),
    })),
  });
};
function neutral(e, removed) {
  const copy = structuredClone(e);
  walkElements(copy, (n) => {
    if (n.name.namespaceURI !== NS.dml) return;
    if (["defRPr", "rPr", "endParaRPr"].includes(n.name.localName)) {
      n.attrs = n.attrs.filter(
        (at) =>
          at.name.namespaceURI !== "" || !removed.includes(at.name.localName),
      );
      if (removed.includes("font"))
        n.children = n.children.filter(
          (ch) =>
            ch.kind !== "element" ||
            ch.name.namespaceURI !== NS.dml ||
            !["latin", "ea"].includes(ch.name.localName),
        );
      if (removed.includes("color"))
        n.children = n.children.filter(
          (ch) =>
            ch.kind !== "element" ||
            ch.name.namespaceURI !== NS.dml ||
            ![
              "solidFill",
              "gradFill",
              "noFill",
              "pattFill",
              "blipFill",
              "grpFill",
            ].includes(ch.name.localName),
        );
    }
    if (n.name.localName === "bodyPr" && removed.includes("rot"))
      n.attrs = n.attrs.filter(
        (at) => at.name.namespaceURI !== "" || at.name.localName !== "rot",
      );
  });
  return canonical(copy);
}
describe("native chart text properties through represented edits", () => {
  for (const kind of ["bar", "column", "line", "area", "pie", "doughnut"])
    it(`${kind} data changes preserve complete native text and chart-local theme bindings`, async () => {
      const f = chartTextDeck(kind),
        before = textBlocks(f.p, f.shape),
        color = canonical(
          firstChildElement(xml(f.p, f.shape).root, c("clrMapOvr")),
        ),
        previous = P.getShapeChartSpec(f.shape);
      edit(f);
      expect(textBlocks(f.p, f.shape)).toEqual(before);
      expect(
        canonical(firstChildElement(xml(f.p, f.shape).root, c("clrMapOvr"))),
      ).toEqual(color);
      expect(P.getShapeChartSpec(f.shape).textStyle).toEqual(
        previous.textStyle,
      );
      const reopened = await P.loadPresentation(await P.savePresentation(f.p)),
        shape = P.getSlideCharts(P.getSlides(reopened)[0])[0].shape;
      expect(textBlocks(reopened, shape)).toEqual(before);
      expect(P.validatePresentation(reopened)).toEqual([]);
    });
  for (const [field, value, removed] of [
    ["font", "Noto Serif", ["font"]],
    ["sizePt", 23.75, ["sz"]],
    ["bold", false, ["b"]],
    ["italic", true, ["i"]],
    ["color", "#D18329", ["color"]],
  ])
    it(`explicit ${field} change retains unrelated body/paragraph/run/script properties`, async () => {
      const f = chartTextDeck(),
        old = body(f),
        chart = P.getSlideCharts(f.slide)[0];
      P.setChartSpec(chart, {
        ...chart.spec,
        categoryAxisLabelStyle: {
          ...chart.spec.categoryAxisLabelStyle,
          [field]: value,
        },
      });
      const after = body(f);
      expect(
        P.getShapeChartSpec(f.shape).categoryAxisLabelStyle[field],
      ).toEqual(value);
      expect(neutral(after, removed)).toEqual(neutral(old, removed));
      expect(
        getAttrValue(firstChildElement(after, a("bodyPr")), attr("anchor")),
      ).toBe("ctr");
      const q = await P.loadPresentation(await P.savePresentation(f.p));
      expect(
        P.getSlideCharts(P.getSlides(q)[0])[0].spec.categoryAxisLabelStyle[
          field
        ],
      ).toEqual(value);
    });
  for (const [field, removed] of [
    ["font", ["font"]],
    ["sizePt", ["sz"]],
    ["bold", ["b"]],
    ["italic", ["i"]],
    ["color", ["color"]],
  ])
    it(`removing ${field} clears its local override and keeps unrelated native text`, () => {
      const f = chartTextDeck(),
        old = body(f),
        chart = P.getSlideCharts(f.slide)[0],
        style = { ...chart.spec.categoryAxisLabelStyle };
      delete style[field];
      P.setChartSpec(chart, { ...chart.spec, categoryAxisLabelStyle: style });
      expect(
        P.getShapeChartSpec(f.shape).categoryAxisLabelStyle[field],
      ).toBeUndefined();
      expect(neutral(body(f), removed)).toEqual(neutral(old, removed));
    });
  for (const rotation of [0, 42.5, null, undefined])
    it(`rotation ${rotation} changes only rot, including native automatic and omission`, () => {
      const f = chartTextDeck(),
        old = body(f),
        chart = P.getSlideCharts(f.slide)[0];
      P.setChartSpec(chart, {
        ...chart.spec,
        categoryAxisLabelRotationDeg: rotation,
      });
      expect(P.getShapeChartSpec(f.shape).categoryAxisLabelRotationDeg).toEqual(
        rotation,
      );
      expect(neutral(body(f), ["rot"])).toEqual(neutral(old, ["rot"]));
    });
  it("clearing a style removes represented overrides while preserving its body and other defaults", () => {
    const f = chartTextDeck(),
      old = body(f),
      chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, { ...chart.spec, categoryAxisLabelStyle: undefined });
    expect(P.getShapeChartSpec(f.shape).categoryAxisLabelStyle).toBeUndefined();
    expect(neutral(body(f), ["sz", "b", "i", "font", "color"])).toEqual(
      neutral(old, ["sz", "b", "i", "font", "color"]),
    );
  });
  it("edits apply to all paragraphs, default properties, regular/field/break runs and paragraph ends", () => {
    const f = chartTextDeck(),
      d = xml(f.p, f.shape),
      host = firstChildElement(
        firstChildElement(firstChildElement(d.root, c("chart")), c("plotArea")),
        c("catAx"),
      ),
      tx = firstChildElement(host, c("txPr"));
    const para = parseXml(
      `<a:p xmlns:a="${NS.dml}"><a:pPr rtl="1"/><a:r><a:rPr sz="1200" b="0" i="0" lang="en-CA" u="sng"/><a:t>Text</a:t></a:r><a:fld id="{11111111-2222-3333-4444-555555555555}" type="slidenum"><a:rPr sz="1300" b="0" i="0" lang="ar-SA"/><a:t>1</a:t></a:fld><a:br><a:rPr b="0"/></a:br><a:endParaRPr lang="ja-JP" sz="1300"/></a:p>`,
    ).root;
    tx.children.push(para);
    saveXml(f, d);
    const chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, {
      ...chart.spec,
      categoryAxisLabelStyle: {
        ...chart.spec.categoryAxisLabelStyle,
        sizePt: 19,
        bold: false,
        italic: true,
      },
    });
    let count = 0;
    walkElements(body(f), (e) => {
      if (
        e.name.namespaceURI === NS.dml &&
        ["rPr", "defRPr", "endParaRPr"].includes(e.name.localName)
      ) {
        expect(getAttrValue(e, attr("sz"))).toBe("1900");
        expect(getAttrValue(e, attr("b"))).toBe("0");
        expect(getAttrValue(e, attr("i"))).toBe("1");
        count++;
      }
    });
    expect(count).toBe(7);
    expect(allChildElements(body(f), a("p"))).toHaveLength(2);
    expect(serializeXml(xml(f.p, f.shape))).toContain('lang="ar-SA"');
  });
  it("adds optional fill and latin/ea fields in schema order beside effects, scripts, links and extensions", () => {
    const f = chartTextDeck(),
      d = xml(f.p, f.shape),
      host = firstChildElement(
        firstChildElement(firstChildElement(d.root, c("chart")), c("plotArea")),
        c("catAx"),
      ),
      tx = firstChildElement(host, c("txPr")),
      p = firstChildElement(tx, a("p")),
      pr = firstChildElement(firstChildElement(p, a("pPr")), a("defRPr"));
    pr.children = parseXml(
      `<a:rPr xmlns:a="${NS.dml}"><a:ln/><a:effectLst/><a:cs typeface="Arabic native"/><a:hlinkClick tooltip="native"/><a:extLst/></a:rPr>`,
    ).root.children;
    saveXml(f, d);
    const chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, {
      ...chart.spec,
      categoryAxisLabelStyle: {
        ...chart.spec.categoryAxisLabelStyle,
        font: "Verdana",
        color: "#127C92",
      },
    });
    const after = firstChildElement(
      firstChildElement(firstChildElement(body(f), a("p")), a("pPr")),
      a("defRPr"),
    );
    expect(
      after.children
        .filter((e) => e.kind === "element")
        .map((e) => e.name.localName),
    ).toEqual([
      "ln",
      "solidFill",
      "effectLst",
      "latin",
      "ea",
      "cs",
      "hlinkClick",
      "extLst",
    ]);
  });
  it("resolves primary and secondary axis text by plot/cross references after reversed XML axis order", () => {
    const f = chartTextDeck("column", true),
      d = xml(f.p, f.shape),
      area = firstChildElement(
        firstChildElement(d.root, c("chart")),
        c("plotArea"),
      ),
      axes = area.children.filter(
        (n) =>
          n.kind === "element" && ["catAx", "valAx"].includes(n.name.localName),
      );
    area.children = [
      ...area.children.filter((n) => !axes.includes(n)),
      ...axes.reverse(),
    ];
    saveXml(f, d);
    const before = textBlocks(f.p, f.shape),
      chart = P.getSlideCharts(f.slide)[0],
      category = chart.spec.categoryAxisLabelStyle,
      value = chart.spec.valueAxisLabelStyle;
    edit(f);
    expect(P.getShapeChartSpec(f.shape).categoryAxisLabelStyle).toEqual(
      category,
    );
    expect(P.getShapeChartSpec(f.shape).valueAxisLabelStyle).toEqual(value);
    expect(textBlocks(f.p, f.shape).sort()).toEqual(before.sort());
  });
  it("preserves per-series label bodies when combo groups reorder during authoring", () => {
    const f = chartTextDeck("column", true),
      d = xml(f.p, f.shape),
      area = firstChildElement(
        firstChildElement(d.root, c("chart")),
        c("plotArea"),
      ),
      groups = area.children.filter(
        (n) =>
          n.kind === "element" &&
          ["lineChart", "barChart"].includes(n.name.localName),
      );
    area.children = [
      ...groups.reverse(),
      ...area.children.filter((n) => !groups.includes(n)),
    ];
    saveXml(f, d);
    const stylesByName = (spec) =>
      Object.fromEntries(
        spec.series.map((s) => [s.name, s.dataLabels.textStyle]),
      );
    const before = stylesByName(P.getSlideCharts(f.slide)[0].spec);
    edit(f);
    expect(stylesByName(P.getShapeChartSpec(f.shape))).toEqual(before);
  });
  it("removed legend and label hosts stay removed; kind changes keep applicable text without reviving axes", () => {
    const f = chartTextDeck(),
      chart = P.getSlideCharts(f.slide)[0],
      rootText = canonical(
        firstChildElement(xml(f.p, f.shape).root, c("txPr")),
      );
    P.setChartSpec(chart, {
      ...chart.spec,
      kind: "pie",
      series: [{ ...chart.spec.series[0], dataLabels: undefined }],
      legend: { position: null },
      dataLabels: undefined,
    });
    const d = xml(f.p, f.shape),
      chartNode = firstChildElement(d.root, c("chart")),
      area = firstChildElement(chartNode, c("plotArea"));
    expect(firstChildElement(chartNode, c("legend"))).toBeNull();
    expect(firstChildElement(area, c("catAx"))).toBeNull();
    expect(firstChildElement(area, c("valAx"))).toBeNull();
    expect(canonical(firstChildElement(d.root, c("txPr")))).toEqual(rootText);
  });
  it("preservation does not mutate the original XML tree", () => {
    const f = chartTextDeck(),
      original = xml(f.p, f.shape).root,
      before = serializeXml({
        kind: "document",
        decl: null,
        prolog: [],
        epilog: [],
        root: original,
      }),
      spec = P.getShapeChartSpec(f.shape),
      next = {
        ...spec,
        valueAxisLabelStyle: { ...spec.valueAxisLabelStyle, bold: true },
      },
      authored = buildChartSpaceDoc(next);
    preserveNativeChartText(original, authored.root, spec, next);
    expect(
      serializeXml({
        kind: "document",
        decl: null,
        prolog: [],
        epilog: [],
        root: original,
      }),
    ).toBe(before);
  });
  it("inherits a valid foreign prefix used only in native opaque attribute values", () => {
    const f = chartTextDeck(),
      d = xml(f.p, f.shape);
    walkElements(d.root, (e) => {
      if (e.name.namespaceURI === NS.chart && e.name.localName === "txPr") {
        e.prefixDecls.delete("future");
        e.attrs.push({ name: qname("", "binding", ""), value: "future:token" });
      }
    });
    saveXml(f, d);
    edit(f);
    walkElements(xml(f.p, f.shape).root, (e) => {
      if (e.name.namespaceURI === NS.chart && e.name.localName === "txPr")
        expect(e.prefixDecls.get("future")).toBe("urn:owned:chart-text");
    });
  });
  for (const kind of ["bar", "column", "line", "area", "pie", "doughnut"])
    it(`${kind} transfer both ways retains native text for independent returned-copy edits`, async () => {
      const f = chartTextDeck(kind),
        before = textBlocks(f.p, f.shape),
        originalWorkbook = workbook(f.p, f.shape).data.slice(),
        sourceRender = preview(f.p, f.slide),
        target = createDeck("blank");
      const imported = P.importSlide(
          target,
          f.slide,
          P.getSlideLayouts(target)[0],
          { preservePaintFormatting: true },
        ),
        shape = P.getSlideCharts(imported)[0].shape,
        returned = P.importSlide(f.p, imported, P.getSlideLayout(f.slide), {
          preservePaintFormatting: true,
        }),
        copy = P.getSlideCharts(returned)[0];
      expect(textBlocks(target, shape)).toEqual(before);
      expect(textBlocks(f.p, copy.shape)).toEqual(before);
      P.setChartSpec(copy, {
        ...copy.spec,
        series: copy.spec.series.map((s) => ({ ...s, values: [17, 23, 31] })),
      });
      expect(textBlocks(f.p, copy.shape)).toEqual(before);
      expect(workbook(f.p, f.shape).data).toEqual(originalWorkbook);
      expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([4, 9, -2]);
      expect(P.validatePresentation(f.p)).toEqual([]);
      expect(preview(f.p, f.slide)).toEqual(sourceRender);
      const reopened = await P.loadPresentation(await P.savePresentation(f.p));
      expect(
        textBlocks(
          reopened,
          P.getSlideCharts(P.getSlides(reopened).at(-1))[0].shape,
        ),
      ).toEqual(before);
    });
  for (const path of [
    ["textStyle"],
    ["legend", "textStyle"],
    ["valueAxisLabelStyle"],
    ["dataLabels", "textStyle"],
    ["series", 0, "dataLabels", "textStyle"],
  ])
    it(`changes ${path.join(".")} formatting without changing other text slots`, () => {
      const f = chartTextDeck("column", true),
        chart = P.getSlideCharts(f.slide)[0],
        before = textBlocks(f.p, f.shape),
        next = structuredClone(chart.spec);
      const parent = path.slice(0, -1).reduce((v, k) => v[k], next),
        key = path.at(-1);
      parent[key] = { ...parent[key], sizePt: 27.5 };
      P.setChartSpec(chart, next);
      const result = P.getShapeChartSpec(f.shape),
        style = path.reduce((v, k) => v[k], result);
      expect(style.sizePt).toBe(27.5);
      const after = textBlocks(f.p, f.shape);
      expect(after).toHaveLength(before.length);
      const neutralSlots = (shape) => {
        const slots = [];
        walkElements(xml(f.p, shape).root, (e) => {
          if (e.name.namespaceURI === NS.chart && e.name.localName === "txPr")
            slots.push(neutral(e, ["sz"]));
        });
        return slots;
      };
      const changed = after.filter(
        (s, i) => JSON.stringify(s) !== JSON.stringify(before[i]),
      );
      expect(changed).toHaveLength(path[0] === "dataLabels" ? 2 : 1);
      const original = chartTextDeck("column", true);
      expect(neutralSlots(f.shape)).toEqual(
        (() => {
          const slots = [];
          walkElements(xml(original.p, original.shape).root, (e) => {
            if (e.name.namespaceURI === NS.chart && e.name.localName === "txPr")
              slots.push(neutral(e, ["sz"]));
          });
          return slots;
        })(),
      );
    });
  it("omitted native barDir is read and edited as the default column direction", () => {
    const f = chartTextDeck("column"),
      d = xml(f.p, f.shape),
      area = firstChildElement(
        firstChildElement(d.root, c("chart")),
        c("plotArea"),
      ),
      group = firstChildElement(area, c("barChart"));
    group.children = group.children.filter(
      (n) =>
        n.kind !== "element" ||
        n.name.namespaceURI !== NS.chart ||
        n.name.localName !== "barDir",
    );
    saveXml(f, d);
    const before = textBlocks(f.p, f.shape);
    expect(() => edit(f)).not.toThrow();
    expect(textBlocks(f.p, f.shape)).toEqual(before);
  });
  it("adds missing paragraph defaults before extensions and preserves paragraphs with no pPr", () => {
    const f = chartTextDeck(),
      d = xml(f.p, f.shape),
      host = firstChildElement(
        firstChildElement(firstChildElement(d.root, c("chart")), c("plotArea")),
        c("catAx"),
      ),
      tx = firstChildElement(host, c("txPr"));
    tx.children.push(
      parseXml(
        `<a:p xmlns:a="${NS.dml}"><a:pPr><a:extLst/></a:pPr><a:r><a:t>Native</a:t></a:r></a:p>`,
      ).root,
      parseXml(
        `<a:p xmlns:a="${NS.dml}"><a:r><a:t>No properties</a:t></a:r></a:p>`,
      ).root,
    );
    saveXml(f, d);
    const chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, {
      ...chart.spec,
      categoryAxisLabelStyle: {
        ...chart.spec.categoryAxisLabelStyle,
        sizePt: 29,
      },
    });
    const paragraphs = allChildElements(body(f), a("p"));
    expect(
      firstChildElement(paragraphs[1], a("pPr")).children.map(
        (n) => n.name.localName,
      ),
    ).toEqual(["defRPr", "extLst"]);
    expect(
      firstChildElement(paragraphs[2], a("pPr")).children[0].name.localName,
    ).toBe("defRPr");
  });
  it("reads text formatting without materializing uneditable native data-cache extents", () => {
    const f = chartTextDeck(),
      chart = P.getSlideCharts(f.slide)[0],
      before = textBlocks(f.p, f.shape),
      d = xml(f.p, f.shape);
    walkElements(d.root, (e) => {
      if (e.name.namespaceURI === NS.chart && e.name.localName === "ptCount")
        e.attrs = [{ name: attr("val"), value: "4294967295" }];
    });
    saveXml(f, d);
    expect(P.getShapeChartSpec(f.shape)).toBeNull();
    expect(() =>
      P.setChartSpec(chart, {
        ...chart.spec,
        series: chart.spec.series.map((s) => ({ ...s, values: [17, 23, 31] })),
      }),
    ).not.toThrow();
    expect(textBlocks(f.p, f.shape)).toEqual(before);
    expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([17, 23, 31]);
  });
  it("native scheme text continues to follow its chart-local mapping after data edits and theme changes", async () => {
    const f = chartTextDeck(),
      before = textBlocks(f.p, f.shape);
    P.setPresentationTheme(f.p, { accent1: "#FF0000", accent3: "#00FF00" });
    const green = P.getShapeChartSpec(f.shape).textStyle.color;
    expect(green).toMatch(/^#00[0-9A-F]{2}00$/);
    expect(green).not.toBe("#000000");
    edit(f);
    expect(P.getShapeChartSpec(f.shape).textStyle.color).toBe(green);
    P.setPresentationTheme(f.p, { accent3: "#0000FF" });
    const blue = P.getShapeChartSpec(f.shape).textStyle.color;
    expect(blue).toMatch(/^#0000[0-9A-F]{2}$/);
    expect(blue).not.toBe("#000000");
    expect(blue).not.toBe(green);
    expect(textBlocks(f.p, f.shape)).toEqual(before);
    const q = await P.loadPresentation(await P.savePresentation(f.p));
    expect(P.getSlideCharts(P.getSlides(q)[0])[0].spec.textStyle.color).toBe(
      blue,
    );
  });
  it("a malformed theme does not prevent a complete chart replacement or remove unrelated native text properties", () => {
    const f = chartTextDeck(),
      chart = P.getSlideCharts(f.slide)[0],
      before = body(f),
      pkg = P._internalPackageOf(f.p),
      theme = pkg.parts.find(
        (p) =>
          p.contentType ===
          "application/vnd.openxmlformats-officedocument.theme+xml",
      );
    theme.data = new TextEncoder().encode("<broken>");
    const malformed = theme.data.slice();
    expect(() =>
      P.setChartSpec(chart, {
        ...chart.spec,
        categoryAxisLabelStyle: {
          ...chart.spec.categoryAxisLabelStyle,
          color: "#16AB74",
        },
        series: chart.spec.series.map((s) => ({ ...s, values: [17, 23, 31] })),
      }),
    ).not.toThrow();
    expect(neutral(body(f), ["color"])).toEqual(neutral(before, ["color"]));
    expect(theme.data).toEqual(malformed);
    const root = xml(f.p, f.shape).root;
    let color = false;
    walkElements(root, (e) => {
      if (
        e.name.namespaceURI === NS.dml &&
        e.name.localName === "srgbClr" &&
        getAttrValue(e, attr("val")) === "16AB74"
      )
        color = true;
    });
    expect(color).toBe(true);
  });
});
