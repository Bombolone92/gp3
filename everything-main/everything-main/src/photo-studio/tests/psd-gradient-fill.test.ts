import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readPsdWithPatternResources } from "../src/model/psd-patterns";
import type { Psd, VectorContent } from "ag-psd";
import { infoHandlersMap } from "ag-psd/dist/additionalInfo";
import { createReader } from "ag-psd/dist/psdReader";
import { createWriter, getWriterBuffer } from "ag-psd/dist/psdWriter";
import { readVersionAndDescriptor } from "ag-psd/dist/descriptor";
import { writeHighDepthPsd } from "../src/model/psd-high-depth";
import { writePsdWithPreciseStrokes } from "../src/model/psd-stroke-writer";
import {
  withPsdFillReaders,
  withPsdFillWriters,
} from "../src/model/psd-fill-codec";
import {
  writePsdGradientFill,
  type PsdSolidGradientFill,
} from "../src/model/psd-gradient-fill";

const options = {
  useRawData: true,
  skipCompositeImageData: true,
  skipThumbnail: true,
};
const fixture = (label: string, key: string) =>
  new Uint8Array(
    readFileSync(
      new URL(
        `fixtures/psd-gradient-fills/${label}-${key}.psd`,
        import.meta.url,
      ),
    ),
  );

function fill(label = "fractional", key = "GdFl") {
  return readPsdWithPatternResources(fixture(label, key), options).children![0]
    .vectorFill! as unknown as PsdSolidGradientFill;
}
function encode(
  fill: PsdSolidGradientFill | VectorContent,
  key: string,
  depth: 8 | 16 | 32,
  psb: boolean,
) {
  const psd: Psd = {
    width: 5,
    height: 3,
    bitsPerChannel: depth,
    imageData: {
      width: 5,
      height: 3,
      data:
        depth === 8
          ? new Uint8ClampedArray(60)
          : depth === 16
            ? new Uint16Array(60)
            : new Float32Array(60),
    },
    children: [
      {
        name: "Editable gradient",
        vectorFill: fill as VectorContent,
        ...(key === "vscg"
          ? {
              vectorStroke: {
                strokeEnabled: true,
                fillEnabled: true,
                opacity: 0.123456789,
                lineWidth: { value: 1.25, units: "Pixels" as const },
                content: {
                  type: "color" as const,
                  color: { r: 21, g: 71, b: 161 },
                },
              },
            }
          : {}),
      },
    ],
  };
  return new Uint8Array(
    depth === 8
      ? writePsdWithPreciseStrokes(psd, { psb, noBackground: true })
      : writeHighDepthPsd(psd, psb),
  );
}

describe("PSD gradient definitions", () => {
  it("keeps stop positions independent of smoothness", () => {
    for (const key of ["GdFl", "vscg"])
      for (const label of ["zero", "fractional", "half", "full", "absent"]) {
        const fill = readPsdWithPatternResources(fixture(label, key), options)
          .children![0].vectorFill!;
        expect(fill.type).toBe("solid");
        if (fill.type !== "solid") throw new Error("Expected solid gradient");
        expect(
          fill.colorStops.map((s) => s.location),
          `${key}/${label}`,
        ).toEqual([0, 0.5, 1]);
        expect(
          fill.opacityStops.map((s) => s.location),
          `${key}/${label}`,
        ).toEqual([0, 0.75, 1]);
      }
  });

  it("retains precise original percentages, interpolation and color-stop types through PSD/PSB at every depth", () => {
    for (const key of ["GdFl", "vscg"])
      for (const label of ["zero", "fractional", "half", "full", "absent"]) {
        const original = fill(label, key);
        expect(original.interpolationSamples).toBe(
          {
            zero: 0,
            fractional: 137.375,
            half: 2048,
            full: 4096,
            absent: undefined,
          }[label],
        );
        expect(original.scalePercent).toBe(137.12345678901235);
        expect(original.offsetPercent).toEqual({
          x: -12.345678901234567,
          y: 87.65432109876543,
        });
        expect(original.opacityStops.map((s) => s.opacityPercent)).toEqual([
          12.345678901234567, 87.65432109876543, 0,
        ]);
        expect(original.colorStops.map((s) => s.colorType)).toEqual([
          "Clry.UsrS",
          "Clry.FrgC",
          "Clry.BckC",
        ]);
        expect(
          "scale" in original ||
            "offset" in original ||
            "smoothness" in original,
        ).toBe(false);
        for (const depth of [8, 16, 32] as const)
          for (const psb of [false, true]) {
            const decoded = readPsdWithPatternResources(
              encode(structuredClone(original), key, depth, psb),
              options,
            );
            expect(decoded.children![0].vectorFill).toEqual(original);
          }
      }
  });

  it("accepts legacy fraction inputs with independent stop locations and no whole-percent rounding", () => {
    const original = fill(),
      input: Extract<VectorContent, { type: "solid" }> = {
        type: "solid",
        name: "Fraction inputs",
        style: "linear",
        angle: -0,
        smoothness: 0.123456789,
        scale: 1.3712345678901235,
        offset: { x: -0.123456789, y: 0.87654321 },
        colorStops: original.colorStops,
        opacityStops: original.opacityStops.map((s) => ({
          ...s,
          opacity: s.opacityPercent / 100,
          opacityPercent: undefined,
        })),
      };
    for (const key of ["GdFl", "vscg"]) {
      const writer = createWriter();
      writePsdGradientFill(writer, key as "GdFl" | "vscg", input);
      const reader = createReader(getWriterBuffer(writer));
      if (key === "vscg") reader.offset += 4;
      const descriptor = readVersionAndDescriptor(reader);
      expect(descriptor.Grad.Intr).toBe(input.smoothness! * 4096);
      expect(descriptor.Grad.Clrs.map((s: { Lctn: number }) => s.Lctn)).toEqual(
        [0, 2048, 4096],
      );
      expect(descriptor["Scl "].value).toBe(input.scale! * 100);
      expect(descriptor.Ofst.Hrzn.value).toBe(input.offset!.x * 100);
      expect(descriptor.Grad.Trns[0].Opct.value).toBe(
        input.opacityStops[0].opacity * 100,
      );
      expect(Object.is(descriptor.Angl.value, -0)).toBe(true);
    }
  });

  it("reports malformed descriptors even when additional-info errors would be suppressed", () => {
    for (const key of ["GdFl", "vscg"])
      for (const label of [
        "invalid-unit",
        "invalid-number",
        "invalid-location",
      ])
        expect(() =>
          readPsdWithPatternResources(fixture(label, key), options),
        ).toThrow(/Invalid PSD gradient/);
    for (const change of [
      { interpolationSamples: NaN },
      { interpolationSamples: null },
      { scalePercent: null },
      { offsetPercent: null },
      { dither: 1 },
      { angle: Infinity },
      { colorStops: [{ ...fill().colorStops[0], location: -1 }] },
      { opacityStops: [{ ...fill().opacityStops[0], opacityPercent: 101 }] },
      { smoothness: 0.5 },
      { scale: 1 },
      { offset: { x: 0, y: 0 } },
      { opacityStops: [{ ...fill().opacityStops[0], opacity: 0.5 }] },
    ])
      expect(() =>
        encode(
          { ...fill(), ...change } as PsdSolidGradientFill,
          "GdFl",
          8,
          false,
        ),
      ).toThrow(/PSD gradient/);
  });

  it("writes native opaque endpoints when there are no opacity variations, without mutating canonical or legacy inputs", () => {
    const canonical = { ...fill(), opacityStops: [] },
      legacy: Extract<VectorContent, { type: "solid" }> = {
        type: "solid",
        name: "Opaque legacy ramp",
        style: "reflected",
        smoothness: 0.375,
        colorStops: canonical.colorStops,
        opacityStops: [],
      };
    for (const input of [canonical, legacy]) {
      const before = structuredClone(input);
      for (const key of ["GdFl", "vscg"])
        for (const depth of [8, 16, 32] as const)
          for (const psb of [false, true]) {
            const decoded = readPsdWithPatternResources(
              encode(input, key, depth, psb),
              options,
            ).children![0].vectorFill as unknown as PsdSolidGradientFill;
            expect(decoded.opacityStops).toEqual([
              { location: 0, midpoint: 0.5, opacityPercent: 100 },
              { location: 1, midpoint: 0.5, opacityPercent: 100 },
            ]);
            expect(decoded.colorStops).toEqual(input.colorStops);
            expect(decoded.name).toBe(input.name);
            expect(decoded.style).toBe(input.style);
          }
      expect(input).toEqual(before);
    }
  });

  it("bounds descriptor reads to the layer block and restores shared dispatch entries", () => {
    const bytes = new Uint8Array(
      readFileSync(
        new URL("fixtures/psd-gradient-fills/fractional.bin", import.meta.url),
      ),
    );
    const descriptorReader = createReader(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    readVersionAndDescriptor(descriptorReader);
    for (const key of ["GdFl", "vscg"]) {
      const prefix =
        key === "vscg" ? new Uint8Array([71, 100, 70, 108]) : new Uint8Array();
      const joined = new Uint8Array(7 + prefix.length + bytes.length + 128);
      joined.set(prefix, 7);
      joined.set(bytes, 7 + prefix.length);
      const reader = createReader(
        joined.buffer,
        joined.byteOffset,
        joined.byteLength,
      );
      reader.offset = 7;
      expect(() =>
        withPsdFillReaders(() =>
          infoHandlersMap[key].read(
            reader,
            {},
            () => prefix.length + descriptorReader.offset - 1,
            {} as Psd,
            {},
          ),
        ),
      ).toThrow();
    }
    const originals = ["PtFl", "GdFl", "vscg"].map((key) => ({
      read: infoHandlersMap[key].read,
      write: infoHandlersMap[key].write,
    }));
    for (const scope of [withPsdFillReaders, withPsdFillWriters]) {
      expect(scope(() => scope(() => 37))).toBe(37);
      expect(() =>
        scope(() => {
          throw new Error("Interrupted codec");
        }),
      ).toThrow("Interrupted codec");
    }
    ["PtFl", "GdFl", "vscg"].forEach((key, i) => {
      expect(infoHandlersMap[key].read).toBe(originals[i].read);
      expect(infoHandlersMap[key].write).toBe(originals[i].write);
    });
  });
});
