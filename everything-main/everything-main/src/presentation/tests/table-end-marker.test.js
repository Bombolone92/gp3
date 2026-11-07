import { describe, it, expect } from "vitest";
import { P, createDeck, parseDeck } from "../src/model.js";
import {
  getTableLayout,
  renderSlideToSvg,
} from "../lib/pptx-preview/src/index.ts";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
const run = (text, size) =>
  `<a:r>${size ? `<a:rPr sz="${size * 100}"/>` : ""}<a:t>${text}</a:t></a:r>`;
const marker = (size) =>
  `<a:endParaRPr sz="${size * 100}"><a:latin typeface="Arial"/></a:endParaRPr>`;
const measureText = (text, font) => ({
  widthPx: (text.length * font.sizePx) / 2,
  ascentPx: font.sizePx * 0.9,
  descentPx: font.sizePx * 0.2,
  lineGapPx: 0,
});
async function fixture({
  level = 3,
  master,
  list = "",
  ppr = "",
  inline = run("Alpha"),
  end = 48,
} = {}) {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  P.setPresentationFonts(p, { minorLatin: "Arial" });
  P.addSlideTable(s, {
    x: 0,
    y: 0,
    w: P.inches(4),
    h: P.inches(0.01),
    rows: [["Seed"]],
  });
  const files = unzipSync(await P.savePresentation(p));
  for (const name of Object.keys(files))
    if (/^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(name))
      files[name] = strToU8(
        strFromU8(files[name]).replace(
          /<p:otherStyle>[\s\S]*?<\/p:otherStyle>/,
          `<p:otherStyle>${master ? `<a:lvl${level + 1}pPr><a:defRPr sz="${master * 100}"/></a:lvl${level + 1}pPr>` : ""}</p:otherStyle>`,
        ),
      );
  files["ppt/slides/slide1.xml"] = strToU8(
    strFromU8(files["ppt/slides/slide1.xml"])
      .replace(
        /<a:txBody>[\s\S]*?<\/a:txBody>/,
        `<a:txBody><a:bodyPr/><a:lstStyle>${list}</a:lstStyle><a:p><a:pPr lvl="${level}" marL="0" indent="0">${ppr}</a:pPr>${inline}${marker(end)}</a:p></a:txBody>`,
      )
      .replace(
        /<a:tcPr\b[^>]*>/,
        (m) =>
          '<a:tcPr marL="0" marR="0" marT="0" marB="0"' +
          (m.endsWith("/>") ? "/>" : ">"),
      ),
  );
  const pres = await parseDeck(zipSync(files)),
    slide = P.getSlides(pres)[0],
    table = P.getSlideTables(slide)[0],
    cell = P.getTableCell(table, 0, 0);
  return { pres, slide, table, cell };
}
const paragraph = (f) => {
  const r = P.getTableStyleResolver(f.pres, f.table);
  return r.paragraphs(f.cell, r.cell(f.cell).textFormat)[0];
};
const height = (f) =>
  getTableLayout(f.pres, f.table, { measureText }).height / 12700;
describe("table paragraph-end line metrics", () => {
  it.each([0, 3, 8])(
    "distinguishes implicit 18pt glyphs from an authored size at level %i",
    async (level) => {
      const implicit = await fixture({ level }),
        authored = await fixture({ level, master: 18 });
      for (const f of [implicit, authored])
        expect(paragraph(f).elements[0].format.size).toBe(18);
      expect(paragraph(implicit).endMarkerFormat.size).toBe(48);
      expect(height(implicit)).toBeCloseTo(57.6, 5);
      expect(paragraph(authored).endMarkerFormat.size).toBe(18);
      expect(height(authored)).toBeCloseTo(21.6, 5);
      const svg = renderSlideToSvg(implicit.pres, implicit.slide, {
        textLayout: "svg",
        measureText,
      });
      expect(svg).toContain('font-size="24"');
      expect(svg).not.toContain('font-size="64"');
    },
  );
  it.each([
    [{ master: 26 }, 26],
    [{ list: '<a:lvl4pPr><a:defRPr sz="2200"/></a:lvl4pPr>' }, 22],
    [{ ppr: '<a:defRPr sz="1600"/>' }, 16],
    [{ inline: run("Alpha", 20) }, 20],
  ])(
    "resolves authored sizing before paragraph-end sizing: %j",
    async (options, size) => {
      const f = await fixture(options);
      expect(paragraph(f).endMarkerFormat.size).toBe(size);
      expect(height(f)).toBeCloseTo(size * 1.2, 5);
    },
  );
  it("uses the final inline item while retaining the larger glyph metrics on that line", async () => {
    const a = await fixture({ inline: run("Alpha ", 20) + run("Beta") }),
      b = await fixture({ inline: run("Alpha ") + run("Beta", 20) }),
      c = await fixture({ inline: run("Alpha ", 36) + run("Beta"), end: 24 });
    expect(height(a)).toBeCloseTo(57.6, 5);
    expect(height(b)).toBeCloseTo(24, 5);
    expect(height(c)).toBeCloseTo(43.2, 5);
    expect(paragraph(a).elements.map((e) => e.format.size)).toEqual([20, 18]);
  });
  it("keeps the marker on the final line, including an empty line after a break", async () => {
    const f = await fixture({ inline: run("Alpha") + "<a:br/>" + run("Beta") });
    expect(height(f)).toBeCloseTo(79.2, 5);
    const trailing = await fixture({ inline: run("Alpha", 20) + "<a:br/>" });
    expect(height(trailing)).toBeCloseTo(81.6, 5);
    const empty = await fixture({ inline: "" });
    expect(height(empty)).toBeCloseTo(57.6, 5);
    const small = await fixture({ end: 8 });
    expect(height(small)).toBeCloseTo(21.6, 5);
  });
  it("uses field formatting without changing cached field text", async () => {
    const f = await fixture({
      inline:
        '<a:fld id="{08BE19D0-77ED-46FD-97C4-A57BBEB7F907}" type="slidenum"><a:t>14</a:t></a:fld>',
    });
    expect(paragraph(f).elements[0]).toMatchObject({
      kind: "fld",
      text: "14",
      format: { size: 18 },
    });
    expect(height(f)).toBeCloseTo(57.6, 5);
  });
  it("preserves authored XML through reads, both renderers, copying and save/reload", async () => {
    const f = await fixture(),
      before = unzipSync(await P.savePresentation(f.pres));
    height(f);
    for (const textLayout of ["svg", "foreignObject"])
      renderSlideToSvg(f.pres, f.slide, { textLayout, measureText });
    expect(unzipSync(await P.savePresentation(f.pres))).toEqual(before);
    let source = f.slide;
    for (let i = 0; i < 2; i++) {
      const dest = createDeck("blank");
      P.importSlide(dest, source, P.getSlideLayouts(dest)[0]);
      const pres = await parseDeck(await P.savePresentation(dest));
      source = P.getSlides(pres).at(-1);
      const table = P.getSlideTables(source)[0];
      expect(height({ pres, table })).toBeCloseTo(57.6, 5);
    }
    expect(unzipSync(await P.savePresentation(f.pres))).toEqual(before);
  });
});
