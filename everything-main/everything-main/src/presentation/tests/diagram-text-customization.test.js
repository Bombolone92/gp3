import { describe, expect, it } from "vitest";
import native from "./data/diagram-text-customization-native.json";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { readDiagramTextCustomization } from "../lib/pptx/src/internal/diagram/text-customization.ts";
import { evaluateDiagramInitialConstraints } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";

const expand = (data, layout) => {
  const model = readDiagramDataModel(data.root);
  return {
    model,
    root: expandDiagramLayout(layout.root, readDiagramHierarchy(model)),
  };
};
const fixture = (content, flag = 'custT="1"') => {
  const data =
    parseXml(`<d:dataModel xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}" xmlns:x="urn:foreign">
    <d:ptLst><d:pt modelId="0" type="doc"/><d:pt modelId="1"><d:prSet ${flag}/>${content === null ? "" : `<d:t><a:bodyPr/><a:lstStyle/>${content}</d:t>`}</d:pt></d:ptLst>
    <d:cxnLst><d:cxn modelId="edge" srcId="0" destId="1"/></d:cxnLst></d:dataModel>`);
  const layout = parseXml(
    `<d:layoutNode xmlns:d="${NS.diagram}"><d:alg type="tx"/><d:presOf axis="ch" ptType="node"/></d:layoutNode>`,
  );
  return { ...expand(data, layout), data };
};

// XML fixtures are authored inputs. Expected geometry/insets were measured
// from the native layout of them, independently of the reader under test.
describe("SmartArt semantic text customization", () => {
  it.each(native.cases)(
    "matches native selection and dependent references: $name",
    (row) => {
      const data = parseXml(native.models[row.model]);
      const layout = parseXml(native.layouts[row.layout]);
      const before = [serializeXml(data), serializeXml(layout)];
      const { root } = expand(data, layout);
      const node = root.children.find((child) => child.name === "text");
      const custom = readDiagramTextCustomization(node);
      expect(custom !== null).toBe(row.expected.custom);
      if (custom)
        expect(node.contributors.some((c) => c.point === custom.source)).toBe(
          true,
        );
      // This reader preserves authored fractional sizes; whole-point font
      // realization remains a subsequent stage.
      const changes = custom
        ? [
            {
              owner: node,
              property: {
                type: "primFontSz",
                selector: { relationship: "self", name: "", pointType: "all" },
              },
              value: Math.round(custom.primaryFontSize),
            },
          ]
        : [];
      const result = evaluateDiagramInitialConstraints(
        root,
        { w: 300, h: 100 },
        { changes },
      ).get(node);
      expect(result.size.h).toBe(row.expected.primaryFontSize);
      expect(Math.round(result.values.get("lMarg") * 12700)).toBe(
        row.expected.leftInset,
      );
      expect(Math.round(result.values.get("rMarg") * 12700)).toBe(
        row.expected.rightInset,
      );
      expect([serializeXml(data), serializeXml(layout)]).toEqual(before);
    },
  );

  it.each(['custT="0"', 'custT="false"', ""])(
    "keeps noncustom text under layout control: %s",
    (flag) => {
      const { root } = fixture(
        '<a:p><a:r><a:rPr sz="invalid"/><a:t>Text</a:t></a:r></a:p>',
        flag,
      );
      expect(readDiagramTextCustomization(root)).toBeNull();
    },
  );

  it.each(['custT="1"', 'custT="true"', 'custT=" true "'])(
    "preserves fractional sizes and source identity: %s",
    (flag) => {
      const { root, model } = fixture(
        '<a:p><a:r><a:rPr sz="1425"/><a:t>Text</a:t></a:r></a:p>',
        flag,
      );
      expect(readDiagramTextCustomization(root)).toEqual({
        source: model.point("1"),
        primaryFontSize: 14.25,
      });
    },
  );

  it("ignores foreign vocabulary and empty runs but counts CDATA whitespace", () => {
    const { root } = fixture(
      '<x:p><a:r><a:rPr sz="9900"/><a:t>Foreign</a:t></a:r></x:p><a:p><x:r><a:rPr sz="8800"/><a:t>Foreign</a:t></x:r><a:r><a:rPr sz="invalid"/><a:t/></a:r><a:r><a:rPr sz="1750"/><a:t><![CDATA[ ]]></a:t></a:r><a:r><a:rPr sz="3000"/><a:t>Later</a:t></a:r></a:p>',
    );
    expect(readDiagramTextCustomization(root).primaryFontSize).toBe(17.5);
  });

  it.each([
    null,
    "<a:p/>",
    '<a:p><a:pPr><a:defRPr sz="1400"/></a:pPr><a:r><a:t>Text</a:t></a:r><a:endParaRPr sz="2200"/></a:p>',
  ])(
    "distinguishes a customized default font from noncustom text: %s",
    (content) => {
      const { root, model } = fixture(content);
      expect(readDiagramTextCustomization(root)).toEqual({
        source: model.point("1"),
        primaryFontSize: 36,
      });
    },
  );

  it.each(["", "yes", "2", "True"])(
    "rejects an invalid customization flag: %s",
    (flag) => {
      const { root } = fixture("<a:p/>", `custT="${flag}"`);
      expect(() => readDiagramTextCustomization(root)).toThrow(
        "invalid diagram custom text flag",
      );
    },
  );

  it.each(["", "NaN", "INF", "14.5", "1e3", "99", "400001", "-1200"])(
    "rejects an invalid authored font size: %s",
    (size) => {
      const { root, data } = fixture(
        `<a:p><a:r><a:rPr sz="${size}"/><a:t>Text</a:t></a:r></a:p>`,
      );
      const before = serializeXml(data);
      expect(() => readDiagramTextCustomization(root)).toThrow(
        "invalid diagram custom text font size",
      );
      expect(serializeXml(data)).toBe(before);
    },
  );

  it.each([100, 400000])(
    "accepts the DrawingML font-size boundary %s",
    (size) => {
      const { root } = fixture(
        `<a:p><a:r><a:rPr sz="+${size}"/><a:t>Text</a:t></a:r></a:p>`,
      );
      expect(readDiagramTextCustomization(root).primaryFontSize).toBe(
        size / 100,
      );
    },
  );
});
