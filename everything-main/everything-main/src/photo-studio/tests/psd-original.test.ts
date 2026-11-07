import { describe, expect, it, vi } from "vitest";
import { Assets } from "../src/model/assets";
import { layer, newDocument } from "../src/model/document";
import { History } from "../src/history/history";
import { savePsd } from "../src/model/psd";
import {
  deserialize,
  serialize,
  validateDocument,
} from "../src/model/serialization";
import {
  encodePsdMetadata,
  psdMetadataMimeType,
} from "../src/model/psd-metadata";
import {
  psdOriginalMimeType,
  psdPreviewFingerprint,
  readOriginalPsd,
  validateOriginalPsd,
} from "../src/model/psd-original";

// Independent empty-layer RGB container, with actual RAW composite planes.
function original(version = 1, depth = 8) {
  const start = version === 2 ? 44 : 40;
  const bytes = new Uint8Array(start + (6 * 3 * depth) / 8);
  bytes.set(new TextEncoder().encode("8BPS"));
  const view = new DataView(bytes.buffer);
  view.setUint16(4, version);
  view.setUint16(12, 3);
  view.setUint32(14, 2);
  view.setUint32(18, 3);
  view.setUint16(22, depth);
  view.setUint16(24, 3);
  return new Blob([bytes], { type: psdOriginalMimeType });
}

async function retainOriginal(
  doc: ReturnType<typeof newDocument>,
  asset: string,
) {
  doc.psdOriginal = { asset, previewFingerprint: "" };
  doc.psdOriginal.previewFingerprint = await psdPreviewFingerprint(doc);
}

describe("opaque original PSD files", () => {
  it("retains PSD/PSB at every depth without decoding it as an image", async () => {
    for (const version of [1, 2])
      for (const depth of [8, 16, 32]) {
        const assets = new Assets(),
          blob = original(version, depth);
        const asset = await assets.add(blob);
        expect(assets.blob(asset)).toBe(blob);
        expect(() => assets.get(asset)).toThrow("Missing image");
        expect(await validateOriginalPsd(blob)).toBe(
          version === 2 ? "psb" : "psd",
        );
        const doc = newDocument(3, 2);
        await retainOriginal(doc, asset);
        const project = await deserialize(await serialize(doc, assets));
        expect(project.document.psdOriginal).toEqual(doc.psdOriginal);
        expect(await project.assets.blob(asset).arrayBuffer()).toEqual(
          await blob.arrayBuffer(),
        );
        const render = vi.fn(async () => new Uint8Array()),
          source = vi.fn();
        const exported = await savePsd(project.document, render, source, (id) =>
          project.assets.blob(id),
        );
        expect(await exported.arrayBuffer()).toEqual(await blob.arrayBuffer());
        expect(exported.type).toBe("image/vnd.adobe.photoshop");
        expect(render).not.toHaveBeenCalled();
        expect(source).not.toHaveBeenCalled();
        await expect(savePsd(doc, render)).rejects.toThrow(
          "original PSD asset",
        );
        assets.clear();
        project.assets.clear();
      }
  });

  it("rejects wrong types, truncated top-level sections and unsafe PSB lengths", async () => {
    const blob = original();
    await expect(
      validateOriginalPsd(blob.slice(0, blob.size, "image/png")),
    ).rejects.toThrow("original PSD asset");
    for (const end of [0, 25, 26, 29, 33, 37, 39])
      await expect(
        new Assets().add(blob.slice(0, end, psdOriginalMimeType)),
      ).rejects.toThrow();
    for (const offset of [26, 30, 34]) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      new DataView(bytes.buffer).setUint32(offset, 0xffffffff);
      await expect(
        validateOriginalPsd(new Blob([bytes], { type: psdOriginalMimeType })),
      ).rejects.toThrow("section");
    }
    const bytes = new Uint8Array(await original(2).arrayBuffer());
    new DataView(bytes.buffer).setBigUint64(34, 0xffffffffffffffffn);
    await expect(
      validateOriginalPsd(new Blob([bytes], { type: psdOriginalMimeType })),
    ).rejects.toThrow("section");
    const compressed = new Uint8Array(await blob.arrayBuffer());
    new DataView(compressed.buffer).setUint16(38, 4);
    await expect(
      validateOriginalPsd(
        new Blob([compressed], { type: psdOriginalMimeType }),
      ),
    ).rejects.toThrow("composite stream");
  });

  it("validates native references and prevents source assets being used as images", async () => {
    const doc = newDocument(3, 2),
      assets = new Assets();
    const asset = await assets.add(original());
    const fingerprint = await psdPreviewFingerprint(doc);
    for (const reference of [
      null,
      {},
      { asset: "", previewFingerprint: fingerprint },
      { asset, previewFingerprint: "0".repeat(63) },
      { asset, previewFingerprint: 1 },
    ]) {
      doc.psdOriginal = reference as typeof doc.psdOriginal;
      expect(() => validateDocument(doc)).toThrow("original PSD reference");
    }
    doc.psdOriginal = { asset: "missing", previewFingerprint: fingerprint };
    await expect(readOriginalPsd(doc, (id) => assets.blob(id))).rejects.toThrow(
      "Missing image asset",
    );
    const metadata = await assets.add(
      new Blob(
        [encodePsdMetadata({ globalMask: new Uint8Array(), tags: [] })],
        { type: psdMetadataMimeType },
      ),
    );
    doc.psdOriginal.asset = metadata;
    await expect(deserialize(await serialize(doc, assets))).rejects.toThrow(
      "original PSD asset type",
    );
    doc.psdOriginal.asset = asset;
    const l = layer("image", "Invalid source", 3, 2);
    l.asset = asset;
    doc.layers.push(l);
    await expect(deserialize(await serialize(doc, assets))).rejects.toThrow(
      "Missing image asset",
    );
    assets.clear();
  });

  it("detects preview and metadata edits while tolerating selections, filenames and JSON key ordering", async () => {
    const doc = newDocument(3, 2),
      l = layer("image", "Preview", 3, 2);
    l.asset = "preview";
    doc.layers.push(l);
    await retainOriginal(doc, "original");
    const fingerprint = await psdPreviewFingerprint(doc);
    doc.name = "Renamed";
    doc.selection = { x: 0, y: 0, width: 1, height: 1 };
    expect(await psdPreviewFingerprint(doc)).toBe(fingerprint);
    const reordered = JSON.parse(
      JSON.stringify(doc, (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).reverse())
          : value,
      ),
    );
    expect(await psdPreviewFingerprint(reordered)).toBe(fingerprint);
    const mutations = [
      (d) => (d.psdOriginal!.asset = "another original"),
      (d) => d.width++,
      (d) => (d.bitsPerChannel = 16),
      (d) => (d.iccUntaggedProfile = true),
      (d) => (d.psdResourcesAsset = "new resources"),
      (d) => (d.psdMetadataAsset = "new metadata"),
      (d) => (d.layers[0].name = "Renamed layer"),
      (d) => (d.layers[0].opacity = 0.5),
      (d) => (d.layers[0].visible = false),
      (d) => (d.layers[0].locked = true),
      (d) => (d.layers[0].asset = "edited pixels"),
      (d) => (d.layers[0].transform.x += 0.125),
      (d) => (d.layers[0].filters.brightness = 20),
      (d) => (d.layers[0].mask = { x: 0, y: 0, width: 1, height: 1 }),
      (d) => d.layers.push(layer("solid", "Added", 3, 2)),
      (d) => d.layers.splice(0),
    ] satisfies Array<(d: typeof doc) => void>;
    for (const mutate of mutations) {
      const changed = structuredClone(doc);
      mutate(changed);
      expect(await psdPreviewFingerprint(changed)).not.toBe(fingerprint);
      await expect(
        savePsd(changed, async () => new Uint8Array()),
      ).rejects.toThrow("preview has been edited");
    }
  });

  it("keeps edited preview history and original recovery independent, including undo and native reopen", async () => {
    const doc = newDocument(3, 2),
      assets = new Assets(),
      blob = original(2, 32);
    const asset = await assets.add(blob);
    await retainOriginal(doc, asset);
    const history = new History(doc),
      render = vi.fn(async () => new Uint8Array());
    history.execute("Add layer", (d) =>
      d.layers.push(layer("solid", "Edit", 3, 2)),
    );
    await expect(
      savePsd(history.document, render, undefined, (id) => assets.blob(id)),
    ).rejects.toThrow("preview has been edited");
    const project = await deserialize(
      await serialize(history.document, assets),
    );
    expect(project.document.layers[0].name).toBe("Edit");
    const recovered = await readOriginalPsd(project.document, (id) =>
      project.assets.blob(id),
    );
    expect(recovered.extension).toBe("psb");
    expect(await recovered.blob.arrayBuffer()).toEqual(
      await blob.arrayBuffer(),
    );
    history.undo();
    const restored = await savePsd(history.document, render, undefined, (id) =>
      assets.blob(id),
    );
    expect(await restored.arrayBuffer()).toEqual(await blob.arrayBuffer());
    history.redo();
    await expect(savePsd(history.document, render)).rejects.toThrow(
      "preview has been edited",
    );
    expect(render).not.toHaveBeenCalled();
    assets.clear();
    project.assets.clear();
  });

  it("rejects a retargeted original reference even when its asset is valid and the preview is unchanged", async () => {
    const doc = newDocument(3, 2),
      assets = new Assets();
    await retainOriginal(doc, await assets.add(original(1, 8)));
    doc.psdOriginal!.asset = await assets.add(original(2, 32));
    const project = await deserialize(await serialize(doc, assets));
    const render = vi.fn(async () => new Uint8Array());
    await expect(
      savePsd(project.document, render, undefined, (id) =>
        project.assets.blob(id),
      ),
    ).rejects.toThrow("preview has been edited");
    expect(render).not.toHaveBeenCalled();
    assets.clear();
    project.assets.clear();
  });

  it("rejects a native bundle exceeding the reader budget before building an unreadable file", async () => {
    class OversizedBlob extends Blob {
      override get size() {
        return 512 * 1024 * 1024;
      }
    }
    const doc = newDocument(3, 2);
    doc.psdOriginal = { asset: "original", previewFingerprint: "0".repeat(64) };
    await expect(
      serialize(doc, { blob: () => new OversizedBlob() } as unknown as Assets),
    ).rejects.toThrow("512 MB");
  });
});
