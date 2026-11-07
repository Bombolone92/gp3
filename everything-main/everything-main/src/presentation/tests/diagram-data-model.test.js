import { describe, expect, it } from "vitest";
import {
  NS,
  parseXml,
  serializeXml,
  textContent,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";

const point = (id, type = "node", text = "", properties = "") =>
  `<d:pt modelId="${id}" type="${type}"><d:prSet ${properties}/><d:spPr/><d:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></d:t></d:pt>`;
const edge = (id, source, destination, extra = "") =>
  `<d:cxn modelId="${id}" srcId="${source}" destId="${destination}" ${extra}/>`;
const document = (points, edges = "") =>
  parseXml(
    `<d:dataModel xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}"><d:ptLst>${points}</d:ptLst><d:cxnLst>${edges}</d:cxnLst></d:dataModel>`,
  );

describe("DiagramML data and presentation graphs", () => {
  it("maps heading and body through presOf instead of their shared presAssocID", () => {
    const doc = document(
      point("1", "node", "Heading") +
        point("2", "node", "Body") +
        point("3", "pres", "", 'presAssocID="1" presName="heading"') +
        point("4", "pres", "", 'presAssocID="1" presName="body"'),
      edge("11", "1", "2") +
        edge("12", "1", "3", 'type="presOf"') +
        edge("13", "2", "4", 'type="presOf"'),
    );
    const before = serializeXml(doc);
    const model = readDiagramDataModel(doc.root);
    expect(model.textSources("3").map((p) => textContent(p.text))).toEqual([
      "Heading",
    ]);
    expect(model.textSources("4").map((p) => textContent(p.text))).toEqual([
      "Body",
    ]);
    expect(model.outgoing("1", "parOf").map((c) => c.destinationId)).toEqual([
      "2",
    ]);
    expect(serializeXml(doc)).toBe(before);
  });

  it("orders multiple contributors by destination order, independently of source order", () => {
    const doc = document(
      point("1") + point("2") + point("3", "pres"),
      edge("10", "1", "3", 'type="presOf" srcOrd="0" destOrd="1"') +
        edge("11", "2", "3", 'type="presOf" srcOrd="9" destOrd="0"'),
    );
    const model = readDiagramDataModel(doc.root);
    expect(model.textSources("3").map((p) => p.id)).toEqual(["2", "1"]);
    expect(model.incoming("3", "parOf")).toEqual([]);
  });

  it("keeps semantic and presentation parent graphs separate and stably orders siblings", () => {
    const model = readDiagramDataModel(
      document(
        point("1") + point("2") + point("3"),
        edge("10", "1", "3", 'srcOrd="2"') +
          edge("11", "1", "2", 'srcOrd="1"') +
          edge("12", "1", "3", 'srcOrd="1"') +
          edge("13", "3", "1", 'type="presParOf"'),
      ).root,
    );
    expect(model.outgoing("1", "parOf").map((c) => c.id)).toEqual([
      "11",
      "12",
      "10",
    ]);
    expect(
      model.outgoing("3", "presParOf").map((c) => c.destinationId),
    ).toEqual(["1"]);
  });

  it("matches GUID values across hex casing and unsigned IDs across lexical forms", () => {
    const guid = "{ABCDEF01-2345-6789-ABCD-EF0123456789}";
    const model = readDiagramDataModel(
      document(
        point(guid) + point("007", "pres"),
        edge("11", guid.toLowerCase(), "+7", 'type="presOf"'),
      ).root,
    );
    expect(model.point(guid.toLowerCase()).id).toBe(guid);
    expect(model.textSources("7").map((p) => p.id)).toEqual([guid]);
  });

  it("does not invent contributors for an unconnected presentation point", () => {
    const model = readDiagramDataModel(
      document(
        point("1", "node", "Unrelated") +
          point("2", "pres", "", 'presAssocID="1"'),
      ).root,
    );
    expect(model.textSources("2")).toEqual([]);
    expect(model.textSources("missing")).toEqual([]);
    expect(model.textSources("1").map((p) => p.id)).toEqual(["1"]);
  });

  it("retains dangling and unknown relationships without traversing cyclic graphs", () => {
    const model = readDiagramDataModel(
      document(
        point("1") + point("2", "pres"),
        edge("10", "99", "2", 'type="presOf"') +
          edge("11", "1", "1") +
          edge("12", "2", "1", 'type="futureRelationship"'),
      ).root,
    );
    expect(model.connections).toHaveLength(3);
    expect(model.incoming("2", "presOf")[0].sourceId).toBe("99");
    expect(model.textSources("2")).toEqual([]);
    expect(model.outgoing("1", "parOf")).toHaveLength(1);
  });

  it("ignores foreign-namespace lookalikes and preserves unknown point properties", () => {
    const doc = document(
      point("1", "futurePoint", "Text", 'future="value"') +
        '<pt xmlns="urn:other" modelId="1"/>',
    );
    const model = readDiagramDataModel(doc.root);
    expect(model.points).toHaveLength(1);
    expect(model.points[0].type).toBe("futurePoint");
    expect(serializeXml(doc)).toContain('future="value"');
  });

  it("rejects ambiguous IDs and invalid ordering instead of selecting arbitrary content", () => {
    expect(() =>
      readDiagramDataModel(document(point("1") + point("01")).root),
    ).toThrow("duplicate diagram point");
    expect(() =>
      readDiagramDataModel(
        document(point("1"), edge("2", "1", "1") + edge("02", "1", "1")).root,
      ),
    ).toThrow("duplicate diagram connection");
    expect(() =>
      readDiagramDataModel(
        document(point("1"), edge("2", "1", "1", 'destOrd="-1"')).root,
      ),
    ).toThrow("invalid destOrd");
    expect(() =>
      readDiagramDataModel(parseXml('<dataModel xmlns="urn:other"/>').root),
    ).toThrow("DiagramML dataModel");
  });
});
