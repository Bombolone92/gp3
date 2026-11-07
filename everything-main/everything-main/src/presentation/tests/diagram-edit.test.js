import { describe, expect, it } from "vitest";
import { P, createDeck, preview, slideDiagramDataStamp } from "../src/model.js";
import { diagramSpacerDeck } from "./diagram-spacer-fixture.js";
import { diagramImage } from "./diagram-copy-fixture.js";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import {
  NS,
  parseXml,
  serializeXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";
import { resolveTarget } from "../lib/pptx/src/internal/opc/index.ts";
import { SHAPE_ELEMENT } from "../lib/pptx/src/api/_internal-symbols.ts";
import { commitAndRefresh } from "../lib/pptx/src/api/fn/_helpers.ts";

const decode = (b) => new TextDecoder().decode(b);
const encode = (s) => new TextEncoder().encode(s);
const snapshot = (p) =>
  P._internalPackageOf(p).parts.map((part) => [
    part.name,
    part.contentType,
    part.data.slice(),
  ]);
const entries = P.getShapeDiagramTextEntries;
const replace = P.replaceShapeDiagramText;
const svg = (p, s = P.getSlides(p)[0]) =>
  decodeURIComponent(preview(p, s).split(",").slice(1).join(","));
const ids = (f) => {
  let result;
  walkElements(f[SHAPE_ELEMENT], (e) => {
    if (e.name.namespaceURI === NS.diagram && e.name.localName === "relIds")
      result = e;
  });
  return result;
};
async function fixture({ cached = true } = {}) {
  const value = await diagramSpacerDeck(),
    part = value.diagram.data.part;
  if (cached)
    part.data = encode(
      decode(part.data).replace(
        "</d:dataModel>",
        `<d:extLst><a:ext uri="${NS.diagramDrawing}"><cache:dataModelExt xmlns:cache="${NS.diagramDrawing}" relId="savedDrawing0" minVer="${NS.diagram}"/></a:ext><a:ext uri="urn:opaque"><o:dataModelExt xmlns:o="urn:opaque" relId="savedDrawing0"/></a:ext></d:extLst></d:dataModel>`,
      ),
    );
  return value;
}

describe("semantic SmartArt text editing", () => {
  it("resolves escaped unreserved characters when stamping data relationships", async () => {
    const { p, frame } = await fixture(),
      s = P.getSlides(p)[0],
      pkg = P._internalPackageOf(p),
      owner = P.getSlidePartName(s),
      original = slideDiagramDataStamp(p, s);
    pkg.setRels(owner, {
      items: pkg
        .getRels(owner)
        .items.map((r) =>
          r.type === REL_TYPES.diagramData
            ? { ...r, target: r.target.replace("item0", "%69tem0") }
            : r,
        ),
    });
    expect(slideDiagramDataStamp(p, s)).toBe(original);
    replace(frame, [{ modelId: "node0", text: "Escaped path" }]);
    expect(slideDiagramDataStamp(p, s)).not.toBe(original);
  });

  it("counts package-root data owners when detaching shared data", async () => {
    const { p, frame, diagram } = await fixture(),
      pkg = P._internalPackageOf(p),
      original = diagram.data.part.data.slice();
    pkg.setRootRels({
      items: [
        ...pkg.rootRels().items,
        {
          id: "sharedData",
          type: REL_TYPES.diagramData,
          target: diagram.data.part.name,
          targetMode: "Internal",
        },
      ],
    });
    replace(frame, [{ modelId: "node0", text: "Selected frame" }]);
    expect(readShapeDiagram(frame).data.part.name).not.toBe(
      diagram.data.part.name,
    );
    expect(diagram.data.part.data).toEqual(original);
    expect(readShapeDiagram(frame).drawing).toBeNull();
  });

  it.each(["invalid target", "malformed relationships"])(
    "handles unrelated %s before committing semantic edits",
    async (mode) => {
      const { p, frame, diagram } = await fixture(),
        pkg = P._internalPackageOf(p),
        owner = "/assets/unrelated.xml",
        original = diagram.data.part.data.slice();
      pkg.addPart(owner, "application/xml", encode("<unrelated/>"));
      pkg.setRels(owner, {
        items: [
          {
            id: "invalid",
            type: REL_TYPES.image,
            target: "../../../../outside",
            targetMode: "Internal",
          },
        ],
      });
      const relsPart = pkg.getPart("/assets/_rels/unrelated.xml.rels");
      if (mode === "malformed relationships")
        relsPart.data = encode("<broken>");
      const untouched = relsPart.data.slice(),
        before = snapshot(p);
      if (mode === "malformed relationships") {
        expect(() =>
          replace(frame, [{ modelId: "node0", text: "Valid edit" }]),
        ).toThrow("unterminated");
        expect(snapshot(p)).toEqual(before);
        expect(diagram.data.part.data).toEqual(original);
        return;
      }
      expect(replace(frame, [{ modelId: "node0", text: "Valid edit" }])).toBe(
        1,
      );
      expect(entries(frame)[0].text).toBe("Valid edit");
      expect(relsPart.data).toEqual(untouched);
    },
  );

  it("tracks data changes across edit and history restore while retaining unaffected slide stamps", async () => {
    const { p, frame } = await fixture(),
      s = P.getSlides(p)[0],
      other = P.addSlide(p, { layout: P.getSlideLayouts(p)[0] }),
      before = slideDiagramDataStamp(p, s),
      unrelated = slideDiagramDataStamp(p, other),
      snapshot = await P.savePresentation(p);
    expect(slideDiagramDataStamp(p, s)).toBe(before);
    replace(frame, [{ modelId: "node0", text: "Updated" }]);
    expect(slideDiagramDataStamp(p, s)).not.toBe(before);
    expect(slideDiagramDataStamp(p, other)).toBe(unrelated);
    const restored = await P.loadPresentation(snapshot);
    expect(slideDiagramDataStamp(restored, P.getSlides(restored)[0])).toBe(
      before,
    );
  });
  it("reads independent hierarchy-ordered values without exposing XML or rewriting parts", async () => {
    const { p, frame, diagram } = await fixture(),
      before = snapshot(p);
    diagram.data.part.data = encode(
      decode(diagram.data.part.data).replace(
        '<d:pt modelId="node1">',
        '<d:pt modelId="node1" type="asst">',
      ),
    );
    const updated = snapshot(p),
      values = entries(frame);
    expect(values).toEqual([
      { modelId: "node0", depth: 1, text: "West" },
      { modelId: "node1", depth: 1, text: "Central" },
      { modelId: "node2", depth: 1, text: "East" },
    ]);
    values[0].text = "outside mutation";
    expect(entries(frame)[0].text).toBe("West");
    expect(snapshot(p)).toEqual(updated);
    expect(before.length).toBe(updated.length);
  });

  it("skips presentation text and extracts paragraphs, soft breaks, fields and Unicode", async () => {
    const { frame, diagram } = await fixture();
    diagram.data.part.data = encode(
      decode(diagram.data.part.data)
        .replace("<a:t>West</a:t>", "<a:t>一😀</a:t>")
        .replace(
          "</a:r></a:p>",
          '</a:r><a:br/><a:fld id="field" type="date"><a:t>Today</a:t></a:fld></a:p><a:p><a:r><a:t>Second</a:t></a:r></a:p>',
        )
        .replace(
          "</d:ptLst>",
          '<d:pt modelId="cached" type="pres"><d:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Cached only</a:t></a:r></a:p></d:t></d:pt></d:ptLst>',
        ),
    );
    expect(entries(frame)[0].text).toBe("一😀\nToday\nSecond");
    expect(entries(frame)).toHaveLength(3);
  });

  it.each([[], [{ modelId: "node0", text: "West" }]])(
    "does not invalidate a drawing, add parts or serialize no-op batches: %s",
    async (...updates) => {
      const { p, frame } = await fixture(),
        before = snapshot(p);
      expect(replace(frame, updates)).toBe(0);
      expect(snapshot(p)).toEqual(before);
      expect(readShapeDiagram(frame).drawing).not.toBeNull();
    },
  );

  it.each([
    [{ modelId: "missing", text: "X" }],
    [
      { modelId: "node0", text: "X" },
      { modelId: "node0", text: "Y" },
    ],
    [
      { modelId: "node0", text: "X" },
      { modelId: "node1", text: 2 },
    ],
    [{ modelId: 2, text: "X" }],
    [{ modelId: "node0", text: "\u0000" }],
    [{ modelId: "node0", text: "\ud800" }],
    [{ modelId: "node0", text: "\uffff" }],
  ])(
    "rejects a whole invalid batch without changing any bytes: %s",
    async (...updates) => {
      const { p, frame } = await fixture(),
        before = snapshot(p);
      expect(() => replace(frame, updates)).toThrow();
      expect(snapshot(p)).toEqual(before);
    },
  );

  it("invalidates only the recognized drawing reference and retains rich XML of unchanged entries", async () => {
    const { p, frame, diagram } = await fixture(),
      original = readShapeDiagram(frame),
      cacheBytes = original.drawing.part.data.slice(),
      other = original.model.point("node1").element,
      otherXml = serializeXml({ root: other, prolog: [], epilog: [] });
    expect(
      replace(frame, [{ modelId: "node0", text: "Changed <&>\r\n一😀" }]),
    ).toBe(1);
    const result = readShapeDiagram(frame);
    expect(result.drawing).toBeNull();
    expect(entries(frame)[0].text).toBe("Changed <&>\n一😀");
    expect(
      serializeXml({
        root: result.model.point("node1").element,
        prolog: [],
        epilog: [],
      }),
    ).toBe(otherXml);
    expect(original.drawing.part.data).toEqual(cacheBytes);
    expect(decode(result.data.part.data)).toContain('uri="urn:opaque"');
    expect(decode(result.data.part.data)).toContain("o:dataModelExt");
    expect(decode(result.data.part.data)).not.toContain("cache:dataModelExt");
    expect(result.layout.part.data).toEqual(diagram.layout.part.data);
    expect(svg(p)).toContain('data-pptx-diagram="semantic-layout"');
    expect(svg(p)).not.toContain("data-pptx-diagram-issues");
    expect(P.validatePresentation(p)).toEqual([]);
  });

  it("retains first-run replacement formatting, body/list defaults and authored graph properties", async () => {
    const { frame, diagram } = await fixture();
    diagram.data.part.data = encode(
      decode(diagram.data.part.data)
        .replace(
          "<a:bodyPr/>",
          '<a:bodyPr rtlCol="1"/><a:extLst xmlns:o="urn:opaque"><a:ext uri="urn:body"><o:keep/></a:ext></a:extLst>',
        )
        .replace(
          "<a:p>",
          '<a:p><a:pPr algn="r" marL="36000"><a:buChar char="•"/></a:pPr>',
        )
        .replace(
          "<a:t>West</a:t>",
          '<a:t>West</a:t></a:r><a:r><a:rPr b="1"/><a:t> mixed</a:t>',
        ),
    );
    replace(frame, [{ modelId: "node0", text: "Replacement\nParagraph" }]);
    const xml = serializeXml({
      root: readShapeDiagram(frame).model.point("node0").text,
      prolog: [],
      epilog: [],
    });
    expect(xml).toContain('rtlCol="1"');
    expect(xml).toContain("<o:keep");
    expect(xml.match(/sz="1000"/g)).toHaveLength(2);
    expect(xml.match(/algn="r"/g)).toHaveLength(2);
    expect(xml).not.toContain('b="1"');
    expect(entries(frame)[0].text).toBe("Replacement\nParagraph");
  });

  it("creates a missing text body in point schema order and can clear text", async () => {
    const { frame, diagram } = await fixture();
    const doc = parseXml(decode(diagram.data.part.data));
    walkElements(doc.root, (e) => {
      if (
        e.name.namespaceURI === NS.diagram &&
        getAttrValue(e, qname("", "modelId", "")) === "node0"
      )
        e.children = e.children.filter(
          (c) => c.kind !== "element" || c.name.localName !== "t",
        );
    });
    diagram.data.part.data = encode(serializeXml(doc));
    expect(entries(frame)[0].text).toBe("");
    expect(replace(frame, [{ modelId: "node0", text: "New text" }])).toBe(1);
    expect(
      readShapeDiagram(frame)
        .model.point("node0")
        .element.children.filter((c) => c.kind === "element")
        .map((c) => c.name.localName),
    ).toEqual(["spPr", "t"]);
    expect(replace(frame, [{ modelId: "node0", text: "" }])).toBe(1);
    expect(entries(frame)[0].text).toBe("");
  });

  it.each([
    "same relationship",
    "distinct relationships",
    "other owner",
    "grouped frames",
  ])(
    "detaches shared data for %s while retaining dependencies and peer text",
    async (mode) => {
      const { p, frame, diagram } = await fixture({ cached: false }),
        s = P.getSlides(p)[0],
        otherSlide =
          mode === "other owner"
            ? P.addSlide(p, { layout: P.getSlideLayouts(p)[0] })
            : s,
        peer = P.copyShape(otherSlide, frame),
        pkg = P._internalPackageOf(p),
        owner = P.getSlidePartName(otherSlide),
        sourceId = getAttrValue(ids(frame), qname("", "dm", NS.officeDocRels)),
        peerIds = ids(peer),
        peerId = getAttrValue(peerIds, qname("", "dm", NS.officeDocRels));
      if (mode === "same relationship" || mode === "grouped frames") {
        peerIds.attrs = peerIds.attrs.map((a) =>
          a.name.localName === "dm" ? { ...a, value: sourceId } : a,
        );
        commitAndRefresh(peer);
      } else
        pkg.setRels(owner, {
          items: pkg
            .getRels(owner)
            .items.map((r) =>
              r.id === peerId ? { ...r, target: diagram.data.part.name } : r,
            ),
        });
      let edited = frame,
        unchanged = peer;
      if (mode === "grouped frames") {
        const group = P.groupShapes([frame, peer]);
        [edited, unchanged] = P.getGroupChildren(group);
      }
      const original = diagram.data.part.data.slice(),
        beforeNames = new Set(pkg.parts.map((part) => part.name));
      expect(replace(edited, [{ modelId: "node0", text: "Own edit" }])).toBe(1);
      expect(entries(edited)[0].text).toBe("Own edit");
      expect(entries(unchanged)[0].text).toBe("West");
      expect(readShapeDiagram(edited).data.part.name).not.toBe(
        readShapeDiagram(unchanged).data.part.name,
      );
      expect(diagram.data.part.data).toEqual(original);
      expect(
        pkg.parts.filter(
          (part) => !beforeNames.has(part.name) && !part.name.endsWith(".rels"),
        ),
      ).toHaveLength(1);
      const count = pkg.parts.length;
      expect(replace(edited, [{ modelId: "node1", text: "Next edit" }])).toBe(
        1,
      );
      expect(pkg.parts).toHaveLength(count);
      expect(P.validatePresentation(p)).toEqual([]);
    },
  );

  it("retains data-part media/hyperlink owners when detaching and copying edited data", async () => {
    const { p, frame, diagram } = await fixture({ cached: false }),
      pkg = P._internalPackageOf(p),
      s = P.getSlides(p)[0],
      peer = P.copyShape(s, frame),
      sourceId = getAttrValue(ids(frame), qname("", "dm", NS.officeDocRels));
    ids(peer).attrs = ids(peer).attrs.map((a) =>
      a.name.localName === "dm" ? { ...a, value: sourceId } : a,
    );
    commitAndRefresh(peer);
    pkg.setRels(diagram.data.part.name, {
      items: [
        {
          id: "pixel",
          type: REL_TYPES.image,
          target: "pixel.dat",
          targetMode: "Internal",
        },
        {
          id: "link",
          type: REL_TYPES.hyperlink,
          target: "https://example.org/diagram",
          targetMode: "External",
        },
      ],
    });
    diagram.data.part.data = encode(
      decode(diagram.data.part.data).replace(
        '<a:solidFill><a:srgbClr val="1B52C1"/></a:solidFill>',
        `<a:blipFill xmlns:r="${NS.officeDocRels}"><a:blip r:embed="pixel"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`,
      ),
    );
    replace(frame, [{ modelId: "node0", text: "Edited media item" }]);
    const edited = readShapeDiagram(frame),
      relationships = pkg.getRels(edited.data.part.name).items;
    expect(
      pkg.getPart(
        resolveTarget(
          edited.data.part.name,
          relationships.find((r) => r.id === "pixel").target,
        ),
      ).data,
    ).toEqual(diagramImage);
    expect(relationships.find((r) => r.id === "link").target).toBe(
      "https://example.org/diagram",
    );
    expect(svg(p)).toContain("data:image/png;base64,");
    expect(entries(peer)[0].text).toBe("West");
  });

  it("preserves edited semantic text and layout through exported reimport and transfer in both directions", async () => {
    const { p, frame, diagram } = await fixture(),
      before = new Map(
        ["layout", "quickStyle", "colors"].map((k) => [
          k,
          diagram[k].part.data.slice(),
        ]),
      );
    replace(frame, [
      { modelId: "node0", text: "Edited first" },
      { modelId: "node2", text: "Edited last" },
    ]);
    const loaded = await P.loadPresentation(await P.savePresentation(p)),
      target = createDeck("blank"),
      forward = P.importSlide(
        target,
        P.getSlides(loaded)[0],
        P.getSlideLayouts(target)[0],
      ),
      returned = P.importSlide(p, forward, P.getSlideLayouts(p)[0]);
    for (const shape of [
      frame,
      P.getSlideShapes(P.getSlides(loaded)[0])[0],
      P.getSlideShapes(forward)[0],
      P.getSlideShapes(returned)[0],
    ]) {
      expect(entries(shape).map((e) => e.text)).toEqual([
        "Edited first",
        "Central",
        "Edited last",
      ]);
      const d = readShapeDiagram(shape);
      expect(d.drawing).toBeNull();
      for (const [k, bytes] of before) expect(d[k].part.data).toEqual(bytes);
    }
    for (const pres of [p, loaded, target])
      expect(P.validatePresentation(pres)).toEqual([]);
  });
});
