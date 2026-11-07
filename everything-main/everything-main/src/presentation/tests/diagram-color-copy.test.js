import { describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import { P, createDeck } from "../src/model.js";
import { diagramDeck } from "./diagram-copy-fixture.js";
import { semanticPaintDeck } from "./diagram-build-fixture.js";
import { createDiagramColorCopy } from "../lib/pptx/src/api/fn/diagram-color-copy.ts";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import {
  NS,
  parseXml,
  serializeXml,
  serializeFragment,
} from "../lib/pptx/src/internal/xml/index.ts";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";

import {
  encode,
  decode,
  scheme,
  rgb,
  namespaces,
  sourceDeck,
} from "./diagram-color-copy-fixture.js";

describe("source colors in copied SmartArt", () => {
  it("retains colors when duplicating within the same slide, even with preservation requested", async () => {
    const { pres, frame, diagram } = await sourceDeck(),
      slide = P.getSlides(pres)[0];
    const before = decode(diagram.colors.part);
    const copied = P.copyShape(slide, frame, {
      preserveTextFormatting: true,
      preservePaintFormatting: true,
    });
    expect(decode(readShapeDiagram(copied).colors.part)).toBe(before);
  });

  it("resolves semantic palettes without a saved drawing and retains native layout", async () => {
    const { p, frame } = await semanticPaintDeck(),
      source = P.getSlides(p)[0],
      diagram = readShapeDiagram(frame);
    expect(diagram.drawing).toBeNull();
    P.setPresentationTheme(p, { accent1: "#FF0000" });
    diagram.colors.part.data = encode(
      decode(diagram.colors.part).replaceAll(
        '<a:srgbClr val="FF0000"/>',
        '<a:schemeClr val="accent1"/>',
      ),
    );
    expect(decode(diagram.colors.part)).toContain(
      '<a:schemeClr val="accent1"/>',
    );
    const target = createDeck("blank"),
      imported = P.importSlide(target, source, P.getSlideLayouts(target)[0], {
        preserveTextFormatting: true,
        preservePaintFormatting: true,
      });
    const copy = readShapeDiagram(P.getSlideShapes(imported)[0]);
    expect(copy.drawing).toBeNull();
    expect(decode(copy.colors.part)).not.toContain(
      '<a:schemeClr val="accent1"/>',
    );
    expect(decode(copy.colors.part)).toContain('<a:srgbClr val="FF0000"/>');
    expect(decode(copy.layout.part)).toBe(decode(diagram.layout.part));
    const rendered = renderSlideToSvg(target, imported);
    expect(rendered).toContain('data-pptx-diagram="semantic-layout"');
    expect(rendered).not.toContain("data-pptx-diagram-issues");
    expect(P.validatePresentation(target)).toEqual([]);
  });

  it("does not invent a color when the source has no usable theme", async () => {
    const { pres } = await sourceDeck(),
      slide = P.getSlides(pres)[0],
      pkg = P._internalPackageOf(pres);
    for (const part of [...pkg.parts])
      if (
        part.contentType ===
        "application/vnd.openxmlformats-officedocument.theme+xml"
      )
        pkg.removePart(part.name);
    const doc = parseXml(
        `<dgm:dataModel ${namespaces}><dgm:spPr>${scheme()}</dgm:spPr></dgm:dataModel>`,
      ),
      before = serializeXml(doc);
    expect(
      createDiagramColorCopy({
        sourceSlide: slide,
        preservePaintFormatting: true,
      })(doc.root),
    ).toBe(false);
    expect(serializeXml(doc)).toBe(before);
  });

  it.each(["colors", "quickStyle", "layout", "drawing"])(
    "retains damaged %s XML as opaque data when colors cannot be resolved",
    async (key) => {
      const { pres, diagram } = await sourceDeck();
      diagram[key].part.data = encode("<damaged><unclosed>");
      const target = createDeck("blank"),
        imported = P.importSlide(
          target,
          P.getSlides(pres)[0],
          P.getSlideLayouts(target)[0],
          { preservePaintFormatting: true, preserveTextFormatting: true },
        );
      const copy = readShapeDiagram(P.getSlideShapes(imported)[0]);
      // readShapeDiagram reports invalid XML; use the package to verify that
      // the copied dependency is retained without an invented replacement.
      expect(copy[key]).toBeNull();
      expect(
        P._internalPackageOf(target).parts.some(
          (part) => decode(part) === "<damaged><unclosed>",
        ),
      ).toBe(true);
      expect(P.validatePresentation(target)).toEqual([]);
    },
  );

  it.each([
    ["palette fill", "dgm:colorsDef", "dgm:fillClrLst", "paint"],
    ["palette line", "dgm:colorsDef", "dgm:linClrLst", "paint"],
    ["palette effect", "dgm:colorsDef", "dgm:effectClrLst", "paint"],
    ["palette text fill", "dgm:colorsDef", "dgm:txFillClrLst", "text"],
    ["palette text line", "dgm:colorsDef", "dgm:txLinClrLst", "text"],
    ["palette text effect", "dgm:colorsDef", "dgm:txEffectClrLst", "text"],
    ["semantic paint", "dgm:dataModel", "dgm:spPr", "paint"],
    ["semantic text", "dgm:dataModel", "dgm:t", "text"],
    ["saved paint", "dsp:drawing", "dsp:spPr", "paint"],
    ["saved text", "dsp:drawing", "dsp:txBody", "text"],
    ["saved group paint", "dsp:drawing", "dsp:grpSpPr", "paint"],
    ["quick fill reference", "dgm:styleDef", "a:fillRef", "paint"],
    ["quick line reference", "dgm:styleDef", "a:lnRef", "paint"],
    ["quick effect reference", "dgm:styleDef", "a:effectRef", "paint"],
    ["quick font reference", "dgm:styleDef", "a:fontRef", "text"],
    ["layout list defaults", "dgm:layoutDef", "a:lstStyle", "text"],
  ])(
    "resolves %s only under its selected formatting option",
    async (_, root, container, kind) => {
      const { pres } = await sourceDeck(),
        sourceSlide = P.getSlides(pres)[0];
      const xml = `<${root} ${namespaces}><${container}>${scheme()}</${container}></${root}>`;
      for (const selected of ["text", "paint"]) {
        const doc = parseXml(xml);
        const changed = createDiagramColorCopy({
          sourceSlide,
          preserveTextFormatting: selected === "text",
          preservePaintFormatting: selected === "paint",
        })(doc.root);
        expect(changed).toBe(selected === kind);
        expect(serializeXml(doc)).toContain(
          selected === kind ? rgb() : scheme(),
        );
      }
    },
  );

  it("uses the source slide's color map and leaves phClr, unknown colors, literals and opaque extensions intact", async () => {
    const { pres } = await sourceDeck();
    const files = unzipSync(await P.savePresentation(pres));
    const owner = P.getSlidePartName(P.getSlides(pres)[0]).slice(1);
    files[owner] = encode(
      new TextDecoder()
        .decode(files[owner])
        .replace(/<p:clrMapOvr\b[\s\S]*?<\/p:clrMapOvr>/, "")
        .replace(
          "</p:cSld>",
          `</p:cSld><p:clrMapOvr><a:overrideClrMapping tx1="lt1" accent1="accent2"/></p:clrMapOvr>`,
        ),
    );
    const mapped = await P.loadPresentation(zipSync(files)),
      sourceSlide = P.getSlides(mapped)[0];
    const xml = `<dgm:dataModel ${namespaces}><dgm:spPr>${scheme()}${scheme("phClr")}${scheme("missing")}<a:srgbClr val="123456"/><a:extLst><a:ext uri="urn:opaque"><other:paint xmlns:other="urn:opaque">${scheme()}</other:paint></a:ext></a:extLst></dgm:spPr><dgm:t>${scheme("tx1")}</dgm:t></dgm:dataModel>`;
    const doc = parseXml(xml);
    expect(
      createDiagramColorCopy({
        sourceSlide,
        preserveTextFormatting: true,
        preservePaintFormatting: true,
      })(doc.root),
    ).toBe(true);
    const result = serializeXml(doc);
    expect(result).toContain(rgb("8329A5"));
    expect(result).toContain(rgb("EFF1F3"));
    for (const retained of [
      scheme("phClr"),
      scheme("missing"),
      '<a:srgbClr val="123456"/>',
      scheme(),
    ])
      expect(result).toContain(retained);
  });

  it.each([
    [true, false],
    [false, true],
    [true, true],
    [false, false],
  ])(
    "imports with text=%s paint=%s, keeping transforms and interval semantics through export and return",
    async (text, paint) => {
      const { pres, diagram } = await sourceDeck(),
        sourceSlide = P.getSlides(pres)[0];
      const before = unzipSync(await P.savePresentation(pres));
      const target = createDeck("blank");
      P.setPresentationTheme(target, {
        accent1: "#D91247",
        accent2: "#35BD68",
      });
      const options = {
        preserveTextFormatting: text,
        preservePaintFormatting: paint,
      };
      const imported = P.importSlide(
        target,
        sourceSlide,
        P.getSlideLayouts(target)[0],
        options,
      );
      const copied = readShapeDiagram(P.getSlideShapes(imported)[0]);
      const xml = decode(copied.colors.part);
      const colors = parseXml(xml).root.children[0].children;
      const body = (el) =>
        serializeFragment(el).replace(/\sxmlns(?::[\w-]+)?="[^"]*"/g, "");
      expect(body(colors[0])).toContain(text ? rgb() : scheme());
      expect(body(colors[1])).toContain(paint ? rgb() : scheme());
      expect(xml).toContain('meth="cycle" hueDir="cw"');
      expect(xml).toContain('meth="span"');
      expect(decode(copied.drawing.part)).toContain(paint ? rgb() : scheme());
      for (const key of ["layout", "quickStyle"])
        expect(decode(copied[key].part)).toBe(decode(diagram[key].part));
      expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
      const reopened = await P.loadPresentation(
        await P.savePresentation(target),
      );
      const returned = P.importSlide(
        pres,
        P.getSlides(reopened).at(-1),
        P.getSlideLayouts(pres)[0],
        options,
      );
      expect(
        decode(readShapeDiagram(P.getSlideShapes(returned)[0]).colors.part),
      ).toBe(xml);
      expect(P.validatePresentation(reopened)).toEqual([]);
      expect(P.validatePresentation(pres)).toEqual([]);
    },
  );

  it("keeps the destination theme unchanged and preserves painted colors in an exported copy", async () => {
    const { pres } = await sourceDeck(),
      sourceSlide = P.getSlides(pres)[0];
    const target = createDeck("blank"),
      targetTheme = P.getPresentationTheme(target);
    const imported = P.importSlide(
      target,
      sourceSlide,
      P.getSlideLayouts(target)[0],
      { preserveTextFormatting: true, preservePaintFormatting: true },
    );
    const render = (p, s) =>
      renderSlideToSvg(p, s, { textLayout: "svg", stableDefinitionIds: true });
    const source = render(pres, sourceSlide),
      copied = render(target, imported);
    const colors = (svg) =>
      [...svg.matchAll(/(?:fill|stroke)="(#[\da-f]{6})"/gi)].map((m) => m[1]);
    expect(colors(copied)).toEqual(colors(source));
    expect(P.getPresentationTheme(target)).toEqual(targetTheme);
    const reopened = await P.loadPresentation(await P.savePresentation(target));
    expect(render(reopened, P.getSlides(reopened).at(-1))).toBe(copied);
  });

  it.each([false, true])(
    "copies selected %s-grouped diagrams without changing their source or unrelated dependencies",
    async (group) => {
      const source = await diagramDeck({ group }),
        slide = P.getSlides(source)[0];
      const pkg = P._internalPackageOf(source),
        style = pkg.getPart("/assets/smart/shared-style.xml");
      style.data = encode(
        `<dgm:styleDef ${namespaces}><dgm:styleLbl name="node1"><dgm:style><a:fillRef idx="1">${scheme()}</a:fillRef></dgm:style></dgm:styleLbl></dgm:styleDef>`,
      );
      P.setPresentationTheme(source, { accent1: "#4179B2" });
      const target = createDeck("blank");
      const nativeLayout = P.importSlideTemplate(target, slide);
      const held = P.importSlide(target, slide, nativeLayout);
      const dest = P.getSlides(target)[0];
      const shape = P.getSlideShapes(held)[0];
      const before = decode(
        readShapeDiagram(group ? P.getGroupChildren(shape)[0] : shape)
          .quickStyle.part,
      );
      P.copyShape(dest, shape, { preservePaintFormatting: true });
      const copy = P.getSlideShapes(dest)[0];
      const diagram = readShapeDiagram(
        group ? P.getGroupChildren(copy)[0] : copy,
      );
      expect(decode(diagram.quickStyle.part)).toContain(rgb());
      expect(
        decode(
          readShapeDiagram(group ? P.getGroupChildren(shape)[0] : shape)
            .quickStyle.part,
        ),
      ).toBe(before);
      expect(P.validatePresentation(target)).toEqual([]);
    },
  );
});
