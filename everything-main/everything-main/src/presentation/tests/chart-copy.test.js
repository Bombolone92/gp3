import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  chartCopyDeck,
  chartRoot,
  chartGraph,
  workbook,
} from "./chart-copy-fixture.js";
import { resolveTarget } from "../lib/pptx/src/internal/opc/index.ts";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";
import { themeForChart } from "../lib/pptx/src/api/fn/chart-copy.ts";

const snapshot = (p) =>
  P._internalPackageOf(p).parts.map((part) => [
    part.name,
    part.contentType,
    part.data.slice(),
  ]);
const target = (p) => P.addSlide(p, { layout: P.getSlideLayouts(p)[0] });
const chartShapes = (slide) => P.getSlideCharts(slide).map((c) => c.shape);
function sameGraph(source, original, copied, clone) {
  const a = P._internalPackageOf(source),
    b = P._internalPackageOf(copied),
    seen = new Set();
  const visit = (x, y) => {
    if (seen.has(x.toLowerCase())) return;
    seen.add(x.toLowerCase());
    const pa = a.getPart(x),
      pb = b.getPart(y);
    expect(pb?.contentType).toBe(pa.contentType);
    expect(pb?.data).toEqual(pa.data);
    const ar = a.getRels(x)?.items ?? [],
      br = b.getRels(y)?.items ?? [];
    expect(br.map((r) => [r.id, r.type, r.targetMode])).toEqual(
      ar.map((r) => [r.id, r.type, r.targetMode]),
    );
    for (let i = 0; i < ar.length; i++) {
      if (ar[i].targetMode === "External")
        expect(br[i].target).toBe(ar[i].target);
      else
        visit(resolveTarget(x, ar[i].target), resolveTarget(y, br[i].target));
    }
  };
  visit(chartRoot(original), chartRoot(clone));
}

describe("native chart dependency copying", () => {
  it("retains charts and their complete graphs through import, export and return", async () => {
    const { p, slide } = chartCopyDeck(),
      before = snapshot(p),
      q = createDeck("blank"),
      imported = P.importSlide(q, slide, P.getSlideLayouts(q)[0]);
    expect(chartShapes(imported)).toHaveLength(2);
    chartShapes(slide).forEach((s, i) =>
      sameGraph(p, s, q, chartShapes(imported)[i]),
    );
    expect(snapshot(p)).toEqual(before);
    const saved = await P.loadPresentation(await P.savePresentation(q)),
      s = P.getSlides(saved).at(-1),
      back = P.importSlide(p, s, P.getSlideLayout(slide));
    expect(chartShapes(back)).toHaveLength(2);
    chartShapes(s).forEach((sh, i) =>
      sameGraph(saved, sh, p, chartShapes(back)[i]),
    );
    expect(P.validatePresentation(saved)).toEqual([]);
  });
  it.each([false, true])(
    "copies independent chart definitions and workbooks (same slide: %s)",
    (same) => {
      const { p, slide } = chartCopyDeck(),
        original = chartShapes(slide)[0],
        to = same ? slide : target(p),
        clone = P.copyShape(to, original);
      sameGraph(p, original, p, clone);
      expect(chartRoot(clone)).not.toBe(chartRoot(original));
      expect(workbook(p, clone).name).not.toBe(workbook(p, original).name);
      const old = P.getShapeChartSpec(original),
        bytes = workbook(p, original).data.slice();
      P.setChartSpec(
        { shape: clone, spec: P.getShapeChartSpec(clone) },
        { ...old, series: [{ name: "Edited copy", values: [21, 5, 8] }] },
      );
      expect(P.getShapeChartSpec(original)).toEqual(old);
      expect(workbook(p, original).data).toEqual(bytes);
    },
  );
  it("duplicates slide charts without sharing editable dependencies", () => {
    const { p, slide } = chartCopyDeck(),
      copied = P.duplicateSlide(p, slide);
    expect(chartShapes(copied)).toHaveLength(2);
    chartShapes(slide).forEach((s, i) => {
      const c = chartShapes(copied)[i];
      sameGraph(p, s, p, c);
      expect(chartRoot(c)).not.toBe(chartRoot(s));
      expect(workbook(p, c).name).not.toBe(workbook(p, s).name);
    });
  });
  it("retains all chart descendants when importing and copying a group", () => {
    const { p, slide } = chartCopyDeck({ grouped: true }),
      q = createDeck("blank"),
      imported = P.importSlide(q, slide, P.getSlideLayouts(q)[0]);
    expect(chartShapes(imported)).toHaveLength(2);
    const copied = P.copyShape(target(q), P.getSlideShapes(imported)[0]);
    expect(P.getGroupChildren(copied)).toHaveLength(2);
    const children = P.getGroupChildren(copied);
    chartShapes(imported).forEach((s, i) => {
      sameGraph(q, s, q, children[i]);
      expect(chartRoot(children[i])).not.toBe(chartRoot(s));
    });
  });
  it("keeps unsupported chart kinds as native graphs rather than dropping the frame", () => {
    const { p, slide } = chartCopyDeck(),
      shape = chartShapes(slide)[0],
      pkg = P._internalPackageOf(p),
      part = pkg.getPart(chartRoot(shape));
    part.data = new TextEncoder().encode(
      new TextDecoder()
        .decode(part.data)
        .replaceAll("barChart", "surfaceChart"),
    );
    const q = createDeck("blank"),
      imported = P.importSlide(q, slide, P.getSlideLayouts(q)[0]);
    expect(P.getSlideShapes(imported)).toHaveLength(2);
    expect(P.getSlideCharts(imported)).toHaveLength(2);
    sameGraph(p, shape, q, P.getSlideShapes(imported)[0]);
  });
  it("copies only the selected chart graph, leaving unrelated native charts untouched", () => {
    const { p, slide } = chartCopyDeck(),
      before = chartGraph(p, chartRoot(chartShapes(slide)[1])).map((x) => [
        x.name,
        x.data.slice(),
      ]),
      clone = P.copyShape(target(p), chartShapes(slide)[0]);
    expect(chartGraph(p, chartRoot(clone))).toHaveLength(3);
    expect(
      chartGraph(p, chartRoot(chartShapes(slide)[1])).map((x) => [
        x.name,
        x.data.slice(),
      ]),
    ).toEqual(before);
  });
  it.each(["import", "duplicate", "copy"])(
    "fails atomically on a missing workbook during %s",
    (operation) => {
      const { p, slide } = chartCopyDeck(),
        pkg = P._internalPackageOf(p);
      pkg.removePart(workbook(p, chartShapes(slide)[1]).name);
      const q = operation === "import" ? createDeck("blank") : p,
        to = operation === "copy" ? target(p) : null,
        before = snapshot(q),
        types = structuredClone(P._internalPackageOf(q).contentTypes),
        count = P.getSlides(q).length;
      const act = () =>
        operation === "import"
          ? P.importSlide(q, slide, P.getSlideLayouts(q)[0])
          : operation === "duplicate"
            ? P.duplicateSlide(p, slide)
            : P.copyShapes(to, chartShapes(slide));
      expect(act).toThrow(/missing dependency/);
      expect(snapshot(q)).toEqual(before);
      expect(P._internalPackageOf(q).contentTypes).toEqual(types);
      expect(P.getSlides(q)).toHaveLength(count);
    },
  );
  it("keeps source theme context for clipboard imports without changing the destination", () => {
    const { p, slide } = chartCopyDeck();
    P.setPresentationTheme(p, { accent1: "#751B44", accent2: "#1D8A72" });
    const q = createDeck("blank"),
      before = P.getPresentationTheme(q),
      imported = P.importSlide(q, slide, P.getSlideLayouts(q)[0], {
        preservePaintFormatting: true,
        preserveTextFormatting: true,
      });
    expect(chartShapes(imported)).toHaveLength(2);
    const themeRel = P._internalPackageOf(q)
      .getRels(chartRoot(chartShapes(imported)[0]))
      .items.find((r) => r.type.endsWith("/themeOverride"));
    expect(themeRel).toBeTruthy();
    expect(P.getPresentationTheme(q)).toEqual(before);
    const isolate = (pres, s) => {
      const shapes = P.getSlideShapes(s);
      for (const sh of shapes)
        if (!P.getShapeChartSpec(sh)) P.setShapeHidden(sh, true);
      return preview(pres, s);
    };
    expect(isolate(q, imported)).toBe(isolate(p, slide));
  });
  it("imports into occupied chart/workbook/style names without overwriting either graph", () => {
    const { p, slide } = chartCopyDeck(),
      { p: q, slide: existing } = chartCopyDeck(),
      before = chartShapes(existing).map((sh) =>
        chartGraph(q, chartRoot(sh)).map((part) => [
          part.name,
          part.data.slice(),
        ]),
      ),
      imported = P.importSlide(q, slide, P.getSlideLayouts(q)[0]);
    expect(chartShapes(imported)).toHaveLength(2);
    chartShapes(slide).forEach((sh, i) =>
      sameGraph(p, sh, q, chartShapes(imported)[i]),
    );
    expect(
      chartShapes(existing).map((sh) =>
        chartGraph(q, chartRoot(sh)).map((part) => [
          part.name,
          part.data.slice(),
        ]),
      ),
    ).toEqual(before);
  });
  it("preserves a workbook shared by two source charts within a slide import", () => {
    const { p, slide } = chartCopyDeck(),
      pkg = P._internalPackageOf(p),
      charts = chartShapes(slide),
      shared = workbook(p, charts[0]),
      second = chartRoot(charts[1]),
      rels = pkg.getRels(second);
    rels.items.find((r) => r.type === REL_TYPES.package).target = shared.name;
    pkg.setRels(second, rels);
    const q = createDeck("blank"),
      imported = P.importSlide(q, slide, P.getSlideLayouts(q)[0]);
    expect(chartShapes(imported)).toHaveLength(2);
    expect(workbook(q, chartShapes(imported)[0])).toBe(
      workbook(q, chartShapes(imported)[1]),
    );
    const independent = P.copyShape(target(q), chartShapes(imported)[0]);
    expect(workbook(q, independent).name).not.toBe(
      workbook(q, chartShapes(imported)[0]).name,
    );
  });
  it.each([
    [true, false],
    [false, true],
    [true, true],
  ])(
    "keeps only requested inherited theme schemes (text %s, paint %s)",
    (text, paint) => {
      const { p, slide } = chartCopyDeck(),
        q = createDeck("blank"),
        imported = P.importSlide(q, slide, P.getSlideLayouts(q)[0], {
          preserveTextFormatting: text,
          preservePaintFormatting: paint,
        }),
        pkg = P._internalPackageOf(q),
        owner = chartRoot(chartShapes(imported)[0]),
        rel = pkg
          .getRels(owner)
          .items.find((r) => r.type.endsWith("/themeOverride"));
      const root = parseXml(
        new TextDecoder().decode(
          pkg.getPart(resolveTarget(owner, rel.target)).data,
        ),
      ).root;
      expect(
        root.children
          .filter((c) => c.kind === "element")
          .map((c) => c.name.localName),
      ).toEqual([
        ...(paint ? ["clrScheme"] : []),
        ...(text ? ["fontScheme"] : []),
        ...(paint ? ["fmtScheme"] : []),
      ]);
      expect(
        root.children
          .filter((c) => c.kind === "element")
          .every((c) => c.name.namespaceURI === NS.dml),
      ).toBe(true);
    },
  );
  it("merges partial native chart overrides ahead of inherited schemes", () => {
    const { p, slide } = chartCopyDeck(),
      pkg = P._internalPackageOf(p),
      chart = chartRoot(chartShapes(slide)[0]);
    const theme = pkg.parts.find(
        (part) =>
          part.contentType ===
          "application/vnd.openxmlformats-officedocument.theme+xml",
      ),
      doc = parseXml(new TextDecoder().decode(theme.data));
    const elements = firstChildElement(
        doc.root,
        qname("a", "themeElements", NS.dml),
      ),
      colors = structuredClone(
        firstChildElement(elements, qname("a", "clrScheme", NS.dml)),
      );
    firstChildElement(
      firstChildElement(colors, qname("a", "accent1", NS.dml)),
      qname("a", "srgbClr", NS.dml),
    ).attrs.find((a) => a.name.localName === "val").value = "982D51";
    const override = parseXml(`<a:themeOverride xmlns:a="${NS.dml}"/>`);
    override.root.children.push(colors);
    pkg.addPart(
      "/assets/chart/partial.xml",
      "application/vnd.openxmlformats-officedocument.themeOverride+xml",
      new TextEncoder().encode(serializeXml(override)),
    );
    const rels = pkg.getRels(chart);
    rels.items.push({
      id: "ownTheme",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/themeOverride",
      target: "/assets/chart/partial.xml",
      targetMode: "Internal",
    });
    pkg.setRels(chart, rels);
    const q = createDeck("blank"),
      imported = P.importSlide(q, slide, P.getSlideLayouts(q)[0], {
        preserveTextFormatting: true,
        preservePaintFormatting: true,
      });
    expect(themeForChart(chartShapes(imported)[0]).theme.accent1).toBe(
      "#982D51",
    );
    expect(themeForChart(chartShapes(imported)[0]).fonts).toEqual(
      themeForChart(chartShapes(slide)[0]).fonts,
    );
  });
  it("retains source color mappings in the native chart without altering authored mappings", () => {
    const { p, slide } = chartCopyDeck(),
      pkg = P._internalPackageOf(p),
      chart = chartRoot(chartShapes(slide)[0]),
      part = pkg.getPart(chart),
      doc = parseXml(new TextDecoder().decode(part.data));
    const map = parseXml(
      `<c:clrMapOvr xmlns:c="${NS.chart}" bg1="dk1" tx1="lt1" accent1="accent4"/>`,
    ).root;
    const body = firstChildElement(doc.root, qname("c", "chart", NS.chart));
    doc.root.children.splice(doc.root.children.indexOf(body), 0, map);
    part.data = new TextEncoder().encode(serializeXml(doc));
    const before = part.data.slice(),
      q = createDeck("blank"),
      imported = P.importSlide(q, slide, P.getSlideLayouts(q)[0], {
        preservePaintFormatting: true,
      }),
      newPart = P._internalPackageOf(q).getPart(
        chartRoot(chartShapes(imported)[0]),
      ),
      root = parseXml(new TextDecoder().decode(newPart.data)).root,
      local = firstChildElement(root, qname("c", "clrMapOvr", NS.chart));
    expect(
      Object.fromEntries(local.attrs.map((a) => [a.name.localName, a.value])),
    ).toMatchObject({ bg1: "dk1", tx1: "lt1", accent1: "accent4" });
    expect(part.data).toEqual(before);
    expect(root.children.indexOf(local)).toBeLessThan(
      root.children.indexOf(
        firstChildElement(root, qname("c", "chart", NS.chart)),
      ),
    );
  });
  it("rebinds images referenced by an inherited format scheme to copied assets", () => {
    const { p, slide } = chartCopyDeck(),
      pkg = P._internalPackageOf(p),
      theme = pkg.parts.find(
        (part) =>
          part.contentType ===
          "application/vnd.openxmlformats-officedocument.theme+xml",
      ),
      doc = parseXml(new TextDecoder().decode(theme.data)),
      elements = firstChildElement(
        doc.root,
        qname("a", "themeElements", NS.dml),
      ),
      fmt = firstChildElement(elements, qname("a", "fmtScheme", NS.dml)),
      fills = firstChildElement(fmt, qname("a", "fillStyleLst", NS.dml));
    fills.children[0] = parseXml(
      `<a:blipFill xmlns:a="${NS.dml}" xmlns:r="${NS.officeDocRels}"><a:blip r:embed="texture"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`,
    ).root;
    theme.data = new TextEncoder().encode(serializeXml(doc));
    const image = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    pkg.addPart("/assets/chart/texture.png", "image/png", image);
    pkg.setRels(theme.name, {
      items: [
        {
          id: "texture",
          type: REL_TYPES.image,
          target: "/assets/chart/texture.png",
          targetMode: "Internal",
        },
      ],
    });
    const q = createDeck("blank"),
      qp = P._internalPackageOf(q);
    qp.addPart(
      "/assets/chart/texture.png",
      "image/png",
      new Uint8Array([13, 21]),
    );
    const imported = P.importSlide(q, slide, P.getSlideLayouts(q)[0], {
        preservePaintFormatting: true,
      }),
      owner = chartRoot(chartShapes(imported)[0]),
      overrideRel = qp
        .getRels(owner)
        .items.find((r) => r.type.endsWith("/themeOverride")),
      override = qp.getPart(resolveTarget(owner, overrideRel.target)),
      root = parseXml(new TextDecoder().decode(override.data)).root,
      copyFmt = firstChildElement(root, qname("a", "fmtScheme", NS.dml)),
      copyFills = firstChildElement(
        copyFmt,
        qname("a", "fillStyleLst", NS.dml),
      ),
      blip = firstChildElement(
        copyFills.children[0],
        qname("a", "blip", NS.dml),
      ),
      id = blip.attrs.find(
        (a) => a.name.namespaceURI === NS.officeDocRels,
      ).value,
      rel = qp.getRels(override.name).items.find((r) => r.id === id),
      copied = qp.getPart(resolveTarget(override.name, rel.target));
    expect(copied.data).toEqual(image);
    expect(copied.name).not.toBe("/assets/chart/texture.png");
    expect(qp.getPart("/assets/chart/texture.png").data).toEqual(
      new Uint8Array([13, 21]),
    );
    expect(P.validatePresentation(q)).toEqual([]);
  });
  it("preserves a native chart with cached data and no embedded workbook", () => {
    const { p, slide } = chartCopyDeck(),
      pkg = P._internalPackageOf(p),
      shape = chartShapes(slide)[0],
      owner = chartRoot(shape),
      part = pkg.getPart(owner),
      doc = parseXml(new TextDecoder().decode(part.data));
    doc.root.children = doc.root.children.filter(
      (c) =>
        c.kind !== "element" ||
        c.name.namespaceURI !== NS.chart ||
        c.name.localName !== "externalData",
    );
    part.data = new TextEncoder().encode(serializeXml(doc));
    const rels = pkg.getRels(owner);
    rels.items = rels.items.filter((r) => r.type !== REL_TYPES.package);
    pkg.setRels(owner, rels);
    const q = createDeck("blank"),
      imported = P.importSlide(q, slide, P.getSlideLayouts(q)[0]);
    expect(chartShapes(imported)).toHaveLength(2);
    sameGraph(p, shape, q, chartShapes(imported)[0]);
  });
  it.each([
    "<a:themeOverride",
    '<foreign:themeOverride xmlns:foreign="urn:owned:opaque"/>',
  ])(
    "preserves opaque optional theme data without breaking chart preview (%s)",
    (xml) => {
      const { p, slide } = chartCopyDeck(),
        pkg = P._internalPackageOf(p),
        owner = chartRoot(chartShapes(slide)[0]),
        bytes = new TextEncoder().encode(xml),
        name = "/assets/chart/opaque-theme.xml";
      pkg.addPart(
        name,
        "application/vnd.openxmlformats-officedocument.themeOverride+xml",
        bytes,
      );
      const rels = pkg.getRels(owner);
      rels.items.push({
        id: "opaqueTheme",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/themeOverride",
        target: name,
        targetMode: "Internal",
      });
      pkg.setRels(owner, rels);
      expect(() => preview(p, slide)).not.toThrow();
      const q = createDeck("blank"),
        imported = P.importSlide(q, slide, P.getSlideLayouts(q)[0], {
          preserveTextFormatting: true,
          preservePaintFormatting: true,
        }),
        graph = chartGraph(q, chartRoot(chartShapes(imported)[0]));
      expect(graph.some((part) => Buffer.compare(part.data, bytes) === 0)).toBe(
        true,
      );
      expect(() => preview(q, imported)).not.toThrow();
      expect(pkg.getPart(name).data).toEqual(bytes);
    },
  );
});
