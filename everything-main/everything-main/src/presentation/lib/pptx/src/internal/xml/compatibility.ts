// Read-only alternate-content selection (ECMA-376 Part 3). Keep every branch
// in the source AST so querying a feature cannot flatten the exported package.
import { type XmlElement, qname } from "./ast.ts";
import { NS } from "./namespaces.ts";
import { childElements, getAttrValue } from "./query.ts";

export const isAlternateContent = (element: XmlElement): boolean =>
  element.name.namespaceURI === NS.mc &&
  element.name.localName === "AlternateContent";

export const isAlternateContentBranch = (element: XmlElement): boolean =>
  element.name.namespaceURI === NS.mc &&
  (element.name.localName === "Choice" ||
    element.name.localName === "Fallback");

// A feature may implement only part of an extension namespace. The scoped
// Choice lets it assess the content before claiming that namespace's support.
export type NamespaceSupport =
  ReadonlySet<string> | ((namespaceURI: string, choice: XmlElement) => boolean);

/**
 * Enumerate logical children through mc:AlternateContent. The caller declares
 * namespaces it understands for this feature; knowing a URI is not support.
 * Requires is a list of prefixes resolved in the Choice's namespace scope.
 * The first fully understood Choice wins, otherwise Fallback wins. Missing,
 * empty or unbound Requires is treated as an unsupported malformed choice.
 * Returned views retain inherited namespace declarations for further queries.
 * Ancestors, if needed for a nested parent, are in outer-to-inner order.
 */
export function* effectiveChildElements(
  parent: XmlElement,
  understoodNamespaces: NamespaceSupport,
  ancestors: ReadonlyArray<XmlElement> = [],
): Generator<XmlElement> {
  const extendScope = (
    inherited: ReadonlyMap<string, string>,
    element: XmlElement,
  ) => {
    const scope = new Map(inherited);
    for (const [prefix, uri] of element.prefixDecls) scope.set(prefix, uri);
    return scope;
  };
  const initialScope = new Map<string, string>();
  for (const element of [...ancestors, parent])
    for (const [prefix, uri] of element.prefixDecls)
      initialScope.set(prefix, uri);
  // An explicit iterator stack preserves document order without recursive
  // generator calls or repeatedly scanning every ancestor namespace map.
  const pending = [
    { children: childElements(parent)[Symbol.iterator](), scope: initialScope },
  ];
  while (pending.length) {
    const frame = pending[pending.length - 1]!;
    const next = frame.children.next();
    if (next.done) {
      pending.pop();
      continue;
    }
    const child = next.value,
      scope = extendScope(frame.scope, child);
    if (!isAlternateContent(child)) {
      yield { ...child, prefixDecls: scope };
      continue;
    }
    let selected: XmlElement | undefined,
      selectedScope: Map<string, string> | undefined;
    const branches = childElements(child).filter(isAlternateContentBranch);
    for (const branch of branches) {
      if (branch.name.localName !== "Choice") continue;
      const required = getAttrValue(branch, qname("", "Requires", ""))?.trim();
      if (!required) continue;
      const branchScope = extendScope(scope, branch),
        scopedChoice = { ...branch, prefixDecls: branchScope };
      if (
        required.split(/\s+/).every((prefix) => {
          const uri = branchScope.get(prefix);
          return (
            !!uri &&
            (typeof understoodNamespaces === "function"
              ? understoodNamespaces(uri, scopedChoice)
              : understoodNamespaces.has(uri))
          );
        })
      ) {
        selected = branch;
        selectedScope = branchScope;
        break;
      }
    }
    selected ??= branches.find(
      (branch) => branch.name.localName === "Fallback",
    );
    if (selected)
      pending.push({
        children: childElements(selected)[Symbol.iterator](),
        scope: selectedScope ?? extendScope(scope, selected),
      });
  }
}
