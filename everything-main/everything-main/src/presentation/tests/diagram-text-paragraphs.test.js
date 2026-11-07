import { describe, expect, it, vi } from "vitest";
import {
  NS,
  parseXml,
  serializeXml,
  serializeFragment,
  firstChildElement,
  getAttrValue,
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { projectDiagramTextParagraphs } from "../lib/pptx/src/api/fn/diagram-text-paragraphs.ts";
import { mergeDiagramTextProperties } from "../lib/pptx/src/api/fn/diagram-text-properties.ts";

const child = (el, name) =>
  el && firstChildElement(el, qname("", name, NS.dml));
const value = (el, name) => el && getAttrValue(el, qname("", name, ""));
const xml = (content) =>
  parseXml(
    `<a:root xmlns:a="${NS.dml}" xmlns:r="${NS.officeDocRels}" xmlns:x="urn:foreign">${content}</a:root>`,
  ).root.children[0];
const dataOwner = "/ppt/diagrams/data1.xml",
  layoutOwner = "/ppt/diagrams/layout1.xml";
const layer = (content, owner = dataOwner) => ({
  element: xml(content),
  owner,
});
const fixture = ({
  paragraphs = "<a:p><a:r><a:t>Text</a:t></a:r></a:p>",
  list = "",
  custom = false,
  descendant = null,
} = {}) => {
  const data = parseXml(
    `<d:dataModel xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}" xmlns:r="${NS.officeDocRels}" xmlns:x="urn:foreign"><d:ptLst><d:pt modelId="0" type="doc"/><d:pt modelId="1"><d:prSet custT="${Number(custom)}"/>${paragraphs === null ? "" : `<d:t><a:bodyPr/><a:lstStyle>${list}</a:lstStyle>${paragraphs}</d:t>`}</d:pt>${descendant === null ? "" : `<d:pt modelId="2"><d:t><a:bodyPr/><a:lstStyle/>${descendant}</d:t></d:pt>`}</d:ptLst><d:cxnLst><d:cxn modelId="a" srcId="0" destId="1"/>${descendant === null ? "" : '<d:cxn modelId="b" srcId="1" destId="2"/>'}</d:cxnLst></d:dataModel>`,
  );
  const layout = parseXml(
    `<d:layoutNode xmlns:d="${NS.diagram}"><d:alg type="tx"/><d:presOf axis="des" ptType="node"/></d:layoutNode>`,
  );
  return {
    data,
    node: expandDiagramLayout(
      layout.root,
      readDiagramHierarchy(readDiagramDataModel(data.root)),
    ),
  };
};
const options = (extra = {}) => ({
  dataOwner,
  defaults: () => [],
  fontSize: (role) => (role === "primary" ? 18 : 12),
  ...extra,
});

describe("semantic SmartArt paragraph projection", () => {
  it.each([null, "<a:p/>"])(
    "synthesizes custom empty text without requesting an algorithm font: %s",
    (paragraphs) => {
      const { node, data } = fixture({ custom: true, paragraphs });
      const before = serializeXml(data);
      const [p] = projectDiagramTextParagraphs(
        node,
        options({
          fontSize: () => {
            throw Error("unexpected font lookup");
          },
        }),
        new WeakMap(),
      );
      expect(value(child(p, "endParaRPr"), "sz")).toBe("3600");
      expect(value(child(p, "pPr"), "defTabSz")).toBe("1600200");
      expect(serializeXml(data)).toBe(before);
    },
  );

  it("ignores foreign and empty run sizes while retaining their source formatting", () => {
    const { node, data } = fixture({
      custom: true,
      paragraphs:
        '<a:p><a:pPr><a:defRPr sz="1300"/></a:pPr><x:r><a:rPr sz="2400"/><a:t>Foreign</a:t></x:r><a:r><a:rPr sz="2200"/><a:t/></a:r><a:r><a:rPr x:sz="2500"/><a:t><![CDATA[Text]]></a:t></a:r></a:p>',
    });
    const before = serializeXml(data);
    const [p] = projectDiagramTextParagraphs(node, options(), new WeakMap());
    const runs = p.children.filter(
      (c) =>
        c.kind === "element" &&
        c.name.namespaceURI === NS.dml &&
        c.name.localName === "r",
    );
    expect(runs.map((r) => value(child(r, "rPr"), "sz"))).toEqual([
      "2200",
      "3600",
    ]);
    expect(value(child(child(p, "pPr"), "defRPr"), "sz")).toBe("1300");
    expect(
      getAttrValue(child(runs[1], "rPr"), qname("", "sz", "urn:foreign")),
    ).toBe("2500");
    expect(serializeXml(data)).toBe(before);
  });

  it("rechecks font declarations after semantic edits without changing an earlier projection", () => {
    const { node } = fixture({ custom: true });
    const [first] = projectDiagramTextParagraphs(
      node,
      options(),
      new WeakMap(),
    );
    const source = child(node.contributors[0].point.text, "p");
    source.children.push(xml('<a:r><a:rPr sz="2200"/><a:t>Later</a:t></a:r>'));
    const [second] = projectDiagramTextParagraphs(
      node,
      options(),
      new WeakMap(),
    );
    expect(value(child(child(first, "r"), "rPr"), "sz")).toBe("3600");
    expect(value(child(child(second, "r"), "rPr"), "sz")).toBeNull();
  });

  it("merges property slots and nested defaults without sharing source attributes", () => {
    const layers = [
      layer(
        '<a:pPr lvl="2" algn="ctr"><a:buChar char="*"/><a:defRPr sz="1400" b="1"><a:solidFill><a:srgbClr val="123456"/></a:solidFill></a:defRPr></a:pPr>',
      ),
      layer(
        '<a:pPr algn="r"><a:buNone/><a:defRPr i="1"><a:noFill/></a:defRPr></a:pPr>',
      ),
    ];
    const before = layers.map(({ element }) => serializeFragment(element));
    const result = mergeDiagramTextProperties(layers, "pPr", new WeakMap());
    expect(value(result, "algn")).toBe("r");
    expect(child(result, "buChar")).toBeNull();
    expect(child(result, "buNone")).not.toBeNull();
    const defaults = child(result, "defRPr");
    expect(["sz", "b", "i"].map((n) => value(defaults, n))).toEqual([
      "1400",
      "1",
      "1",
    ]);
    expect(child(defaults, "solidFill")).toBeNull();
    expect(child(defaults, "noFill")).not.toBeNull();
    result.attrs.forEach((a) => {
      a.value = "changed";
    });
    defaults.attrs.forEach((a) => {
      a.value = "changed";
    });
    expect(layers.map(({ element }) => serializeFragment(element))).toEqual(
      before,
    );
  });

  it("resolves absolute diagram and local point list levels independently of font hierarchy", () => {
    const { node, data } = fixture({
      paragraphs:
        '<a:p><a:pPr lvl="2" algn="r"><a:buNone/><a:defRPr b="0"/></a:pPr><a:r><a:rPr sz="4400"/><a:t>Parent</a:t></a:r></a:p>',
      list: '<a:defPPr indent="-100"><a:defRPr lang="fr-FR"/></a:defPPr><a:lvl3pPr marR="500"><a:defRPr u="sng"/></a:lvl3pPr>',
      descendant: '<a:p><a:pPr lvl="0"/><a:r><a:t>Child</a:t></a:r></a:p>',
    });
    const before = serializeXml(data),
      roles = [];
    const paragraphs = projectDiagramTextParagraphs(
      node,
      options({
        defaults: (entry) => [
          layer(
            `<a:pPr marL="${entry.hierarchyLevel * 1000}"><a:defRPr kern="1200"/></a:pPr>`,
          ),
        ],
        layoutListStyle: layer(
          '<a:lstStyle><a:defPPr algn="ctr"><a:buChar char="*"/><a:defRPr b="1"/></a:defPPr><a:lvl1pPr marR="300"/><a:lvl2pPr marR="700"/></a:lstStyle>',
          layoutOwner,
        ),
        fontSize: (role) => {
          roles.push(role);
          return role === "primary" ? 18 : 12;
        },
      }),
      new WeakMap(),
    );
    expect(roles).toEqual(["primary", "secondary"]);
    expect(
      paragraphs.map((p) =>
        ["lvl", "marL", "marR", "algn"].map((n) => value(child(p, "pPr"), n)),
      ),
    ).toEqual([
      ["2", "0", "500", "r"],
      ["0", "1000", "700", "ctr"],
    ]);
    const ppr = child(paragraphs[0], "pPr"),
      defaults = child(ppr, "defRPr");
    expect(
      ["sz", "kern", "b", "lang", "u"].map((n) => value(defaults, n)),
    ).toEqual(["1800", "1200", "0", "fr-FR", "sng"]);
    expect(child(ppr, "buChar")).toBeNull();
    expect(value(child(child(paragraphs[0], "r"), "rPr"), "sz")).toBe("1800");
    expect(serializeXml(data)).toBe(before);
  });

  it("preserves inline structure, fields, links, extensions and relationship owners", () => {
    const { node, data } = fixture({
      paragraphs:
        '<a:p><a:pPr><a:extLst><a:ext uri="paragraph"><x:payload/></a:ext></a:extLst></a:pPr><a:r><a:rPr b="1"><a:hlinkClick r:id="run-link"/></a:rPr><a:t>First</a:t></a:r><a:fld id="field" type="slidenum"><a:rPr i="1"/><a:pPr/><a:t>7</a:t></a:fld><a:br/><a:r><a:t>Last</a:t></a:r><a:endParaRPr lang="de-DE"/></a:p>',
    });
    const sources = new WeakMap(),
      before = serializeXml(data);
    const sourceLink = child(
      child(child(node.contributors[0].point.text, "p"), "r"),
      "rPr",
    ).children[0];
    sources.set(sourceLink, "/ppt/slides/slide9.xml");
    const [p] = projectDiagramTextParagraphs(
      node,
      options({
        defaults: () => [
          layer(
            '<a:pPr><a:buBlip><a:blip r:embed="bullet-image"/></a:buBlip></a:pPr>',
            layoutOwner,
          ),
        ],
      }),
      sources,
    );
    expect(p.children.map((c) => c.name.localName)).toEqual([
      "pPr",
      "r",
      "fld",
      "br",
      "r",
      "endParaRPr",
    ]);
    expect(child(p, "pPr").children.map((c) => c.name.localName)).toEqual([
      "lnSpc",
      "spcBef",
      "spcAft",
      "buBlip",
      "defRPr",
      "extLst",
    ]);
    expect(value(child(p, "fld"), "id")).toBe("field");
    expect(value(child(child(p, "fld"), "rPr"), "i")).toBe("1");
    expect(value(child(p, "endParaRPr"), "lang")).toBe("de-DE");
    const sizes = [];
    walkElements(p, (e) => {
      if (["rPr", "defRPr", "endParaRPr"].includes(e.name.localName))
        sizes.push(value(e, "sz"));
    });
    expect(sizes).toEqual(["1800", "1800", "1800", "1800", "1800", "1800"]);
    const projectedLink = child(child(child(p, "r"), "rPr"), "hlinkClick");
    expect(projectedLink).not.toBe(sourceLink);
    expect(sources.get(projectedLink)).toBe("/ppt/slides/slide9.xml");
    expect(sources.get(child(child(child(p, "pPr"), "buBlip"), "blip"))).toBe(
      layoutOwner,
    );
    expect(serializeXml(data)).toBe(before);
  });

  it("retains authored sizes across all contributors when any selected text is customized", () => {
    const { node, data } = fixture({
      custom: true,
      list: '<a:defPPr><a:defRPr sz="2800"/></a:defPPr>',
      paragraphs:
        '<a:p><a:pPr><a:defRPr sz="2300"/></a:pPr><a:r><a:rPr sz="1430"/><a:t>Custom</a:t></a:r><a:br/><a:endParaRPr sz="2270"/></a:p>',
      descendant:
        '<a:p><a:r><a:rPr sz="3400"/><a:t>Other contributor</a:t></a:r></a:p>',
    });
    const before = serializeXml(data),
      fontSize = vi.fn(() => {
        throw Error("custom text must not request fitted font");
      });
    const [parent, descendant] = projectDiagramTextParagraphs(
      node,
      options({ fontSize }),
      new WeakMap(),
    );
    expect(fontSize).not.toHaveBeenCalled();
    expect(value(child(child(parent, "pPr"), "defRPr"), "sz")).toBe("2300");
    expect(value(child(child(parent, "r"), "rPr"), "sz")).toBe("1430");
    expect(child(child(parent, "br"), "rPr")).toBeNull();
    expect(value(child(parent, "endParaRPr"), "sz")).toBe("2270");
    expect(value(child(child(descendant, "r"), "rPr"), "sz")).toBe("3400");
    expect(serializeXml(data)).toBe(before);
  });

  it.each([null, "<a:p/>"])(
    "supplies the display floor for an empty paragraph: %s",
    (paragraphs) => {
      const { node } = fixture({ paragraphs });
      const [p] = projectDiagramTextParagraphs(
        node,
        options({ fontSize: () => 0 }),
        new WeakMap(),
      );
      expect(value(child(child(p, "pPr"), "defRPr"), "sz")).toBe("100");
      expect(value(child(p, "endParaRPr"), "sz")).toBe("100");
    },
  );
  it.each([NaN, Infinity, -1, 4000.01])(
    "rejects invalid display font %s without mutating the source",
    (font) => {
      const { node, data } = fixture(),
        before = serializeXml(data);
      expect(() =>
        projectDiagramTextParagraphs(
          node,
          options({ fontSize: () => font }),
          new WeakMap(),
        ),
      ).toThrow("invalid diagram displayed font size");
      expect(serializeXml(data)).toBe(before);
    },
  );
});
