import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Psd } from "ag-psd";
import { infoHandlersMap } from "ag-psd/dist/additionalInfo";
import { createReader } from "ag-psd/dist/psdReader";
import { readVersionAndDescriptor } from "ag-psd/dist/descriptor";
import { readPsdWithPatternResources } from "../src/model/psd-patterns";
import { writePsdWithPreciseStrokes } from "../src/model/psd-stroke-writer";
import { writeHighDepthPsd } from "../src/model/psd-high-depth";
import {
  withPsdFillReaders,
  withPsdFillWriters,
  type PsdPatternFill,
} from "../src/model/psd-fill-codec";

const options = {
  useRawData: true,
  skipCompositeImageData: true,
  skipThumbnail: true,
};
function fixture(label: string, key: string) {
  return new Uint8Array(
    readFileSync(
      new URL(
        `fixtures/psd-pattern-fills/${label}-${key}.psd`,
        import.meta.url,
      ),
    ),
  );
}
const identity = {
  type: "pattern",
  name: "Original coordinate tile Ω",
  id: "original-coordinate-tile",
} as const;
const expected: Record<string, PsdPatternFill> = {
  default: identity,
  complete: {
    ...identity,
    scalePercent: 137.12345678901235,
    angle: -32.987654321098766,
    align: false,
    linked: false,
    phase: { x: -12345.678901234567, y: 0.0000000000123456789 },
  },
  "explicit-defaults": {
    ...identity,
    scalePercent: 100,
    angle: 0,
    align: true,
    linked: true,
    phase: { x: 0, y: -0 },
  },
};
function encode(
  fill: PsdPatternFill,
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
        name: "Editable pattern",
        vectorFill: fill,
        ...(key === "vscg"
          ? {
              vectorStroke: {
                strokeEnabled: true,
                fillEnabled: true,
                lineWidth: { value: 1.25, units: "Pixels" as const },
                content: {
                  type: "color" as const,
                  color: { r: 21, g: 71, b: 161 },
                },
                opacity: 0.123456789,
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

describe("PSD pattern-fill parameters", () => {
  it("bounds nested descriptor reads to the tagged block, including offset views", () => {
    const descriptor = new Uint8Array(
        readFileSync(
          new URL("fixtures/psd-pattern-fills/complete.bin", import.meta.url),
        ),
      ),
      descriptorReader = createReader(
        descriptor.buffer,
        descriptor.byteOffset,
        descriptor.byteLength,
      );
    readVersionAndDescriptor(descriptorReader);
    for (const key of ["PtFl", "vscg"]) {
      const prefix = key === "vscg" ? new TextEncoder().encode("PtFl") : [],
        payload = Uint8Array.from([...prefix, ...descriptor]),
        backing = new Uint8Array(payload.length + 39);
      backing.set(payload, 17);
      for (const missing of [1, 3, 8]) {
        const reader = createReader(backing.buffer, 11),
          end = 6 + prefix.length + descriptorReader.offset - missing,
          target = {};
        reader.offset = 6;
        // All bytes are available in the backing buffer, but the record's
        // declared boundary falls inside the final double's payload.
        expect(() =>
          withPsdFillReaders(() =>
            infoHandlersMap[key].read(
              reader,
              target,
              () => end - reader.offset,
              { width: 5, height: 3 },
              {},
            ),
          ),
        ).toThrow();
        expect(target).toEqual({});
        expect(reader.offset).toBe(end);
      }
    }
  });
  it("reads independent PtFl/vscg descriptors with precise values and omitted defaults", () => {
    for (const key of ["PtFl", "vscg"])
      for (const label of Object.keys(expected)) {
        const bytes = fixture(label, key),
          before = bytes.slice();
        expect(
          readPsdWithPatternResources(bytes, options).children![0].vectorFill,
        ).toEqual(expected[label]);
        expect(bytes).toEqual(before);
      }
  });

  it("retains editable descriptor values through every depth and PSD/PSB encoding", () => {
    for (const key of ["PtFl", "vscg"])
      for (const label of Object.keys(expected)) {
        const source = readPsdWithPatternResources(fixture(label, key), options)
          .children![0].vectorFill as PsdPatternFill;
        for (const depth of [8, 16, 32] as const)
          for (const psb of [false, true]) {
            const output = readPsdWithPatternResources(
              encode(source, key, depth, psb),
              options,
            );
            expect(output.children![0].vectorFill).toEqual(expected[label]);
            if (key === "vscg")
              expect(output.children![0].vectorStroke?.opacity).toBe(
                0.123456789,
              );
            expect(output.bitsPerChannel).toBe(depth);
            // Editing changes the descriptor itself, not a cached bitmap.
            const edited = {
              ...source,
              scalePercent: 73.65432198765432,
              angle: 278.7654321987654,
              align: false,
              linked: true,
              phase: { x: 0.125, y: -987.25 },
            };
            expect(
              readPsdWithPatternResources(
                encode(edited, key, depth, psb),
                options,
              ).children![0].vectorFill,
            ).toEqual(edited);
          }
        expect(source).toEqual(expected[label]);
      }
  });

  it("reports malformed descriptors rather than substituting defaults", () => {
    for (const key of ["PtFl", "vscg"])
      for (const label of ["invalid-units", "invalid-number"]) {
        expect(() =>
          readPsdWithPatternResources(fixture(label, key), options),
        ).toThrow("PSD pattern-fill");
      }
    for (const key of ["PtFl", "vscg"])
      for (const depth of [8, 16, 32] as const)
        for (const change of [
          { scalePercent: NaN },
          { angle: Infinity },
          { align: 1 },
          { linked: "true" },
          { phase: { x: 0, y: NaN } },
          { id: 37 },
        ]) {
          expect(() =>
            encode(
              { ...identity, ...change } as PsdPatternFill,
              key,
              depth,
              false,
            ),
          ).toThrow();
        }
  });

  it("restores both dispatch entries on successful, nested and failed operations", () => {
    const originals = ["PtFl", "vscg"].map((key) => ({
      read: infoHandlersMap[key].read,
      write: infoHandlersMap[key].write,
    }));
    for (const scope of [
      withPsdFillReaders,
      withPsdFillWriters,
    ]) {
      expect(scope(() => scope(() => 37))).toBe(37);
      expect(() =>
        scope(() => {
          throw new Error("Interrupted codec");
        }),
      ).toThrow("Interrupted codec");
    }
    for (const key of ["PtFl", "vscg"]) {
      readPsdWithPatternResources(fixture("complete", key), options);
      expect(() =>
        readPsdWithPatternResources(fixture("invalid-units", key), options),
      ).toThrow();
      expect(() =>
        encode({ ...identity, angle: NaN }, key, 8, false),
      ).toThrow();
    }
    ["PtFl", "vscg"].forEach((key, i) => {
      expect(infoHandlersMap[key].read).toBe(originals[i].read);
      expect(infoHandlersMap[key].write).toBe(originals[i].write);
    });
  });
});
