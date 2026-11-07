import { describe, it, expect } from "vitest";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { P, createDeck } from "../src/model.js";
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
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
import {
  workbookRange,
  resizedRange,
} from "../lib/pptx/src/internal/chartml/workbook-reference.ts";
import { NativeChartWorkbook } from "../lib/pptx/src/internal/chartml/native-workbook.ts";
import { buildEmbeddedXlsx } from "../lib/pptx/src/internal/chartml/embedded-xlsx.ts";
const c = (n) => qname("c", n, NS.chart),
  s = (n) => qname("", n, NS.sml);
const entries = (f) => unzipSync(workbook(f.p, f.shape).data);
const text = (f) =>
  strFromU8(P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data);
const edit = (f, fn) => {
  const chart = P.getSlideCharts(f.slide)[0],
    spec = structuredClone(chart.spec);
  fn(spec);
  P.setChartSpec(chart, spec);
};
const valueEdit = (f) =>
  edit(f, (s) => {
    s.series[0].values[0] = 23;
  });
const formulas = (f) => {
  const out = [];
  walkElements(parseXml(text(f)).root, (e) => {
    if (e.name.namespaceURI === NS.chart && e.name.localName === "f")
      out.push(e.children.map((n) => n.data ?? "").join(""));
  });
  return out;
};
const changed = (before, after) =>
  Object.keys(before).filter(
    (n) => !after[n] || Buffer.compare(before[n], after[n]) !== 0,
  );
const replaceEntry = (f, name, fn) => {
  const zip = entries(f);
  zip[name] = strToU8(fn(strFromU8(zip[name])));
  workbook(f.p, f.shape).data = zipSync(zip);
};
const cell = (xml, ref) => {
  let out;
  walkElements(parseXml(xml).root, (e) => {
    if (
      e.name.namespaceURI === NS.sml &&
      e.name.localName === "c" &&
      e.attrs.some((a) => a.name.localName === "r" && a.value === ref)
    )
      out = e;
  });
  return out;
};
describe("native workbook chart data editing", () => {
  it.each(["bar", "column", "line", "area", "pie", "doughnut"])(
    "%s value edits preserve native workbook structure and cell styles",
    async (kind) => {
      const f = chartNativeDataDeck(kind),
        before = entries(f),
        refs = formulas(f);
      valueEdit(f);
      const after = entries(f);
      expect(Object.keys(after)).toEqual(Object.keys(before));
      expect(changed(before, after).sort()).toEqual([
        "xl/workbook.xml",
        "xl/worksheets/sheet1.xml",
      ]);
      expect(formulas(f)).toEqual(refs);
      const v = cell(strFromU8(after["xl/worksheets/sheet1.xml"]), "E8");
      expect(firstChildElement(v, s("v")).children[0].data).toBe("23");
      expect(v.attrs.find((a) => a.name.localName === "s").value).toBe("1");
      const q = await P.loadPresentation(await P.savePresentation(f.p)),
        chart = P.getSlideCharts(P.getSlides(q)[0])[0];
      expect(chart.spec.series[0].values[0]).toBe(23);
      expect(
        unzipSync(workbook(q, chart.shape).data)["xl/tables/table1.xml"],
      ).toEqual(before["xl/tables/table1.xml"]);
      expect(P.validatePresentation(q)).toEqual([]);
    },
  );
  it("caption and category edits update the native cells and table headers without discarding styles", () => {
    const f = chartNativeDataDeck(),
      before = entries(f),
      refs = formulas(f);
    edit(f, (s) => {
      s.series[0].name = "Net sales";
      s.categories[1] = " New & west ";
    });
    const after = entries(f);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(formulas(f)).toEqual(refs);
    expect(strFromU8(after["xl/worksheets/sheet1.xml"])).toContain("Net sales");
    expect(strFromU8(after["xl/worksheets/sheet1.xml"])).toContain(
      " New &amp; west ",
    );
    expect(strFromU8(after["xl/tables/table1.xml"])).toContain(
      'name="Net sales"',
    );
    expect(after["xl/styles.xml"]).toEqual(before["xl/styles.xml"]);
  });
  it("extending chart data grows native ranges, worksheet dimension and a plain source table", () => {
    const f = chartNativeDataDeck(),
      before = entries(f);
    edit(f, (s) => {
      s.categories.push("East");
      for (const series of s.series) series.values.push(11);
    });
    const after = entries(f);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(formulas(f)).toContain("'Region''s data'!$D$8:$D$11");
    expect(strFromU8(after["xl/worksheets/sheet1.xml"])).toContain(
      'ref="D7:F11"',
    );
    expect(strFromU8(after["xl/tables/table1.xml"])).toContain('ref="D7:F11"');
    expect(
      cell(strFromU8(after["xl/worksheets/sheet1.xml"]), "E11").attrs.find(
        (a) => a.name.localName === "s",
      ).value,
    ).toBe("1");
  });
  it("new number formats append styles while retaining original workbook formatting", () => {
    const f = chartNativeDataDeck(),
      before = entries(f);
    edit(f, (s) => {
      s.series[0].numberFormat = "0.0%";
    });
    const after = entries(f);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    const old = parseXml(strFromU8(before["xl/styles.xml"])).root,
      now = parseXml(strFromU8(after["xl/styles.xml"])).root;
    for (const name of [
      "fonts",
      "fills",
      "borders",
      "cellStyleXfs",
      "cellStyles",
    ])
      expect(firstChildElement(now, s(name))).toEqual(
        firstChildElement(old, s(name)),
      );
    expect(strFromU8(after["xl/styles.xml"])).toContain('formatCode="0.0%"');
    expect(P.getShapeChartSpec(f.shape).series[0].numberFormat).toBe("0.0%");
  });
  it("formula cells keep their calculation semantics while the explicitly replaced chart data gets a new worksheet", () => {
    const f = chartNativeDataDeck();
    replaceEntry(f, "xl/worksheets/sheet1.xml", (xml) =>
      xml.replace(
        '<c r="E8" s="1"><v>3</v></c>',
        '<c r="E8" s="1"><f>SUM(F8:F10)</f><v>3</v></c>',
      ),
    );
    const before = entries(f);
    valueEdit(f);
    const after = entries(f);
    expect(after["xl/worksheets/sheet1.xml"]).toEqual(
      before["xl/worksheets/sheet1.xml"],
    );
    expect(after["xl/tables/table1.xml"]).toEqual(
      before["xl/tables/table1.xml"],
    );
    expect(Object.keys(after).length).toBeGreaterThan(
      Object.keys(before).length,
    );
    expect(formulas(f).some((x) => x.includes("Chart Data"))).toBe(true);
    expect(P.validatePresentation(f.p)).toEqual([]);
  });
  it("native workbook features survive series replacement and remain reachable through the original workbook", () => {
    const f = chartNativeDataDeck(),
      before = entries(f);
    edit(f, (s) => {
      s.series = [
        { ...s.series[0], name: "Replacement", values: [13, 17, 19] },
      ];
    });
    const after = entries(f);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(strFromU8(after["xl/tables/table1.xml"])).toContain(
      'name="Replacement"',
    );
    expect(strFromU8(after["xl/tables/table1.xml"])).toContain('name="Costs"');
    for (const ref of ["F7", "F8", "F9", "F10"])
      expect(cell(strFromU8(after["xl/worksheets/sheet1.xml"]), ref)).toEqual(
        cell(strFromU8(before["xl/worksheets/sheet1.xml"]), ref),
      );
    expect(after["xl/styles.xml"]).toEqual(before["xl/styles.xml"]);
    expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([13, 17, 19]);
  });
});

const patchChart = (f, fn) => {
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape));
  part.data = strToU8(fn(strFromU8(part.data)));
};
const addRows = (f, xml) =>
  replaceEntry(f, "xl/worksheets/sheet1.xml", (x) =>
    x.replace("</sheetData>", xml + "</sheetData>"),
  );
const replaceValuesRef = (f, formula) =>
  patchChart(f, (x) => x.replace("'Region''s data'!$E$8:$E$10", formula));
const multiFixture = () => {
  const f = chartNativeDataDeck();
  addRows(
    f,
    '<row r="12"><c r="G12" t="inlineStr"><is><t>Q1</t></is></c><c r="H12" t="inlineStr"><is><t>North</t></is></c></row><row r="13"><c r="G13" t="inlineStr"><is><t>Q1</t></is></c><c r="H13" t="inlineStr"><is><t>South</t></is></c></row><row r="14"><c r="G14" t="inlineStr"><is><t>Q2</t></is></c><c r="H14" t="inlineStr"><is><t>West</t></is></c></row>',
  );
  patchChart(f, (x) =>
    x.replaceAll(
      /<c:cat>[\s\S]*?<\/c:cat>/g,
      `<c:cat><c:multiLvlStrRef><c:f>'Region''s data'!$G$12:$H$14</c:f><c:multiLvlStrCache><c:ptCount val="3"/><c:lvl><c:pt idx="0"><c:v>North</c:v></c:pt><c:pt idx="1"><c:v>South</c:v></c:pt><c:pt idx="2"><c:v>West</c:v></c:pt></c:lvl><c:lvl><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="2"><c:v>Q2</c:v></c:pt></c:lvl></c:multiLvlStrCache></c:multiLvlStrRef></c:cat>`,
    ),
  );
  return f;
};
describe("native workbook source ownership and range forms", () => {
  it("edits row-oriented offset ranges without redirecting other series", () => {
    const f = chartNativeDataDeck();
    addRows(
      f,
      '<row r="12"><c r="H12" s="1"><v>3</v></c><c r="I12" s="1"/><c r="J12" s="1"><v>8</v></c></row>',
    );
    replaceValuesRef(f, "'Region''s data'!$H12:J$12");
    const before = entries(f),
      refs = formulas(f);
    edit(f, (s) => (s.series[0].values[2] = 51));
    const after = entries(f);
    expect(formulas(f)).toEqual(refs);
    expect(
      firstChildElement(
        cell(strFromU8(after["xl/worksheets/sheet1.xml"]), "J12"),
        s("v"),
      ).children[0].data,
    ).toBe("51");
    expect(after["xl/tables/table1.xml"]).toEqual(
      before["xl/tables/table1.xml"],
    );
    expect(P.getShapeChartSpec(f.shape).series[1].values).toEqual([2, 6, -1]);
  });
  it.each([false, true])(
    "static defined ranges retain their name and scope, local=%s",
    (local) => {
      const f = chartNativeDataDeck();
      replaceEntry(f, "xl/workbook.xml", (x) =>
        x.replace(
          "</sheets>",
          `</sheets><definedNames><definedName name="SalesRange"${local ? ' localSheetId="0"' : ""}>'Region''s data'!$E$8:$E$10</definedName></definedNames>`,
        ),
      );
      replaceValuesRef(f, local ? "'Region''s data'!SalesRange" : "SalesRange");
      const refs = formulas(f);
      valueEdit(f);
      expect(formulas(f)).toEqual(refs);
      expect(
        firstChildElement(
          cell(strFromU8(entries(f)["xl/worksheets/sheet1.xml"]), "E8"),
          s("v"),
        ).children[0].data,
      ).toBe("23");
      expect(strFromU8(entries(f)["xl/workbook.xml"])).toContain(
        'name="SalesRange"',
      );
    },
  );
  it("independent edits of aliased series use separate cells and preserve the unchanged series source", () => {
    const f = chartNativeDataDeck();
    patchChart(f, (xml) => {
      const d = parseXml(xml),
        vals = [];
      walkElements(d.root, (e) => {
        if (e.name.namespaceURI === NS.chart && e.name.localName === "val")
          vals.push(e);
      });
      vals[1].children = structuredClone(vals[0].children);
      return serializeXml(d);
    });
    const before = entries(f);
    valueEdit(f);
    const after = entries(f);
    expect(after["xl/worksheets/sheet1.xml"]).toEqual(
      before["xl/worksheets/sheet1.xml"],
    );
    expect(after["xl/tables/table1.xml"]).toEqual(
      before["xl/tables/table1.xml"],
    );
    expect(P.getShapeChartSpec(f.shape).series.map((s) => s.values)).toEqual([
      [23, null, 8],
      [3, null, 8],
    ]);
    expect(
      formulas(f).filter((x) => x === "'Region''s data'!$E$8:$E$10"),
    ).toHaveLength(1);
    expect(formulas(f).some((x) => x.includes("Chart Data"))).toBe(true);
  });
  it.each(["array", "merged", "query table"])(
    "%s source data remains intact when replacing chart values",
    (kind) => {
      const f = chartNativeDataDeck();
      if (kind === "array")
        replaceEntry(f, "xl/worksheets/sheet1.xml", (x) =>
          x.replace(
            '<c r="E8" s="1"><v>3</v></c>',
            '<c r="E8" s="1"><f t="array" ref="E8:E10">F8:F10*2</f><v>3</v></c>',
          ),
        );
      if (kind === "merged")
        replaceEntry(f, "xl/worksheets/sheet1.xml", (x) =>
          x.replace(
            "</sheetData>",
            '</sheetData><mergeCells count="1"><mergeCell ref="E8:E9"/></mergeCells>',
          ),
        );
      if (kind === "query table")
        replaceEntry(f, "xl/tables/table1.xml", (x) =>
          x.replace("<table ", '<table tableType="queryTable" '),
        );
      const before = entries(f);
      edit(f, (s) => (s.series[0].values[1] = 17));
      const after = entries(f);
      expect(after["xl/worksheets/sheet1.xml"]).toEqual(
        before["xl/worksheets/sheet1.xml"],
      );
      expect(after["xl/tables/table1.xml"]).toEqual(
        before["xl/tables/table1.xml"],
      );
      expect(formulas(f).some((x) => x.includes("Chart Data"))).toBe(true);
    },
  );
  it("hierarchy leaf edits retain parent levels, rectangular ranges and parent cells", () => {
    const f = multiFixture(),
      before = entries(f),
      refs = formulas(f);
    edit(f, (s) => (s.categories[1] = "Eastern"));
    expect(formulas(f)).toEqual(refs);
    const after = entries(f),
      xml = strFromU8(after["xl/worksheets/sheet1.xml"]);
    expect(
      firstChildElement(firstChildElement(cell(xml, "H13"), s("is")), s("t"))
        .children[0].data,
    ).toBe("Eastern");
    for (const ref of ["G12", "G13", "G14"])
      expect(cell(xml, ref)).toEqual(
        cell(strFromU8(before["xl/worksheets/sheet1.xml"]), ref),
      );
    expect(text(f)).toContain("multiLvlStrRef");
    expect(text(f)).toContain("Q1");
    expect(text(f)).toContain("Q2");
    expect(P.getShapeChartSpec(f.shape).categories).toEqual([
      "North",
      "Eastern",
      "West",
    ]);
  });
  it("hierarchy resizing retains every level in caches and a new rectangular source", () => {
    const f = multiFixture();
    edit(f, (s) => {
      s.categories.push("Eastern");
      s.series.forEach((x) => x.values.push(13));
    });
    const after = entries(f),
      xml = text(f);
    expect(xml.match(/<c:multiLvlStrRef/g)).toHaveLength(2);
    expect(xml.match(/<c:lvl/g)).toHaveLength(4);
    expect(xml).toContain("Q1");
    expect(xml).toContain("Q2");
    expect(xml).toContain("'Chart Data'!$A$2:$B$5");
    const newsheet = Object.keys(after).find((x) => /chartData.*xml$/.test(x));
    expect(strFromU8(after[newsheet])).toContain("Q1");
    expect(strFromU8(after[newsheet])).toContain("Eastern");
    expect(P.getShapeChartSpec(f.shape).categories).toEqual([
      "North",
      "South",
      "West",
      "Eastern",
    ]);
  });
  it("empty data becomes zero-point literals without erasing native workbook objects", () => {
    const f = chartNativeDataDeck(),
      before = entries(f);
    edit(f, (s) => {
      s.categories = [];
      s.series.forEach((x) => (x.values = []));
    });
    expect(entries(f)).toEqual(before);
    expect(P.getShapeChartSpec(f.shape).categories).toEqual([]);
    expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([]);
    expect(text(f)).toContain("<c:numLit>");
  });
  it("shared outer workbook bindings fork only the edited chart and survive reopen", async () => {
    const f = chartNativeDataDeck(),
      original = workbook(f.p, f.shape),
      bytes = original.data.slice(),
      slide = P.importSlide(f.p, f.slide, P.getSlideLayout(f.slide), {
        preservePaintFormatting: true,
      }),
      chart = P.getSlideCharts(slide)[0],
      pkg = P._internalPackageOf(f.p),
      owner = chartRoot(chart.shape),
      rels = pkg.getRels(owner),
      rel = rels.items.find((r) => r.type.endsWith("/package"));
    rel.target = original.name;
    pkg.setRels(owner, rels);
    P.setChartSpec(chart, {
      ...chart.spec,
      series: chart.spec.series.map((s, i) =>
        i ? s : { ...s, values: [23, null, 8] },
      ),
    });
    expect(original.data).toEqual(bytes);
    expect(workbook(f.p, chart.shape)).not.toBe(original);
    expect(Object.keys(unzipSync(workbook(f.p, chart.shape).data))).toEqual(
      Object.keys(unzipSync(bytes)),
    );
    const q = await P.loadPresentation(await P.savePresentation(f.p)),
      charts = P.getSlides(q).map((s) => P.getSlideCharts(s)[0]);
    expect(charts.map((c) => c.spec.series[0].values)).toEqual([
      [3, null, 8],
      [23, null, 8],
    ]);
    expect(P.validatePresentation(q)).toEqual([]);
  });
  it("template transfers preserve edited workbook objects independently in both directions", async () => {
    const f = chartNativeDataDeck();
    valueEdit(f);
    const bytes = workbook(f.p, f.shape).data.slice(),
      dest = createDeck("blank"),
      forward = P.importSlide(dest, f.slide, P.getSlideLayouts(dest)[0], {
        preservePaintFormatting: true,
      }),
      returned = P.importSlide(f.p, forward, P.getSlideLayout(f.slide), {
        preservePaintFormatting: true,
      }),
      copy = P.getSlideCharts(returned)[0];
    P.setChartSpec(copy, {
      ...copy.spec,
      series: copy.spec.series.map((s, i) =>
        i ? s : { ...s, values: [29, null, 8] },
      ),
    });
    expect(workbook(f.p, f.shape).data).toEqual(bytes);
    expect(workbook(dest, P.getSlideCharts(forward)[0].shape).data).toEqual(
      bytes,
    );
    const q = await P.loadPresentation(await P.savePresentation(f.p)),
      wb = unzipSync(
        workbook(q, P.getSlideCharts(P.getSlides(q).at(-1))[0].shape).data,
      );
    expect(Object.keys(wb)).toEqual(Object.keys(unzipSync(bytes)));
    expect(wb["xl/tables/table1.xml"]).toEqual(
      unzipSync(bytes)["xl/tables/table1.xml"],
    );
    expect(P.validatePresentation(q)).toEqual([]);
  });
  it("Strict SpreadsheetML retains its namespaces and relationship dialect", () => {
    const f = chartNativeDataDeck(),
      zip = entries(f),
      strict = "http://purl.oclc.org/ooxml/spreadsheetml/main",
      rels = "http://purl.oclc.org/ooxml/officeDocument/relationships";
    for (const name of Object.keys(zip).filter((n) => /\.(xml|rels)$/.test(n)))
      zip[name] = strToU8(
        strFromU8(zip[name])
          .replaceAll(NS.sml, strict)
          .replaceAll(NS.officeDocRels, rels),
      );
    workbook(f.p, f.shape).data = zipSync(zip);
    valueEdit(f);
    const now = entries(f);
    expect(strFromU8(now["xl/worksheets/sheet1.xml"])).toContain(strict);
    expect(strFromU8(now["xl/_rels/workbook.xml.rels"])).toContain(rels);
    expect(Object.keys(now)).toEqual(Object.keys(zip));
    expect(strFromU8(now["xl/worksheets/sheet1.xml"])).toContain("<v>23</v>");
  });
});

it("inserting rows and cells preserves implicit native addresses", () => {
  const zip = unzipSync(
    buildEmbeddedXlsx(["N"], [{ label: "A", values: [3] }]),
  );
  zip["xl/worksheets/sheet1.xml"] = strToU8(
    `<worksheet xmlns="${NS.sml}"><sheetData><row r="1"><c><v>1</v></c><c><v>2</v></c></row><row r="5"><c><v>5</v></c></row><row><c><v>6</v></c></row></sheetData></worksheet>`,
  );
  const book = new NativeChartWorkbook(zipSync(zip));
  book.write({ sheet: "Sheet1", address: { row: 3, col: 0 }, value: 4 });
  book.write({ sheet: "Sheet1", address: { row: 0, col: 2 }, value: 3 });
  const now = strFromU8(unzipSync(book.save())["xl/worksheets/sheet1.xml"]);
  expect(firstChildElement(cell(now, "B1"), s("v")).children[0].data).toBe("2");
  const reopened = new NativeChartWorkbook(book.save());
  expect(
    firstChildElement(reopened.cell("Sheet1", { row: 5, col: 0 }), s("v"))
      .children[0].data,
  ).toBe("6");
});

it("numeric category formats reject an incompatible hierarchy atomically", () => {
  const f = multiFixture(),
    xml = text(f),
    bytes = workbook(f.p, f.shape).data.slice();
  expect(() =>
    edit(f, (s) => {
      s.categories = ["1", "2", "3"];
      s.categoryNumberFormat = "0.00";
    }),
  ).toThrow(TypeError);
  expect(text(f)).toBe(xml);
  expect(workbook(f.p, f.shape).data).toEqual(bytes);
});
it("renaming a table-backed caption preserves structured formulas and source headers", () => {
  const f = chartNativeDataDeck();
  replaceEntry(f, "xl/tables/table1.xml", (x) =>
    x.replace(
      '<tableColumn id="3" name="Costs"/>',
      '<tableColumn id="3" name="Costs"><calculatedColumnFormula>[Sales]*2</calculatedColumnFormula></tableColumn>',
    ),
  );
  const before = entries(f);
  edit(f, (s) => (s.series[0].name = "Net sales"));
  expect(entries(f)["xl/tables/table1.xml"]).toEqual(
    before["xl/tables/table1.xml"],
  );
  expect(entries(f)["xl/worksheets/sheet1.xml"]).toEqual(
    before["xl/worksheets/sheet1.xml"],
  );
  expect(formulas(f).some((x) => x.includes("Chart Data"))).toBe(true);
  expect(P.getShapeChartSpec(f.shape).series[0].name).toBe("Net sales");
});

it("editing another value retains untouched native blank-cache metadata", () => {
  const f = chartNativeDataDeck();
  patchChart(f, (x) =>
    x.replace(
      '<c:pt idx="2"><c:v>8</c:v></c:pt>',
      '<c:pt idx="2"><c:v>native-invalid-value</c:v></c:pt>',
    ),
  );
  expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([
    3,
    null,
    null,
  ]);
  valueEdit(f);
  expect(text(f)).toContain("native-invalid-value");
  expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([
    23,
    null,
    null,
  ]);
});

it.each([" true ", "\u00a01\u00a0", "TRUE"])(
  "explicit calendar changes repair workbook Boolean %j",
  (raw) => {
    const zip = unzipSync(buildEmbeddedXlsx([], []));
    zip["xl/workbook.xml"] = strToU8(
      strFromU8(zip["xl/workbook.xml"]).replace(
        "<sheets>",
        `<workbookPr date1904="${raw}"/><sheets>`,
      ),
    );
    const book = new NativeChartWorkbook(zipSync(zip));
    book.setCalendar(false);
    expect(strFromU8(unzipSync(book.save())["xl/workbook.xml"])).toContain(
      'date1904="0"',
    );
  },
);
it("range resizing preserves mixed absolute flags on both endpoints", () => {
  expect(resizedRange(workbookRange("'A B'!$H12:J$12"), 4)).toBe(
    "'A B'!$H12:K$12",
  );
  expect(workbookRange("Sheet!XFE1:XFE2")).toBeNull();
  expect(workbookRange("[External.xlsx]Sheet!A1:A2")).toBeNull();
  expect(workbookRange("Sheet1:Sheet2!A1:A2")).toBeNull();
});

it("root-level workbook parts allocate valid worksheet and style names", () => {
  const zip = unzipSync(buildEmbeddedXlsx([], []));
  zip["workbook.xml"] = zip["xl/workbook.xml"];
  delete zip["xl/workbook.xml"];
  zip["_rels/.rels"] = strToU8(
    strFromU8(zip["_rels/.rels"]).replace("xl/workbook.xml", "workbook.xml"),
  );
  zip["_rels/workbook.xml.rels"] = strToU8(
    strFromU8(zip["xl/_rels/workbook.xml.rels"]).replace(
      "worksheets/sheet1.xml",
      "xl/worksheets/sheet1.xml",
    ),
  );
  delete zip["xl/_rels/workbook.xml.rels"];
  zip["[Content_Types].xml"] = strToU8(
    strFromU8(zip["[Content_Types].xml"]).replace(
      "/xl/workbook.xml",
      "/workbook.xml",
    ),
  );
  const book = new NativeChartWorkbook(zipSync(zip)),
    name = book.newSheet();
  book.write({
    sheet: name,
    address: { row: 0, col: 0 },
    value: 3,
    numberFormat: "0.0%",
  });
  const now = unzipSync(book.save()),
    reopened = new NativeChartWorkbook(book.save());
  expect(now["xl/worksheets/sheet1.xml"]).toEqual(
    zip["xl/worksheets/sheet1.xml"],
  );
  expect(Object.keys(now)).toContain("worksheets/chartData1.xml");
  expect(Object.keys(now)).toContain("styles1.xml");
  expect(strFromU8(now["styles1.xml"])).toContain('formatCode="0.0%"');
  expect(
    firstChildElement(reopened.cell(name, { row: 0, col: 0 }), s("v"))
      .children[0].data,
  ).toBe("3");
});
