import {
  type Psd,
  type Layer,
  type LayerMaskData,
  type ReadOptions,
} from "ag-psd";
import { createReader, readPsd as readInternal } from "ag-psd/dist/psdReader";
import {
  writeBytes,
  writeSection,
  type PsdWriter,
} from "ag-psd/dist/psdWriter";
import {
  readPsdLayerMaskRecords,
  type PsdLayerMaskRecord,
} from "./psd-metadata";
import { psdLayerBounds, type PsdLayerBounds } from "./psd-layer-bounds";

export type PsdPixelMask = LayerMaskData & {
  // The dependency drops the obsolete inversion flag and reserved flag bits.
  inverted?: boolean;
  flags?: number;
};
type MaskPair = { mask?: PsdPixelMask; realMask?: PsdPixelMask };
type MaskNode = MaskPair & { bounds?: PsdLayerBounds; children?: MaskNode[] };

// Use the same pinned CommonJS module graph as the scoped tagged-block
// adapters. The package's ESM entry has its own dispatch table in browsers.
function readPsd(bytes: Uint8Array, options?: ReadOptions): Psd {
  return readInternal(
    createReader(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    options,
  );
}

// The order psd-tools decodes is real-mask data, then parameters, despite the
// published format table. Presence is determined by channel -3, not the remaining header length:
// https://psd-tools.readthedocs.io/en/latest/_modules/psd_tools/psd/layer_and_mask.html
// The pinned reader mistakes long parameter-only headers for real-mask data.
export function decodePsdMaskHeader(
  bytes: Uint8Array,
  hasRealMask: boolean,
): MaskPair {
  if (!bytes.length) return {};
  if (bytes.length < 18 || bytes.length > 64)
    throw new Error("Invalid PSD pixel mask header length.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const need = (n: number) => {
    if (at + n > bytes.length)
      throw new Error("Truncated PSD pixel mask header.");
  };
  const rectangle = () => {
    need(16);
    const top = v.getInt32(at),
      left = v.getInt32(at + 4),
      bottom = v.getInt32(at + 8),
      right = v.getInt32(at + 12);
    at += 16;
    if (bottom < top || right < left)
      throw new Error("Invalid PSD pixel mask bounds.");
    return { top, left, bottom, right };
  };
  const state = (defaultColor: number, flags: number): PsdPixelMask => {
    if (defaultColor !== 0 && defaultColor !== 255)
      throw new Error("Invalid PSD pixel mask default color.");
    return {
      defaultColor,
      flags,
      disabled: !!(flags & 2),
      positionRelativeToLayer: !!(flags & 1),
      fromVectorData: !!(flags & 8),
      inverted: !!(flags & 4),
    };
  };
  const bounds = rectangle();
  need(2);
  const mask = { ...bounds, ...state(bytes[at], bytes[at + 1]) };
  at += 2;
  let realMask: PsdPixelMask | undefined;
  if (hasRealMask) {
    need(2);
    const flags = bytes[at++],
      color = bytes[at++];
    realMask = { ...state(color, flags), ...rectangle() };
  }
  if (mask.flags! & 16) {
    need(1);
    const parameters = bytes[at++];
    if (parameters & ~15)
      throw new Error("Unsupported PSD pixel mask parameter flags.");
    if (parameters & 1) {
      need(1);
      mask.userMaskDensity = bytes[at++] / 255;
    }
    if (parameters & 2) {
      need(8);
      mask.userMaskFeather = v.getFloat64(at);
      at += 8;
    }
    if (parameters & 4) {
      need(1);
      mask.vectorMaskDensity = bytes[at++] / 255;
    }
    if (parameters & 8) {
      need(8);
      mask.vectorMaskFeather = v.getFloat64(at);
      at += 8;
    }
    for (const feather of [mask.userMaskFeather, mask.vectorMaskFeather])
      if (feather !== undefined && (!Number.isFinite(feather) || feather < 0))
        throw new Error("Invalid PSD pixel mask feather.");
  }
  // The pinned encoder adds two bytes; other encoders align to four bytes.
  if (bytes.length - at > 3 || bytes.subarray(at).some((v) => v !== 0))
    throw new Error("Invalid PSD pixel mask padding.");
  return { mask, realMask };
}

export function maskBounds(mask: LayerMaskData) {
  const top = mask.top ?? 0,
    left = mask.left ?? 0,
    bottom = mask.imageData
      ? top + mask.imageData.height
      : (mask.bottom ?? top),
    right = mask.imageData ? left + mask.imageData.width : (mask.right ?? left);
  if (
    ![top, left, bottom, right].every(
      (v) => Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff,
    ) ||
    bottom < top ||
    right < left
  )
    throw new Error("Invalid PSD pixel mask bounds.");
  return { top, left, bottom, right };
}
export function encodePsdMaskHeader(pair: MaskPair): Uint8Array {
  if (!pair.mask && !pair.realMask) return new Uint8Array();
  if (!pair.mask)
    throw new Error("A PSD real pixel mask requires a primary mask header.");
  const mask = pair.mask,
    real = pair.realMask;
  let params = 0;
  for (const [key, bit] of [
    ["userMaskDensity", 1],
    ["userMaskFeather", 2],
    ["vectorMaskDensity", 4],
    ["vectorMaskFeather", 8],
  ] as const)
    if (mask[key] !== undefined) params |= bit;
  const size =
    18 +
    (params ? 1 : 0) +
    (params & 1 ? 1 : 0) +
    (params & 2 ? 8 : 0) +
    (params & 4 ? 1 : 0) +
    (params & 8 ? 8 : 0) +
    (real ? 18 : 0) +
    2;
  const out = new Uint8Array(size),
    v = new DataView(out.buffer);
  let at = 0;
  const bounds = (m: LayerMaskData) => {
    const b = maskBounds(m);
    for (const value of [b.top, b.left, b.bottom, b.right]) {
      v.setInt32(at, value);
      at += 4;
    }
  };
  const flags = (m: PsdPixelMask, real = false) => {
    if (
      m.flags !== undefined &&
      (!Number.isInteger(m.flags) || m.flags < 0 || m.flags > 255)
    )
      throw new Error("Invalid PSD pixel mask flags.");
    for (const value of [
      m.disabled,
      m.inverted,
      m.positionRelativeToLayer,
      m.fromVectorData,
    ])
      if (value !== undefined && typeof value !== "boolean")
        throw new Error("Invalid PSD pixel mask state.");
    return (
      ((m.flags ?? 0) & (real ? 0xf0 : 0xe0)) |
      (m.positionRelativeToLayer ? 1 : 0) |
      (m.disabled ? 2 : 0) |
      (m.inverted ? 4 : 0) |
      (m.fromVectorData ? 8 : 0) |
      (!real && params ? 16 : 0)
    );
  };
  const color = (m: PsdPixelMask) => {
    const c = m.defaultColor ?? 0;
    if (c !== 0 && c !== 255)
      throw new Error("Invalid PSD pixel mask default color.");
    return c;
  };
  bounds(mask);
  out[at++] = color(mask);
  out[at++] = flags(mask);
  if (real) {
    out[at++] = flags(real, true);
    out[at++] = color(real);
    bounds(real);
  }
  if (params) {
    out[at++] = params;
    for (const [key, bit] of [
      ["userMaskDensity", 1],
      ["userMaskFeather", 2],
      ["vectorMaskDensity", 4],
      ["vectorMaskFeather", 8],
    ] as const)
      if (params & bit) {
        const n = mask[key]!;
        if (!Number.isFinite(n) || n < 0 || ((bit === 1 || bit === 4) && n > 1))
          throw new Error("Invalid PSD pixel mask parameter.");
        if (bit === 1 || bit === 4) out[at++] = Math.round(n * 255);
        else {
          v.setFloat64(at, n);
          at += 8;
        }
      }
  }
  return out;
}
export function writePsdMaskHeader(writer: PsdWriter, pair: MaskPair) {
  writeSection(writer, 1, () => writeBytes(writer, encodePsdMaskHeader(pair)));
}

function tree(records: PsdLayerMaskRecord[], pairs: MaskNode[]): MaskNode[] {
  const root: MaskNode = { children: [] },
    stack = [root];
  for (let i = records.length - 1; i >= 0; i--) {
    const type = records[i].sectionDivider,
      node: MaskNode = { ...pairs[i] };
    if (type === 3) {
      if (stack.length === 1)
        throw new Error("Invalid PSD mask layer hierarchy.");
      stack.pop();
    } else {
      stack.at(-1)!.children!.unshift(node);
      if (type === 1 || type === 2) {
        node.children = [];
        stack.push(node);
      }
    }
  }
  if (stack.length !== 1) throw new Error("Invalid PSD mask layer hierarchy.");
  return root.children!;
}
function zip(
  layers: Layer[],
  nodes: MaskNode[],
  apply: (layer: Layer, node: MaskNode) => void,
) {
  if (layers.length !== nodes.length)
    throw new Error("PSD pixel mask records do not match the layer hierarchy.");
  for (let i = 0; i < layers.length; i++) {
    apply(layers[i], nodes[i]);
    if (nodes[i].children)
      zip(layers[i].children ?? [], nodes[i].children!, apply);
    else if (layers[i].children?.length)
      throw new Error(
        "PSD pixel mask records do not match the layer hierarchy.",
      );
  }
}

/** Correct record metadata without changing channel payloads or caller bytes. */
export function readPsdWithPixelMasks(
  bytes: Uint8Array,
  options?: ReadOptions,
): Psd {
  const blocks = readPsdLayerMaskRecords(bytes);
  const eagerLayers = !options?.useRawData && !options?.skipLayerImageData;
  if (
    !blocks.some((b) =>
      b.some((r) => r.end > r.start || (eagerLayers && !r.hasLayerPixels)),
    )
  )
    return readPsd(bytes, options);
  let nodes: MaskNode[] = [];
  const patches: {
    start: number;
    original: Uint8Array;
    replacement: Uint8Array;
  }[] = [];
  for (const block of blocks) {
    const pairs: MaskNode[] = block.map((r) => {
      const pair: MaskNode = decodePsdMaskHeader(
        bytes.subarray(r.start, r.end),
        r.hasRealMask,
      );
      if (eagerLayers && !r.hasLayerPixels) {
        // Empty color/transparency streams are no raster cache. The pinned
        // decoder allocates an opaque black plane from the rectangle alone.
        // Give it zero raster extent while keeping independent mask extents,
        // then restore the authoritative declarative rectangle after decoding.
        const original = bytes.slice(r.recordStart, r.recordStart + 16),
          view = new DataView(original.buffer);
        pair.bounds = {
          top: view.getInt32(0),
          left: view.getInt32(4),
          bottom: view.getInt32(8),
          right: view.getInt32(12),
        };
        const replacement = original.slice(),
          adjusted = new DataView(replacement.buffer);
        adjusted.setInt32(8, pair.bounds.top);
        adjusted.setInt32(12, pair.bounds.left);
        patches.push({ start: r.recordStart, original, replacement });
      }
      return pair;
    });
    nodes = [...tree(block, pairs), ...nodes];
    for (let i = 0; i < block.length; i++) {
      const r = block[i],
        pair = pairs[i];
      if (!pair.mask) continue;
      // Strip parameters from the codec's temporary view; it may create a
      // harmless empty real-mask header from remaining zero bytes. Restore the
      // authoritative metadata below, preserving its decoded channel buffers.
      if (pair.mask.flags! & 16 && !pair.realMask) {
        const original = bytes.slice(r.start, r.end),
          replacement = new Uint8Array(original.length);
        replacement.set(original.subarray(0, 18));
        replacement[17] &= ~16;
        patches.push({ start: r.start, original, replacement });
      }
    }
  }
  // The synchronous decode restores headers even on failure. Channel views
  // remain valid after restoration. Shared buffers are copied instead.
  const input =
    typeof SharedArrayBuffer !== "undefined" &&
    bytes.buffer instanceof SharedArrayBuffer
      ? bytes.slice()
      : bytes;
  let decoded: Psd;
  try {
    for (const p of patches) input.set(p.replacement, p.start);
    decoded = readPsd(input, options);
  } finally {
    for (const p of patches) input.set(p.original, p.start);
  }
  zip(decoded.children ?? [], nodes, (layer, pair) => {
    if (pair.bounds) Object.assign(layer, pair.bounds);
    const apply = (key: "mask" | "realMask") => {
      if (pair[key]) layer[key] = { ...layer[key], ...pair[key] };
      else delete layer[key];
    };
    apply("mask");
    apply("realMask");
  });
  return decoded;
}

/** Retain declarative rectangles and mask flags dropped by the pinned writer. */
export function preserveWrittenPsdLayerMetadata(
  bytes: Uint8Array,
  psd: Psd,
): Uint8Array {
  const blocks = readPsdLayerMaskRecords(bytes);
  if (!blocks.some((b) => b.length)) return bytes;
  const explicitBounds = (layers: Layer[]): boolean =>
    layers.some(
      (layer) =>
        (!layer.imageData &&
          !layer.canvas &&
          (layer.right !== undefined || layer.bottom !== undefined)) ||
        (layer.children && explicitBounds(layer.children)),
    );
  if (
    !blocks.some((block) =>
      block.some((record) => record.end > record.start),
    ) &&
    !explicitBounds(psd.children ?? [])
  )
    return bytes;
  let nodes: MaskNode[] = [];
  const spans = new WeakMap<MaskNode, PsdLayerMaskRecord>();
  // Build nodes separately so the association uses record structure, never IDs.
  // Writers emit one layer-record block at the selected channel depth.
  if (blocks.filter((b) => b.length).length !== 1)
    throw new Error("Unexpected PSD writer layer record blocks.");
  const block = blocks.find((b) => b.length)!;
  nodes = tree(
    block,
    block.map(() => ({})),
  );
  const ordered: MaskNode[] = [];
  const flatten = (items: MaskNode[]) => {
    for (const n of items) {
      if (n.children) {
        ordered.push({});
        flatten(n.children);
      }
      ordered.push(n);
    }
  };
  flatten(nodes);
  if (ordered.length !== block.length)
    throw new Error("Invalid PSD writer mask hierarchy.");
  ordered.forEach((n, i) => spans.set(n, block[i]));
  zip(psd.children ?? [], nodes, (layer, node) => {
    const r = spans.get(node)!;
    if (
      !layer.imageData &&
      !layer.canvas &&
      (layer.right !== undefined || layer.bottom !== undefined)
    ) {
      // ag-psd zeroes right/bottom for empty channel streams. Those fields
      // remain meaningful for live fills, even without a cached raster.
      const bounds = psdLayerBounds(layer);
      const record = new DataView(
        bytes.buffer,
        bytes.byteOffset + r.recordStart,
        16,
      );
      record.setInt32(0, bounds.top);
      record.setInt32(4, bounds.left);
      record.setInt32(8, bounds.bottom);
      record.setInt32(12, bounds.right);
    }
    if (r.start === r.end) return;
    const original = bytes.subarray(r.start, r.end),
      v = new DataView(
        original.buffer,
        original.byteOffset,
        original.byteLength,
      );
    const bounds = {
      top: v.getInt32(0),
      left: v.getInt32(4),
      bottom: v.getInt32(8),
      right: v.getInt32(12),
    };
    const mask = {
      ...(layer.mask as PsdPixelMask),
      ...bounds,
      imageData: undefined,
      canvas: undefined,
    };
    let realMask: PsdPixelMask | undefined;
    if (layer.realMask)
      realMask = {
        ...(layer.realMask as PsdPixelMask),
        top: v.getInt32(20),
        left: v.getInt32(24),
        bottom: v.getInt32(28),
        right: v.getInt32(32),
        imageData: undefined,
        canvas: undefined,
      };
    const header = encodePsdMaskHeader({ mask, realMask });
    if (header.length !== original.length)
      throw new Error("PSD mask header size changed while preserving flags.");
    bytes.set(header, r.start);
  });
  return bytes;
}
