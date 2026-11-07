import { describe, it, expect } from "vitest";
import { P, createDeck, parseDeck } from "../src/model.js";
import {
  renderSlideToSvg,
  getTableLayout,
} from "../lib/pptx-preview/src/index.ts";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
const id = "{68264547-E1FC-4E31-8FC1-BCDD8491B880}";
const paint = (color) =>
  `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
const props = (size, color, font) =>
  `<a:defRPr${size ? ` sz="${size * 100}"` : ""}>${color ? paint(color) : ""}${font ? `<a:latin typeface="${font}"/>` : ""}</a:defRPr>`;
const defaultMaster = `<a:lvl1pPr marL="0" algn="r"><a:defRPr sz="2300" b="1" i="1" u="sng" spc="100">${paint("008800")}<a:latin typeface="Georgia"/></a:defRPr></a:lvl1pPr><a:lvl2pPr marL="12345">${props(25)}</a:lvl2pPr>`;
async function fixture({
  master = defaultMaster,
  list = "",
  paragraphs = "<a:p><a:r><a:t>Test</a:t></a:r></a:p>",
  style = "",
  sections = "",
  tableAttributes = "",
  mapping,
} = {}) {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  P.addSlideTable(s, {
    x: 0,
    y: 0,
    w: P.inches(5),
    h: P.inches(0.1),
    rows: [["Test"]],
  });
  const files = unzipSync(await P.savePresentation(p));
  let xml = strFromU8(files["ppt/slides/slide1.xml"])
    .replace(
      /<a:txBody>[\s\S]*?<\/a:txBody>/,
      `<a:txBody><a:bodyPr/><a:lstStyle>${list}</a:lstStyle>${paragraphs}</a:txBody>`,
    )
    .replace(
      /<a:tblPr\b[^>]*>[\s\S]*?<\/a:tblPr>/,
      `<a:tblPr ${tableAttributes}><a:tableStyleId>${id}</a:tableStyleId></a:tblPr>`,
    );
  if (mapping)
    xml = xml.replace(
      "</p:sld>",
      `<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="accent1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sld>`,
    );
  files["ppt/slides/slide1.xml"] = strToU8(xml);
  files["ppt/tableStyles.xml"] = strToU8(
    `<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="${id}"><a:tblStyle styleId="${id}" styleName="Text inheritance"><a:wholeTbl><a:tcTxStyle>${style}</a:tcTxStyle></a:wholeTbl>${sections}</a:tblStyle></a:tblStyleLst>`,
  );
  for (const name of Object.keys(files)) {
    let x = strFromU8(files[name]);
    if (/^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(name))
      x = x
        .replace(
          /<p:otherStyle>[\s\S]*?<\/p:otherStyle>/,
          `<p:otherStyle>${master}</p:otherStyle>`,
        )
        .replace(
          /<p:bodyStyle>[\s\S]*?<\/p:bodyStyle>/,
          `<p:bodyStyle><a:lvl1pPr>${props(17, "CC0000", "Arial")}</a:lvl1pPr></p:bodyStyle>`,
        );
    else if (name === "ppt/presentation.xml")
      x = x.replace(
        /<p:defaultTextStyle>[\s\S]*?<\/p:defaultTextStyle>/,
        `<p:defaultTextStyle><a:lvl1pPr>${props(29, "0000CC", "Courier New")}</a:lvl1pPr></p:defaultTextStyle>`,
      );
    else if (/^ppt\/theme\/theme\d+\.xml$/.test(name))
      x = x
        .replace(
          /(<a:minorFont>\s*<a:latin typeface=")[^"]+/,
          "$1Times New Roman",
        )
        .replace(
          /<a:accent1>[\s\S]*?<\/a:accent1>/,
          '<a:accent1><a:srgbClr val="CC7700"/></a:accent1>',
        );
    else continue;
    files[name] = strToU8(x);
  }
  const pres = await parseDeck(zipSync(files)),
    slide = P.getSlides(pres)[0],
    table = P.getSlideTables(slide)[0],
    cell = P.getTableCell(table, 0, 0);
  return { pres, slide, table, cell };
}
const paras = (f) => {
  const r = P.getTableStyleResolver(f.pres, f.table);
  return r.paragraphs(f.cell, r.cell(f.cell).textFormat);
};
const run = (f) => paras(f)[0].elements[0].format;

describe("native table text inheritance", () => {
  it("inherits master otherStyle size and emphasis, but uses table theme font and text color", async () => {
    const f = await fixture();
    expect(run(f)).toMatchObject({
      size: 23,
      font: "Times New Roman",
      color: "#000000",
      bold: true,
      italic: true,
      underline: true,
      spc: 100,
    });
    expect(paras(f)[0]).toMatchObject({
      align: "right",
      properties: { marL: 0 },
    });
    expect(renderSlideToSvg(f.pres, f.slide, { textLayout: "svg" })).toContain(
      'font-size="30.67"',
    );
    expect(getTableLayout(f.pres, f.table).height).toBeGreaterThan(
      P.inches(0.1),
    );
  });
  it("uses the slide color mapping instead of master body text color", async () => {
    const f = await fixture({ mapping: true });
    expect(run(f).color).toBe("#CC7700");
  });
  it("ignores presentation defaults and list defPPr, and resolves each outline level independently", async () => {
    const f = await fixture({
      master: `<a:defPPr>${props(39, "00CC00", "Georgia")}</a:defPPr>${defaultMaster}`,
      list: `<a:defPPr>${props(13, "990099", "Arial")}</a:defPPr>`,
      paragraphs: [0, 1, 2, 8]
        .map(
          (level) =>
            `<a:p><a:pPr lvl="${level}"/><a:r><a:t>Level</a:t></a:r></a:p>`,
        )
        .join(""),
    });
    expect(paras(f).map((p) => p.elements[0].format.size)).toEqual([
      23, 25, 18, 18,
    ]);
    expect(paras(f).map((p) => p.properties.marL)).toEqual([
      0,
      12345,
      2 * 457200,
      8 * 457200,
    ]);
    expect(
      paras(f).every(
        (p) =>
          p.elements[0].format.font === "Times New Roman" &&
          p.elements[0].format.color === "#000000",
      ),
    ).toBe(true);
  });
  it("applies cell level, paragraph and run overrides above table text styles", async () => {
    const style =
      '<a:font><a:latin typeface="Courier New"/><a:ea typeface=""/><a:cs typeface=""/></a:font><a:srgbClr val="CC6600"/>';
    const f = await fixture({
      style,
      list: `<a:lvl1pPr algn="ctr">${props(15, "990099", "Arial")}</a:lvl1pPr>`,
      paragraphs: `<a:p><a:r><a:t>Local</a:t></a:r></a:p><a:p><a:pPr algn="l">${props(19, "0088CC")}</a:pPr><a:r><a:rPr sz="2100" b="0"/><a:t>Direct</a:t></a:r><a:endParaRPr sz="3700"/></a:p>`,
    });
    expect(paras(f)[0]).toMatchObject({
      align: "center",
      elements: [
        { format: { size: 15, color: "#990099", font: "Arial", bold: true } },
      ],
    });
    expect(paras(f)[1]).toMatchObject({
      align: "left",
      elements: [
        { format: { size: 21, color: "#0088CC", font: "Arial", bold: false } },
      ],
      defaultFormat: { size: 37 },
    });
  });
  it("uses 18pt, the minor font and half-inch level indents when otherStyle is absent", async () => {
    const f = await fixture({
      master: "",
      paragraphs: Array.from(
        { length: 9 },
        (_, level) =>
          `<a:p><a:pPr lvl="${level}"/><a:r><a:t>Test</a:t></a:r></a:p>`,
      ).join(""),
    });
    expect(paras(f).map((p) => p.properties.marL)).toEqual(
      Array.from({ length: 9 }, (_, i) => i * 457200),
    );
    expect(paras(f).every((p) => p.elements[0].format.size === 18)).toBe(true);
  });
  it("refreshes inherited formatting after master bytes change without mutating read/export data", async () => {
    const f = await fixture(),
      before = unzipSync(await P.savePresentation(f.pres));
    paras(f);
    renderSlideToSvg(f.pres, f.slide, { textLayout: "svg" });
    expect(unzipSync(await P.savePresentation(f.pres))).toEqual(before);
    const pkg = P._internalPackageOf(f.pres),
      part = pkg.getPart(P.getSlideMasterPartName(f.slide));
    part.data = strToU8(strFromU8(part.data).replace('sz="2300"', 'sz="3100"'));
    expect(run(f).size).toBe(31);
    const saved = await P.savePresentation(f.pres),
      reload = await parseDeck(saved),
      s = P.getSlides(reload)[0],
      t = P.getSlideTables(s)[0],
      r = P.getTableStyleResolver(reload, t),
      c = P.getTableCell(t, 0, 0);
    expect(
      r.paragraphs(c, r.cell(c).textFormat)[0].elements[0].format.size,
    ).toBe(31);
    expect(unzipSync(await P.savePresentation(reload))).toEqual(
      unzipSync(saved),
    );
  });
});

describe("imported implicit table fonts", () => {
  const imported = async (source) => {
    const pres = createDeck("blank");
    P.setPresentationTheme(pres, { dark1: "#FF0000" });
    P.importSlide(pres, source.slide, P.getSlideLayouts(pres)[0]);
    const reload = await parseDeck(await P.savePresentation(pres));
    const slide = P.getSlides(reload).at(-1),
      table = P.getSlideTables(slide)[0];
    return { pres: reload, slide, table, cell: P.getTableCell(table, 0, 0) };
  };
  it("preserves the implicit minor font through export and repeated clipboard imports", async () => {
    const original = await fixture();
    const before = unzipSync(await P.savePresentation(original.pres));
    const copy = await imported(original),
      again = await imported(copy);
    for (const f of [copy, again]) {
      expect(run(f)).toMatchObject({
        font: "Times New Roman",
        size: 18,
        color: "#FF0000",
      });
      expect(run(f).bold).not.toBe(true);
      expect(run(f).italic).not.toBe(true);
      expect(paras(f)[0].align).not.toBe("right");
    }
    expect(unzipSync(await P.savePresentation(original.pres))).toEqual(before);
  });
  it("preserves authored table fonts above the implicit minor font", async () => {
    for (const font of [
      '<a:fontRef idx="major"><a:schemeClr val="tx1"/></a:fontRef>',
      '<a:font><a:latin typeface="Courier New"/><a:ea typeface=""/><a:cs typeface=""/></a:font>',
    ]) {
      const original = await fixture({ style: font }),
        copy = await imported(original);
      const sourceFont = font.includes("idx=")
        ? P.getPresentationFonts(original.pres).majorLatin
        : "Courier New";
      expect(run(copy).font).toBe(sourceFont);
    }
  });
  it("preserves the minor font for a none fontRef without losing its explicit color", async () => {
    const original = await fixture({
      style: '<a:fontRef idx="none"><a:srgbClr val="CC8800"/></a:fontRef>',
    });
    const copy = await imported(original);
    expect(run(copy)).toMatchObject({
      font: "Times New Roman",
      color: "#CC8800",
    });
    expect(run(await imported(copy))).toMatchObject({
      font: "Times New Roman",
      color: "#CC8800",
    });
  });
  it("carries the source East Asian and complex-script font slots with the minor collection", async () => {
    const original = await fixture();
    P.setPresentationFonts(original.pres, {
      minorEastAsian: "Yu Mincho",
      minorComplexScript: "Arial",
    });
    const copy = await imported(original);
    expect(run(copy)).toMatchObject({
      font: "Times New Roman",
      fontEastAsian: "Yu Mincho",
    });
    const xml = strFromU8(
      unzipSync(await P.savePresentation(copy.pres))["ppt/slides/slide2.xml"],
    );
    expect(xml).toContain('<a:ea typeface="Yu Mincho"');
    expect(xml).toContain('<a:cs typeface="Arial"');
  });
  it("retains conditional font overrides and keeps them conditional after copying", async () => {
    const original = await fixture({
      tableAttributes: 'firstRow="1"',
      sections:
        '<a:firstRow><a:tcTxStyle><a:font><a:latin typeface="Georgia"/><a:ea typeface=""/><a:cs typeface=""/></a:font></a:tcTxStyle></a:firstRow>',
    });
    const copy = await imported(original);
    expect(run(copy).font).toBe("Georgia");
    P.setTableStyleFlags(copy.table, { firstRow: false });
    expect(run(copy).font).toBe("Times New Roman");
  });
  it("adds implicit fonts to unstyled tables without adding a text color or master formatting", async () => {
    const original = await fixture();
    const parts = unzipSync(await P.savePresentation(original.pres));
    parts["ppt/slides/slide1.xml"] = strToU8(
      strFromU8(parts["ppt/slides/slide1.xml"]).replace(
        /<a:tableStyleId>[^<]*<\/a:tableStyleId>/,
        "",
      ),
    );
    const pres = await parseDeck(zipSync(parts));
    const copy = await imported({ slide: P.getSlides(pres)[0] });
    expect(run(copy)).toMatchObject({
      font: "Times New Roman",
      color: "#FF0000",
      size: 18,
    });
    const resolver = P.getTableStyleResolver(copy.pres, copy.table);
    expect(resolver.cell(copy.cell).textFormat).toEqual({
      font: "Times New Roman",
    });
  });
  it("preserves cell, paragraph and run font precedence", async () => {
    const original = await fixture({
      list: `<a:lvl1pPr>${props(null, null, "Arial")}</a:lvl1pPr>`,
      paragraphs:
        '<a:p><a:r><a:t>Cell</a:t></a:r></a:p><a:p><a:pPr><a:defRPr><a:latin typeface="Georgia"/></a:defRPr></a:pPr><a:r><a:t>Paragraph</a:t></a:r><a:r><a:rPr><a:latin typeface="Courier New"/></a:rPr><a:t>Run</a:t></a:r></a:p>',
    });
    const copy = await imported(original);
    expect(
      paras(copy).flatMap((p) => p.elements.map((e) => e.format.font)),
    ).toEqual(["Arial", "Georgia", "Courier New"]);
  });
});
