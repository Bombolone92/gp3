import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { decompressMtxStreams } from "../lib/pptx/src/internal/fonts/mtx-lzcomp.ts";
import { FontFormatError } from "../lib/pptx/src/internal/fonts/binary.ts";

const { vectors } = JSON.parse(
  readFileSync(
    new URL("./fixtures/fonts/mtx-vectors.json", import.meta.url),
    "utf8",
  ),
);
const empty = new Uint8Array(4);
const compressed = (name) =>
  Uint8Array.from(
    Buffer.from(vectors.find((v) => v.name === name).compressed, "base64"),
  );
const u24 = (bytes, at, value) => {
  bytes[at] = value >>> 16;
  bytes[at + 1] = value >>> 8;
  bytes[at + 2] = value;
};
const container = (streams, copyLimit = 0xffffff) => {
  const bytes = new Uint8Array(
    10 + streams.reduce((sum, b) => sum + b.length, 0),
  );
  bytes[0] = 3;
  u24(bytes, 1, copyLimit);
  u24(bytes, 4, 10 + streams[0].length);
  u24(bytes, 7, 10 + streams[0].length + streams[1].length);
  let at = 10;
  for (const stream of streams) {
    bytes.set(stream, at);
    at += stream.length;
  }
  return bytes;
};
const font = (block, limit) => container([block, empty, empty], limit);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

describe("MTX 1.0 adaptive LZCOMP streams", () => {
  for (const vector of vectors) {
    it(`matches the independent published codec: ${vector.name}`, () => {
      const bytes = font(
          Uint8Array.from(Buffer.from(vector.compressed, "base64")),
          vector.copyLimit,
        ),
        before = bytes.slice();
      if (vector.error) {
        const message = {
          history: /history/,
          length: /declared output length/,
          "run-length": /run-length/,
        }[vector.error];
        expect(() => decompressMtxStreams(bytes)).toThrow(message);
      } else {
        const result = decompressMtxStreams(bytes);
        expect(result[0].length).toBe(vector.length);
        expect(digest(result[0])).toBe(vector.sha256);
        if (vector.plaintext !== undefined)
          expect(result[0]).toEqual(
            Uint8Array.from(Buffer.from(vector.plaintext, "base64")),
          );
        expect(result[1]).toEqual(empty.subarray(0, 0));
        expect(result[2]).toEqual(empty.subarray(0, 0));
        result[0].fill(88);
      }
      expect(bytes).toEqual(before);
    });
  }

  it("decodes independent trees and histories for all three streams", () => {
    const names = [
        "all byte values",
        "wrapped motif window 0",
        "long run-length expansion",
      ],
      bytes = container(names.map(compressed), 0);
    for (let rotation = 0; rotation < 3; rotation++) {
      const streams = names.map((_, i) =>
          compressed(names[(i + rotation) % 3]),
        ),
        result = decompressMtxStreams(container(streams, 0));
      for (let i = 0; i < 3; i++) {
        const expected = vectors.find(
          (v) => v.name === names[(i + rotation) % 3],
        );
        expect(result[i].length).toBe(expected.length);
        expect(digest(result[i])).toBe(expected.sha256);
      }
    }
    const results = decompressMtxStreams(bytes);
    results[0].fill(0);
    expect(digest(results[1])).toBe(
      vectors.find((v) => v.name === names[1]).sha256,
    );
  });

  it("reads sliced Node buffers without modifying or returning aliases", () => {
    const encoded = font(compressed("all byte values")),
      wrapped = Buffer.alloc(encoded.length + 41, 0xee);
    wrapped.set(encoded, 13);
    const before = Buffer.from(wrapped),
      bytes = wrapped.subarray(13, 13 + encoded.length);
    expect(decompressMtxStreams(bytes)[0]).toEqual(
      Uint8Array.from({ length: 256 }, (_, i) => i),
    );
    decompressMtxStreams(bytes)[0].fill(0);
    expect(wrapped).toEqual(before);
  });

  it("allows unspecified unused bits in the final partial byte", () => {
    const block = empty.slice();
    block[3] = 0x7f; // The flag plus length consumes 25 bits, leaving seven.
    expect(decompressMtxStreams(container([block, block, block]))).toEqual([
      new Uint8Array(),
      new Uint8Array(),
      new Uint8Array(),
    ]);
  });

  it("rejects whole trailing bytes rather than hiding an additional stream", () => {
    const block = new Uint8Array(5);
    expect(() => decompressMtxStreams(font(block))).toThrow(/trailing/);
  });
});

describe("MTX bounds and resource limits", () => {
  for (const length of Array.from({ length: 10 }, (_, i) => i))
    it(`rejects a ${length}-byte truncated header`, () => {
      expect(() => decompressMtxStreams(new Uint8Array(length))).toThrow(
        FontFormatError,
      );
    });
  for (const version of [0, 1, 2, 4, 255])
    it(`rejects unsupported container version ${version}`, () => {
      const bytes = font(empty);
      bytes[0] = version;
      expect(() => decompressMtxStreams(bytes)).toThrow(/version/);
    });
  for (const [second, third] of [
    [0, 18],
    [10, 18],
    [19, 18],
    [14, 14],
    [14, 22],
    [14, 0xffffff],
    [0xffffff, 18],
  ])
    it(`rejects out-of-order or out-of-bounds offsets ${second}/${third}`, () => {
      const bytes = font(empty);
      u24(bytes, 4, second);
      u24(bytes, 7, third);
      expect(() => decompressMtxStreams(bytes)).toThrow(/offsets/);
    });
  for (const stream of [0, 1, 2])
    for (const length of [1, 2, 3])
      it(`rejects stream ${stream + 1} with only ${length} header bytes`, () => {
        const blocks = [empty, empty, empty];
        blocks[stream] = empty.subarray(0, length);
        expect(() => decompressMtxStreams(container(blocks))).toThrow(
          /truncated/,
        );
      });
  it("rejects every truncated byte prefix of a nonempty adaptive stream", () => {
    const block = compressed("all byte values");
    for (let at = 1; at < block.length; at++)
      expect(() => decompressMtxStreams(font(block.subarray(0, at)))).toThrow(
        FontFormatError,
      );
  });
  for (const limit of [
    -1,
    0.5,
    NaN,
    Infinity,
    0x80000000,
    Number.MAX_SAFE_INTEGER,
  ])
    it(`rejects invalid decoded budget ${limit}`, () => {
      expect(() =>
        decompressMtxStreams(font(empty), { maxDecodedBytes: limit }),
      ).toThrow(/limit/);
    });
  it("allows a zero budget for empty decoded streams, including RLE", () => {
    expect(
      decompressMtxStreams(font(empty), { maxDecodedBytes: 0 }).map(
        (v) => v.length,
      ),
    ).toEqual([0, 0, 0]);
    expect(
      decompressMtxStreams(font(compressed("empty expanded RLE")), {
        maxDecodedBytes: 0,
      })[0].length,
    ).toBe(0);
  });
  it("enforces the aggregate budget, not three separate full budgets", () => {
    const block = compressed("all byte values"),
      input = container([block, block, block]);
    expect(
      decompressMtxStreams(input, { maxDecodedBytes: 768 }).map(
        (v) => v.length,
      ),
    ).toEqual([256, 256, 256]);
    expect(() => decompressMtxStreams(input, { maxDecodedBytes: 767 })).toThrow(
      /output limit/,
    );
    expect(() => decompressMtxStreams(input, { maxDecodedBytes: 256 })).toThrow(
      /output limit/,
    );
  });
  it("bounds expanded RLE rather than the 24-bit intermediate size", () => {
    const input = font(compressed("RLE expands beyond declared intermediate"));
    expect(
      decompressMtxStreams(input, { maxDecodedBytes: 255 })[0].length,
    ).toBe(255);
    expect(() => decompressMtxStreams(input, { maxDecodedBytes: 254 })).toThrow(
      /output limit/,
    );
  });
  it("accepts shrinking RLE within the final-output budget", () => {
    const input = font(compressed("RLE shrinks below intermediate"));
    expect(decompressMtxStreams(input, { maxDecodedBytes: 20 })[0]).toEqual(
      new Uint8Array(20).fill(42),
    );
    expect(() => decompressMtxStreams(input, { maxDecodedBytes: 19 })).toThrow(
      /output limit/,
    );
  });
  it("rejects excessive intermediate length before reading symbols", () => {
    const block = new Uint8Array([0x7f, 0xff, 0xff, 0x80]);
    expect(() =>
      decompressMtxStreams(font(block), { maxDecodedBytes: 1024 }),
    ).toThrow(/output limit/);
    block[0] |= 0x80;
    expect(() =>
      decompressMtxStreams(font(block), { maxDecodedBytes: 1024 }),
    ).toThrow(/output limit/);
  });
});
