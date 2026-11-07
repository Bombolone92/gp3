import type { DiagramConstraintSelector } from "./constraint.ts";
import type { DiagramLayoutNode } from "./layout.ts";
import { matchesDiagramPointSelection } from "./iterator.ts";

/**
 * Select the logical layout instances to which a bound constraint applies.
 * ch/des traverse the layout tree, not the data hierarchy. Point types filter
 * each instance's semantic context, not the points contributing its text.
 * Unlike an iterator, this selection never hides the last sibling transition.
 *
 * Self constraints apply regardless of forName, but only with the
 * default all point type. Names still distinguish declarations/references in
 * a constraint scope; target selection must not be used for reference or rule
 * lookup. In particular, selecting the same nodes does not alias variables.
 * This operates before drawing generation and document-node promotion.
 */
export const selectDiagramConstraintTargets = (
  owner: DiagramLayoutNode,
  selector: DiagramConstraintSelector,
): DiagramLayoutNode[] => {
  if (selector.relationship === "self")
    return selector.pointType === "all" ? [owner] : [];

  const matches = (node: DiagramLayoutNode): boolean =>
    (!selector.name || node.name === selector.name) &&
    matchesDiagramPointSelection(node.context, selector.pointType);
  if (selector.relationship === "ch") return owner.children.filter(matches);

  const selected: DiagramLayoutNode[] = [];
  // Explicit traversal preserves layout order and remains safe for deep trees.
  // A nonmatching ancestor must not prune matching descendants.
  const stack: { children: readonly DiagramLayoutNode[]; index: number }[] = [
    { children: owner.children, index: 0 },
  ];
  while (stack.length) {
    const frame = stack[stack.length - 1]!;
    const node = frame.children[frame.index++];
    if (!node) {
      stack.pop();
      continue;
    }
    if (matches(node)) selected.push(node);
    if (node.children.length) stack.push({ children: node.children, index: 0 });
  }
  return selected;
};
