import {
  NS,
  type XmlElement,
  firstChildElement,
  getAttrValue,
  qname,
  walkElements,
} from "../xml/index.ts";
import {
  type DiagramDataModel,
  type DiagramPoint,
  diagramModelIdKey,
} from "./data-model.ts";
import { type DiagramColorSample, sampleDiagramColors } from "./color-list.ts";

const DIAGRAM_2016 =
  "http://schemas.microsoft.com/office/drawing/2016/12/diagram";
const value = (el: XmlElement | null, name: string) =>
  el && getAttrValue(el, qname("", name, ""));
const child = (el: XmlElement | null, name: string, ns: string = NS.diagram) =>
  el && firstChildElement(el, qname("", name, ns));

export interface DiagramTextSource {
  readonly point: DiagramPoint;
  /** Node depth, not the paragraph's local bullet level; null for invalid ancestry. */
  readonly level: number | null;
}

export interface DiagramStyle {
  readonly label: string | null;
  readonly styleIndex: number | null;
  readonly styleCount: number | null;
  readonly quickStyle: XmlElement | null;
  readonly colors: XmlElement | null;
  /** Palette interval; theme resolution and color interpolation are deferred. */
  readonly textFill: DiagramColorSample | null;
  readonly issues: readonly string[];
}

export interface DiagramTextStyle extends DiagramStyle {
  readonly presentation: DiagramPoint;
  readonly layoutNodes: readonly XmlElement[];
  readonly sources: readonly DiagramTextSource[];
}

export interface DiagramStyles {
  textStyle(modelId: string): DiagramTextStyle | null;
  readonly listStyle: XmlElement | null;
}

// The diagram list-style extension is defined by MS-ODRAWXML 2.32.1.1.
// Its levels map to semantic node depth; cached text paragraphs commonly all
// use lvl=0 even when their semantic nodes have different depths.
export const readDiagramListStyle = (
  root: XmlElement | null,
): XmlElement | null => {
  const extList = child(root, "extLst");
  for (const ext of extList?.children ?? []) {
    if (
      ext.kind !== "element" ||
      ext.name.namespaceURI !== NS.dml ||
      ext.name.localName !== "ext"
    )
      continue;
    const style = child(ext, "lstStyle", DIAGRAM_2016);
    if (style) return style;
  }
  return null;
};

const styleLabels = (root: XmlElement | null): Map<string, XmlElement[]> => {
  const labels = new Map<string, XmlElement[]>();
  for (const el of root?.children ?? []) {
    if (
      el.kind !== "element" ||
      el.name.namespaceURI !== NS.diagram ||
      el.name.localName !== "styleLbl"
    )
      continue;
    const name = value(el, "name");
    if (name !== null) labels.set(name, [...(labels.get(name) ?? []), el]);
  }
  return labels;
};

/** Index quick/color definitions once, independently of saved drawing points. */
export const readDiagramStyleLabels = (
  quickStyle: XmlElement | null,
  colors: XmlElement | null,
): ((
  label: string | null,
  styleIndex: number | null,
  styleCount: number | null,
) => DiagramStyle) => {
  const styles = styleLabels(quickStyle),
    colorStyles = styleLabels(colors);
  const soleStyle =
    styles.size === 1 ? styles.values().next().value : undefined;
  return (label, styleIndex, styleCount) => {
    const issues: string[] = [];
    const lookup = (index: typeof styles, kind: string) => {
      // Native quick styles prefer node1 when the requested label is absent.
      // A definition containing only one label can also supply that fallback,
      // including an explicitly empty label. Keep duplicate detection intact.
      // Selection among other multiple labels remains unresolved; do not make
      // it depend on XML order. Palettes still use the requested label only.
      const choices =
        label === null
          ? []
          : (index.get(label) ??
            (kind === "quick-style"
              ? (index.get("node1") ?? soleStyle)
              : undefined) ??
            []);
      if (choices.length > 1)
        issues.push(`duplicate diagram ${kind} label ${label}`);
      return choices.length === 1 ? choices[0]! : null;
    };
    const quickStyle = lookup(styles, "quick-style");
    const colors = lookup(colorStyles, "color-style");
    let textFill: DiagramColorSample | null = null;
    try {
      textFill = sampleDiagramColors(
        child(colors, "txFillClrLst"),
        styleIndex,
        styleCount,
      );
    } catch (error) {
      issues.push(
        error instanceof Error ? error.message : "invalid diagram text colors",
      );
    }
    return {
      label,
      styleIndex,
      styleCount,
      quickStyle,
      colors,
      textFill,
      issues,
    };
  };
};

export const readDiagramStyles = (
  model: DiagramDataModel,
  layout: XmlElement | null,
  quickStyle: XmlElement | null,
  colors: XmlElement | null,
): DiagramStyles => {
  const textNodes = new Map<string, XmlElement[]>();
  if (layout)
    walkElements(layout, (node) => {
      if (
        node.name.namespaceURI !== NS.diagram ||
        node.name.localName !== "layoutNode"
      )
        return;
      const name = value(node, "name");
      if (name === null) return;
      let textAlgorithm = false;
      walkElements(node, (el) => {
        if (
          el !== node &&
          el.name.namespaceURI === NS.diagram &&
          el.name.localName === "layoutNode"
        )
          return false;
        if (
          el.name.namespaceURI === NS.diagram &&
          el.name.localName === "alg" &&
          value(el, "type") === "tx"
        )
          textAlgorithm = true;
        return;
      });
      if (textAlgorithm)
        textNodes.set(name, [...(textNodes.get(name) ?? []), node]);
    });
  const resolveStyle = readDiagramStyleLabels(quickStyle, colors);
  const byAssociation = new Map<string, DiagramPoint[]>();
  for (const point of model.points) {
    if (point.type !== "pres") continue;
    const id = value(point.properties, "presAssocID");
    if (id === null) continue;
    const key = diagramModelIdKey(id);
    byAssociation.set(key, [...(byAssociation.get(key) ?? []), point]);
  }
  const nodesFor = (point: DiagramPoint): readonly XmlElement[] =>
    textNodes.get(value(point.properties, "presName") ?? "") ?? [];
  const levels = new Map<string, number | null>();
  const levelOf = (point: DiagramPoint): number | null => {
    const path: DiagramPoint[] = [],
      seen = new Set<string>();
    let current: DiagramPoint | null = point,
      level: number | null = null;
    while (current) {
      const key = diagramModelIdKey(current.id);
      if (levels.has(key)) {
        level = levels.get(key)!;
        break;
      }
      if (seen.has(key) || current.type === "pres") break;
      seen.add(key);
      if (current.type === "doc") {
        level = -1;
        levels.set(key, level);
        break;
      }
      const parents = [
        ...new Set(
          model
            .incoming(current.id, "parOf")
            .map((e) => diagramModelIdKey(e.sourceId)),
        ),
      ];
      if (!parents.length) {
        level = 0;
        levels.set(key, level);
        break;
      }
      // A malformed cycle, dangling parent or ambiguous ancestry must not
      // accidentally apply a different node level's formatting.
      if (parents.length !== 1) break;
      path.push(current);
      current = model.point(parents[0]!);
    }
    for (let i = path.length - 1; i >= 0; i--) {
      if (level !== null) level++;
      levels.set(diagramModelIdKey(path[i]!.id), level);
    }
    return levels.get(diagramModelIdKey(point.id)) ?? level;
  };
  return {
    listStyle: readDiagramListStyle(layout),
    textStyle: (modelId) => {
      const point = model.point(modelId);
      if (!point) return null;
      const issues: string[] = [];
      let candidates = nodesFor(point).length ? [point] : [];
      if (!candidates.length) {
        const association = value(point.properties, "presAssocID");
        if (association !== null)
          candidates = (
            byAssociation.get(diagramModelIdKey(association)) ?? []
          ).filter((p) => nodesFor(p).length > 0);
      }
      if (candidates.length > 1) {
        const sourceIds = model
          .textSources(point.id)
          .map((p) => diagramModelIdKey(p.id));
        const matching = candidates.filter((candidate) => {
          const ids = model
            .textSources(candidate.id)
            .map((p) => diagramModelIdKey(p.id));
          return (
            ids.length === sourceIds.length &&
            ids.every((id, i) => id === sourceIds[i])
          );
        });
        if (matching.length) candidates = matching;
      }
      const nodes = candidates.flatMap((p) => [...nodesFor(p)]);
      const labels = new Set(
        candidates.flatMap((p) => {
          const explicit = value(p.properties, "presStyleLbl");
          return explicit !== null
            ? [explicit]
            : nodesFor(p)
                .map((n) => value(n, "styleLbl"))
                .filter((s): s is string => s !== null);
        }),
      );
      if (labels.size > 1) issues.push("ambiguous diagram text style");
      const label = labels.size === 1 ? [...labels][0]! : null;
      const styleNumber = (
        attribute: string,
        minimum: number,
      ): number | null => {
        const values = new Set<number>();
        for (const p of candidates) {
          const raw = value(p.properties, attribute);
          if (raw === null) continue;
          const n = Number(raw);
          if (
            !/^\+?\d+$/.test(raw) ||
            !Number.isInteger(n) ||
            n < minimum ||
            n > 0x7fffffff
          ) {
            issues.push(`invalid diagram ${attribute}`);
            return null;
          }
          values.add(n);
        }
        if (values.size > 1) issues.push(`ambiguous diagram ${attribute}`);
        return values.size === 1 ? [...values][0]! : null;
      };
      const styleIndex = styleNumber("presStyleIdx", 0);
      const styleCount = styleNumber("presStyleCnt", 1);
      const style = resolveStyle(label, styleIndex, styleCount);
      issues.push(...style.issues);
      return {
        presentation: point,
        layoutNodes: nodes,
        ...style,
        sources: model
          .textSources(point.id)
          .map((source) => ({ point: source, level: levelOf(source) })),
        issues,
      };
    },
  };
};
