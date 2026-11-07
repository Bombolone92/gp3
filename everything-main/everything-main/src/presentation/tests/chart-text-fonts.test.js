import { describe, it, expect } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { chartRoot } from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  walkElements,
  serializeXml,
  firstChildElement,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
const child = (e, n, ns = NS.chart) => firstChildElement(e, qname("", n, ns));
const attr = (e, n) => e.attrs.find((a) => a.name.localName === n)?.value;
const text = (e) =>
  e.children
    .filter((c) => c.kind === "text")
    .map((c) => c.data)
    .join("");
const measure = (text, font) => ({
  widthPx: [...text].length * font.sizePx * 0.6,
  ascentPx: font.sizePx * 0.8,
  descentPx: font.sizePx * 0.2,
});
function fixture(spec = {}) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0];
  const shape = P.addSlideChart(slide, {
    x: P.emu(100 * 9525),
    y: P.emu(80 * 9525),
    w: P.emu(800 * 9525),
    h: P.emu(500 * 9525),
    spec: {
      kind: "column",
      categories: ["First category", "Second category"],
      series: [{ name: "Atlas series", values: [7.5, 12.5] }],
      title: "Chart title",
      titleStyle: { font: "Georgia" },
      categoryAxisTitle: "Categories",
      categoryAxisTitleStyle: { font: "Times New Roman" },
      valueAxisTitle: "Value axis",
      valueAxisTitleStyle: { font: "Verdana" },
      categoryAxisLabelStyle: { font: "Courier New" },
      valueAxisLabelStyle: { font: "Arial" },
      legend: { position: "b", textStyle: { font: "Trebuchet MS" } },
      dataLabels: { showValue: true, textStyle: { font: "Palatino" } },
      ...spec,
    },
  });
  return { p, slide, shape, pkg: P._internalPackageOf(p) };
}
function texts(f, options = {}) {
  const nodes = [];
  walkElements(
    parseXml(
      renderSlideToSvg(f.p, f.slide, {
        measureText: measure,
        resolveFontFamily: (family) => family ?? "sans-serif",
        ...options,
      }),
    ).root,
    (e) => {
      if (e.name.localName === "text") nodes.push(e);
    },
  );
  return nodes;
}
const find = (nodes, label) => nodes.find((e) => text(e) === label);
function override(f, minor = "Owned chart minor", major = "Owned chart major") {
  const fonts = `<a:fontScheme xmlns:a="${NS.dml}" name="Owned fonts"><a:majorFont><a:latin typeface="${major}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${minor}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`;
  const name = "/assets/font-override.xml";
  f.pkg.addPart(
    name,
    "application/vnd.openxmlformats-officedocument.themeOverride+xml",
    new TextEncoder().encode(
      `<a:themeOverride xmlns:a="${NS.dml}">${fonts}</a:themeOverride>`,
    ),
  );
  const root = chartRoot(f.shape),
    rels = f.pkg.getRels(root);
  rels.items.push({
    id: "ownedFont",
    type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/themeOverride",
    target: name,
    targetMode: "Internal",
  });
  f.pkg.setRels(root, rels);
  return name;
}
describe("native chart text fonts", () => {
  it.each([0, 1, 2, 3, 4])(
    "renders every chart text role at its exact measured point size (permutation %s)",
    (shift) => {
      const sizes = [6.05, 11.97, 14, 23.75, 32],
        roles = [
          "titleStyle",
          "categoryAxisTitleStyle",
          "valueAxisTitleStyle",
          "categoryAxisLabelStyle",
          "valueAxisLabelStyle",
          "legend",
          "dataLabels",
        ],
        expected = new Map(),
        spec = {};
      for (const [i, role] of roles.entries()) {
        const style = {
          font: `Precision role ${i}`,
          sizePt: sizes[(i + shift) % sizes.length],
        };
        expected.set(style.font, style.sizePt * (4 / 3));
        spec[role] =
          role === "legend"
            ? { position: "b", textStyle: style }
            : role === "dataLabels"
              ? { showValue: true, textStyle: style }
              : style;
      }
      const used = [],
        measured = [],
        nodes = texts(fixture(spec), {
          onFontUsed: (font) => used.push(font),
          measureText: (text, font) => {
            measured.push(font);
            return measure(text, font);
          },
        });
      for (const [family, sizePx] of expected) {
        const labels = nodes.filter((e) => attr(e, "font-family") === family);
        expect(labels.length).toBeGreaterThan(0);
        for (const label of labels)
          expect(Number(attr(label, "font-size"))).toBe(sizePx);
        expect(
          used.some((f) => f.family === family && f.sizePx === sizePx),
        ).toBe(true);
        for (const f of measured.filter((f) => f.family === family))
          expect(f.sizePx).toBe(sizePx);
      }
    },
  );
  it.each(["column", "pie", "doughnut"])(
    "retains exact inherited fractional sizes for %s titles, legends and labels",
    (kind) => {
      const sizePt = 11.97,
        nodes = texts(fixture({ kind, textStyle: { sizePt } }));
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes)
        expect(Number(attr(node, "font-size"))).toBe(sizePt * (4 / 3));
    },
  );
  it.each(["bar", "column", "line", "area", "pie", "doughnut"])(
    "uses authored title, legend and data-label fonts for %s",
    (kind) => {
      const f = fixture({ kind }),
        nodes = texts(f);
      expect(attr(find(nodes, "Chart title"), "font-family")).toBe("Georgia");
      expect(
        attr(
          find(
            nodes,
            kind === "pie" || kind === "doughnut"
              ? "First category"
              : "Atlas series",
          ),
          "font-family",
        ),
      ).toBe("Trebuchet MS");
      expect(attr(find(nodes, "7.5"), "font-family")).toBe("Palatino");
    },
  );
  it("uses authored fonts on both axis titles and tick labels", () => {
    const f = fixture(),
      nodes = texts(f);
    for (const [label, font] of [
      ["Categories", "Times New Roman"],
      ["Value axis", "Verdana"],
      ["First category", "Courier New"],
      ["0", "Arial"],
    ])
      expect(attr(find(nodes, label), "font-family")).toBe(font);
  });
  it.each(["bar", "column"])(
    "retains label font and style overrides in %s stacks",
    (kind) => {
      const f = fixture({
          kind,
          grouping: "stacked",
          dataLabels: {
            showValue: true,
            textStyle: {
              font: "Georgia",
              sizePt: 18,
              bold: true,
              italic: true,
              color: "#126789",
            },
          },
        }),
        label = find(texts(f), "7.5");
      expect(attr(label, "font-family")).toBe("Georgia");
      expect(Number(attr(label, "font-size"))).toBe(24);
      expect(attr(label, "fill")).toBe("#126789");
      expect(attr(label, "font-weight")).toBe("700");
      expect(attr(label, "font-style")).toBe("italic");
    },
  );
  it("inherits chart data-label fonts through partial per-series styles", () => {
    const f = fixture({
      dataLabels: { showValue: true, textStyle: { font: "Georgia" } },
      series: [
        {
          name: "Atlas series",
          values: [7.5, 12.5],
          dataLabels: { showValue: true, textStyle: { sizePt: 16 } },
        },
      ],
    });
    expect(attr(find(texts(f), "7.5"), "font-family")).toBe("Georgia");
  });
  it("resolves theme fonts from the owning chart and passes the concrete face to the provider", () => {
    const f = fixture({
      titleStyle: { font: "+mj-lt" },
      legend: { position: "b", textStyle: { font: "+mn-lt" } },
      categoryAxisLabelStyle: { font: "+mn-lt" },
    });
    override(f);
    const requested = [];
    const nodes = texts(f, {
      resolveFontFamily: (font) => {
        requested.push(font);
        return `"Provided ${font}", serif`;
      },
    });
    expect(attr(find(nodes, "Chart title"), "font-family")).toBe(
      '"Provided Owned chart major", serif',
    );
    expect(attr(find(nodes, "Atlas series"), "font-family")).toBe(
      '"Provided Owned chart minor", serif',
    );
    expect(requested).toContain("Owned chart minor");
    expect(requested).not.toContain("+mn-lt");
    expect(P.getShapeChartSpec(f.shape).titleStyle.font).toBe("+mj-lt");
  });
  it("uses current theme bytes and keeps font resolution local to each render", () => {
    const f = fixture({ categoryAxisLabelStyle: { font: "+mn-lt" } }),
      name = override(f, "First face");
    expect(attr(find(texts(f), "First category"), "font-family")).toBe(
      "First face",
    );
    const part = f.pkg.getPart(name),
      doc = parseXml(new TextDecoder().decode(part.data));
    child(
      child(child(doc.root, "fontScheme", NS.dml), "minorFont", NS.dml),
      "latin",
      NS.dml,
    ).attrs.find((a) => a.name.localName === "typeface").value = "Second face";
    part.data = new TextEncoder().encode(serializeXml(doc));
    expect(attr(find(texts(f), "First category"), "font-family")).toBe(
      "Second face",
    );
  });
  it("measures automatic axes using the same resolved family and bold/italic flags as the SVG", () => {
    const f = fixture({
        categoryAxisLabelStyle: {
          font: "Georgia",
          sizePt: 12,
          bold: true,
          italic: true,
        },
      }),
      calls = [];
    const nodes = texts(f, {
        resolveFontFamily: (font) => `Resolved ${font}`,
        measureText: (text, font) => {
          calls.push({ text, font });
          return measure(text, font);
        },
      }),
      label = find(nodes, "First category");
    const call = calls.find((c) => c.text === "First category");
    expect(call.font.family).toBe(attr(label, "font-family"));
    expect(call.font.bold).toBe(true);
    expect(call.font.italic).toBe(true);
    expect(attr(label, "font-weight")).toBe("700");
  });
  it("packs legend items from measured glyph widths", () => {
    const f = fixture({
        legend: { position: "b", textStyle: { font: "Wide face" } },
        series: [
          { name: "Wide first", values: [7.5, 12.5] },
          { name: "Wide second", values: [2, 3] },
        ],
      }),
      calls = [];
    const nodes = texts(f, {
        measureText: (text, font) => {
          calls.push({ text, font });
          return {
            widthPx: text.startsWith("Wide") ? 200 : 40,
            ascentPx: 12,
            descentPx: 4,
          };
        },
      }),
      a = find(nodes, "Wide first"),
      b = find(nodes, "Wide second");
    expect(
      calls
        .filter((c) => c.text.startsWith("Wide"))
        .every((c) => c.font.family === "Wide face"),
    ).toBe(true);
    expect(calls.filter((c) => c.text.startsWith("Wide"))).toHaveLength(2);
    expect(Number(attr(b, "x")) - Number(attr(a, "x"))).toBeGreaterThanOrEqual(
      200,
    );
  });
  it("reads, authors and inherits chart-space text properties without flattening local overrides", async () => {
    const f = fixture({
        textStyle: { font: "Georgia", sizePt: 15, color: "#123456" },
        titleStyle: { bold: false },
        legend: { position: "b" },
        categoryAxisLabelStyle: { sizePt: 12 },
        dataLabels: { showValue: true },
      }),
      spec = P.getShapeChartSpec(f.shape);
    expect(spec.textStyle).toEqual({
      font: "Georgia",
      sizePt: 15,
      color: "#123456",
    });
    expect(spec.titleStyle.font).toBeUndefined();
    expect(attr(find(texts(f), "Chart title"), "font-family")).toBe("Georgia");
    expect(attr(find(texts(f), "Atlas series"), "font-family")).toBe("Georgia");
    expect(attr(find(texts(f), "7.5"), "font-family")).toBe("Georgia");
    const q = await P.loadPresentation(await P.savePresentation(f.p));
    expect(P.getSlideCharts(P.getSlides(q)[0])[0].spec.textStyle).toEqual(
      spec.textStyle,
    );
    const root = parseXml(
      new TextDecoder().decode(f.pkg.getPart(chartRoot(f.shape)).data),
    ).root;
    const names = root.children
      .filter((e) => e.kind === "element")
      .map((e) => e.name.localName);
    expect(names.indexOf("txPr")).toBeGreaterThan(names.indexOf("chart"));
    expect(names.indexOf("txPr")).toBeLessThan(names.indexOf("externalData"));
  });
  it("retains literal and theme font tokens through export and native transfer both ways", async () => {
    const f = fixture({ categoryAxisLabelStyle: { font: "+mn-lt" } });
    override(f, "Georgia");
    const part = f.pkg.getPart(chartRoot(f.shape)),
      before = part.data.slice(),
      original = texts(f).map((e) => [text(e), attr(e, "font-family")]);
    const q = createDeck("blank"),
      slide = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0], {
        preservePaintFormatting: true,
        preserveTextFormatting: true,
      });
    expect(
      texts({ p: q, slide }).map((e) => [text(e), attr(e, "font-family")]),
    ).toEqual(original);
    const loaded = await P.loadPresentation(await P.savePresentation(q)),
      back = P.importSlide(
        f.p,
        P.getSlides(loaded).at(-1),
        P.getSlideLayout(f.slide),
        { preservePaintFormatting: true, preserveTextFormatting: true },
      );
    expect(
      texts({ p: f.p, slide: back }).map((e) => [
        text(e),
        attr(e, "font-family"),
      ]),
    ).toEqual(original);
    expect(P.getSlideCharts(back)[0].spec.categoryAxisLabelStyle.font).toBe(
      "+mn-lt",
    );
    expect(part.data).toEqual(before);
    expect(P.validatePresentation(loaded)).toEqual([]);
  });
  it("inherits the resolved chart-space font on generated unit and trendline labels", () => {
    const f = fixture({
      textStyle: { font: "+mn-lt" },
      valueAxis: { displayUnits: "thousands" },
      series: [
        {
          name: "Atlas series",
          values: [7.5, 12.5],
          trendline: { type: "linear", name: "Trend label" },
        },
      ],
    });
    override(f, "Georgia");
    const nodes = texts(f);
    expect(attr(find(nodes, "Thousands"), "font-family")).toBe("Georgia");
    expect(attr(find(nodes, "Trend label"), "font-family")).toBe("Georgia");
  });
  it("reports unmeasured chart title fonts to resource exporters", () => {
    const f = fixture({
        titleStyle: { font: "Title face", bold: true, italic: true },
      }),
      used = [],
      measured = [];
    texts(f, {
      onFontUsed: (font) => used.push(font),
      measureText: (text, font) => {
        measured.push(font.family);
        return measure(text, font);
      },
    });
    expect(measured).not.toContain("Title face");
    expect(used.find((font) => font.family === "Title face")).toMatchObject({
      bold: true,
      italic: true,
    });
  });
  it("escapes provider CSS family stacks without injecting markup", () => {
    const f = fixture({ titleStyle: { font: 'A & "B" <C>' } }),
      nodes = texts(f, { resolveFontFamily: (f) => `"${f}"` });
    expect(attr(find(nodes, "Chart title"), "font-family")).toBe(
      '"A & "B" <C>"',
    );
  });
});
