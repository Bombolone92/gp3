import { NS, parseXml } from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";

// The native controls use this tree, with parent/sibling transitions around
// every data node. XML point order intentionally differs from hierarchy order.
// 0 -> [1, 2, 3(asst)]; 1 -> [11, 12]; 2 -> [21, 22]; 3 -> [31].
export const sample = (
  rename = (id) => id,
  reversePoints = false,
  properties = "",
  extraEdges = [],
) => {
  const points = [
    ["0", "doc"],
    ["1", "node"],
    ["2", "node"],
    ["3", "asst"],
    ["11", "node"],
    ["12", "node"],
    ["21", "node"],
    ["22", "node"],
    ["31", "node"],
    ...extraEdges.map(([, id]) => [id, "node"]),
  ];
  const edges = [
    ["0", "1"],
    ["0", "2"],
    ["0", "3"],
    ["1", "11"],
    ["1", "12"],
    ["2", "21"],
    ["2", "22"],
    ["3", "31"],
    ...extraEdges,
  ];
  const xmlPoints = points.map(
    ([id, type]) =>
      `<d:pt modelId="${rename(id)}" type="${type}">${properties}</d:pt>`,
  );
  const xmlEdges = edges.map(([src, dest], i) => {
    for (const [prefix, type] of [
      ["P", "parTrans"],
      ["S", "sibTrans"],
    ])
      xmlPoints.push(
        `<d:pt modelId="${rename(prefix + dest)}" type="${type}" cxnId="${200 + i}"/>`,
      );
    return `<d:cxn modelId="${200 + i}" srcId="${rename(src)}" destId="${rename(dest)}" srcOrd="${edges.slice(0, i).filter((e) => e[0] === src).length}" destOrd="0" parTransId="${rename("P" + dest)}" sibTransId="${rename("S" + dest)}"/>`;
  });
  if (reversePoints) xmlPoints.reverse();
  const document = parseXml(
    `<d:dataModel xmlns:d="${NS.diagram}"><d:ptLst>${xmlPoints.join("")}</d:ptLst><d:cxnLst>${xmlEdges.reverse().join("")}</d:cxnLst></d:dataModel>`,
  );
  return {
    document,
    tree: readDiagramHierarchy(readDiagramDataModel(document.root)),
  };
};
