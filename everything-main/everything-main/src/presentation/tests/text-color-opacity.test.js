import { describe, expect, it } from "vitest";
import { P, createDeck, parseDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { parseRPrLikeElement } from "../lib/pptx/src/api/fn/shape-color.ts";
import { applyRunFormat } from "../lib/pptx/src/internal/drawingml/text-format.ts";
import {
  NS,
  parseXml,
  serializeFragment,
} from "../lib/pptx/src/internal/xml/index.ts";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const paint = (rgb, alpha = "") =>
  `<a:solidFill><a:srgbClr val="${rgb}">${alpha}</a:srgbClr></a:solidFill>`;
const alpha = (n) => `<a:alpha val="${n}"/>`;
const run = (text, properties = "", attributes = "") =>
  `<a:r><a:rPr ${attributes}>${properties}</a:rPr><a:t>${text}</a:t></a:r>`;
const props = (xml) =>
  parseXml(`<a:rPr xmlns:a="${NS.dml}">${xml}</a:rPr>`).root;
async function fixture({
  inline = run("Inherited") + run("Opaque", paint("00FF00")),
  properties = "",
  table = false,
} = {}) {
  const original = createDeck("blank"),
    s = P.getSlides(original)[0];
  if (table)
    P.addSlideTable(s, {
      x: 0,
      y: 0,
      w: P.inches(8),
      h: P.inches(2),
      rows: [["seed"]],
    });
  else
    P.addSlideTextBox(s, {
      x: 0,
      y: 0,
      w: P.inches(8),
      h: P.inches(2),
      text: "seed",
    });
  const files = unzipSync(await P.savePresentation(original));
  const tag = table ? "a" : "p";
  files["ppt/slides/slide1.xml"] = strToU8(
    strFromU8(files["ppt/slides/slide1.xml"]).replace(
      new RegExp(`<${tag}:txBody>[\\s\\S]*?</${tag}:txBody>`),
      `<${tag}:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${properties}<a:defRPr sz="3000">${paint("FF0000", alpha(35000))}<a:latin typeface="Arial"/></a:defRPr></a:pPr>${inline}</a:p></${tag}:txBody>`,
    ),
  );
  const pres = await parseDeck(zipSync(files)),
    slide = P.getSlides(pres)[0];
  return { pres, slide, shape: P.getSlideShapes(slide)[0] };
}
const render = (f, mode = "svg") =>
  renderSlideToSvg(f.pres, f.slide, {
    textLayout: mode,
    stableDefinitionIds: true,
  });

describe("DrawingML solid text color opacity", () => {
  it("applies theme hyperlink color as an opaque fill, matching the native reference", async () => {
    const f = await fixture();
    P.setShapeRunHyperlink(f.shape, 0, 0, "https://example.com/");
    const svg = render(f);
    expect(svg).toContain('href="https://example.com/"');
    expect(svg).not.toContain('fill-opacity="0.35"');
    expect(render(f, "foreignObject")).not.toContain("rgba(");
  });

  it("resolves field alpha independently of paragraph-end insertion formatting", async () => {
    const f = await fixture({
      inline:
        '<a:fld id="{F86A757A-64A7-4A2B-B179-820EA26B7AC3}" type="slidenum"><a:t>1</a:t></a:fld><a:endParaRPr>' +
        paint("0000FF", alpha(70000)) +
        "</a:endParaRPr>",
    });
    expect(P.getShapeFieldFormatEffective(f.pres, f.shape, 0, 0)).toMatchObject(
      { color: "#FF0000", colorOpacity: 0.35 },
    );
    expect(
      P.getShapeParagraphEndFormatEffective(f.pres, f.shape, 0),
    ).toMatchObject({ color: "#0000FF", colorOpacity: 0.7 });
    expect(render(f)).toContain('fill-opacity="0.35"');
    expect(render(f)).not.toContain('fill-opacity="0.7"');
  });
  it.each([
    '<a:srgbClr val="FF0000">',
    '<a:schemeClr val="accent1">',
    '<a:sysClr val="windowText" lastClr="FF0000">',
    '<a:prstClr val="red">',
    '<a:scrgbClr r="100000" g="0" b="0">',
    '<a:hslClr hue="0" sat="100000" lum="50000">',
  ])("reads ordered alpha transforms for %s", (opening) => {
    const name = opening.match(/<a:(\w+)/)[1];
    const xml = `<a:solidFill>${opening}${alpha(50000)}<a:alphaMod val="50000"/><a:alphaOff val="10000"/></a:${name}></a:solidFill>`;
    expect(
      parseRPrLikeElement(props(xml), { theme: { accent1: "#FF0000" } }),
    ).toMatchObject({ color: "#FF0000", colorOpacity: 0.35 });
  });

  it("clamps alpha after each transform and keeps zero alpha", () => {
    expect(
      parseRPrLikeElement(
        props(
          paint("112233", '<a:alphaOff val="50000"/><a:alphaMod val="50000"/>'),
        ),
      ).colorOpacity,
    ).toBe(0.5);
    expect(
      parseRPrLikeElement(props(paint("112233", alpha(0)))).colorOpacity,
    ).toBe(0);
  });

  it("inherits alpha with its color and resets it for an explicitly opaque fill", async () => {
    const f = await fixture();
    expect(P.getShapeRunFormatEffective(f.pres, f.shape, 0, 0)).toMatchObject({
      color: "#FF0000",
      colorOpacity: 0.35,
    });
    expect(P.getShapeRunFormatEffective(f.pres, f.shape, 0, 1)).toMatchObject({
      color: "#00FF00",
      colorOpacity: 1,
    });
    P.setShapeRunFormat(f.shape, 0, 0, { bold: true });
    expect(
      P.getShapeRunFormatEffective(f.pres, f.shape, 0, 0).colorOpacity,
    ).toBe(0.35);
  });

  it.each(["svg", "foreignObject"])(
    "paints alpha without changing layout or hiding text in %s",
    async (mode) => {
      const f = await fixture({
        inline:
          run("First", paint("FF0000", alpha(25000))) +
          run("Second", paint("FF0000", alpha(75000))) +
          run("Invisible", paint("FF0000", alpha(0))),
      });
      const svg = render(f, mode);
      expect(svg).toContain("First");
      expect(svg).toContain("Second");
      expect(svg).toContain("Invisible");
      if (mode === "svg") {
        expect(svg).toMatch(/fill-opacity="0.25"[^>]*>First/);
        expect(svg).toMatch(/fill-opacity="0.75"[^>]*>Second/);
        expect(svg).toMatch(/fill-opacity="0"[^>]*>Invisible/);
      } else {
        expect(svg).toContain("color:rgba(255,0,0,0.25)");
        expect(svg).toContain("color:rgba(255,0,0,0.75)");
        expect(svg).toContain("color:rgba(255,0,0,0)");
        expect(svg).not.toContain("opacity:");
      }
    },
  );

  it("keeps wavy underline alpha with glyph alpha", async () => {
    const f = await fixture({
      inline: run(
        "Wavy",
        paint("FF0000", alpha(25000)),
        'u="wavy" strike="sngStrike"',
      ),
    });
    const svg = render(f);
    expect(svg).toContain('stroke-opacity="0.25"');
    expect(svg).toContain('fill-opacity="0.25"');
    expect(svg).toContain('text-decoration="line-through"');
  });

  it("keeps highlights opaque while fading the text", async () => {
    const f = await fixture({
      inline: run(
        "Highlight",
        paint("FF0000", alpha(25000)) +
          '<a:highlight><a:srgbClr val="FFFF00"/></a:highlight>',
      ),
    });
    const html = render(f, "foreignObject");
    expect(html).toContain("color:rgba(255,0,0,0.25)");
    expect(html).toContain("background-color:#FFFF00");
    expect(html).not.toContain("opacity:");
  });

  it.each(["svg", "foreignObject"])(
    "resolves followed and explicit bullet color alpha in %s",
    async (mode) => {
      const following = await fixture({
        properties: '<a:buClrTx/><a:buChar char="◆"/>',
      });
      const explicit = await fixture({
        properties: `<a:buClr><a:srgbClr val="0000FF">${alpha(60000)}</a:srgbClr></a:buClr><a:buChar char="◆"/>`,
      });
      if (mode === "svg") {
        expect(render(following, mode)).toMatch(
          /fill="#FF0000" fill-opacity="0.35"[^>]*>◆/,
        );
        expect(render(explicit, mode)).toMatch(
          /fill="#0000FF" fill-opacity="0.6"[^>]*>◆/,
        );
      } else {
        expect(render(following, mode)).toContain("color:rgba(255,0,0,0.35)");
        expect(render(explicit, mode)).toContain("color:rgba(0,0,255,0.6)");
      }
    },
  );

  it("preserves alpha in table defaults and allows an opaque run override", async () => {
    const f = await fixture({ table: true });
    const svg = render(f);
    expect(svg).toMatch(
      /fill="#FF0000"[^>]*fill-opacity="0.35"[^>]*>Inherited/,
    );
    expect(svg).toMatch(/fill="#00FF00"[^>]*>Opaque/);
    expect(svg).not.toMatch(/fill="#00FF00"[^>]*fill-opacity/);
  });

  it("authors alpha while preserving other color transforms and unrelated formatting", () => {
    const rpr = props(
      paint(
        "112233",
        '<a:tint val="50000"/>' + alpha(60000) + '<a:alphaMod val="50000"/>',
      ),
    );
    applyRunFormat(rpr, { colorOpacity: 0.4, bold: true });
    expect(serializeFragment(rpr)).toContain('a:tint val="50000"');
    expect(serializeFragment(rpr)).not.toContain("alphaMod");
    expect(parseRPrLikeElement(rpr)).toMatchObject({
      colorOpacity: 0.4,
      bold: true,
    });
    applyRunFormat(rpr, { color: "accent1", colorOpacity: 0.7 });
    expect(parseRPrLikeElement(rpr)).toMatchObject({
      color: "accent1",
      colorOpacity: 0.7,
    });
    applyRunFormat(rpr, { color: "#0000FF" });
    expect(parseRPrLikeElement(rpr)).toMatchObject({
      color: "#0000FF",
      colorOpacity: 1,
    });
  });

  it("rejects invalid or colorless opacity authoring without changing the run", () => {
    for (const opacity of [NaN, Infinity, -0.1, 1.1, 0.5]) {
      const rpr = props("");
      const before = serializeFragment(rpr);
      expect(() =>
        applyRunFormat(rpr, { bold: true, colorOpacity: opacity }),
      ).toThrow();
      expect(serializeFragment(rpr)).toBe(before);
    }
  });

  it("validates supplied colors and rejects malformed local fill choices before authoring alpha", () => {
    for (const [xml, format] of [
      [paint("112233"), { color: "not-a-color", colorOpacity: 0.4 }],
      ["<a:solidFill><a:extLst/></a:solidFill>", { colorOpacity: 0.4 }],
    ]) {
      const rpr = props(xml),
        before = serializeFragment(rpr);
      expect(() => applyRunFormat(rpr, { bold: true, ...format })).toThrow();
      expect(serializeFragment(rpr)).toBe(before);
    }
    const rpr = props(
      '<a:solidFill><a:extLst/><a:srgbClr val="112233"/></a:solidFill>',
    );
    applyRunFormat(rpr, { colorOpacity: 0.4 });
    expect(serializeFragment(rpr)).toContain(
      '<a:srgbClr val="112233"><a:alpha val="40000"/></a:srgbClr>',
    );
  });

  it("keeps opacity through edits, export, reopen and repeated cross-deck copy", async () => {
    const f = await fixture({
      inline: run("Alpha", paint("00AA00", alpha(40000))),
    });
    P.setShapeRunFormat(f.shape, 0, 0, { italic: true });
    let pres = f.pres,
      slide = f.slide;
    for (let i = 0; i < 2; i++) {
      const target = createDeck("blank");
      P.importSlide(target, slide, P.getSlideLayouts(target)[0]);
      pres = await parseDeck(await P.savePresentation(target));
      slide = P.getSlides(pres).at(-1);
      const shape = P.getSlideShapes(slide)[0];
      expect(P.getShapeRunFormatEffective(pres, shape, 0, 0)).toMatchObject({
        color: "#00AA00",
        colorOpacity: 0.4,
        italic: true,
      });
      const before = unzipSync(await P.savePresentation(pres));
      renderSlideToSvg(pres, slide, { textLayout: "svg" });
      expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
    }
  });
});
