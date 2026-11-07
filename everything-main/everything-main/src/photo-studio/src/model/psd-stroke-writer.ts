import type { Psd, LayerAdditionalInfo, WriteOptions } from "ag-psd";
import {
  infoHandlers,
  type ExtendedWriteOptions,
} from "ag-psd/dist/additionalInfo";
import {
  createWriter,
  getWriterBuffer,
  writePsd as writeInternal,
  type PsdWriter,
} from "ag-psd/dist/psdWriter";
import { createReader } from "ag-psd/dist/psdReader";
import {
  readVersionAndDescriptor,
  writeVersionAndDescriptor,
} from "ag-psd/dist/descriptor";
import { preserveWrittenPsdLayerMetadata } from "./psd-mask-codec";
import { withPsdFillWriters } from "./psd-fill-codec";
import { validatePsdLayerBounds } from './psd-layer-bounds';

const handler = infoHandlers.find((h) => h.key === "vstk")!;
const originalWrite = handler.write;

// ag-psd 31 uses unitsPercent (whole percentages) for stroke opacity, though
// the PSD UntF descriptor stores a double. Reuse its descriptor construction
// and type dispatch, correcting only this lossy conversion before encoding.
export function writePreciseStroke(
  writer: PsdWriter,
  target: LayerAdditionalInfo,
  psd: Psd,
  options: ExtendedWriteOptions,
) {
  const temporary = createWriter();
  originalWrite(temporary, target, psd, options);
  const descriptor = readVersionAndDescriptor(
    createReader(getWriterBuffer(temporary)),
  );
  descriptor.strokeStyleOpacity = {
    units: "Percent",
    value: (target.vectorStroke!.opacity ?? 1) * 100,
  };
  writeVersionAndDescriptor(writer, "", "strokeStyle", descriptor);
}

export function writePsdWithPreciseStrokes(
  psd: Psd,
  options?: WriteOptions,
): ArrayBuffer {
  validatePsdLayerBounds(psd.children ?? []);
  const writer = createWriter(),
    previous = handler.write;
  // The dependency's dispatch table has no per-write override. Encoding is
  // synchronous: scoped replacement cannot interleave with another writer,
  // and finally restores dispatch even when malformed input throws.
  handler.write = writePreciseStroke;
  try {
    withPsdFillWriters(() => writeInternal(writer, psd, options));
    const buffer = getWriterBuffer(writer);
    preserveWrittenPsdLayerMetadata(new Uint8Array(buffer), psd);
    return buffer;
  } finally {
    handler.write = previous;
  }
}
