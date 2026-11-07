import { describe, it, expect, vi } from "vitest";
import { P } from "../src/model.js";
import { connectorCopyDeck, connections } from "./connector-copy-fixture.js";
import { diagramDeck } from "./diagram-copy-fixture.js";
import { SHAPE_ELEMENT } from "../lib/pptx/src/api/_internal-symbols.ts";
import {
  NS,
  parseXml,
  walkElements,
  qname,
  getAttrValue,
} from "../lib/pptx/src/internal/xml/index.ts";

// The fallback also permits these controls to measure the previous public
// copy operation in a baseline checkout; the current API uses one batch.
const batch = (slide, shapes) =>
  P.copyShapes
    ? P.copyShapes(slide, shapes)
    : shapes.map((shape) => P.copyShape(slide, shape));
const target = (p) => P.addSlide(p, { layout: P.getSlideLayouts(p)[0] });
const nativeIds = (slide) => {
  const ids = [];
  walkElements(parseXml(P.getSlideXmlString(slide)).root, (el) => {
    if (el.name.namespaceURI === NS.pml && el.name.localName === "cNvPr")
      ids.push(getAttrValue(el, qname("", "id", "")));
  });
  return ids;
};
const attachment = (shapes) => {
  const line = shapes.find((s) => P.getShapeKind(s) === "connector"),
    boxes = shapes.filter((s) => P.getShapeName(s).startsWith("Endpoint"));
  expect(connections(line)).toEqual([
    { end: "stCxn", id: String(P.getShapeId(boxes[0])), site: "2" },
    { end: "endCxn", id: String(P.getShapeId(boxes[1])), site: "0" },
  ]);
};
const snapshot = (p) =>
  P._internalPackageOf(p).parts.map((part) => [part.name, part.data.slice()]);

describe("native connector identities during copying", () => {
  it("exports the owned original without changing its attachment XML", async () => {
    const { p, slide } = await connectorCopyDeck(),
      before = P.getSlideXmlString(slide);
    attachment(P.getSlideShapes(slide));
    const q = await P.loadPresentation(await P.savePresentation(p));
    expect(P.getSlideXmlString(P.getSlides(q)[0])).toBe(before);
  });
  it.each([false, true])(
    "rebinds a batch with forward references (same slide: %s)",
    async (same) => {
      const { p, slide } = await connectorCopyDeck(),
        source = P.getSlideShapes(slide),
        before = source.map(P.getShapeXmlString),
        to = same ? slide : target(p),
        copies = batch(to, source);
      attachment(copies);
      expect(source.map(P.getShapeXmlString)).toEqual(before);
      expect(new Set(nativeIds(to)).size).toBe(nativeIds(to).length);
      const q = await P.loadPresentation(await P.savePresentation(p)),
        reopened = P.getSlides(q)[same ? 0 : 1];
      attachment(P.getSlideShapes(reopened).slice(same ? 3 : 0));
    },
  );
  it.each([false, true])(
    "rebinds connections inside a copied group (same slide: %s)",
    async (same) => {
      const { p, slide } = await connectorCopyDeck({ grouped: true }),
        original = P.getSlideShapes(slide)[0],
        before = P.getShapeXmlString(original),
        to = same ? slide : target(p),
        copy = P.copyShape(to, original);
      attachment(P.getGroupChildren(copy));
      expect(P.getShapeXmlString(original)).toBe(before);
      expect(new Set(nativeIds(to)).size).toBe(nativeIds(to).length);
      const extra = P.addSlideTextBox(to, {
        x: 100,
        y: 100,
        w: 1000,
        h: 1000,
        text: "Later shape",
      });
      expect(
        nativeIds(to).filter((id) => id === String(P.getShapeId(extra))),
      ).toHaveLength(1);
    },
  );
  it("copies selected group children as one connected batch", async () => {
    const { p, slide } = await connectorCopyDeck({ grouped: true }),
      group = P.getSlideShapes(slide)[0];
    attachment(batch(target(p), P.getGroupChildren(group)));
  });
  it("copies nested groups and connections between groups", async () => {
    const { p, slide } = await connectorCopyDeck(),
      shapes = P.getSlideShapes(slide);
    const spare = P.addSlideShape(slide, {
      preset: "ellipse",
      x: 100,
      y: 100,
      w: 1000,
      h: 1000,
    });
    const inner = P.groupShapes([shapes[1], spare]),
      outer = P.groupShapes([inner, shapes[2]]);
    const copies = batch(target(p), [shapes[0], outer]);
    const descendants = [...P.getGroupChildren(copies[1])];
    attachment([
      copies[0],
      ...P.getGroupChildren(descendants[0]),
      descendants[1],
    ]);
  });
  it("retains uncopied endpoints on the same slide", async () => {
    const { slide } = await connectorCopyDeck(),
      line = P.getSlideShapes(slide)[0];
    expect(connections(P.copyShape(slide, line))).toEqual(connections(line));
  });
  it("detaches uncopied endpoints across slides without changing geometry", async () => {
    const { p, slide } = await connectorCopyDeck(),
      line = P.getSlideShapes(slide)[0],
      copy = P.copyShape(target(p), line);
    expect(connections(copy)).toEqual([]);
    expect(P.getShapeBounds(copy)).toEqual(P.getShapeBounds(line));
    expect(P.getShapeStrokeFormattingEffective(copy)).toEqual(
      P.getShapeStrokeFormattingEffective(line),
    );
  });
  it("remaps a copied endpoint while detaching the other across slides", async () => {
    const { p, slide } = await connectorCopyDeck(),
      [line, first] = P.getSlideShapes(slide),
      copies = batch(target(p), [line, first]);
    expect(connections(copies[0])).toEqual([
      { end: "stCxn", id: String(P.getShapeId(copies[1])), site: "2" },
    ]);
  });
  it("retains an uncopied endpoint while remapping the other on the same slide", async () => {
    const { slide } = await connectorCopyDeck(),
      [line, first, second] = P.getSlideShapes(slide),
      copies = batch(slide, [line, first]);
    expect(connections(copies[0])).toEqual([
      { end: "stCxn", id: String(P.getShapeId(copies[1])), site: "2" },
      { end: "endCxn", id: String(P.getShapeId(second)), site: "0" },
    ]);
  });
  it("leaves foreign lookalikes and unrelated attributes intact", async () => {
    const { p, slide } = await connectorCopyDeck(),
      [line] = P.getSlideShapes(slide),
      root = line[SHAPE_ELEMENT];
    root.children.push(
      parseXml(
        `<x:opaque xmlns:x="urn:owned:foreign"><x:stCxn id="47" idx="9"/><x:cNvPr id="999"/></x:opaque>`,
      ).root,
    );
    P.renameShape(line, "Attached line");
    const copy = batch(target(p), P.getSlideShapes(slide))[0],
      xml = P.getShapeXmlString(copy);
    expect(xml).toContain('<x:stCxn id="47" idx="9"');
    expect(xml).toContain('<x:cNvPr id="999"');
  });
  it("keeps malformed connection IDs intact instead of interpreting a numeric prefix", async () => {
    const { p, slide } = await connectorCopyDeck(),
      line = P.getSlideShapes(slide)[0];
    walkElements(line[SHAPE_ELEMENT], (el) => {
      if (el.name.namespaceURI === NS.dml && el.name.localName === "stCxn")
        el.attrs.find((a) => a.name.localName === "id").value = "47bad";
    });
    P.renameShape(line, "Attached line");
    expect(
      connections(batch(target(p), P.getSlideShapes(slide))[0])[0].id,
    ).toBe("47bad");
  });
  it("scopes equal source IDs to their owning slides", async () => {
    const { p, slide } = await connectorCopyDeck(),
      second = P.duplicateSlide(p, slide),
      to = target(p),
      a = P.getSlideShapes(slide),
      b = P.getSlideShapes(second),
      copies = batch(to, [...a, ...b]);
    attachment(copies.slice(0, 3));
    attachment(copies.slice(3));
  });
  it("rejects repeated and overlapping sources before mutation", async () => {
    const { p, slide } = await connectorCopyDeck({ grouped: true }),
      group = P.getSlideShapes(slide)[0],
      child = P.getGroupChildren(group)[0],
      to = target(p),
      before = snapshot(p);
    expect(() => batch(to, [group, group])).toThrow();
    expect(() => batch(to, [group, child])).toThrow();
    expect(snapshot(p)).toEqual(before);
  });
  it("rejects a cross-package member before adding any copy", async () => {
    const { p, slide } = await connectorCopyDeck(),
      { slide: other } = await connectorCopyDeck(),
      to = target(p),
      before = snapshot(p);
    expect(() =>
      batch(to, [P.getSlideShapes(slide)[0], P.getSlideShapes(other)[0]]),
    ).toThrow(/same package/);
    expect(snapshot(p)).toEqual(before);
  });
  it("reserves the entire batch before mutation when unsigned shape IDs are exhausted", async () => {
    const { p, slide } = await connectorCopyDeck(),
      to = target(p),
      box = P.addSlideTextBox(to, {
        x: 100,
        y: 100,
        w: 1000,
        h: 1000,
        text: "High identity",
      });
    walkElements(box[SHAPE_ELEMENT], (el) => {
      if (el.name.namespaceURI === NS.pml && el.name.localName === "cNvPr")
        el.attrs.find((a) => a.name.localName === "id").value = "4294967294";
    });
    P.renameShape(box, "High identity");
    const before = snapshot(p);
    expect(() => batch(to, P.getSlideShapes(slide))).toThrow(
      /shape.*[Ii][Dd]|identit/i,
    );
    expect(snapshot(p)).toEqual(before);
  });
  it("treats an empty batch as a no-op", async () => {
    const { p, slide } = await connectorCopyDeck(),
      before = snapshot(p);
    expect(batch(slide, [])).toEqual([]);
    expect(snapshot(p)).toEqual(before);
  });
  it("reserves distinct field identities for independent roots in the same batch", async () => {
    const { p, slide } = await connectorCopyDeck(),
      shapes = P.getSlideShapes(slide);
    const token = "{4FBFE2A1-3954-4361-91F4-8C8E940F0506}";
    for (const box of shapes.slice(1)) {
      walkElements(box[SHAPE_ELEMENT], (el) => {
        if (el.name.namespaceURI === NS.dml && el.name.localName === "p")
          el.children = parseXml(
            `<a:p xmlns:a="${NS.dml}"><a:fld id="${token}" type="owned.custom"><a:rPr sz="1500"/><a:t>Live field</a:t></a:fld></a:p>`,
          ).root.children;
      });
    }
    P.renameShape(shapes[1], "Endpoint 1");
    const fields = (shape) => {
      const ids = [];
      walkElements(parseXml(P.getShapeXmlString(shape)).root, (el) => {
        if (el.name.namespaceURI === NS.dml && el.name.localName === "fld")
          ids.push(getAttrValue(el, qname("", "id", "")));
      });
      return ids;
    };
    const random = vi
      .spyOn(crypto, "getRandomValues")
      .mockImplementationOnce((bytes) => bytes.fill(1))
      .mockImplementationOnce((bytes) => bytes.fill(1))
      .mockImplementationOnce((bytes) => bytes.fill(2));
    try {
      const copies = batch(target(p), shapes.slice(1)),
        ids = copies.flatMap(fields);
      expect(new Set(ids).size).toBe(2);
      expect(ids).not.toContain(token);
      expect(random).toHaveBeenCalledTimes(3);
      expect(shapes.slice(1).flatMap(fields)).toEqual([token, token]);
    } finally {
      random.mockRestore();
    }
  });
  it("rolls back earlier graph copies when a later dependency is missing", async () => {
    const p = await diagramDeck({ count: 2 }),
      slide = P.getSlides(p)[0],
      to = target(p),
      pkg = P._internalPackageOf(p);
    pkg.removePart("/assets/smart/item1-drawing.xml");
    const before = snapshot(p),
      types = structuredClone(pkg.contentTypes),
      xml = P.getSlideXmlString(to);
    expect(() => batch(to, P.getSlideShapes(slide))).toThrow();
    expect(snapshot(p)).toEqual(before);
    expect(pkg.contentTypes).toEqual(types);
    expect(P.getSlideXmlString(to)).toBe(xml);
    expect(P.getSlideShapes(to)).toEqual([]);
  });
});
