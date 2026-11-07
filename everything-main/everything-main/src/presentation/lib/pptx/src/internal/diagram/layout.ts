import {
  type XmlElement,
  NS,
  childElements,
  firstChildElement,
  getAttrValue,
  qname,
} from "../xml/index.ts";
import type { DiagramHierarchy, DiagramHierarchyNode } from "./hierarchy.ts";
import {
  type DiagramVariables,
  readDiagramVariables,
  readDiagramCondition,
  evaluateDiagramCondition,
} from "./condition.ts";
import {
  iterateDiagramNodes,
  readDiagramIterator,
  selectDiagramNodes,
} from "./iterator.ts";

/** A logical layout instance, before algorithms assign geometry or drawing IDs. */
export interface DiagramLayoutNode {
  readonly definition: XmlElement;
  readonly name: string;
  readonly styleLabel: string;
  readonly moveWith: string;
  readonly childOrder: "b" | "t";
  readonly context: DiagramHierarchyNode;
  readonly parent: DiagramLayoutNode | null;
  readonly children: readonly DiagramLayoutNode[];
  readonly variables: DiagramVariables;
  readonly algorithm: XmlElement | null;
  readonly shape: XmlElement | null;
  readonly presentationOf: XmlElement | null;
  /** Text/data mappings, distinct from the structural association to context. */
  readonly contributors: readonly DiagramHierarchyNode[];
  readonly constraints: readonly XmlElement[];
  readonly rules: readonly XmlElement[];
}
type MutableNode = Omit<
  DiagramLayoutNode,
  | "children"
  | "algorithm"
  | "shape"
  | "presentationOf"
  | "contributors"
  | "constraints"
  | "rules"
> & {
  children: MutableNode[];
  algorithm: XmlElement | null;
  shape: XmlElement | null;
  presentationOf: XmlElement | null;
  contributors: DiagramHierarchyNode[];
  constraints: XmlElement[];
  rules: XmlElement[];
};
interface Block {
  kind: "block";
  elements: readonly XmlElement[];
  index: number;
  context: DiagramHierarchyNode;
  owner: MutableNode;
  boundary: Loop | null;
}
interface Loop {
  kind: "loop";
  definition: XmlElement;
  context: DiagramHierarchyNode;
  owner: MutableNode;
  iterator: Generator<DiagramHierarchyNode>;
  elements: readonly XmlElement[];
  boundary: Loop | null;
}
const attr = (element: XmlElement, name: string): string | null =>
  getAttrValue(element, qname("", name, ""));
const children = (element: XmlElement): XmlElement[] =>
  childElements(element).filter((e) => e.name.namespaceURI === NS.diagram);

/**
 * Interpret CT_LayoutNode/CT_ForEach/CT_Choose without mutating source XML or
 * saved presentation points. Keep logical structure separate from the
 * saved presentation graph (which can promote document text to its root).
 */
export const expandDiagramLayout = (
  definition: XmlElement,
  hierarchy: DiagramHierarchy,
  options: { maxOperations?: number } = {},
): DiagramLayoutNode => {
  // A finite template can still request exponential work without emitting any
  // nodes (for example, repeated ch/par axes around a false choose branch).
  // Reject exhausting the caller-adjustable work budget; never return a
  // truncated layout as though expansion had succeeded.
  const maxOperations = options.maxOperations ?? 100_000;
  if (!Number.isSafeInteger(maxOperations) || maxOperations < 1)
    throw new Error("invalid diagram layout operation budget");
  let operations = 0;
  const consume = (): void => {
    if (++operations > maxOperations)
      throw new Error("diagram layout operation budget exceeded");
  };
  if (
    definition.name.namespaceURI !== NS.diagram ||
    !["layoutDef", "layoutNode"].includes(definition.name.localName)
  )
    throw new Error("expected diagram layout definition");
  const roots =
    definition.name.localName === "layoutNode"
      ? [definition]
      : children(definition).filter((e) => e.name.localName === "layoutNode");
  if (roots.length !== 1)
    throw new Error("diagram layout requires one root layout node");
  const rootDefinition = roots[0]!;

  // References are lexical IDs, including declarations in unselected branches.
  // Index first so both forward references and recursive definitions work.
  const references = new Map<string, XmlElement>();
  const pending = [rootDefinition];
  while (pending.length) {
    consume();
    const element = pending.pop()!;
    if (element.name.localName === "forEach") {
      const name = attr(element, "name");
      if (name) {
        if (references.has(name))
          throw new Error(`duplicate diagram iteration name ${name}`);
        references.set(name, element);
      }
    }
    for (const child of children(element))
      if (
        ["layoutNode", "forEach", "choose", "if", "else"].includes(
          child.name.localName,
        )
      )
        pending.push(child);
  }
  const resolve = (element: XmlElement): XmlElement => {
    const seen = new Set<XmlElement>();
    while (attr(element, "ref")) {
      if (seen.has(element))
        throw new Error("cyclic diagram iteration reference");
      seen.add(element);
      const name = attr(element, "ref")!;
      const target = references.get(name);
      if (!target)
        throw new Error(`missing diagram iteration reference ${name}`);
      element = target;
    }
    return element;
  };
  const create = (
    element: XmlElement,
    context: DiagramHierarchyNode,
    parent: MutableNode | null,
  ): MutableNode => {
    const order = attr(element, "chOrder") ?? "b";
    if (order !== "b" && order !== "t")
      throw new Error(`invalid diagram child order ${order}`);
    return {
      definition: element,
      name: attr(element, "name") ?? "",
      styleLabel: attr(element, "styleLbl") ?? "",
      moveWith: attr(element, "moveWith") ?? "",
      childOrder: order,
      context,
      parent,
      children: [],
      variables: readDiagramVariables(
        firstChildElement(element, qname("dgm", "varLst", NS.diagram)),
        parent?.variables,
      ),
      algorithm: null,
      shape: null,
      presentationOf: null,
      contributors: [context],
      constraints: [],
      rules: [],
    };
  };
  const root = create(rootDefinition, hierarchy.root, null);
  const block = (
    element: XmlElement,
    context: DiagramHierarchyNode,
    owner: MutableNode,
    boundary: Loop | null,
  ): Block => ({
    kind: "block",
    elements: children(element),
    index: 0,
    context,
    owner,
    boundary,
  });
  const stack: (Block | Loop)[] = [
    block(rootDefinition, hierarchy.root, root, null),
  ];
  const active = new Map<XmlElement, Set<DiagramHierarchyNode>>();
  const instances = new Map<XmlElement, Set<DiagramHierarchyNode>>();
  const pop = (): void => {
    const frame = stack.pop()!;
    if (frame.kind === "loop") {
      active.get(frame.definition)!.delete(frame.context);
      frame.iterator.return(undefined);
    }
  };
  while (stack.length) {
    consume();
    const frame = stack[stack.length - 1]!;
    if (frame.kind === "loop") {
      const next = frame.iterator.next();
      if (next.done) pop();
      else
        stack.push({
          kind: "block",
          elements: frame.elements,
          index: 0,
          context: next.value,
          owner: frame.owner,
          boundary: frame.boundary ?? frame,
        });
      continue;
    }
    const element = frame.elements[frame.index++];
    if (!element) {
      pop();
      continue;
    }
    const { context, owner, boundary } = frame;
    switch (element.name.localName) {
      case "layoutNode": {
        let contexts = instances.get(element);
        if (!contexts) instances.set(element, (contexts = new Set()));
        if (contexts.has(context)) {
          // Layout ends the active nested iteration at a repeated mapping,
          // rather than creating another instance or skipping ahead. The
          // following sibling statement still runs. References share instance
          // identity even when invoked inside different containing nodes;
          // only the current containing node's iteration is ended.
          if (!boundary) throw new Error("repeated diagram layout instance");
          while (stack[stack.length - 1] !== boundary) pop();
          pop();
          break;
        }
        contexts.add(context);
        const node = create(element, context, owner);
        owner.children.push(node);
        stack.push(block(element, context, node, null));
        break;
      }
      case "forEach": {
        const target = resolve(element);
        let contexts = active.get(target);
        if (!contexts) active.set(target, (contexts = new Set()));
        if (contexts.has(context))
          throw new Error("non-progressing diagram iteration recursion");
        contexts.add(context);
        stack.push({
          kind: "loop",
          definition: target,
          context,
          owner,
          boundary,
          elements: children(target),
          iterator: iterateDiagramNodes(
            hierarchy,
            context,
            readDiagramIterator(target),
            consume,
          ),
        });
        break;
      }
      case "choose": {
        let selected: XmlElement | undefined;
        for (const branch of children(element)) {
          if (branch.name.localName === "if") {
            if (
              evaluateDiagramCondition(
                hierarchy,
                context,
                readDiagramCondition(branch),
                owner.variables,
              )
            ) {
              selected = branch;
              break;
            }
          } else if (branch.name.localName === "else") {
            selected = branch;
            break;
          }
        }
        if (selected) stack.push(block(selected, context, owner, boundary));
        break;
      }
      case "alg":
        // CT_LayoutNode/CT_When/CT_ForEach contain a repeating choice, so
        // properties can occur more than once, including through branches.
        // The last executed property wins, replacing a list as a whole.
        // varLst differs: its first direct occurrence establishes lexical scope
        // before execution, as handled by create().
        owner.algorithm = element;
        break;
      case "shape":
        owner.shape = element;
        break;
      case "presOf":
        owner.presentationOf = element;
        owner.contributors = selectDiagramNodes(
          hierarchy,
          context,
          readDiagramIterator(element),
        );
        break;
      case "constrLst":
        owner.constraints = children(element).filter(
          (e) => e.name.localName === "constr",
        );
        break;
      case "ruleLst":
        owner.rules = children(element).filter(
          (e) => e.name.localName === "rule",
        );
        break;
      case "varLst":
      case "extLst":
        break;
      default:
        throw new Error(
          `unsupported diagram layout statement ${element.name.localName}`,
        );
    }
  }
  return root;
};
