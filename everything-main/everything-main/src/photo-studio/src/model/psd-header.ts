import { assertSize } from "./document";

// Check the header before asking a decoder to allocate image buffers.
export function validatePsdHeader(bytes: Uint8Array) {
  if (
    bytes.length < 26 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== "8BPS"
  )
    throw new Error("Invalid PSD file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (![1, 2].includes(view.getUint16(4)))
    throw new Error("Invalid PSD/PSB version.");
  assertSize(view.getUint32(18), view.getUint32(14));
  if (![8, 16, 32].includes(view.getUint16(22)) || view.getUint16(24) !== 3)
    throw new Error(
      "PSD support currently requires 8-bit, 16-bit or 32-bit RGB.",
    );
  if (![3, 4].includes(view.getUint16(12)))
    throw new Error("RGB PSD auxiliary channels are not yet supported.");
}
