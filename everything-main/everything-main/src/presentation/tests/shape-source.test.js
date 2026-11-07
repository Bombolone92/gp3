import { describe, expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import {
  NS,
  parseXml,
  walkElements,
  qname,
  elem,
  serializeFragment,
} from "../lib/pptx/src/internal/xml/index.ts";
import {
  readGroupChildren,
  REL_TYPES,
} from "../lib/pptx/src/internal/presentationml/index.ts";
import {
  SHAPE_ELEMENT,
  SHAPE_SLIDE,
  SHAPE_SNAPSHOT,
  SHAPE_XML_SOURCES,
  SLIDE_PART_NAME,
} from "../lib/pptx/src/api/_internal-symbols.ts";
import {
  cloneShapeSource,
  shapeRelationshipOwner,
} from "../lib/pptx/src/api/fn/shape-source.ts";
import { themeForShape } from "../lib/pptx/src/api/fn/shape-theme.ts";

const drawingOwner = "/assets/drawings/view.xml";
const textOwner = "/data/semantic.xml";
const picture =
  '<p:pic><p:nvPicPr><p:cNvPr id="0" name="Image"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="media" r:link="external"/></p:blipFill><p:spPr/></p:pic>';
const textShape =
  '<p:sp><p:nvSpPr><p:cNvPr id="0" name="Text"><a:hlinkClick r:id="link"/></p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:blipFill><a:blip r:embed="media" r:link="external"/></a:blipFill></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:buBlip><a:blip r:embed="media"/></a:buBlip></a:pPr><a:r><a:rPr><a:hlinkClick r:id="link"/></a:rPr><a:t>Linked text</a:t></a:r></a:p></p:txBody></p:sp>';
const group = (contents) =>
  `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="0" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${contents}</p:grpSp>`;
const relation = (id, type, target, targetMode = "Internal") => ({
  id,
  type,
  target,
  targetMode,
});
const element = (root, local) => {
  let result = null;
  walkElements(root, (n) => {
    if (!result && n.name.localName === local) result = n;
  });
  return result;
};

describe("display XML copies", () => {
  it("preserves all XML node kinds and namespace scopes in independent views", () => {
    const xml =
      '<x:root xmlns:x="urn:root" xmlns:r="urn:rels" r:id="root" plain="value">text<![CDATA[<raw>]]><!--note--><?view preserve?><x:child xmlns:x="urn:child" r:id="child"/></x:root>';
    const source = parseXml(xml).root;
    const before = serializeFragment(source);
    const sources = new WeakMap();
    const first = cloneShapeSource(source, drawingOwner, sources);
    const second = cloneShapeSource(source, drawingOwner, sources);
    expect(first).toEqual(structuredClone(source));
    expect(serializeFragment(first)).toBe(before);
    first.name.localName = "changed";
    first.attrs[0].name.prefix = "changed";
    first.attrs[1].value = "changed";
    first.prefixDecls.set("x", "urn:changed");
    for (const node of first.children) {
      if (node.kind === "element") {
        node.name.localName = "changed";
        node.prefixDecls.clear();
        node.attrs[0].value = "changed";
        node.children.push({ kind: "text", data: "changed" });
      } else {
        node.data = "changed";
        if (node.kind === "pi") node.target = "changed";
      }
    }
    first.children.reverse();
    expect(serializeFragment(source)).toBe(before);
    expect(serializeFragment(second)).toBe(before);
    source.attrs[1].value = "edited";
    const later = cloneShapeSource(source, drawingOwner, sources);
    expect(later.attrs[1].value).toBe("edited");
    expect(second.attrs[1].value).toBe("value");
  });

  it("retains per-element relationship owners through successive copies", () => {
    const {
      slide,
      handles: [shape],
    } = fixture();
    const sources = shape[SHAPE_XML_SOURCES];
    // A missing entry uses this copy's owner, independently of its parent.
    sources.delete(shape[SHAPE_ELEMENT]);
    const first = cloneShapeSource(shape[SHAPE_ELEMENT], drawingOwner, sources);
    const second = cloneShapeSource(first, "/different/fallback.xml", sources);
    const copied = {
      [SHAPE_ELEMENT]: second,
      [SHAPE_SNAPSHOT]: readGroupChildren(groupElement(second))[0],
      [SHAPE_SLIDE]: slide,
      [SHAPE_XML_SOURCES]: sources,
    };
    expect(sources.get(second)).toBe(drawingOwner);
    expect(sources.get(element(second, "txBody"))).toBe(textOwner);
    expect(P.getShapeRunHyperlink(copied, 0, 0)).toBe(
      "https://example.org/text",
    );
    expect(P.getShapeImageFillBytes(copied)).toEqual(
      P.getShapeImageFillBytes(shape),
    );
    expect(P.getParagraphBulletImageBytes(copied, 0)).toEqual(
      P.getParagraphBulletImageBytes(shape, 0),
    );
  });

  it("copies deeply nested extension XML without recursive tree walks", () => {
    const root = elem(qname("x", "extension", "urn:extension"));
    let source = root;
    const depth = 5000;
    for (let i = 0; i < depth; i++) {
      const next = elem(qname("x", "child", "urn:extension"));
      source.children.push(next);
      source = next;
    }
    source.children.push({ kind: "text", data: "leaf" });
    const sources = new WeakMap([[source, textOwner]]);
    let copy = cloneShapeSource(root, drawingOwner, sources);
    for (let i = 0; i < depth; i++) {
      expect(sources.get(copy)).toBe(drawingOwner);
      copy = copy.children[0];
    }
    expect(sources.get(copy)).toBe(textOwner);
    expect(copy.children).toEqual([{ kind: "text", data: "leaf" }]);
    copy.children[0].data = "changed";
    expect(source.children[0].data).toBe("leaf");
  });
});

const groupElement = (child) =>
  elem(qname("p", "grpSp", NS.pml), { children: [child] });

function fixture({ nested = false } = {}) {
  const pres = createDeck("blank"),
    pkg = P._internalPackageOf(pres),
    slide = P.getSlides(pres)[0];
  const root = parseXml(
    `<p:grpSp xmlns:p="${NS.pml}" xmlns:a="${NS.dml}" xmlns:r="${NS.officeDocRels}">${nested ? group(textShape + picture) : textShape + picture}</p:grpSp>`,
  ).root;
  const sources = new WeakMap();
  walkElements(root, (n) => {
    sources.set(n, drawingOwner);
  });
  walkElements(element(root, "txBody"), (n) => {
    sources.set(n, textOwner);
  });
  const handles = readGroupChildren(root).map((s) => ({
    [SHAPE_ELEMENT]: s.element,
    [SHAPE_SNAPSHOT]: s,
    [SHAPE_SLIDE]: slide,
    [SHAPE_XML_SOURCES]: sources,
  }));
  pkg.addPart("/assets/pixel.bin", "image/png", new Uint8Array([1, 2, 3]));
  pkg.addPart("/data/bullet.bin", "image/png", new Uint8Array([4, 5, 6]));
  pkg.setRels(drawingOwner, {
    items: [
      relation("media", REL_TYPES.image, "../pixel.bin"),
      relation(
        "link",
        REL_TYPES.hyperlink,
        "https://example.org/shape",
        "External",
      ),
      relation(
        "external",
        REL_TYPES.image,
        "https://example.org/image",
        "External",
      ),
    ],
  });
  pkg.setRels(textOwner, {
    items: [
      relation("media", REL_TYPES.image, "bullet.bin"),
      relation(
        "link",
        REL_TYPES.hyperlink,
        "https://example.org/text",
        "External",
      ),
    ],
  });
  const rels = pkg.getRels(slide[SLIDE_PART_NAME]);
  rels.items.push(
    relation(
      "link",
      REL_TYPES.hyperlink,
      "https://example.org/wrong",
      "External",
    ),
    relation("media", REL_TYPES.image, "/data/bullet.bin"),
  );
  pkg.setRels(slide[SLIDE_PART_NAME], rels);
  return { pres, pkg, slide, root, sources, handles };
}

describe("XML relationship provenance for read-only shape views", () => {
  it("resolves geometry, text and bullets against their separate source parts despite identical IDs", () => {
    const {
      pkg,
      handles: [shape, picture],
    } = fixture();
    const before = pkg.parts.map((p) => [p.name, p.data.slice()]);
    expect(P.getShapeImageFillBytes(shape)).toEqual(new Uint8Array([1, 2, 3]));
    expect(P.getShapeImageBytes(picture)).toEqual(new Uint8Array([1, 2, 3]));
    expect(P.getShapeImagePartName(shape)).toBe("/assets/pixel.bin");
    expect(P.getShapeImagePartName(picture)).toBe("/assets/pixel.bin");
    expect(P.getShapeImageLinkUrl(shape)).toBe("https://example.org/image");
    expect(P.getShapeImageLinkUrl(picture)).toBe("https://example.org/image");
    expect(P.getParagraphBulletImageBytes(shape, 0)).toEqual(
      new Uint8Array([4, 5, 6]),
    );
    expect(P.getShapeHyperlink(shape)).toBe("https://example.org/text");
    expect(P.getShapeRunHyperlink(shape, 0, 0)).toBe(
      "https://example.org/text",
    );
    expect(P.getShapeRunClickAction(shape, 0, 0)).toEqual({
      kind: "url",
      url: "https://example.org/text",
    });
    expect(P.getShapeClickAction(shape)).toEqual({
      kind: "url",
      url: "https://example.org/shape",
    });
    expect(pkg.parts.map((p) => [p.name, p.data])).toEqual(before);
  });

  it("retains provenance through nested groups without changing theme ownership", () => {
    const {
      handles: [group],
      slide,
      sources,
    } = fixture({ nested: true });
    const [shape, picture] = P.getGroupChildren(group);
    expect(shape[SHAPE_SLIDE]).toBe(slide);
    expect(shape[SHAPE_XML_SOURCES]).toBe(sources);
    expect(picture[SHAPE_XML_SOURCES]).toBe(sources);
    expect(P.getShapeRunHyperlink(shape, 0, 0)).toBe(
      "https://example.org/text",
    );
    expect(P.getShapeImageBytes(picture)).toEqual(new Uint8Array([1, 2, 3]));
    const plain = { ...shape };
    delete plain[SHAPE_XML_SOURCES];
    expect(themeForShape(shape)).toBe(themeForShape(plain));
  });

  it("resolves slide jumps relative to the part that authored the link", () => {
    const {
      pres,
      pkg,
      slide,
      handles: [shape],
    } = fixture();
    const target = P.addSlide(pres, { layout: P.getSlideLayouts(pres)[0] });
    for (const owner of [textOwner, drawingOwner]) {
      const rels = pkg.getRels(owner);
      const link = rels.items.find((r) => r.id === "link");
      link.type = REL_TYPES.slide;
      link.targetMode = "Internal";
      link.target = `${owner === textOwner ? ".." : "../.."}${target[SLIDE_PART_NAME]}`;
      pkg.setRels(owner, rels);
    }
    walkElements(shape[SHAPE_ELEMENT], (n) => {
      if (n.name.localName === "hlinkClick")
        n.attrs.push({
          name: qname("", "action", ""),
          value: "ppaction://hlinksldjump",
        });
    });
    expect(P.getShapeClickAction(shape).slide[SLIDE_PART_NAME]).toBe(
      target[SLIDE_PART_NAME],
    );
    expect(P.getShapeRunClickAction(shape, 0, 0).slide[SLIDE_PART_NAME]).toBe(
      target[SLIDE_PART_NAME],
    );
    expect(shape[SHAPE_SLIDE]).toBe(slide);
  });

  it("does not fall back to an unrelated slide relationship when a bound source is missing", () => {
    const {
      pkg,
      handles: [shape, picture],
    } = fixture();
    pkg.setRels(textOwner, { items: [] });
    pkg.setRels(drawingOwner, { items: [] });
    expect(P.getShapeImageFillBytes(shape)).toBeNull();
    expect(P.getShapeImageBytes(picture)).toBeNull();
    expect(P.getShapeImagePartName(shape)).toBeNull();
    expect(P.getShapeImageLinkUrl(shape)).toBeNull();
    expect(P.getParagraphBulletImageBytes(shape, 0)).toBeNull();
    expect(P.getShapeRunHyperlink(shape, 0, 0)).toBeNull();
    expect(P.getShapeHyperlink(shape)).toBeNull();
    expect(P.getShapeClickAction(shape)).toBeNull();
  });

  it("does not load external image references as package bytes", () => {
    const {
      pkg,
      handles: [shape, picture],
    } = fixture();
    for (const owner of [textOwner, drawingOwner]) {
      const rels = pkg.getRels(owner),
        media = rels.items.find((r) => r.id === "media");
      media.targetMode = "External";
      media.target = "https://example.org/remote.png";
      pkg.setRels(owner, rels);
    }
    expect(P.getShapeImageBytes(picture)).toBeNull();
    expect(P.getShapeImageFillBytes(shape)).toBeNull();
    expect(P.getShapeImagePartName(shape)).toBeNull();
    expect(P.getParagraphBulletImageBytes(shape, 0)).toBeNull();
  });

  it("observes relationship replacement and leaves ordinary slide handles unchanged", () => {
    const {
      pkg,
      slide,
      handles: [shape],
    } = fixture();
    const plain = { ...shape };
    delete plain[SHAPE_XML_SOURCES];
    expect(P.getShapeRunHyperlink(plain, 0, 0)).toBe(
      "https://example.org/wrong",
    );
    expect(
      shapeRelationshipOwner(plain, element(plain[SHAPE_ELEMENT], "blip")),
    ).toBe(slide[SLIDE_PART_NAME]);
    pkg.setRels(textOwner, {
      items: [
        relation(
          "link",
          REL_TYPES.hyperlink,
          "https://example.org/updated",
          "External",
        ),
      ],
    });
    expect(P.getShapeRunHyperlink(shape, 0, 0)).toBe(
      "https://example.org/updated",
    );
    expect(P.getShapeRunHyperlink(plain, 0, 0)).toBe(
      "https://example.org/wrong",
    );
  });
});
