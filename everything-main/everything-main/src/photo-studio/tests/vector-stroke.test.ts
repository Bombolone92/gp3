import { describe, it, expect } from "vitest";
import {
  importVectorStroke,
  exportVectorStroke,
  strokePixels,
  strokeDashPixels,
  strokeDashRuns,
  parseStrokeDashInput,
  validateVectorStroke,
  supportedStrokePaths,
  type VectorStroke,
} from "../src/model/vector-stroke";
import { newDocument, layer } from "../src/model/document";
import {
  validateDocument,
  serialize,
  deserialize,
} from "../src/model/serialization";
import { Assets } from "../src/model/assets";
import { savePsd } from "../src/model/psd";
import { readPsd, writePsd } from "ag-psd";
import { infoHandlers } from "ag-psd/dist/additionalInfo";
import { writePsdWithPreciseStrokes } from "../src/model/psd-stroke-writer";
import { writeHighDepthPsd } from "../src/model/psd-high-depth";

const make = () =>
  importVectorStroke({
    vectorStroke: {
      strokeEnabled: true,
      fillEnabled: false,
      lineWidth: { value: 2.125, units: "Points" },
      lineDashOffset: { value: -3.75, units: "Inches" },
      resolution: 144,
      lineAlignment: "outside",
      lineCapType: "square",
      lineJoinType: "bevel",
      miterLimit: 17.25,
      opacity: 0.375,
      content: { type: "color", color: { fr: -0.125, fg: 3.25, fb: 0.731 } },
    },
  })!;

describe("editable solid vector strokes", () => {
  it("requires center alignment and verified operations before enabling open-path strokes", () => {
    const contour = {
      open: true,
      operation: "combine" as const,
      fillRule: "non-zero" as const,
      knots: [],
    };
    const mask = { paths: [contour] };
    expect(
      supportedStrokePaths(mask, { enabled: true, alignment: "center" }),
    ).toBe(true);
    expect(
      supportedStrokePaths(mask, { enabled: true, alignment: "inside" }),
    ).toBe(false);
    expect(
      supportedStrokePaths(
        { ...mask, invert: true },
        { enabled: true, alignment: "center" },
      ),
    ).toBe(false);
    expect(
      supportedStrokePaths(
        { paths: [contour, contour] },
        { enabled: true, alignment: "center" },
      ),
    ).toBe(false);
    expect(
      supportedStrokePaths(
        { paths: [contour, contour] },
        { enabled: false, alignment: "center" },
      ),
    ).toBe(true);
  });
  it("writes fractional percentage opacity at every depth without changing codec dispatch", () => {
    const handler = infoHandlers.find((h) => h.key === "vstk")!,
      original = handler.write;
    for (const bitsPerChannel of [8, 16, 32] as const)
      for (const psb of [false, true])
        for (const opacity of [0, 0.123456789, 0.625, 1]) {
          const stroke = exportVectorStroke(
            {
              ...make(),
              opacity,
              lineDashSet: [
                { value: 4, units: "None" },
                { value: 1.125, units: "Points" },
                { value: 2.375, units: "Pixels" },
              ],
            },
            make().color.rgb,
          )!;
          const psd = {
            width: 4,
            height: 3,
            bitsPerChannel,
            children: [
              {
                vectorStroke: stroke,
                vectorFill: {
                  type: "color" as const,
                  color: { r: 31.25, g: 117.125, b: 263.5 },
                },
              },
            ],
            imageData: {
              width: 4,
              height: 3,
              data:
                bitsPerChannel === 8
                  ? new Uint8ClampedArray(48)
                  : bitsPerChannel === 16
                    ? new Uint16Array(48)
                    : new Float32Array(48),
            },
          };
          const bytes =
            bitsPerChannel === 8
              ? writePsdWithPreciseStrokes(psd, { psb, noBackground: true })
              : writeHighDepthPsd(psd, psb);
          const output = readPsd(bytes, {
            useRawData: true,
            skipLayerImageData: true,
            skipCompositeImageData: true,
          }).children![0];
          expect(output.vectorStroke!.opacity).toBeCloseTo(opacity, 15);
          expect(output.vectorStroke!.lineWidth).toEqual(stroke.lineWidth);
          expect(output.vectorStroke!.content).toEqual(stroke.content);
          expect(output.vectorStroke!.lineDashSet).toEqual(stroke.lineDashSet);
          expect(output.vectorStroke!.lineDashOffset).toEqual(
            stroke.lineDashOffset,
          );
          expect(handler.write).toBe(original);
        }
    expect(() =>
      writePsdWithPreciseStrokes({ width: 100000000, height: 1 }),
    ).toThrow();
    expect(handler.write).toBe(original);
    // The independent fixture codec retains its own behavior after our call.
    const ordinary = writePsd(
      { width: 4, height: 3, children: [{ vectorStroke: { opacity: 0.625 } }] },
      { noBackground: true },
    );
    expect(
      readPsd(ordinary, {
        skipLayerImageData: true,
        skipCompositeImageData: true,
      }).children![0].vectorStroke!.opacity,
    ).toBe(0.63);
  });
  it("converts physical units without changing the stored descriptor", () => {
    const s = make(),
      before = structuredClone(s);
    expect(strokePixels(s)).toBe(4.25);
    expect(s).toEqual(before);
    for (const [units, value] of [
      ["Pixels", 144],
      ["Points", 72],
      ["Picas", 6],
      ["Inches", 1],
      ["Millimeters", 25.4],
      ["Centimeters", 2.54],
    ] as const) {
      s.lineWidth = { units, value };
      expect(strokePixels(s)).toBeCloseTo(144, 12);
    }
    const output = exportVectorStroke(before, before.color.rgb)!;
    expect(output.lineWidth).toEqual(before.lineWidth);
    expect(output.lineDashOffset).toEqual(before.lineDashOffset);
    expect(importVectorStroke({ vectorStroke: output })).toEqual(before);
  });
  it("retains descriptor dash units, scales relative intervals and merges zero-gap seams", () => {
    const s = make();
    s.lineDashSet = [
      { value: 2, units: "None" },
      { value: 1, units: "Points" },
      { value: 3.25, units: "Pixels" },
    ];
    s.lineDashOffset = { value: -7.125, units: "None" };
    expect(strokeDashPixels(s)).toEqual([8.5, 2, 3.25]);
    validateVectorStroke(s);
    expect(
      importVectorStroke({ vectorStroke: exportVectorStroke(s, s.color.rgb) }),
    ).toEqual(s);
    s.lineWidth.value *= 2;
    expect(strokeDashPixels(s)).toEqual([17, 2, 3.25]);
    s.lineDashOffset = { value: 0, units: "Pixels" };
    s.lineDashSet = parseStrokeDashInput("4, 0, 2, 3")!;
    expect(strokeDashRuns(s)).toEqual([{ on: 6, off: 3, phase: 0 }]);
    s.lineDashSet = parseStrokeDashInput("4, 3, 2, 0")!;
    expect(strokeDashRuns(s)).toEqual([{ on: 6, off: 3, phase: 2 }]);
    s.lineDashSet = parseStrokeDashInput("4, 0")!;
    expect(strokeDashRuns(s)).toEqual([]);
    s.lineDashSet = parseStrokeDashInput("4, 2, 3")!;
    expect(strokeDashRuns(s)).toEqual([
      { on: 3, off: 15, phase: 12 },
      { on: 2, off: 16, phase: 5 },
      { on: 4, off: 14, phase: 0 },
    ]);
    expect(parseStrokeDashInput("0, 2")).toBeUndefined();
    expect(parseStrokeDashInput("2, -1")).toBeUndefined();
    expect(parseStrokeDashInput("1, nope")).toBeUndefined();
    expect(parseStrokeDashInput("")).toEqual([]);
    const path = {
      open: false,
      operation: "combine" as const,
      fillRule: "non-zero" as const,
      knots: [],
    };
    expect(supportedStrokePaths({ paths: [path, path] }, s)).toBe(false);
    expect(supportedStrokePaths({ paths: [path] }, s)).toBe(true);
  });
  it("keeps unsupported stroke behavior explicit instead of dropping it", () => {
    const original = exportVectorStroke(make(), make().color.rgb)!;
    for (const extra of [
      {
        lineDashSet: [
          { value: 0, units: "None" as const },
          { value: 2, units: "None" as const },
        ],
      },
      { scaleLock: true },
      { strokeAdjust: true },
      { blendMode: "multiply" as const },
      { content: { type: "pattern" as const, name: "Pattern", id: "unknown" } },
    ])
      expect(
        importVectorStroke({ vectorStroke: { ...original, ...extra } }),
      ).toBeUndefined();
  });
  it("rejects invalid paint, units, widths and allocation inputs before rendering", () => {
    const changes = [
      (s: VectorStroke) => (s.lineWidth.value = -1),
      (s: VectorStroke) => (s.lineWidth.value = Infinity),
      (s: VectorStroke) => (s.lineWidth.units = "Density"),
      (s: VectorStroke) => (s.opacity = 1.1),
      (s: VectorStroke) => (s.resolution = 0),
      (s: VectorStroke) => (s.miterLimit = 0),
      (s: VectorStroke) => (s.color.rgb[0] = NaN),
      (s: VectorStroke) => (s.lineDashSet = [{ value: -1, units: "Pixels" }]),
      (s: VectorStroke) =>
        (s.lineDashSet = [
          { value: 0, units: "None" },
          { value: 2, units: "None" },
        ]),
      (s: VectorStroke) =>
        (s.lineDashSet = Array(257).fill({ value: 1, units: "Pixels" })),
      (s: VectorStroke) =>
        (s.lineDashOffset = { value: 1e308, units: "Inches" }),
    ];
    for (const change of changes) {
      const s = make();
      change(s);
      expect(() => validateVectorStroke(s)).toThrow("stroke");
    }
  });
  it("preserves high precision paint, units and flags through native projects and blocks lossy filter export", async () => {
    const d = newDocument(73, 41),
      l = layer("vector", "Shape", 73, 41);
    l.vector = {
      mask: { paths: [], fillStartsWithAllPixels: true },
      reference: { x: 0, y: 0, width: 73, height: 41 },
      fill: { rgb: [1, 0.2, -0.3], space: "document" },
      stroke: make(),
    };
    d.layers = [l];
    d.bitsPerChannel = 32;
    validateDocument(d);
    const loaded = await deserialize(await serialize(d, new Assets()));
    expect(loaded.document).toEqual(d);
    loaded.assets.clear();
    l.filters.saturation = 30;
    await expect(
      savePsd(d, async () => {
        throw Error("Composite requested");
      }),
    ).rejects.toThrow("filtered vector strokes");
  });
});
