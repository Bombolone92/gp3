import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Assets } from "../src/model/assets";
import { indexPatternAssets } from "../src/model/pattern-assets";
import { decodePsdPattern, indexPsdPatterns } from "../src/model/psd-patterns";
import {
  encodePsdMetadata,
  psdMetadataMimeType,
  type PsdTag,
} from "../src/model/psd-metadata";

function fixture(name: string) {
  return new Uint8Array(
    readFileSync(new URL(`fixtures/psd-patterns/${name}.bin`, import.meta.url)),
  );
}
function metadata(tags: PsdTag[]) {
  return new Uint8Array(
    encodePsdMetadata({ globalMask: new Uint8Array([3, 7, 11]), tags }),
  );
}
function blob(tags: PsdTag[]) {
  return new Blob([metadata(tags)], { type: psdMetadataMimeType });
}
function alteredRecord() {
  const raw = fixture("rgb-8-0"),
    [record] = indexPsdPatterns(raw);
  record.channels[0].data![0] = 17;
  return raw;
}

describe("immutable embedded pattern assets", () => {
  it("locates records by ID across all resource keys and preserves typed-array offsets", () => {
    const records = ["rgb-8-1", "rgb-16-2", "rgb-32-3"].map(fixture),
      bytes = metadata([
        { key: "misc", data: new Uint8Array([7, 9, 11]) },
        ...records.map((data, i) => ({
          key: ["Patt", "Pat2", "Pat3"][i],
          data,
        })),
      ]),
      backing = new Uint8Array(bytes.length + 37);
    backing.set(bytes, 19);
    const view = backing.subarray(19, 19 + bytes.length),
      before = backing.slice(),
      index = indexPatternAssets(view);
    expect(index.size).toBe(3);
    records.forEach((raw) => {
      const [record] = indexPsdPatterns(raw),
        span = index.get(record.id)!;
      expect(view.slice(span.start, span.end)).toEqual(raw);
      expect(Object.keys(span)).toEqual(["start", "end"]);
    });
    expect(backing).toEqual(before);
  });

  it("decodes selected native tiles repeatedly without retaining mutable pixel or record buffers", async () => {
    const assets = new Assets(),
      names = ["rgb-8-1", "rgb-16-2", "rgb-32-3", "gray", "indexed"];
    const id = await assets.add(
      blob(
        names.map((name, i) => ({
          key: ["Patt", "Pat2", "Pat3"][i % 3],
          data: fixture(name),
        })),
      ),
    );
    try {
      for (const name of names) {
        const raw = fixture(name),
          expected = decodePsdPattern(indexPsdPatterns(raw)[0]),
          record = await assets.patternResource(id, name),
          actual = await assets.pattern(id, name);
        expect(record.raw).toEqual(raw);
        expect(actual.data.constructor).toBe(expected.data.constructor);
        expect(actual.width).toBe(expected.width);
        expect(actual.height).toBe(expected.height);
        expect(
          Array.from(actual.data).every((v, i) =>
            Object.is(v, expected.data[i]),
          ),
        ).toBe(true);
        actual.data.fill(123);
        record.raw.fill(0);
        expect((await assets.patternResource(id, name)).raw).toEqual(raw);
        expect(
          Array.from((await assets.pattern(id, name)).data).every((v, i) =>
            Object.is(v, expected.data[i]),
          ),
        ).toBe(true);
      }
    } finally {
      assets.clear();
    }
  });

  it("shares the header index for concurrent and repeated requests, then reads only selected records", async () => {
    const assets = new Assets(),
      bytes = blob([
        { key: "Patt", data: fixture("rgb-8-0") },
        { key: "Pat3", data: fixture("rgb-32-3") },
      ]),
      id = await assets.add(bytes),
      read = vi.spyOn(bytes, "arrayBuffer");
    try {
      const [a, b] = await Promise.all([
        assets.patternResource(id, "rgb-8-0"),
        assets.patternResource(id, "rgb-32-3"),
      ]);
      expect(a.id).toBe("rgb-8-0");
      expect(b.id).toBe("rgb-32-3");
      await assets.pattern(id, "rgb-8-0");
      await assets.pattern(id, "rgb-32-3");
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      read.mockRestore();
      assets.clear();
    }
  });

  it("accepts identical duplicate definitions and rejects conflicting IDs without choosing a tile", async () => {
    const assets = new Assets(),
      raw = fixture("rgb-8-0"),
      conflict = alteredRecord(),
      good = await assets.add(
        blob(["Patt", "Pat2", "Pat3"].map((key) => ({ key, data: raw }))),
      ),
      bad = await assets.add(
        blob([
          { key: "Patt", data: raw },
          { key: "Pat2", data: conflict },
          { key: "Pat3", data: raw },
        ]),
      );
    try {
      expect((await assets.patternResource(good, "rgb-8-0")).raw).toEqual(raw);
      await expect(assets.patternResource(bad, "rgb-8-0")).rejects.toThrow(
        "Ambiguous",
      );
      await expect(assets.pattern(bad, "rgb-8-0")).rejects.toThrow("Ambiguous");
      expect(new Uint8Array(await assets.blob(bad).arrayBuffer())).toEqual(
        metadata([
          { key: "Patt", data: raw },
          { key: "Pat2", data: conflict },
          { key: "Pat3", data: raw },
        ]),
      );
    } finally {
      assets.clear();
    }
  });

  it("reports missing IDs, wrong asset types and malformed blocks while retaining opaque metadata", async () => {
    const assets = new Assets(),
      empty = await assets.add(blob([])),
      truncated = fixture("rgb-8-0").slice(0, -1),
      malformed = await assets.add(blob([{ key: "Patt", data: truncated }])),
      raster = await assets.addRaster({
        width: 1,
        height: 1,
        data: new Uint16Array([0, 0, 0, 65535]),
      });
    try {
      await expect(assets.patternResource(empty, "absent")).rejects.toThrow(
        "Missing embedded",
      );
      await expect(assets.patternResource("absent", "absent")).rejects.toThrow(
        "Missing image asset",
      );
      await expect(assets.patternResource(raster, "absent")).rejects.toThrow(
        "Invalid pattern metadata",
      );
      await expect(
        assets.patternResource(malformed, "rgb-8-0"),
      ).rejects.toThrow("Truncated");
      expect(
        new Uint8Array(await assets.blob(malformed).arrayBuffer()),
      ).toEqual(metadata([{ key: "Patt", data: truncated }]));
    } finally {
      assets.clear();
    }
  });

  it("budgets selected raw bytes and decoder scratch memory before allocating pixels", async () => {
    const assets = new Assets(),
      raw = fixture("rgb-16-0"),
      id = await assets.add(blob([{ key: "Patt", data: raw }]));
    try {
      for (const budget of [0, -1, NaN, Infinity])
        await expect(assets.pattern(id, "rgb-16-0", budget)).rejects.toThrow(
          "byte budget",
        );
      await expect(
        assets.pattern(id, "rgb-16-0", raw.length - 1),
      ).rejects.toThrow("record exceeds");
      // Six RGBA pixels need 48 bytes, plus two native six-sample planes (24).
      await expect(
        assets.pattern(id, "rgb-16-0", raw.length + 71),
      ).rejects.toThrow("decoded pixel budget");
      expect(
        (await assets.pattern(id, "rgb-16-0", raw.length + 72)).data,
      ).toHaveLength(24);
    } finally {
      assets.clear();
    }
  });

  it("indexes unused oversized and unsupported resources without decoding them", async () => {
    const huge = fixture("rgb-8-0"),
      [source] = indexPsdPatterns(huge),
      colorCountAt =
        source.channels[0].data!.byteOffset - huge.byteOffset - 23 - 8 - 4,
      view = new DataView(huge.buffer),
      unsupported = fixture("rgb-16-0");
    view.setUint32(colorCountAt - 8, 100000);
    view.setUint32(colorCountAt - 4, 100000);
    new DataView(unsupported.buffer).setUint32(8, 4); // CMYK retained opaquely.
    const assets = new Assets(),
      id = await assets.add(
        blob([
          { key: "Patt", data: huge },
          { key: "Pat2", data: unsupported },
          { key: "Pat3", data: fixture("rgb-32-3") },
        ]),
      );
    try {
      expect((await assets.pattern(id, "rgb-32-3")).data).toBeInstanceOf(
        Float32Array,
      );
      expect((await assets.patternResource(id, "rgb-8-0")).raw).toEqual(huge);
      expect((await assets.patternResource(id, "rgb-16-0")).raw).toEqual(
        unsupported,
      );
      await expect(assets.pattern(id, "rgb-8-0")).rejects.toThrow("dimensions");
      await expect(assets.pattern(id, "rgb-16-0")).rejects.toThrow(
        "color mode",
      );
    } finally {
      assets.clear();
    }
  });

  it("bounds aggregate channel indexing across separate metadata blocks", () => {
    const raw = fixture("rgb-8-0"),
      tags = Array.from({ length: 10000 }, (_, i) => ({
        key: ["Patt", "Pat2", "Pat3"][i % 3],
        data: raw,
      }));
    expect(() => indexPatternAssets(metadata(tags))).toThrow("index budget");
  });

  it("invalidates pending lookups when assets are cleared and IDs are reused", async () => {
    const assets = new Assets(),
      old = blob([{ key: "Patt", data: fixture("rgb-8-0") }]),
      id = await assets.add(old, "same-id"),
      buffer = await old.arrayBuffer();
    let release!: (bytes: ArrayBuffer) => void, started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const read = vi.spyOn(old, "arrayBuffer").mockImplementation(() => {
      started();
      return new Promise<ArrayBuffer>((resolve) => {
        release = resolve;
      });
    });
    const pending = assets.patternResource(id, "rgb-8-0");
    const rejected = expect(pending).rejects.toThrow("was cleared");
    await ready;
    assets.clear();
    await assets.add(blob([{ key: "Patt", data: fixture("rgb-32-3") }]), id);
    release(buffer);
    await rejected;
    read.mockRestore();
    try {
      await expect(assets.patternResource(id, "rgb-8-0")).rejects.toThrow(
        "Missing embedded",
      );
      expect((await assets.patternResource(id, "rgb-32-3")).id).toBe(
        "rgb-32-3",
      );
    } finally {
      assets.clear();
    }
  });
});
