import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { P, createDeck, preview } from "../src/model.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import { readChartSpec } from "../lib/pptx/src/internal/chartml/chart-reader.ts";
import { NS, parseXml } from "../lib/pptx/src/internal/xml/index.ts";

const pt = (index, value) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`;
const count = (value) =>
  value === undefined ? "" : `<c:ptCount val="${value}"/>`;
const numeric = (points, size, literal = false) =>
  literal
    ? `<c:numLit>${count(size)}${points}</c:numLit>`
    : `<c:numRef><c:f>Sheet1!$B$2:$B$6</c:f><c:numCache>${count(size)}${points}</c:numCache></c:numRef>`;
function root({
  kind = "bar",
  categories = "",
  values = numeric(pt(0, "3") + pt(2, "8"), 5),
  extra = "",
} = {}) {
  const plot =
    kind === "bar" || kind === "column" ? "barChart" : `${kind}Chart`;
  const direction =
    plot === "barChart"
      ? `<c:barDir val="${kind === "bar" ? "bar" : "col"}"/>`
      : "";
  return parseXml(
    `<c:chartSpace xmlns:c="${NS.chart}"><c:chart><c:plotArea><c:${plot}>${direction}<c:ser><c:idx val="0"/><c:order val="0"/>${categories ? `<c:cat>${categories}</c:cat>` : ""}<c:${kind === "scatter" || kind === "bubble" ? "yVal" : "val"}>${values}</c:${kind === "scatter" || kind === "bubble" ? "yVal" : "val"}>${extra}</c:ser></c:${plot}></c:plotArea></c:chart></c:chartSpace>`,
  ).root;
}
function fixture({
  kind = "line",
  categories = [],
  values = [3, null, 8, null, null],
} = {}) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0],
    shape = P.addSlideChart(slide, {
      x: P.inches(1),
      y: P.inches(1),
      w: P.inches(7),
      h: P.inches(4),
      spec: { kind, categories, series: [{ name: "Slots", values }] },
    });
  return { p, slide, shape };
}
describe("native chart cache slots", () => {
  it.each(["bar", "column", "line", "area", "pie", "doughnut", "radar"])(
    "keeps leading, internal and trailing blanks in %s caches",
    (kind) => {
      const spec = readChartSpec(
        root({ kind, values: numeric(pt(1, "3") + pt(3, "8"), 6) }),
      );
      expect(spec.series[0].values).toEqual([null, 3, null, 8, null, null]);
      expect(Object.keys(spec.series[0].values)).toHaveLength(6);
    },
  );
  it.each([false, true])(
    "retains all-blank and zero-length numeric channels (literal: %s)",
    (literal) => {
      expect(
        readChartSpec(root({ values: numeric("", 4, literal) })).series[0]
          .values,
      ).toEqual([null, null, null, null]);
      expect(
        readChartSpec(root({ values: numeric("", 0, literal) })).series[0]
          .values,
      ).toEqual([]);
      expect(
        readChartSpec(
          root({ values: numeric(pt(0, "0") + pt(2, "-0"), 4, literal) }),
        ).series[0].values,
      ).toEqual([0, null, -0, null]);
    },
  );
  it("retains independent x, y and bubble-size cache extents", () => {
    const spec = readChartSpec(
      root({
        kind: "bubble",
        values: numeric(pt(1, "7"), 4, true),
        extra: `<c:xVal>${numeric(pt(0, "2") + pt(2, "6"), 5)}</c:xVal><c:bubbleSize>${numeric(pt(1, "10"), 3)}</c:bubbleSize>`,
      }),
    );
    expect(spec.series[0].xValues).toEqual([2, null, 6, null, null]);
    expect(spec.series[0].values).toEqual([null, 7, null, null]);
    expect(spec.series[0].bubbleSizes).toEqual([null, 10, null]);
  });
  it.each(["strRef", "strLit", "multiLvlStrRef"])(
    "retains empty labels and the declared %s extent",
    (source) => {
      const points = pt(1, "West") + pt(3, "East");
      const categories =
        source === "strRef"
          ? `<c:strRef><c:strCache>${count(6)}${points}</c:strCache></c:strRef>`
          : source === "strLit"
            ? `<c:strLit>${count(6)}${points}</c:strLit>`
            : `<c:multiLvlStrRef><c:multiLvlStrCache>${count(6)}<c:lvl>${points}</c:lvl></c:multiLvlStrCache></c:multiLvlStrRef>`;
      expect(readChartSpec(root({ categories })).categories).toEqual([
        "",
        "West",
        "",
        "East",
        "",
        "",
      ]);
    },
  );
  it("preserves numeric category blank slots as empty labels", () => {
    expect(
      readChartSpec(root({ categories: numeric(pt(1, "12.5"), 4) })).categories,
    ).toEqual(["", "12.5", "", ""]);
  });
  it("infers omitted counts from valid points without losing holes", () => {
    expect(
      readChartSpec(root({ values: numeric(pt(2, "11"), undefined) })).series[0]
        .values,
    ).toEqual([null, null, 11]);
  });
  it("retains explicit points beyond an undersized declared count", () => {
    expect(
      readChartSpec(root({ values: numeric(pt(0, "3") + pt(4, "9"), 2) }))
        .series[0].values,
    ).toEqual([3, null, null, null, 9]);
  });
  it.each(["5tail", "5.5", "1e2", "-1", "4294967296", ""])(
    "ignores malformed count %j and infers the valid point extent",
    (invalid) => {
      expect(
        readChartSpec(root({ values: numeric(pt(2, "11"), invalid) })).series[0]
          .values,
      ).toEqual([null, null, 11]);
    },
  );
  it("accepts unsigned-integer lexical forms and rejects partial point indices", () => {
    const points =
      pt(" +01 ", "7") +
      pt("2tail", "80") +
      pt("2.5", "90") +
      pt("1e2", "100") +
      pt("-1", "110") +
      pt("4294967296", "120");
    expect(
      readChartSpec(root({ values: numeric(points, " +0004 ") })).series[0]
        .values,
    ).toEqual([null, 7, null, null]);
  });
  it("keeps namespace isolation and last explicit duplicate semantics", () => {
    const points =
      pt(1, "7") +
      pt(1, "9") +
      `<foreign:pt xmlns:foreign="urn:other" idx="4"><foreign:v>99</foreign:v></foreign:pt>`;
    const values = `<c:numLit><foreign:ptCount xmlns:foreign="urn:other" val="8"/>${points}</c:numLit>`;
    expect(readChartSpec(root({ values })).series[0].values).toEqual([null, 9]);
  });
  it("keeps invalid numeric values blank and preserves cached text/CDATA values", () => {
    const values = numeric(
      pt(0, "") +
        pt(1, "NaN") +
        pt(2, "Infinity") +
        '<c:pt idx="3"><c:v><![CDATA[12.5]]></c:v></c:pt>',
      6,
    );
    expect(readChartSpec(root({ values })).series[0].values).toEqual([
      null,
      null,
      null,
      12.5,
      null,
      null,
    ]);
  });
  it("materializes a large sparse cache with complete positions", () => {
    const values = readChartSpec(
      root({ values: numeric(pt(0, "1") + pt(32768, "2"), 65536) }),
    ).series[0].values;
    expect(values).toHaveLength(65536);
    expect(values[32768]).toBe(2);
    expect(values[65535]).toBeNull();
    expect(Object.keys(values)).toHaveLength(65536);
  });
  it("rejects cache metadata that would force a billion-slot allocation", () => {
    expect(() =>
      readChartSpec(root({ values: numeric(pt(0, "1"), "4294967295") })),
    ).toThrow(/chart cache.*materialization limit/i);
    expect(() =>
      readChartSpec(root({ values: numeric(pt("4294967294", "1"), 0) })),
    ).toThrow(/chart cache.*materialization limit/i);
  });
  it("retains oversized native cache parts through unchanged export", async () => {
    const f = fixture(),
      part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape));
    part.data = new TextEncoder().encode(
      strFromU8(part.data).replace(
        'ptCount val="5"',
        'ptCount val="4294967295"',
      ),
    );
    const original = part.data.slice();
    expect(P.getShapeChartSpec(f.shape)).toBeNull();
    const loaded = await P.loadPresentation(await P.savePresentation(f.p)),
      loadedShape = P.getSlideCharts(P.getSlides(loaded)[0])[0].shape;
    expect(
      P._internalPackageOf(loaded).getPart(chartRoot(loadedShape)).data,
    ).toEqual(original);
    expect(P.getShapeChartSpec(loadedShape)).toBeNull();
    expect(part.data).toEqual(original);
  });
  it("retains authored blank slots through read, edit, export and native transfer both ways", async () => {
    const f = fixture(),
      pkg = P._internalPackageOf(f.p),
      part = pkg.getPart(chartRoot(f.shape)),
      before = part.data.slice(),
      spec = P.getShapeChartSpec(f.shape);
    expect(spec.series[0].values).toEqual([3, null, 8, null, null]);
    expect(part.data).toEqual(before);
    const loaded = await P.loadPresentation(await P.savePresentation(f.p)),
      source = P.getSlides(loaded)[0],
      q = createDeck("blank"),
      target = P.importSlide(q, source, P.getSlideLayouts(q)[0]),
      back = P.importSlide(loaded, target, P.getSlideLayout(source));
    for (const slide of [source, target, back])
      expect(P.getSlideCharts(slide)[0].spec.series[0].values).toEqual([
        3,
        null,
        8,
        null,
        null,
      ]);
    expect(preview(q, target)).toBe(preview(loaded, source));
    const returned = P.getSlideCharts(back)[0],
      originalWorkbook = workbook(
        loaded,
        P.getSlideCharts(source)[0].shape,
      ).data.slice();
    P.setChartSpec(returned, {
      ...returned.spec,
      title: "Blank slots retained",
    });
    expect(P.getShapeChartSpec(returned.shape).series[0].values).toEqual([
      3,
      null,
      8,
      null,
      null,
    ]);
    const sheet = strFromU8(
      unzipSync(workbook(loaded, returned.shape).data)[
        "xl/worksheets/sheet1.xml"
      ],
    );
    expect(sheet).toContain('<row r="6">');
    expect(sheet).not.toContain('r="B5"');
    expect(sheet).not.toContain('r="B6"');
    expect(workbook(loaded, P.getSlideCharts(source)[0].shape).data).toEqual(
      originalWorkbook,
    );
    const reopened = await P.loadPresentation(await P.savePresentation(loaded));
    expect(
      P.getSlideCharts(P.getSlides(reopened).at(-1))[0].spec.series[0].values,
    ).toEqual([3, null, 8, null, null]);
    expect(P.validatePresentation(reopened)).toEqual([]);
    expect(P.validatePresentation(q)).toEqual([]);
  });
});
