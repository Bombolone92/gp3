import { describe, it, expect } from "vitest";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import {
  P,
  parseDeck,
  createDeck,
  textRuns,
  setRichText,
  fieldFormattingRange,
  displayShapeText,
} from "../src/model.js";
import { createDateDeck } from "./date-field-fixture.js";

async function fixture({ table = false, transform = (s) => s } = {}) {
  const files = unzipSync(await createDateDeck({ table, count: 1 }));
  files["ppt/slides/slide1.xml"] = strToU8(
    transform(strFromU8(files["ppt/slides/slide1.xml"])),
  );
  const p = await parseDeck(zipSync(files)),
    s = P.getSlides(p)[0];
  P.refreshPresentationFields(p, new Date(2030, 0, 1));
  return {
    p,
    s,
    shape: P.getSlideShapes(s)[1],
    cell: table ? P.getTableCell(P.getSlideTables(s)[0], 0, 0) : null,
  };
}
const elements = (shape) => P.getShapeParagraphElements(shape, 0);

describe("live field character formatting", () => {
  it.each([false, true])(
    "bulk formats runs, fields and breaks without replacing their content (table %s)",
    async (table) => {
      const { p, shape, cell } = await fixture({
        table,
        transform: (xml) =>
          xml.replace("</a:fld>", '</a:fld><a:br><a:rPr sz="1300"/></a:br>'),
      });
      const before = table
        ? P.getTableCellParagraphs(cell)[0].elements
        : elements(shape);
      const format = {
        bold: false,
        italic: true,
        language: "en-GB",
        color: "#123456",
      };
      if (table) P.setTableCellTextFormat(cell, format);
      else P.setShapeTextFormat(shape, format);
      const saved = await parseDeck(await P.savePresentation(p)),
        slide = P.getSlides(saved)[0];
      const after = table
        ? P.getTableCellParagraphs(
            P.getTableCell(P.getSlideTables(slide)[0], 0, 0),
          )[0].elements
        : elements(P.getSlideShapes(slide)[1]);
      expect(after.map(({ format, ...e }) => e)).toEqual(
        before.map(({ format, ...e }) => e),
      );
      for (const e of after) expect(e.format).toMatchObject(format);
      expect(after.find((e) => e.kind === "br").format.size).toBe(13);
    },
  );
  it("formats one field, retains unknown metadata, and clears an override back to inherited language", async () => {
    const { p, shape } = await fixture({
      transform: (xml) =>
        xml
          .replace(
            "<a:p><a:r><a:t>Date: ",
            '<a:p><a:pPr><a:defRPr lang="de-DE"/></a:pPr><a:r><a:t>Date: ',
          )
          .replace(
            'type="datetime1"',
            'type="datetime1" xmlns:x="urn:extra" x:keep="yes"',
          )
          .replace(
            '<a:rPr b="1" lang="en-US"/>',
            '<a:rPr b="1" lang="en-US" x:lang="private"><a:extLst><x:payload/></a:extLst></a:rPr>',
          ),
    });
    const before = elements(shape);
    P.setShapeFieldFormat(shape, 0, 0, { italic: true, language: "fr-FR" });
    expect(elements(shape)[0]).toEqual(before[0]);
    expect(elements(shape)[2]).toEqual(before[2]);
    expect(P.getShapeFieldFormatEffective(p, shape, 0, 0)).toMatchObject({
      bold: true,
      italic: true,
      language: "fr-FR",
    });
    P.setShapeFieldFormat(shape, 0, 0, { language: null });
    expect(P.getShapeFieldFormatEffective(p, shape, 0, 0).language).toBe(
      "de-DE",
    );
    const xml = P.getShapeXmlString(shape);
    expect(xml).toContain('x:lang="private"');
    expect(xml).toContain('x:keep="yes"');
    expect(xml).toContain("<x:payload");
    expect(xml).not.toContain('lang="fr-FR"');
    expect(elements(shape)[1]).toMatchObject({
      kind: "fld",
      type: "datetime1",
      text: "CACHED-DATE",
    });
    const exported = await parseDeck(await P.savePresentation(p));
    expect(
      P.getShapeXmlString(P.getSlideShapes(P.getSlides(exported)[0])[1]),
    ).toContain('x:keep="yes"');
    const stable = P.getShapeXmlString(shape);
    for (const index of [-1, 1, 0.5])
      expect(() =>
        P.setShapeFieldFormat(shape, 0, index, { bold: false }),
      ).toThrow(RangeError);
    expect(P.getShapeXmlString(shape)).toBe(stable);
  });
  it("adds missing field properties and counts fields independently of ordinary runs and extension lookalikes", async () => {
    const { shape } = await fixture({
      transform: (xml) =>
        xml
          .replace('<a:rPr b="1" lang="en-US"/>', "")
          .replace(
            "<a:fld ",
            '<x:fld xmlns:x="urn:extra"><x:rPr/></x:fld><a:fld ',
          ),
    });
    P.setShapeFieldFormat(shape, 0, 0, { underline: "sng" });
    expect(elements(shape)[1].format.underline).toBe(true);
    expect(P.getShapeXmlString(shape)).toMatch(
      /<a:fld[^>]*><a:rPr u="sng"\/><a:t>/,
    );
    expect(P.getShapeXmlString(shape)).toContain("<x:rPr/>");
  });
  it("writes rich field changes and preserves them through copy and export", async () => {
    const { p, s, shape } = await fixture();
    const runs = textRuns(p, shape);
    const field = runs[0].runs.find((r) => r.fld);
    field.changes = { bold: false, italic: true, language: "en-GB" };
    field.text += "\v";
    setRichText(shape, runs);
    const dest = createDeck();
    const copied = P.importSlide(dest, s, P.getSlideLayouts(dest)[0]);
    const clip = createDeck();
    P.importSlide(clip, copied, P.getSlideLayouts(clip)[0]);
    const saved = await parseDeck(await P.savePresentation(clip));
    P.refreshPresentationFields(saved, new Date(2040, 6, 8));
    const out = P.getSlideShapes(P.getSlides(saved)[1])[1];
    expect(elements(out).filter((e) => e.kind === "fld")).toHaveLength(1);
    expect(elements(out).find((e) => e.kind === "fld").format).toMatchObject(
      field.changes,
    );
    expect(displayShapeText(saved, out)).toContain("08/07/2040");
    expect(elements(out).some((e) => e.kind === "br")).toBe(true);
  });
  it("formats multiple fields independently, including empty unknown fields", async () => {
    const { p, shape } = await fixture({
      transform: (xml) =>
        xml.replace(
          /(<a:fld[\s\S]*?<\/a:fld>)/,
          (field) =>
            field +
            "<a:r><a:t>between</a:t></a:r>" +
            field
              .replace("84633254", "84633255")
              .replace("datetime1", "vendorField")
              .replace("CACHED-DATE", ""),
        ),
    });
    const paragraphs = textRuns(p, shape),
      fields = paragraphs[0].runs.filter((run) => run.fld);
    fields[0].changes = { bold: false };
    fields[1].changes = { italic: true };
    setRichText(shape, paragraphs);
    const saved = await parseDeck(await P.savePresentation(p));
    const after = elements(P.getSlideShapes(P.getSlides(saved)[0])[1]).filter(
      (e) => e.kind === "fld",
    );
    expect(after).toHaveLength(2);
    expect(after[0].format).toMatchObject({ bold: false });
    expect(after[0].format.italic).not.toBe(true);
    expect(after[1]).toMatchObject({
      type: "vendorField",
      text: "",
      format: { bold: true, italic: true },
    });
  });
  it("expands partial formatting ranges only over unchanged fields, excluding appended breaks", async () => {
    const { p, shape } = await fixture();
    const runs = textRuns(p, shape)[0].runs,
      n = runs[1].text.length;
    runs[1].text += "\v\n";
    expect(fieldFormattingRange(runs, 7, 8)).toEqual([6, 6 + n]);
    expect(fieldFormattingRange(runs, 2, 8)).toEqual([2, 6 + n]);
    expect(fieldFormattingRange(runs, 0, 6)).toEqual([0, 6]);
    expect(fieldFormattingRange(runs, 6 + n, 8 + n)).toEqual([6 + n, 8 + n]);
    runs[1].text = "edited";
    expect(fieldFormattingRange(runs, 7, 8)).toEqual([7, 8]);
  });
});
