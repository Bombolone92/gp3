import { describe, it, expect } from "vitest";
import { TextFieldEdits, trackTextFields } from "../src/text-fields.js";
import {
  P,
  parseDeck,
  createDeck,
  shapeTextFields,
  tableTextFields,
  displayShapeText,
  displayTableCellText,
  retainTextFields,
  setRichText,
  textRuns,
} from "../src/model.js";
import { createDateDeck } from "./date-field-fixture.js";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
const field = (start, end) => ({ start, end, id: "live" });
const snapshot = () => new TextFieldEdits("abcFIELDxyz", [field(3, 8)]);

describe("plain-text field edit ranges", () => {
  it("keeps fields when typing at either boundary and across several separate edits", () => {
    const e = snapshot();
    e.update("abc!FIELDxyz", { start: 3, end: 3 });
    e.update("abc!FIELD?xyz", { start: 9, end: 9 });
    expect(e.fields).toEqual([field(4, 9)]);
    e.update("pre abc!FIELD?xyz post", { start: 0, end: 0 }); // no matching range: one whole replacement touches the field
    expect(e.fields).toEqual([]);
  });
  it.each([
    [4, 4, "!"],
    [3, 8, "literal"],
    [2, 4, ""],
    [7, 9, ""],
  ])("turns a touched field into text for %s..%s", (start, end, text) => {
    const e = snapshot();
    e.replace(start, end, text);
    expect(e.fields).toEqual([]);
  });
  it("uses the actual selection among identical visible values", () => {
    const e = new TextFieldEdits("111", [field(1, 2)]);
    e.update("11", { start: 0, end: 1 });
    expect(e.fields).toEqual([field(0, 1)]);
    const f = new TextFieldEdits("111", [field(1, 2)]);
    f.update("11", { start: 1, end: 2 });
    expect(f.fields).toEqual([]);
  });
  it("restores removed fields through coalesced native undo and redo", () => {
    const e = snapshot();
    e.update("abcF!IELDxyz", { start: 4, end: 4 });
    e.update("abcF!!IELDxyz", { start: 5, end: 5 });
    expect(e.fields).toEqual([]);
    e.update("abcFIELDxyz", null, "historyUndo");
    expect(e.fields).toEqual([field(3, 8)]);
    e.update("abcF!!IELDxyz", null, "historyRedo");
    expect(e.fields).toEqual([]);
    e.update("abcFIELDxyz", null, "historyUndo");
    e.update("!abcFIELDxyz", { start: 0, end: 0 });
    expect(e.fields).toEqual([field(4, 9)]);
    expect(e.future).toEqual([]);
  });
  it("tracks UTF-16 selections, paragraph breaks and empty fields", () => {
    const e = new TextFieldEdits("😀\nA\nZ", [
      field(3, 4),
      { start: 6, end: 6, id: "empty" },
    ]);
    e.update("😀\n!A\nZ", { start: 3, end: 3 });
    expect(e.fields).toEqual([field(4, 5), { start: 7, end: 7, id: "empty" }]);
  });
  it("does not reinterpret unchanged text as replacing the field", () => {
    const e = snapshot();
    e.update(e.text, { start: 0, end: e.text.length });
    expect(e.fields).toEqual([field(3, 8)]);
  });
});

it("tracks a composition range rather than confusing identical adjacent field text", () => {
  const input = Object.assign(new EventTarget(), {
    value: "aa",
    selectionStart: 0,
    selectionEnd: 0,
  });
  const edits = trackTextFields(input, [field(1, 2)]);
  const event = (type, inputType) =>
    input.dispatchEvent(
      Object.assign(new Event(type), { inputType, isComposing: true }),
    );
  event("compositionstart");
  event("beforeinput", "insertCompositionText");
  input.value = "aaa";
  input.selectionStart = input.selectionEnd = 1;
  event("input", "insertCompositionText");
  expect(edits.fields).toEqual([field(2, 3)]);
  event("beforeinput", "insertCompositionText");
  input.value = "aa";
  input.selectionStart = input.selectionEnd = 0;
  event("input", "insertCompositionText");
  event("compositionend");
  expect(edits.fields).toEqual([field(1, 2)]);
  input.selectionStart = 1;
  input.selectionEnd = 2;
  event("compositionstart");
  event("beforeinput", "insertCompositionText");
  input.value = "aX";
  input.selectionStart = input.selectionEnd = 2;
  event("input", "insertCompositionText");
  expect(edits.fields).toEqual([]);
  event("beforeinput", "insertCompositionText");
  input.value = "aa";
  event("input", "insertCompositionText");
  event("compositionend");
  expect(edits.fields).toEqual([field(1, 2)]);
});

async function deck(table = false, type = "datetime1") {
  const p = await parseDeck(await createDateDeck({ table, type }));
  P.refreshPresentationFields(p, new Date(2024, 1, 29));
  const s = P.getSlides(p)[0],
    shape = P.getSlideShapes(s)[1],
    cell = table ? P.getTableCell(P.getSlideTables(s)[0], 0, 0) : null;
  return { p, s, shape, cell };
}

describe("native fields through plain-text replacement", () => {
  it.each([false, true])(
    "preserves live fields and their metadata through two imports and export (table %s)",
    async (table) => {
      const { p, s, shape, cell } = await deck(table);
      const fields = table
          ? tableTextFields(p, cell)
          : shapeTextFields(p, shape),
        value = table
          ? displayTableCellText(p, cell)
          : displayShapeText(p, shape);
      const e = new TextFieldEdits(value, fields);
      e.update("Before " + value, { start: 0, end: 0 });
      e.update(e.text + " after", { start: e.text.length, end: e.text.length });
      if (table) P.setTableCellText(cell, e.text, { fields: e.fields });
      else
        setRichText(
          shape,
          retainTextFields(
            [
              {
                ...textRuns(p, shape)[0],
                runs: [{ ...textRuns(p, shape)[0].runs[0], text: e.text }],
              },
            ],
            e.fields,
          ),
        );
      const clip = createDeck(),
        dest = createDeck();
      const first = P.importSlide(clip, s, P.getSlideLayouts(clip)[0]);
      P.importSlide(dest, first, P.getSlideLayouts(dest)[0]);
      const loaded = await parseDeck(await P.savePresentation(dest));
      P.refreshPresentationFields(loaded, new Date(2030, 0, 1));
      const out = P.getSlides(loaded)[1];
      expect(
        table
          ? displayTableCellText(
              loaded,
              P.getTableCell(P.getSlideTables(out)[0], 0, 0),
            )
          : displayShapeText(loaded, P.getSlideShapes(out)[1]),
      ).toBe("Before Date: 1/1/30 / literal 999 after");
    },
  );
  it("preserves a field with multiline display text as one native element", async () => {
    const { p, shape } = await deck(false, "vendor-field"),
      runs = textRuns(p, shape);
    const f = runs[0].runs[1];
    f.text = "A\nB";
    f.fld.children.find((c) => c.name?.localName === "t").children = [
      { kind: "text", data: f.text },
    ];
    setRichText(shape, runs);
    const value = displayShapeText(p, shape),
      fields = shapeTextFields(p, shape),
      e = new TextFieldEdits(value, fields);
    e.update("X" + value, { start: 0, end: 0 });
    const paras = e.text
      .split("\n")
      .map((text) => ({ runs: [{ text, format: {} }] }));
    setRichText(shape, retainTextFields(paras, e.fields));
    expect(P.getShapeParagraphCount(shape)).toBe(1);
    expect(
      P.getShapeParagraphElements(shape, 0).filter((e) => e.kind === "fld"),
    ).toMatchObject([{ type: "vendor-field", text: "A\nB" }]);
    expect(displayShapeText(p, shape)).toBe("X" + value);
  });
  it("validates cell field placements before changing source XML", async () => {
    const { shape, cell } = await deck(true);
    const before = P.getShapeXmlString(shape);
    for (const fields of [
      [{ paragraphIndex: 0, fieldIndex: 9, start: 0, end: 1 }],
      [{ paragraphIndex: 0, fieldIndex: 0, start: -1, end: 1 }],
      [
        { paragraphIndex: 0, fieldIndex: 0, start: 0, end: 3 },
        { paragraphIndex: 0, fieldIndex: 0, start: 1, end: 4 },
      ],
    ]) {
      expect(() => P.setTableCellText(cell, "abcd", { fields })).toThrow(
        RangeError,
      );
      expect(P.getShapeXmlString(shape)).toBe(before);
    }
  });
  it("keeps a table field's unknown attributes and children and cached text byte-for-byte", async () => {
    const files = unzipSync(
      await createDateDeck({ table: true, type: "vendor-field" }),
    );
    const name = "ppt/slides/slide1.xml";
    files[name] = strToU8(
      strFromU8(files[name])
        .replace("<a:fld ", '<a:fld xmlns:x="urn:vendor" x:type="keep" ')
        .replace(
          "</a:fld>",
          '<x:payload xmlns:x="urn:vendor"><x:value>keep</x:value></x:payload></a:fld>',
        ),
    );
    const p = await parseDeck(zipSync(files)),
      s = P.getSlides(p)[0],
      shape = P.getSlideTables(s)[0],
      cell = P.getTableCell(shape, 0, 0),
      before = P.getShapeXmlString(shape).match(/<a:fld\b[\s\S]*?<\/a:fld>/)[0];
    const value = displayTableCellText(p, cell),
      e = new TextFieldEdits(value, tableTextFields(p, cell));
    e.replace(0, 0, "Before ");
    P.setTableCellText(cell, e.text, { fields: e.fields });
    expect(P.getShapeXmlString(shape)).toContain(before);
  });
  it("keeps formatting committed while a plain-text edit was open", async () => {
    const { p, shape } = await deck();
    const fields = shapeTextFields(p, shape),
      value = displayShapeText(p, shape);
    const changed = textRuns(p, shape);
    const props = changed[0].runs[1].fld.children.find(
      (c) => c.name?.localName === "rPr",
    );
    props.attrs.find((a) => a.name.localName === "lang").value = "en-GB";
    props.attrs.push({
      name: { prefix: "", localName: "i", namespaceURI: "" },
      value: "1",
    });
    setRichText(shape, changed);
    const current = textRuns(p, shape),
      edited = new TextFieldEdits(value, fields);
    edited.replace(0, 0, "Before ");
    setRichText(
      shape,
      retainTextFields(
        [{ runs: [{ text: edited.text, format: {} }] }],
        edited.fields,
        current,
      ),
    );
    const field = P.getShapeParagraphElements(shape, 0).find(
      (e) => e.kind === "fld",
    );
    expect(field.format).toMatchObject({ italic: true, language: "en-GB" });
  });
  it("does not confuse extension elements with DrawingML runs or field text", async () => {
    const files = unzipSync(await createDateDeck());
    const name = "ppt/slides/slide1.xml";
    files[name] = strToU8(
      strFromU8(files[name])
        .replace(
          "<a:fld ",
          '<x:r xmlns:x="urn:vendor"><x:t>wrong</x:t></x:r><a:fld ',
        )
        .replace(
          "CACHED-DATE</a:t>",
          'CACHED-DATE</a:t><x:t xmlns:x="urn:vendor">extension</x:t>',
        ),
    );
    const p = await parseDeck(zipSync(files)),
      shape = P.getSlideShapes(P.getSlides(p)[0])[1];
    P.refreshPresentationFields(p, new Date(2024, 1, 29));
    const fields = shapeTextFields(p, shape),
      value = displayShapeText(p, shape),
      edited = new TextFieldEdits(value, fields);
    edited.replace(0, 0, "Before ");
    setRichText(
      shape,
      retainTextFields(
        [{ runs: [{ text: edited.text, format: {} }] }],
        edited.fields,
      ),
    );
    expect(
      P.getShapeParagraphElements(shape, 0).find((e) => e.kind === "fld").type,
    ).toBe("datetime1");
    expect(P.getShapeXmlString(shape)).toContain("extension</x:t>");
    expect(displayShapeText(p, shape)).toBe(
      "Before Date: 2/29/24 / literal 999",
    );
  });

  it("preserves soft breaks after a field without making them part of the field", async () => {
    const files = unzipSync(await createDateDeck());
    const name = "ppt/slides/slide1.xml";
    files[name] = strToU8(
      strFromU8(files[name]).replace("</a:fld>", "</a:fld><a:br/><a:br/>"),
    );
    const p = await parseDeck(zipSync(files)),
      shape = P.getSlideShapes(P.getSlides(p)[0])[1];
    P.refreshPresentationFields(p, new Date(2024, 1, 29));
    setRichText(shape, textRuns(p, shape));
    expect(
      P.getShapeParagraphElements(shape, 0).filter((e) => e.kind === "br"),
    ).toHaveLength(2);
    const fields = shapeTextFields(p, shape),
      field = fields[0];
    expect(field.end - field.start).toBe("2/29/24".length);
    const e = new TextFieldEdits(displayShapeText(p, shape), fields);
    e.replace(field.end, field.end + 1, "");
    expect(e.fields).toHaveLength(1);
    setRichText(
      shape,
      retainTextFields(
        e.text.split("\n").map((text) => ({ runs: [{ text }] })),
        e.fields,
        textRuns(p, shape),
      ),
    );
    expect(
      P.getShapeParagraphElements(shape, 0).filter((e) => e.kind === "fld"),
    ).toHaveLength(1);
    const touched = textRuns(p, shape);
    const run = touched[0].runs.find((r) => r.fld);
    run.text = run.text.slice(0, 1) + "\u000b" + run.text.slice(1);
    setRichText(shape, touched);
    expect(
      P.getShapeParagraphElements(shape, 0).some((e) => e.kind === "fld"),
    ).toBe(false);
    expect(
      P.getShapeParagraphElements(shape, 0).some((e) => e.kind === "br"),
    ).toBe(true);
  });
  it("uses textarea-normalized ranges for editing and literal ranges for search", async () => {
    const files = unzipSync(
      await createDateDeck({ table: true, type: "vendor-field" }),
    );
    const name = "ppt/slides/slide1.xml";
    files[name] = strToU8(
      strFromU8(files[name]).replace("<a:t>Date: ", "<a:t>Before&#13;\nDate: "),
    );
    const p = await parseDeck(zipSync(files)),
      cell = P.getTableCell(P.getSlideTables(P.getSlides(p)[0])[0], 0, 0),
      value = displayTableCellText(p, cell);
    const normalized = tableTextFields(p, cell),
      raw = tableTextFields(p, cell, { normalizeNewlines: false });
    expect(value.slice(raw[0].start, raw[0].end)).toBe("CACHED-DATE");
    expect(
      value
        .replace(/\r\n?/g, "\n")
        .slice(normalized[0].start, normalized[0].end),
    ).toBe("CACHED-DATE");
    const e = new TextFieldEdits(value, raw);
    e.replace(0, 6, "Updated");
    P.setTableCellText(cell, e.text, { fields: e.fields });
    expect(
      P.getTableCellParagraphs(cell)
        .flatMap((p) => p.elements)
        .filter((e) => e.kind === "fld"),
    ).toMatchObject([{ type: "vendor-field", text: "CACHED-DATE" }]);
  });
});
