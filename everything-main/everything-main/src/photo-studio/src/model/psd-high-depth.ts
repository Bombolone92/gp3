import {
  type Psd,
  type Layer,
  type LayerAdditionalInfo,
  type PixelData,
  SectionDividerType,
  ColorMode,
} from "ag-psd";
import {
  createWriter,
  getWriterBuffer,
  writeBytes,
  writeInt16,
  writeInt32,
  writeUint8,
  writeUint16,
  writeUint32,
  writeSignature,
  writeZeros,
  writePascalString,
  writeSection,
  type PsdWriter,
} from "ag-psd/dist/psdWriter";
import {
  infoHandlers,
  type ExtendedWriteOptions,
} from "ag-psd/dist/additionalInfo";
import { resourceHandlers } from "ag-psd/dist/imageResources";
import { fromBlendMode, largeAdditionalInfoKeys } from "ag-psd/dist/helpers";
import { assertSize } from "./document";
import { validateRaster } from "./raster";
import { writePreciseStroke } from "./psd-stroke-writer";
import { writePsdFill } from "./psd-fill-codec";
import { psdLayerBounds } from './psd-layer-bounds';
import {
  encodePsdMaskHeader,
  writePsdMaskHeader,
  maskBounds,
} from "./psd-mask-codec";

// Metadata handler dispatch/padding follows ag-psd's MIT-licensed writer:
// https://github.com/Agamnentzar/ag-psd/blob/387049670cb89b88fb8fe1b7c01aeacf98dd2e3b/src/psdWriter.ts
// Copyright (c) 2016 Agamnentzar; full notice in THIRD_PARTY_NOTICES.txt.
// Pixel planes are serialized here directly, with no byte image intermediate.
const alignedFour = new Set([
  "Txt2",
  "luni",
  "vmsk",
  "artb",
  "artd",
  "vogk",
  "SoLd",
  "lnk2",
  "vscg",
  "vsms",
  "GdFl",
  "lmfx",
  "lrFX",
  "cinf",
  "PlLd",
  "Anno",
  "CAI ",
  "OCIO",
  "GenI",
  "FEid",
  "curv",
  "CgEd",
  "vibA",
  "blwh",
  "grdm",
]);
const unpaddedLength = new Set(["Txt2", "cinf", "extn", "CAI ", "OCIO"]);
function metadata(
  writer: PsdWriter,
  target: LayerAdditionalInfo,
  psd: Psd,
  options: ExtendedWriteOptions,
  global = false,
) {
  for (const handler of infoHandlers)
    if (handler.has(target)) {
      const key = handler.key === "vmsk" && options.psb ? "vsms" : handler.key;
      const large = !!options.psb && largeAdditionalInfoKeys.includes(key);
      writeSignature(writer, large ? "8B64" : "8BIM");
      writeSignature(writer, key);
      writeSection(
        writer,
        // Document-level tagged blocks have four-byte padding, even for
        // payloads such as LMsk that use two-byte padding inside layer records.
        global || alignedFour.has(key) ? 4 : 2,
        () =>
          handler.key === "vstk"
            ? writePreciseStroke(writer, target, psd, options)
            : handler.key === "PtFl" ||
                handler.key === "GdFl" ||
                handler.key === "vscg"
              ? writePsdFill(handler.key, writer, target, psd, options)
              : handler.write(writer, target, psd, options),
        !unpaddedLength.has(key),
        large,
      );
    }
}
function records(children: Layer[] = [], depth = 0): Layer[] {
  if (depth > 128) throw new Error("PSD groups exceed the nesting budget.");
  const result: Layer[] = [];
  for (const child of children) {
    if (child.children) {
      result.push({
        name: "</Layer group>",
        sectionDivider: { type: SectionDividerType.BoundingSectionDivider },
      });
      result.push(...records(child.children, depth + 1));
      result.push({
        ...child,
        blendMode:
          child.blendMode === "pass through" ? "normal" : child.blendMode,
        sectionDivider: {
          type:
            child.opened === false
              ? SectionDividerType.ClosedFolder
              : SectionDividerType.OpenFolder,
          key: fromBlendMode[child.blendMode ?? "pass through"],
          subType: 0,
        },
      });
    } else result.push(child);
  }
  return result;
}
function checkPixels(pixels: PixelData, depth: number) {
  if (
    (depth === 16 && !(pixels.data instanceof Uint16Array)) ||
    (depth === 32 && !(pixels.data instanceof Float32Array))
  )
    throw new Error("PSD channel samples do not match the document depth.");
  validateRaster(pixels as Parameters<typeof validateRaster>[0]);
}
function plane(
  writer: PsdWriter,
  pixels: PixelData,
  channel: number,
  depth: number,
) {
  const size = pixels.width * pixels.height,
    bytes = depth / 8;
  const buffer = new Uint8Array(size * bytes),
    view = new DataView(buffer.buffer);
  for (let i = 0; i < size; i++) {
    const value = pixels.data[i * 4 + channel];
    if (depth === 16) view.setUint16(i * bytes, value, false);
    else view.setFloat32(i * bytes, value, false);
  }
  writeBytes(writer, buffer);
}
function tag(writer: PsdWriter, key: string, psb: boolean, write: () => void) {
  writeSignature(writer, psb ? "8B64" : "8BIM");
  writeSignature(writer, key);
  writeSection(writer, 4, write, true, psb);
}

/** Serialize editable RGB/16 or RGB/32 PSD/PSB records and straight planes.
 * RAW is the format's lossless baseline. Compression can be added independently
 * without changing the document model or quantizing channel data.
 */
export function writeHighDepthPsd(psd: Psd, psb = false): ArrayBuffer {
  const depth = psd.bitsPerChannel;
  if (depth !== 16 && depth !== 32)
    throw new Error("High-depth PSD requires 16-bit or 32-bit channels.");
  if (psd.colorMode !== undefined && psd.colorMode !== ColorMode.RGB)
    throw new Error("High-depth writer requires RGB.");
  if (
    psd.globalLayerMaskInfo ||
    psd.rawCompositeData ||
    (psd.channels !== undefined && ![3, 4].includes(psd.channels))
  )
    throw new Error(
      "High-depth writer requires decoded RGB(A) and does not yet serialize global masks or auxiliary channels.",
    );
  assertSize(psd.width, psd.height);
  const composite = psd.imageData;
  if (
    !composite ||
    composite.width !== psd.width ||
    composite.height !== psd.height
  )
    throw new Error("PSD composite dimensions do not match the document.");
  checkPixels(composite, depth);
  const layers = records(psd.children);
  if (layers.length > 32767)
    throw new Error("PSD layer record count exceeds signed 16-bit storage.");
  let allocated = composite.data.byteLength;
  for (const l of layers) {
    if (l.canvas || l.rawData)
      throw new Error(
        "High-depth writer requires decoded pixels, not canvas or raw channel sources.",
      );
    encodePsdMaskHeader(l);
    for (const mask of [l.mask, l.realMask])
      if (mask) {
        if (mask.canvas)
          throw new Error("High-depth pixel masks require decoded samples.");
        const b = maskBounds(mask),
          w = b.right - b.left,
          h = b.bottom - b.top;
        if (w && h && !mask.imageData)
          throw new Error("PSD pixel mask samples are missing.");
        if (mask.imageData) {
          checkPixels(mask.imageData, depth);
          allocated += mask.imageData.data.byteLength;
          if (depth === 32)
            for (let i = 0; i < mask.imageData.data.length; i += 4)
              if (mask.imageData.data[i] < 0 || mask.imageData.data[i] > 1)
                throw new Error("Invalid PSD pixel mask coverage sample.");
        }
      }
    if (l.children && l.imageData)
      throw new Error("A group cannot contain its own pixel source.");
    if (l.imageData) {
      checkPixels(l.imageData, depth);
      allocated += l.imageData.data.byteLength;
    }
    psdLayerBounds(l);
  }
  if (allocated > 512 * 1024 * 1024)
    throw new Error("PSD export exceeds the 512 MB pixel budget.");
  const maximum = depth === 16 ? 65535 : 1;
  let alpha = false;
  for (let i = 3; i < composite.data.length; i += 4)
    if (composite.data[i] !== maximum) {
      alpha = true;
      break;
    }
  const writer = createWriter(),
    options: ExtendedWriteOptions = {
      psb,
      layerIds: new Set(),
      layerToId: new Map(),
    };
  writeSignature(writer, "8BPS");
  writeUint16(writer, psb ? 2 : 1);
  writeZeros(writer, 6);
  writeUint16(writer, alpha ? 4 : 3);
  writeUint32(writer, psd.height);
  writeUint32(writer, psd.width);
  writeUint16(writer, depth);
  writeUint16(writer, ColorMode.RGB);
  writeUint32(writer, 0); // RGB has no color-mode payload.
  writeSection(writer, 1, () => {
    const resources = psd.imageResources ?? {};
    for (const handler of resourceHandlers) {
      const has = handler.has(resources),
        count = has === true ? 1 : has === false ? 0 : has;
      for (let i = 0; i < count; i++) {
        writeSignature(writer, "8BIM");
        writeUint16(writer, handler.key);
        writePascalString(writer, "", 2);
        writeSection(writer, 2, () => handler.write(writer, resources, i));
      }
    }
  });
  writeSection(
    writer,
    2,
    () => {
      if (psb) writeUint32(writer, 0);
      writeUint32(writer, 0); // High-depth records live in Lr16/Lr32.
      writeUint32(writer, 0); // No global pixel mask.
      if (layers.length)
        tag(writer, depth === 16 ? "Lr16" : "Lr32", psb, () => {
          writeInt16(writer, alpha ? -layers.length : layers.length);
          for (const l of layers) {
            const pixels = l.imageData,
              bounds = psdLayerBounds(l);
            writeInt32(writer, bounds.top);
            writeInt32(writer, bounds.left);
            writeInt32(writer, bounds.bottom);
            writeInt32(writer, bounds.right);
            writeUint16(
              writer,
              (pixels ? 4 : 0) + Number(!!l.mask) + Number(!!l.realMask),
            );
            if (pixels)
              for (const channel of [-1, 0, 1, 2]) {
                writeInt16(writer, channel);
                if (psb) writeUint32(writer, 0);
                writeUint32(
                  writer,
                  2 + pixels.width * pixels.height * (depth / 8),
                );
              }
            for (const [id, mask] of [
              [-2, l.mask],
              [-3, l.realMask],
            ] as const)
              if (mask) {
                writeInt16(writer, id);
                if (psb) writeUint32(writer, 0);
                writeUint32(
                  writer,
                  2 +
                    (mask.imageData
                      ? mask.imageData.width *
                        mask.imageData.height *
                        (depth / 8)
                      : 0),
                );
              }
            writeSignature(writer, "8BIM");
            writeSignature(writer, fromBlendMode[l.blendMode ?? "normal"]);
            writeUint8(
              writer,
              Math.round(Math.max(0, Math.min(1, l.opacity ?? 1)) * 255),
            );
            writeUint8(writer, l.clipping ? 1 : 0);
            const irrelevant =
              !!l.vectorMask || !!l.sectionDivider || !!l.adjustment;
            writeUint8(
              writer,
              8 |
                (l.hidden ? 2 : 0) |
                (l.transparencyProtected ? 1 : 0) |
                (irrelevant ? 16 : 0) |
                (l.effectsOpen ? 32 : 0),
            );
            writeUint8(writer, 0);
            writeSection(writer, 1, () => {
              writePsdMaskHeader(writer, l);
              const ranges = l.blendingRanges;
              writeSection(writer, 1, () => {
                if (ranges) {
                  writeBytes(
                    writer,
                    new Uint8Array([
                      ...ranges.compositeGrayBlendSource,
                      ...ranges.compositeGraphBlendDestinationRange,
                    ]),
                  );
                  for (const range of ranges.ranges)
                    writeBytes(
                      writer,
                      new Uint8Array([
                        ...range.sourceRange,
                        ...range.destRange,
                      ]),
                    );
                }
              });
              writePascalString(writer, (l.name ?? "").slice(0, 255), 4);
              metadata(writer, l, psd, options);
            });
          }
          for (const l of layers) {
            if (l.imageData)
              for (const channel of [3, 0, 1, 2]) {
                writeUint16(writer, 0);
                plane(writer, l.imageData, channel, depth);
              }
            for (const mask of [l.mask, l.realMask])
              if (mask) {
                writeUint16(writer, 0);
                if (mask.imageData) plane(writer, mask.imageData, 0, depth);
              }
          }
        });
      if (alpha) tag(writer, depth === 16 ? "Mt16" : "Mt32", psb, () => {});
      metadata(writer, psd, psd, options, true);
    },
    true,
    psb,
  );
  writeUint16(writer, 0); // Composite RAW compression, channel-major big-endian samples.
  for (let channel = 0; channel < (alpha ? 4 : 3); channel++)
    plane(writer, composite, channel, depth);
  return getWriterBuffer(writer);
}
