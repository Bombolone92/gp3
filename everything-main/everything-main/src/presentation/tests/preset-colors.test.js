import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { readFileSync } from "node:fs";
import { P, createDeck, parseDeck, preview } from "../src/model.js";
import { parseXml } from "../lib/pptx/src/internal/xml/index.ts";
import {
  resolveDrawingColor,
  resolveDrawingOpacity,
} from "../lib/pptx/src/api/fn/shape-color.ts";

// RGB values measured from the vector fills of a PDF export of a test deck
// covering all 190 XML enum values, including the 2010 aliases.
const native = JSON.parse(
  readFileSync(
    new URL("./data/preset-colors-native.json", import.meta.url),
    "utf8",
  ),
);
const color = (name, children = "") =>
  parseXml(
    `<a:prstClr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"${name === null ? "" : ` val="${name}"`}>${children}</a:prstClr>`,
  ).root;
const svg = (p, s = P.getSlides(p)[0]) =>
  decodeURIComponent(preview(p, s).split(",").slice(1).join(","));

describe("DrawingML preset colors", () => {
  it.each(Object.entries(native))("resolves native %s", (name, expected) => {
    expect(resolveDrawingColor(color(name), null)).toBe(expected);
  });
  it.each([
    "transparent",
    "currentColor",
    "rebeccapurple",
    "RED",
    "lightblue",
    "red ",
    "toString",
    "constructor",
    "__proto__",
    "",
    null,
  ])("rejects values outside the XML enumeration: %s", (name) => {
    expect(resolveDrawingColor(color(name), null)).toBeNull();
  });
  it("keeps CSS-like names case-sensitive and uses the standard lime value", () => {
    expect(resolveDrawingColor(color("lime"), null)).toBe("#00FF00");
    expect(resolveDrawingColor(color("green"), null)).toBe("#008000");
    expect(resolveDrawingColor(color("dkSlateGrey"), null)).toBe("#2F4F4F");
    expect(resolveDrawingColor(color("darkSlateGrey"), null)).toBe("#2F4F4F");
  });
  it("applies ordered transforms and opacity independently of theme mappings", () => {
    const node = color(
      "red",
      '<a:tint val="50000"/><a:satMod val="300000"/><a:inv/><a:alpha val="40000"/><a:alphaMod val="50000"/>',
    );
    const before = structuredClone(node);
    expect(
      resolveDrawingColor(node, { accent1: "#123456" }, { red: "accent1" }),
    ).toBe("#00E9E9");
    expect(resolveDrawingOpacity(node)).toBe(0.2);
    expect(node).toEqual(before);
  });
  it("preserves preset fill, outline, text and highlight through editing and copies in both directions", async () => {
    const original = createDeck("blank"),
      slide = P.getSlides(original)[0];
    P.addSlideTextBox(slide, {
      x: 0,
      y: 0,
      w: P.inches(3),
      h: P.inches(2),
      text: "Probe",
    });
    const files = unzipSync(await P.savePresentation(original)),
      name = P.getSlidePartName(slide).slice(1);
    const preset =
      '<a:prstClr val="red"><a:tint val="50000"/><a:satMod val="300000"/><a:inv/></a:prstClr>';
    files[name] = strToU8(
      strFromU8(files[name]).replace(
        /<p:sp\b[\s\S]*?<\/p:sp>/,
        `<p:sp><p:nvSpPr><p:cNvPr id="90" name="Probe"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill>${preset}</a:solidFill><a:ln w="12700"><a:solidFill>${preset}</a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2400"><a:solidFill>${preset}</a:solidFill><a:highlight><a:prstClr val="ltGoldenrodYellow"/></a:highlight><a:latin typeface="Arial"/></a:rPr><a:t>Probe</a:t></a:r></a:p></p:txBody></p:sp>`,
      ),
    );
    const p = await parseDeck(zipSync(files)),
      s = P.getSlides(p)[0],
      shape = P.getSlideShapes(s)[0];
    const check = (pres, sh) => {
      expect(P.getShapeFillColorResolved(pres, sh)).toBe("#00E9E9");
      expect(P.getShapeStrokeColorResolved(pres, sh)).toBe("#00E9E9");
      expect(P.getShapeRunFormatEffective(pres, sh, 0, 0)).toMatchObject({
        color: "#00E9E9",
        highlight: "#FAFAD2",
      });
    };
    const before = unzipSync(await P.savePresentation(p));
    check(p, shape);
    expect(svg(p)).toContain('fill="#00E9E9"');
    expect(svg(p)).toContain('stroke="#00E9E9"');
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    check(p, P.copyShape(s, shape));
    const target = createDeck("blank"),
      dest = P.importSlide(target, s, P.getSlideLayout(P.getSlides(target)[0]));
    P.setShapeText(P.getSlideShapes(dest)[0], "Edited");
    const returned = P.importSlide(p, dest, P.getSlideLayout(s));
    for (const [deck, ss] of [
      [target, dest],
      [p, returned],
    ]) {
      check(deck, P.getSlideShapes(ss)[0]);
      const saved = await P.savePresentation(deck),
        xml = strFromU8(unzipSync(saved)[P.getSlidePartName(ss).slice(1)]);
      expect(xml).toContain(preset);
      expect(xml).toContain('<a:prstClr val="ltGoldenrodYellow"/>');
      const loaded = await parseDeck(saved),
        last = P.getSlides(loaded).at(-1);
      check(loaded, P.getSlideShapes(last)[0]);
      expect(svg(loaded, last)).toBe(svg(deck, ss));
    }
  });
});
