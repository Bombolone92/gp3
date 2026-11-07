import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "../lib/pptx-preview/src/base64.ts";

// Exercise both feature-detection paths even when the test runtime lacks the
// new built-in. Buffer is an independent byte encoder, not the browser fallback.
const withEncoder = (encoder, run) => {
  const descriptor = Object.getOwnPropertyDescriptor(
    Uint8Array.prototype,
    "toBase64",
  );
  Object.defineProperty(Uint8Array.prototype, "toBase64", {
    configurable: true,
    writable: true,
    value: encoder,
  });
  try {
    run();
  } finally {
    if (descriptor)
      Object.defineProperty(Uint8Array.prototype, "toBase64", descriptor);
    else delete Uint8Array.prototype.toBase64;
  }
};
const reference = (bytes) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    "base64",
  );

for (const mode of ["native", "fallback"])
  describe(`image Base64 encoding (${mode})`, () => {
    it("preserves the complete byte range, alphabet, and padding", () => {
      let calls = 0;
      withEncoder(
        mode === "native"
          ? function () {
              calls++;
              return reference(this);
            }
          : undefined,
        () => {
          expect(bytesToBase64(new Uint8Array())).toBe("");
          expect(bytesToBase64(Uint8Array.of(255))).toBe("/w==");
          expect(bytesToBase64(Uint8Array.of(255, 239))).toBe("/+8=");
          expect(bytesToBase64(Uint8Array.of(255, 239, 190))).toBe("/+++");
          const allBytes = Uint8Array.from({ length: 256 }, (_, i) => i);
          expect(bytesToBase64(allBytes)).toBe(reference(allBytes));
        },
      );
      expect(calls).toBe(mode === "native" ? 5 : 0);
    });

    it("encodes only the view across conversion chunk boundaries", () => {
      withEncoder(
        mode === "native"
          ? function () {
              return reference(this);
            }
          : undefined,
        () => {
          const bytes = Uint8Array.from(
            { length: 100_000 },
            (_, i) => (i * 179 + 93) % 256,
          );
          for (const size of [
            0, 1, 2, 32767, 32768, 32769, 65535, 65536, 65537,
          ]) {
            const view = bytes.subarray(17, 17 + size);
            const before = view.slice();
            expect(bytesToBase64(view)).toBe(reference(view));
            expect(view).toEqual(before);
          }
        },
      );
    });
  });

it("agrees with the independent encoder in the actual runtime", () => {
  const bytes = Uint8Array.from({ length: 70_001 }, (_, i) => i % 256);
  expect(bytesToBase64(bytes.subarray(19))).toBe(reference(bytes.subarray(19)));
});
