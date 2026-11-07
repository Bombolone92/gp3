import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, preview } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { parseGradFill } from "../lib/pptx/src/api/fn/shape-gradient-read.ts";
import { inheritGradientFill } from "../lib/pptx/src/api/fn/shape-fill-inheritance.ts";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import {
  chartPlotGuidesDeck,
  guideLineModes,
} from "./chart-plot-guides-fixture.js";
import { workbook } from "./chart-copy-fixture.js";

const stops = [
  { offset: 0, color: "#8F2D73" },
  { offset: 0.4, color: "#D9B744" },
  { offset: 1, color: "#16827C" },
];
const xml = (rect = "", flip = "none") =>
  `<a:gradFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" flip="${flip}"><a:gsLst>${stops.map((s) => `<a:gs pos="${s.offset * 100000}"><a:srgbClr val="${s.color.slice(1)}"/></a:gs>`).join("")}</a:gsLst><a:lin ang="2700000" scaled="1"/><a:tileRect ${rect}/></a:gradFill>`;
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
function gradients(source) {
  const elements = [];
  walkElements(parseXml(source).root, (e) => elements.push(e));
  return elements.filter((e) => e.name.localName === "linearGradient");
}
function progress(e, x, y, width = 300, height = 180) {
  const values = attr(e, "gradientTransform")
    ?.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)
    ?.map(Number);
  if (values) {
    const [tx, ty, w, h] = values.length === 4 ? values : [0, 0, ...values];
    x = (x - tx) / w;
    y = (y - ty) / h;
  }
  if (!values) {
    x /= width;
    y /= height;
  }
  const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((n) =>
      Number(attr(e, n)),
    ),
    dx = x2 - x1,
    dy = y2 - y1;
  return ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
}
const fold = (q) => 1 - Math.abs((((q % 2) + 2) % 2) - 1);
function colorAt(stops, t) {
  const rgb = (color) =>
    color.startsWith("#")
      ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
      : color.slice(4, -1).split(",").map(Number);
  if (t <= stops[0].offset) return rgb(stops[0].color);
  const j = stops.findIndex((s) => s.offset >= t);
  if (j < 0) return rgb(stops.at(-1).color);
  const a = stops[j - 1],
    b = stops[j],
    u = (t - a.offset) / (b.offset - a.offset);
  return rgb(a.color).map((v, i) => v + (rgb(b.color)[i] - v) * u);
}
function shape(options, w, h) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0],
    shape = P.addSlideShape(slide, {
      x: 0,
      y: 0,
      w: P.emu(w * 9525),
      h: P.emu(h * 9525),
      preset: "rect",
    });
  P.setShapeGradientFill(shape, options);
  return { p, slide, shape };
}
// Independent physical progress planes, checked against 76 native pages,
// 211 paint frames and 5,100 PDF shading samples. Inverted edges stay signed.
function nativeProgress(tile, angle, scaled, w, h, x, y) {
  const l = tile.left ?? 0,
    t = tile.top ?? 0,
    W = w * (1 - l - (tile.right ?? 0)),
    H = h * (1 - t - (tile.bottom ?? 0));
  const c =
      angle === 90 || angle === 270 ? 0 : Math.cos((angle * Math.PI) / 180),
    s = angle === 0 || angle === 180 ? 0 : Math.sin((angle * Math.PI) / 180);
  if (scaled && ((!W && c) || (!H && s))) return null;
  const nx = scaled ? (c ? c / W : 0) : c,
    ny = scaled ? (s ? s / H : 0) : s,
    span = scaled
      ? Math.abs(c) + Math.abs(s)
      : Math.abs(c) * W + Math.abs(s) * H;
  if (!span) return null;
  return 0.5 + ((x - w * l - W / 2) * nx + (y - h * t - H / 2) * ny) / span;
}
const tiles = [
  { left: 0.5 },
  { top: 0.6 },
  { left: 0.15, top: 0.2, right: 0.45, bottom: 0.35 },
  { left: -0.25, top: -0.4, right: 0.1, bottom: 0.15 },
  { left: 0.7, right: 0.6 },
  { top: 0.8, bottom: 0.5 },
  { left: 0.7, right: 0.6, top: 0.8, bottom: 0.5 },
  { left: 0.5, right: 0.5 },
  { top: 1 },
  { left: 1, top: 1 },
  { left: -4999.5, right: -4999.5 },
  { left: 5000.5, right: -14999.5 },
  { left: -14999.5, right: 5000.5 },
  { left: -24999.5, right: 15000.5 },
];
describe("native linear gradient tiles", () => {
  for (const [i, tileRect] of tiles.entries())
    for (const angleDeg of [0, 30, 45, 90, 135, 180, 225, 270, 315])
      for (const scaled of [false, true])
        it(`tile ${i}, ${angleDeg}°, scaled=${scaled} preserves reflected phase across aspect ratios and paint layers`, () => {
          for (const [w, h] of [
            [300, 180],
            [80, 420],
            [420, 80],
          ])
            for (const paintStops of [
              stops,
              stops.map((s, i) => ({ ...s, opacity: [0.2, 0.8, 0.5][i] })),
              [stops[0], { ...stops[2], offset: 1 }],
            ]) {
              const f = shape(
                  { stops: paintStops, tileRect, angleDeg, scaled },
                  w,
                  h,
                ),
                svg = renderSlideToSvg(f.p, f.slide, {
                  textLayout: "svg",
                  gradientRendering: "css",
                }),
                definitions = gradients(svg),
                expected = nativeProgress(
                  tileRect,
                  angleDeg,
                  scaled,
                  w,
                  h,
                  w / 2,
                  h / 2,
                );
              if (expected === null) {
                expect(definitions).toHaveLength(0);
                continue;
              }
              expect(definitions.length).toBeGreaterThan(0);
              expect(svg).not.toContain("linear-gradient(");
              for (const definition of definitions) {
                const spread = attr(definition, "spreadMethod");
                expect([null, "repeat"]).toContain(spread);
                for (const u of [0.1, 0.3, 0.7, 0.9])
                  for (const v of [0.1, 0.4, 0.8]) {
                    const actual =
                        progress(definition, w * u, h * v, w, h) *
                        (spread === "repeat" ? 2 : 1),
                      native = nativeProgress(
                        tileRect,
                        angleDeg,
                        scaled,
                        w,
                        h,
                        w * u,
                        h * v,
                      );
                    if (spread === null) {
                      // A visible monotonic interval can be rebased without
                      // changing the color field. Compare that field rather
                      // than requiring an unbounded original shading axis.
                      const serializedStops = definition.children
                          .filter((e) => e.kind === "element")
                          .map((e) => ({
                            offset: Number(attr(e, "offset")),
                            color: attr(e, "stop-color"),
                          })),
                        color = colorAt(serializedStops, actual),
                        expectedColor = colorAt(paintStops, fold(native));
                      for (let j = 0; j < 3; j++)
                        expect(color[j]).toBeCloseTo(expectedColor[j], 8);
                    } else {
                      expect(actual).toBeCloseTo(native, 8);
                      expect(fold(actual)).toBeCloseTo(fold(native), 8);
                    }
                  }
              }
            }
        });
  it("keeps tiny repeating tiles distinct without enumerating copies", () => {
    const f = shape(
        { stops, angleDeg: 0, tileRect: { right: 0.99999 } },
        300,
        180,
      ),
      svg = renderSlideToSvg(f.p, f.slide),
      g = gradients(svg);
    expect(g).toHaveLength(1);
    expect(Number(attr(g[0], "x2")) - Number(attr(g[0], "x1"))).toBeCloseTo(
      0.00002,
      12,
    );
    expect(progress(g[0], 150, 90) * 2).toBeCloseTo(50000, 5);
    expect(svg.length).toBeLessThan(30000);
  });
  it("retains close stop positions when constructing a mirrored filter period", () => {
    const f = shape(
        {
          tileRect: { left: 0.2, right: 0.5 },
          stops: [
            { offset: 0, color: "#892C61", opacity: 0.2 },
            { offset: 0.49998, color: "#D9AF34", opacity: 0.8 },
            { offset: 0.50002, color: "#187F93", opacity: 0.5 },
            { offset: 1, color: "#587234", opacity: 0.7 },
          ],
        },
        300,
        180,
      ),
      svg = renderSlideToSvg(f.p, f.slide),
      offsets = [...svg.matchAll(/<stop offset="([^"]+)"/g)].map((m) =>
        Number(m[1]),
      );
    expect(gradients(svg)).toHaveLength(2);
    for (const offset of [0.24999, 0.25001, 0.74999, 0.75001])
      expect(offsets.some((value) => Math.abs(value - offset) < 1e-12)).toBe(
        true,
      );
    expect(svg.length).toBeLessThan(30000);
  });
  it.each(["none", "x", "y", "xy"])(
    "ignores native flip=%s while retaining authored XML",
    (flip) => {
      const node = parseXml(
          xml('l="25000" t="10%" r="35000" b="20000"', flip),
        ).root,
        before = structuredClone(node),
        g = parseGradFill(node);
      expect(g.tileRect).toEqual({
        left: 0.25,
        top: 0.1,
        right: 0.35,
        bottom: 0.2,
      });
      expect(node).toEqual(before);
    },
  );
  it.each([
    ["1", 0.00001],
    ["1%", 0.01],
    ["-25000", -0.25],
    ["125%", 1.25],
    ["0", undefined],
    ["", undefined],
    ["junk", undefined],
    ["1junk", undefined],
    ["Infinity", undefined],
  ])(
    "reads relative percentage %s without guessing its units",
    (value, expected) => {
      expect(
        parseGradFill(parseXml(xml(`l="${value}"`)).root).tileRect?.left,
      ).toBe(expected);
    },
  );
  it("inherits rectangles atomically and lets an empty nearer tile reset the inherited insets", () => {
    const base = parseXml(xml('l="50000"')).root;
    for (const [local, expected] of [
      ["", undefined],
      ['t="25000"', { top: 0.25 }],
    ]) {
      const own = parseXml(xml(local)).root;
      expect(parseGradFill(inheritGradientFill(own, base)).tileRect).toEqual(
        expected,
      );
    }
    const own = parseXml(xml().replace(/<a:tileRect[^>]*\/>/, "")).root;
    expect(parseGradFill(inheritGradientFill(own, base)).tileRect).toEqual({
      left: 0.5,
    });
  });
  it.each([NaN, Infinity, -Infinity])(
    "rejects a nonfinite inset %s before mutating the old fill",
    (bad) => {
      const f = shape({ stops }, 300, 180),
        before = preview(f.p, f.slide);
      expect(() =>
        P.setShapeGradientFill(f.shape, { stops, tileRect: { left: bad } }),
      ).toThrow(/finite/);
      expect(preview(f.p, f.slide)).toEqual(before);
    },
  );
  it("exports and reloads authored signed tile geometry", async () => {
    const options = {
        stops,
        scaled: true,
        angleDeg: 45,
        tileRect: { left: 0.15, top: -0.2, right: 0.45, bottom: 0.35 },
      },
      f = shape(options, 300, 180),
      loaded = await P.loadPresentation(await P.savePresentation(f.p));
    expect(
      P.getShapeGradientFill(P.getSlideShapes(P.getSlides(loaded)[0])[0])
        .tileRect,
    ).toEqual(options.tileRect);
    expect(preview(loaded, P.getSlides(loaded)[0])).toEqual(
      preview(f.p, f.slide),
    );
  });
  for (const level of ["slide", "layout", "master"])
    it(`shares tile parsing and rendering with ${level} backgrounds`, async () => {
      const p = createDeck("blank"),
        slide = P.getSlides(p)[0],
        files = unzipSync(await P.savePresentation(p)),
        layout = P.getSlideLayout(slide),
        names = {
          slide: P.getSlidePartName(slide).slice(1),
          layout: P.getSlideLayoutPartName(layout).slice(1),
          master: P.getSlideMasterPartName(slide).slice(1),
        };
      for (const [kind, name] of Object.entries(names)) {
        let text = strFromU8(files[name]).replace(
          /<p:bg\b[\s\S]*?<\/p:bg>/g,
          "",
        );
        if (kind === level)
          text = text.replace(
            /(<p:cSld\b[^>]*>)/,
            `$1<p:bg><p:bgPr>${xml('l="50000" t="25000"')}</p:bgPr></p:bg>`,
          );
        files[name] = strToU8(text);
      }
      const loaded = await P.loadPresentation(zipSync(files)),
        s = P.getSlides(loaded)[0],
        l = P.getSlideLayout(s),
        g =
          level === "slide"
            ? P.getSlideBackgroundGradientFill(s)
            : level === "layout"
              ? P.getSlideLayoutBackgroundGradientFill(l)
              : P.getSlideMasterBackgroundGradientFill(loaded, l);
      expect(g.tileRect).toEqual({ left: 0.5, top: 0.25 });
      expect(
        gradients(renderSlideToSvg(loaded, s)).every(
          (e) => attr(e, "spreadMethod") === "repeat",
        ),
      ).toBe(true);
      expect(gradients(renderSlideToSvg(loaded, s)).length).toBeGreaterThan(0);
    });
  it("uses the shared tile reader for table cell gradients", async () => {
    const p = createDeck("blank"),
      slide = P.getSlides(p)[0];
    P.addSlideTable(slide, {
      x: 0,
      y: 0,
      w: P.inches(4),
      h: P.inches(2),
      rows: [["Tile"]],
    });
    const files = unzipSync(await P.savePresentation(p)),
      name = P.getSlidePartName(slide).slice(1);
    files[name] = strToU8(
      strFromU8(files[name]).replace(
        /<a:tcPr\b[^>]*\/>/,
        `<a:tcPr>${xml('l="50000"')}</a:tcPr>`,
      ),
    );
    const loaded = await P.loadPresentation(zipSync(files)),
      s = P.getSlides(loaded)[0],
      table = P.getSlideTables(s)[0];
    expect(
      P.getTableStyleResolver(loaded, table).cell(P.getTableCell(table, 0, 0))
        .fill.tileRect,
    ).toEqual({ left: 0.5 });
    expect(
      gradients(renderSlideToSvg(loaded, s)).some(
        (e) => attr(e, "spreadMethod") === "repeat",
      ),
    ).toBe(true);
  });
  for (const role of ["dropLines", "hiLowLines"])
    it(`${role} retain tiles and independent paint through copied data edits and reload`, async () => {
      guideLineModes.tile = `<a:ln w="101600" cap="rnd">${xml('l="15000" t="20000" r="45000" b="35000"')}</a:ln>`;
      let f;
      try {
        f = chartPlotGuidesDeck({ groups: [{ kind: "line", [role]: "tile" }] });
      } finally {
        delete guideLineModes.tile;
      }
      const before = f.part.data.slice(),
        book = workbook(f.p, f.shape).data.slice(),
        source = preview(f.p, f.slide),
        p = createDeck("blank"),
        slide = P.importSlide(p, f.slide, P.getSlideLayouts(p)[0]),
        chart = P.getSlideCharts(slide)[0];
      P.setChartSpec(chart, {
        ...chart.spec,
        textStyle: { font: "Arial", sizePt: 13 },
        series: chart.spec.series.map((s) => ({
          ...s,
          values: s.values.map((v) => (v === null ? v : v + 2)),
        })),
      });
      const saved = await P.loadPresentation(await P.savePresentation(p)),
        s = P.getSlides(saved).at(-1),
        svg = decodeURIComponent(
          preview(saved, s).split(",").slice(1).join(","),
        );
      expect(
        gradients(svg).filter((e) => attr(e, "spreadMethod") === "repeat"),
      ).toHaveLength(4);
      expect(preview(saved, s)).toEqual(preview(p, slide));
      const returned = P.importSlide(f.p, s, P.getSlideLayouts(f.p)[0]);
      expect(
        gradients(
          decodeURIComponent(
            preview(f.p, returned).split(",").slice(1).join(","),
          ),
        ).filter((e) => attr(e, "spreadMethod") === "repeat"),
      ).toHaveLength(4);
      expect(f.part.data).toEqual(before);
      expect(workbook(f.p, f.shape).data).toEqual(book);
      expect(preview(f.p, f.slide)).toEqual(source);
    });
});
