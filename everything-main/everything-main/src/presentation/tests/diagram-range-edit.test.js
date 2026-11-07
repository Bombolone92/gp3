import { describe, it, expect } from "vitest";
import { P, createDeck } from "../src/model.js";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import {
  paragraphsOf,
  textBodyText,
} from "../lib/pptx/src/internal/drawingml/text-body.ts";
import {
  NS,
  qname,
  serializeFragment,
  allChildElements,
  firstChildElement,
  getAttrValue,
} from "../lib/pptx/src/internal/xml/index.ts";
import {
  diagramRangeDeck,
  diagramRangeText,
  fieldId,
} from "./diagram-range-fixture.js";
const body = (frame) => readShapeDiagram(frame).model.point("node0").text;
const snapshot = (p) =>
  P._internalPackageOf(p).parts.map((part) => [part.name, part.data.slice()]);
const n = (local) => qname("a", local, NS.dml);
const edit = (frame, text, edits) =>
  P.replaceShapeDiagramText(frame, [{ modelId: "node0", text, edits }]);
const edited = "Title revised\nBody 1 line\nTail end";
const ranges = [
  { start: 5, end: 5, text: " revised" },
  { start: 30, end: 30, text: " end" },
];
describe("semantic SmartArt native range editing", () => {
  it("retains unselected soft breaks, fields, run properties and paragraph styles after separated edits", async () => {
    const { frame } = await diagramRangeDeck(),
      before = body(frame),
      soft = serializeFragment(
        firstChildElement(paragraphsOf(before)[0], n("br")),
      ),
      field = serializeFragment(
        firstChildElement(paragraphsOf(before)[0], n("fld")),
      );
    expect(edit(frame, edited, ranges)).toBe(1);
    const after = body(frame);
    expect(textBodyText(after)).toBe(edited);
    expect(paragraphsOf(after)).toHaveLength(2);
    expect(
      serializeFragment(firstChildElement(paragraphsOf(after)[0], n("br"))),
    ).toBe(soft);
    expect(
      serializeFragment(firstChildElement(paragraphsOf(after)[0], n("fld"))),
    ).toBe(field);
    const runs = allChildElements(paragraphsOf(after)[0], n("r"));
    expect(serializeFragment(runs[1])).toContain('b="1"');
    expect(serializeFragment(runs[2])).toContain('b="0"');
    expect(
      serializeFragment(firstChildElement(paragraphsOf(after)[1], n("pPr"))),
    ).toContain('algn="r"');
  });
  it.each(
    [
      [{ start: 999, end: 999, text: "X" }],
      [
        { start: 1, end: 1, text: "X" },
        { start: -1, end: 0, text: "" },
      ],
      [{ start: 0, end: 0, text: "\u0000" }],
      [{ start: 1, end: 1, text: "X", breakKind: "opaque" }],
    ].map((edits) => ({ edits })),
  )(
    "rejects a complete invalid range batch without changing package bytes $edits",
    async ({ edits }) => {
      const { p, frame } = await diagramRangeDeck(),
        before = snapshot(p);
      expect(() => edit(frame, "ignored", edits)).toThrow();
      expect(snapshot(p)).toEqual(before);
    },
  );
  it("rejects stale histories and mismatched final text atomically", async () => {
    const { p, frame } = await diagramRangeDeck(),
      before = snapshot(p);
    expect(() => edit(frame, "wrong", ranges)).toThrow(
      "history does not match",
    );
    expect(snapshot(p)).toEqual(before);
  });
  it("keeps no-op batches and explicit whole replacements compatible", async () => {
    const { p, frame } = await diagramRangeDeck(),
      before = snapshot(p);
    expect(edit(frame, diagramRangeText, [])).toBe(0);
    expect(snapshot(p)).toEqual(before);
    P.replaceShapeDiagramText(frame, [
      { modelId: "node0", text: "Replacement\nParagraph" },
    ]);
    expect(paragraphsOf(body(frame))).toHaveLength(2);
    expect(
      allChildElements(paragraphsOf(body(frame))[0], n("fld")),
    ).toHaveLength(0);
  });
  it("retains edited native rich text after export, copy both ways and editing copied data", async () => {
    const { p, frame } = await diagramRangeDeck();
    edit(frame, edited, ranges);
    const expected = serializeFragment(body(frame));
    const loaded = await P.loadPresentation(await P.savePresentation(p)),
      target = createDeck("blank");
    const copy = P.importSlide(
      target,
      P.getSlides(loaded)[0],
      P.getSlideLayouts(target)[0],
      { preserveTextFormatting: true },
    );
    const returned = P.importSlide(p, copy, P.getSlideLayouts(p)[0], {
      preserveTextFormatting: true,
    });
    const copiedIds = [];
    for (const f of [
      P.getSlideShapes(P.getSlides(loaded)[0])[0],
      P.getSlideShapes(copy)[0],
      P.getSlideShapes(returned)[0],
    ]) {
      expect(textBodyText(body(f))).toBe(edited);
      expect(paragraphsOf(body(f))).toHaveLength(2);
      const fields = allChildElements(paragraphsOf(body(f))[0], n("fld"));
      expect(fields).toHaveLength(1);
      expect(getAttrValue(fields[0], qname("", "type", ""))).toBe("slidenum");
      const id = getAttrValue(fields[0], qname("", "id", ""));
      expect(id).toMatch(
        /^\{[\dA-F]{8}-[\dA-F]{4}-[\dA-F]{4}-[\dA-F]{4}-[\dA-F]{12}\}$/,
      );
      copiedIds.push(id);
      expect(serializeFragment(body(f))).toContain("<a:br");
    }
    expect(copiedIds[0]).toBe(fieldId);
    expect(copiedIds[2]).not.toBe(copiedIds[0]);
    expect(
      serializeFragment(body(P.getSlideShapes(P.getSlides(loaded)[0])[0])),
    ).toBe(expected);
    const peer = P.copyShape(P.getSlides(p)[0], frame),
      source = readShapeDiagram(frame).data.part.data.slice();
    edit(peer, "X" + edited, [{ start: 0, end: 0, text: "X" }]);
    expect(textBodyText(body(frame))).toBe(edited);
    expect(readShapeDiagram(frame).data.part.data).toEqual(source);
    for (const deck of [p, loaded, target])
      expect(P.validatePresentation(deck)).toEqual([]);
  });
});
