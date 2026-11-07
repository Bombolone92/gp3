import composite from "./data/diagram-composite-drawing-native.json";
import nativeRetry from "./data/diagram-sibling-height-retry-native.json";
import nativeCustom from "./data/diagram-custom-font-fitting-native.json";
import { it, expect } from "vitest";
import { unzipSync } from "fflate";
import { P } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { semanticTextGroupDeck } from "./diagram-text-group-fixture.js";
import { isDiagramShape } from "../lib/pptx/src/api/fn/diagram-read.ts";
const render = (p, mode = "svg") =>
  renderSlideToSvg(p, P.getSlides(p)[0], {
    textLayout: mode,
    stableDefinitionIds: true,
  });
it.each(["svg", "foreignObject"])(
  "renders shared ordered text rules in %s mode and preserves semantic sources through export",
  async (mode) => {
    const { p } = await semanticTextGroupDeck(),
      before = unzipSync(await P.savePresentation(p)),
      svg = render(p, mode);
    expect(svg).toContain('data-pptx-diagram="semantic-layout"');
    expect(svg).not.toContain("data-pptx-diagram-issues");
    expect(svg).not.toContain("data-pptx-fallback");
    expect(svg).toContain("Alpha");
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    const reopened = await P.loadPresentation(await P.savePresentation(p));
    expect(render(reopened, mode)).toBe(svg);
    expect(
      P.getSlideShapes(P.getSlides(reopened)[0]).filter(isDiagramShape),
    ).toHaveLength(1);
  },
);

// The initial insets consume the entire six-millimetre text rectangle. The
// fitting callback must reject that candidate, then grow/shrink the text box.
it.each(["svg", "foreignObject"])(
  "fits collapsed custom-font controls in %s and preserves fractional custom runs",
  async (mode) => {
    const row = nativeCustom.cases.find(
      (r) => r.name === "holdout custom01 h6 reversefalse height-font",
    );
    expect(row).toBeDefined();
    const { p } = await semanticTextGroupDeck(row);
    const before = unzipSync(await P.savePresentation(p));
    const svg = render(p, mode);
    expect(svg).toContain('data-pptx-diagram="semantic-layout"');
    expect(svg).not.toContain("data-pptx-diagram-issues");
    expect(svg).toMatch(/>I</);
    // 19.25 pt stays fractional even though its layout constraint rounds to 19.
    expect(svg).toContain(
      mode === "svg" ? 'font-size="25.67"' : "font-size:25.67px",
    );
    expect(svg).toContain("Alpha");
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    const reopened = await P.loadPresentation(await P.savePresentation(p));
    expect(render(reopened, mode)).toBe(svg);
  },
);

it.each(
  ["svg", "foreignObject"].flatMap((mode) =>
    [
      "fallback 3 120 50 true",
      "holdout 90 28 root false",
      "composite-offset: visible true long",
      "fallback-height-holdout: holdout 90 28 local false",
    ].map((name) => ({
      mode,
      name,
    })),
  ),
)(
  "preserves diagram fitting through $mode rendering and export: $name",
  async ({ mode, name }) => {
    const row = [...nativeRetry.cases, ...composite.cases].find(
      (r) => r.name === name,
    );
    const { p } = await semanticTextGroupDeck(row);
    const before = unzipSync(await P.savePresentation(p));
    const svg = render(p, mode);
    expect(svg).toContain('data-pptx-diagram="semantic-layout"');
    expect(svg).not.toContain("data-pptx-diagram-issues");
    expect(svg).toContain("Alpha");
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    const reopened = await P.loadPresentation(await P.savePresentation(p));
    expect(render(reopened, mode)).toBe(svg);
  },
);
