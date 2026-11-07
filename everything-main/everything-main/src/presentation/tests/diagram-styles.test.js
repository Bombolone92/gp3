import { describe, expect, it } from "vitest";
import {
  NS,
  parseXml,
  serializeXml,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramStyles } from "../lib/pptx/src/internal/diagram/styles.ts";

const point = (id, type = "node", properties = "") =>
  `<d:pt modelId="${id}" type="${type}"><d:prSet ${properties}/></d:pt>`;
const edge = (id, from, to, extra = "") =>
  `<d:cxn modelId="${id}" srcId="${from}" destId="${to}" ${extra}/>`;
const doc = (root, contents) =>
  parseXml(
    `<d:${root} xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}">${contents}</d:${root}>`,
  );
const model = (points, edges = "") =>
  readDiagramDataModel(
    doc(
      "dataModel",
      `<d:ptLst>${points}</d:ptLst><d:cxnLst>${edges}</d:cxnLst>`,
    ).root,
  );
const layout = (contents) => doc("layoutDef", contents).root;
const node = (name, label, contents = '<d:alg type="tx"/>') =>
  `<d:layoutNode name="${name}" styleLbl="${label}">${contents}</d:layoutNode>`;
const labels = (root, names) =>
  doc(root, names.map((name) => `<d:styleLbl name="${name}"/>`).join("")).root;
const attr = (el, name) => getAttrValue(el, qname("", name, ""));

describe("SmartArt text style binding", () => {
  it("selects a text-fill palette interval while retaining its theme color nodes", () => {
    const data = model(
      point("1", "pres", 'presName="text" presStyleIdx="1" presStyleCnt="3"'),
    );
    const colors = doc(
      "colorsDef",
      '<d:styleLbl name="label"><d:txFillClrLst meth="span"><a:schemeClr val="accent1"/><a:schemeClr val="accent6"/></d:txFillClrLst></d:styleLbl>',
    ).root;
    const style = readDiagramStyles(
      data,
      layout(node("text", "label")),
      null,
      colors,
    ).textStyle("1");
    expect(style.issues).toEqual([]);
    expect(style.textFill.amount).toBe(0.5);
    expect(attr(style.textFill.from, "val")).toBe("accent1");
    expect(attr(style.textFill.to, "val")).toBe("accent6");
  });

  it("retains unsupported color data with a diagnostic instead of choosing an arbitrary entry", () => {
    const data = model(point("1", "pres", 'presName="text"'));
    const colors = doc(
      "colorsDef",
      '<d:styleLbl name="label"><d:txFillClrLst meth="future"><a:schemeClr val="accent1"/></d:txFillClrLst></d:styleLbl>',
    ).root;
    const style = readDiagramStyles(
      data,
      layout(node("text", "label")),
      null,
      colors,
    ).textStyle("1");
    expect(style.textFill).toBeNull();
    expect(style.colors).toBe(colors.children[0]);
    expect(style.issues).toEqual(["unknown diagram color method future"]);
  });

  it("uses palette indexing from the associated text node rather than its geometry sibling", () => {
    const data = model(
      point(
        "1",
        "pres",
        'presAssocID="10" presName="geometry" presStyleIdx="9" presStyleCnt="12"',
      ) +
        point(
          "2",
          "pres",
          'presAssocID="10" presName="text" presStyleIdx="+02" presStyleCnt="6"',
        ),
    );
    const styles = readDiagramStyles(
      data,
      layout(
        node("geometry", "shape", '<d:alg type="sp"/>') +
          node("text", "content"),
      ),
      null,
      null,
    );
    expect(styles.textStyle("1")).toMatchObject({
      label: "content",
      styleIndex: 2,
      styleCount: 6,
      issues: [],
    });
  });

  it("diagnoses ambiguous and invalid palette indexing without inventing defaults", () => {
    const data = model(
      point("1", "pres", 'presAssocID="10" presName="geometry"') +
        point(
          "2",
          "pres",
          'presAssocID="10" presName="a" presStyleIdx="0" presStyleCnt="2"',
        ) +
        point(
          "3",
          "pres",
          'presAssocID="10" presName="b" presStyleIdx="1" presStyleCnt="2"',
        ) +
        point("4", "pres", 'presName="a" presStyleIdx="-1" presStyleCnt="0"') +
        point("5", "pres", 'presName="a"'),
    );
    const styles = readDiagramStyles(
      data,
      layout(node("a", "text") + node("b", "text")),
      null,
      null,
    );
    expect(styles.textStyle("1")).toMatchObject({
      styleIndex: null,
      styleCount: 2,
      issues: ["ambiguous diagram presStyleIdx"],
    });
    expect(styles.textStyle("4")).toMatchObject({
      styleIndex: null,
      styleCount: null,
      issues: ["invalid diagram presStyleIdx", "invalid diagram presStyleCnt"],
    });
    expect(styles.textStyle("5")).toMatchObject({
      styleIndex: null,
      styleCount: null,
      issues: [],
    });
  });

  it("keeps heading and body styles and node depths distinct despite a shared association", () => {
    const data = model(
      point("0", "doc") +
        point("1") +
        point("2") +
        point("3", "pres", 'presAssocID="1" presName="heading"') +
        point("4", "pres", 'presAssocID="1" presName="body"'),
      edge("10", "0", "1") +
        edge("11", "1", "2") +
        edge("12", "1", "3", 'type="presOf"') +
        edge("13", "2", "4", 'type="presOf"'),
    );
    const styles = readDiagramStyles(
      data,
      layout(node("heading", "title") + node("body", "content")),
      labels("styleDef", ["content", "title"]),
      labels("colorsDef", ["title", "content"]),
    );
    for (const [id, label, level, source] of [
      ["3", "title", 0, "1"],
      ["4", "content", 1, "2"],
    ]) {
      const style = styles.textStyle(id);
      expect(style.label).toBe(label);
      expect(attr(style.quickStyle, "name")).toBe(label);
      expect(attr(style.colors, "name")).toBe(label);
      expect(style.sources.map((s) => [s.point.id, s.level])).toEqual([
        [source, level],
      ]);
      expect(style.issues).toEqual([]);
    }
  });

  it("finds the associated text algorithm for a geometry node, using semantic contributors to disambiguate", () => {
    const data = model(
      point("1") +
        point("2") +
        point("3", "pres", 'presAssocID="1" presName="geometry"') +
        point("4", "pres", 'presAssocID="01" presName="heading"') +
        point("5", "pres", 'presAssocID="1" presName="body"'),
      edge("10", "2", "3", 'type="presOf"') +
        edge("11", "1", "4", 'type="presOf"') +
        edge("12", "2", "5", 'type="presOf"'),
    );
    const styles = readDiagramStyles(
      data,
      layout(
        node("geometry", "shape", '<d:alg type="sp"/>') +
          node("heading", "title") +
          node("body", "content"),
      ),
      null,
      null,
    );
    expect(styles.textStyle("3").label).toBe("content");
    expect(
      styles.textStyle("3").layoutNodes.map((n) => attr(n, "name")),
    ).toEqual(["body"]);
    expect(styles.textStyle("3").sources.map((s) => s.point.id)).toEqual(["2"]);
  });

  it("does not classify a parent as a text node just because its child has a text algorithm", () => {
    const data = model(
      point("1", "pres", 'presName="parent"') +
        point("2", "pres", 'presName="child"'),
    );
    const styles = readDiagramStyles(
      data,
      layout(
        node("parent", "wrong", '<d:alg type="lin"/>' + node("child", "right")),
      ),
      null,
      null,
    );
    expect(styles.textStyle("1").label).toBeNull();
    expect(styles.textStyle("1").layoutNodes).toEqual([]);
    expect(styles.textStyle("2").label).toBe("right");
  });

  it("recognizes a text algorithm in a choose branch and honors the saved presentation style override", () => {
    const data = model(
      point("1", "pres", 'presName="conditional" presStyleLbl="chosen"'),
    );
    const styles = readDiagramStyles(
      data,
      layout(
        node(
          "conditional",
          "default",
          '<d:choose><d:if func="cnt" op="equ" val="1"><d:alg type="tx"/></d:if><d:else><d:alg type="sp"/></d:else></d:choose>',
        ),
      ),
      labels("styleDef", ["chosen", "default"]),
      null,
    );
    expect(styles.textStyle("1").label).toBe("chosen");
    expect(attr(styles.textStyle("1").quickStyle, "name")).toBe("chosen");
  });

  it("reports conflicting associations and duplicate labels rather than selecting arbitrary styles", () => {
    const data = model(
      point("1", "pres", 'presAssocID="10" presName="shape"') +
        point("2", "pres", 'presAssocID="10" presName="a"') +
        point("3", "pres", 'presAssocID="10" presName="b"'),
    );
    const styles = readDiagramStyles(
      data,
      layout(node("a", "one") + node("b", "two")),
      labels("styleDef", ["one", "one"]),
      labels("colorsDef", ["one", "one"]),
    );
    expect(styles.textStyle("1").label).toBeNull();
    expect(styles.textStyle("1").issues).toEqual([
      "ambiguous diagram text style",
    ]);
    expect(styles.textStyle("2").quickStyle).toBeNull();
    expect(styles.textStyle("2").colors).toBeNull();
    expect(styles.textStyle("2").issues).toEqual([
      "duplicate diagram quick-style label one",
      "duplicate diagram color-style label one",
    ]);
  });

  it("retains multiple contributors in paragraph order with each source's own depth", () => {
    const data = model(
      point("1") + point("2") + point("3", "pres"),
      edge("10", "1", "2") +
        edge("11", "1", "3", 'type="presOf" destOrd="1"') +
        edge("12", "2", "3", 'type="presOf" destOrd="0"'),
    );
    expect(
      readDiagramStyles(data, null, null, null)
        .textStyle("3")
        .sources.map((s) => [s.point.id, s.level]),
    ).toEqual([
      ["2", 1],
      ["1", 0],
    ]);
  });

  it("does not invent a node level for cyclic, dangling, or ambiguous ancestry", () => {
    const data = model(
      [1, 2, 3, 4, 5, 6, 7].map((n) => point(String(n))).join(""),
      edge("10", "1", "2") +
        edge("11", "2", "1") +
        edge("12", "99", "3") +
        edge("13", "4", "6") +
        edge("14", "5", "6") +
        edge("15", "6", "7"),
    );
    const styles = readDiagramStyles(data, null, null, null);
    for (const id of ["1", "2", "3", "6", "7", "1", "7"])
      expect(styles.textStyle(id).sources[0].level).toBeNull();
    expect(styles.textStyle("4").sources[0].level).toBe(0);
    expect(styles.textStyle("unknown")).toBeNull();
  });

  it("ignores duplicate edges from the same parent and presentation-parent edges in node depth", () => {
    const data = model(
      point("1") + point("2") + point("3", "pres"),
      edge("10", "1", "2") +
        edge("11", "01", "2") +
        edge("12", "3", "2", 'type="presParOf"'),
    );
    expect(
      readDiagramStyles(data, null, null, null).textStyle("2").sources[0].level,
    ).toBe(1);
  });

  it("handles deep semantic ancestry without recursive traversal or a nine-level clamp", () => {
    const points = [],
      edges = [];
    for (let i = 0; i < 12000; i++) {
      points.push(point(String(i)));
      if (i) edges.push(edge(String(i), String(i - 1), String(i)));
    }
    const styles = readDiagramStyles(
      model(points.join(""), edges.join("")),
      null,
      null,
      null,
    );
    expect(styles.textStyle("11999").sources[0].level).toBe(11999);
    expect(styles.textStyle("11").sources[0].level).toBe(11);
  });

  it("reads only the diagram list-style extension and leaves all source documents unchanged", () => {
    const xml = doc(
      "layoutDef",
      '<d:extLst><a:ext uri="unrelated"><lstStyle xmlns="urn:foreign"/></a:ext><a:ext uri="{68A01E43-0DF5-4B5B-8FA6-DAF915123BFB}"><d16:lstStyle xmlns:d16="http://schemas.microsoft.com/office/drawing/2016/12/diagram"><a:defPPr/><a:lvl1pPr><a:defRPr b="1"/></a:lvl1pPr></d16:lstStyle></a:ext></d:extLst>' +
        node("text", "label"),
    );
    const data = doc(
      "dataModel",
      `<d:ptLst>${point("1", "pres", 'presName="text"')}</d:ptLst>`,
    );
    const quick = doc(
      "styleDef",
      '<d:styleLbl name="label"><d:txPr><a:flatTx z="0"/></d:txPr></d:styleLbl>',
    );
    const before = [xml, data, quick].map(serializeXml);
    const styles = readDiagramStyles(
      readDiagramDataModel(data.root),
      xml.root,
      quick.root,
      null,
    );
    expect(styles.listStyle.name.namespaceURI).toBe(
      "http://schemas.microsoft.com/office/drawing/2016/12/diagram",
    );
    expect(styles.textStyle("1").quickStyle.children[0].name.localName).toBe(
      "txPr",
    );
    expect([xml, data, quick].map(serializeXml)).toEqual(before);
  });

  it("ignores foreign-namespace algorithms and style labels", () => {
    const data = model(point("1", "pres", 'presName="text"'));
    const styles = readDiagramStyles(
      data,
      layout(node("text", "label", '<alg xmlns="urn:foreign" type="tx"/>')),
      doc("styleDef", '<styleLbl xmlns="urn:foreign" name="label"/>').root,
      null,
    );
    expect(styles.textStyle("1").layoutNodes).toEqual([]);
    expect(styles.textStyle("1").quickStyle).toBeNull();
  });
});
