import { canonicalSvgDefinitionIds } from "./svg-definition-ids.js";
import { describe, it, expect } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg as renderWithSharedIds } from "../lib/pptx-preview/src/index.ts";
import {
  chartAxisLabelGapDeck,
  labelGapColors,
} from "./chart-axis-label-gap-fixture.js";
import { workbook } from "./chart-copy-fixture.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

// Independent native PDF measurements: point gaps at category distances 0,
// 100 and 200. Font bounds describe the measured faces, not production branches.
const nativeLabelGapCases = [
  {
    font: "Arial",
    sizePt: 9,
    ascent: 1854,
    descent: 434,
    gapPt: 7.740758749413871,
    unitPt: 3,
  },
  {
    font: "Arial",
    sizePt: 10,
    ascent: 1854,
    descent: 434,
    gapPt: 8.604677360555364,
    unitPt: 3,
  },
  {
    font: "Arial",
    sizePt: 11,
    ascent: 1854,
    descent: 434,
    gapPt: 9.46611430594762,
    unitPt: 3.072265625,
  },
  {
    font: "Arial",
    sizePt: 12,
    ascent: 1854,
    descent: 434,
    gapPt: 10.328645000472505,
    unitPt: 3.3515625,
  },
  {
    font: "Arial",
    sizePt: 24,
    ascent: 1854,
    descent: 434,
    gapPt: 20.649035000188995,
    unitPt: 6.703125,
  },
  {
    font: "Times New Roman",
    sizePt: 9,
    ascent: 1825,
    descent: 443,
    gapPt: 7.658727500452244,
    unitPt: 3,
  },
  {
    font: "Times New Roman",
    sizePt: 12,
    ascent: 1825,
    descent: 443,
    gapPt: 10.21145750020925,
    unitPt: 3.322265625,
  },
  {
    font: "Times New Roman",
    sizePt: 24,
    ascent: 1825,
    descent: 443,
    gapPt: 20.418566250367853,
    unitPt: 6.64453125,
  },
  {
    font: "Verdana",
    sizePt: 12,
    ascent: 2059,
    descent: 430,
    gapPt: 11.31080624993588,
    unitPt: 3.64599609375,
  },
  {
    font: "Courier New",
    sizePt: 12,
    ascent: 1705,
    descent: 615,
    gapPt: 10.128582500600743,
    unitPt: 3.3984375,
  },
];
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const measureFor = (cfg) => (text, font) => ({
  widthPx: ([...text].length * font.sizePx) / 2,
  ascentPx: (font.sizePx * cfg.ascent) / 2048,
  descentPx: (font.sizePx * cfg.descent) / 2048,
  lineGapPx: 0,
});
function geometry(p, slide, cfg) {
  const svg = renderSlideToSvg(p, slide, { measureText: measureFor(cfg) }),
    nodes = [];
  walkElements(parseXml(svg).root, (e) => nodes.push(e));
  const roles = labelGapColors.map((color) => {
    const lines = nodes.filter(
      (e) => e.name.localName === "line" && attr(e, "stroke") === color,
    );
    const spine = lines.find(
      (e) => Math.abs(Number(attr(e, "y2")) - Number(attr(e, "y1"))) > 10,
    );
    const labels = nodes.filter(
      (e) => e.name.localName === "text" && attr(e, "fill") === color,
    );
    return {
      spine: spine ? Number(attr(spine, "x1")) : null,
      labels: labels.map((e) => ({
        x: Number(attr(e, "x")),
        anchor: attr(e, "text-anchor"),
      })),
    };
  });
  return { svg, roles };
}
function checkGap(
  p,
  slide,
  cfg,
  { kind, distance = 100, secondary = false, high = false } = {},
) {
  const result = geometry(p, slide, cfg);
  for (const role of result.roles.slice(0, secondary ? 2 : 1)) {
    expect(role.labels.length).toBeGreaterThan(0);
    expect(role.spine).not.toBeNull();
    const expected =
      ((cfg.gapPt + (kind === "bar" ? (distance / 100 - 1) * cfg.unitPt : 0)) *
        4) /
      3;
    for (const label of role.labels) {
      expect(label.anchor).toBe(high ? "start" : "end");
      expect(
        Math.abs((label.x - role.spine) * (high ? 1 : -1) - expected),
      ).toBeLessThan(0.025);
    }
  }
  return result.svg;
}
describe("native intrinsic gaps beside vertical chart axes", () => {
  for (const cfg of nativeLabelGapCases)
    for (const kind of ["bar", "column"])
      for (const mark of ["none", "out", "cross"])
        for (const distance of kind === "bar" ? [0, 100, 200] : [100]) {
          it(`${kind} ${cfg.font} ${cfg.sizePt}pt ${mark} distance ${distance}`, async () => {
            const f = chartAxisLabelGapDeck({ ...cfg, kind, mark, distance }),
              bytes = f.part.data.slice(),
              book = workbook(f.p, f.shape).data.slice();
            checkGap(f.p, f.slide, cfg, { kind, distance });
            expect(f.part.data).toEqual(bytes);
            expect(workbook(f.p, f.shape).data).toEqual(book);
          });
        }
  for (const kind of ["bar", "column"])
    for (const high of [false, true])
      it(`${kind} ${high ? "right" : "left"} noFill spine keeps the same intrinsic label gap`, () => {
        const cfg = nativeLabelGapCases[3],
          options = { kind, high, distance: 200 },
          painted = chartAxisLabelGapDeck(options),
          hidden = chartAxisLabelGapDeck({ ...options, line: false });
        checkGap(painted.p, painted.slide, cfg, options);
        const before = geometry(painted.p, painted.slide, cfg).roles[0],
          after = geometry(hidden.p, hidden.slide, cfg).roles[0];
        expect(after.spine).toBeNull();
        expect(after.labels).toEqual(before.labels);
      });
  for (const kind of ["bar", "column"])
    for (const high of [false, true])
      for (const mark of ["none", "cross"]) {
        it(`${kind} ${high ? "right" : "left"} independent secondary gaps survive editable copy and return with ${mark} marks`, async () => {
          const cfg = nativeLabelGapCases[3],
            options = { kind, high, mark, secondary: true, distance: 200 },
            f = chartAxisLabelGapDeck({ ...cfg, ...options }),
            before = checkGap(f.p, f.slide, cfg, options),
            q = createDeck("blank"),
            copy = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0], {
              preservePaintFormatting: true,
            });
          checkGap(q, copy, cfg, options);
          const chart = P.getSlideCharts(copy)[0],
            spec = chart.spec;
          P.setChartSpec(chart, {
            ...spec,
            series: spec.series.map((s, i) => ({
              ...s,
              values: s.values.map((v) => v + i + 1),
            })),
          });
          expect(geometry(f.p, f.slide, cfg).svg).toBe(before);
          const r = await P.loadPresentation(await P.savePresentation(q)),
            rs = P.getSlides(r).at(-1);
          checkGap(r, rs, cfg, options);
          const returned = P.importSlide(f.p, rs, P.getSlideLayout(f.slide), {
            preservePaintFormatting: true,
          });
          checkGap(f.p, returned, cfg, options);
          expect(P.validatePresentation(r)).toEqual([]);
          expect(workbook(f.p, f.shape).data).not.toEqual(
            workbook(r, P.getSlideCharts(rs)[0].shape).data,
          );
        });
      }
});

function renderSlideToSvg(...args) {
  return canonicalSvgDefinitionIds(renderWithSharedIds(...args));
}
