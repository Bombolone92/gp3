import { describe, it, expect } from "vitest";
import {
  readPsd,
  getLayerImageData,
  getCompositeImageData,
  ColorMode,
  type Psd,
  type Layer,
} from "ag-psd";
import { writeHighDepthPsd } from "../src/model/psd-high-depth";

function pixels(width: number, height: number, depth: 16 | 32, opaque = false) {
  const data =
    depth === 16
      ? new Uint16Array(width * height * 4)
      : new Float32Array(width * height * 4);
  const values =
    depth === 16
      ? [0, 1, 255, 256, 32768, 65534, 65535]
      : [-3.125, -0.1234567, -0, 1 / 65535, 0.1371234, 1, 3.125];
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++)
      data[i * 4 + c] = values[(i * 3 + c) % values.length];
    data[i * 4 + 3] = opaque
      ? depth === 16
        ? 65535
        : 1
      : depth === 16
        ? [0, 1, 32768, 65535][i % 4]
        : [0, 1e-10, 0.625, 1][i % 4];
  }
  return { width, height, data };
}
function inspect(bytes: ArrayBuffer) {
  // ag-psd's eager high-depth reader rejects a negative layer count's merged
  // alpha. Its raw API decodes straight planes without that byte matte path.
  const psd = readPsd(bytes, { useRawData: true, skipThumbnail: true });
  return { ...psd, imageData: getCompositeImageData(psd) };
}
for (const depth of [16, 32] as const)
  for (const psb of [false, true]) {
    describe(`RGB/${depth} ${psb ? "PSB" : "PSD"} serialization`, () => {
      it("aligns consecutive document metadata blocks independently of layer metadata", () => {
        const userMask = { colorSpace: { r: 21, g: 90, b: 180 }, opacity: 0.6 };
        const filterMask = {
          colorSpace: { r: 230, g: 127, b: 12 },
          opacity: 0.4,
        };
        const imageData = pixels(3, 2, depth, true);
        const bytes = writeHighDepthPsd(
          {
            width: 3,
            height: 2,
            bitsPerChannel: depth,
            imageData,
            userMask,
            filterMask,
          },
          psb,
        );
        const decoded = inspect(bytes);
        expect(decoded.userMask).toEqual(userMask);
        expect(decoded.filterMask).toEqual(filterMask);
        const view = new DataView(bytes),
          size = psb ? 8 : 4;
        const length = (offset: number, n = 4) =>
          n === 8 ? Number(view.getBigUint64(offset)) : view.getUint32(offset);
        const signature = (offset: number) =>
          String.fromCharCode(...new Uint8Array(bytes, offset, 4));
        let offset = 26;
        for (let i = 0; i < 2; i++) offset += 4 + length(offset);
        const end = offset + size + length(offset, size);
        offset += size;
        offset += size + length(offset, size);
        offset += 4 + length(offset);
        const keys = [];
        while (offset < end) {
          const sig = signature(offset);
          expect(["8BIM", "8B64"]).toContain(sig);
          const key = signature(offset + 4),
            n = sig === "8B64" ? 8 : 4;
          keys.push(key);
          offset += 8 + n + Math.ceil(length(offset + 8, n) / 4) * 4;
        }
        expect(offset).toBe(end);
        expect(keys).toEqual(["LMsk", "FMsk"]);
      });
      it("retains every source sample, off-canvas bounds, nested groups and editable vectors", () => {
        for (const [width, height] of [
          [1, 7],
          [2, 3],
          [17, 11],
        ]) {
          const composite = pixels(width, height, depth),
            source = pixels(width + 4, height + 2, depth);
          const layer: Layer = {
            name: "Hidden Unicode ź形",
            left: -2,
            top: -1,
            hidden: true,
            opacity: 0.6,
            blendMode: "multiply",
            protected: { position: true },
            imageData: source,
          };
          const vector: Layer = {
            name: "Editable fill",
            vectorFill: {
              type: "color",
              color: { r: 27.25, g: 130.125, b: 246.5 },
            },
            vectorMask: {
              paths: [
                {
                  open: false,
                  operation: "combine",
                  fillRule: "even-odd",
                  knots: [
                    [0.25, 0.5],
                    [width - 0.125, 0.5],
                    [width - 0.125, height - 0.25],
                  ].map(([x, y]) => ({
                    linked: false,
                    points: [x, y, x, y, x, y],
                  })),
                },
              ],
            },
          };
          const input: Psd = {
            width,
            height,
            bitsPerChannel: depth,
            imageData: composite,
            imageResources: {
              resolutionInfo: {
                horizontalResolution: 300.125,
                horizontalResolutionUnit: "PPI",
                widthUnit: "Inches",
                verticalResolution: 240.5,
                verticalResolutionUnit: "PPI",
                heightUnit: "Centimeters",
              },
            },
            children: [
              {
                name: "Group",
                opened: false,
                blendMode: "normal",
                children: [layer, vector],
              },
            ],
          };
          const bytes = writeHighDepthPsd(input, psb),
            decoded = inspect(bytes);
          expect(decoded.bitsPerChannel).toBe(depth);
          expect(decoded.channels).toBe(4);
          expect(decoded.imageData!.data).toEqual(composite.data);
          const group = decoded.children![0],
            raster = group.children![0],
            shape = group.children![1];
          expect(group.name).toBe("Group");
          expect(group.opened).toBe(false);
          expect(group.blendMode).toBe("normal");
          expect(raster.left).toBe(-2);
          expect(raster.top).toBe(-1);
          expect(raster.right).toBe(width + 2);
          expect(raster.bottom).toBe(height + 1);
          expect(raster.name).toBe(layer.name);
          expect(raster.hidden).toBe(true);
          expect(raster.opacity).toBe(0.6);
          expect(raster.blendMode).toBe("multiply");
          expect(raster.protected!.position).toBe(true);
          expect(getLayerImageData(raster)!.data).toEqual(source.data);
          expect(shape.vectorFill).toEqual(vector.vectorFill);
          expect(shape.imageData).toBeUndefined();
          const sourcePoints = vector.vectorMask!.paths[0].knots[0].points,
            actualPoints = shape.vectorMask!.paths[0].knots[0].points;
          for (let i = 0; i < 6; i++)
            expect(
              Math.abs(actualPoints[i] - sourcePoints[i]),
            ).toBeLessThanOrEqual(Math.max(width, height) / 0x1000000);
          expect(decoded.imageResources!.resolutionInfo).toEqual(
            input.imageResources!.resolutionInfo,
          );
          expect(new DataView(bytes).getUint16(4)).toBe(psb ? 2 : 1);
        }
      });
      it("writes empty documents and opaque composites without fabricating raster layers", () => {
        const imageData = pixels(3, 2, depth, true),
          decoded = inspect(
            writeHighDepthPsd(
              { width: 3, height: 2, bitsPerChannel: depth, imageData },
              psb,
            ),
          );
        expect(decoded.children ?? []).toEqual([]);
        expect(decoded.channels).toBe(3);
        expect(decoded.imageData!.data).toEqual(imageData.data);
        const transparent = pixels(3, 2, depth),
          reopen = inspect(
            writeHighDepthPsd(
              {
                width: 3,
                height: 2,
                bitsPerChannel: depth,
                imageData: transparent,
              },
              psb,
            ),
          );
        expect(reopen.channels).toBe(4);
        expect(reopen.imageData!.data).toEqual(transparent.data);
      });
    });
  }
describe("high-depth writer validation", () => {
  it("preserves all unsigned 16-bit codes without rescaling or a byte intermediate", () => {
    const data = new Uint16Array(256 * 256 * 4);
    for (let i = 0; i < 65536; i++) {
      data.set([i, 65535 - i, (i * 127) & 65535, i], i * 4);
    }
    const imageData = { width: 256, height: 256, data };
    const decoded = inspect(
      writeHighDepthPsd({
        width: 256,
        height: 256,
        bitsPerChannel: 16,
        imageData,
        children: [{ imageData }],
      }),
    );
    expect(decoded.imageData!.data).toEqual(data);
    expect(getLayerImageData(decoded.children![0])!.data).toEqual(data);
  });
  it("preserves finite float32 bits including signed zero, subnormal coverage and HDR extremes", () => {
    const words = new Uint32Array([
      0x80000000, 0x00000001, 0x7f7fffff, 0x00000001, 0xff7fffff, 0x00800000,
      0x80800000, 0x3f800000,
    ]);
    const imageData = {
      width: 2,
      height: 1,
      data: new Float32Array(words.buffer),
    };
    const decoded = inspect(
      writeHighDepthPsd({
        width: 2,
        height: 1,
        bitsPerChannel: 32,
        imageData,
        children: [{ imageData }],
      }),
    );
    for (const source of [
      decoded.imageData!,
      getLayerImageData(decoded.children![0])!,
    ])
      expect(
        new Uint32Array(
          source.data.buffer,
          source.data.byteOffset,
          source.data.length,
        ),
      ).toEqual(words);
  });
  it("rejects mismatched depth, malformed samples and missing mask planes before emitting data", () => {
    const psd: Psd = {
      width: 3,
      height: 2,
      bitsPerChannel: 16,
      imageData: pixels(3, 2, 16),
    };
    expect(() => writeHighDepthPsd({ ...psd, bitsPerChannel: 8 })).toThrow(
      "16-bit or 32-bit",
    );
    expect(() =>
      writeHighDepthPsd({ ...psd, imageData: pixels(3, 2, 32) }),
    ).toThrow("match");
    expect(() =>
      writeHighDepthPsd({ ...psd, colorMode: ColorMode.CMYK }),
    ).toThrow("RGB");
    expect(() =>
      writeHighDepthPsd({
        ...psd,
        children: [{ mask: { defaultColor: 255, right: 2, bottom: 3 } }],
      }),
    ).toThrow("mask samples are missing");
    const bad = pixels(3, 2, 32);
    bad.data[1] = Infinity;
    expect(() =>
      writeHighDepthPsd({ ...psd, bitsPerChannel: 32, imageData: bad }),
    ).toThrow("sample");
  });
});
