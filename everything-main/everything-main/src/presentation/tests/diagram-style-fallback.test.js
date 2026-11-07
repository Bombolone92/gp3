import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import native from "./data/diagram-style-fallback-native.json";
import { P, createDeck } from "../src/model.js";
import { readDiagramStyleLabels } from "../lib/pptx/src/internal/diagram/styles.ts";
import { importSlideTemplate } from "../lib/pptx/src/api/fn/template-import.ts";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
import {
  expectedStyleFallback,
  inspectStyleFallback,
  styleFallbackDeck,
} from "./diagram-style-fallback-fixture.js";
const xml = (contents) =>
  parseXml(
    `<d:styleDef xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}">${contents}</d:styleDef>`,
  ).root;
const soleCases = native.cases.filter(
  (row) =>
    row.name.startsWith("matrix: ") ||
    row.name.startsWith("defaults: unrelated-label /") ||
    row.name === "selection: sole unrelated empty",
);
describe("SmartArt missing quick-style labels", () => {
  it.each(soleCases)(
    "matches independent native paint/font defaults: $name",
    async (row) => {
      const { p, frame } = await styleFallbackDeck(row);
      const before = unzipSync(new Uint8Array(await P.savePresentation(p)));
      expect(inspectStyleFallback(frame)).toEqual(expectedStyleFallback(row));
      expect(unzipSync(new Uint8Array(await P.savePresentation(p)))).toEqual(
        before,
      );
    },
  );
  it.each(["custom label", "node7", "Ω"])(
    "uses the sole label %j without redirecting palette lookup",
    (name) => {
      const quick = xml(`<d:styleLbl name="${name}"/>`),
        colors = xml(`<d:styleLbl name="${name}"/>`);
      const before = JSON.stringify([quick, colors]);
      const style = readDiagramStyleLabels(quick, colors)("missing", 2, 5);
      expect(style.quickStyle).toBe(quick.children[0]);
      expect(style.colors).toBeNull();
      expect([
        style.label,
        style.styleIndex,
        style.styleCount,
        style.issues,
      ]).toEqual(["missing", 2, 5, []]);
      expect(JSON.stringify([quick, colors])).toBe(before);
      expect(
        readDiagramStyleLabels(quick, colors)(null, null, null).quickStyle,
      ).toBeNull();
    },
  );
  it("keeps exact and node1 matches ahead of other labels, including empty matches", () => {
    const quick = xml('<d:styleLbl name="custom"/><d:styleLbl name="node1"/>');
    const lookup = readDiagramStyleLabels(quick, null);
    expect(lookup("custom", 0, 1).quickStyle).toBe(quick.children[0]);
    expect(lookup("missing", 0, 1).quickStyle).toBe(quick.children[1]);
  });
  it("keeps empty definitions and multiple unrelated labels unresolved, and retains duplicate diagnostics", () => {
    for (const content of [
      "",
      '<d:styleLbl name="one"/><d:styleLbl name="two"/>',
    ])
      expect(
        readDiagramStyleLabels(xml(content), null)("missing", 0, 1).quickStyle,
      ).toBeNull();
    const duplicate = readDiagramStyleLabels(
      xml('<d:styleLbl name="only"/><d:styleLbl name="only"/>'),
      null,
    )("missing", 0, 1);
    expect(duplicate.quickStyle).toBeNull();
    expect(duplicate.issues).toEqual([
      "duplicate diagram quick-style label missing",
    ]);
  });
  it.each(soleCases)(
    "retains native defaults through editable copy/export both ways: $name",
    async (row) => {
      const { p, frame } = await styleFallbackDeck(row),
        sourceSlide = P.getSlides(p)[0];
      const target = createDeck("blank");
      const inspect = (shape) => {
        expect(
          P.getShapeDiagramTextEntries(shape).map((entry) => entry.text),
        ).toEqual(row.expected.map((s) => s.text));
        expect(inspectStyleFallback(shape)).toEqual(expectedStyleFallback(row));
      };
      inspect(P.copyShape(sourceSlide, frame));
      P.importSlide(
        target,
        sourceSlide,
        importSlideTemplate(target, sourceSlide),
        { preserveGeometry: false },
      );
      const reopened = await P.loadPresentation(
          await P.savePresentation(target),
        ),
        imported = P.getSlides(reopened).at(-1);
      for (const shape of P.getSlideShapes(imported)) inspect(shape);
      P.importSlide(p, imported, importSlideTemplate(p, imported), {
        preserveGeometry: false,
      });
      const returned = await P.loadPresentation(await P.savePresentation(p));
      for (const shape of P.getSlideShapes(P.getSlides(returned).at(-1))) {
        inspect(shape);
        const d = readShapeDiagram(shape);
        // Relationship remapping may change prefixes, but the copied label is
        // retained as semantic XML rather than baked into data points.
        expect(
          serializeXml({ root: d.quickStyle.root, prolog: [], epilog: [] }),
        ).toContain(
          `name="${row.name.startsWith("matrix: ") ? "onlyStyle" : "unrelated"}"`,
        );
      }
    },
  );
});
