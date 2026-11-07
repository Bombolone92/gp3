import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { P } from "../src/model.js";
import { diagramDeck, diagramImage } from "./diagram-copy-fixture.js";
import { duotoneDeck } from "./duotone-fixture.js";
import { NS, parseXml } from "../lib/pptx/src/internal/xml/index.ts";
import { resolveTarget } from "../lib/pptx/src/internal/opc/index.ts";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";
import { SLIDE_PART_NAME } from "../lib/pptx/src/api/_internal-symbols.ts";

const decode = (p) => new TextDecoder().decode(p.data);
const elements = function* (e) {
  yield e;
  for (const c of e.children) if (c.kind === "element") yield* elements(c);
};
const attr = (e, name, ns = "") =>
  e.attrs.find((a) => a.name.localName === name && a.name.namespaceURI === ns)
    ?.value;
function inspect(pres, slide) {
  const pkg = P._internalPackageOf(pres),
    owner = slide[SLIDE_PART_NAME],
    rels = pkg.getRels(owner);
  const relationship = (id) => {
    const r = rels.items.find((r) => r.id === id);
    expect(r, `owner relationship ${id}`).toBeDefined();
    return r;
  };
  const part = (r) => {
    const p = pkg.getPart(resolveTarget(owner, r.target));
    expect(p).not.toBeNull();
    return p;
  };
  return [...elements(parseXml(decode(pkg.getPart(owner))).root)]
    .filter(
      (e) =>
        e.name.namespaceURI === NS.diagram && e.name.localName === "relIds",
    )
    .map((e) => {
      const parts = Object.fromEntries(
        ["dm", "lo", "qs", "cs"].map((key) => [
          key,
          part(relationship(attr(e, key, NS.officeDocRels))),
        ]),
      );
      const data = parseXml(decode(parts.dm)).root;
      const ext = [...elements(data)].find(
        (e) =>
          e.name.namespaceURI === NS.diagramDrawing &&
          e.name.localName === "dataModelExt",
      );
      const drawingRel = relationship(attr(ext, "relId"));
      expect(drawingRel.type).toBe(REL_TYPES.diagramDrawing);
      const drawing = part(drawingRel),
        drawingRels = pkg.getRels(drawing.name);
      const imageRel = drawingRels.items.find((r) => r.id === "image");
      expect(
        pkg.getPart(resolveTarget(drawing.name, imageRel.target)).data,
      ).toEqual(diagramImage);
      expect(drawingRels.items.find((r) => r.id === "visit").targetMode).toBe(
        "External",
      );
      const unrelated = [...elements(data)].find(
        (e) =>
          e.name.namespaceURI === "urn:other" &&
          e.name.localName === "dataModelExt",
      );
      expect(attr(unrelated, "relId")).toMatch(/^savedDrawing\d+$/);
      return { parts, drawing, drawingRel, drawingRels };
    });
}

describe("SmartArt copy dependencies", () => {
  it("copies a table without copying unselected diagrams on the same slide", async () => {
    const p = await diagramDeck(),
      s = P.getSlides(p)[0];
    const rows = Array.from({ length: 20 }, (_, row) =>
      Array.from({ length: 8 }, (_, col) => `${row}:${col}`),
    );
    const table = P.addSlideTable(s, {
      x: 0,
      y: 0,
      w: 5000000,
      h: 3000000,
      rows,
    });
    const dest = P.addSlide(p, { layout: P.getSlideLayouts(p)[0] }),
      pkg = P._internalPackageOf(p),
      count = pkg.parts.length;
    P.copyShape(dest, table);
    expect(pkg.parts).toHaveLength(count);
    expect(P.getSlideShapes(dest)).toHaveLength(1);
    expect(
      P.getTableCellText(P.getTableCell(P.getSlideShapes(dest)[0], 19, 7)),
    ).toBe("19:7");
    expect(
      pkg
        .getRels(dest[SLIDE_PART_NAME])
        .items.some((r) => r.type === REL_TYPES.diagramData),
    ).toBe(false);
  });
  it("preserves diagram dependencies inside compatibility alternatives in a copied group", async () => {
    const original = await diagramDeck({ group: true }),
      pkg = P._internalPackageOf(original),
      owner = P.getSlides(original)[0][SLIDE_PART_NAME],
      part = pkg.getPart(owner);
    part.data = new TextEncoder().encode(
      decode(part)
        .replace(
          "<p:graphicFrame>",
          `<mc:AlternateContent xmlns:mc="${NS.mc}"><mc:Choice Requires="dgm" xmlns:dgm="${NS.diagram}"><p:graphicFrame>`,
        )
        .replace(
          "</p:graphicFrame>",
          "</p:graphicFrame></mc:Choice><mc:Fallback/></mc:AlternateContent>",
        ),
    );
    const p = await P.loadPresentation(await P.savePresentation(original)),
      s = P.getSlides(p)[0],
      dest = P.addSlide(p, { layout: P.getSlideLayouts(p)[0] });
    P.copyShape(
      dest,
      P.getSlideShapes(s).find((sh) => P.getShapeKind(sh) === "group"),
    );
    expect(inspect(p, dest)).toHaveLength(2);
    const reopened = await P.loadPresentation(await P.savePresentation(p));
    expect(inspect(reopened, P.getSlides(reopened).at(-1))).toHaveLength(2);
  });
  it("keeps media references attached to their source when the owner changes directories", async () => {
    const initial = await P.loadPresentation(await duotoneDeck());
    const pkg = P._internalPackageOf(initial),
      original = P.getSlides(initial)[0][SLIDE_PART_NAME];
    const relocated = "/chapters/one/source.xml",
      part = pkg.getPart(original);
    pkg.addPart(relocated, part.contentType, part.data.slice());
    pkg.setRels(relocated, {
      items: pkg.getRels(original).items.map((r) => ({
        ...r,
        target:
          r.targetMode === "External"
            ? r.target
            : "../../" + resolveTarget(original, r.target).slice(1),
      })),
    });
    const presentationRels = pkg.getRels("/ppt/presentation.xml");
    presentationRels.items.find((r) => r.type === REL_TYPES.slide).target =
      relocated;
    pkg.setRels("/ppt/presentation.xml", presentationRels);
    const p = await P.loadPresentation(await P.savePresentation(initial)),
      s = P.getSlides(p)[0];
    const destination = P.addSlide(p, { layout: P.getSlideLayouts(p)[0] });
    P.copyShape(destination, P.getSlideShapes(s)[0]);
    const copiedPkg = P._internalPackageOf(p),
      owner = destination[SLIDE_PART_NAME];
    const image = copiedPkg
      .getRels(owner)
      .items.find((r) => r.type === REL_TYPES.image);
    expect(resolveTarget(owner, image.target)).toBe("/ppt/media/image1.png");
    expect(
      copiedPkg.getPart(resolveTarget(owner, image.target)),
    ).not.toBeNull();
  });
  it("preserves semantic diagrams that have no saved layout", async () => {
    const source = await diagramDeck({ count: 1 });
    const pkg = P._internalPackageOf(source);
    const data = pkg.getPart("/assets/smart/item0-data.xml");
    data.data = new TextEncoder().encode(
      decode(data).replace(
        /<a:ext uri="http:\/\/schemas.microsoft.com\/office\/drawing\/2008\/diagram">[\s\S]*?<\/a:ext>/,
        "",
      ),
    );
    const s = P.getSlides(source)[0];
    const target = P.addSlide(source, { layout: P.getSlideLayouts(source)[0] });
    P.copyShape(target, P.getSlideShapes(s)[0]);
    const rels = pkg.getRels(target[SLIDE_PART_NAME]);
    const modelRel = rels.items.find((r) => r.type === REL_TYPES.diagramData);
    expect(modelRel).toBeDefined();
    const copy = pkg.getPart(
      resolveTarget(target[SLIDE_PART_NAME], modelRel.target),
    );
    expect(decode(copy)).toBe(decode(data));
    expect(rels.items.some((r) => r.type === REL_TYPES.diagramDrawing)).toBe(
      false,
    );
    const reopened = await P.loadPresentation(await P.savePresentation(source));
    expect(P.getSlideShapes(P.getSlides(reopened).at(-1))).toHaveLength(1);
  });
  it("preserves both diagrams and all semantic/style/drawing/media parts across imports and export", async () => {
    const source = await diagramDeck(),
      sourceSlide = P.getSlides(source)[0],
      before = unzipSync(await P.savePresentation(source));
    const target = await diagramDeck(); // deliberately colliding names and IDs
    const imported = P.importSlide(
      target,
      sourceSlide,
      P.getSlideLayouts(target)[0],
    );
    const original = inspect(source, sourceSlide),
      copied = inspect(target, imported);
    expect(copied).toHaveLength(2);
    for (const [i, d] of copied.entries()) {
      for (const key of ["dm", "lo", "qs", "cs"])
        expect(decode(d.parts[key])).toBe(decode(original[i].parts[key]));
      expect(decode(d.drawing)).toBe(decode(original[i].drawing));
      expect(d.parts.dm.name).not.toBe(original[i].parts.dm.name);
    }
    expect(copied[0].parts.qs).toBe(copied[1].parts.qs);
    expect(unzipSync(await P.savePresentation(source))).toEqual(before);
    const reopened = await P.loadPresentation(await P.savePresentation(target));
    expect(inspect(reopened, P.getSlides(reopened).at(-1))).toHaveLength(2);
    const returned = P.importSlide(
      source,
      P.getSlides(reopened).at(-1),
      P.getSlideLayouts(source)[0],
    );
    expect(inspect(source, returned)).toHaveLength(2);
  });
  it.each([false, true])(
    "copies %s-grouped shapes with remapped frame and indirect drawing IDs",
    async (group) => {
      const p = await diagramDeck({ group }),
        s = P.getSlides(p)[0],
        source = inspect(p, s),
        before = source.map((d) => decode(d.parts.dm));
      const dest = P.addSlide(p, { layout: P.getSlideLayouts(p)[0] });
      for (const shape of group
        ? P.getSlideShapes(s).filter((sh) => P.getShapeKind(sh) === "group")
        : P.getSlideShapes(s))
        P.copyShape(dest, shape);
      const copied = inspect(p, dest);
      expect(copied).toHaveLength(2);
      for (const [i, d] of copied.entries()) {
        expect(d.parts.dm.name).not.toBe(source[i].parts.dm.name);
        expect(d.drawingRel.id).not.toBe(source[i].drawingRel.id);
        expect(decode(d.drawing)).toBe(decode(source[i].drawing));
        expect(decode(source[i].parts.dm)).toBe(before[i]);
      }
      const reopened = await P.loadPresentation(await P.savePresentation(p));
      expect(inspect(reopened, P.getSlides(reopened).at(-1))).toHaveLength(2);
    },
  );
  it("copies within a slide without sharing mutable diagram data", async () => {
    const p = await diagramDeck({ count: 1 }),
      s = P.getSlides(p)[0];
    P.copyShape(s, P.getSlideShapes(s)[0]);
    const diagrams = inspect(p, s);
    expect(diagrams).toHaveLength(2);
    expect(diagrams[0].parts.dm.name).not.toBe(diagrams[1].parts.dm.name);
    expect(diagrams[0].drawing.name).not.toBe(diagrams[1].drawing.name);
  });
});
