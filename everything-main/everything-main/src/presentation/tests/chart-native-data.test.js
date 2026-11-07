import { describe, it, expect } from "vitest";
import { preserveNativeChartData } from "../lib/pptx/src/internal/chartml/native-data.ts";
import { readChartSpec } from "../lib/pptx/src/internal/chartml/chart-reader.ts";
import { buildChartSpaceDoc } from "../lib/pptx/src/internal/chartml/chart-builder.ts";
import { P, createDeck, preview } from "../src/model.js";
import {
  chartNativeDataDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  allChildElements,
  qname,
  getAttrValue,
} from "../lib/pptx/src/internal/xml/index.ts";
const c = (n) => qname("c", n, NS.chart),
  a = (n) => qname("", n, "");
const doc = (f) =>
  parseXml(
    new TextDecoder().decode(
      P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
    ),
  );
const save = (f, d) => {
  P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data =
    new TextEncoder().encode(serializeXml(d));
};
const series = (root) =>
  firstChildElement(firstChildElement(root, c("chart")), c("plotArea"))
    .children.filter((n) => n.kind === "element")
    .flatMap((g) => allChildElements(g, c("ser")));
const canonical = (e) =>
  e
    ? [
        e.name.namespaceURI,
        e.name.localName,
        e.attrs
          .map((a) => [a.name.namespaceURI, a.name.localName, a.value])
          .sort(),
        e.children.map((n) =>
          n.kind === "element" ? canonical(n) : [n.kind, n.data],
        ),
      ]
    : null;
const channels = (f) =>
  series(doc(f).root).map((s) =>
    ["tx", "cat", "val"].map((n) => canonical(firstChildElement(s, c(n)))),
  );
const appearance = (f) => {
  const chart = P.getSlideCharts(f.slide)[0];
  P.setChartSpec(chart, {
    ...chart.spec,
    legend: { ...chart.spec.legend, textStyle: { bold: true } },
    valueAxis: {
      ...chart.spec.valueAxis,
      numberFormat: "0.0%",
      numberFormatSourceLinked: false,
    },
  });
};
const pt = (idx, value) => `<c:pt idx="${idx}"><c:v>${value}</c:v></c:pt>`;
function replace(f, name, body) {
  const d = doc(f),
    s = series(d.root)[0],
    old = firstChildElement(s, c(name));
  s.children = s.children.map((n) =>
    n === old
      ? parseXml(`<c:${name} xmlns:c="${NS.chart}">${body}</c:${name}>`).root
      : n,
  );
  save(f, d);
}
function retain(f) {
  const bytes = workbook(f.p, f.shape).data.slice(),
    before = channels(f);
  appearance(f);
  expect(workbook(f.p, f.shape).data).toEqual(bytes);
  expect(channels(f)).toEqual(before);
  expect(P.validatePresentation(f.p)).toEqual([]);
}
const kinds = ["bar", "column", "line", "area", "pie", "doughnut"];
describe("native chart data on appearance edits", () => {
  it.each(kinds)(
    "preserves %s workbook bytes, quoted offset formulas and opaque cache records",
    async (kind) => {
      const f = chartNativeDataDeck(kind),
        bytes = workbook(f.p, f.shape).data.slice(),
        before = channels(f);
      appearance(f);
      expect(workbook(f.p, f.shape).data).toEqual(bytes);
      expect(channels(f)).toEqual(before);
      expect(P.getShapeChartSpec(f.shape).legend.textStyle.bold).toBe(true);
      const q = await P.loadPresentation(await P.savePresentation(f.p)),
        shape = P.getSlideCharts(P.getSlides(q)[0])[0].shape;
      expect(workbook(q, shape).data).toEqual(bytes);
      expect(P.validatePresentation(q)).toEqual([]);
      expect(decodeURIComponent(preview(q, P.getSlides(q)[0]))).toContain(
        ["pie", "doughnut"].includes(kind) ? "North" : "Sales",
      );
    },
  );
  it("associates reordered combo groups by model position, not native idx", () => {
    const f = chartNativeDataDeck("column", true),
      d = doc(f),
      area = firstChildElement(
        firstChildElement(d.root, c("chart")),
        c("plotArea"),
      ),
      groups = area.children.filter(
        (n) => n.kind === "element" && allChildElements(n, c("ser")).length,
      );
    area.children = area.children.map((n) =>
      n === groups[0] ? groups[1] : n === groups[1] ? groups[0] : n,
    );
    save(f, d);
    const bytes = workbook(f.p, f.shape).data.slice(),
      before = channels(f),
      chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, { ...chart.spec, title: "Regrouped" });
    expect(workbook(f.p, f.shape).data).toEqual(bytes);
    // Builder regrouping may alter XML order; generated idx identifies model position.
    expect(
      series(doc(f).root)
        .map((s) => ({
          idx: Number(getAttrValue(firstChildElement(s, c("idx")), a("val"))),
          data: ["tx", "cat", "val"].map((n) =>
            canonical(firstChildElement(s, c(n))),
          ),
        }))
        .sort((x, y) => x.idx - y.idx)
        .map((x) => x.data),
    ).toEqual(before);
  });
  it.each(["strRef", "strLit", "multiLvlStrRef"])(
    "retains %s categories with holes, duplicate points and multiple levels",
    (type) => {
      const f = chartNativeDataDeck(),
        points =
          pt(1, "Old") +
          pt(1, "East") +
          pt(3, "West") +
          '<c:pt idx="1"/>' +
          pt("4tail", "Ignored"),
        count = '<c:ptCount val="2"/>';
      replace(
        f,
        "cat",
        type === "strRef"
          ? `<c:strRef><c:f>'Region''s data'!$D$8:$D$11</c:f><c:strCache>${count}${points}</c:strCache></c:strRef>`
          : type === "strLit"
            ? `<c:strLit>${count}${points}</c:strLit>`
            : `<c:multiLvlStrRef><c:f>'Region''s data'!$C$8:$D$11</c:f><c:multiLvlStrCache>${count}<c:lvl>${points}</c:lvl><c:lvl>${pt(0, "Parent")}</c:lvl></c:multiLvlStrCache></c:multiLvlStrRef>`,
      );
      expect(P.getShapeChartSpec(f.shape).categories).toEqual([
        "",
        "East",
        "",
        "West",
      ]);
      retain(f);
    },
  );
  it.each([false, true])(
    "retains numeric %s literals/references, blank and invalid values",
    (literal) => {
      const f = chartNativeDataDeck(),
        body =
          '<c:formatCode>0.00</c:formatCode><c:ptCount val="5"/>' +
          pt(0, "NaN") +
          pt(1, "3tail") +
          pt(1, "<![CDATA[7.5]]>") +
          pt(3, "Infinity");
      replace(
        f,
        "val",
        literal
          ? `<c:numLit>${body}</c:numLit>`
          : `<c:numRef><c:f>'Region''s data'!$E$8:$E$12</c:f><c:numCache>${body}</c:numCache></c:numRef>`,
      );
      expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([
        null,
        7.5,
        null,
        null,
        null,
      ]);
      retain(f);
    },
  );
  it.each(["0", "bad", undefined])(
    "retains empty/all-blank cache and its original extent (%s)",
    (count) => {
      const f = chartNativeDataDeck();
      replace(
        f,
        "cat",
        `<c:strLit>${count === undefined ? "" : `<c:ptCount val="${count}"/>`}</c:strLit>`,
      );
      replace(f, "val", '<c:numLit><c:ptCount val="4"/></c:numLit>');
      retain(f);
    },
  );
  it("keeps numeric category formats and calendar unchanged", () => {
    const f = chartNativeDataDeck(),
      d = doc(f);
    d.root.children.unshift(
      parseXml(`<c:date1904 xmlns:c="${NS.chart}" val="1"/>`).root,
    );
    save(f, d);
    replace(
      f,
      "cat",
      `<c:numLit><c:formatCode>m/d/yyyy</c:formatCode><c:ptCount val="3"/>${pt(0, "43000") + pt(2, "43002")}</c:numLit>`,
    );
    retain(f);
  });
  it("reads direct series names and retains missing captions without inventing workbook headers", () => {
    const f = chartNativeDataDeck();
    replace(f, "tx", "<c:v>Direct name</c:v>");
    expect(P.getShapeChartSpec(f.shape).series[0].name).toBe("Direct name");
    retain(f);
    const d = doc(f),
      s = series(d.root)[0];
    s.children = s.children.filter((n) => n !== firstChildElement(s, c("tx")));
    save(f, d);
    retain(f);
  });
  it("retains later series' unrepresented category channels and name-cache metadata", () => {
    const f = chartNativeDataDeck(),
      d = doc(f),
      s = series(d.root),
      cat = firstChildElement(s[1], c("cat"));
    cat.children = [];
    const cache = firstChildElement(
      firstChildElement(firstChildElement(s[0], c("tx")), c("strRef")),
      c("strCache"),
    );
    cache.children.push(
      parseXml(
        `<c:pt xmlns:c="${NS.chart}" idx="5"><c:v>Opaque extra name</c:v></c:pt>`,
      ).root,
    );
    save(f, d);
    retain(f);
  });
  it.each([
    "name",
    "value",
    "category",
    "series format",
    "category format",
    "date system",
    "extent",
    "series order",
  ])(
    "updates native data for a %s change without replacing source ranges",
    (change) => {
      const f = chartNativeDataDeck();
      if (change === "category format")
        replace(
          f,
          "cat",
          `<c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="3"/>${pt(0, "10") + pt(1, "20") + pt(2, "30")}</c:numLit>`,
        );
      const bytes = workbook(f.p, f.shape).data.slice(),
        chart = P.getSlideCharts(f.slide)[0],
        s = structuredClone(chart.spec);
      if (change === "name") s.series[0].name = "New";
      if (change === "value") s.series[0].values[0] = 13;
      if (change === "category") s.categories[0] = "New";
      if (change === "series format") s.series[0].numberFormat = "0.0%";
      if (change === "category format") s.categoryNumberFormat = "0.0";
      if (change === "date system") s.date1904 = true;
      if (change === "extent") s.series[0].values.push(null);
      if (change === "series order") s.series.reverse();
      P.setChartSpec(chart, s);
      if (change !== "category format")
        expect(workbook(f.p, f.shape).data).not.toEqual(bytes);
      expect(JSON.stringify(channels(f))).toContain("Region''s data");
      const actual = P.getShapeChartSpec(f.shape);
      expect(
        actual.series.map((x) => [x.name, x.values, x.numberFormat]),
      ).toEqual(s.series.map((x) => [x.name, x.values, x.numberFormat]));
      expect(actual.categories).toEqual(s.categories);
      expect(actual.categoryNumberFormat).toBe(s.categoryNumberFormat);
      expect(actual.date1904 ?? false).toBe(s.date1904 ?? false);
      expect(P.validatePresentation(f.p)).toEqual([]);
    },
  );
  it("keeps categorical type conversion attached to the unchanged native ranges", () => {
    const f = chartNativeDataDeck(),
      bytes = workbook(f.p, f.shape).data.slice(),
      before = channels(f),
      chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, { ...chart.spec, kind: "line" });
    expect(channels(f)).toEqual(before);
    expect(workbook(f.p, f.shape).data).toEqual(bytes);
  });
  it("appearance edits preserve workbook independence through template transfer both ways", async () => {
    const f = chartNativeDataDeck(),
      bytes = workbook(f.p, f.shape).data.slice(),
      dest = createDeck("blank");
    const forward = P.importSlide(dest, f.slide, P.getSlideLayouts(dest)[0], {
      preservePaintFormatting: true,
    });
    const copied = {
      p: dest,
      slide: forward,
      shape: P.getSlideCharts(forward)[0].shape,
    };
    retain(copied);
    expect(workbook(f.p, f.shape).data).toEqual(bytes);
    expect(workbook(dest, copied.shape)).not.toBe(workbook(f.p, f.shape));
    const back = P.importSlide(f.p, copied.slide, P.getSlideLayout(f.slide), {
      preservePaintFormatting: true,
    });
    retain({ p: f.p, slide: back, shape: P.getSlideCharts(back)[0].shape });
    const q = await P.loadPresentation(await P.savePresentation(f.p));
    expect(
      workbook(q, P.getSlideCharts(P.getSlides(q).at(-1))[0].shape).data,
    ).toEqual(bytes);
  });
});

describe("native chart data preservation boundaries", () => {
  it.each([undefined, " 1 ", "true", "0", "false"])(
    "preserves calendar val=%j using the XML Boolean default",
    (raw) => {
      const f = chartNativeDataDeck(),
        d = doc(f);
      d.root.children.unshift(
        parseXml(
          `<c:date1904 xmlns:c="${NS.chart}"${raw === undefined ? "" : ` val="${raw}"`}/>`,
        ).root,
      );
      save(f, d);
      expect(P.getShapeChartSpec(f.shape).date1904 ?? false).toBe(
        raw === undefined || raw.trim() === "1" || raw === "true",
      );
      retain(f);
    },
  );
  it.each(["2", "TRUE", "\u00a01\u00a0"])(
    "repairs an unknown calendar %j while retaining an already compatible workbook",
    (raw) => {
      const f = chartNativeDataDeck(),
        d = doc(f);
      d.root.children.unshift(
        parseXml(`<c:date1904 xmlns:c="${NS.chart}" val="${raw}"/>`).root,
      );
      save(f, d);
      const bytes = workbook(f.p, f.shape).data.slice();
      appearance(f);
      expect(P.getShapeChartSpec(f.shape).date1904 ?? false).toBe(false);
      expect(workbook(f.p, f.shape).data).toEqual(bytes);
      expect(P.validatePresentation(f.p)).toEqual([]);
    },
  );
  it.each(["tx", "cat", "val"])(
    "a complete replacement repairs hostile %s metadata without allocating native slots",
    (name) => {
      const f = chartNativeDataDeck(),
        chart = P.getSlideCharts(f.slide)[0],
        str = name !== "val",
        tag = str ? "strLit" : "numLit";
      replace(
        f,
        name,
        `<c:${tag}><c:ptCount val="4294967295"/>${pt(4294967294, "9")}</c:${tag}>`,
      );
      expect(() => readChartSpec(doc(f).root)).toThrow(RangeError);
      expect(P.getShapeChartSpec(f.shape)).toBeNull();
      const bytes = workbook(f.p, f.shape).data.slice();
      expect(() =>
        P.setChartSpec(chart, { ...chart.spec, title: "Repaired" }),
      ).not.toThrow();
      expect(workbook(f.p, f.shape).data).toEqual(bytes);
      expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([
        3,
        null,
        8,
      ]);
    },
  );
  it("retains namespace bindings used only inside native data attributes", () => {
    const f = chartNativeDataDeck();
    retain(f);
    const d = doc(f),
      ref = firstChildElement(
        firstChildElement(series(d.root)[0], c("val")),
        c("numRef"),
      );
    expect(
      firstChildElement(series(d.root)[0], c("val")).prefixDecls.get("choice"),
    ).toBe("urn:owned:chart-data-choice");
  });
  it.each(["missing part", "wrong type", "missing binding"])(
    "an appearance edit repairs a %s with matching regenerated references",
    (mode) => {
      const f = chartNativeDataDeck(),
        pkg = P._internalPackageOf(f.p),
        old = workbook(f.p, f.shape),
        bytes = old.data.slice();
      if (mode === "missing part") pkg.removePart(old.name);
      if (mode === "wrong type") old.contentType = "application/vnd.ms-excel";
      if (mode === "missing binding") {
        const d = doc(f);
        d.root.children = d.root.children.filter(
          (n) => n !== firstChildElement(d.root, c("externalData")),
        );
        save(f, d);
      }
      appearance(f);
      const book = workbook(f.p, f.shape);
      expect(book.data).not.toEqual(bytes);
      expect(JSON.stringify(channels(f))).toContain("Sheet1");
      if (mode !== "missing part") expect(old.data).toEqual(bytes);
      expect(P.validatePresentation(f.p)).toEqual([]);
    },
  );
  it("linked external sources keep their native formulas on an appearance edit", () => {
    const f = chartNativeDataDeck(),
      pkg = P._internalPackageOf(f.p),
      owner = chartRoot(f.shape),
      rels = pkg.getRels(owner),
      before = channels(f),
      old = workbook(f.p, f.shape),
      bytes = old.data.slice();
    const rel = rels.items.find((r) => r.type.endsWith("/package"));
    rel.targetMode = "External";
    rel.target = "https://example.com/regional.xlsx";
    pkg.setRels(owner, rels);
    appearance(f);
    expect(channels(f)).toEqual(before);
    expect(old.data).toEqual(bytes);
    expect(pkg.getRels(owner).items.find((r) => r.id === rel.id)).toEqual(rel);
  });
  it("sparse API blank slots match the native blank cache semantics", () => {
    const f = chartNativeDataDeck(),
      chart = P.getSlideCharts(f.slide)[0],
      bytes = workbook(f.p, f.shape).data.slice(),
      values = [3, , 8];
    P.setChartSpec(chart, {
      ...chart.spec,
      series: [{ ...chart.spec.series[0], values }, chart.spec.series[1]],
    });
    expect(workbook(f.p, f.shape).data).toEqual(bytes);
  });
});

it("native data comparison leaves source, spec and generated channels unchanged after a later mismatch", () => {
  const f = chartNativeDataDeck(),
    source = doc(f).root,
    spec = P.getShapeChartSpec(f.shape),
    sourceBefore = serializeXml({
      kind: "document",
      root: source,
      prolog: [],
      epilog: [],
    });
  spec.series[1].values[0] = 77;
  const target = buildChartSpaceDoc(spec, "workbook"),
    targetBefore = serializeXml(target),
    specBefore = structuredClone(spec);
  expect(preserveNativeChartData(source, target.root, spec)).toBe(false);
  expect(serializeXml(target)).toBe(targetBefore);
  expect(
    serializeXml({ kind: "document", root: source, prolog: [], epilog: [] }),
  ).toBe(sourceBefore);
  expect(spec).toEqual(specBefore);
});
