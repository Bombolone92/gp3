import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  diagramFontDeck,
  sourceFonts,
  encode,
  decode,
} from "./diagram-font-copy-fixture.js";
import { createDiagramFontCopy } from "../lib/pptx/src/api/fn/diagram-font-copy.ts";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import { importSlideTemplates } from "../lib/pptx/src/api/fn/template-import.ts";
import { themeForSlide } from "../lib/pptx/src/api/fn/shape-theme.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
const xml = (text) =>
  parseXml(
    `<d:dataModel xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}" xmlns:new="${NS.dgm1612}" xmlns:o="urn:opaque">${text}</d:dataModel>`,
  );
const copy = (p, doc, preserveTextFormatting = true) =>
  createDiagramFontCopy({
    sourceSlide: P.getSlides(p)[0],
    preserveTextFormatting,
  })(doc.root);
const snapshot = (p) =>
  P._internalPackageOf(p).parts.map((part) => [part.name, part.data.slice()]);
const svg = (p, s) =>
  decodeURIComponent(preview(p, s).split(",").slice(1).join(","));

describe("explicit theme-font tokens in diagram transfer", () => {
  it.each([
    ["+mj-lt", "majorLatin"],
    ["+mn-lt", "minorLatin"],
    ["+mj-ea", "majorEastAsian"],
    ["+mn-ea", "minorEastAsian"],
    ["+mj-cs", "majorComplexScript"],
    ["+mn-cs", "minorComplexScript"],
  ])("resolves %s from the owning font scheme", async (token, slot) => {
    const { p } = await diagramFontDeck(),
      doc = xml(
        `<d:t><a:p><a:r><a:rPr><a:latin typeface="${token}"/></a:rPr><a:t>Text</a:t></a:r></a:p></d:t>`,
      );
    expect(copy(p, doc)).toBe(true);
    expect(serializeXml(doc)).toContain(`typeface="${sourceFonts[slot]}"`);
    expect(serializeXml(doc)).not.toContain(`typeface="${token}"`);
  });

  it.each(["latin", "ea", "cs", "sym", "buFont"])(
    "resolves authored %s declarations without changing their other attributes",
    async (name) => {
      const { p } = await diagramFontDeck(),
        doc = xml(
          `<d:t><a:lstStyle><a:lvl1pPr>${name === "buFont" ? "" : "<a:defRPr>"}<a:${name} typeface="+mn-lt" charset="128" pitchFamily="49" panose="020B0604020202020204" o:tag="retained"/>${name === "buFont" ? "" : "</a:defRPr>"}</a:lvl1pPr></a:lstStyle></d:t>`,
        );
      expect(copy(p, doc)).toBe(true);
      const result = serializeXml(doc);
      for (const value of [
        'typeface="Verdana"',
        'charset="128"',
        'pitchFamily="49"',
        'panose="020B0604020202020204"',
        'o:tag="retained"',
      ])
        expect(result).toContain(value);
    },
  );

  it("inherits native theme descriptors while preserving explicit precedence and the source", async () => {
    const { p } = await diagramFontDeck(),
      source = P.getSlides(p)[0],
      pkg = P._internalPackageOf(p),
      part = pkg.getPart(themeForSlide(source).partName);
    part.data = encode(
      decode(part).replace(
        'typeface="Georgia"',
        'typeface="Georgia" panose="020B0604020202020204" pitchFamily="34" charset="1"',
      ),
    );
    const before = snapshot(p),
      doc = xml(
        '<d:t><a:lstStyle><a:defPPr><a:defRPr><a:latin typeface="+mj-lt" panose="00000000000000000000" pitchFamily="0"/></a:defRPr></a:defPPr></a:lstStyle></d:t>',
      );
    expect(copy(p, doc)).toBe(true);
    for (const value of [
      'typeface="Georgia"',
      'panose="020B0604020202020204"',
      'pitchFamily="34"',
      'charset="1"',
    ])
      expect(serializeXml(doc)).toContain(value);
    expect(snapshot(p)).toEqual(before);
  });

  it("recognizes qualified list-style extensions without searching opaque wrappers or paint", async () => {
    const { p } = await diagramFontDeck(),
      doc = xml(
        '<d:extLst><a:ext uri="any"><new:lstStyle><a:defPPr><a:defRPr><a:latin typeface="+mj-lt"/></a:defRPr></a:defPPr></new:lstStyle></a:ext><a:ext uri="opaque"><o:wrapper><new:lstStyle><a:latin typeface="+mn-lt"/></new:lstStyle></o:wrapper><a:latin typeface="+mn-lt"/></a:ext></d:extLst><d:t><a:extLst><a:ext uri="opaque"><a:latin typeface="+mn-lt"/></a:ext></a:extLst><o:wrapper><a:latin typeface="+mn-lt"/></o:wrapper></d:t><d:spPr><a:latin typeface="+mn-lt"/></d:spPr>',
      );
    expect(copy(p, doc)).toBe(true);
    expect(serializeXml(doc).match(/typeface="Georgia"/g)).toHaveLength(1);
    expect(serializeXml(doc).match(/typeface="\+mn-lt"/g)).toHaveLength(5);
  });

  it.each(["fontRef", "explicit", "unknown", "unresolved", "disabled"])(
    "retains %s formatting rather than inventing a typeface",
    async (mode) => {
      const { p } = await diagramFontDeck();
      if (mode === "unresolved") P.setPresentationFonts(p, { minorLatin: "" });
      const content =
          mode === "fontRef"
            ? '<d:style><a:fontRef idx="minor"/></d:style>'
            : `<d:t><a:p><a:r><a:rPr><a:latin typeface="${mode === "explicit" ? "Authored face" : mode === "unknown" ? "+mn-unknown" : "+mn-lt"}"/></a:rPr></a:r></a:p></d:t>`,
        doc = xml(content),
        before = serializeXml(doc);
      expect(copy(p, doc, mode !== "disabled")).toBe(false);
      expect(serializeXml(doc)).toBe(before);
    },
  );

  it.each([false, true])(
    "materializes semantic/saved aliases through import, export and return copy: saved=%s",
    async (cached) => {
      const { p, diagram } = await diagramFontDeck({ cached }),
        source = P.getSlides(p)[0],
        before = snapshot(p),
        target = createDeck("blank"),
        targetFonts = P.getPresentationFonts(target),
        imported = P.importSlide(target, source, P.getSlideLayouts(target)[0], {
          preserveTextFormatting: true,
        }),
        frame = P.getSlideShapes(imported).find(P.isDiagramShape),
        transferred = readShapeDiagram(frame);
      expect(decode(transferred.data.part)).toContain('typeface="Verdana"');
      expect(decode(transferred.data.part)).not.toContain('typeface="+mn-lt"');
      if (cached)
        expect(decode(transferred.drawing.part)).toContain(
          'typeface="Verdana"',
        );
      expect(P.getPresentationFonts(target)).toEqual(targetFonts);
      expect(snapshot(p)).toEqual(before);
      const rendered = svg(target, imported);
      expect(rendered).toContain("&quot;Verdana&quot;");
      expect(rendered).not.toContain("data-pptx-diagram-issues");
      const reopened = await P.loadPresentation(
        await P.savePresentation(target),
      );
      expect(svg(reopened, P.getSlides(reopened).at(-1))).toBe(rendered);
      const returned = P.importSlide(
        p,
        P.getSlides(reopened).at(-1),
        P.getSlideLayout(source),
        { preserveTextFormatting: true },
      );
      expect(svg(p, returned)).toBe(rendered);
      expect(
        decode(
          readShapeDiagram(P.getSlideShapes(source).find(P.isDiagramShape)).data
            .part,
        ),
      ).toBe(decode(diagram.data.part));
      expect(P.validatePresentation(p)).toEqual([]);
      expect(P.validatePresentation(reopened)).toEqual([]);
    },
  );

  it("preserves the copied semantic typeface after whole-item text editing", async () => {
    const { p } = await diagramFontDeck(),
      target = createDeck("blank"),
      imported = P.importSlide(
        target,
        P.getSlides(p)[0],
        P.getSlideLayouts(target)[0],
        { preserveTextFormatting: true },
      ),
      frame = P.getSlideShapes(imported)[0];
    P.replaceShapeDiagramText(frame, [
      { modelId: "node0", text: "Edited label" },
    ]);
    expect(P.getShapeDiagramTextEntries(frame)[0].text).toBe("Edited label");
    expect(svg(target, imported)).toContain("&quot;Verdana&quot;");
    expect(svg(target, imported)).not.toContain("data-pptx-diagram-issues");
    const reopened = await P.loadPresentation(await P.savePresentation(target));
    expect(svg(reopened, P.getSlides(reopened).at(-1))).toBe(
      svg(target, imported),
    );
  });

  it.each(["default", "paint only", "same slide"])(
    "retains theme adaptation for %s copy",
    async (mode) => {
      const { p, frame } = await diagramFontDeck(),
        source = P.getSlides(p)[0],
        target = createDeck("blank"),
        copied =
          mode === "same slide"
            ? P.copyShape(source, frame, { preserveTextFormatting: true })
            : P.getSlideShapes(
                P.importSlide(
                  target,
                  source,
                  P.getSlideLayouts(target)[0],
                  mode === "paint only"
                    ? { preservePaintFormatting: true }
                    : {},
                ),
              )[0];
      expect(decode(readShapeDiagram(copied).data.part)).toContain(
        'typeface="+mn-lt"',
      );
      expect(decode(readShapeDiagram(copied).data.part)).not.toContain(
        'typeface="Verdana"',
      );
    },
  );

  it("uses each source slide's own theme when copying within a package with multiple masters", async () => {
    const { p } = await diagramFontDeck(),
      other = await diagramFontDeck();
    P.setPresentationFonts(other.p, { minorLatin: "Georgia" });
    const source = P.getSlides(p)[0],
      foreignSlide = P.getSlides(other.p)[0],
      layout = importSlideTemplates(p, [foreignSlide])[0];
    P.importSlide(p, foreignSlide, layout);
    const frame = P.getSlideShapes(source)[0],
      originalData = decode(readShapeDiagram(frame).data.part),
      target = P.addSlide(p, { layout }),
      copied = P.copyShape(target, frame, { preserveTextFormatting: true });
    expect(P.getPresentationFonts(p).minorLatin).toBe("Georgia");
    expect(themeForSlide(source).fonts.minorLatin).toBe("Verdana");
    expect(themeForSlide(target).fonts.minorLatin).toBe("Georgia");
    expect(decode(readShapeDiagram(copied).data.part)).toContain(
      'typeface="Verdana"',
    );
    expect(decode(readShapeDiagram(frame).data.part)).toBe(originalData);
    expect(originalData).toContain('typeface="+mn-lt"');
    expect(svg(p, target)).toContain("&quot;Verdana&quot;");
    const reopened = await P.loadPresentation(await P.savePresentation(p));
    expect(svg(reopened, P.getSlides(reopened).at(-1))).toBe(svg(p, target));
    expect(P.validatePresentation(reopened)).toEqual([]);
  });

  it("decodes escaped attribute values before resolving font tokens", async () => {
    const { p, diagram } = await diagramFontDeck({ cached: true });
    diagram.drawing.part.data = encode(
      decode(diagram.drawing.part).replaceAll("+mn-lt", "&#43;mn-lt"),
    );
    const target = createDeck("blank"),
      imported = P.importSlide(
        target,
        P.getSlides(p)[0],
        P.getSlideLayouts(target)[0],
        { preserveTextFormatting: true },
      );
    expect(
      decode(readShapeDiagram(P.getSlideShapes(imported)[0]).drawing.part),
    ).toContain('typeface="Verdana"');
  });

  it("retains malformed auxiliary XML and namespaces without freezing it into an invented layout", async () => {
    const { p, diagram } = await diagramFontDeck();
    diagram.layout.part.data = encode('<broken typeface="+mn-lt"><unclosed>');
    const target = createDeck("blank"),
      imported = P.importSlide(
        target,
        P.getSlides(p)[0],
        P.getSlideLayouts(target)[0],
        { preserveTextFormatting: true },
      );
    const pkg = P._internalPackageOf(target),
      rel = pkg
        .getRels(P.getSlidePartName(imported))
        .items.find((r) => r.type.endsWith("/diagramLayout"));
    expect(pkg.getPart(rel.target).data).toEqual(diagram.layout.part.data);
  });
});
