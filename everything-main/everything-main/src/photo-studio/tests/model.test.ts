import { describe, it, expect } from "vitest";
import {
  allLayers,
  containerOf,
  cropDocument,
  findLayer,
  layer,
  localPoint,
  newDocument,
  normalizedRect,
  resizeDocument,
} from "../src/model/document";
import { History } from "../src/history/history";
import {
  validateDocument,
  serialize,
  deserialize,
} from "../src/model/serialization";
import { Assets } from "../src/model/assets";
import { uniforms } from "../src/renderer/renderer";
import { canSignOut } from "../src/persistence/puter";
describe("document and layers", () => {
  it("rejects unsupported sizes", () => {
    expect(() => newDocument(0, 100)).toThrow();
    expect(() => newDocument(8000, 8000)).toThrow();
    expect(() => newDocument(1.5, 20)).toThrow();
  });
  it("finds nested layers and owning containers", () => {
    const d = newDocument(),
      g = layer("group", "Group", 100, 100),
      l = layer("image", "Photo", 100, 100);
    g.children.push(l);
    d.layers.push(g);
    expect(findLayer(d.layers, l.id)).toBe(l);
    expect(containerOf(d.layers, l.id)).toBe(g.children);
    expect(allLayers(d.layers)).toHaveLength(2);
  });
  it("resizes geometry without modifying source dimensions", () => {
    const d = newDocument(400, 300),
      l = layer("paint", "Brush", 400, 300);
    l.transform.x = 10;
    l.mask = { x: 10, y: 20, width: 30, height: 40 };
    d.layers.push(l);
    resizeDocument(d, 800, 600);
    expect(l.transform.x).toBe(20);
    expect(l.transform.width).toBe(800);
    expect(l.sourceWidth).toBe(400);
    expect(l.mask.width).toBe(60);
  });
  it("crops nested layers once and preserves source pixels", () => {
    const d = newDocument(400, 300),
      g = layer("group", "G", 400, 300),
      l = layer("image", "Photo", 400, 300);
    g.children.push(l);
    d.layers.push(g);
    cropDocument(d, { x: 25, y: 40, width: 150, height: 100 });
    expect(d.width).toBe(150);
    expect(l.transform.x).toBe(-25);
    expect(l.transform.y).toBe(-40);
    expect(l.sourceWidth).toBe(400);
  });
  it("normalizes and clips reverse selections", () => {
    expect(normalizedRect([120, 110], [-10, 20], 100, 100)).toEqual({
      x: 0,
      y: 20,
      width: 100,
      height: 80,
    });
  });
  it("maps rotated and scaled points to source UV", () => {
    expect(
      localPoint({ x: 10, y: 20, width: 100, height: 50, rotation: 0 }, 60, 45),
    ).toEqual([0.5, 0.5]);
    const p = localPoint(
      { x: 0, y: 0, width: 100, height: 100, rotation: 90 },
      100,
      50,
    );
    expect(p[0]).toBeCloseTo(0.5);
    expect(p[1]).toBeCloseTo(0);
  });
});
describe("command history", () => {
  it("undoes and redoes layer edits without mutating prior states", () => {
    const d = newDocument(),
      h = new History(d);
    h.execute("Add", (doc) =>
      doc.layers.push(layer("solid", "Fill", 100, 100)),
    );
    const id = h.document.layers[0].id;
    h.execute("Opacity", (doc) => (findLayer(doc.layers, id)!.opacity = 0.5));
    expect(d.layers).toHaveLength(0);
    h.undo();
    expect(h.document.layers[0].opacity).toBe(1);
    h.redo();
    expect(h.document.layers[0].opacity).toBe(0.5);
  });
  it("invalidates redo on divergent editing", () => {
    const h = new History(newDocument());
    h.execute("Name", (d) => (d.name = "A"));
    h.undo();
    h.execute("Name", (d) => (d.name = "B"));
    expect(h.canRedo).toBe(false);
  });
  it("does not record no-ops or commit a failed command", () => {
    const h = new History(newDocument());
    h.execute("Noop", () => {});
    expect(h.canUndo).toBe(false);
    expect(() =>
      h.execute("Fail", (d) => {
        d.name = "bad";
        throw new Error("fail");
      }),
    ).toThrow();
    expect(h.document.name).toBe("Untitled");
  });
  it("bounds history length", () => {
    const h = new History(newDocument(), 2);
    for (let i = 0; i < 4; i++) h.execute("Name", (d) => (d.name = String(i)));
    expect(h.labels).toHaveLength(2);
  });
});
describe("serialization", () => {
  it('validates and preserves asset color-space provenance', async () => {
    const doc = newDocument(2,2), source = layer('image','Source',2,2);
    doc.layers.push(source);
    for (const value of ['lab',8,null,{}]) {
      source.assetColorSpace = value as 'document';
      expect(() => validateDocument(doc)).toThrow('source color space');
    }
    for (const value of [undefined,'document','srgb'] as const) {
      source.assetColorSpace = value;
      const restored = await deserialize(await serialize(doc,new Assets()));
      expect(restored.document.layers[0].assetColorSpace).toBe(value);
    }
  });
  it('validates opaque ICC metadata while keeping projects without a profile valid', () => {
    const doc = newDocument();
    for (const value of ['', 'bad', '====', 'A===', 4, null]) {
      doc.iccProfile = value as string;
      expect(() => validateDocument(doc)).toThrow('ICC profile');
    }
    doc.iccProfile = 'AQID';
    doc.iccUntaggedProfile = 'true' as unknown as boolean;
    expect(() => validateDocument(doc)).toThrow('untagged');
    doc.iccUntaggedProfile = false;
    expect(() => validateDocument(doc)).not.toThrow();
  });
  it("preserves resolution through projects, cropping, resampling and history", async () => {
    const doc = newDocument(40, 30);
    doc.resolution = {
      horizontalResolution: 237.125,
      horizontalResolutionUnit: "PPI",
      widthUnit: "Centimeters",
      verticalResolution: 118.0625,
      verticalResolutionUnit: "PPCM",
      heightUnit: "Points",
    };
    const h = new History(doc);
    h.execute("Crop", (d) =>
      cropDocument(d, { x: 2, y: 3, width: 20, height: 10 }),
    );
    h.execute("Resize", (d) => resizeDocument(d, 80, 40));
    const saved = await deserialize(await serialize(h.document, new Assets()));
    expect(saved.document.resolution).toEqual(doc.resolution);
    h.undo();
    expect(h.document.resolution).toEqual(doc.resolution);
    // Older/native projects need not specify a print density.
    expect(validateDocument(newDocument()).resolution).toBeUndefined();
  });
  it("rejects invalid resolution metadata before encoding", () => {
    const doc = newDocument();
    const resolution = {
      horizontalResolution: 72,
      horizontalResolutionUnit: "PPI" as const,
      widthUnit: "Inches" as const,
      verticalResolution: 72,
      verticalResolutionUnit: "PPI" as const,
      heightUnit: "Inches" as const,
    };
    for (const value of [NaN, Infinity, -1, 0, 32768]) {
      doc.resolution = { ...resolution, horizontalResolution: value };
      expect(() => validateDocument(doc)).toThrow("resolution");
    }
    doc.resolution = { ...resolution, widthUnit: "Pixels" as "Inches" };
    expect(() => validateDocument(doc)).toThrow("resolution");
  });
  it("round trips editable metadata and hierarchy", async () => {
    const d = newDocument(),
      g = layer("group", "Group", 1600, 1000);
    g.children.push(layer("text", "Title", 1600, 1000));
    d.layers.push(g);
    const result = await deserialize(await serialize(d, new Assets()));
    expect(result.document).toEqual(d);
  });
  it("rejects invalid headers and truncated metadata", async () => {
    await expect(deserialize(new Blob(["invalid"]))).rejects.toThrow();
    const b = await serialize(newDocument(), new Assets());
    await expect(deserialize(b.slice(0, 15))).rejects.toThrow();
  });
  it("rejects duplicate IDs and nonfinite transforms", () => {
    const d = newDocument(),
      l = layer("solid", "Fill", 100, 100);
    d.layers = [l, structuredClone(l)];
    expect(() => validateDocument(d)).toThrow();
    d.layers = [l];
    l.transform.x = Infinity;
    expect(() => validateDocument(d)).toThrow();
  });
});
describe("rendering calculations", () => {
  it("packs blend, transform, opacity, filters and mask consistently", () => {
    const l = layer("image", "A", 800, 600);
    l.blend = "multiply";
    l.opacity = 0.5;
    l.transform.rotation = 90;
    l.filters.brightness = 25;
    l.mask = { x: 1, y: 2, width: 3, height: 4 };
    const u = uniforms(l, 1600, 1000, 800, 600);
    expect(u[8]).toBeCloseTo(0);
    expect(u[9]).toBeCloseTo(1);
    expect(u[10]).toBe(0.5);
    expect(u[11]).toBe(3);
    expect(u[12]).toBe(0.25);
    expect(Array.from(u.slice(16, 20))).toEqual([1, 2, 3, 4]);
    expect(u[20]).toBe(1);
  });
  it("never offers sign out inside Puter app", () => {
    expect(canSignOut("app")).toBe(false);
    expect(canSignOut("web")).toBe(true);
  });
});
