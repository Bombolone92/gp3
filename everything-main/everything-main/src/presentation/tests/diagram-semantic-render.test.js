import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { P } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { semanticPaintDeck } from "./diagram-build-fixture.js";
import native from "./data/diagram-paint-native.json";

const render = (p, mode) =>
  renderSlideToSvg(p, P.getSlides(p)[0], {
    textLayout: mode,
    stableDefinitionIds: true,
  });
describe("SmartArt without a saved drawing", () => {
  it.each(["svg", "foreignObject"])(
    "renders semantic geometry, text and accessibility in %s mode without changing the package",
    async (mode) => {
      const { p, frame } = await semanticPaintDeck();
      P.setShapeDescription(frame, "Semantic <diagram> & text");
      P.setShapeClickAction(frame, {
        kind: "url",
        url: "https://example.org/diagram",
      });
      const before = unzipSync(new Uint8Array(await P.savePresentation(p)));
      const svg = render(p, mode);
      expect(svg).toContain('data-pptx-diagram="semantic-layout"');
      expect(svg).toContain(
        'role="group" aria-label="Semantic &lt;diagram&gt; &amp; text"',
      );
      expect(svg).toContain('href="https://example.org/diagram"');
      for (const color of ["FF0000", "00FF00", "0000FF"])
        expect(svg).toContain(`#${color}`);
      for (const text of ["Text 1", "Text 2", "Text 3"])
        expect(svg).toContain(text);
      expect(svg).not.toContain("data-pptx-diagram-issues");
      expect(svg).not.toContain("data-pptx-fallback");
      const bytes = await P.savePresentation(p);
      expect(unzipSync(new Uint8Array(bytes))).toEqual(before);
      const reopened = await P.loadPresentation(bytes);
      expect(render(reopened, mode)).toBe(svg);
    },
  );
  it("reports unsupported layout geometry without silently substituting a rectangle", async () => {
    const { p } = await semanticPaintDeck(
      native.cases.find((c) => c.unsupported),
    );
    const svg = render(p, "svg");
    expect(svg).toContain("SmartArt (unsupported layout)");
    expect(svg).toContain(
      'data-pptx-diagram-issues="unsupported diagram rotated geometry"',
    );
    expect(svg).not.toContain('data-pptx-diagram="semantic-layout"');
  });
});
