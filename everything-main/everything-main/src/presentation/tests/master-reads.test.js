import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { createMappedColorDeck } from "./fixtures.js";
import { P, createDeck, parseDeck, preview } from "../src/model.js";

async function inheritedDeck() {
  const pres = createDeck(),
    slide = P.getSlides(pres)[0];
  P.addSlideTextBox(slide, {
    x: 101,
    y: 202,
    w: 303,
    h: 404,
    text: "Inherited",
  });
  const files = unzipSync(await P.savePresentation(pres));
  const slideName = P.getSlidePartName(slide).slice(1);
  const masterName = P.getSlideMasterPartName(slide).slice(1);
  const xml = strFromU8(files[slideName]);
  const original = xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/)[0];
  const placeholder = original.replace(
    /<p:nvPr\s*\/>/,
    '<p:nvPr><p:ph type="body" idx="42"/></p:nvPr>',
  );
  const masterShape = placeholder
    .replace(/<a:noFill\s*\/>/g, "")
    .replace(
      "</p:spPr>",
      '<a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="654321"/></a:solidFill></a:ln></p:spPr>',
    );
  files[slideName] = strToU8(
    xml.replace(
      original,
      placeholder.replace(/<p:spPr>[\s\S]*?<\/p:spPr>/, "<p:spPr/>"),
    ),
  );
  // Match slide → layout by index and layout → master by body type.
  const layoutName = P.getSlideLayoutPartName(P.getSlideLayout(slide)).slice(1);
  files[layoutName] = strToU8(
    strFromU8(files[layoutName]).replace(
      "</p:spTree>",
      placeholder
        .replace(/<p:spPr>[\s\S]*?<\/p:spPr>/, "<p:spPr/>")
        .replace(
          /<p:txBody>[\s\S]*?<\/p:txBody>/,
          "<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>",
        ) + "</p:spTree>",
    ),
  );
  files[masterName] = strToU8(
    strFromU8(files[masterName])
      .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (sp) =>
        sp.includes('type="body"') ? "" : sp,
      )
      .replace("</p:spTree>", masterShape + "</p:spTree>"),
  );
  return parseDeck(zipSync(files));
}
const context = (pres) => {
  const slide = P.getSlides(pres)[0],
    layout = P.getSlideLayout(slide);
  const pkg = P._internalPackageOf(pres);
  return {
    pres,
    slide,
    layout,
    pkg,
    master: pkg.getPart(P.getSlideMasterPartName(slide)),
    shape: P.getSlideShapes(slide)[0],
  };
};
const replaceBackground = (part, fill) => {
  const xml = strFromU8(part.data).replace(
    /<p:bg\b[^>]*>[\s\S]*?<\/p:bg>/g,
    "",
  );
  part.data = strToU8(
    xml.replace(
      /<p:cSld\b[^>]*>/,
      "$&<p:bg><p:bgPr>" + fill + "</p:bgPr></p:bg>",
    ),
  );
};

describe("shared master reads", () => {
  it("retains first placeholder order when master indexes are reused and rebuilt", async () => {
    const c = context(await inheritedDeck());
    const original = strFromU8(c.master.data);
    const body = original
      .match(/<p:sp\b[\s\S]*?<\/p:sp>/g)
      .find((xml) => xml.includes('idx="42"'));
    const duplicate = body
      .replace(/<p:cNvPr id="[^"]+"/, '<p:cNvPr id="901"')
      .replace('val="123456"', 'val="ABCDEF"');
    c.master.data = strToU8(
      original.replace("</p:spTree>", duplicate + "</p:spTree>"),
    );
    const read = () => P.getShapeFillEffective(c.pres, c.shape);
    expect(read()).toEqual({ kind: "solid", color: "#123456" });
    expect(read()).toEqual({ kind: "solid", color: "#123456" });
    // A nested placeholder still participates in the flattened document
    // order. Replacing bytes must discard both the index and its ordering.
    const grouped = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="900" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${duplicate}</p:grpSp>`;
    c.master.data = strToU8(original.replace(body, grouped + body));
    expect(read()).toEqual({ kind: "solid", color: "#ABCDEF" });
    expect(read()).toEqual({ kind: "solid", color: "#ABCDEF" });
  });

  it("refreshes inherited geometry and paint after bytes, parts, and relationships change", async () => {
    const c = context(await inheritedDeck());
    const isolated = context(await inheritedDeck());
    const read = (c) => ({
      bounds: P.getShapeBoundsResolved(c.pres, c.shape),
      fill: P.getShapeFillEffective(c.pres, c.shape),
      stroke: P.getShapeStrokeEffective(c.pres, c.shape),
    });
    const original = {
      bounds: { x: 101, y: 202, w: 303, h: 404 },
      fill: { kind: "solid", color: "#123456" },
      stroke: { kind: "solid", color: "#654321", widthEmu: 12700 },
    };
    const saved = unzipSync(await P.savePresentation(c.pres));
    expect(read(c)).toEqual(original);
    expect(read(isolated)).toEqual(original);
    preview(c.pres, c.slide);
    expect(unzipSync(await P.savePresentation(c.pres))).toEqual(saved);
    const before = c.master.data;
    c.master.data = strToU8(
      strFromU8(before)
        .replace('x="101"', 'x="909"')
        .replace('val="123456"', 'val="ABCDEF"')
        .replace('w="12700"', 'w="25400"'),
    );
    const changed = {
      bounds: { ...original.bounds, x: 909 },
      fill: { kind: "solid", color: "#ABCDEF" },
      stroke: { ...original.stroke, widthEmu: 25400 },
    };
    expect(read(c)).toEqual(changed);
    expect(read(isolated)).toEqual(original);
    expect(
      read(context(await parseDeck(await P.savePresentation(c.pres)))),
    ).toEqual(changed);
    const rels = c.pkg.getRels(P.getSlideLayoutPartName(c.layout));
    const rel = rels.items.find((r) => r.type.endsWith("/slideMaster"));
    const name = "/ppt/slideMasters/rebound.xml";
    c.pkg.addPart(name, c.master.contentType, before);
    rel.target = name;
    c.pkg.setRels(P.getSlideLayoutPartName(c.layout), rels);
    expect(read(c)).toEqual(original);
    c.pkg.removePart(name);
    expect(P.getShapeBoundsResolved(c.pres, c.shape)).toBeNull();
    c.pkg.addPart(name, c.master.contentType, c.master.data);
    expect(read(c)).toEqual(changed);
  });

  it("refreshes inherited text, gradients, and effects without sharing returned values", async () => {
    const c = context(await inheritedDeck());
    // All properties are authored in the master placeholder; the slide and
    // layout leave these properties unspecified.
    c.master.data = strToU8(
      strFromU8(c.master.data).replace(
        /<p:sp\b[\s\S]*?<\/p:sp>/g,
        (shapeXml) =>
          !shapeXml.includes('idx="42"')
            ? shapeXml
            : shapeXml
                .replace(
                  '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>',
                  '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="123456"/></a:gs></a:gsLst></a:gradFill>',
                )
                .replace(
                  "</p:spPr>",
                  '<a:effectLst><a:glow rad="12700"><a:srgbClr val="ABCDEF"/></a:glow></a:effectLst></p:spPr>',
                )
                .replace("<a:bodyPr", '<a:bodyPr vert="vert270"')
                .replace(
                  "<a:lstStyle/>",
                  '<a:lstStyle><a:lvl1pPr marL="5678"><a:defRPr i="1"/></a:lvl1pPr></a:lstStyle>',
                ),
      ),
    );
    const read = () => ({
      italic: P.getShapeRunFormatEffective(c.pres, c.shape, 0, 0).italic,
      margin: P.getParagraphPropertiesEffective(c.pres, c.shape, 0).marL,
      direction: P.getShapeBodyPrEffective(c.pres, c.shape).vert,
      effects: P.getShapeEffectsEffective(c.pres, c.shape),
      gradient: P.getShapeGradientFillEffective(c.pres, c.shape),
    });
    const first = read();
    expect(first.italic).toBe(true);
    expect(first.margin).toBe(5678);
    expect(first.direction).toBe("vert270");
    expect(first.effects).toEqual([
      { kind: "glow", radiusEmu: 12700, color: "#ABCDEF" },
    ]);
    expect(first.gradient.stops[0].color).toBe("#123456");
    first.gradient.stops[0].color = "#000000";
    first.effects[0].color = "#000000";
    expect(read().gradient.stops[0].color).toBe("#123456");
    expect(read().effects[0].color).toBe("#ABCDEF");
    c.master.data = strToU8(
      strFromU8(c.master.data)
        .replace('i="1"', 'i="0"')
        .replace('marL="5678"', 'marL="8765"')
        .replace('vert="vert270"', 'vert="vert"')
        .replace('val="123456"', 'val="654321"')
        .replace('rad="12700"', 'rad="25400"'),
    );
    const changed = read();
    expect(changed.italic).toBe(false);
    expect(changed.margin).toBe(8765);
    expect(changed.direction).toBe("vert");
    expect(changed.gradient.stops[0].color).toBe("#654321");
    expect(changed.effects[0].radiusEmu).toBe(25400);
  });

  it("keeps template decoration handles independent of shared geometry and refreshes committed edits", async () => {
    const pres = await parseDeck(
      await createMappedColorDeck({ decorations: true }),
    );
    const slide = P.getSlides(pres)[0],
      layout = P.getSlideLayout(slide);
    // Warm the shared master and layout views first.
    P.getEffectiveColorMap(slide);
    const before = unzipSync(await P.savePresentation(pres));
    const readLayout = () =>
      P.getSlideLayoutShapes(pres, P.getSlideLayout(slide));
    const first = readLayout()[0];
    const element = Symbol.for("@office-kit/pptx.shape.element");
    first[element].name = {
      ...first[element].name,
      localName: "changedOnlyInThisHandle",
    };
    expect(P.getShapeXmlString(readLayout()[0])).not.toContain(
      "changedOnlyInThisHandle",
    );
    expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
    const pkg = P._internalPackageOf(pres);
    const layoutPart = pkg.getPart(P.getSlideLayoutPartName(layout));
    layoutPart.data = strToU8(
      strFromU8(layoutPart.data).replaceAll(
        "Mapped layout",
        "Updated layout decoration",
      ),
    );
    expect(P.getShapeText(readLayout()[0])).toBe("Updated layout decoration");
    const masterPart = pkg.getPart(P.getSlideMasterPartName(slide));
    masterPart.data = strToU8(
      strFromU8(masterPart.data).replaceAll(
        "Mapped master",
        "Updated master decoration",
      ),
    );
    expect(P.getShapeText(P.getSlideMasterShapes(pres, layout)[0])).toBe(
      "Updated master decoration",
    );
    const reloaded = await parseDeck(await P.savePresentation(pres));
    const freshLayout = P.getSlideLayout(P.getSlides(reloaded)[0]);
    expect(
      P.getShapeText(P.getSlideLayoutShapes(reloaded, freshLayout)[0]),
    ).toBe("Updated layout decoration");
    expect(
      P.getShapeText(P.getSlideMasterShapes(reloaded, freshLayout)[0]),
    ).toBe("Updated master decoration");
  });

  it("refreshes every master background reader and keeps returned paint independent", async () => {
    const c = context(await inheritedDeck());
    const color = (hex) => `<a:srgbClr val="${hex}"/>`;
    replaceBackground(
      c.master,
      `<a:solidFill>${color("123456")}</a:solidFill>`,
    );
    expect(P.getSlideMasterBackground(c.pres, c.layout)).toEqual({
      kind: "solid",
      color: "#123456",
    });
    replaceBackground(
      c.master,
      `<a:pattFill prst="pct50"><a:fgClr>${color("ABCDEF")}</a:fgClr><a:bgClr>${color("FEDCBA")}</a:bgClr></a:pattFill>`,
    );
    const pattern = P.getSlideMasterBackgroundPatternFill(c.pres, c.layout);
    expect(pattern).toEqual({
      preset: "pct50",
      foreground: "#ABCDEF",
      background: "#FEDCBA",
    });
    pattern.foreground = "#000000";
    expect(
      P.getSlideMasterBackgroundPatternFill(c.pres, c.layout).foreground,
    ).toBe("#ABCDEF");
    replaceBackground(
      c.master,
      `<a:gradFill><a:gsLst><a:gs pos="0">${color("111111")}</a:gs><a:gs pos="100000">${color("EEEEEE")}</a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill>`,
    );
    const gradient = P.getSlideMasterBackgroundGradientFill(c.pres, c.layout);
    expect(gradient.angleDeg).toBe(90);
    expect(gradient.stops.map((s) => s.color)).toEqual(["#111111", "#EEEEEE"]);
    gradient.stops[0].color = "#000000";
    expect(
      P.getSlideMasterBackgroundGradientFill(c.pres, c.layout).stops[0].color,
    ).toBe("#111111");
    const rels = c.pkg.getRels(c.master.name);
    rels.items.push({
      id: "rIdImageTest",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
      target: "../media/master.png",
      targetMode: "Internal",
    });
    c.pkg.setRels(c.master.name, rels);
    const bytes = new Uint8Array([1, 2, 3]);
    c.pkg.addPart("/ppt/media/master.png", "image/png", bytes);
    replaceBackground(
      c.master,
      '<a:blipFill><a:blip r:embed="rIdImageTest"/></a:blipFill>',
    );
    expect(P.getSlideMasterBackgroundImageBytes(c.pres, c.layout)).toEqual(
      bytes,
    );
    expect(P.getSlideMasterBackgroundPatternFill(c.pres, c.layout)).toBeNull();
    expect(P.getSlideMasterBackgroundGradientFill(c.pres, c.layout)).toBeNull();
    rels.items.find((r) => r.id === "rIdImageTest").target =
      "../media/missing.png";
    c.pkg.setRels(c.master.name, rels);
    expect(P.getSlideMasterBackgroundImageBytes(c.pres, c.layout)).toBeNull();
  });
});
