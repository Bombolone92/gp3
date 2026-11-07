import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { OpcPackage } from "../lib/pptx/src/internal/parts/index.ts";
import { copyPartGraph } from "../lib/pptx/src/internal/parts/copy-graph.ts";
import { resolveTarget } from "../lib/pptx/src/internal/opc/index.ts";
const put = (pkg, name, text = name, type = "application/xml") =>
  pkg.addPart(name, type, new TextEncoder().encode(text));
const rel = (id, target, targetMode = "Internal") => ({
  id,
  target,
  targetMode,
  type: "urn:test-dependency",
});

describe("OPC dependency graph copying", () => {
  it("preserves sharing, cycles, mixed-case targets, external URLs and content types", () => {
    const s = OpcPackage.empty(),
      t = OpcPackage.empty();
    put(s, "/source/a.xml");
    put(s, "/source/b.xml");
    put(s, "/source/shared.bin", "binary", "application/custom");
    s.setRels("/source/a.xml", {
      items: [
        rel("b", "B.XML"),
        rel("shared", "shared.bin"),
        rel("url", "https://example.com/a#b", "External"),
      ],
    });
    s.setRels("/source/b.xml", {
      items: [rel("a", "../source/a.xml"), rel("shared", "SHARED.BIN")],
    });
    put(t, "/SOURCE/A.XML", "keep");
    put(t, "/source/a_copy1.xml", "keep suffix");
    const before = unzipSync(s.save()),
      names = copyPartGraph(s, t, ["/source/a.xml", "/SOURCE/B.XML"]);
    expect(names.size).toBe(3);
    expect(names.get("/source/a.xml")).toBe("/source/a_copy2.xml");
    for (const name of ["/source/a.xml", "/source/b.xml"]) {
      const copied = names.get(name),
        refs = t.getRels(copied).items;
      for (const r of refs.filter((r) => r.targetMode === "Internal"))
        expect(t.getPart(resolveTarget(copied, r.target))).not.toBeNull();
      expect(refs.find((r) => r.id === "shared").target).toBe(
        names.get("/source/shared.bin"),
      );
    }
    expect(
      t.getRels(names.get("/source/a.xml")).items.find((r) => r.id === "url")
        .target,
    ).toBe("https://example.com/a#b");
    const reopened = OpcPackage.load(t.save());
    expect(reopened.getPart(names.get("/source/shared.bin")).contentType).toBe(
      "application/custom",
    );
    expect(unzipSync(s.save())).toEqual(before);
    expect(t.getPart(names.get("/source/shared.bin")).data).not.toBe(
      s.getPart("/source/shared.bin").data,
    );
  });
  it("reserves source filenames and orphan relationship filenames before allocating collision names", () => {
    const s = OpcPackage.empty(),
      t = OpcPackage.empty();
    put(s, "/a.xml");
    put(s, "/a_copy1.xml");
    put(t, "/a.xml");
    t.setRels("/a_copy2.xml", { items: [] });
    const names = copyPartGraph(s, t, ["/a.xml", "/a_copy1.xml"]);
    expect(names.get("/a.xml")).toBe("/a_copy3.xml");
    expect(names.get("/a_copy1.xml")).toBe("/a_copy1.xml");
  });
  it("rejects a missing dependency without mutating the destination", () => {
    const s = OpcPackage.empty(),
      t = OpcPackage.empty();
    put(s, "/a.xml");
    s.setRels("/a.xml", { items: [rel("missing", "no-such-part.xml")] });
    const before = unzipSync(t.save());
    expect(() => copyPartGraph(s, t, ["/a.xml"])).toThrow(
      "missing dependency /no-such-part.xml",
    );
    expect(unzipSync(t.save())).toEqual(before);
  });
  it("takes an independent snapshot when copying a graph into its own package", () => {
    const p = OpcPackage.empty();
    put(p, "/data.xml");
    put(p, "/image");
    p.setRels("/data.xml", { items: [rel("image", "image")] });
    const names = copyPartGraph(p, p, ["/data.xml"]),
      copied = p.getPart(names.get("/data.xml"));
    expect(names.get("/image")).toBe("/image_copy1");
    copied.data[0] = 0;
    expect(p.getPart("/data.xml").data[0]).not.toBe(0);
    expect(p.getRels(copied.name).items[0].id).toBe("image");
  });
});

it("reserves dangling root and part relationships without rebinding unrelated old content", () => {
  const source = OpcPackage.empty(),
    target = OpcPackage.empty();
  put(source, "/data.bin", "new");
  put(source, "/external.bin", "external name");
  target.setRels("/", { items: [rel("missing", "DATA.BIN")] });
  target.setRels("/absent/owner.xml", {
    items: [
      rel("missing", "../data_copy1.bin"),
      rel("url", "/external.bin", "External"),
    ],
  });
  const beforeRoot = target.getPart("/_rels/.rels").data,
    beforeOwner = target.getPart("/absent/_rels/owner.xml.rels").data;
  const names = copyPartGraph(source, target, ["/data.bin", "/external.bin"]);
  expect(names.get("/data.bin")).toBe("/data_copy2.bin");
  expect(names.get("/external.bin")).toBe("/external.bin");
  expect(target.getPart("/data.bin")).toBeNull();
  expect(target.getPart("/data_copy1.bin")).toBeNull();
  expect(target.getPart("/_rels/.rels").data).toBe(beforeRoot);
  expect(target.getPart("/absent/_rels/owner.xml.rels").data).toBe(beforeOwner);
});
