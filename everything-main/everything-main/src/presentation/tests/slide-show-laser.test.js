import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { P, parseDeck } from "../src/model.js";
import { INTERNAL_PACKAGE } from "../lib/pptx/src/api/_internal-symbols.ts";
import { partName } from "../lib/pptx/src/internal/opc/index.ts";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";
import {
  laserDeck,
  laserCompatibilityDeck,
  LASER_EXTENSION,
} from "./slide-laser-fixture.js";

const encode = (text) => new TextEncoder().encode(text);
const decode = (text) => new TextDecoder().decode(text);
const props = (pres) =>
  pres[INTERNAL_PACKAGE].getPart(partName("/ppt/presProps.xml"));
const laser = (pres) => P.getSlideShowLaserColor(pres);

describe("authored laser pointer color", () => {
  it("leaves absence distinct from the viewer's default color", () => {
    expect(laser(laserDeck())).toBeNull();
  });
  it.each([
    ['<a:srgbClr val="148a2b"/>', "#148A2B"],
    ['<a:prstClr val="blue"/>', "#0000FF"],
    ['<a:sysClr val="windowText" lastClr="102030"/>', "#102030"],
    ['<a:scrgbClr r="100000" g="0" b="0"/>', "#FF0000"],
    ['<a:hslClr hue="7200000" sat="100000" lum="50000"/>', "#00FF00"],
    // DrawingML tint interpolates linear RGB before converting back to sRGB.
    ['<a:srgbClr val="808080"><a:tint val="50000"/></a:srgbClr>', "#CDCDCD"],
  ])("resolves DrawingML color %s", (xml, color) => {
    expect(laser(laserDeck(xml))).toEqual({ color, opacity: 1 });
  });
  it("uses the owning presentation theme rather than an alphabetically earlier unrelated theme", () => {
    const pres = laserDeck('<a:schemeClr val="accent1"/>');
    const pkg = pres[INTERNAL_PACKAGE],
      main = partName("/ppt/presentation.xml");
    const theme = pkg.getPart(partName("/ppt/theme/theme1.xml"));
    const chosen = partName("/themes/chosen.xml");
    pkg.addPart(
      chosen,
      theme.contentType,
      encode(
        decode(theme.data).replace(
          /<a:accent1>.*?<\/a:accent1>/s,
          '<a:accent1><a:srgbClr val="123ABC"/></a:accent1>',
        ),
      ),
    );
    const rels = pkg.getRels(main);
    rels.items.find((rel) => rel.type.endsWith("/theme")).target =
      "../themes/chosen.xml";
    pkg.setRels(main, rels);
    expect(laser(pres)).toEqual({ color: "#123ABC", opacity: 1 });
  });
  it("retains ordered alpha transforms separately from RGB", () => {
    expect(
      laser(
        laserDeck(
          '<a:srgbClr val="112233"><a:alpha val="80000"/><a:alphaMod val="50000"/><a:alphaOff val="10000"/></a:srgbClr>',
        ),
      ),
    ).toEqual({ color: "#112233", opacity: 0.5 });
  });
  it.each(["missing", "external", "ambiguous"])(
    "reports a %s owning theme for an explicit scheme color",
    (reason) => {
      const pres = laserDeck('<a:schemeClr val="accent1"/>');
      const pkg = pres[INTERNAL_PACKAGE],
        main = partName("/ppt/presentation.xml"),
        rels = pkg.getRels(main);
      const rel = rels.items.find((r) => r.type.endsWith("/theme"));
      if (reason === "missing")
        rels.items = rels.items.filter((r) => r !== rel);
      if (reason === "external") rel.targetMode = "External";
      if (reason === "ambiguous")
        rels.items.push({ ...rel, id: "anotherTheme" });
      pkg.setRels(main, rels);
      expect(() => laser(pres)).toThrow(/laser pointer color/i);
    },
  );
  it("does not parse an unrelated damaged theme for a direct laser color", () => {
    const pres = laserDeck('<a:prstClr val="blue"/>');
    pres[INTERNAL_PACKAGE].getPart(partName("/ppt/theme/theme1.xml")).data =
      encode("<broken");
    expect(laser(pres)).toEqual({ color: "#0000FF", opacity: 1 });
  });
  it("keeps destination-owned laser settings through slide transfer in both directions", async () => {
    const source = laserDeck('<a:prstClr val="blue"/>'),
      target = laserDeck('<a:prstClr val="green"/>');
    const slide = P.getSlides(source)[1];
    const copied = P.importSlide(
      target,
      slide,
      P.getSlideLayout(P.getSlides(target)[0]),
    );
    P.importSlide(source, copied, P.getSlideLayout(slide));
    expect(laser(await parseDeck(await P.savePresentation(source)))).toEqual({
      color: "#0000FF",
      opacity: 1,
    });
    expect(laser(await parseDeck(await P.savePresentation(target)))).toEqual({
      color: "#008000",
      opacity: 1,
    });
  });
  it("uses namespace identity and understood alternate content inside the recognized extension", () => {
    const pres = laserDeck(
      `<mc:AlternateContent xmlns:mc="${NS.mc}" xmlns:new="urn:new"><mc:Choice Requires="new"><a:prstClr val="red"/></mc:Choice><mc:Fallback><alias:prstClr xmlns:alias="${NS.dml}" val="green"/></mc:Fallback></mc:AlternateContent>`,
    );
    expect(laser(pres)).toEqual({ color: "#008000", opacity: 1 });
  });
  it("reads a laser extension in a p14 compatibility choice", () => {
    const pres = laserDeck('<a:prstClr val="blue"/>');
    const part = props(pres);
    part.data = encode(
      decode(part.data)
        .replace(
          "<p:extLst>",
          `<mc:AlternateContent xmlns:mc="${NS.mc}" xmlns:p14="${NS.p14}"><mc:Choice Requires="p14"><p:extLst>`,
        )
        .replace(
          "</p:extLst>",
          "</p:extLst></mc:Choice><mc:Fallback/></mc:AlternateContent>",
        ),
    );
    expect(laser(pres)).toEqual({ color: "#0000FF", opacity: 1 });
  });
  it.each([false, true])(
    "keeps color, selection and timing on the same compatibility branch (unknown p14: %s)",
    (unknown) => {
      const pres = laserCompatibilityDeck(unknown);
      expect(P.getSlideShowSelection(pres)).toEqual(
        unknown ? { kind: "all" } : { kind: "range", start: 2, end: 4 },
      );
      expect(P.getSlideShowTimingOptions(pres)).toEqual({
        useTimings: unknown,
        loop: !unknown,
      });
      expect(laser(pres)).toEqual(
        unknown ? null : { color: "#008000", opacity: 1 },
      );
    },
  );
  it("reads deeply nested understood choices with bounded repeated traversal", () => {
    const pres = laserCompatibilityDeck();
    const part = props(pres),
      source = decode(part.data);
    const match = source.match(
      /<p:presentationPr\b[^>]*>([\s\S]*)<\/p:presentationPr>/,
    );
    let body = match[1];
    for (let depth = 0; depth < 48; depth++)
      body = `<mc:AlternateContent xmlns:mc="${NS.mc}" xmlns:p14="${NS.p14}"><mc:Choice Requires="p14">${body}</mc:Choice><mc:Fallback><p:showPr><p:sldAll/></p:showPr></mc:Fallback></mc:AlternateContent>`;
    part.data = encode(source.replace(match[1], body));
    expect(P.getSlideShowSelection(pres)).toEqual({
      kind: "range",
      start: 2,
      end: 4,
    });
    expect(P.getSlideShowTimingOptions(pres)).toEqual({
      useTimings: false,
      loop: true,
    });
    expect(laser(pres)).toEqual({ color: "#008000", opacity: 1 });
  });
  it.each(["urn:other", "{F99C55AA-B7CB-42B0-86F8-08522FDF87E8}"])(
    "does not borrow colors from an unrelated extension %s",
    (extension) => {
      expect(
        laser(laserDeck('<a:prstClr val="blue"/>', { extension })),
      ).toBeNull();
    },
  );
  it.each([
    '<a:srgbClr val="ZZZZZZ"/>',
    '<a:schemeClr val="missing"/>',
    '<other:prstClr xmlns:other="urn:other" val="red"/>',
    '<a:prstClr val="red"/><a:prstClr val="blue"/>',
    "",
  ])("reports an invalid explicit laser color %s", (color) => {
    expect(() => laser(laserDeck(color))).toThrow(/laser pointer color/i);
  });
  it("rejects ambiguous recognized extensions", () => {
    const pres = laserDeck('<a:prstClr val="red"/>');
    const part = props(pres);
    part.data = encode(
      decode(part.data).replace(
        "</p:extLst>",
        `<p:ext uri="${LASER_EXTENSION}"><p14:laserClr xmlns:p14="${NS.p14}" xmlns:a="${NS.dml}"><a:prstClr val="blue"/></p14:laserClr></p:ext></p:extLst>`,
      ),
    );
    expect(() => laser(pres)).toThrow(/laser pointer color/i);
  });
  it("observes property edits and keeps packages isolated without changing XML", async () => {
    const pres = laserDeck('<a:prstClr val="blue"/>'),
      other = laserDeck('<a:prstClr val="green"/>');
    const before = unzipSync(await P.savePresentation(pres));
    expect(laser(pres).color).toBe("#0000FF");
    expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
    props(pres).data = encode(
      decode(props(pres).data).replace('val="blue"', 'val="red"'),
    );
    expect(laser(await parseDeck(await P.savePresentation(pres))).color).toBe(
      "#FF0000",
    );
    expect(laser(other).color).toBe("#008000");
  });
});
