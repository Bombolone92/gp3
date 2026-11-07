import { describe, expect, it } from "vitest";
import { diagramDeck } from "./diagram-copy-fixture.js";
import { P } from "../src/model.js";
import {
  isDiagramShape,
  readShapeDiagram,
} from "../lib/pptx/src/api/fn/diagram-read.ts";
import {
  INTERNAL_PACKAGE,
  SHAPE_SLIDE,
  SLIDE_PART_NAME,
} from "../lib/pptx/src/api/_internal-symbols.ts";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";

const encode = (s) => new TextEncoder().encode(s);
const decode = (b) => new TextDecoder().decode(b);
const frames = (pres) =>
  P.getSlideShapes(P.getSlides(pres)[0]).filter(isDiagramShape);

describe("SmartArt source parts", () => {
  it("resolves each frame's explicit saved drawing from the enclosing slide", async () => {
    const pres = await diagramDeck();
    const pkg = P._internalPackageOf(pres);
    const before = pkg.parts.map((p) => [p.name, p.data.slice()]);
    const diagrams = frames(pres).map(readShapeDiagram);
    expect(diagrams).toHaveLength(2);
    for (let i = 0; i < diagrams.length; i++) {
      const d = diagrams[i];
      expect(d.issues).toEqual([]);
      expect(d.data.part.name).toBe(`/assets/smart/item${i}-data.xml`);
      expect(d.drawing.part.name).toBe(`/assets/smart/item${i}-drawing.xml`);
      expect(d.model.points[0].id).toBe(`node-${i}`);
      expect(d.quickStyle.part.name).toBe("/assets/smart/shared-style.xml");
      expect(d.owner).toBe(P.getSlidePartName(P.getSlides(pres)[0]));
    }
    expect(pkg.parts.map((p) => [p.name, p.data])).toEqual(before);
  });

  it("uses the containing part for diagrams on layouts as well as slides", async () => {
    const pres = await diagramDeck({ count: 1 });
    const shape = frames(pres)[0],
      pkg = P._internalPackageOf(pres);
    const owner = shape[SHAPE_SLIDE][SLIDE_PART_NAME];
    const layoutName = "/templates/custom-layout.xml";
    pkg.setRels(layoutName, pkg.getRels(owner));
    const view = {
      ...shape,
      [SHAPE_SLIDE]: { ...shape[SHAPE_SLIDE], [SLIDE_PART_NAME]: layoutName },
    };
    const diagram = readShapeDiagram(view);
    expect(diagram.owner).toBe(layoutName);
    expect(diagram.drawing.part.name).toBe("/assets/smart/item0-drawing.xml");
    expect(diagram.issues).toEqual([]);
  });

  it("refreshes semantic data and saved drawing references after part replacement", async () => {
    const pres = await diagramDeck();
    const shape = frames(pres)[0];
    const before = readShapeDiagram(shape);
    expect(readShapeDiagram(shape).model).toBe(before.model);
    before.data.part.data = encode(
      decode(before.data.part.data)
        .replace("Semantic 0", "Edited semantic text")
        .replace('relId="savedDrawing0"', 'relId="savedDrawing1"'),
    );
    const after = readShapeDiagram(shape);
    expect(after.model).not.toBe(before.model);
    expect(after.drawing.part.name).toBe("/assets/smart/item1-drawing.xml");
    expect(P.getShapeKind(shape)).toBe("graphicFrame");
  });

  it("observes relationship replacement without reusing a stale drawing or model from another package", async () => {
    const a = await diagramDeck(),
      b = await diagramDeck();
    const sa = frames(a)[0],
      sb = frames(b)[0];
    const da = readShapeDiagram(sa),
      db = readShapeDiagram(sb);
    expect(da.model).not.toBe(db.model);
    const pkg = a[INTERNAL_PACKAGE],
      rels = pkg.getRels(da.owner);
    rels.items.find((r) => r.id === "savedDrawing0").target =
      "/assets/smart/item1-drawing.xml";
    pkg.setRels(da.owner, rels);
    expect(readShapeDiagram(sa).drawing.part.name).toBe(
      "/assets/smart/item1-drawing.xml",
    );
    expect(readShapeDiagram(sb).drawing.part.name).toBe(
      "/assets/smart/item0-drawing.xml",
    );
  });

  it("keeps valid semantic content when no saved layout is present", async () => {
    const pres = await diagramDeck({ count: 1 });
    const shape = frames(pres)[0],
      data = readShapeDiagram(shape).data.part;
    data.data = encode(
      decode(data.data).replace(/<dgm:extLst>[\s\S]*<\/dgm:extLst>/, ""),
    );
    const d = readShapeDiagram(shape);
    expect(d.drawing).toBeNull();
    expect(d.model.points).toHaveLength(1);
    expect(d.layout).not.toBeNull();
    expect(d.issues).toEqual([]);
  });

  it("diagnoses broken links without fetching external targets or choosing another drawing", async () => {
    const pres = await diagramDeck();
    const shape = frames(pres)[0],
      pkg = P._internalPackageOf(pres);
    const d = readShapeDiagram(shape),
      rels = pkg.getRels(d.owner);
    const drawing = rels.items.find((r) => r.id === "savedDrawing0");
    drawing.target = "https://example.org/diagram.xml";
    drawing.targetMode = "External";
    pkg.setRels(d.owner, rels);
    const result = readShapeDiagram(shape);
    expect(result.drawing).toBeNull();
    expect(result.model.points).toHaveLength(1);
    expect(result.issues).toEqual([
      "diagram drawing relationship savedDrawing0 is invalid",
    ]);
    drawing.targetMode = "Internal";
    drawing.target = "/missing.xml";
    pkg.setRels(d.owner, rels);
    expect(readShapeDiagram(shape).issues).toEqual([
      "diagram drawing part is missing",
    ]);
    drawing.target = "/assets/smart/item1-drawing.xml";
    drawing.type = REL_TYPES.image;
    pkg.setRels(d.owner, rels);
    expect(readShapeDiagram(shape).drawing).toBeNull();
  });

  it("diagnoses conflicting references and malformed data independently of other parts", async () => {
    const pres = await diagramDeck({ count: 1 }),
      shape = frames(pres)[0];
    const d = readShapeDiagram(shape),
      original = d.data.part.data;
    d.data.part.data = encode(
      decode(original).replace(
        "<cache:dataModelExt ",
        '<cache:dataModelExt relId="another"/><cache:dataModelExt ',
      ),
    );
    expect(readShapeDiagram(shape).issues).toContain(
      "diagram has conflicting saved drawing references",
    );
    d.data.part.data = encode(
      `<d:dataModel xmlns:d="${NS.diagram}"><d:ptLst><d:pt/></d:ptLst></d:dataModel>`,
    );
    const bad = readShapeDiagram(shape);
    expect(bad.model).toBeNull();
    expect(bad.layout).not.toBeNull();
    expect(bad.issues).toContain("diagram pt is missing modelId");
    d.data.part.data = encode('<other xmlns="urn:other"/>');
    expect(readShapeDiagram(shape).issues).toContain(
      "diagram dataModel part has an unexpected root",
    );
    d.data.part.data = original;
    expect(readShapeDiagram(shape).issues).toEqual([]);
  });

  it("leaves ordinary shapes outside the diagram read path", async () => {
    const pres = await diagramDeck({ count: 0 });
    const slide = P.getSlides(pres)[0];
    const shape = P.addSlideTextBox(slide, {
      x: 0,
      y: 0,
      w: 100000,
      h: 100000,
      text: "Ordinary",
    });
    expect(isDiagramShape(shape)).toBe(false);
    expect(readShapeDiagram(shape)).toBeNull();
  });
});
