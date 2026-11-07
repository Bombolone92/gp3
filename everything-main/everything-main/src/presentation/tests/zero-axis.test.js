import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { P, parseDeck, createDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { zeroAxisFixture } from "./zero-axis-fixture.js";
import { renderedDiagramDeck } from "./diagram-render-fixture.js";
const first = (p) => P.getSlideShapes(P.getSlides(p)[0])[0];
const svg = (p) =>
  renderSlideToSvg(p, P.getSlides(p)[0], { stableDefinitionIds: true });
const coloredPath = (s) =>
  (s.match(/<path\b[^>]*>/g) ?? []).find((p) => p.includes('stroke="#1267B2"'));

describe("zero-axis shape paths", () => {
  it.each(
    ["line", "custom", "scaledCustom"].flatMap((geometry) =>
      ["horizontal", "vertical"].flatMap((axis) =>
        ["local", "layout", "master"].map((level) => ({
          geometry,
          axis,
          level,
        })),
      ),
    ),
  )("paints $axis $geometry geometry from $level", async (options) => {
    const bytes = await zeroAxisFixture(options),
      p = await parseDeck(bytes),
      output = svg(p);
    const path = coloredPath(output);
    expect(P.getShapeKind(first(p))).toBe("shape");
    expect(path).toBeDefined();
    expect(path).toContain(
      options.axis === "horizontal"
        ? 'd="M96.00,96.00 L480.00,96.00"'
        : 'd="M96.00,96.00 L96.00,384.00"',
    );
    expect(path).toContain('stroke-width="4.00"');
    expect(path).toContain("marker-end=");
    expect(output).not.toMatch(/NaN|Infinity|data-pptx-preset/);
    const saved = unzipSync(await P.savePresentation(p)),
      before = unzipSync(bytes);
    for (const n of Object.keys(saved).filter(
      (n) => n !== "[Content_Types].xml",
    ))
      expect(saved[n]).toEqual(before[n]);
  });
  it.each(["rect", "ellipse", "roundRect"])(
    "uses the evaluated %s contour instead of a zero-area SVG primitive",
    async (geometry) => {
      const p = await parseDeck(await zeroAxisFixture({ geometry }));
      const output = svg(p);
      expect(coloredPath(output)).toBeDefined();
      expect(output).not.toMatch(/NaN|Infinity|data-pptx-preset/);
    },
  );
  it("retains rotation, flips, dash and shared stroke/arrow alpha", async () => {
    const p = await parseDeck(
      await zeroAxisFixture({
        rotation: 31,
        flip: { horizontal: true, vertical: true },
        alpha: 0.5,
      }),
    );
    P.setShapeStrokeDash(first(p), "dash");
    const output = svg(p);
    expect(output).toContain("rotate(31 288.00 96.00)");
    expect(output).toContain("translate(576.00 0) scale(-1 1)");
    expect(output).toContain("translate(0 192.00) scale(1 -1)");
    expect(output).toContain('opacity="0.5"');
    expect(coloredPath(output)).toContain("stroke-dasharray=");
  });
  it("keeps no-outline geometry invisible without inventing a stroke", async () => {
    const p = await parseDeck(await zeroAxisFixture({ stroke: false }));
    const output = svg(p);
    expect(output).toContain(
      'd="M96.00,96.00 L480.00,96.00" fill="none" stroke="none"',
    );
    expect(output).not.toContain("<marker");
  });
  it.each([
    { w: 0, h: 0 },
    { w: -P.inches(1), h: P.inches(1) },
    { w: P.inches(1), h: -P.inches(1) },
  ])("does not paint invalid extents or a true point: %j", async (size) => {
    const p = await parseDeck(
      await zeroAxisFixture({
        bounds: { x: P.inches(1), y: P.inches(1), ...size },
      }),
    );
    expect(coloredPath(svg(p))).toBeUndefined();
  });
  it.each(["horizontal", "vertical"])(
    "paints a %s saved SmartArt shape without changing drawing parts",
    async (axis) => {
      const { pres, diagram } = await renderedDiagramDeck({
        preset: "line",
        geometry: {
          w: axis === "horizontal" ? P.inches(2) : 0,
          h: axis === "vertical" ? P.inches(2) : 0,
        },
      });
      diagram.drawing.part.data = new TextEncoder().encode(
        new TextDecoder()
          .decode(diagram.drawing.part.data)
          .replace(
            "<a:ln><a:noFill/></a:ln>",
            '<a:ln w="38100"><a:solidFill><a:srgbClr val="1267B2"/></a:solidFill></a:ln>',
          ),
      );
      const before = diagram.drawing.part.data.slice();
      expect(coloredPath(svg(pres))).toContain(
        axis === "horizontal" ? "L192.00,0.00" : "L0.00,192.00",
      );
      expect(diagram.drawing.part.data).toEqual(before);
    },
  );
  it.each(["horizontal", "vertical"])(
    "retains %s path extents and paint through save and transfer in both directions",
    async (axis) => {
      let p = await parseDeck(await zeroAxisFixture({ axis }));
      const before = svg(p),
        bounds = P.getShapeBoundsResolved(p, first(p));
      for (let i = 0; i < 2; i++) {
        const target = createDeck("blank"),
          blank = P.getSlides(target)[0];
        P.importSlide(target, P.getSlides(p)[0], P.getSlideLayout(blank), {
          preservePaintFormatting: true,
          preserveTextFormatting: true,
        });
        P.removeSlide(target, blank);
        p = await parseDeck(await P.savePresentation(target));
        expect(P.getShapeBoundsResolved(p, first(p))).toEqual(bounds);
        expect(coloredPath(svg(p))).toBe(coloredPath(before));
        expect(P.validatePresentation(p)).toEqual([]);
      }
    },
  );
});
