import { describe, it, expect } from "vitest";
import {
  newDocument,
  layer,
  cropDocument,
  resizeDocument,
} from "../src/model/document";
import { gradientProperty, gradientStop } from "../src/model/gradient-edit";
import {
  gradientSampler,
  type VectorGradient,
} from "../src/model/vector-gradient";
import { validateDocument } from "../src/model/serialization";
import { vectorColorRgb, vectorHexColor } from "../src/color/vector";

function fixture() {
  const doc = newDocument(40, 32),
    l = layer("vector", "Gradient", 40, 32);
  const fill: VectorGradient = {
    type: "solid",
    name: "Independent",
    frame: { x: -7, y: 3, width: 24, height: 16 },
    angle: 37,
    interpolationSamples: 137.375,
    colorStops: [
      { location: 0, midpoint: 0.5, color: { r: 23.125, g: 73.25, b: 133.5 } },
      { location: 1, midpoint: 0.25, color: { r: 213.5, g: 32.125, b: 77.25 } },
    ],
    opacityStops: [
      { location: 0, midpoint: 0.5, opacityPercent: 17.375 },
      { location: 1, midpoint: 0.7, opacityPercent: 81.125 },
    ],
  };
  l.vector = {
    reference: { x: 0, y: 0, width: 40, height: 32 },
    fill,
    psdBounds: { left: -7, top: 3, right: 17, bottom: 19 },
    mask: { paths: [], fillStartsWithAllPixels: true },
  };
  doc.layers = [l];
  return { doc, l, fill };
}
describe("editable gradient document behavior", () => {
  it("edits original precision without mutating a history snapshot and converts display colors to document space", () => {
    const { doc, l, fill } = fixture(),
      snapshot = JSON.stringify(fill);
    expect(
      gradientProperty(l, doc, "gradientSmoothness", "37.12345678901235", false)
        .interpolationSamples,
    ).toBe((37.12345678901235 / 100) * 4096);
    expect(
      gradientProperty(
        l,
        doc,
        "gradientOpacity1OpacityPercent",
        "13.123456789012345",
        false,
      ).opacityStops[1].opacityPercent,
    ).toBe(13.123456789012345);
    doc.bitsPerChannel = 32;
    const changed = gradientProperty(
        l,
        doc,
        "gradientColor1Color",
        "#123456",
        false,
      ),
      rgb = vectorColorRgb(vectorHexColor("#123456"), doc);
    expect(changed.colorStops[1].color).toEqual({
      r: rgb[0] * 255,
      g: rgb[1] * 255,
      b: rgb[2] * 255,
    });
    expect(changed.colorStops[0]).toEqual(fill.colorStops[0]);
    expect(JSON.stringify(fill)).toBe(snapshot);
    for (const [key, value] of [
      ["gradientScale", "0"],
      ["gradientAngle", ""],
      ["gradientColor0Location", "101"],
      ["gradientOpacity8Midpoint", "50"],
      ["gradientStyle", "noise"],
      ["gradientColor0Color", "#xyzxyz"],
    ])
      expect(() => gradientProperty(l, doc, key, value, false)).toThrow();
  });
  it("adds independently sampled color and opacity stops and retains the last required color", () => {
    const { fill } = fixture(),
      sampled = gradientSampler(
        {
          ...fill,
          angle: 0,
          interpolationSamples: 0,
          frame: { x: 0, y: 0, width: 2, height: 1 },
        },
        [1, 0, 0, 1, 0, 0],
      )(0.5, 0);
    const linear = { ...fill, interpolationSamples: 0 },
      color = gradientStop(linear, "color", "add"),
      opacity = gradientStop(linear, "opacity", "add");
    expect(color.colorStops.at(-1)!.location).toBe(0.5);
    expect(color.colorStops.at(-1)!.color).toEqual({
      r: sampled[0] * 255,
      g: sampled[1] * 255,
      b: sampled[2] * 255,
    });
    expect(opacity.opacityStops.at(-1)!.opacityPercent).toBe(sampled[3] * 100);
    const empty = gradientStop(
      gradientStop(fill, "opacity", "remove", 1),
      "opacity",
      "remove",
      0,
    );
    expect(empty.opacityStops).toEqual([]);
    expect(
      gradientStop(empty, "opacity", "add").opacityStops[0].opacityPercent,
    ).toBe(100);
    const last = gradientStop(fill, "color", "remove", 0);
    expect(() => gradientStop(last, "color", "remove", 0)).toThrow();
    expect(fill.colorStops).toHaveLength(2);
  });
  it("keeps unlinked paint under nonuniform canvas resize and crop and validates its independent affine", () => {
    const { doc, l, fill } = fixture();
    fill.align = false;
    const before = gradientSampler(fill, [1, 0, 0, 1, 0, 0]);
    resizeDocument(doc, 80, 24);
    cropDocument(doc, { x: 5, y: 3, width: 60, height: 19 });
    const after = gradientSampler(fill, [2, 0, 0, 0.75, 99, -38]);
    for (const [x, y] of [
      [0, 0],
      [7.125, 8.75],
      [17.5, 13.25],
    ]) {
      const actual = after((x + 0.5) * 2 - 5 - 0.5, (y + 0.5) * 0.75 - 3 - 0.5),
        expected = before(x, y);
      actual.forEach((v, c) => expect(v).toBeCloseTo(expected[c], 13));
    }
    expect(validateDocument(structuredClone(doc))).toEqual(doc);
    fill.matrix = [1, 0, 0, 0, 0, 0];
    expect(() => validateDocument(doc)).toThrow();
    const linked = gradientProperty(l, doc, "gradientAligned", "", true);
    expect(linked.matrix).toBeUndefined();
    expect(linked.frame).toEqual({ x: -7, y: 3, width: 24, height: 16 });
  });
});
