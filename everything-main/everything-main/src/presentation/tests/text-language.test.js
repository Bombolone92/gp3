import { describe, expect, it } from "vitest";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import {
  P,
  createDeck,
  parseDeck,
  preview,
  textRuns,
  setRichText,
} from "../src/model.js";

// Put a different language at every inheritance layer. Fields and ordinary
// runs must use the same cascade, and lang/altLang inherit independently.
// Layer 1 is the paragraph insertion point and must not style existing text.
const languages = [
  "ar-SA",
  "ja-JP",
  "de-DE",
  "fr-CA",
  "ko-KR",
  "zh-TW",
  "en-GB",
];
async function languageDeck(first = 0, field = false) {
  const p = createDeck(),
    s = P.getSlides(p)[0];
  P.addSlideTextBox(s, {
    x: 0,
    y: 0,
    w: P.inches(5),
    h: P.inches(1),
    text: "Language",
  });
  const files = unzipSync(await P.savePresentation(p));
  const props = (i) => (i < first ? "" : ` lang="${languages[i]}"`);
  const list = (i) =>
    `<a:lstStyle><a:lvl2pPr><a:defRPr${props(i)} altLang="en-US"/></a:lvl2pPr></a:lstStyle>`;
  const slideName = P.getSlidePartName(s).slice(1);
  const original = strFromU8(files[slideName]).match(
    /<p:sp\b[\s\S]*?<\/p:sp>/,
  )[0];
  const placeholder = original.replace(
    /<p:nvPr\s*\/>/,
    '<p:nvPr><p:ph type="body" idx="73"/></p:nvPr>',
  );
  const body = `<p:txBody><a:bodyPr/>${list(3)}<a:p><a:pPr lvl="1"><a:defRPr${props(2)}/></a:pPr><a:${field ? 'fld id="{AA591D5F-4122-4AE7-8FCE-70534B7335B4}" type="datetime1"' : "r"}><a:rPr${props(0)}/><a:t>Language</a:t></a:${field ? "fld" : "r"}><a:endParaRPr${props(1)}/></a:p></p:txBody>`;
  files[slideName] = strToU8(
    strFromU8(files[slideName]).replace(
      original,
      placeholder.replace(/<p:txBody>[\s\S]*?<\/p:txBody>/, body),
    ),
  );
  for (const [i, name] of [
    [4, P.getSlideLayoutPartName(P.getSlideLayout(s))],
    [5, P.getSlideMasterPartName(s)],
  ]) {
    const n = name.slice(1);
    // A master has one body slot; its index is independent of the layout.
    const parentXml = strFromU8(files[n]);
    let xml = (
      i === 5
        ? parentXml.replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (sp) =>
            sp.includes('type="body"') ? "" : sp,
          )
        : parentXml
    ).replace(
      "</p:spTree>",
      placeholder
        .replace(/<p:cNvPr id="\d+"/, '<p:cNvPr id="873"')
        .replace(
          /<p:txBody>[\s\S]*?<\/p:txBody>/,
          `<p:txBody><a:bodyPr/>${list(i)}<a:p/></p:txBody>`,
        ) + "</p:spTree>",
    );
    if (i === 5)
      xml = xml.replace(
        /<p:txStyles>[\s\S]*?<\/p:txStyles>/,
        `<p:txStyles><p:bodyStyle><a:lvl2pPr><a:defRPr${props(6)}/></a:lvl2pPr></p:bodyStyle></p:txStyles>`,
      );
    files[n] = strToU8(xml);
  }
  return parseDeck(zipSync(files));
}

describe("DrawingML text language", () => {
  it.each(
    languages.map((language, index) => [
      index === 1 ? languages[2] : language,
      index,
    ]),
  )(
    "inherits %s at layer %i for both runs and fields",
    async (language, index) => {
      for (const field of [false, true]) {
        const p = await languageDeck(index, field),
          s = P.getSlides(p)[0],
          shape = P.getSlideShapes(s)[0];
        const before = unzipSync(await P.savePresentation(p));
        const read = field
          ? P.getShapeFieldFormatEffective
          : P.getShapeRunFormatEffective;
        expect(read(p, shape, 0, 0)).toMatchObject({
          language,
          alternateLanguage: "en-US",
        });
        expect(P.getShapeParagraphElements(shape, 0)[0].format?.language).toBe(
          index === 0 ? language : undefined,
        );
        preview(p, s);
        expect(unzipSync(await P.savePresentation(p))).toEqual(before);
      }
    },
  );

  it("authors, clears and preserves language overrides through editing and two imports", async () => {
    const p = await languageDeck(2),
      slide = P.getSlides(p)[0],
      shape = P.getSlideShapes(slide)[0];
    P.setShapeRunFormat(shape, 0, 0, {
      language: "zh-Hant-HK",
      alternateLanguage: "en-CA",
    });
    expect(P.getShapeRunFormat(shape, 0, 0)).toMatchObject({
      language: "zh-Hant-HK",
      alternateLanguage: "en-CA",
    });
    P.setShapeRunFormat(shape, 0, 0, { language: null });
    expect(P.getShapeRunFormatEffective(p, shape, 0, 0)).toMatchObject({
      language: "de-DE",
      alternateLanguage: "en-CA",
    });
    P.setShapeRunFormat(shape, 0, 0, { alternateLanguage: null });
    expect(P.getShapeRunFormatEffective(p, shape, 0, 0).alternateLanguage).toBe(
      "en-US",
    );
    P.setShapeTextFormat(shape, {
      language: "fr-BE",
      alternateLanguage: "de-CH",
    });
    const runs = textRuns(p, shape);
    runs[0].runs[0].text += " edited";
    setRichText(shape, runs);
    const copy = P.copyShape(slide, shape);
    expect(P.getShapeRunFormat(copy, 0, 0)).toMatchObject({
      language: "fr-BE",
      alternateLanguage: "de-CH",
    });
    const clip = createDeck(),
      dest = createDeck();
    const imported = P.importSlide(clip, slide, P.getSlideLayouts(clip)[0]);
    P.importSlide(dest, imported, P.getSlideLayouts(dest)[0]);
    const loaded = await parseDeck(await P.savePresentation(dest));
    for (const item of P.getSlideShapes(P.getSlides(loaded)[1])) {
      expect(P.getShapeRunFormat(item, 0, 0)).toMatchObject({
        language: "fr-BE",
        alternateLanguage: "de-CH",
      });
      expect(P.getShapeText(item)).toBe("Language edited");
    }
  });

  it("keeps unknown language tags literal and ignores namespaced lookalike attributes", async () => {
    const p = await languageDeck(),
      s = P.getSlides(p)[0];
    const files = unzipSync(await P.savePresentation(p)),
      name = P.getSlidePartName(s).slice(1);
    files[name] = strToU8(
      strFromU8(files[name]).replace(
        'lang="ar-SA"',
        'xmlns:x="urn:language-test" x:lang="vendor" lang="not-a-locale!" altLang=""',
      ),
    );
    const loaded = await parseDeck(zipSync(files)),
      shape = P.getSlideShapes(P.getSlides(loaded)[0])[0];
    expect(P.getShapeRunFormat(shape, 0, 0)).toMatchObject({
      language: "not-a-locale!",
      alternateLanguage: "",
    });
    P.setShapeRunFormat(shape, 0, 0, {
      language: "en-NZ",
      alternateLanguage: null,
    });
    expect(P.getShapeXmlString(shape)).toContain('x:lang="vendor"');
    P.setShapeRunFormat(shape, 0, 0, { language: null });
    expect(P.getShapeRunFormat(shape, 0, 0).language).toBeUndefined();
    expect(P.getShapeRunFormatEffective(loaded, shape, 0, 0).language).toBe(
      "de-DE",
    );
  });

  it("round-trips authored table-cell language", async () => {
    const p = createDeck(),
      s = P.getSlides(p)[0];
    const table = P.addSlideTable(s, {
      x: 0,
      y: 0,
      w: P.inches(5),
      h: P.inches(1),
      rows: [["Cell"]],
    });
    const cell = P.getTableCell(table, 0, 0);
    P.setTableCellTextFormat(cell, {
      language: "th-TH",
      alternateLanguage: "en-US",
    });
    expect(P.getTableCellParagraphs(cell)[0].elements[0].format).toMatchObject({
      language: "th-TH",
      alternateLanguage: "en-US",
    });
    const loaded = await parseDeck(await P.savePresentation(p));
    expect(
      P.getTableCellParagraphs(
        P.getTableCell(P.getSlideTables(P.getSlides(loaded)[0])[0], 0, 0),
      )[0].elements[0].format,
    ).toMatchObject({ language: "th-TH", alternateLanguage: "en-US" });
  });
});
