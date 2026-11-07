import { describe, it, expect } from "vitest";
import { P, createDeck, parseDeck } from "../src/model.js";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const customId = "{568D3BE3-C1B2-42EB-99CE-1C9FA5B39818}";
const builtinId = "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}";
async function source(color, id, themed) {
  const pres = createDeck("blank"),
    slide = P.getSlides(pres)[0];
  P.addSlideTable(slide, {
    x: 0,
    y: 0,
    w: P.inches(4),
    h: P.inches(2),
    rows: [["Heading"], ["Body"]],
  });
  const parts = unzipSync(await P.savePresentation(pres));
  parts["ppt/slides/slide1.xml"] = strToU8(
    strFromU8(parts["ppt/slides/slide1.xml"]).replace(
      /<a:tblPr\b[^>]*>[\s\S]*?<\/a:tblPr>/,
      `<a:tblPr firstRow="1"><a:tableStyleId>${id}</a:tableStyleId></a:tblPr>`,
    ),
  );
  const clr = themed
    ? '<a:schemeClr val="accent1"/>'
    : `<a:srgbClr val="${color}"/>`;
  parts["ppt/tableStyles.xml"] = strToU8(
    `<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="${id}"><a:tblStyle styleId="${id}" styleName="Shared source identity"><a:wholeTbl><a:tcStyle><a:fill><a:solidFill>${clr}</a:solidFill></a:fill></a:tcStyle></a:wholeTbl><a:firstRow><a:tcTxStyle b="on"/></a:firstRow></a:tblStyle></a:tblStyleLst>`,
  );
  if (themed)
    for (const name of Object.keys(parts))
      if (/^ppt\/theme\/theme\d+\.xml$/.test(name))
        parts[name] = strToU8(
          strFromU8(parts[name]).replace(
            /<a:accent1>[\s\S]*?<\/a:accent1>/,
            `<a:accent1><a:srgbClr val="${color}"/></a:accent1>`,
          ),
        );
  return parseDeck(zipSync(parts));
}
const table = (slide) => P.getSlideTables(slide)[0];
const fill = (pres, slide) =>
  P.getTableStyleResolver(pres, table(slide)).cell(
    P.getTableCell(table(slide), 0, 0),
  ).fill;
const inlineIds = (parts) =>
  Object.entries(parts)
    .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .flatMap(([, data]) =>
      [
        ...strFromU8(data).matchAll(
          /<\w+:tableStyle\b[^>]*\bstyleId="([^"]+)"/g,
        ),
      ].map((m) => m[1]),
    );

describe("imported table style identity", () => {
  it.each([
    [customId, false],
    [customId, true],
    [builtinId, true],
  ])(
    "separates conflicting definitions for %s (theme references: %s)",
    async (id, themed) => {
      const red = await source("E03050", id, themed),
        green = await source("208040", id, themed);
      const beforeRed = unzipSync(await P.savePresentation(red)),
        beforeGreen = unzipSync(await P.savePresentation(green));
      // The target already owns the same ID. New inline definitions must not
      // collide with that referenced style or with each other in .pptx readers.
      const target = await source("3050E0", id, themed),
        layout = P.getSlideLayouts(target)[0];
      const slides = [P.getSlides(target)[0]];
      for (const p of [red, green, red])
        slides.push(P.importSlide(target, P.getSlides(p)[0], layout));
      const expected = ["#3050E0", "#E03050", "#208040", "#E03050"];
      slides.forEach((slide, i) =>
        expect(fill(target, slide)).toMatchObject({ color: expected[i] }),
      );
      const bytes = await P.savePresentation(target),
        parts = unzipSync(bytes),
        ids = inlineIds(parts);
      expect(ids).toHaveLength(3);
      expect(ids[0]).not.toBe(ids[1]);
      expect(ids[1]).not.toBe(ids[2]);
      for (const copyId of ids) {
        expect(copyId).not.toBe(id);
        expect(copyId).toMatch(
          /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/,
        );
      }
      const reloaded = await parseDeck(bytes);
      P.getSlides(reloaded).forEach((slide, i) =>
        expect(fill(reloaded, slide)).toMatchObject({ color: expected[i] }),
      );
      expect(unzipSync(await P.savePresentation(target))).toEqual(parts);
      expect(unzipSync(await P.savePresentation(reloaded))).toEqual(parts);
      expect(unzipSync(await P.savePresentation(red))).toEqual(beforeRed);
      expect(unzipSync(await P.savePresentation(green))).toEqual(beforeGreen);
    },
  );
  it("keeps copied style formatting through the clipboard's intermediate deck", async () => {
    const original = await source("AB3070", customId, true),
      intermediate = createDeck("blank");
    const staged = P.importSlide(
      intermediate,
      P.getSlides(original)[0],
      P.getSlideLayouts(intermediate)[0],
    );
    const target = await source("30AB70", customId, true);
    const imported = P.importSlide(
      target,
      staged,
      P.getSlideLayouts(target)[0],
    );
    const targetSlide = P.getSlides(target)[0];
    P.copyShape(targetSlide, table(imported));
    P.removeSlide(target, imported);
    const reloaded = await parseDeck(await P.savePresentation(target));
    const tables = P.getSlideTables(P.getSlides(reloaded)[0]);
    expect(tables).toHaveLength(2);
    expect(
      tables.map(
        (t) =>
          P.getTableStyleResolver(reloaded, t).cell(P.getTableCell(t, 0, 0))
            .fill.color,
      ),
    ).toEqual(["#30AB70", "#AB3070"]);
    const ids = inlineIds(unzipSync(await P.savePresentation(reloaded)));
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe(customId);
  });
});
