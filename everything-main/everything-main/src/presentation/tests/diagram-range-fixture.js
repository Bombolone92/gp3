import { diagramSpacerDeck } from "./diagram-spacer-fixture.js";
import {
  NS,
  parseXml,
  serializeFragment,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
export const diagramRangeText = "Title\nBody 1 line\nTail";
export const fieldId = "{20147361-7434-4B93-8507-E54D451D1AF0}";
export const rangeBody = () =>
  parseXml(
    `<d:t xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}"><a:bodyPr anchor="t"/><a:lstStyle/><a:p><a:pPr algn="l" lvl="1"><a:spcAft><a:spcPts val="0"/></a:spcAft><a:defRPr sz="1000"><a:latin typeface="Arial"/></a:defRPr></a:pPr><a:r><a:rPr b="1" sz="1000"><a:latin typeface="Arial"/></a:rPr><a:t>Title</a:t></a:r><a:br><a:rPr b="0" sz="1000"/></a:br><a:r><a:rPr b="0" sz="1000"><a:latin typeface="Arial"/></a:rPr><a:t>Body </a:t></a:r><a:fld id="${fieldId}" type="slidenum"><a:rPr b="0" sz="1000"><a:latin typeface="Arial"/></a:rPr><a:t>1</a:t></a:fld><a:r><a:rPr b="0" sz="1000"><a:latin typeface="Arial"/></a:rPr><a:t> line</a:t></a:r><a:endParaRPr sz="1000"/></a:p><a:p><a:pPr algn="r"><a:buNone/></a:pPr><a:r><a:rPr i="1" sz="1000"><a:latin typeface="Arial"/></a:rPr><a:t>Tail</a:t></a:r><a:endParaRPr sz="1000"/></a:p></d:t>`,
  ).root;
export async function diagramRangeDeck() {
  const fixture = await diagramSpacerDeck(),
    body = rangeBody();
  const next = serializeFragment(body);
  // Replace the owned first text body, preserving the rest of its native graph.
  fixture.diagram.data.part.data = new TextEncoder().encode(
    new TextDecoder()
      .decode(fixture.diagram.data.part.data)
      .replace(/<d:t>[\s\S]*?<\/d:t>/, () => next),
  );
  return {
    ...fixture,
    body: readShapeDiagram(fixture.frame).model.point("node0").text,
  };
}
