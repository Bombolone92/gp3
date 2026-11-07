import { describe, it, expect } from "vitest";
import { P, createDeck } from "../src/model.js";
import {
  getTableLayout,
  renderSlideToSvg,
} from "../lib/pptx-preview/src/index.ts";
import { parseXml, textContent } from "../lib/pptx/src/internal/xml/index.ts";
import {
  numberingDeck,
  numberingRows,
  numberingMarkers,
} from "./numbering-fixture.js";
import { readDrawingBullet } from "../lib/pptx/src/internal/drawingml/text-bullet.ts";
const auto = (level = 0, start, type = "arabicPeriod") => ({
  level,
  type,
  ...(start === undefined ? {} : { start }),
});
const plain = (level = 0) => ({ level, type: "none" });
const char = (level = 0) => ({ level, type: "char" });
const controls = [
  {
    name: "normative nested example",
    rows: [auto(), auto(1), auto()],
    markers: ["1.", "1.", "2."],
  },
  {
    name: "plain nested paragraphs suspend parents",
    rows: [auto(), plain(1), plain(1), auto(), plain(1), auto()],
    markers: ["1.", "2.", "3."],
  },
  {
    name: "new parents restart descendants",
    rows: [auto(), auto(1), auto(1), auto(), auto(1), auto(1), auto()],
    markers: ["1.", "1.", "2.", "2.", "1.", "2.", "3."],
  },
  {
    name: "single outer plain after child preserves parent",
    rows: [auto(), auto(1, undefined, "alphaLcParenR"), plain(), auto()],
    markers: ["1.", "a)", "2."],
  },
  {
    name: "second outer plain ends parent",
    rows: [auto(), auto(1), plain(), plain(), auto()],
    markers: ["1.", "1.", "1."],
  },
  {
    name: "plain siblings end a list",
    rows: [auto(), auto(), plain(), auto(), auto()],
    markers: ["1.", "2.", "1.", "2."],
  },
  {
    name: "character children suspend parents",
    rows: [auto(), char(1), auto(), char(1), auto()],
    markers: ["1.", "◆", "2.", "◆", "3."],
  },
  {
    name: "repeated starts are sequence attributes",
    rows: [
      auto(0, 5),
      auto(0, 5),
      auto(1, 27, "alphaUcParenR"),
      auto(0, 5),
      auto(1, 27, "alphaUcParenR"),
    ],
    markers: ["5.", "6.", "AA)", "7.", "AA)"],
  },
  {
    name: "a changed start begins another sequence",
    rows: [auto(0, 5), auto(0, 5), auto(0, 2), auto(0, 2)],
    markers: ["5.", "6.", "2.", "3."],
  },
  {
    name: "omission uses schema default rather than prior start",
    rows: [auto(0, 2), auto(0, 2), auto(), auto()],
    markers: ["2.", "3.", "1.", "2."],
  },
  {
    name: "a changed scheme starts a new sequence",
    rows: [
      auto(),
      auto(),
      auto(0, undefined, "romanLcPeriod"),
      auto(0, undefined, "romanLcPeriod"),
      auto(),
    ],
    markers: ["1.", "2.", "i.", "ii.", "1."],
  },
  {
    name: "deep jumps retain independent ancestors",
    rows: [auto(), auto(3), auto(7), auto(3), auto(7), auto()],
    markers: ["1.", "1.", "1.", "2.", "1.", "2."],
  },
];
const visit = (el) => [
  el,
  ...el.children.flatMap((c) => (c.kind === "element" ? visit(c) : [])),
];
export function markers(p, mode = "svg") {
  const doc = parseXml(
    renderSlideToSvg(p, P.getSlides(p)[0], {
      textLayout: mode,
      resolveFontFamily: (family) => family,
    }),
  );
  return visit(doc.root)
    .filter((el) => el.name.localName === (mode === "svg" ? "text" : "span"))
    .map(textContent)
    .filter((s) => s && !s.startsWith("Number body"));
}
const snapshot = (p) =>
  P._internalPackageOf(p).parts.map((part) => [part.name, part.data.slice()]);

describe("DrawingML automatic numbering", () => {
  it.each(controls)(
    "renders $name on both text paths",
    async ({ rows, markers: expected }) => {
      const p = await numberingDeck(rows),
        before = snapshot(p);
      for (const mode of ["svg", "foreignObject"])
        expect(markers(p, mode)).toEqual(expected);
      expect(snapshot(p)).toEqual(before);
    },
  );
  it("empty numbered paragraphs advance subsequent labels on both paths", async () => {
    const p = await numberingDeck([auto(), { ...auto(), empty: true }, auto()]);
    for (const mode of ["svg", "foreignObject"]) {
      const labels = markers(p, mode);
      expect(labels[0]).toBe("1.");
      expect(labels.at(-1)).toBe("3.");
    }
  });
  it.each(["own", "layout", "master"])(
    "resolves inherited starts and explicit choices from %s",
    async (inherit) => {
      const rows = [
        { level: 0 },
        { level: 1 },
        { level: 0 },
        auto(),
        auto(),
        { level: 0 },
      ];
      const p = await numberingDeck(rows, {
        inherit,
        styles: [{ type: "arabicPeriod", start: 7 }, { type: "none" }],
      });
      const shape = P.getSlideShapes(P.getSlides(p)[0])[0];
      expect(P.getParagraphPropertiesEffective(p, shape, 0).bullet).toEqual({
        autoNum: "arabicPeriod",
        startAt: 7,
      });
      expect(P.getParagraphPropertiesEffective(p, shape, 3).bullet).toBe(
        "number",
      );
      for (const mode of ["svg", "foreignObject"])
        expect(markers(p, mode)).toEqual(["7.", "8.", "1.", "2.", "7."]);
    },
  );
  it("uses separate numbering per table cell, including outline levels and height measurement", async () => {
    const p = await numberingDeck(numberingRows, { table: true, cells: 2 });
    const expected = [...numberingMarkers, ...numberingMarkers];
    for (const mode of ["svg", "foreignObject"])
      expect(markers(p, mode)).toEqual(expected);
    expect(
      P.getTableCellParagraphs(
        P.getTableCell(P.getSlideShapes(P.getSlides(p)[0])[0], 0, 0),
      )[1].properties.level,
    ).toBe(1);
    const reopened = await P.loadPresentation(await P.savePresentation(p));
    expect(markers(reopened)).toEqual(expected);
    expect(P.validatePresentation(reopened)).toEqual([]);
  });
  it("includes wide number labels in table wrapping and minimum row height", async () => {
    const numbered = await numberingDeck([auto(0, 32767)], { table: true });
    const plainDeck = await numberingDeck([plain()], { table: true });
    const options = {
      measureText: (text, font) => ({
        widthPx: (text.length * font.sizePx) / 2,
        ascentPx: font.sizePx * 0.8,
        descentPx: font.sizePx * 0.2,
        lineGapPx: 0,
      }),
    };
    for (const p of [numbered, plainDeck]) {
      const table = P.getSlideShapes(P.getSlides(p)[0])[0];
      P.setTableColumnWidth(table, 0, P.inches(1.8));
      P.setTableRowHeight(table, 0, P.inches(0.1));
    }
    const height = (p) =>
      getTableLayout(p, P.getSlideShapes(P.getSlides(p)[0])[0], options).height;
    expect(height(numbered)).toBeGreaterThan(height(plainDeck));
  });
  it.each([false, true])(
    "retains native numbering through export, import and return copy; table=%s",
    async (table) => {
      const p = await numberingDeck(numberingRows, { table }),
        before = snapshot(p),
        target = createDeck("blank");
      P.importSlide(target, P.getSlides(p)[0], P.getSlideLayouts(target)[0], {
        preserveTextFormatting: true,
      });
      P.removeSlide(target, P.getSlides(target)[0]);
      expect(markers(target)).toEqual(numberingMarkers);
      expect(snapshot(p)).toEqual(before);
      const reopened = await P.loadPresentation(
        await P.savePresentation(target),
      );
      expect(markers(reopened)).toEqual(numberingMarkers);
      const returned = createDeck("blank");
      P.importSlide(
        returned,
        P.getSlides(reopened)[0],
        P.getSlideLayouts(returned)[0],
        { preserveTextFormatting: true },
      );
      P.removeSlide(returned, P.getSlides(returned)[0]);
      expect(markers(returned)).toEqual(numberingMarkers);
      expect(P.validatePresentation(returned)).toEqual([]);
    },
  );
  it.each([
    [" +0007 ", { autoNum: "arabicPeriod", startAt: 7 }],
    ["32767", { autoNum: "arabicPeriod", startAt: 32767 }],
    ...["1", "+0001", "0", "-1", "1.5", "32768", "bad"].map((value) => [
      value,
      "number",
    ]),
  ])(
    "reads integer metadata %s without mutating malformed declarations",
    (value, expected) => {
      const doc = parseXml(
        `<a:buAutoNum xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="arabicPeriod" startAt="${value}"/>`,
      );
      expect(readDrawingBullet(doc.root)).toEqual(expected);
    },
  );
  it("ignores foreign bullet lookalikes and namespaced start attributes", () => {
    expect(
      readDrawingBullet(
        parseXml(
          '<a:buAutoNum xmlns:a="urn:opaque" type="arabicPeriod" startAt="7"/>',
        ).root,
      ),
    ).toBeNull();
    expect(
      readDrawingBullet(
        parseXml(
          '<a:buAutoNum xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:o="urn:opaque" type="arabicPeriod" o:startAt="7"/>',
        ).root,
      ),
    ).toBe("number");
  });
  it("authors starts through the public bullet API and rejects invalid starts without mutation", async () => {
    const p = await numberingDeck([auto(), auto()]),
      shape = P.getSlideShapes(P.getSlides(p)[0])[0];
    P.setShapeBullets(shape, { autoNum: "romanUcPeriod", startAt: 8 });
    expect(P.getParagraphBullet(shape, 0)).toEqual({
      autoNum: "romanUcPeriod",
      startAt: 8,
    });
    expect(markers(p)).toEqual(["VIII.", "IX."]);
    const before = snapshot(p);
    for (const startAt of [0, -2, 1.5, 32768, Infinity, NaN, null, "2"])
      expect(() =>
        P.setParagraphBullet(shape, 0, { autoNum: "arabicPeriod", startAt }),
      ).toThrow(RangeError);
    expect(snapshot(p)).toEqual(before);
    expect(
      markers(await P.loadPresentation(await P.savePresentation(p))),
    ).toEqual(["VIII.", "IX."]);
  });
});
