import { describe, it, expect, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { P, createDeck, preview } from "../src/model.js";
import {
  chartRoot,
  chartGraph,
  workbook,
  chartWorkbookBindingDeck,
} from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import {
  resolveTarget,
  partName,
  relsPartNameFor,
} from "../lib/pptx/src/internal/opc/index.ts";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";
import { buildEmbeddedXlsx } from "../lib/pptx/src/internal/chartml/embedded-xlsx.ts";
const child = (e, n) => firstChildElement(e, qname("c", n, NS.chart));
const attribute = (e, n, ns = "") => getAttrValue(e, qname("", n, ns));
const snapshot = (p) => ({
  parts: P._internalPackageOf(p).parts.map((x) => [
    x.name,
    x.contentType,
    x.data.slice(),
  ]),
  types: structuredClone(P._internalPackageOf(p).contentTypes),
});
function binding(p, shape) {
  const pkg = P._internalPackageOf(p),
    owner = chartRoot(shape),
    root = parseXml(new TextDecoder().decode(pkg.getPart(owner).data)).root,
    external = child(root, "externalData"),
    id = external && attribute(external, "id", NS.officeDocRels),
    rel = pkg.getRels(owner)?.items.find((r) => r.id === id);
  return {
    pkg,
    owner,
    root,
    external,
    id,
    rel,
    part:
      rel?.targetMode === "Internal"
        ? pkg.getPart(resolveTarget(owner, rel.target))
        : null,
  };
}
function fixture(kind = "bar") {
  const f = chartWorkbookBindingDeck(kind),
    chart = P.getSlideCharts(f.slide)[0];
  return { ...f, shape: chart.shape, chart };
}

function editNative(f, fn) {
  const b = binding(f.p, f.shape);
  fn(b);
  b.pkg.getPart(b.owner).data = new TextEncoder().encode(
    serializeXml({ kind: "document", root: b.root, prolog: [], epilog: [] }),
  );
}
function rename(f, id, absolute = false) {
  editNative(f, (b) => {
    const rels = b.pkg.getRels(b.owner),
      r = rels.items.find((r) => r.id === b.id);
    r.id = id;
    r.target = absolute ? resolveTarget(b.owner, r.target) : r.target;
    b.pkg.setRels(b.owner, rels);
    b.external.attrs = b.external.attrs.map((a) =>
      a.name.namespaceURI === NS.officeDocRels ? { ...a, value: id } : a,
    );
  });
}
function change(f) {
  const c = P.getSlideCharts(f.slide).find((c) => c.shape === f.shape);
  P.setChartSpec(c, {
    ...c.spec,
    categories: ["Delta", "Epsilon", "Zeta"],
    series: [
      {
        ...c.spec.series[0],
        name: "New source",
        values: [31, 47, -13],
        numberFormat: "0.00%",
      },
    ],
  });
}
function assertWorkbook(p, shape) {
  const b = binding(p, shape);
  expect(b.rel?.type).toBe(REL_TYPES.package);
  expect(b.rel.targetMode).toBe("Internal");
  expect(b.part?.contentType).toBe(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  const sheet = strFromU8(unzipSync(b.part.data)["xl/worksheets/sheet1.xml"]);
  expect(sheet).toContain("New source");
  expect(sheet).toContain("<v>31</v>");
  expect(sheet).toContain("Delta");
  const zip = unzipSync(b.part.data),
    rels = parseXml(strFromU8(zip["xl/_rels/workbook.xml.rels"])).root,
    styleRel = rels.children.find(
      (n) =>
        n.kind === "element" &&
        attribute(n, "Type") === NS.officeDocRels + "/styles",
    ),
    stylePart = resolveTarget(
      "/xl/workbook.xml",
      attribute(styleRel, "Target"),
    );
  expect(strFromU8(zip[stylePart.slice(1)])).toContain('formatCode="0.00%"');
  return b;
}
const kinds = ["bar", "column", "line", "area", "pie", "doughnut"];
describe("native chart externalData workbook ownership", () => {
  for (const kind of kinds)
    for (const id of ["rId7", "WorkbookSource", "source_2026"])
      it.each([false, true])(
        `${kind} retains binding ${id}, absolute=%s despite style ID collision and earlier decoy workbook`,
        async (absolute) => {
          const f = fixture(kind);
          rename(f, id, absolute);
          const before = binding(f.p, f.shape),
            book = before.part,
            rels = before.pkg
              .getPart(relsPartNameFor(before.owner))
              .data.slice(),
            opaque = chartGraph(f.p, before.owner)
              .filter((p) => p.name !== before.owner && p !== book)
              .map((p) => [p, p.data.slice()]);
          change(f);
          const b = assertWorkbook(f.p, f.shape);
          expect(b.id).toBe(id);
          expect(b.part).toBe(book);
          expect(
            before.pkg.getPart(relsPartNameFor(before.owner)).data,
          ).toEqual(rels);
          expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([
            31, 47, -13,
          ]);
          for (const [part, bytes] of opaque) expect(part.data).toEqual(bytes);
          const q = await P.loadPresentation(await P.savePresentation(f.p));
          expect(
            assertWorkbook(q, P.getSlideCharts(P.getSlides(q)[0])[0].shape).id,
          ).toBe(id);
          expect(P.validatePresentation(q)).toEqual([]);
        },
      );
  it.each([undefined, "0", "1", "false", "true", null])(
    "preserves native autoUpdate=%j and omission after editing",
    (value) => {
      const f = fixture();
      editNative(f, (b) => {
        if (value === undefined) b.external.children = [];
        else {
          const node = child(b.external, "autoUpdate");
          node.attrs =
            value === null ? [] : [{ name: qname("", "val", ""), value }];
        }
      });
      const before = binding(f.p, f.shape).external.children;
      change(f);
      expect(binding(f.p, f.shape).external.children).toEqual(before);
    },
  );
  it("retains namespace bindings and opaque externalData attributes/options", () => {
    const f = fixture();
    editNative(f, (b) => {
      b.root.prefixDecls.set("source", NS.officeDocRels);
      b.root.prefixDecls.set("future", "urn:owned:source-metadata");
      b.external.attrs = [
        { name: qname("source", "id", NS.officeDocRels), value: b.id },
        {
          name: qname("future", "kind", "urn:owned:source-metadata"),
          value: "future:local",
        },
      ];
    });
    change(f);
    const b = assertWorkbook(f.p, f.shape);
    expect(attribute(b.external, "kind", "urn:owned:source-metadata")).toBe(
      "future:local",
    );
    expect(b.external.prefixDecls.get("future")).toBe(
      "urn:owned:source-metadata",
    );
    expect(b.id).toBe("rId7");
  });
  it.each([true, false])(
    "retains linked external workbook and update options, absolute URI=%s",
    (absolute) => {
      const f = fixture(),
        b = binding(f.p, f.shape),
        rels = b.pkg.getRels(b.owner),
        rel = rels.items.find((r) => r.id === b.id),
        uri = absolute
          ? "https://example.com/source.xlsx"
          : "../external/source.xlsx";
      rel.target = uri;
      rel.targetMode = "External";
      b.pkg.setRels(b.owner, rels);
      const before = snapshot(f.p),
        old = binding(f.p, f.shape).external;
      change(f);
      const after = binding(f.p, f.shape);
      expect(after.rel).toEqual(rel);
      expect(after.part).toBeNull();
      expect(after.external.children).toEqual(old.children);
      expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([
        31, 47, -13,
      ]);
      for (const [name, _, bytes] of before.parts.filter(
        ([name]) => name !== b.owner,
      ))
        expect(b.pkg.getPart(name).data).toEqual(bytes);
      expect(P.validatePresentation(f.p)).toEqual([]);
    },
  );
  for (const removeRels of [false, true])
    it(`authors a backing XLSX for a cached-only chart, no rels=${removeRels}, preserving occupied names`, () => {
      const f = fixture(),
        b = binding(f.p, f.shape),
        old = b.part.data.slice();
      editNative(f, (b) => {
        b.root.children = b.root.children.filter((e) => e !== b.external);
      });
      if (removeRels) b.pkg.removePart(relsPartNameFor(b.owner));
      const occupied = "/PPT/EMBEDDINGS/MICROSOFT_EXCEL_WORKSHEET3.XLSX";
      b.pkg.addPart(
        partName(occupied),
        b.part.contentType,
        new Uint8Array([19, 23]),
      );
      const oldParts = snapshot(f.p);
      change(f);
      const after = assertWorkbook(f.p, f.shape);
      expect(after.part.name.toLowerCase()).not.toBe(occupied.toLowerCase());
      expect(after.part.name).not.toBe(b.part.name);
      expect(b.part.data).toEqual(old);
      expect(b.pkg.getPart(occupied).data).toEqual(new Uint8Array([19, 23]));
      for (const [name, _, bytes] of oldParts.parts.filter(
        ([name]) => name !== b.owner && name !== relsPartNameFor(b.owner),
      ))
        expect(b.pkg.getPart(name).data).toEqual(bytes);
      expect(P.validatePresentation(f.p)).toEqual([]);
    });
  it("uses a new binding rather than an unbound package relationship", () => {
    const f = fixture(),
      b = binding(f.p, f.shape),
      old = b.part.data.slice(),
      oldIds = b.pkg.getRels(b.owner).items.map((r) => r.id);
    editNative(f, (b) => {
      b.root.children = b.root.children.filter((e) => e !== b.external);
    });
    change(f);
    const after = assertWorkbook(f.p, f.shape);
    expect(oldIds).not.toContain(after.id);
    expect(b.part.data).toEqual(old);
    expect(P.validatePresentation(f.p)).toEqual([]);
  });
  it("recreates a missing referenced backing part without leaving a dangling relationship", () => {
    const f = fixture(),
      b = binding(f.p, f.shape);
    b.pkg.removePart(b.part.name);
    change(f);
    const after = assertWorkbook(f.p, f.shape);
    expect(after.id).toBe(b.id);
    expect(P.validatePresentation(f.p)).toEqual([]);
  });
  it.each([
    "application/vnd.ms-excel",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
    "application/octet-stream",
  ])(
    "authors a correctly typed XLSX without overwriting native %s bytes",
    (contentType) => {
      const f = fixture(),
        b = binding(f.p, f.shape),
        original = new Uint8Array([31, 41, 59]);
      b.part.contentType = contentType;
      b.part.data = original;
      change(f);
      const after = assertWorkbook(f.p, f.shape);
      expect(after.id).toBe(b.id);
      expect(after.part.name).not.toBe(b.part.name);
      expect(b.part.data).toEqual(original);
      expect(b.part.contentType).toBe(contentType);
      expect(P.validatePresentation(f.p)).toEqual([]);
    },
  );
  it.each(["style", "missing", "foreign-id", "empty"])(
    "repairs invalid %s binding without replacing unrelated parts",
    (invalid) => {
      const f = fixture(),
        b = binding(f.p, f.shape),
        old = b.part.data.slice(),
        ids = b.pkg.getRels(b.owner).items.map((r) => r.id);
      editNative(f, (b) => {
        b.external.attrs =
          invalid === "foreign-id"
            ? [{ name: qname("", "id", "urn:foreign"), value: b.id }]
            : [
                {
                  name: qname("r", "id", NS.officeDocRels),
                  value:
                    invalid === "style"
                      ? "rId1"
                      : invalid === "empty"
                        ? ""
                        : "missingSource",
                },
              ];
      });
      change(f);
      const after = assertWorkbook(f.p, f.shape);
      expect(ids).not.toContain(after.id);
      expect(b.part.data).toEqual(old);
      expect(P.validatePresentation(f.p)).toEqual([]);
    },
  );
  it.each(["addPart", "setRels"])(
    "rolls back an unexpected %s failure while attaching a new workbook",
    (method) => {
      const f = fixture(),
        b = binding(f.p, f.shape);
      editNative(f, (b) => {
        b.root.children = b.root.children.filter((e) => e !== b.external);
      });
      const before = snapshot(f.p),
        original = b.pkg[method].bind(b.pkg);
      const spy = vi.spyOn(b.pkg, method).mockImplementation((...args) => {
        original(...args);
        throw new Error("owned write failure");
      });
      try {
        expect(() => change(f)).toThrow("owned write failure");
        expect(snapshot(f.p)).toEqual(before);
      } finally {
        spy.mockRestore();
      }
    },
  );
  it("rejects invalid data before changing chart, workbook or relationships", () => {
    const f = fixture(),
      before = snapshot(f.p);
    expect(() =>
      P.setChartSpec(P.getSlideCharts(f.slide)[0], {
        ...P.getShapeChartSpec(f.shape),
        series: [{ name: "Bad", values: [1], numberFormat: 7 }],
      }),
    ).toThrow();
    expect(snapshot(f.p)).toEqual(before);
  });
  it("allocates authoring workbook names independently of chart part indices", () => {
    const p = createDeck("blank"),
      slide = P.getSlides(p)[0],
      pkg = P._internalPackageOf(p),
      bytes = buildEmbeddedXlsx(
        ["Unrelated"],
        [{ label: "Keep", values: [97] }],
      );
    pkg.addPart(
      partName("/PPT/EMBEDDINGS/MICROSOFT_EXCEL_WORKSHEET1.XLSX"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes,
    );
    const shape = P.addSlideChart(slide, {
      x: P.inches(1),
      y: P.inches(1),
      w: P.inches(5),
      h: P.inches(3),
      spec: {
        kind: "column",
        categories: ["One"],
        series: [{ name: "New", values: [3] }],
      },
    });
    expect(workbook(p, shape).name.toLowerCase()).not.toBe(
      "/ppt/embeddings/microsoft_excel_worksheet1.xlsx",
    );
    expect(
      pkg.getPart("/ppt/embeddings/microsoft_excel_worksheet1.xlsx").data,
    ).toEqual(bytes);
    expect(P.validatePresentation(p)).toEqual([]);
  });
  it.each(kinds)(
    "%s retains binding ownership through save and slide/shape transfers both ways with independent edits",
    async (kind) => {
      const f = fixture(kind),
        source = binding(f.p, f.shape),
        q = createDeck("blank"),
        slide = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0], {
          preservePaintFormatting: true,
        }),
        copy = P.getSlideCharts(slide)[0];
      expect(binding(q, copy.shape).id).toBe(source.id);
      expect(workbook(q, copy.shape).data).toEqual(source.part.data);
      const r = await P.loadPresentation(await P.savePresentation(q)),
        back = P.importSlide(
          f.p,
          P.getSlides(r).at(-1),
          P.getSlideLayout(f.slide),
          { preservePaintFormatting: true },
        ),
        returned = P.getSlideCharts(back)[0],
        original = source.part.data.slice();
      P.setChartSpec(returned, {
        ...returned.spec,
        categories: ["Delta", "Epsilon", "Zeta"],
        series: [
          {
            ...returned.spec.series[0],
            name: "New source",
            values: [31, 47, -13],
            numberFormat: "0.00%",
          },
        ],
      });
      expect(assertWorkbook(f.p, returned.shape).id).toBe(source.id);
      expect(workbook(f.p, returned.shape).name).not.toBe(source.part.name);
      expect(source.part.data).toEqual(original);
      expect(P.validatePresentation(f.p)).toEqual([]);
    },
  );
});
