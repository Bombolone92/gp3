import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { connectorDeck } from "./connector-fixture.js";
import { P, createDeck, parseDeck, preview } from "../src/model.js";

const svg = (p, s = P.getSlides(p)[0]) =>
  decodeURIComponent(preview(p, s).split(",").slice(1).join(","));
const paths = (p, s) => svg(p, s).match(/<(?:line|path)\b[^>]*>/g) ?? [];

describe("connector outline visibility", () => {
  it.each([
    "line",
    "straightConnector1",
    "bentConnector2",
    "bentConnector3",
    "bentConnector4",
    "bentConnector5",
    "curvedConnector2",
    "curvedConnector3",
    "curvedConnector4",
    "curvedConnector5",
  ])(
    "honors noFill on %s without removing connector geometry",
    async (preset) => {
      const p = await parseDeck(await connectorDeck(preset));
      const before = unzipSync(await P.savePresentation(p));
      const markup = paths(p);
      expect(markup).toHaveLength(1);
      expect(markup[0]).toContain('stroke="none"');
      expect(svg(p)).not.toContain("<marker");
      expect(P.getShapeKind(P.getSlideShapes(P.getSlides(p)[0])[0])).toBe(
        "connector",
      );
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    },
  );
  it("keeps an unspecified connector visible and preserves solid colors, widths and arrows", async () => {
    const inherited = await parseDeck(await connectorDeck("line", "inherit"));
    expect(paths(inherited)[0]).not.toContain('stroke="none"');
    const solid = await parseDeck(await connectorDeck("line", "solid"));
    expect(paths(solid).at(-1)).toContain('stroke="#1267B2"');
    expect(paths(solid).at(-1)).toContain('stroke-width="4.00"');
    expect(svg(solid)).toContain("marker-start=");
    expect(svg(solid)).toContain("marker-end=");
  });
  it("preserves explicit no-outline through edit, copy in both directions, export and reload", async () => {
    const source = await parseDeck(await connectorDeck("curvedConnector3"));
    const s = P.getSlides(source)[0];
    P.copyShape(s, P.getSlideShapes(s)[0]);
    const target = createDeck("blank");
    const imported = P.importSlide(
      target,
      s,
      P.getSlideLayout(P.getSlides(target)[0]),
    );
    P.setShapeRotation(P.getSlideShapes(imported)[0], 31);
    const returned = P.importSlide(source, imported, P.getSlideLayout(s));
    for (const [p, slide] of [
      [target, imported],
      [source, returned],
    ]) {
      expect(paths(p, slide)).toHaveLength(2);
      expect(paths(p, slide).every((x) => x.includes('stroke="none"'))).toBe(
        true,
      );
      const reloaded = await parseDeck(await P.savePresentation(p)),
        last = P.getSlides(reloaded).at(-1);
      expect(P.getSlideShapes(last).map((sh) => P.getShapeStroke(sh))).toEqual([
        { kind: "none" },
        { kind: "none" },
      ]);
      expect(P.getShapeRotation(P.getSlideShapes(last)[0])).toBe(31);
      expect(
        paths(reloaded, last).every((x) => x.includes('stroke="none"')),
      ).toBe(true);
      const shape = P.getSlideShapes(last)[0];
      P.setShapeStroke(shape, { color: "#00A040", widthEmu: P.pt(2) });
      expect(
        paths(reloaded, last).some((x) => x.includes('stroke="#00A040"')),
      ).toBe(true);
    }
  });
});
