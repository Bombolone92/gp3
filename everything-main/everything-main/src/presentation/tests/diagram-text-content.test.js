import { describe, expect, it } from "vitest";
import native from "./data/diagram-text-content-native.json";
import {
  NS,
  parseXml,
  serializeXml,
  textContent,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { readDiagramTextParagraphs } from "../lib/pptx/src/internal/diagram/text-content.ts";

const expand = (data, layout) =>
  expandDiagramLayout(
    layout.root,
    readDiagramHierarchy(readDiagramDataModel(data.root)),
  );
const fixture = (
  paragraphs = "<a:p><a:r><a:t>Text</a:t></a:r></a:p>",
  parameters = "",
  mapping = 'axis="ch" ptType="node"',
) => {
  const data = parseXml(
    `<d:dataModel xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}" xmlns:x="urn:foreign"><d:ptLst><d:pt modelId="0" type="doc"/><d:pt modelId="1">${paragraphs === null ? "" : `<d:t><a:bodyPr/><a:lstStyle/>${paragraphs}</d:t>`}</d:pt></d:ptLst><d:cxnLst><d:cxn modelId="edge" srcId="0" destId="1"/></d:cxnLst></d:dataModel>`,
  );
  const layout = parseXml(
    `<d:layoutNode xmlns:d="${NS.diagram}" xmlns:x="urn:foreign"><d:alg type="tx">${parameters}</d:alg><d:presOf ${mapping}/></d:layoutNode>`,
  );
  return { data, layout, node: expand(data, layout) };
};

describe("semantic SmartArt paragraph content", () => {
  it.each(native.cases)(
    "matches independent native paragraph levels: $name",
    (row) => {
      const data = parseXml(native.models[row.model]),
        layout = parseXml(native.layouts[row.layout]),
        before = [serializeXml(data), serializeXml(layout)];
      const node = expand(data, layout).children.find((n) => n.name === "text");
      if (row.expected === null) {
        // The native reference rejected these authored parameters and
        // substituted a default diagram. Never treat that fallback drawing as
        // a successful layout.
        expect(() => readDiagramTextParagraphs(node)).toThrow(
          "invalid diagram starting bullet level",
        );
        expect([serializeXml(data), serializeXml(layout)]).toEqual(before);
        return;
      }
      const result = readDiagramTextParagraphs(node);
      expect(
        result.map(({ paragraph, hierarchyLevel, level, font }) => ({
          hierarchyLevel,
          level,
          font,
          text: paragraph ? textContent(paragraph) : "",
        })),
      ).toEqual(row.expected);
      for (const item of result) {
        expect(node.contributors).toContain(item.source);
        if (item.paragraph)
          expect(item.source.point.text.children).toContain(item.paragraph);
      }
      expect([serializeXml(data), serializeXml(layout)]).toEqual(before);
    },
  );
  it("preserves paragraph order, source identities, fields, breaks and empty paragraphs", () => {
    const { node, data } = fixture(
      '<a:p><a:pPr lvl="3"/><a:fld id="field"><a:t>Field</a:t></a:fld><a:br/><a:r><a:t>After</a:t></a:r></a:p><a:p/><x:p><a:r><a:t>Foreign</a:t></a:r></x:p><a:p><a:pPr lvl="0"/><a:r><a:t>Last</a:t></a:r></a:p>',
    );
    const before = serializeXml(data),
      result = readDiagramTextParagraphs(node);
    expect(result.map((p) => [p.level, p.hierarchyLevel, p.font])).toEqual([
      [3, 0, "primary"],
      [0, 0, "primary"],
      [0, 0, "primary"],
    ]);
    expect(
      result[0].paragraph.children.some(
        (c) => c.kind === "element" && c.name.localName === "fld",
      ),
    ).toBe(true);
    expect(
      result[0].paragraph.children.some(
        (c) => c.kind === "element" && c.name.localName === "br",
      ),
    ).toBe(true);
    expect(result.every((p) => p.source === node.contributors[0])).toBe(true);
    expect(serializeXml(data)).toBe(before);
  });
  it("retains an absent body as an empty semantic paragraph", () => {
    const { node } = fixture(null, '<d:param type="stBulletLvl" val="1"/>');
    expect(readDiagramTextParagraphs(node)).toEqual([
      {
        source: node.contributors[0],
        paragraph: null,
        hierarchyLevel: 1,
        level: 1,
        font: "secondary",
      },
    ]);
  });
  it("returns no text for an empty presentation-of selection", () => {
    const { node } = fixture(undefined, "", "");
    expect(readDiagramTextParagraphs(node)).toEqual([]);
  });
  it("ignores foreign parameter and paragraph properties", () => {
    const { node } = fixture(
      '<a:p><x:pPr lvl="8"/><a:r><a:t>Text</a:t></a:r></a:p>',
      '<x:param type="stBulletLvl" val="1"/>',
    );
    expect(readDiagramTextParagraphs(node)[0].level).toBe(0);
  });
  it.each(["1", "+1", "01"])(
    "accepts numeric parameter representation %s",
    (value) => {
      const { node } = fixture(
        undefined,
        `<d:param type="stBulletLvl" val="${value}"/>`,
      );
      expect(readDiagramTextParagraphs(node)[0].hierarchyLevel).toBe(1);
    },
  );
  it.each(["", " 1 ", "1.0", "1.5", "1e0", "NaN", "INF", "word", "0x1"])(
    "rejects invalid starting level %s",
    (value) => {
      const { node } = fixture(
        undefined,
        `<d:param type="stBulletLvl" val="${value}"/>`,
      );
      expect(() => readDiagramTextParagraphs(node)).toThrow(
        "invalid diagram starting bullet level",
      );
    },
  );
  it.each(["", "-1", "9", "1.0", "NaN", "1e0"])(
    "rejects invalid paragraph level %s",
    (value) => {
      const { node } = fixture(`<a:p><a:pPr lvl="${value}"/></a:p>`);
      expect(() => readDiagramTextParagraphs(node)).toThrow(
        "invalid diagram paragraph level",
      );
    },
  );
  it("rejects duplicate parameters, malformed bodies and non-text algorithms", () => {
    const { node } = fixture(
      undefined,
      '<d:param type="stBulletLvl" val="1"/><d:param type="stBulletLvl" val="2"/>',
    );
    expect(() => readDiagramTextParagraphs(node)).toThrow(
      "duplicate diagram starting bullet level",
    );
    expect(() => readDiagramTextParagraphs(fixture("").node)).toThrow(
      "diagram text body has no paragraphs",
    );
    expect(() =>
      readDiagramTextParagraphs({ ...node, algorithm: null }),
    ).toThrow("require a text algorithm");
  });
});
