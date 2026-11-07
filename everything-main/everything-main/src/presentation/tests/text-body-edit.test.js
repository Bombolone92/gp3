import { describe, it, expect } from "vitest";
import {
  parseXml,
  serializeFragment,
  NS,
  qname,
  firstChildElement,
  allChildElements,
} from "../lib/pptx/src/internal/xml/index.ts";
import { editTextBodyRange } from "../lib/pptx/src/internal/drawingml/text-body-edit.ts";
import {
  paragraphsOf,
  textBodyText,
} from "../lib/pptx/src/internal/drawingml/text-body.ts";
const n = (s) => qname("a", s, NS.dml);
const xml = (s) =>
  parseXml(
    `<d:t xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}" xmlns:o="urn:opaque">${s}</d:t>`,
  ).root;
const body = () =>
  xml(
    '<a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="2" algn="r"><a:spcAft><a:spcPts val="600"/></a:spcAft></a:pPr><a:r><a:rPr b="1" sz="1600"/><a:t>Heading</a:t></a:r><a:br><a:rPr b="0" sz="1200"/></a:br><a:r><a:rPr i="1" sz="1200"/><a:t>Body value</a:t></a:r><a:endParaRPr sz="1300"/></a:p><a:p><a:pPr lvl="4" algn="l"/><a:r><a:rPr sz="2200"/><a:t>Second</a:t></a:r><a:endParaRPr sz="2300"/></a:p>',
  );
const field = () =>
  xml(
    '<a:p><a:r><a:rPr b="1"/><a:t>Lead </a:t></a:r><a:fld id="dynamic" type="slidenum"><a:rPr b="0"><a:noFill/></a:rPr><a:pPr><a:defRPr sz="1700"><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:latin typeface="Georgia"/></a:defRPr></a:pPr><a:t>123</a:t></a:fld><a:r><a:rPr i="1"/><a:t> tail</a:t></a:r></a:p>',
  );
const apply = (b, e) => {
  editTextBodyRange(b, e);
  return b;
};

describe("native DrawingML text range edits", () => {
  it("inserts in the heading without changing body runs, soft break, paragraph properties or following paragraph", () => {
    const b = body(),
      p = paragraphsOf(b)[0],
      before = p.children.map(serializeFragment),
      following = serializeFragment(paragraphsOf(b)[1]);
    apply(b, { start: 7, end: 7, text: " revised" });
    expect(textBodyText(b)).toBe("Heading revised\nBody value\nSecond");
    const after = paragraphsOf(b)[0].children.map(serializeFragment);
    expect(after[0]).toBe(before[0]);
    expect(after.slice(3)).toEqual(before.slice(2));
    expect(after[2]).toContain('b="1"');
    expect(after[4]).not.toContain('b="1"');
    expect(serializeFragment(paragraphsOf(b)[1])).toBe(following);
  });
  it.each([
    { start: 0, end: 3, text: "New" },
    { start: 8, end: 12, text: "Updated" },
    { start: 8, end: 18, text: "" },
  ])("edits only selected inline text %j", (edit) => {
    const b = body(),
      before = textBodyText(b);
    apply(b, edit);
    expect(textBodyText(b)).toBe(
      before.slice(0, edit.start) + edit.text + before.slice(edit.end),
    );
    expect(allChildElements(paragraphsOf(b)[0], n("br"))).toHaveLength(1);
  });
  it("inherits line-break formatting at the start of a soft line", () => {
    const b = body();
    apply(b, { start: 8, end: 8, text: "New " });
    const runs = allChildElements(paragraphsOf(b)[0], n("r"));
    expect(serializeFragment(runs[1])).toContain('b="0"');
    expect(serializeFragment(runs[1])).toContain('sz="1200"');
  });
  it("honors explicit end-marker state and carries typing state into a new empty paragraph", () => {
    const b = body();
    apply(b, { start: 18, end: 18, text: "X" });
    const last = allChildElements(paragraphsOf(b)[0], n("r")).at(-1);
    expect(serializeFragment(last)).toContain('sz="1300"');
    const noMarker = xml(
      '<a:p><a:r><a:rPr b="1" sz="1800"/><a:t>Bold</a:t></a:r></a:p>',
    );
    apply(noMarker, { start: 4, end: 4, text: "\n" });
    apply(noMarker, { start: 5, end: 5, text: "Next" });
    expect(
      serializeFragment(allChildElements(paragraphsOf(noMarker)[1], n("r"))[0]),
    ).toContain('b="1"');
    expect(
      serializeFragment(allChildElements(paragraphsOf(noMarker)[1], n("r"))[0]),
    ).toContain('sz="1800"');
  });
  it("inserts hard paragraphs and soft lines without changing existing break kinds", () => {
    const b = body();
    apply(b, { start: 18, end: 18, text: "\nAdded" });
    expect(paragraphsOf(b)).toHaveLength(3);
    expect(allChildElements(paragraphsOf(b)[0], n("br"))).toHaveLength(1);
    expect(
      serializeFragment(firstChildElement(paragraphsOf(b)[1], n("pPr"))),
    ).toContain('lvl="2"');
    apply(b, { start: 0, end: 0, text: "Before\n", breakKind: "line" });
    expect(paragraphsOf(b)).toHaveLength(3);
    expect(allChildElements(paragraphsOf(b)[0], n("br"))).toHaveLength(2);
  });
  it("merges paragraphs using leading paragraph and trailing end-marker formatting", () => {
    const b = body();
    apply(b, { start: 18, end: 19, text: "" });
    expect(paragraphsOf(b)).toHaveLength(1);
    expect(textBodyText(b)).toBe("Heading\nBody valueSecond");
    expect(
      serializeFragment(firstChildElement(paragraphsOf(b)[0], n("pPr"))),
    ).toContain('lvl="2"');
    expect(
      serializeFragment(firstChildElement(paragraphsOf(b)[0], n("endParaRPr"))),
    ).toContain("2300");
  });
  it.each([0, 5, 8, 13])(
    "retains an untouched field when inserting outside it at %s",
    (start) => {
      const b = field(),
        before = serializeFragment(
          firstChildElement(paragraphsOf(b)[0], n("fld")),
        );
      apply(b, { start, end: start, text: "X" });
      expect(
        serializeFragment(firstChildElement(paragraphsOf(b)[0], n("fld"))),
      ).toBe(before);
    },
  );
  it.each([
    { start: 6, end: 7, text: "X" },
    { start: 6, end: 6, text: "X" },
    { start: 5, end: 8, text: "X" },
  ])(
    "literalizes an edited field and retains its effective character defaults %j",
    (edit) => {
      const b = field(),
        before = textBodyText(b);
      apply(b, edit);
      expect(textBodyText(b)).toBe(
        before.slice(0, edit.start) + edit.text + before.slice(edit.end),
      );
      expect(allChildElements(paragraphsOf(b)[0], n("fld"))).toHaveLength(0);
      const out = serializeFragment(b);
      expect(out).toContain("1700");
      expect(out).toContain("Georgia");
      expect(out).toContain("<a:noFill");
      expect(out).not.toContain("112233");
      const r = allChildElements(paragraphsOf(b)[0], n("r")).find((r) =>
        serializeFragment(r).includes("Georgia"),
      );
      const rp = firstChildElement(r, n("rPr"));
      expect(
        rp.children
          .filter((c) => c.kind === "element")
          .map((c) => c.name.localName),
      ).toEqual(["noFill", "latin"]);
    },
  );
  it("retains opaque zero-width metadata inside a deleted range once", () => {
    const b = xml(
      '<a:p><a:r><a:t>ab</a:t></a:r><o:keep tag="native"/><a:r><a:t>cd</a:t></a:r></a:p>',
    );
    apply(b, { start: 1, end: 3, text: "X" });
    expect(textBodyText(b)).toBe("aXd");
    expect(serializeFragment(b).match(/<o:keep/g)).toHaveLength(1);
  });
  it("creates text in a missing or empty paragraph and clears text without losing paragraph metadata", () => {
    const b = xml("<a:bodyPr/><a:lstStyle/>");
    apply(b, { start: 0, end: 0, text: "New\nSecond" });
    expect(textBodyText(b)).toBe("New\nSecond");
    const rich = body(),
      ppr = serializeFragment(
        firstChildElement(paragraphsOf(rich)[0], n("pPr")),
      );
    apply(rich, { start: 0, end: textBodyText(rich).length, text: "" });
    expect(textBodyText(rich)).toBe("");
    expect(
      serializeFragment(firstChildElement(paragraphsOf(rich)[0], n("pPr"))),
    ).toBe(ppr);
  });
  it.each([
    { start: -1, end: 2, text: "" },
    { start: 0, end: 999, text: "" },
    { start: 2, end: 1, text: "" },
    { start: 0.5, end: 1, text: "" },
    { start: 0, end: 0, text: "\u0000" },
    { start: 0, end: 0, text: "\ud800" },
    { start: 0, end: 0, text: "X", breakKind: "opaque" },
  ])("rejects invalid edits without mutation %j", (edit) => {
    const b = body(),
      before = serializeFragment(b);
    expect(() => apply(b, edit)).toThrow(RangeError);
    expect(serializeFragment(b)).toBe(before);
  });
  it("rejects surrogate splits, permits whole emoji and normalizes CRLF", () => {
    const b = xml("<a:p><a:r><a:t>A😀B</a:t></a:r></a:p>"),
      before = serializeFragment(b);
    expect(() => apply(b, { start: 2, end: 2, text: "X" })).toThrow(RangeError);
    expect(serializeFragment(b)).toBe(before);
    apply(b, { start: 1, end: 3, text: "一\r\n😀" });
    expect(textBodyText(b)).toBe("A一\n😀B");
  });
  it("keeps sequential Unicode edits consistent over mixed paragraphs and soft breaks", () => {
    const b = body();
    let expected = textBodyText(b),
      seed = 12345;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let i = 0; i < 64; i++) {
      const boundaries = [0];
      for (const c of expected) boundaries.push(boundaries.at(-1) + c.length);
      const a = random() % boundaries.length,
        z = random() % boundaries.length,
        start = boundaries[Math.min(a, z)],
        end = boundaries[Math.max(a, z)],
        text = ["x", "😀", "\nY", "一", ""][random() % 5];
      apply(b, { start, end, text, breakKind: i % 2 ? "line" : "paragraph" });
      expected = expected.slice(0, start) + text + expected.slice(end);
      expect(textBodyText(b)).toBe(expected);
    }
  });
  it("edits a large body without text alignment or per-character XML allocation", () => {
    const content = "a".repeat(200000),
      b = xml(`<a:p><a:r><a:rPr b="1"/><a:t>${content}</a:t></a:r></a:p>`);
    apply(b, { start: 100000, end: 100000, text: "X" });
    expect(textBodyText(b)).toBe(
      content.slice(0, 100000) + "X" + content.slice(100000),
    );
    expect(allChildElements(paragraphsOf(b)[0], n("r"))).toHaveLength(3);
  });
});
