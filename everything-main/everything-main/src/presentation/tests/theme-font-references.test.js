import { expect, it } from "vitest";
import { unzipSync } from "fflate";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { slideFontResolver } from "../src/fonts.js";

const fonts = {
  majorLatin: "Georgia",
  minorLatin: "Verdana",
  majorEastAsian: "MS Mincho",
  minorEastAsian: "MS Gothic",
  majorComplexScript: "Traditional Arabic",
  minorComplexScript: "Arial",
};
const references = [
  ["+mj-lt", "Georgia"],
  ["+mn-lt", "Verdana"],
  ["+mj-ea", "MS Mincho"],
  ["+mn-ea", "MS Gothic"],
  ["+mj-cs", "Traditional Arabic"],
  ["+mn-cs", "Arial"],
];
const makeDeck = () => {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  P.setPresentationFonts(p, fonts);
  for (const [i, [font]] of references.entries()) {
    const sh = P.addSlideTextBox(s, {
      x: 0,
      y: i * 500000,
      w: 4000000,
      h: 400000,
      text: `Reference${i}`,
    });
    P.setShapeTextFormat(sh, { font, size: 16 });
    P.setShapeTextAutoFit(sh, "none");
  }
  const table = P.addSlideTable(s, {
    x: 5000000,
    y: 0,
    w: 4000000,
    h: 1000000,
    rows: [["TableMajor"], ["TableMinor"]],
  });
  P.setTableCellTextFormat(P.getTableCell(table, 0, 0), {
    font: "+mj-lt",
    size: 16,
  });
  P.setTableCellTextFormat(P.getTableCell(table, 1, 0), {
    font: "+mn-lt",
    size: 16,
  });
  return p;
};
it.each(["svg", "foreignObject"])(
  "resolves all explicit theme-font references before %s painting",
  async (mode) => {
    const p = makeDeck(),
      s = P.getSlides(p)[0],
      original = unzipSync(await P.savePresentation(p)),
      requested = [];
    const svg = renderSlideToSvg(p, s, {
      textLayout: mode,
      resolveFontFamily: (family) => {
        requested.push(family);
        return family || "sans-serif";
      },
    });
    for (const [, font] of references) expect(requested).toContain(font);
    expect(requested.some((f) => f?.startsWith("+m"))).toBe(false);
    expect(svg).toContain("TableMajor");
    expect(svg).toContain("TableMinor");
    // ZIP timestamps change on save. Verify every part's bytes, even when
    // rendering crosses the ZIP clock's two-second boundary on a busy host.
    expect(unzipSync(await P.savePresentation(p))).toEqual(original);
  },
);
it("resolves theme references for editor fonts and observes theme edits", () => {
  const p = makeDeck(),
    resolve = slideFontResolver(P.getSlides(p)[0], p);
  for (const [ref, font] of references)
    expect(resolve(ref)).toContain(`"${font}"`);
  P.setPresentationFonts(p, { majorLatin: "Times New Roman" });
  expect(resolve("+mj-lt")).toContain('"Times New Roman"');
});

it("follows the owning master theme and refreshes relationship and font edits", async () => {
  const { themeForSlide } =
    await import("../lib/pptx/src/api/fn/shape-theme.ts");
  const { strToU8, strFromU8 } = await import("fflate");
  const p = makeDeck(),
    s = P.getSlides(p)[0],
    pkg = P._internalPackageOf(p),
    resolve = slideFontResolver(s, p);
  const originalTheme = pkg.getPart(themeForSlide(s).partName);
  const alternate = "/ppt/theme/z-alternate.xml";
  pkg.addPart(
    alternate,
    originalTheme.contentType,
    strToU8(
      strFromU8(originalTheme.data)
        .replaceAll("Georgia", "Times New Roman")
        .replaceAll("Verdana", "Courier New"),
    ),
  );
  expect(resolve("+mj-lt")).toContain('"Georgia"');
  renderSlideToSvg(p, s, { textLayout: "svg" });
  const master = P.getSlideMasterPartName(s),
    rels = pkg.getRels(master);
  rels.items.find((r) => r.type.endsWith("/theme")).target = alternate;
  pkg.setRels(master, rels);
  expect(P.getPresentationFonts(p).majorLatin).toBe("Georgia");
  expect(resolve("+mj-lt")).toContain('"Times New Roman"');
  for (const textLayout of ["svg", "foreignObject"]) {
    const requested = [];
    renderSlideToSvg(p, s, {
      textLayout,
      resolveFontFamily: (f) => {
        requested.push(f);
        return f || "sans-serif";
      },
    });
    expect(requested).toContain("Times New Roman");
    expect(requested).toContain("Courier New");
    expect(requested).not.toContain("Georgia");
    expect(requested).not.toContain("Verdana");
  }
  const part = pkg.getPart(alternate);
  part.data = strToU8(
    strFromU8(part.data).replaceAll("Times New Roman", "Palatino"),
  );
  expect(resolve("+mj-lt")).toContain('"Palatino"');
});

it("retains theme references across export and rebinding to destination layouts in both directions", async () => {
  const source = makeDeck(),
    restored = await P.loadPresentation(await P.savePresentation(source));
  const target = createDeck("blank");
  P.setPresentationFonts(target, {
    majorLatin: "Times New Roman",
    minorLatin: "Courier New",
  });
  const copy = P.importSlide(
    target,
    P.getSlides(restored)[0],
    P.getSlideLayouts(target)[0],
  );
  expect(slideFontResolver(copy, target)("+mj-lt")).toContain(
    '"Times New Roman"',
  );
  const svg = renderSlideToSvg(target, copy, {
    textLayout: "svg",
    resolveFontFamily: (f) => f || "sans-serif",
  });
  expect(svg).toContain("Times New Roman");
  expect(svg).toContain("Courier New");
  const back = P.importSlide(source, copy, P.getSlideLayouts(source)[0]);
  expect(slideFontResolver(back, source)("+mj-lt")).toContain('"Georgia"');
  const after = await P.loadPresentation(await P.savePresentation(source));
  expect(
    slideFontResolver(P.getSlides(after).at(-1), after)("+mn-lt"),
  ).toContain('"Verdana"');
});

it("preserves table style fonts from the owning master through transfers", async () => {
  const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
  const files = unzipSync(await P.savePresentation(makeDeck()));
  files["ppt/slides/slide1.xml"] = strToU8(
    strFromU8(files["ppt/slides/slide1.xml"]).replace(
      /<a:tblPr\b[^>]*>[\s\S]*?<\/a:tblPr>/,
      '<a:tblPr><a:tableStyle styleId="{68264547-E1FC-4E31-8FC1-BCDD8491B880}" styleName="Theme font"><a:wholeTbl><a:tcTxStyle><a:fontRef idx="major"/></a:tcTxStyle></a:wholeTbl></a:tableStyle></a:tblPr>',
    ),
  );
  const source = await P.loadPresentation(zipSync(files)),
    slide = P.getSlides(source)[0],
    pkg = P._internalPackageOf(source);
  const { themeForSlide } =
    await import("../lib/pptx/src/api/fn/shape-theme.ts");
  const theme = pkg.getPart(themeForSlide(slide).partName),
    alternate = "/ppt/theme/z-table.xml";
  pkg.addPart(
    alternate,
    theme.contentType,
    strToU8(strFromU8(theme.data).replaceAll("Georgia", "Times New Roman")),
  );
  const master = P.getSlideMasterPartName(slide),
    rels = pkg.getRels(master);
  rels.items.find((r) => r.type.endsWith("/theme")).target = alternate;
  pkg.setRels(master, rels);
  const styleFont = (p, s) => {
    const table = P.getSlideTables(s)[0];
    return P.getTableStyleResolver(p, table).cell(P.getTableCell(table, 0, 0))
      .textFormat.font;
  };
  expect(styleFont(source, slide)).toBe("Times New Roman");
  const target = createDeck("blank");
  P.setPresentationFonts(target, { majorLatin: "Arial" });
  const copy = P.importSlide(target, slide, P.getSlideLayouts(target)[0]);
  expect(styleFont(target, copy)).toBe("Times New Roman");
  const back = P.importSlide(source, copy, P.getSlideLayouts(source)[0]);
  expect(styleFont(source, back)).toBe("Times New Roman");
  const reloaded = await P.loadPresentation(await P.savePresentation(source));
  expect(styleFont(reloaded, P.getSlides(reloaded).at(-1))).toBe(
    "Times New Roman",
  );
});
