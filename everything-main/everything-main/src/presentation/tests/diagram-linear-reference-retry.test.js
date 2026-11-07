import { describe, expect, it } from "vitest";
import native from "./data/diagram-linear-reference-retry-native.json";
import { parseXml, serializeXml } from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { reflowDiagramLayout } from "../lib/pptx/src/internal/diagram/reflow.ts";
import { reflowShapeDiagram } from "../lib/pptx/src/api/fn/diagram-reflow.ts";
import { isDiagramShape } from "../lib/pptx/src/api/fn/diagram-read.ts";
import { P, createDeck } from "../src/model.js";
import { semanticTextGroupDeck } from "./diagram-text-group-fixture.js";
import { unzipSync } from "fflate";

const textFits = () => ({ fits: false, heightFits: false });
const expectGeometry = (result, row) => {
  const actual = [...result.bounds].map(([node, bounds]) => ({
    name: node.name,
    bounds,
  }));
  expect(actual.map((entry) => entry.name)).toEqual(
    row.expected.map((entry) => entry.name),
  );
  for (const [index, entry] of actual.entries())
    for (const axis of ["x", "y", "w", "h"])
      expect(
        Math.abs(
          Math.floor(entry.bounds[axis] * 36000) -
            row.expected[index].bounds[axis],
        ),
        `${entry.name}.${axis}`,
      ).toBeLessThanOrEqual(1);
};

describe("linear content retry reference scopes", () => {
  it.each([
    ["norm", "nonAsst"],
    ["nonAsst", "norm"],
  ])("shares retry declarations between %s and %s selectors", (base, bound) => {
    const row = native.cases.find((row) => row.name === "fromL 31 height-rule");
    const layout = native.layouts[row.layout]
      .replace(
        'val="41" forName="query"',
        `val="41" ptType="${base}" forName="query"`,
      )
      .replace('refForName="query"', `refForName="query" refPtType="${bound}"`)
      .replace(
        "</dgm:constrLst>",
        `<dgm:constr type="w" for="ch" forName="query" ptType="${bound}" op="lte" val="41" /></dgm:constrLst>`,
      )
      .replace(
        /<dgm:layoutNode name="query">[\s\S]*?<\/dgm:layoutNode>/,
        (query) =>
          `<dgm:forEach axis="ch" ptType="node">${query.replace('axis="ch" ptType="node"', 'axis="self"')}</dgm:forEach>`,
      );
    const root = expandDiagramLayout(
      parseXml(layout).root,
      readDiagramHierarchy(
        readDiagramDataModel(parseXml(native.models[row.model]).root),
      ),
    );
    // Adding an equivalent selector bound must not create a second writable
    // variable when the fitted allocation becomes the next reference scope.
    expectGeometry(reflowDiagramLayout(root, row.available, { textFits }), row);
  });

  it.each(native.cases)("preserves native scope semantics: $name", (row) => {
    const data = parseXml(native.models[row.model]);
    const layout = parseXml(native.layouts[row.layout]);
    const before = serializeXml(layout);
    const root = expandDiagramLayout(
      layout.root,
      readDiagramHierarchy(readDiagramDataModel(data.root)),
    );
    const result = reflowDiagramLayout(root, row.available, {
      // Browser measurements verify that text remains overflowing at the
      // limits in these controls. Isolate scope/geometry from font metrics.
      textFits,
    });
    expectGeometry(result, row);
    expect(serializeXml(layout)).toBe(before);
  });

  it.each([
    "fromL 31 height-rule",
    "fromR 70 height-rule descendant-override",
    "fromT 31 vertical-height-rule",
  ])("preserves %s through copying and PPTX round trips", async (name) => {
    const row = native.cases.find((row) => row.name === name);
    const { p, frame } = await semanticTextGroupDeck({
      ...row,
      data: native.models[row.model],
      layout: native.layouts[row.layout],
    });
    const before = unzipSync(await P.savePresentation(p));
    expectGeometry(reflowShapeDiagram(frame, { textFits }), row);
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);

    const target = createDeck("blank");
    const staging = P.importSlide(
      target,
      P.getSlides(p)[0],
      P.getSlideLayouts(target)[0],
    );
    P.copyShape(
      P.getSlides(target)[0],
      P.getSlideShapes(staging).find(isDiagramShape),
    );
    P.removeSlide(target, staging);
    P.compactPackage(target);
    const reopened = await P.loadPresentation(await P.savePresentation(target));
    const copiedSlide = P.getSlides(reopened)[0];
    const copied = P.getSlideShapes(copiedSlide).find(isDiagramShape);
    expectGeometry(reflowShapeDiagram(copied, { textFits }), row);
    const returnedSlide = P.importSlide(
      p,
      copiedSlide,
      P.getSlideLayouts(p)[0],
    );
    expectGeometry(
      reflowShapeDiagram(P.getSlideShapes(returnedSlide).find(isDiagramShape), {
        textFits,
      }),
      row,
    );
  });
});
