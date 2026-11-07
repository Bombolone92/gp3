import { describe, expect, it } from "vitest";
import {
  NS,
  parseXml,
  serializeFragment,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { sampleDiagramColors } from "../lib/pptx/src/internal/diagram/color-list.ts";

const list = (colors, attrs = "") =>
  parseXml(
    `<d:txFillClrLst xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}" ${attrs}>${colors.map((c) => `<a:schemeClr val="${c}"/>`).join("")}</d:txFillClrLst>`,
  ).root;
const value = (c) => getAttrValue(c, qname("", "val", ""));
const position = (sample, palette) => {
  const colors = palette.children.filter((c) => c.kind === "element");
  return colors.indexOf(sample.from) + sample.amount;
};

describe("DiagramML color-list sampling", () => {
  it("repeats discrete palette entries without interpolating or requiring a count", () => {
    const palette = list(["accent3", "accent1", "accent6"], 'meth="repeat"');
    const samples = Array.from({ length: 8 }, (_, i) =>
      sampleDiagramColors(palette, i, null),
    );
    expect(samples.map((s) => value(s.from))).toEqual([
      "accent3",
      "accent1",
      "accent6",
      "accent3",
      "accent1",
      "accent6",
      "accent3",
      "accent1",
    ]);
    expect(samples.every((s) => s.from === s.to && s.amount === 0)).toBe(true);
  });

  it("spans all palette intervals including both endpoints, with span as the schema default", () => {
    const palette = list(["accent1", "accent2", "accent3"]);
    const samples = Array.from({ length: 5 }, (_, i) =>
      sampleDiagramColors(palette, i, 5),
    );
    expect(samples.map((s) => position(s, palette))).toEqual([
      0, 0.5, 1, 1.5, 2,
    ]);
    expect(samples.every((s) => s.hueDirection === "cw")).toBe(true);
  });

  it("cycles out and back without repeating the first color on the last node, matching the native reference", () => {
    for (const colors of [
      ["accent1", "accent2"],
      ["accent1", "accent2", "accent3"],
    ]) {
      const palette = list(colors, 'meth="cycle"');
      const expected = [0, 1 / 3, 2 / 3, 1, 2 / 3, 1 / 3];
      for (let i = 0; i < 6; i++)
        expect(
          position(sampleDiagramColors(palette, i, 6), palette),
        ).toBeCloseTo(expected[i] * (colors.length - 1), 12);
    }
  });

  it("samples odd node counts evenly and handles single-node diagrams", () => {
    const palette = list(["accent1", "accent2"], 'meth="cycle"');
    expect(
      Array.from({ length: 5 }, (_, i) =>
        position(sampleDiagramColors(palette, i, 5), palette),
      ),
    ).toEqual([0, 0.4, 0.8, 0.8, 0.4]);
    expect(position(sampleDiagramColors(palette, 0, 1), palette)).toBe(0);
    const singleNode = sampleDiagramColors(list(["accent1", "accent2"]), 0, 1);
    expect(value(singleNode.from)).toBe("accent1");
    expect(singleNode.to).toBe(singleNode.from);
    expect(singleNode.amount).toBe(0);
  });

  it("retains unresolved colors, hue direction and transforms without changing the input", () => {
    const palette = parseXml(
      `<d:txFillClrLst xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}" hueDir="ccw"><a:schemeClr val="tx1"><a:alpha val="40000"/><a:lumMod val="75000"/></a:schemeClr></d:txFillClrLst>`,
    ).root;
    const before = serializeFragment(palette),
      sample = sampleDiagramColors(palette, null, null);
    expect(sample.from).toBe(palette.children[0]);
    expect(sample.to).toBe(sample.from);
    expect(sample.amount).toBe(0);
    expect(sample.hueDirection).toBe("ccw");
    expect(serializeFragment(palette)).toBe(before);
  });

  it("does not supply a color for empty or foreign lists", () => {
    expect(sampleDiagramColors(null, 0, 1)).toBeNull();
    expect(sampleDiagramColors(list([]), 0, 1)).toBeNull();
    const foreign = parseXml(
      `<d:txFillClrLst xmlns:d="${NS.diagram}"><schemeClr xmlns="urn:foreign" val="accent1"/></d:txFillClrLst>`,
    ).root;
    expect(sampleDiagramColors(foreign, 0, 1)).toBeNull();
    expect(
      sampleDiagramColors(
        parseXml('<txFillClrLst xmlns="urn:foreign"/>').root,
        0,
        1,
      ),
    ).toBeNull();
  });

  it("reports invalid multi-color indexing and unknown modes rather than choosing an arbitrary color", () => {
    const palette = list(["accent1", "accent2"]);
    for (const index of [null, -1, NaN, Infinity, 0.5, 0x80000000])
      expect(() => sampleDiagramColors(palette, index, 4)).toThrow(
        "valid style index",
      );
    for (const count of [null, 0, -1, NaN, Infinity, 0.5, 0x80000000])
      expect(() => sampleDiagramColors(palette, 0, count)).toThrow(
        "valid style count",
      );
    expect(() => sampleDiagramColors(palette, 4, 4)).toThrow(
      "valid style count",
    );
    expect(() =>
      sampleDiagramColors(list(["accent1", "accent2"], 'meth="future"'), 0, 4),
    ).toThrow("unknown diagram color method");
    expect(() =>
      sampleDiagramColors(list(["accent1"], 'hueDir="future"'), 0, 1),
    ).toThrow("unknown diagram hue direction");
  });
});
