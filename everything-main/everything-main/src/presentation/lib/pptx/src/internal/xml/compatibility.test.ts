import { describe, expect, it } from "vitest";
import {
  effectiveChildElements,
  NS,
  parseXml,
  serializeXml,
  type XmlElement,
} from "./index.ts";

const understood = new Set<string>([NS.pml, NS.dml]);
const logical = (xml: string) => {
  const doc = parseXml(xml);
  const before = serializeXml(doc);
  const elements = [...effectiveChildElements(doc.root, understood)];
  expect(serializeXml(doc)).toBe(before);
  return elements.map((element) => element.name.localName);
};
const wrapper = (choices: string, fallback = "<p:fade/>") =>
  `<p:sld xmlns:p="${NS.pml}" xmlns:a="${NS.dml}" xmlns:m="${NS.mc}" xmlns:future="urn:unsupported"><p:cSld/><m:AlternateContent>${choices}<m:Fallback>${fallback}</m:Fallback></m:AlternateContent><p:timing/></p:sld>`;

describe("logical XML children through alternate content", () => {
  it("uses the first choice with all required namespace URIs supported", () => {
    expect(
      logical(
        wrapper(
          '<m:Choice Requires="p future"><p:cover/></m:Choice><m:Choice Requires="a p"><p:push/></m:Choice><m:Choice Requires="p"><p:wipe/></m:Choice>',
        ),
      ),
    ).toEqual(["cSld", "push", "timing"]);
  });
  it.each([
    "",
    'Requires=""',
    'Requires=" "',
    'Requires="unbound"',
    'Requires="future"',
    'Requires="p future"',
  ])(
    "uses fallback for malformed or unsupported requirements: %s",
    (attribute) => {
      expect(
        logical(wrapper(`<m:Choice ${attribute}><p:push/></m:Choice>`)),
      ).toEqual(["cSld", "fade", "timing"]);
    },
  );
  it("resolves prefixes by URI with local namespace shadowing", () => {
    expect(
      logical(
        wrapper(
          `<m:Choice xmlns:p="urn:unsupported" Requires="p"><p:wrong/></m:Choice><m:Choice xmlns:alias="${NS.pml}" Requires="alias"><alias:cut/></m:Choice>`,
        ),
      ),
    ).toEqual(["cSld", "cut", "timing"]);
  });
  it("keeps selected empty branches empty rather than searching fallback", () => {
    expect(logical(wrapper('<m:Choice Requires="p"/>'))).toEqual([
      "cSld",
      "timing",
    ]);
  });
  it("does not descend ordinary children or foreign elements with MC local names", () => {
    expect(
      logical(
        `<p:sld xmlns:p="${NS.pml}" xmlns:m="urn:other"><p:timing><p:fade/></p:timing><m:AlternateContent><p:push/></m:AlternateContent></p:sld>`,
      ),
    ).toEqual(["timing", "AlternateContent"]);
  });
  it("handles nested alternatives and declarations inherited through selected branches", () => {
    expect(
      logical(
        wrapper(
          `<m:Choice Requires="p" xmlns:alias="${NS.dml}"><m:AlternateContent><m:Choice Requires="alias"><p:zoom/></m:Choice><m:Fallback><p:wipe/></m:Fallback></m:AlternateContent></m:Choice>`,
        ),
      ),
    ).toEqual(["cSld", "zoom", "timing"]);
  });
  it("returns no child when an unsupported block has no fallback", () => {
    expect(
      logical(
        `<p:sld xmlns:p="${NS.pml}" xmlns:m="${NS.mc}" xmlns:future="urn:unsupported"><m:AlternateContent><m:Choice Requires="future"><future:effect/></m:Choice></m:AlternateContent></p:sld>`,
      ),
    ).toEqual([]);
  });
  it("lets a feature reader check support in each scoped choice without mutating XML", () => {
    const doc = parseXml(
      wrapper(
        `<m:Choice xmlns:alias="${NS.p14}" Requires="alias"><p:cover/></m:Choice><m:Choice xmlns:alias="${NS.p14}" Requires="alias"><p:push/></m:Choice>`,
      ),
    );
    const before = serializeXml(doc);
    const seen: XmlElement[] = [];
    const support = (uri: string, choice: XmlElement) => {
      seen.push(choice);
      return (
        uri === NS.p14 &&
        choice.children.some(
          (node) => node.kind === "element" && node.name.localName === "push",
        )
      );
    };
    expect(
      [...effectiveChildElements(doc.root, support)].map(
        (n) => n.name.localName,
      ),
    ).toEqual(["cSld", "push", "timing"]);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.prefixDecls.get("alias")).toBe(NS.p14);
    expect(seen[1]!.prefixDecls.get("p")).toBe(NS.pml);
    expect(serializeXml(doc)).toBe(before);
  });
  it("checks all requirements and passes feature support through nested alternatives", () => {
    const doc = parseXml(
      wrapper(
        `<m:Choice Requires="p future"><p:cover/></m:Choice><m:Choice Requires="p"><m:AlternateContent><m:Choice Requires="a"><p:push/></m:Choice><m:Fallback><p:wipe/></m:Fallback></m:AlternateContent></m:Choice>`,
      ),
    );
    expect(
      [...effectiveChildElements(doc.root, (uri) => understood.has(uri))].map(
        (n) => n.name.localName,
      ),
    ).toEqual(["cSld", "push", "timing"]);
  });
  it("does not call feature support for malformed or unbound requirements", () => {
    const doc = parseXml(
      wrapper('<m:Choice/><m:Choice Requires="unbound"><p:push/></m:Choice>'),
    );
    let calls = 0;
    expect(
      [
        ...effectiveChildElements(doc.root, () => {
          calls++;
          return true;
        }),
      ].map((n) => n.name.localName),
    ).toEqual(["cSld", "fade", "timing"]);
    expect(calls).toBe(0);
  });
  it.each([false, true])(
    "streams 4000 nested alternatives without recursive stack growth (feature support: %s)",
    (feature) => {
      const depth = 4000;
      const doc = parseXml(
        wrapper(
          '<m:Choice Requires="p">' +
            '<m:AlternateContent><m:Choice Requires="p">'.repeat(depth) +
            "<p:push/>" +
            "</m:Choice><m:Fallback><p:wipe/></m:Fallback></m:AlternateContent>".repeat(
              depth,
            ) +
            "</m:Choice>",
        ),
      );
      const before = serializeXml(doc);
      const result = [
        ...effectiveChildElements(
          doc.root,
          feature ? (uri) => understood.has(uri) : understood,
        ),
      ];
      expect(result.map((e) => e.name.localName)).toEqual([
        "cSld",
        "push",
        "timing",
      ]);
      expect(result[1]!.prefixDecls.get("p")).toBe(NS.pml);
      expect(serializeXml(doc)).toBe(before);
    },
  );
  it("retains ancestor/default scopes without leaking selected-branch declarations to siblings", () => {
    const doc = parseXml(
        `<p:sld xmlns:p="${NS.pml}" xmlns:m="${NS.mc}" xmlns:alias="${NS.dml}"><p:cSld><m:AlternateContent><m:Choice Requires="p" xmlns:alias="${NS.pml}" xmlns="urn:branch"><p:push/></m:Choice><m:Fallback><p:wipe/></m:Fallback></m:AlternateContent><p:timing/></p:cSld></p:sld>`,
      ),
      parent = doc.root.children.find(
        (e): e is XmlElement => e.kind === "element",
      )!,
      result = [...effectiveChildElements(parent, understood, [doc.root])];
    expect(result.map((e) => e.name.localName)).toEqual(["push", "timing"]);
    expect(result[0]!.prefixDecls.get("alias")).toBe(NS.pml);
    expect(result[0]!.prefixDecls.get("")).toBe("urn:branch");
    expect(result[1]!.prefixDecls.get("alias")).toBe(NS.dml);
    expect(result[1]!.prefixDecls.has("")).toBe(false);
  });
  it("resumes siblings in document order after an unsupported nested block with no fallback", () => {
    const doc = parseXml(
      wrapper(
        '<m:Choice Requires="p"><p:push/><m:AlternateContent><m:Choice Requires="future"><future:ignored/></m:Choice></m:AlternateContent><p:wipe/></m:Choice>',
      ),
    );
    expect(
      [...effectiveChildElements(doc.root, understood)].map(
        (e) => e.name.localName,
      ),
    ).toEqual(["cSld", "push", "wipe", "timing"]);
  });
});
