import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck, preview } from "../src/model.js";
import { parseXml } from "../lib/pptx/src/internal/xml/index.ts";
import { parseRPrLikeElement } from "../lib/pptx/src/api/fn/shape-color.ts";
import { createMappedColorDeck } from "./fixtures.js";
import { resolveTextBodyModel } from "../lib/pptx-preview/src/render-slide.ts";
import { defaultMeasurer } from "../lib/pptx-preview/src/index.ts";

async function mappedDeck() {
  return parseDeck(await createMappedColorDeck({ highlight: true }));
}

const firstShape = (pres) => P.getSlideShapes(P.getSlides(pres)[0])[0];
const overrideXml = (map) =>
  `<p:clrMapOvr><drawing:overrideClrMapping xmlns:drawing="http://schemas.openxmlformats.org/drawingml/2006/main" ${Object.entries(
    {
      bg1: "lt1",
      tx1: "dk1",
      bg2: "lt2",
      tx2: "dk2",
      accent1: "accent1",
      accent2: "accent2",
      accent3: "accent3",
      accent4: "accent4",
      accent5: "accent5",
      accent6: "accent6",
      hlink: "hlink",
      folHlink: "folHlink",
      ...map,
    },
  )
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ")}/></p:clrMapOvr>`;
const replaceOverride = (xml, override) =>
  xml
    .replace(/<p:clrMapOvr\b[^>]*>[\s\S]*?<\/p:clrMapOvr>/g, "")
    .replace("</p:cSld>", "</p:cSld>" + override);

async function overriddenDeck({
  slideOverride = "inherit",
  decorations = false,
  painted = false,
} = {}) {
  const files = unzipSync(
    await createMappedColorDeck({ decorations, painted }),
  );
  files["ppt/slideLayouts/slideLayout1.xml"] = strToU8(
    replaceOverride(
      strFromU8(files["ppt/slideLayouts/slideLayout1.xml"]),
      overrideXml({ tx1: "accent1" }),
    ),
  );
  const override =
    slideOverride === "inherit"
      ? "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>"
      : slideOverride === null
        ? ""
        : overrideXml(slideOverride);
  files["ppt/slides/slide1.xml"] = strToU8(
    replaceOverride(strFromU8(files["ppt/slides/slide1.xml"]), override),
  );
  return parseDeck(zipSync(files));
}

describe("mapped text colors", () => {
  it("resolves standalone text models independently of the last rendered slide", async () => {
    const pres = await mappedDeck(),
      shape = firstShape(pres);
    const other = await overriddenDeck({ slideOverride: { tx1: "accent2" } });
    preview(other, P.getSlides(other)[0]);
    const model = resolveTextBodyModel(
      pres,
      shape,
      P.getShapeBounds(shape),
      P.getPresentationTheme(pres),
      null,
      defaultMeasurer,
      "#000000",
    );
    expect(model.paraData[0].runs[0].fmt.color).toBe("#FFFFFF");
  });

  it.each([
    "paragraph",
    "text body",
    "layout",
    "master placeholder",
    "master style",
  ])(
    "maps inherited %s run colors before applying transforms",
    async (layer) => {
      const files = unzipSync(await createMappedColorDeck());
      const slidePart = "ppt/slides/slide1.xml";
      let xml = strFromU8(files[slidePart]);
      const original = xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/)[0];
      let shape = original.replace(/<a:solidFill>[\s\S]*?<\/a:solidFill>/g, "");
      const fill =
        '<a:solidFill><a:schemeClr val="tx1"><a:lumMod val="50000"/></a:schemeClr></a:solidFill>';
      const defaults = `<a:defRPr>${fill}</a:defRPr>`;
      const list = `<a:lstStyle><a:lvl1pPr>${defaults}</a:lvl1pPr></a:lstStyle>`;
      if (layer === "paragraph")
        shape = shape.replace("<a:p>", `<a:p><a:pPr>${defaults}</a:pPr>`);
      else if (layer === "text body")
        shape = shape.replace("<a:lstStyle/>", list);
      else {
        shape = shape.replace(
          "<p:nvPr/>",
          '<p:nvPr><p:ph type="body" idx="93"/></p:nvPr>',
        );
        const part =
          layer === "layout"
            ? "ppt/slideLayouts/slideLayout1.xml"
            : "ppt/slideMasters/slideMaster1.xml";
        // Master inheritance still passes through an index-matched layout slot.
        if (layer !== "layout") {
          const layoutPart = "ppt/slideLayouts/slideLayout1.xml";
          files[layoutPart] = strToU8(
            strFromU8(files[layoutPart]).replace(
              "</p:spTree>",
              shape + "</p:spTree>",
            ),
          );
        }
        let parent = strFromU8(files[part]);
        if (layer === "master placeholder")
          parent = parent.replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (sp) =>
            sp.includes('type="body"') ? "" : sp,
          );
        if (layer === "master style")
          parent = parent.replace(
            /<p:bodyStyle>[\s\S]*?<\/p:bodyStyle>/,
            `<p:bodyStyle><a:lvl1pPr>${defaults}</a:lvl1pPr></p:bodyStyle>`,
          );
        else
          parent = parent.replace(
            "</p:spTree>",
            shape.replace("<a:lstStyle/>", list) + "</p:spTree>",
          );
        files[part] = strToU8(parent);
      }
      files[slidePart] = strToU8(xml.replace(original, shape));
      const pres = await parseDeck(zipSync(files)),
        text = firstShape(pres);
      const before = unzipSync(await P.savePresentation(pres));
      expect(P.getShapeRunFormat(text, 0, 0).color).toBeUndefined();
      expect(P.getShapeRunFormatEffective(pres, text, 0, 0).color).toBe(
        "#808080",
      );
      expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
    },
  );

  it.each(["inherit", null])(
    "inherits layout overrides when the slide mapping is %s",
    async (slideOverride) => {
      const pres = await overriddenDeck({ slideOverride });
      const slide = P.getSlides(pres)[0],
        shape = firstShape(pres);
      const before = unzipSync(await P.savePresentation(pres));
      expect(P.getEffectiveColorMap(slide).tx1).toBe("accent1");
      expect(P.getShapeRunFormatEffective(pres, shape, 0, 0).color).toBe(
        P.getPresentationTheme(pres).accent1,
      );
      expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
    },
  );

  it("uses the slide override for slide text and template decorations without rewriting any of them", async () => {
    const pres = await overriddenDeck({
      slideOverride: { tx1: "accent2" },
      decorations: true,
    });
    const slide = P.getSlides(pres)[0],
      layout = P.getSlideLayout(slide);
    const theme = P.getPresentationTheme(pres),
      before = unzipSync(await P.savePresentation(pres));
    const masterText = P.getSlideMasterShapes(pres, layout).find(
      (s) => P.getShapeText(s) === "Mapped master",
    );
    const layoutText = P.getSlideLayoutShapes(pres, layout).find(
      (s) => P.getShapeText(s) === "Mapped layout",
    );
    expect(P.getShapeRunFormatEffective(pres, masterText, 0, 0).color).toBe(
      theme.light1,
    );
    expect(P.getShapeRunFormatEffective(pres, layoutText, 0, 0).color).toBe(
      theme.accent1,
    );
    const svg = decodeURIComponent(preview(pres, slide));
    for (const layer of ["slide", "layout", "master"])
      expect(svg).toContain(`fill="${theme.accent2}">Mapped ${layer}</tspan>`);
    expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
  });

  it("updates layout overrides and layout relationships without retaining stale maps", async () => {
    const pres = await overriddenDeck(),
      slide = P.getSlides(pres)[0],
      shape = firstShape(pres);
    const theme = P.getPresentationTheme(pres),
      pkg = P._internalPackageOf(pres);
    const color = () => P.getShapeRunFormatEffective(pres, shape, 0, 0).color;
    expect(color()).toBe(theme.accent1);
    const layout = pkg.getPart(
      P.getSlideLayoutPartName(P.getSlideLayout(slide)),
    );
    layout.data = strToU8(
      replaceOverride(strFromU8(layout.data), overrideXml({ tx1: "accent2" })),
    );
    expect(color()).toBe(theme.accent2);
    const other = P.getSlideLayouts(pres).find(
      (l) => P.getSlideLayoutPartName(l) !== layout.name,
    );
    P.setSlideLayout(slide, other);
    expect(color()).toBe(theme.light1);
    P.setSlideLayout(
      slide,
      P.getSlideLayouts(pres).find(
        (l) => P.getSlideLayoutPartName(l) === layout.name,
      ),
    );
    expect(color()).toBe(theme.accent2);
  });

  it("refreshes master relationships, replaced parts, and missing masters", async () => {
    const pres = await mappedDeck(),
      slide = P.getSlides(pres)[0],
      shape = firstShape(pres);
    const pkg = P._internalPackageOf(pres),
      theme = P.getPresentationTheme(pres);
    const color = () => P.getShapeRunFormatEffective(pres, shape, 0, 0).color;
    expect(color()).toBe(theme.light1);
    const master = pkg.getPart(P.getSlideMasterPartName(slide));
    const nextName = "/ppt/slideMasters/replacement.xml";
    pkg.addPart(
      nextName,
      master.contentType,
      strToU8(strFromU8(master.data).replace('tx1="lt1"', 'tx1="accent2"')),
    );
    const layoutName = P.getSlideLayoutPartName(P.getSlideLayout(slide)),
      rels = pkg.getRels(layoutName);
    rels.items.find((r) => r.type.endsWith("/slideMaster")).target =
      "../slideMasters/replacement.xml";
    pkg.setRels(layoutName, rels);
    expect(color()).toBe(theme.accent2);
    pkg.removePart(nextName);
    pkg.addPart(nextName, master.contentType, master.data);
    expect(color()).toBe(theme.light1);
    pkg.removePart(nextName);
    expect(color()).toBe(theme.dark1);
  });

  it("resolves foreground and highlight through the master map without rewriting their tokens", async () => {
    const pres = await mappedDeck(),
      shape = firstShape(pres);
    const before = unzipSync(await P.savePresentation(pres));
    const theme = P.getPresentationTheme(pres);
    expect(P.getShapeRunFormat(shape, 0, 0)).toMatchObject({
      color: "tx1",
      highlight: "tx2",
    });
    expect(P.getShapeRunFormatEffective(pres, shape, 0, 0)).toMatchObject({
      color: theme.light1,
      highlight: theme.light2,
    });
    expect(decodeURIComponent(preview(pres, P.getSlides(pres)[0]))).toContain(
      theme.light1,
    );
    expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
    const copy = P.copyShape(P.getSlides(pres)[0], shape);
    expect(P.getShapeRunFormatEffective(pres, copy, 0, 0).color).toBe(
      theme.light1,
    );
    const restored = await parseDeck(await P.savePresentation(pres));
    expect(P.getShapeRunFormat(firstShape(restored), 0, 0).color).toBe("tx1");
    expect(
      P.getShapeRunFormatEffective(restored, firstShape(restored), 0, 0).color,
    ).toBe(theme.light1);
  });

  it("invalidates cached master reads after changed bytes and does not share maps across presentations", async () => {
    const pres = await mappedDeck(),
      shape = firstShape(pres);
    const other = await mappedDeck();
    expect(P.getShapeRunFormatEffective(pres, shape, 0, 0).color).toBe(
      "#FFFFFF",
    );
    const master = P._internalPackageOf(pres).getPart(
      "/ppt/slideMasters/slideMaster1.xml",
    );
    master.data = strToU8(
      strFromU8(master.data).replace('tx1="lt1"', 'tx1="dk1"'),
    );
    expect(P.getShapeRunFormatEffective(pres, shape, 0, 0).color).toBe(
      "#000000",
    );
    expect(
      P.getShapeRunFormatEffective(other, firstShape(other), 0, 0).color,
    ).toBe("#FFFFFF");
  });

  it("applies transforms after mapping and avoids map lookup for literal colors", () => {
    const run = (fill) =>
      parseXml(
        `<a:rPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:solidFill>${fill}</a:solidFill></a:rPr>`,
      ).root;
    const pres = createDeck(),
      theme = P.getPresentationTheme(pres);
    expect(
      parseRPrLikeElement(
        run('<a:schemeClr val="tx1"><a:lumMod val="50000"/></a:schemeClr>'),
        { theme, clrMap: { tx1: "lt1" } },
      ).color,
    ).toBe("#808080");
    expect(
      parseRPrLikeElement(run('<a:srgbClr val="123456"/>'), {
        theme,
        get clrMap() {
          throw Error("unnecessary map lookup");
        },
      }).color,
    ).toBe("#123456");
  });
});

const patternXml =
  '<a:pattFill prst="pct50"><a:fgClr><a:schemeClr val="tx1"><a:lumMod val="50000"/></a:schemeClr></a:fgClr><a:bgClr><a:schemeClr val="bg1"/></a:bgClr></a:pattFill>';

async function rewriteSlide(pres, rewrite) {
  const files = unzipSync(await P.savePresentation(pres));
  const part = P.getSlidePartName(P.getSlides(pres)[0]).slice(1);
  files[part] = strToU8(rewrite(strFromU8(files[part])));
  return parseDeck(zipSync(files));
}

describe("mapped shape and background paint", () => {
  it("paints template fills, outlines, and text with the host slide's override", async () => {
    const pres = await overriddenDeck({
      slideOverride: { tx1: "accent2", bg1: "accent3" },
      decorations: true,
      painted: true,
    });
    const slide = P.getSlides(pres)[0],
      theme = P.getPresentationTheme(pres);
    const before = unzipSync(await P.savePresentation(pres));
    const svg = decodeURIComponent(preview(pres, slide));
    for (const layer of ["slide", "layout", "master"]) {
      const group = svg
        .split(`<g data-pptx-shape-name="Mapped ${layer}">`)[1]
        ?.split("<g data-pptx-shape-name=")[0];
      expect(group, layer).toBeDefined();
      expect(group).toContain(`fill="${theme.accent3}"`);
      expect(group).toContain(`stroke="${theme.accent2}"`);
      expect(group).toContain(
        `fill="${theme.accent2}">Mapped ${layer}</tspan>`,
      );
    }
    const layout = P.getSlideLayout(slide);
    const decoration = P.getSlideLayoutShapes(pres, layout).find(
      (s) => P.getShapeText(s) === "Mapped layout",
    );
    expect(P.getShapeFillColorResolved(pres, decoration)).toBe(theme.light1);
    expect(P.getShapeStrokeColorResolved(pres, decoration)).toBe(theme.accent1);
    const legacy = P.getSlideLayoutBackgroundShapes(pres, layout).find(
      (s) => s.bounds?.y === P.inches(3),
    );
    expect(legacy.fillHex).toBe(theme.light1);
    expect(legacy.strokeHex).toBe(theme.accent1);
    expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
  });

  it("resolves mapped fills and outlines before transforms without changing authored tokens", async () => {
    let pres = await parseDeck(await createMappedColorDeck({ painted: true }));
    pres = await rewriteSlide(pres, (xml) =>
      xml.replaceAll(
        '<a:schemeClr val="tx1"/>',
        '<a:schemeClr val="tx1"><a:lumMod val="50000"/></a:schemeClr>',
      ),
    );
    const shape = firstShape(pres),
      before = unzipSync(await P.savePresentation(pres));
    expect(P.getShapeFillColorResolved(pres, shape)).toBe("#000000");
    expect(P.getShapeStrokeColorResolved(pres, shape)).toBe("#808080");
    expect(P.getShapeFill(shape).color).toBe("scheme:bg1");
    expect(P.getShapeStroke(shape).color).toBe("scheme:tx1");
    expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
  });

  it("maps patterns, effects, and bullets and preserves them through copying and export", async () => {
    let pres = await mappedDeck();
    P.setParagraphBullet(firstShape(pres), 0, "bullet");
    P.clearShapeFill(firstShape(pres));
    pres = await rewriteSlide(pres, (xml) =>
      xml
        .replace(
          "</p:spPr>",
          patternXml +
            '<a:effectLst><a:glow rad="12700"><a:schemeClr val="tx1"/></a:glow><a:outerShdw blurRad="12700" dist="25400" dir="5400000"><a:schemeClr val="tx1"><a:lumMod val="50000"/></a:schemeClr></a:outerShdw></a:effectLst></p:spPr>',
        )
        .replace(
          "<a:buChar",
          '<a:buClr><a:schemeClr val="tx1"><a:lumMod val="50000"/></a:schemeClr></a:buClr><a:buChar',
        ),
    );
    const shape = firstShape(pres),
      slide = P.getSlides(pres)[0];
    const before = unzipSync(await P.savePresentation(pres));
    const check = (deck, s) => {
      expect(P.getShapePatternFill(deck, s)).toEqual({
        preset: "pct50",
        foreground: "#808080",
        background: "#FFFFFF",
      });
      expect(P.getShapeEffectsEffective(deck, s)).toEqual([
        { kind: "glow", color: "#FFFFFF", radiusEmu: 12700 },
        {
          kind: "outerShdw",
          color: "#808080",
          blurEmu: 12700,
          distEmu: 25400,
          angleDeg: 90,
        },
      ]);
      expect(P.getParagraphBulletStyle(deck, s, 0).color).toBe("#808080");
    };
    check(pres, shape);
    expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
    const copy = P.copyShape(slide, shape);
    check(pres, copy);
    const restored = await parseDeck(await P.savePresentation(pres));
    for (const s of P.getSlideShapes(P.getSlides(restored)[0]))
      check(restored, s);
  });

  it("maps image duotone colors in their owning or supplied slide context", async () => {
    let pres = await mappedDeck();
    P.clearShapeFill(firstShape(pres));
    pres = await rewriteSlide(pres, (xml) =>
      xml.replace(
        "</p:spPr>",
        '<a:blipFill><a:blip><a:duotone><a:schemeClr val="tx1"/><a:schemeClr val="tx2"/></a:duotone></a:blip></a:blipFill></p:spPr>',
      ),
    );
    const shape = firstShape(pres),
      theme = P.getPresentationTheme(pres);
    const before = unzipSync(await P.savePresentation(pres));
    expect(P.getShapeImageDuotone(pres, shape)).toEqual({
      firstColor: "#FFFFFF",
      secondColor: theme.light2,
    });
    expect(
      P.getShapeImageDuotone(pres, shape, { tx1: "accent2", tx2: "accent3" }),
    ).toEqual({ firstColor: theme.accent2, secondColor: theme.accent3 });
    expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
  });

  it("maps all table border directions using the owning slide", async () => {
    let pres = await mappedDeck();
    P.addSlideTable(P.getSlides(pres)[0], {
      x: 0,
      y: 0,
      w: P.inches(4),
      h: P.inches(1),
      rows: [["Cell"]],
    });
    pres = await rewriteSlide(pres, (xml) =>
      xml.replace(
        /<a:tcPr\b[^>]*\/>/,
        `<a:tcPr>${["L", "R", "T", "B", "TlToBr", "BlToTr"].map((side) => `<a:ln${side} w="12700"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="50000"/></a:schemeClr></a:solidFill></a:ln${side}>`).join("")}</a:tcPr>`,
      ),
    );
    const table = P.getSlideShapes(P.getSlides(pres)[0])[1];
    const before = unzipSync(await P.savePresentation(pres));
    for (const border of Object.values(
      P.getTableCellBorders(pres, P.getTableCell(table, 0, 0)),
    ))
      expect(border).toEqual({ color: "#808080", widthEmu: 12700, dash: null });
    expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
  });

  it.each(["slide", "layout", "master"])(
    "maps a %s pattern background in the rendering slide's context",
    async (layer) => {
      let pres = await overriddenDeck({
        slideOverride: { tx1: "accent2", bg1: "accent3" },
      });
      const slide = P.getSlides(pres)[0],
        layout = P.getSlideLayout(slide);
      const files = unzipSync(await P.savePresentation(pres));
      const target =
        layer === "slide"
          ? P.getSlidePartName(slide)
          : layer === "layout"
            ? P.getSlideLayoutPartName(layout)
            : P.getSlideMasterPartName(slide);
      for (const part of [
        P.getSlidePartName(slide),
        P.getSlideLayoutPartName(layout),
        P.getSlideMasterPartName(slide),
      ]) {
        let xml = strFromU8(files[part.slice(1)]).replace(
          /<p:bg\b[^>]*>[\s\S]*?<\/p:bg>/g,
          "",
        );
        if (part === target)
          xml = xml.replace(
            /(<p:cSld\b[^>]*>)/,
            `$1<p:bg><p:bgPr>${patternXml}</p:bgPr></p:bg>`,
          );
        files[part.slice(1)] = strToU8(xml);
      }
      pres = await parseDeck(zipSync(files));
      const loaded = P.getSlides(pres)[0],
        theme = P.getPresentationTheme(pres),
        map = P.getEffectiveColorMap(loaded);
      const reader =
        layer === "slide"
          ? P.getSlideBackgroundPatternFill
          : layer === "layout"
            ? P.getSlideLayoutBackgroundPatternFill
            : P.getSlideMasterBackgroundPatternFill;
      const owner = layer === "slide" ? loaded : P.getSlideLayout(loaded);
      const expected = parseRPrLikeElement(
        parseXml(
          `<a:rPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="50000"/></a:schemeClr></a:solidFill></a:rPr>`,
        ).root,
        { theme, clrMap: map },
      ).color;
      expect(reader(pres, owner, map)).toEqual({
        preset: "pct50",
        foreground: expected,
        background: theme.accent3,
      });
      const svg = decodeURIComponent(preview(pres, loaded));
      expect(svg).toContain(`fill="${theme.accent3}"`);
      expect(svg).toContain(expected);
      expect(unzipSync(await P.savePresentation(pres))).toEqual(files);
    },
  );
});

describe("mapped field formatting", () => {
  it("inherits field styles without changing regular run indices or cached field data", async () => {
    const files = unzipSync(await createMappedColorDeck());
    const part = "ppt/slides/slide1.xml";
    let xml = strFromU8(files[part]);
    const original = xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/)[0];
    const placeholder = original.replace(
      "<p:nvPr/>",
      '<p:nvPr><p:ph type="dt" idx="93"/></p:nvPr>',
    );
    const fields =
      '<a:fld id="{11111111-1111-1111-1111-111111111111}" type="datetime1"><a:rPr lang="en-US" sz="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>9/16/2026</a:t></a:fld><a:br/><a:fld id="{22222222-2222-2222-2222-222222222222}" type="slidenum"><a:rPr lang="en-US"/><a:t>14</a:t></a:fld>';
    files[part] = strToU8(
      xml.replace(original, placeholder.replace("</a:p>", fields + "</a:p>")),
    );
    const layoutPart = "ppt/slideLayouts/slideLayout1.xml";
    const layoutShape = placeholder.replace(
      "<a:lstStyle/>",
      '<a:lstStyle><a:lvl1pPr><a:defRPr sz="800"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr></a:lstStyle>',
    );
    files[layoutPart] = strToU8(
      strFromU8(files[layoutPart]).replace(
        "</p:spTree>",
        layoutShape + "</p:spTree>",
      ),
    );
    const pres = await parseDeck(zipSync(files)),
      slide = P.getSlides(pres)[0],
      shape = firstShape(pres);
    const before = unzipSync(await P.savePresentation(pres));
    expect(P.getShapeRunCount(shape, 0)).toBe(1);
    expect(P.getShapeRunText(shape, 0, 0)).toBe("Mapped text");
    expect(P.getShapeFieldFormatEffective(pres, shape, 0, 0)).toMatchObject({
      color: "#FFFFFF",
      size: 12,
      font: "Arial",
    });
    expect(P.getShapeFieldFormatEffective(pres, shape, 0, 1)).toMatchObject({
      color: P.getPresentationTheme(pres).light2,
      size: 8,
      font: "Arial",
    });
    expect(() => P.getShapeFieldFormatEffective(pres, shape, 0, 2)).toThrow(
      RangeError,
    );
    expect(() => P.getShapeFieldFormatEffective(pres, shape, 0, -1)).toThrow(
      RangeError,
    );
    P.refreshPresentationFields(pres, new Date(2026, 8, 16));
    const svg = decodeURIComponent(preview(pres, slide));
    expect(svg).toContain('fill="#FFFFFF">9/16/26</tspan>');
    expect(svg).toContain(
      `fill="${P.getPresentationTheme(pres).light2}">1</tspan>`,
    );
    expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
    P.copyShape(slide, shape);
    const restored = await parseDeck(await P.savePresentation(pres));
    for (const copy of P.getSlideShapes(P.getSlides(restored)[0])) {
      expect(P.getShapeParagraphElements(copy, 0).map((el) => el.text)).toEqual(
        ["Mapped text", "9/16/2026", undefined, "14"],
      );
      expect(
        P.getShapeFieldFormatEffective(restored, copy, 0, 1),
      ).toMatchObject({
        color: P.getPresentationTheme(restored).light2,
        size: 8,
        font: "Arial",
      });
    }
  });
});
