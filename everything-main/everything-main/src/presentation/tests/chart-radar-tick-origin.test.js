import { describe, expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { P, createDeck, preview } from "../src/model.js";
import { workbook, chartRoot } from "./chart-copy-fixture.js";
import {
  chartRadarGridDeck,
  radarGridColors,
  radarGridLine,
} from "./chart-radar-grid-fixture.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

const attr = (e, n) => getAttrValue(e, qname("", n, ""));
function paint(src, n) {
  const nodes = [];
  walkElements(
    parseXml(decodeURIComponent(src.split(",").slice(1).join(","))).root,
    (e) => nodes.push(e),
  );
  const lines = (color) =>
    nodes.filter(
      (e) => e.name.localName === "line" && attr(e, "stroke") === color,
    );
  const spine = lines(radarGridColors.value)[0];
  return {
    labels: nodes.filter(
      (e) => e.name.localName === "text" && attr(e, "fill") === "#2468AC",
    ),
    cy: Number(attr(spine, "y1")),
    radius: Number(attr(spine, "y1")) - Number(attr(spine, "y2")),
    major: lines(radarGridColors.major)
      .filter((_, i) => i % n === 0)
      .map((e) => Number(attr(e, "y1"))),
    minor: lines(radarGridColors.minor)
      .filter((_, i) => i % n === 0)
      .map((e) => Number(attr(e, "y1"))),
  };
}
const text = (e) =>
  e.children
    .filter((c) => c.kind === "text")
    .map((c) => c.data)
    .join("");
const cases = [
  [1.3, 8],
  [-3, 5],
  [0.13, 0.8],
  [1.3, 1.8],
  [2, 3],
  [120, 800],
  [-9, -1],
  [1000, 1001],
  [0.07, 1.03],
  [0, 8],
  [100000, 100001],
  [-0.93, -0.13],
];
function check(src, n, min) {
  const r = paint(src, n);
  expect(Number(text(r.labels[0]).replaceAll(",", ""))).toBe(min);
  expect(Number(attr(r.labels[0], "y"))).toBe(r.cy);
  expect(r.major).toEqual(r.labels.slice(1).map((e) => Number(attr(e, "y"))));
  // Sixteen authored minor intervals cover the radius independently of the
  // automatic major density. Remove only positions occupied by a major ring.
  const minor = Array.from(
    { length: 16 },
    (_, i) => r.cy - ((i + 1) / 16) * r.radius,
  ).filter((y) => !r.major.some((major) => Math.abs(major - y) < 0.02));
  expect(r.minor).toHaveLength(minor.length);
  r.minor.forEach((y, i) => expect(Math.abs(y - minor[i])).toBeLessThan(0.02));
  expect(src).not.toMatch(/NaN|Infinity/);
}

describe("radar value-axis minimum is the automatic lattice origin", () => {
  for (const style of ["standard", "marker", "filled"])
    for (const [index, [min, max]] of cases.entries())
      it(`${style} starts ${min}..${max} at the center through copy and export`, async () => {
        const n = [4, 5, 7][index % 3],
          f = chartRadarGridDeck({
            n,
            radarStyle: style,
            valueAxis: {
              min,
              max,
              minorUnit: (max - min) / 16,
              numberFormat: "0.00",
              numberFormatSourceLinked: false,
            },
            axes: {
              value: {
                major: radarGridLine(radarGridColors.major),
                minor: radarGridLine(radarGridColors.minor),
              },
            },
          }),
          spec = P.getShapeChartSpec(f.shape),
          xml = P._internalPackageOf(f.p)
            .getPart(chartRoot(f.shape))
            .data.slice(),
          book = workbook(f.p, f.shape).data.slice(),
          src = preview(f.p, f.slide);
        check(src, n, min);
        expect(spec.valueAxis.majorUnit).toBeUndefined();
        expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
        expect(
          P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
        ).toEqual(xml);
        const target = createDeck("blank"),
          slide = P.importSlide(target, f.slide, P.getSlideLayouts(target)[0], {
            preservePaintFormatting: true,
            preserveTextFormatting: true,
          }),
          shape = P.getSlideCharts(slide)[0].shape;
        check(preview(target, slide), n, min);
        expect(workbook(target, shape).data).toEqual(book);
        const copiedXml = P._internalPackageOf(target)
            .getPart(chartRoot(shape))
            .data.slice(),
          round = await P.loadPresentation(await P.savePresentation(target)),
          saved = P.getSlides(round).at(-1),
          savedShape = P.getSlideCharts(saved)[0].shape;
        expect(P.getShapeChartSpec(savedShape)).toEqual(spec);
        expect(workbook(round, savedShape).data).toEqual(book);
        expect(
          P._internalPackageOf(round).getPart(chartRoot(savedShape)).data,
        ).toEqual(copiedXml);
        expect(preview(round, saved)).toBe(preview(target, slide));
        check(preview(round, saved), n, min);
        expect(P.validatePresentation(round)).toEqual([]);
      });

  for (const radarStyle of ["standard", "marker", "filled"])
    for (const [w, h, sizePt] of [
      [160, 160, 8],
      [420, 420, 24],
      [620, 180, 12],
      [180, 620, 36],
    ])
      it(`${radarStyle} retains its origin at ${w}x${h} with ${sizePt}pt labels`, () => {
        const f = chartRadarGridDeck({
          radarStyle,
          valueAxis: {
            min: 1.3,
            max: 8,
            numberFormat: "0.00",
            numberFormatSourceLinked: false,
          },
          valueAxisLabelStyle: { font: "Arial", sizePt, color: "#2468AC" },
        });
        P.setShapeSize(f.shape, P.pt(w), P.pt(h));
        const r = paint(preview(f.p, f.slide), 5);
        expect(text(r.labels[0])).toBe("1.30");
        expect(Number(attr(r.labels[0], "y"))).toBe(r.cy);
        expect(
          P.getShapeChartSpec(f.shape).valueAxis.majorUnit,
        ).toBeUndefined();
      });

  // A loop that repeatedly adds an automatic sub-ULP unit never advances.
  // Isolate this termination regression so a failure cannot hang the suite.
  it("terminates when an automatic unit is below the minimum's ULP", async () => {
    const worker = new Worker(
      `
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const {createServer} = await import(workerData.vite);
        const server = await createServer({root:workerData.root, configFile:false, server:{middlewareMode:true,hmr:false}, appType:'custom'});
        try {
          const {P,preview} = await server.ssrLoadModule('/src/model.js');
          const {chartRadarGridDeck} = await server.ssrLoadModule('/tests/chart-radar-grid-fixture.js');
          const f=chartRadarGridDeck({valueAxis:{min:1e12,max:1e12+0.0001220703125}});
          const before=P.getShapeChartSpec(f.shape),src=preview(f.p,f.slide);
          parentPort.postMessage({src,before,after:P.getShapeChartSpec(f.shape)});
        } finally {await server.close();}
      })().catch(e=>{throw e;});
    `,
      {
        eval: true,
        workerData: {
          vite: import.meta.resolve("vite"),
          root: fileURLToPath(new URL("..", import.meta.url)),
        },
      },
    );
    let timer;
    try {
      const result = await new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        timer = setTimeout(
          () =>
            reject(
              new Error("Automatic radar tick enumeration did not terminate"),
            ),
          8000,
        );
      });
      const r = paint(result.src, 5);
      expect(r.labels.length).toBeGreaterThan(1);
      expect(r.labels.length).toBeLessThanOrEqual(501);
      expect(new Set(r.labels.map((e) => attr(e, "y"))).size).toBe(
        r.labels.length,
      );
      expect(Number(attr(r.labels[0], "y"))).toBe(r.cy);
      expect(result.src).not.toMatch(/NaN|Infinity/);
      expect(result.after).toEqual(result.before);
      expect(result.after.valueAxis.majorUnit).toBeUndefined();
    } finally {
      clearTimeout(timer);
      await worker.terminate();
    }
  }, 10000);
});
