import {
  NS,
  type XmlElement,
  firstChildElement,
  getAttrValue,
  qname,
} from "../xml/index.ts";

const value = (el: XmlElement, name: string): string | null =>
  getAttrValue(el, qname("", name, ""));
const child = (el: XmlElement, name: string): XmlElement | null =>
  firstChildElement(el, qname("dgm", name, NS.diagram));
const children = (el: XmlElement | null, name: string): XmlElement[] =>
  el?.children.filter(
    (n): n is XmlElement =>
      n.kind === "element" &&
      n.name.namespaceURI === NS.diagram &&
      n.name.localName === name,
  ) ?? [];

// ST_ModelId is a GUID or an unsigned integer. Compare values, not the
// spelling of hex digits or leading zeroes, without rewriting source XML.
export const diagramModelIdKey = (id: string): string => {
  if (/^\{[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\}$/i.test(id))
    return id.toLowerCase();
  if (/^\+?\d+$/.test(id)) {
    const n = Number(id);
    if (n <= 0xffffffff) return String(n);
  }
  return id;
};

export interface DiagramPoint {
  readonly id: string;
  readonly type: string;
  readonly element: XmlElement;
  readonly properties: XmlElement | null;
  readonly text: XmlElement | null;
  readonly shapeProperties: XmlElement | null;
}

export interface DiagramConnection {
  readonly id: string;
  readonly type: string;
  readonly sourceId: string;
  readonly destinationId: string;
  readonly sourceOrder: number;
  readonly destinationOrder: number;
  readonly element: XmlElement;
}

export interface DiagramDataModel {
  readonly points: readonly DiagramPoint[];
  readonly connections: readonly DiagramConnection[];
  point(id: string): DiagramPoint | null;
  incoming(id: string, type: string): readonly DiagramConnection[];
  outgoing(id: string, type: string): readonly DiagramConnection[];
  /** Semantic contributors to a saved presentation shape, in destination order. */
  textSources(id: string): readonly DiagramPoint[];
}

const required = (el: XmlElement, name: string): string => {
  const v = value(el, name);
  if (v === null || v === "")
    throw new Error(`diagram ${el.name.localName} is missing ${name}`);
  return v;
};

const order = (el: XmlElement, name: string): number => {
  const raw = value(el, name);
  if (raw === null) return 0;
  const n = Number(raw);
  if (!/^\+?\d+$/.test(raw) || !Number.isSafeInteger(n) || n > 0xffffffff)
    throw new Error(`diagram connection has invalid ${name}`);
  return n;
};

/**
 * DiagramML's semantic and presentation graphs share a point list but use
 * different connection types. Keep both graphs and all authored XML intact.
 * In particular, presAssocID is a grouping association, not a text-source ID:
 * a heading and its body can share it while having different presOf edges.
 */
export const readDiagramDataModel = (root: XmlElement): DiagramDataModel => {
  if (
    root.name.namespaceURI !== NS.diagram ||
    root.name.localName !== "dataModel"
  )
    throw new Error("expected a DiagramML dataModel");
  const points = children(child(root, "ptLst"), "pt").map((el) => ({
    id: required(el, "modelId"),
    type: value(el, "type") ?? "node",
    element: el,
    properties: child(el, "prSet"),
    text: child(el, "t"),
    shapeProperties: child(el, "spPr"),
  }));
  const byId = new Map<string, DiagramPoint>();
  for (const pt of points) {
    const key = diagramModelIdKey(pt.id);
    if (byId.has(key)) throw new Error(`duplicate diagram point ${pt.id}`);
    byId.set(key, pt);
  }
  const connections = children(child(root, "cxnLst"), "cxn").map((el) => ({
    id: required(el, "modelId"),
    type: value(el, "type") ?? "parOf",
    sourceId: required(el, "srcId"),
    destinationId: required(el, "destId"),
    sourceOrder: order(el, "srcOrd"),
    destinationOrder: order(el, "destOrd"),
    element: el,
  }));
  const incoming = new Map<string, Map<string, DiagramConnection[]>>();
  const outgoing = new Map<string, Map<string, DiagramConnection[]>>();
  const add = (
    index: typeof incoming,
    id: string,
    connection: DiagramConnection,
  ): void => {
    const key = diagramModelIdKey(id);
    let types = index.get(key);
    if (!types) index.set(key, (types = new Map()));
    let edges = types.get(connection.type);
    if (!edges) types.set(connection.type, (edges = []));
    edges.push(connection);
  };
  const ids = new Set<string>();
  for (const connection of connections) {
    const key = diagramModelIdKey(connection.id);
    if (ids.has(key))
      throw new Error(`duplicate diagram connection ${connection.id}`);
    ids.add(key);
    // Retain dangling edges too. A caller can diagnose incomplete data without
    // losing the saved drawing or unrelated, valid portions of the graph.
    add(incoming, connection.destinationId, connection);
    add(outgoing, connection.sourceId, connection);
  }
  for (const types of incoming.values())
    for (const edges of types.values())
      edges.sort((a, b) => a.destinationOrder - b.destinationOrder);
  for (const types of outgoing.values())
    for (const edges of types.values())
      edges.sort((a, b) => a.sourceOrder - b.sourceOrder);
  const point = (id: string): DiagramPoint | null =>
    byId.get(diagramModelIdKey(id)) ?? null;
  const readEdges = (index: typeof incoming, id: string, type: string) =>
    index.get(diagramModelIdKey(id))?.get(type) ?? [];
  return {
    points,
    connections,
    point,
    incoming: (id, type) => readEdges(incoming, id, type),
    outgoing: (id, type) => readEdges(outgoing, id, type),
    textSources: (id) => {
      const pt = point(id);
      if (!pt) return [];
      if (pt.type !== "pres") return [pt];
      return readEdges(incoming, id, "presOf")
        .map((edge) => point(edge.sourceId))
        .filter((source): source is DiagramPoint => source !== null);
    },
  };
};
